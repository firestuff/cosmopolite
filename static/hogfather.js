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
 * @param {string} name
 */
var Hogfather = function(cosmo, name) {
  this.cosmo_ = cosmo;
  this.name_ = name;

  this.cosmo_.getProfile().then(this.onProfile_.bind(this));
};


/**
 * @param {string} profile_id
 */
Hogfather.prototype.onProfile_ = function(profile_id) {
  this.prefix_ = '/hogfather/' + profile_id + '/' + this.name_ + '/';
  this.cosmo_.subscribe(this.prefix_ + 'control');
  console.log(this.prefix_);
};


/**
 */
Hogfather.prototype.shutdown = function() {
};
