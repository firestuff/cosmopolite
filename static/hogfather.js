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

  this.owners_ = [];
  this.writers_ = [];
  this.messages_ = [];
  this.requests_ = [];

  /**
   * @type {DocumentFragment}
   * @private
   * Weep for all our souls.
   */
  this.eventTarget_ = document.createDocumentFragment();
  this.addEventListener =
      this.eventTarget_.addEventListener.bind(this.eventTarget_);
  this.removeEventListener =
      this.eventTarget_.removeEventListener.bind(this.eventTarget_);
  this.dispatchEvent =
      this.eventTarget_.dispatchEvent.bind(this.eventTarget_);

  this.boundOnMessage_ = this.onMessage_.bind(this);
  this.cosmo_.addEventListener('message', this.boundOnMessage_);
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
    chat.Start_().then(function() {
      resolve(chat);
    }).catch(function(err) {
      reject(err);
    });
  });
};


/**
 * @return {Promise}
 * @private
 */
hogfather.PublicChat.prototype.Start_ = function() {
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
 * @return {Promise}
 */
hogfather.PublicChat.prototype.Shutdown = function() {
  console.log(this.loggingPrefix_(), 'shutdown start');
  this.cosmo_.removeEventListener('message', this.boundOnMessage_);
  return this.cosmo_.unsubscribe(this.subject_);
};


/**
 * @return {string}
 */
hogfather.PublicChat.prototype.getID = function() {
  return this.id_;
};


/**
 * @return {boolean}
 */
hogfather.PublicChat.prototype.amOwner = function() {
  return (this.owners_.length == 0 ||
          this.owners_.indexOf(this.cosmo_.currentProfile()) >= 0);
};


/**
 * @return {boolean}
 */
hogfather.PublicChat.prototype.amWriter = function() {
  return (this.amOwner() ||
          this.writers_.indexOf(this.cosmo_.currentProfile()) >= 0);
};


/**
 * @private
 * @param {Cosmopolite.typeMessage} message
 * @param {Array.<string>} owners
 * @param {Array.<string>} writers
 * @return {boolean}
 */
hogfather.PublicChat.prototype.checkMessage_ = function(
    message, owners, writers) {

  // Bootstrapping for new groups
  if (!owners.length) {
    owners.push(message.sender);
  }

  var acl;

  switch (message.message.type) {
    case 'request_access':
      return true;

    case 'add_writer':
    case 'add_owner':
    case 'deny_request':
      acl = owners;
      break;

    case 'message':
      acl = owners.concat(writers);
      break;

    default:
      console.log('Unknown message type:', message);
      return false;
  }

  if (acl.indexOf(message.sender) == -1) {
    console.log(this.loggingPrefix_(), 'message from unauthorized source:',
        message, acl);
    return false;
  } else {
    return true;
  }
};


/**
 * @return {Array.<Cosmopolite.typeMessage>}
 */
hogfather.PublicChat.prototype.getMessages = function() {
  return this.messages_;
};


/**
 * @return {Array.<Cosmopolite.typeMessage>}
 */
hogfather.PublicChat.prototype.getRequests = function() {
  return this.requests_;
};


/**
 * @param {!*} message
 * @return {Promise}
 */
hogfather.PublicChat.prototype.sendMessage = function(message) {
  return new Promise(function(resolve, reject) {
    if (!this.amWriter()) {
      reject(new Error('Write access denied'));
      return;
    }
    resolve(this.cosmo_.sendMessage(this.subject_, {
      type: 'message',
      message: message,
    }));
  }.bind(this));
};


/**
 * @param {string} info
 * @return {Promise}
 */
hogfather.PublicChat.prototype.requestAccess = function(info) {
  return new Promise(function(resolve, reject) {
    if (this.amOwner()) {
      reject(new Error('Already owner'));
      return;
    }
    resolve(this.cosmo_.sendMessage(this.subject_, {
      type: 'request_access',
      info: info,
    }));
  }.bind(this));
};


/**
 * @param {string} sender
 * @return {Promise}
 */
hogfather.PublicChat.prototype.addOwner = function(sender) {
  return new Promise(function(resolve, reject) {
    if (!this.amOwner()) {
      reject(new Error('Owner access denied'));
      return;
    }
    resolve(this.cosmo_.sendMessage(this.subject_, {
      type: 'add_owner',
      sender: sender,
    }));
  }.bind(this));
};


/**
 * @param {string} sender
 * @return {Promise}
 */
hogfather.PublicChat.prototype.addWriter = function(sender) {
  return new Promise(function(resolve, reject) {
    if (!this.amOwner()) {
      reject(new Error('Owner access denied'));
      return;
    }
    resolve(this.cosmo_.sendMessage(this.subject_, {
      type: 'add_writer',
      sender: sender,
    }));
  }.bind(this));
};


/**
 * @param {string} sender
 * @return {Promise}
 */
hogfather.PublicChat.prototype.denyRequest = function(sender) {
  return new Promise(function(resolve, reject) {
    if (!this.amOwner()) {
      reject(new Error('Owner access denied'));
      return;
    }
    resolve(this.cosmo_.sendMessage(this.subject_, {
      type: 'deny_request',
      sender: sender,
    }));
  }.bind(this));
};


/**
 * @private
 * @param {string} sender
 */
hogfather.PublicChat.prototype.removeRequest_ = function(sender) {
  this.requests_ = this.requests_.filter(function(request) {
    return request.sender != sender;
  });
};


/**
 * @private
 * @param {Event} e
 */
hogfather.PublicChat.prototype.onMessage_ = function(e) {
  var message = e.detail;
  if (!this.checkMessage_(message, this.owners_, this.writers_)) {
    return;
  }

  switch (message.message.type) {
    case 'add_owner':
      this.removeRequest_(message.message.sender);
      this.owners_.push(message.message.sender);
      var e2 = new CustomEvent('acl_change', {
        'detail': message,
      });
      this.dispatchEvent(e2);
      break;

    case 'add_writer':
      this.removeRequest_(message.message.sender);
      this.writers_.push(message.message.sender);
      var e2 = new CustomEvent('acl_change', {
        'detail': message,
      });
      this.dispatchEvent(e2);
      break;

    case 'deny_request':
      this.removeRequest_(message.message.sender);
      var e2 = new CustomEvent('request_denied', {
        'detail': message,
      });
      this.dispatchEvent(e2);
      break;

    case 'request_access':
      this.requests_.push(message);
      var e2 = new CustomEvent('request', {
        'detail': message,
      });
      this.dispatchEvent(e2);
      break;

    case 'message':
      var cleanMessage = this.cleanMessage_(message);
      this.messages_.push(cleanMessage);
      var e2 = new CustomEvent('message', {
        'detail': cleanMessage,
      });
      this.dispatchEvent(e2);
      break;
  }
};


/**
 * @private
 * @param {Cosmopolite.typeMessage} message
 * @return {Cosmopolite.typeMessage}
 */
hogfather.PublicChat.prototype.cleanMessage_ = function(message) {
  // Copy message so we can modify it.
  message = /** @type {Cosmopolite.typeMessage} */ (
      JSON.parse(JSON.stringify(message)));
  // message == cosmopolite message
  // message.message = hogfather message
  // message.message.message == application message
  message.message = message.message.message;
  return message;
};


/**
 * @private
 * @return {string}
 */
hogfather.PublicChat.prototype.loggingPrefix_ = function() {
  return 'hogfather (' + this.id_ + '):';
};
