var ILTRevealSession = window.ILTRevealSession || (function(){

    return ( {

        pres_iframe: null,
        Reveal: null,
        slide_info: { previous_slide: {title: null, indexh: null, indexv: null}, current_slide: {title: null, indexh: null, indexv: null} },
        presentation_forms: null,
        current_form: null,
        current_form_inputs: null,

        ws_support: function() {
            ws = 'WebSocket' in window || 'MozWebSocket' in window;
            if ( typeof( ws ) == "undefined") { ws = false; }
            return ws;
        },

        init_ws: function(nickname) {
            var url;
            url = "ws://"+window.location.host  + "/ws?nick="+nickname ;
            ws = new WebSocket( url );

            ws.onopen  = function(event) {
                console.log("Socket opened");

                window.onbeforeunload = function(e) {
                    ws.close()
               };
            }

            ws.onclose = function(){
                console.log("WebSocket closed.");
                $('#main_content').html('<h1>Connection close</h1><p>Sorry, the server closed your connection.</p>');
            }

            ws.onerror  = function(event) {
                console.log("ERROR opening WebSocket.");
                $('#main_content').html('<h1>Sorry</h1><p>Sorry, your browser does not support WebSockets. This functionality is necessary to use this system. Please use another browser.</p>');
            }

            _.bindAll(this, 'receive_message','on_presentation_loaded','on_slide_changed', 'wireup_reveal', 'send_response');
            ws.onmessage = this.receive_message;
        },

        send_msg: function(msg) {
            ws.send(msg);
        },

        on_presentation_loaded: function(ev) {
            //alert('PRESENTATION LOADED!');
            // get a handle of the Reveal object in the iframe. 
            this.Reveal = ev.target.contentWindow.Reveal;
            // from now on, we can control the presentation using this.Reveal and the Reveal APIa
            if (this.Reveal.isReady()) {
                this.wireup_reveal();
            } else {
                this.Reveal.addEventListener( 'ready', this.wireup_reveal);
            }
            // Now hook up all the reveal events we want to use
        },

        wireup_reveal: function(ev) {
            console.log('Wiring Up reveal events');
            this.Reveal.addEventListener( 'slidechanged', this.on_slide_changed );
            this.handle_lock_student_nav(null, true); // trick to update the config of the Reveal presentation
            this.on_slide_changed(ev); // manually trigger a state update, so this connection sends its state to the server
        },

        send_response: function(ev) {
            this.disable_current_interaction();
            var respinfo_obj = this.build_responseinfo_obj()
            this.send_msg('interaction_info|' + JSON.stringify(respinfo_obj));
        },

        build_responseinfo_obj: function() {
            var obj = { interaction_type:'',  id:null, description:'', options_checked: [], crp: null, response:'', correct:false }
            var sld = this.Reveal.getCurrentSlide(); //this is the 'section' corresponding to this slide
            var slide_title= $(sld).prop('title');
            var form_title= $(this.current_form).prop('title');
            obj.id= slide_title + '#' + form_title;
            if (obj.id=="#") obj.id = "radom_id_" + Math.floor(Math.random() * 1000000).toString();
            var defi = ''
            $(sld).find("[data-description]").each(function() {
                defi = defi + $(this).text();
            });
            obj.description = defi;
            obj.crp = ($(this.current_form).attr('data-crp').toLowerCase()).split(',');
            var choices = [];
            $(this.current_form_inputs).each(function() {
                var inp = $(this)[0];
                var inptype = [$(inp).is('[type="checkbox"]'), $(inp).is('[type="radio"]'), $(inp).is('[type="text"]')]
                if (inptype[0] || inptype[1]) {  //it's a checkbox or a radio button
                    var v = $(inp).prop("value");
                    (v == "true" || v == "false") ? obj.interaction_type = "true-false" : obj.interaction_type = "choice";
                    choices.push({id: v, description: v});
                    if ($(inp).prop("checked")) {
                        obj['options_checked'].push($(inp).prop("value").toLowerCase());
                    }
                } else if (inptype[2]) {  //it's a text field
                    obj.interaction_type = "fill-in";
                    obj.response = $(inp).val().toLowerCase();
                    obj.correct= (obj.crp == obj.response);
                } else {  //unsupported type
                    console.log('ERROR: unsupported interaction type.');
                    return null;
                }
            });
            // Add choices, if necessary. Calculate correctness. For fill-in we already have it. 
            if (obj.interaction_type == "true-false") {
                obj.correct= (obj.crp[0] == obj.options_checked[0]);
                obj.response = obj.options_checked.join(',');
            } else if (obj.interaction_type == "choice") {
                // correct if all checked options are in the CorrectResponsePatterna
                obj.response = obj.options_checked.join(',');
                obj['choices'] = choices;
                if  (obj.options_checked.length>0) {
                    str_crp = obj.crp.join(',');
                    var is_correct = true;
                    for (var i=0; i<obj.options_checked.length; i++) {
                        is_correct = (is_correct && (str_crp.indexOf(obj.options_checked[i]) > -1));
                    }
                    obj.correct = is_correct;
                } 
            }
            return obj;
        },

        update_slide_info: function() {
            // update local info about previous and current slide, so we can send it to the server
            // available info: ev.previousSlide, ev.currentSlide, ev.indexh, ev.indexv.   The 1st two are refs to DOM objects.
            // slide_info: { previous_slide: {title: '', indexh: null, indexv: null}, current_slide: {title: '', indexh: null, indexv: null} }
            var previousSlide = this.Reveal.getPreviousSlide();  // ref to DOM object
            var currentSlide = this.Reveal.getCurrentSlide();  // ref to DOM object
            var indices = this.Reveal.getIndices();

            if (previousSlide) {   // not first slide
                this.slide_info.previous_slide = _.extend({}, this.slide_info.current_slide);
            }
            this.slide_info.current_slide.title = currentSlide.title ? (currentSlide.title).replace(/\s+/g,'_').toLowerCase() : null;
            this.slide_info.current_slide.indexh  = indices.h;
            this.slide_info.current_slide.indexv  = indices.v;
        },

        on_slide_changed: function(ev) {
            //console.log('Slide changed!');
            this.update_slide_info();
            this.sendreq_slide_changed(ev);
            //this.disable_interaction(ev.previousSlide);
            if (ev && ev.currentSlide) {
                this.setup_interaction(ev.currentSlide);
            }
        },

        setup_interaction: function(current_slide) {
            this.current_form = $(current_slide).find('form')[0];
            if (! this.current_form) {
                $('#force_i_submission').attr("disabled");
                $('#see_interaction_results').attr("disabled");
                return;
            }
            // enable force_i_submission button, but only if nav is locked and 'follow me' is ON
             var locknav_element = $('#lock_student_nav');
             if (locknav_element) {  // if this element  exists, this is the instructor
                var lockfollow_element = $('#lock_follow_instructor');
                if (locknav_element.attr("checked") && lockfollow_element.attr("checked")) {
                    $('#force_i_submission').removeAttr("disabled");
                    $('#see_interaction_results').removeAttr("disabled");
                }

             }

            this.current_form_inputs = $($(current_slide).find('form')[0]).find('input')
            var button_send = $(this.current_form).find('a.send-response')[0];
            // enable all form elements and clear all responses
            $(this.current_form_inputs).each(function() {
                // enable the input
                var inp = $(this)[0];
                $(inp).is('[type="radio"]')
                $(inp).prop("disabled", false);  
                if ( $(inp).is('[type="checkbox"]')||  $(inp).is('[type="radio"]') ) {
                    // uncheck
                    $(inp).prop("checked", false);
                } else if ($(inp).is('[type="text"]')) {
                    $(inp).val('');
                }
            });
            // enable the button link
            $(button_send).removeAttr("disabled");
            $(button_send).click(this.send_response);  //connect the event handler
            $(button_send).css('pointer-events', 'auto');
        },

        disable_current_interaction: function() {
            var button_send = $(this.current_form).find('a.send-response')[0];
            $(this.current_form_inputs).each(function() {
                var inp = $(this)[0];
                $(inp).is('[type="radio"]')
                $(inp).prop("disabled", true); 
            });
            $(button_send).off('click', this.send_response);  //disconnect the event handler
            $(button_send).attr("disabled", true);
        },


        // main dispatcher of messages received from the server
        receive_message: function(wsevent) {
            console.log("received message: "+wsevent.data );
            // Use instrospection to dispatch message
            var msg_parts = wsevent.data.split('|')
            var func_name = 'handle_' + msg_parts[0];  // the first part is the message type
            if (this[func_name] && typeof this[func_name] == 'function') {
               this[func_name](msg_parts);   // pass all the message parts as argument
            }
         },


        /* Handlers for messages coming from the server. They all start with 'handle_' */
 
         handle_panel_content: function(msg_parts) {
            //$('#control_panel').html(msg_parts[1]);
            $('#control_panel').replaceWith(msg_parts[1]);
            $('#main_content').html('<iframe id="i_presentation" src="/static/waiting.html"></iframe>');
            this.pres_iframe = $('#i_presentation');  //save ref to this element.
         },

         handle_load_presentation: function(msg_parts) {
            var params_obj = JSON.parse(msg_parts[1]);
            this.pres_iframe.attr('src', params_obj['source']);
            // hook up the 'loaded event' so we can wire up all the connections with reveal_js
            this.pres_iframe.on('load', this.on_presentation_loaded);
         },

         handle_instructor_state: function(msg_parts) {
             var state = JSON.parse(msg_parts[1]);
             console.log('handle_instructor_state: msg_parts = ' + msg_parts);
             //var state = msg_parts[1];
             this.Reveal.setState(state);
         },

         handle_finish_presentation: function(msg_parts) {
             // all should respond to this  function
             // clean-up all the connections with reveal_js
             // remove 'loaded event' so we can wire up all the connections with reveal_js
             this.pres_iframe.off('load', this.on_presentation_loaded);
             $('#main_content').html('<iframe id="i_presentation" src="/static/waiting.html"></iframe>');
             this.pres_iframe = $('#i_presentation');  //save ref to this element.
         },

         handle_lock_student_nav: function(msg_parts, use_chk_status=false) {
             var locked;
             var chk_element = $('#navigation_locked');
             var btn_element = $('#sync_to_instructor'); // the button! (in the instructor broswer, the id of the chkbox is sync_to_me)
             if (!chk_element) {  // if this is the instructor there won't be a navigation_locked indicator
                 return;
             }
             if (use_chk_status) {
                 locked = chk_element.attr("checked");
             } else {
                 locked = JSON.parse(msg_parts[1]);
             }
             if (locked) {
                chk_element.attr("checked", locked);
                btn_element.attr("disabled", true);
                // disable internal links
                //var internal_links = $('.slides', this.pres_iframe.get(0).contentWindow.document).find('a')
                var internal_links = $('.slides', this.pres_iframe.get(0).contentWindow.document).find('a').css('pointer-events', 'none').css('color', '#bed3e2');

             } else {
                chk_element.removeAttr("checked");
                btn_element.removeAttr("disabled");
                var internal_links = $('.slides', this.pres_iframe.get(0).contentWindow.document).find('a').css('pointer-events', 'auto').css('color', '#268bd2');
             }
             ILTRevealSession.Reveal.configure({keyboard: !locked, controls: !locked})
         }, 

         handle_do_submit_interaction: function(msg_parts) {
             this.send_response();
         },

        /* END handlers for messages coming from the server */


        /* Functions to send requests to the server. They all start with 'sendreq_' */

         sendreq_start_presentation: function (path) {
            // instructor-only function
            this.send_msg('start_presentation|' + path)
         },

         sendreq_lock_student_nav: function(checked){
            // instructor-only function
            this.send_msg('lock_student_nav|' + JSON.stringify(checked));
         },

         sendreq_lock_follow_instructor: function(checked){
            // instructor-only function
            this.send_msg('lock_follow_instructor|' + JSON.stringify(checked));
         },

         sendreq_sync_to_instructor: function(){
            // same functionality for both, called differently ('sync all with me' for instructor, 'sync to instructor')
            this.send_msg('sync_to_instructor|');
         },

         sendreq_slide_changed: function(ev) {
             // both
             var state = this.Reveal.getState();
             var msg = 'slide_changed|' + JSON.stringify(state) +'|' + JSON.stringify(this.slide_info) ;
             console.log(msg); // todo: remove
             this.send_msg(msg);
         },

         sendreq_finish_presentation: function () {
             var msg = 'finish_presentation|';
             this.send_msg(msg);
         },

         sendreq_force_interaction_submission: function () {
            // instructor-only function
             var msg = 'force_interaction_submission|';
             this.send_msg(msg);
             // disable the button
            $('#force_i_submission').prop("disabled", true);
         },

         sendreq_see_interaction_results: function () {
             // instructor-only function
             var msg = 'see_interaction_results|';
             var confirm_str = "Do you really want to see and share the interaction results? Maybe you want to force submission first!";
             if (!window.confirm(confirm_str)) {
                 return;
             }
             this.send_msg(msg);
             // disable the button
            $('#see_interaction_results').prop("disabled", true);
            $('#force_i_submission').prop("disabled", true);
         }

        /* END Functions to send requests to the server. */

    });  // close the 'return'
})();
