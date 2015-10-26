define(function(require) {

    var Adapt = require('coreJS/adapt');
    var a11y = require('a11y');
    var AccessibilityView = require('coreViews/accessibilityView');

    var Accessibility = _.extend({
        $html: $('html'),
        $accessibilityInstructions: $("#accessibility-instructions"),
        $accessibilityToggle: $("#accessibility-toggle"),

        _tabIndexElements: 'a, button, input, select, textarea, [tabindex]',
        _isButtonRedirectionOn: true,
        _hasUsageInstructionRead: false,
        _isLoaded: false,
        _hasCourseLoaded: false,
        _legacyFocusElements: undefined,

        initialize: function() {
            //RUN ONCE
            if (this._isLoaded) return;

            //TRIGGER SETUP ON DATA LOADED AND TOGGLE BUTTON
            Adapt.once('app:dataLoaded', function() {
                //check if accessibility mode should be restored
                this._hasCourseLoaded = true;
                Adapt.config.get("_accessibility")._isActive = Adapt.offlineStorage.get("a11y") || false;
                this.setupAccessibility();
                
            }, Accessibility);

            Adapt.on('accessibility:toggle', this.setupAccessibility, Accessibility);

            //SETUP RENDERING HELPERS
            Adapt.once('app:dataLoaded', this.setupHelpers, Accessibility);
            Adapt.once('app:dataLoaded', this.touchDeviceCheck, Accessibility);

            //SETUP NEW VIEW FOR TOGGLE BUTTON
            Adapt.once('app:dataReady', this.setupToggleButton, this);

            //SETUP NO SELECT PARAMETERS ON DEVICE CHANGE
            Adapt.on("device:changed", this.setupNoSelect);

            //Configure the accessibility library
            this.listenToOnce(Adapt, "app:dataReady", this.configureA11yLibrary)

            //CAPTURE ROUTING/NEW DOCUMENT LOADING START AND END
            this.listenTo(Adapt, 'router:location', this.onNavigationStart);
            this.listenTo(Adapt, 'pageView:ready menuView:ready router:plugin', this.onNavigationEnd);
        },

        setupAccessibility: function() {
            //CALLED ON BUTTON CLICK AND ON DATA LOAD
            if (!this.isEnabled()) return;

            if (this._hasCourseLoaded) {
                //save accessibility state
                Adapt.offlineStorage.set("a11y", Adapt.config.get("_accessibility")._isActive);
            }

            if (!this.isEnabled()) return;

            this.checkTabCapture();

            // Check if accessibility is active
            if (this.isActive()) {

                this.onNavigationEnd();
                this.setupDocument();
                this.setupLegacy();
                this.setupPopupListeners()
                this.setupUsageInstructions();
                this.setupLogging();
                this.focusInitial();

            } else {

                this.revertDocument();
                this.revertLegacy();
                this.revertPopupListeners();
                this.revertUsageInstructions();
                this.revertLogging();

            }

        },

        setupHelpers: function() {

            //MAKE $.a11y_text and $.a11y_normalize IN GLOBAL HANDLEBARS HELPERS a11y_text and a11y_normalize
            var config = Adapt.config.has('_accessibility')
                ? Adapt.config.get("_accessibility")
                : false;

            Handlebars.registerHelper('a11y_text', function(text) {
                //ALLOW ENABLE/DISABLE OF a11y_text HELPER
                if (config && config._isTextProcessorEnabled === false) {
                    return text;
                } else {
                    return $.a11y_text(text);
                }
            });

            Handlebars.registerHelper('a11y_normalize', function(text) {
                return $.a11y_normalize(text);
            });

        },

        setupToggleButton: function() {
            if (this.isEnabled()) {
                new AccessibilityView();
            } else {
                this.$accessibilityToggle.addClass("a11y-ignore").a11y_cntrl_enabled(false);
            }
        },

        setupNoSelect: function() {
            if (!Adapt.config.get('_accessibility') || !Adapt.config.get('_accessibility')._disableTextSelectOnClasses) return;

            var classes = Adapt.config.get('_accessibility')._disableTextSelectOnClasses.split(" ");

            var isMatch = false;
            for (var i = 0, item; item = classes[i++];) {
                if ($('html').is(item)) {
                    isMatch = true;
                    break;
                }
            }

            if (isMatch) {
                $('html').addClass("no-select");
            } else  {
                $('html').removeClass("no-select");
            }

        },

        configureA11yLibrary: function() {

            var topOffset = $('.navigation').height()+10;
            var bottomoffset = 0;
            $.a11y.options.focusOffsetTop = topOffset;
            $.a11y.options.focusOffsetBottom = bottomoffset;
            $.a11y.options.OS = Adapt.device.OS.toLowerCase();
            $.a11y.options.isTouchDevice = Modernizr.touch;

            if (this.isActive()) {
                _.extend($.a11y.options, {
                    isTabbableTextEnabled: true,
                    isUserInputControlEnabled: true,
                    isFocusControlEnabled: true,
                    isFocusLimited: true,
                    isRemoveNotAccessiblesEnabled: true,
                    isAriaLabelFixEnabled: true,
                    isFocusWrapEnabled: true,
                    isScrollDisableEnabled: true,
                    isScrollDisabledOnPopupEnabled: false,
                    isSelectedAlertsEnabled: true,
                    isAlertsEnabled: true
                });
            } else {
                _.extend($.a11y.options, {
                    isTabbableTextEnabled: false,
                    isUserInputControlEnabled: true,
                    isFocusControlEnabled: true,
                    isFocusLimited: false,
                    isRemoveNotAccessiblesEnabled: true,
                    isAriaLabelFixEnabled: true,
                    isFocusWrapEnabled: true,
                    isScrollDisableEnabled: true,
                    isScrollDisabledOnPopupEnabled: false,
                    isSelectedAlertsEnabled: false,
                    isAlertsEnabled: false
                });
            }

            this.setupNoSelect();

            $.a11y.ready();

            if (!this.isEnabled()) return;

            //CAPTURE TAB PRESSES TO DIVERT
            $('body').off('keyup', this.onKeyUp);
            $('body').on('keyup', this.onKeyUp);
        },

        onNavigationStart: function() {
            this._isLoaded = false;
            //STOP DOCUMENT READING, MOVE FOCUS TO APPROPRIATE LOCATION
            $("#a11y-focuser").focusNoScroll();
            $.a11y_on(false, '#wrapper');
        },

        onNavigationEnd: function() {
            //always use detached aria labels for divs and spans
            _.defer(function() {
                $('body').a11y_aria_label(true);
            });

            this._isLoaded = true;

            if (!this.isActive()) {
                this.touchDeviceCheck();
            }

            this.configureA11yLibrary();
            $.a11y_update();
            this.setNavigationBar();

            //MAKE FOCUS RIGHT
            this._isButtonRedirectionOn = true;
            this.focusInitial();

        },

        setNavigationBar: function() {
            if (this.isActive()) {
                $(".navigation .aria-label").attr("tabindex", 0).removeAttr("aria-hidden");
            } else {
                $(".navigation .aria-label").attr("tabindex", -1).attr("aria-hidden", "true");
            }
        },

        touchDeviceCheck: function() {
            //SCREEN READER DON@T USE TABBING
            //FORCE ACCESSIBILITY ON TO RENDER NECESSARY STUFFS FOR TOUCH DEVICE SCREENREADERS
            if (!this.isEnabled()) return;
            if (!Modernizr.touch || this.isActive()) return;

            //If a touch device and not enabled, remove accessibility button and turn on accessibility

            this._isLoaded = true;

             //Remove button
            this.$accessibilityToggle.remove();

            //Force accessibility on
            Adapt.config.get('_accessibility')._isEnabled = true;
            Adapt.config.get('_accessibility')._isActive = true;

            Adapt.trigger('accessibility:toggle', true);

        },

        checkTabCapture: function() {
            if (!this._isLoaded) return;

            var isActive = this.isActive();

            $.a11y(isActive);

            if (isActive) {

                //IF ACCESSIBILTY TURNED ON GOTO FIRST FOCUSABLE ITEM
                this.focusInitial();

            } else {

                //OTHERWISE ENABLE TAB REDIRECTION TO TOGGLE BUTTON
                this._isButtonRedirectionOn = true;
            }
        },

        isActive: function() {
            return Adapt.config.has('_accessibility')
                && Adapt.config.get('_accessibility')._isEnabled
                && Adapt.config.get('_accessibility')._isActive;
        },

        isEnabled: function() {
            return Adapt.config.has('_accessibility')
                && Adapt.config.get('_accessibility')._isEnabled
        },

        setupDocument: function() {
            this.$html.addClass('accessibility');
            $.a11y(true)
            $.a11y_on(true, "body > *");
        },

        setupLegacy: function() {
            //IE8 .focused CLASS AS :focus ISN'T AVAILABLE

            if(!this.$html.hasClass('ie8') || !Adapt.config.get('_accessibility')._shouldSupportLegacyBrowsers) return;

            // If legacy enabled run setupLegacyListeners()
            this.listenTo(Adapt, 'pageView:ready menuView:ready', this.setupLegacyFocusClasser);
            this.listenTo(Adapt, 'remove', this.removeLegacyFocusClasser);

        },

        setupLegacyFocusClasser: function() {
            this.removeLegacyFocusClasser();

            // On focus add class of focused, on blur remove class
            this._legacyFocusElements = $(this._tabIndexElements);
            this._legacyFocusElements
                .on('focus', this.onElementFocused)
                .on('blur', this.onElementBlurred);
        },

        setupPopupListeners: function() {
            this.listenTo(Adapt, 'popup:opened popup:closed', this.onPop);
        },


        setupUsageInstructions: function() {
            if (!Adapt.course.get("_globals")._accessibility || !Adapt.course.get("_globals")._accessibility._accessibilityInstructions) {
                this.$accessibilityInstructions.remove();
                return;
            }

            var instructionsList = Adapt.course.get("_globals")._accessibility._accessibilityInstructions;

            var usageInstructions;
            if (instructionsList[Adapt.device.browser]) {
                usageInstructions = instructionsList[Adapt.device.browser];
            } else if (Modernizr.touch) {
                usageInstructions = instructionsList.touch || "";
            } else {
                usageInstructions = instructionsList.notouch || "";
            }

           this.$accessibilityInstructions
                .one("blur", this.onFocusInstructions)
                .html( usageInstructions );
        },

        setupLogging: function() {
            if (!Adapt.config.get("_accessibility") || !Adapt.config.get("_accessibility")._logReading) return;

            $(document).on("reading", this.onRead);
        },



        revertDocument: function() {
            this.$html.removeClass('accessibility');
            $.a11y(false)
            $.a11y_on(false, "body > *");
            $.a11y_on(true, "#accessibility-toggle");
        },

        revertLegacy: function() {

            if(!this.$html.hasClass('ie8') || !Adapt.config.get('_accessibility')._shouldSupportLegacyBrowsers) return;

            this.stopListening(Adapt, 'pageView:ready menuView:ready', this.setupLegacyFocusClasser);
            this.stopListening(Adapt, 'remove', this.removeLegacyFocusClasser);

        },

        removeLegacyFocusClasser: function() {
            if (this._legacyFocusElements === undefined) return;

            //Remove focus and blur events
            this._legacyFocusElements
                .off('focus', this.onElementFocused)
                .off('blur', this.onElementBlurred);
            this._legacyFocusElements = undefined;
        },


        revertPopupListeners: function() {
            this.stopListening(Adapt, 'popup:opened popup:closed', this.onPop);
        },

        revertUsageInstructions: function() {
            if (Adapt.course.has("_globals") && (!Adapt.course.get("_globals")._accessibility || !Adapt.course.get("_globals")._accessibility._accessibilityInstructions)) return;

            this.$accessibilityInstructions
                .off("blur", this.onFocusInstructions)
        },

        revertLogging: function() {
            if (Adapt.course.has("_globals") && (!Adapt.course.get("_globals")._accessibility || !Adapt.course.get("_globals")._accessibility._logReading)) return;

            $($.a11y).off("reading", this.onRead);
        },


        focusInitial: function() {
            if (!this.isActive()) return;

            this._isButtonRedirectionOn = false;

            _.delay(_.bind(function() {
                //ENABLED DOCUMENT READING
                $.a11y_on(true, '#wrapper');

                if (!this._hasUsageInstructionRead) {

                    $("#accessibility-instructions").focusNoScroll();

                    this._hasUsageInstructionRead = true;

                } else {

                    if (Adapt.location._currentId) {
                        //required to stop JAWS from auto reading content in IE
                        var currentModel = Adapt.findById(Adapt.location._currentId);
                        var alertText = " ";

                        switch (currentModel.get("_type")) {
                            case "page":
                                if (Adapt.course.has("_globals")._accessibility && Adapt.course.get("_globals")._accessibility._ariaLabels && Adapt.course.get("_globals")._accessibility._ariaLabels.pageLoaded) {
                                    alertText = Adapt.course.get("_globals")._accessibility._ariaLabels.pageLoaded;
                                }
                                break;

                            case "menu":
                            default:
                                if (Adapt.course.has("_globals")._accessibility && Adapt.course.get("_globals")._accessibility._ariaLabels && Adapt.course.get("_globals")._accessibility._ariaLabels.menuLoaded) {
                                    alertText = Adapt.course.get("_globals")._accessibility._ariaLabels.menuLoaded;
                                }
                                break;
                        }

                        $.a11y_alert(alertText);
                    }

                     _.delay(function() {
                        var windowScrollTop = $(window).scrollTop();
                        var documentScrollTop = $(document).scrollTop();

                        //prevent auto scrolling to top when scroll has been initiated
                        if (windowScrollTop > 0 || documentScrollTop > 0) return;

                        $.a11y_focus();

                    }, 250);

                }

            }, this), 1000);

        },

        onElementFocused: function(event) {
             $(this).addClass('focused');
        },

        onElementBlurred: function(event) {
            $(this).removeClass('focused');
        },

        onRead: function(event, text) {
            //OUTPUT READ TEXT TO CONSOLE
            console.log("READING: " + text);
        },

        onPop: function() {
            //MAKE SURE POPUP IS CONFIGURED CORRECTLY WITH ARIA LABELS, TABINDEXES ETC
            if (this.isActive()) {
                $.a11y_update();
            }
        },

        onKeyUp: function(event) {

            //IF NOT TAB KEY, RETURN
            if (event.which !== 9) return;

            //DO NOT REDIRECT IF USER HAS ALREADY INTERACTED
            if ($.a11y.userInteracted) return;

            //IF INITIAL TAB NOT CAPTURED AND ACCESSIBILITY NOT ON, RETURN
            if (Accessibility.isActive() && !Accessibility._isButtonRedirectionOn) return;

            //IF TAB PRESSED, AND TAB REDIRECTION ON, ALWAYS TAB TO ACCESSIBILITY BUTTON ONLY
            Accessibility.$accessibilityToggle.focus();

        },

        onFocusInstructions: function(event) {
            //HIDE INSTRUCTIONS FROM TAB WRAP AROUND AFTER LEAVING INSTRUCTIONS
            if (Accessibility._isButtonRedirectionOn) return;
            if (!Accessibility._isLoaded) return;
            $(event.target).addClass("a11y-ignore-focus");
        }

    }, Backbone.Events);


    Accessibility.initialize();

});
