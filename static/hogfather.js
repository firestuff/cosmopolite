/**
 * @license
 * Copyright 2015, Ian Gulliver
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */



// Namespace
var hogfather = {};



/**
 * @constructor
 * @param {Cosmopolite} cosmo
 * @param {string} id
 */
hogfather.PublicChat = function(cosmo, id) {
  this.cosmo_ = cosmo;
  this.id_ = id;
  this.subject_ = '/hogfather/public/' + id;
};


/**
 * @param {Cosmopolite} cosmo
 * @return {Promise}
 */
hogfather.PublicChat.Create = function(cosmo) {
  var id = cosmo.uuid();
  return hogfather.PublicChat.Join(cosmo, id);
};


/**
 * @param {Cosmopolite} cosmo
 * @param {string} id
 * @return {Promise}
 */
hogfather.PublicChat.Join = function(cosmo, id) {
  return new Promise(function(resolve, reject) {
    var chat = new hogfather.PublicChat(cosmo, id);
    chat.Start().then(function() {
      resolve(chat);
    }).catch(function(err) {
      reject(err);
    });
  });
};


/**
 * @return {Promise}
 */
hogfather.PublicChat.prototype.Start = function() {
  return new Promise(function(resolve, reject) {
    this.cosmo_.subscribe(this.subject_, -1).then(function() {
      console.log(this.loggingPrefix_(), 'ready');
      resolve();
    }.bind(this)).catch(function(err) {
      reject(err);
    });
  }.bind(this));
};


/**
 */
hogfather.PublicChat.prototype.Shutdown = function() {
};


hogfather.PublicChat.prototype.getID = function() {
  return this.id_;
};


/**
 * @private
 * @return {string}
 */
hogfather.PublicChat.prototype.loggingPrefix_ = function() {
  return 'hogfather (' + this.id_ + '):';
};
