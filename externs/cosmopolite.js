/**
 * @fileoverview Definitions for Cosmopolite API. Details of the API are at:
 * https://www.cosmopolite.org/reference
 *
 * @externs
 * @author ian@cosmopolite.org (Ian Gulliver)
 */

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
