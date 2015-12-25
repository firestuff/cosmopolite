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



/**
 * @constructor
 * @param {Cosmopolite} cosmo
 * @param {string} prefix
 */
var Hogfather = function(cosmo, prefix) {
  this.cosmo_ = cosmo;
  this.prefix_ = prefix;

  console.log(this.loggingPrefix_(), 'create');
};


/**
 * @param {Cosmopolite} cosmo
 * @return {Promise}
 */
Hogfather.Create = function(cosmo) {
  return new Promise(function(resolve, reject) {
    var prefix;
    cosmo.getProfile().then(function(profile_id) {
      prefix = '/hogfather/' + profile_id + '/' + cosmo.uuid() + '/';
      var subject = {
        name: prefix + 'control',
        readable_only_by: 'me',
        writeable_only_by: 'me',
      };
      var msg = {
        owners: [profile_id],
        writers: [profile_id],
        readers: [profile_id],
      };
      return cosmo.sendMessage(subject, msg);
    }).then(function(msg) {
      resolve(new Hogfather(cosmo, prefix));
    }).catch(function(err) {
      reject(err);
    });
  });
};


/**
 */
Hogfather.prototype.shutdown = function() {
};


/**
 * @private
 * @return {string}
 */
Hogfather.prototype.loggingPrefix_ = function() {
  return 'hogfather (' + this.prefix_ + '):';
};
