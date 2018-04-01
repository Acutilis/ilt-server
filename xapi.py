#!/usr/bin/env python

"""Very naive implementation of a xAPI controller class."""

import datetime
import time
import json
import uuid

from tornado.log import app_log

from tincan import (
    RemoteLRS,
    Statement,
    Agent,
    Verb,
    Activity,
    Context,
    LanguageMap,
    ActivityDefinition,
    Result,
    Extensions
)


class XAPI(object):
    def __init__(self, session_controller):
        self._SC = session_controller
        self._LRSs = []
        self._statement_buffer = []
        # Use fixed size buffer. It wouldn't be hard to adjust the size dynamically depending on the number of clients
        self._buffer_size = 25
        self._buffer_discard_size = 500
        self._session_activity_id = None
        self._presentation_activity_id = None
        self._session_object = None
        self._presentation_object = None

        self._setup_LRSs()
        self._set_session_object()

    def _setup_LRSs(self):
        with open('lrs_config.json', 'r') as fi:
            llist = json.load(fi)
        for lrsconf in llist:
            obj = { 'name': lrsconf['name'], 'online': True}
            if 'active' in lrsconf:
                obj['active'] = lrsconf['active']
                del(lrsconf['active'])
            else:
                obj['active'] = True
            del(lrsconf['name'])
            lrs = RemoteLRS(**lrsconf)
            obj['lrs'] = lrs
            #self._LRSs.append(lrs)
            self._LRSs.append(obj)
        # TODO: check that lrs setup is right, loop through LRSs to make sure they're online

    def _set_session_object(self):
        self._session_activity_id = 'https://iltserver.com/sessions/' + self._SC._session_id
        object = Activity(
            id=self._session_activity_id,
            definition=ActivityDefinition(
                name=LanguageMap({'en-US': 'A team-ilt-xapi session'}),
                description=LanguageMap({'en-US': 'A synchronous multiuser session on our wonderful system'}),
                type='https://xapi.xapicohort.org/iltxapiteam/activity-types/session'
            ),
        )
        self._session_object = object

    def make_actor(self, actor_name):
        return  Agent(
            name=actor_name,
            mbox='mailto:' + actor_name + '@iltserver.com',
        )

    def set_presentation_object(self, presentation_slug):
        self._presentation_activity_id = 'https://iltserver.com/presentations/' + presentation_slug
        object = Activity(
            id=self._presentation_activity_id,
            definition=ActivityDefinition(
                name=LanguageMap({'en-US': 'A team-ilt-xapi RevealJS presentation'}),
                description=LanguageMap({'en-US': 'A RevealJS presentation'}),
                type='https://xapi.xapicohort.org/revealjs/activity-type/presentation'
            ),
        )
        self._presentation_object = object

    def _send_to_LRS(self, statement):
        # the stat should only be updated for real sending...
        self._SC.inc_stat('statements')
        if not self._LRSs[0]['active']:
            app_log.info('Not Sending Statement...')
            return
        statement = self._enhance_statement(statement)
        # save to buffer
        self._statement_buffer.append(statement)
        if len(self._statement_buffer) >= self._buffer_size:
            # For now, use only the 1st LRS in our list of LRSs. It is considered "the main one".
            #response = self._LRSs[0]['lrs'].save_statement(statement)
            self.flush_buffer()
        else:
            app_log.info('Statement buffered: '+ statement.actor.mbox + ' ' + statement.verb.id + ' ' + statement.object.id)

    def flush_buffer(self):
        if len(self._statement_buffer) == 0:
            return
        response = self._LRSs[0]['lrs'].save_statements(self._statement_buffer)
        if not response or not response.success:
            app_log.info('ERROR Saving statement to LRS...')
            app_log.info(response.data)
            # send to monitor statement errors
            # keep statements in the buffer... unless it reaches the discard size...
            bl = len(self._statement_buffer) 
            if (bl >= self._buffer_discard_size):
                self._statement_buffer=[]
                app_log.info('ATTENTION: ' + str(bl) + 'statements in buffer have been discarded!')
        else:
            self._statement_buffer = []
            app_log.info('Buffered statements saved to LRS.')
            # increment statement sent count and send to monitors

    def _enhance_statement(self, statement):
        context = Context(
            registration=self._SC._session_id,
            instructor=self._SC._instructor_actor
        )
        statement.context = context
        statement.timestamp = time.time()
        statement.id = str(uuid.uuid4())
        # embed more info into the statement:
        #   in the context extensions encode the settings: if follow/mode and locked_navigationis on, 
        #   add result: time spent on slide, average slide time (if available in slide DOM node)
        #   slide indices
        #   progress?
        return statement


    # send statement methods

    def sendstatement_session_started(self):
        aname = 'sysadmin'
        actor = Agent(
            name=aname,
            mbox='mailto:' + aname + '@iltserver.com',
        )
        verb = Verb(
            id='http://activitystrea.ms/schema/1.0/start',
            display=LanguageMap({'en-US': 'started'}),
        )
        statement = Statement(
            actor=actor,
            verb=verb,
            object=self._session_object
        )
        self._send_to_LRS(statement)

    def sendstatement_session_ended(self):
        aname = 'sysadmin'
        actor = Agent(
            name=aname,
            mbox='mailto:' + aname + '@iltserver.com',
        )
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/terminated',
            display=LanguageMap({'en-US': 'terminated'}),
        )
        statement = Statement(
            actor=actor,
            verb=verb,
            object=self._session_object
        )
        self._send_to_LRS(statement)

    def sendstatement_presentation_launched(self, conn):
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/launched',
            display=LanguageMap({'en-US': 'launched'}),
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object
        )
        self._send_to_LRS(statement)

    def sendstatement_presentation_unloaded(self, conn):
        verb = Verb(
            id='https://iltserver.com/verbs/unloaded',
            display=LanguageMap({'en-US': 'unloaded'}),
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object
        )
        self._send_to_LRS(statement)
    # looking at http://xapi.vocab.pub/verbs/index.html

    def sendstatement_joined_session(self, conn):
        verb = Verb(
            id='http://activitystrea.ms/schema/1.0/join',
            display=LanguageMap({'en-US': 'joined'}),
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._session_object
        )
        self._send_to_LRS(statement)

    def sendstatement_left_session(self, conn):
        #  http://activitystrea.ms/schema/1.0/leave
        verb = Verb(
            id='http://activitystrea.ms/schema/1.0/leave',
            display=LanguageMap({'en-US': 'left'}),
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._session_object
        )
        self._send_to_LRS(statement)

    def sendstatement_initialized_presentation(self, conn):
        # sent when a participant's browser has finished loading the revealjs presentation
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/initialized',
            display=LanguageMap({'en-US': 'initialized'}),
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object
        )
        self._send_to_LRS(statement)

    def _make_slide_object(self, slide_info):
        if slide_info['title']:  # if slide has title, let's use that as part of the id: it's more informative
            slide_id = self._presentation_activity_id + '/' + slide_info['title']
        else:
            slide_id = self._presentation_activity_id + '/' + str(slide_info['indexh']) + '_' + str(slide_info['indexv'])

        object = Activity(
            id=slide_id,
            definition=ActivityDefinition(
                name=LanguageMap({'en-US': 'A RevealJS slide'}),
                description=LanguageMap({'en-US': 'A RevealJS slide'}),
                type='https://xapi.xapicohort.org/revealjs/activity-type/slide'
            ),
        )
        return object

    def sendstatement_attempted_slide(self, conn, slide_info):
    # sent when a participant's presentation arrives at another slide
    # slide_info includes title (could be None) indexh and indexv
    # need to recalculate the id!
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/attempted',
            display=LanguageMap({'en-US': 'attempted'}),
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._make_slide_object(slide_info)
        )
        self._send_to_LRS(statement)

    def sendstatement_completed_slide(self, conn, slide_info):
    # sent when a participant's presentation leaves the current slide (we want to record duration)
    # slide_info includes title (could be None) indexh and indexv
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/completed',
            display=LanguageMap({'en-US': 'completed'}),
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._make_slide_object(slide_info)
        )
        self._send_to_LRS(statement)

    def sendstatement_sync_me_to_instructor(self, conn):
        # the object of this statement is the presentation, in the context of session
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/interacted',
            display=LanguageMap({'en-US': 'interacted'}),
        )
        result_obj = Result(
                extensions=Extensions({
                    'https://iltserver.com/extensions/sync-me-to-instructor': 'request'
                })
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object,
            result=result_obj
        )
        self._send_to_LRS(statement)

    # instructor statements

    def sendstatement_locked_navigation(self, conn):
        # the object of this statement is the presentation, in the context of session
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/interacted',
            display=LanguageMap({'en-US': 'interacted'}),
        )
        result_obj = Result(
                extensions=Extensions({
                    'https://iltserver.com/extensions/free-navigation': 'off'
                })
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object,
            result=result_obj
        )
        self._send_to_LRS(statement)

    def sendstatement_unlocked_navigation(self, conn):
        # the object of this statement is the presentation, in the context of session
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/interacted',
            display=LanguageMap({'en-US': 'interacted'}),
        )
        result_obj = Result(
            extensions=Extensions({
                'https://iltserver.com/extensions/free-navigation': 'on'
            })
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object,
            result=result_obj
        )
        self._send_to_LRS(statement)

    def sendstatement_locked_followme(self, conn):
        # the object of this statement is the presentation, in the context of session
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/interacted',
            display=LanguageMap({'en-US': 'interacted'}),
        )
        result_obj = Result(
            extensions=Extensions({
                'https://iltserver.com/extensions/follow-me': 'on'
            })
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object,
            result=result_obj
        )
        self._send_to_LRS(statement)

    def sendstatement_unlocked_followme(self, conn):
        # the object of this statement is the presentation, in the context of session
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/interacted',
            display=LanguageMap({'en-US': 'interacted'}),
        )
        result_obj = Result(
            extensions=Extensions({
                'https://iltserver.com/extensions/follow-me': 'off'
            })
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object,
            result=result_obj
        )
        self._send_to_LRS(statement)

    def sendstatement_sync_all_to_instructor(self, conn):
        # the object of this statement is the presentation, in the context of session
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/interacted',
            display=LanguageMap({'en-US': 'interacted'}),
        )
        result_obj = Result(
            extensions=Extensions({
                'https://iltserver.com/extensions/sync-all-to-instructor': 'request'
            })
        )
        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._presentation_object,
            result=result_obj
        )
        self._send_to_LRS(statement)

    def _make_interaction_object(self, interaction_info):
        # example of interaction info object:
        #{"interaction_type":"choice","id":"single_choice_1#xapi_stands_for","description":"xAPI stands for:","options_checked":["extraapplicationposttestinteraction"],
        # "crp":"experienceapplicationprogramminginterface","response":"","correct":false,"choices":[{"id":"ExtraApplicationPosttestInteraction",
        # "description":"ExtraApplicationPosttestInteraction"},{"id":"ExperienceApplicationProgrammingInterface","description":"ExperienceApplicationProgrammingInterface"},
        # {"id":"ExtensibleAdvancedProgramInstruction","description":"ExtensibleAdvancedProgramInstruction"}]}

        interaction_id = self._presentation_activity_id + '/'  + interaction_info['id']
        #crp = (interaction_info['crp']).replace(',','[,]')
        crp = interaction_info['crp']
        desc=LanguageMap({'en-US': interaction_info['description']})
        if 'choices' in interaction_info:
            # modify 'choices': it comes as a dict where both 'id' and 'description' are strings, but 'description' needs to be a LanguageMap in xAPI
            for ch in interaction_info['choices']:
                desc_str = ch['description']
                desc_langmap = LanguageMap({'en-US': desc_str })
                ch['description'] = desc_langmap

        if (interaction_info['interaction_type'] == 'choice'):
            choices = interaction_info['choices']
            #app_log.info('choices = '+ str(choices))
            activity_def=ActivityDefinition(
                name=LanguageMap({'en-US': 'An interaction in a RevealJS slide'}),
                description=desc,
                type='http://adlnet.gov/expapi/activities/cmi.interaction',
                interactionType=interaction_info['interaction_type'],
                correctResponsesPattern=crp,
                choices=choices
            )
        else:
            activity_def=ActivityDefinition(
                name=LanguageMap({'en-US': 'An interaction in a RevealJS slide'}),
                description=desc,
                type='http://adlnet.gov/expapi/activities/cmi.interaction',
                interactionType=interaction_info['interaction_type'],
                correctResponsesPattern=crp
            )
        object = Activity(
            id=interaction_id,
            definition=activity_def
        )
        return object

    def sendstatement_interaction_completed(self, conn, interaction_info):
        # HERE TO-DO: I want to change 'completion' ... if the submission was forced, say completion = NO
        # although it's probably not nessary...
        verb = Verb(
            id='http://adlnet.gov/expapi/verbs/completed',
            display=LanguageMap({'en-US': 'completed'}),
        )
        if (interaction_info['interaction_type'] == 'choice'):
            result_obj = Result(
                completion=interaction_info['interaction_type'],
                response=','.join(interaction_info['options_checked']),
                success=interaction_info['correct']
            )
        else:
            result_obj = Result(
                completion=interaction_info['interaction_type'],
                response=interaction_info['response'],
                success=interaction_info['correct']
            )

        statement = Statement(
            actor=conn._actor,
            verb=verb,
            object=self._make_interaction_object(interaction_info),
            result=result_obj
        )
        #app_log.info('SENDING INTERACTION Statement: '+ statement.actor.mbox + ' ' + statement.verb.id + ' ' + statement.object.id)
        self._send_to_LRS(statement)



#if __name__ == "__main__":
#    xapi = XAPI()
#    print xapi._LRSs
