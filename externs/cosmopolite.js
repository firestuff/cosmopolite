/**
 * @fileoverview Definitions for Cosmopolite API. Details of the API are at:
 * https://www.cosmopolite.org/reference
 *
 * @externs
 * @author ian@cosmopolite.org (Ian Gulliver)
 */



/**
 * @return {number}
 */
String.prototype.hashCode = function() {};



/**
 * @see https://www.cosmopolite.org/reference#message
 * @typedef {{event_type: string,
 *            id: number,
 *            created: number,
 *            sender: string,
 *            subject: Cosmopolite.typeSubject,
 *            message: *}}
 */
Cosmopolite.typeMessage;


/**
 * @see https://www.cosmopolite.org/reference#subject
 * @typedef {{name: string,
 *            readable_only_by: (string|undefined),
 *            writable_only_by: (string|undefined)}}
 */
Cosmopolite.typeSubject;


/**
 * @see https://www.cosmopolite.org/reference#subject
 * @typedef {(Cosmopolite.typeSubject|string|number)}
 */
Cosmopolite.typeSubjectLoose;



/**
 * @see https://www.cosmopolite.org/reference#constructor
 * @constructor
 * @param {?string=} opt_urlPrefix
 * @param {?string=} opt_namespace
 * @param {?string=} opt_trackingID
 * @nosideeffects
 */
function Cosmopolite(opt_urlPrefix, opt_namespace, opt_trackingID) {}


/**
 * @see https://www.cosmopolite.org/reference#shutdown
 */
Cosmopolite.prototype.shutdown = function() {};


/**
 * @see https://www.cosmopolite.org/reference#connected
 * @return {boolean}
 * @nosideeffects
 */
Cosmopolite.prototype.connected = function() {};


/**
 * @see https://www.cosmopolite.org/reference#getProfile
 * @return {Promise}
 * @nosideeffects
 */
Cosmopolite.prototype.getProfile = function() {};


/**
 * @see https://www.cosmopolite.org/reference#currentProfile
 * @const
 * @nosideeffects
 */
Cosmopolite.prototype.currentProfile = function() {};


/**
 * @see https://www.cosmopolite.org/reference#subscribe
 * @param {Cosmopolite.typeSubjectLoose|Array.<Cosmopolite.typeSubjectLoose>}
 *     subjects
 * @param {?number=} opt_messages
 * @param {?number=} opt_lastID
 * @return {Promise|Array.<Promise>}
 */
Cosmopolite.prototype.subscribe =
  function(subjects, opt_messages, opt_lastID) {};


/**
 * @see https://www.cosmopolite.org/reference#unsubscribe
 * @param {Cosmopolite.typeSubjectLoose} subject
 * @return {Promise}
 */
Cosmopolite.prototype.unsubscribe = function(subject) {};


/**
 * @see https://www.cosmopolite.org/reference#sendMessage
 * @param {Cosmopolite.typeSubjectLoose} subject
 * @param {!*} message
 * @return {Promise}
 */
Cosmopolite.prototype.sendMessage = function(subject, message) {};


/**
 * @see https://www.cosmopolite.org/reference#getMessages
 * @param {Cosmopolite.typeSubjectLoose} subject
 * @return {Array.<Cosmopolite.typeMessage>}
 * @const
 * @nosideeffects
 */
Cosmopolite.prototype.getMessages = function(subject) {};


/**
 * @see https://www.cosmopolite.org/reference#getLastMessage
 * @param {Cosmopolite.typeSubjectLoose} subject
 * @return {?Cosmopolite.typeMessage}
 * @const
 * @nosideeffects
 */
Cosmopolite.prototype.getLastMessage = function(subject) {};


/**
 * @see https://www.cosmopolite.org/reference#pin_method
 * @param {Cosmopolite.typeSubjectLoose} subject
 * @param {!*} message
 * @return {Promise}
 */
Cosmopolite.prototype.pin = function(subject, message) {};


/**
 * @see https://www.cosmopolite.org/reference#unpin
 * @param {string} id
 * @return {Promise}
 */
Cosmopolite.prototype.unpin = function(id) {};


/**
 * @see https://www.cosmopolite.org/reference#getPins
 * @param {Cosmopolite.typeSubjectLoose} subject
 * @return {Array.<Cosmopolite.typeMessage>}
 * @const
 * @nosideeffects
 */
Cosmopolite.prototype.getPins = function(subject) {};


/**
 * @see https://www.cosmopolite.org/reference#trackEvent
 * @param {...*} var_args
 */
Cosmopolite.prototype.trackEvent = function(var_args) {};


/**
 * @see https://www.cosmopolite.org/reference#uuid
 * @return {string}
 * @const
 * @nosideeffects
 */
Cosmopolite.prototype.uuid = function() {};
