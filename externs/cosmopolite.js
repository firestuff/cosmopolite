/**
 * @fileoverview Definitions for Cosmopolite API. Details of the API are at:
 * https://www.cosmopolite.org/reference
 *
 * @externs
 * @author ian@cosmopolite.org (Ian Gulliver)
 */

/**
 * @see https://www.cosmopolite.org/reference#callbacks
 * @typedef {{onConnect: (function()|undefined),
 *            onDisconnect: (function()|undefined),
 *            onLogin: (function(string, string)|undefined),
 *            onLogout: (function(string)|undefined),
 *            onMessage: (function(Cosmopolite.typeMessage)|undefined),
 *            onPin: (function(Cosmopolite.typeMessage)|undefined),
 *            onUnpin: (function(Cosmopolite.typeMessage)|undefined)}}
 */
Cosmopolite.typeCallbacks;


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


/** @typedef {(Cosmopolite.typeSubject|string|number)} */
Cosmopolite.typeSubjectLoose;



/**
 * @see https://www.cosmopolite.org/reference#constructor
 * @constructor
 * @param {?Cosmopolite.typeCallbacks=} opt_callbacks
 * @param {?string=} opt_urlPrefix
 * @param {?string=} opt_namespace
 * @param {?string=} opt_trackingID
 * @nosideeffects
 */
function Cosmopolite(
    opt_callbacks, opt_urlPrefix, opt_namespace, opt_trackingID) {}


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
