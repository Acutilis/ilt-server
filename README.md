# ilt-server 

This is a Work In Progress.

Prototype server and client side apps that implement synchronous multiuser usage of a RevealJS presentation. One user is supposed to be the instructor, and the rest are considered students. The instructor has these capabilities:

- start presentation: loads the RevealJS presentation
- lock student navigation: allow or disallow students to navigate freely.
- force 'follow me' mode: in this mode,  when the instructor navigates in the presentation, all the students' presentations navigate automatically to the same slide.
- 'sync all with me': brings all the student's presentations to the current instructor slide.
- finish presentation: remove the presentation from everybody's screen (not very functional now, but required if we want to allow more than one presentation available).

At this point, only the basic infrastructure and functionality are implemented.


## Background

This code was developed initially in the context of [Torrance Learning's xAPI Cohort](https://www.torrancelearning.com/xapi-cohort/), spring 2018, for the project established by team-ilt-xapi.


## Usage

The server code is developed with the Python Tornado server, so Tornado is required to run it. I recommend using virtual environments (or a Conda environment, if you use Anaconda or Miniconda).

Tornado can be installed with:

```
pip install tornado
```

By default the server will be run on `localhost`, port 8888.

To test, open up at least two browser windows, and go to `localhost:8888`. Enter a nickname to 'join the session'. The first user to join will be given the role of instructor.

## xAPI

The `lrs_config.json` file contains information for the LRSs. Please note that it's an array. It has only one object (one LRS). You can put more objects in the array, but they will be ignored (the idea was to implement multiple LRS functionality but, probably we won't do it for now).
The config object for an LRS admits the attribute `active`, which can be set to `true` or `false`. When it is `false`, the statements will not be sent to the LRS. Useful during development.

### Statements
Here are the statements, expressed in plain language, that the system sends:

Note: 'participant' means any participant, instructor or student. 'sysadmin' is a 'virtual/unknown user', in a way; it's just whoever starts and stops the server app.
- sysadmin started session
- sysadmin ended session
- participant joined session
- participant left session
- participant initialized presentation
- participant attempted slide
- participant completed slide
- participant interacted with presentation. 'Interacted' is a general verb used to indicate that the participant has used one of the controls in the control panel. The result of the interaction is that a setting has been changed, or a request for something has been made. So, when the instructor lock or unlocks student navigation, this statement is sent. The information about what setting has been affected and how is included in the 'result.extensions' of the statement. 

Navigation (going to another slide) triggers **two** statements: 'completed (the previous slide)' (obviously this doesn't happen for the first slide), and 'attempted' (in the sense of 'arrived at') the new slide.

### Verbs and IRIs
The choice of verbs is not set in stone. I needed to choose something so I could move on, but this area is open for discussion.

Also, the choice of custom IRIs could change. If this project -or the interest it generates- ever moves beyond the prototype/proof of concept phase, the right thing to do would be to develop a Community of Practice around ILT-xAPI, and come up with a profile. As part of that effort, verbs, activity types, extensions, etc. would have to be chosen much more carefully.

## Monitor

The route `localhost:8888/monitor` shows a page with information about the session. This information is updated in real time, so no need to refresh the page or anything.
Right now it only shows the number of participants and the number of statements generated (even if they are not sent to the LRS). Very little info, but the basic mechanics are implemented in the code, and it's pretty easy to add more parameters to be monitored and/or implement better visualizations on the client side of the monitor.
