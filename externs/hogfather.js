/**
 * @fileoverview Definitions for Cosmopolite API. Details of the API are at:
 * https://www.cosmopolite.org/hogfather/reference
 *
 * @externs
 * @author ian@cosmopolite.org (Ian Gulliver)
 */


/* Namespace */
var hogfather = {};


/**
 * @constructor
 * @param {Cosmopolite} cosmo
 * @param {string} id
 * @private
 */
hogfather.PublicChat = function(cosmo, id) {};


/**
 * @param {Cosmopolite} cosmo
 * @return {Promise}
 */
hogfather.PublicChat.Create = function(cosmo) {};


/**
 * @param {Cosmopolite} cosmo
 * @param {string} id
 * @return {Promise}
 */
hogfather.PublicChat.Join = function(cosmo, id) {};


/**
 */
hogfather.PublicChat.prototype.Shutdown = function() {};


/**
 * @return {string}
 * @nosideeffects
 */
hogfather.PublicChat.prototype.getID = function() {};


/**
 * @return {boolean}
 * @nosideeffects
 */
hogfather.PublicChat.prototype.amOwner = function() {};


/**
 * @return {boolean}
 * @nosideeffects
 */
hogfather.PublicChat.prototype.amWriter = function() {};


/**
 * @return {Array.<Cosmopolite.typeMessage>}
 * @nosideeffects
 */
hogfather.PublicChat.prototype.getMessages = function() {};


/**
 * @return {Array.<Cosmopolite.typeMessage>}
 * @nosideeffects
 */
hogfather.PublicChat.prototype.getRequests = function() {};


/**
 * @param {!*} message
 * @return {Promise}
 */
hogfather.PublicChat.prototype.sendMessage = function(message) {};


/**
 * @param {string} info
 * @return {Promise}
 */
hogfather.PublicChat.prototype.requestAccess = function(info) {};


/**
 * @param {string} sender
 * @return {Promise}
 */
hogfather.PublicChat.prototype.addOwner = function(sender) {};


/**
 * @param {string} sender
 * @return {Promise}
 */
hogfather.PublicChat.prototype.addWriter = function(sender) {};


/**
 * @param {string} sender
 * @return {Promise}
 */
hogfather.PublicChat.prototype.denyRequest = function(sender) {};
