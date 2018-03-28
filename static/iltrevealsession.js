var ILTRevealSession = window.ILTRevealSession || (function(){

    return ( {

        pres_iframe: null,
        Reveal: null,
        slide_info: { previous_slide: {title: null, indexh: null, indexv: null}, current_slide: {title: null, indexh: null, indexv: null} },

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

            _.bindAll(this, 'receive_message','on_presentation_loaded','on_slide_changed');
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
         }

        /* END Functions to send requests to the server. */

    });  // close the 'return'
})();
