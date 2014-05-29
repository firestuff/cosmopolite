/**
 * @license
 * Copyright 2014, Ian Gulliver
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
 * Java-compatible hash calculation
 *
 * We use long keys in many places. Provide a method to trim those down for
 * human readability.
 *
 * @return {number}
 * @const
 */
String.prototype.hashCode = function() {
  /** @type {number} */
  var hash = 0;
  for (i = 0; i < this.length; i++) {
    var char = this.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
};

/* Exposed types */

/** @typedef {{name: string,
               readable_only_by: (string|undefined),
               writable_only_by: (string|undefined)}} */
var typeSubject;

/** @typedef {(typeSubject|string|number)} */
var typeSubjectLoose;

/** @typedef {{event_type: string,
               id: number,
               created: number,
               sender: string,
               subject: typeSubject,
               message: *}} */
var typeMessage;

/** @typedef {{event_type: string,
               profile: string,
               google_user: string}} */
var typeLogin;

/** @typedef {{event_type: string,
               profile: string}} */
var typeLogout;

/** @typedef {{onConnect: (function()|undefined),
               onDisconnect: (function()|undefined),
               onLogin: (function(string, string)|undefined),
               onLogout: (function(string)|undefined),
               onMessage: (function(typeMessage)|undefined),
               onPin: (function(typeMessage)|undefined),
               onUnpin: (function(typeMessage)|undefined)}} */
var typeCallbacks;

/* Internal-only types */

/** @typedef {{event_type: string}} */
var typeEvent;

/** @typedef {{messages: Array.<typeMessage>,
               pins: Array.<typeMessage>,
               state: Cosmopolite.SubscriptionState_}} */
var typeSubscription;

/** @typedef {{command: string,
               arguments: Object,
               onSuccess: (function(Object)|null|undefined)}} */
var typeRPC;


/**
 * @constructor
 * @param {?typeCallbacks=} callbacks
 * @param {?string=} urlPrefix
 * @param {?string=} namespace
 */
var Cosmopolite = function(callbacks, urlPrefix, namespace) {
  /**
   * @type {typeCallbacks}
   * @private
   */
  this.callbacks_ = callbacks || /** @type {typeCallbacks} */ ({});
  /**
   * @type {string}
   * @private
   */
  this.urlPrefix_ = urlPrefix || '/cosmopolite';
  /**
   * @type {string}
   * @private */
  this.namespace_ = namespace || 'cosmopolite';

  /**
   * @type {Cosmopolite.ChannelState_}
   * @private
   */
  this.channelState_ = Cosmopolite.ChannelState_.CLOSED;
  /**
   * @type {boolean}
   * @private
   */
  this.shutdown_ = false;

  /**
   * @type {Array.<Object>}
   * @private
   */
  this.rpcQueue_ = [];
  /**
   * @type {Object.<string, typeSubscription>}
   * @private
   */
  this.subscriptions_ = {};
  /**
   * @type {Object.<string, typeMessage>}
   * @private
   */
  this.pins_ = {};
  /**
   * @type {Array.<function(string)>}
   * @private
   */
  this.profilePromises_ = [];

  /**
   * @type {string}
   * @private
   */
  this.messageQueueKey_ = this.namespace_ + ':message_queue';
  if (this.messageQueueKey_ in localStorage) {
    /** @type {Array.<typeMessage>} */
    var messages = /** @type {Array.<typeMessage>} */
      (JSON.parse(localStorage[this.messageQueueKey_]));
    if (messages.length) {
      console.log(
          this.loggingPrefix_(), '(re-)sending queued messages:', messages);
    }
    messages.forEach(function(message) {
      // We don't use sendMessage because we need to preserve the first
      // message's client_message_id, which is intentionally not exposed via
      // the sendMessage API
      this.sendRPC_(
        'sendMessage', message,
        this.onMessageSent_.bind(this, message, null, null));
    }, this);
  } else {
    localStorage[this.messageQueueKey_] = JSON.stringify([]);
  }

  /** @type {Array.<string>} */
  var scriptUrls = [
    '/_ah/channel/jsapi',
  ];
  /**
   * @type {number}
   * @private
   */
  this.numScriptsToLoad_ = scriptUrls.length;
  scriptUrls.forEach(function(scriptUrl) {
    /** @type {Node} */
    var script = document.createElement('script');
    script.src = scriptUrl;
    script.onload = this.onLoad_.bind(this);
    document.body.appendChild(script);
  }, this);
};


/**
 * Channel states
 * @enum {number}
 * @private
 */
Cosmopolite.ChannelState_ = {
  // No channel open, no RPC pending
  CLOSED: 1,
  // No channel open, RPC pending
  PENDING: 2,
  // RPC complete, channel opening
  OPENING: 3,
  // Channel opened
  OPEN: 3,
};


/**
 * Subscription states
 * @enum {number}
 * @private
 */
Cosmopolite.SubscriptionState_ = {
  PENDING: 1,
  ACTIVE: 2,
};


/**
 * Shutdown this instance.
 *
 * No callbacks will fire after this returns.
 */
Cosmopolite.prototype.shutdown = function() {
  console.log(this.loggingPrefix_(), 'shutdown');
  this.shutdown_ = true;
  if (this.socket_) {
    this.socket_.close();
  }
  if (this.messageHandler_) {
    window.removeEventListener('message', this.messageHandler_);
  }
};

/**
 * Subscribe to a subject.
 *
 * Start receiving messages sent to this subject via the onMessage callback.
 *
 * @param {typeSubjectLoose} subject
 * @param {?number=} messages Number of recent messages to request;
 *     0 for none, -1 for all
 * @param {?number=} last_id ID of last message received; fetch messages since
 * @return {Promise}
 */
Cosmopolite.prototype.subscribe = function(subject, messages, last_id) {
  return new Promise(function(resolve, reject) {
    /** @type {typeSubject} */
    var canonicalSubject = this.canonicalSubject_(subject);
    /** @type {string} */
    var subjectString = JSON.stringify(canonicalSubject);
    if (!(subjectString in this.subscriptions_)) {
      this.subscriptions_[subjectString] = {
        'messages': [],
        'pins': [],
        'state': Cosmopolite.SubscriptionState_.PENDING,
      };
    }

    var args = {
      'subject': canonicalSubject,
    };
    if (messages) {
      args['messages'] = messages;
    }
    if (last_id != null) {
      args['last_id'] = last_id;
    }

    this.sendRPC_('subscribe', args, function(response) {
      // unsubscribe may have been called since we sent the RPC. That's racy
      // without waiting for the promise, but do our best
      if (subjectString in this.subscriptions_) {
        this.subscriptions_[subjectString].state =
          Cosmopolite.SubscriptionState_.ACTIVE;
      }
      /** @type {string} */
      var result = response['result'];
      if (result == 'ok') {
        resolve();
      } else {
        reject();
      }
    });
  }.bind(this));
};

/**
 * Unsubscribe from a subject and destroy all listeners.
 *
 * Note that no reference counting is done, so a single call to unsubscribe()
 * undoes multiple calls to subscribe().
 *
 * @param {typeSubjectLoose} subject
 * @return {Promise}
 */
Cosmopolite.prototype.unsubscribe = function(subject) {
  return new Promise(function(resolve, reject) {
    /** @type {typeSubject} */
    var canonicalSubject = this.canonicalSubject_(subject);
    /** @type {string} */
    var subjectString = JSON.stringify(canonicalSubject);
    delete this.subscriptions_[subjectString];
    var args = {
      'subject': canonicalSubject,
    };
    this.sendRPC_('unsubscribe', args, resolve);
  }.bind(this));
};

/**
 * Post a message to the given subject, storing it and notifying all listeners.
 *
 * @param {typeSubjectLoose} subject
 * @param {!*} message
 * @return {Promise}
 */
Cosmopolite.prototype.sendMessage = function(subject, message) {
  return new Promise(function(resolve, reject) {
    var args = {
      'subject': this.canonicalSubject_(subject),
      'message': JSON.stringify(message),
      'sender_message_id': this.uuid_(),
    };

    // No message left behind.
    var messageQueue = JSON.parse(localStorage[this.messageQueueKey_]);
    messageQueue.push(args);
    localStorage[this.messageQueueKey_] = JSON.stringify(messageQueue);

    this.sendRPC_(
      'sendMessage', args,
      this.onMessageSent_.bind(this, args, resolve, reject));
  }.bind(this));
};

/**
 * Fetch all received messages for a subject
 *
 * @param {typeSubjectLoose} subject
 * @return {Array.<typeMessage>}
 * @const
 */
Cosmopolite.prototype.getMessages = function(subject) {
  /** @type {typeSubject} */
  var canonicalSubject = this.canonicalSubject_(subject);
  /** @type {string} */
  var subjectString = JSON.stringify(canonicalSubject);
  return this.subscriptions_[subjectString].messages;
};

/**
 * Fetch the most recent message for a subject
 *
 * @param {typeSubjectLoose} subject
 * @return {?typeMessage}
 * @const
 */
Cosmopolite.prototype.getLastMessage = function(subject) {
  /** @type {Array.<typeMessage>} */
  var messages = this.getMessages(subject);
  if (messages.length) {
    return messages[messages.length - 1];
  } else {
    return null;
  }
};

/**
 * Fetch all current pins for a subject
 *
 * @param {typeSubjectLoose} subject
 * @return {Array.<typeMessage>}
 * @const
 */
Cosmopolite.prototype.getPins = function(subject) {
  /** @type {typeSubject} */
  var canonicalSubject = this.canonicalSubject_(subject);
  /** @type {string} */
  var subjectString = JSON.stringify(canonicalSubject);
  return this.subscriptions_[subjectString].pins;
};

/**
 * Fetch our profile ID.
 *
 * @return {Promise}
 */
Cosmopolite.prototype.getProfile = function() {
  return new Promise(function(resolve, reject) {
    if (this.profile_) {
      resolve(this.profile_);
    } else {
      this.profilePromises_.push(resolve);
    }
  }.bind(this));
};

 /**
 * Return our current profile ID, if known.
 *
 * @return {?string} Profile ID.
 * @const
 */
Cosmopolite.prototype.currentProfile = function() {
  return this.profile_;
};

/**
 * Pin a message to the given subject, storing it and notifying all listeners.
 *
 * The message is deleted on unpin() or when we disconnect.
 *
 * The resulting Promise resolve callback is passed an ID that can later be
 * passed to unpin().
 *
 * @param {typeSubjectLoose} subject Subject name or object
 * @param {!*} message
 * @return {Promise}
 */
Cosmopolite.prototype.pin = function(subject, message) {
  return new Promise(function(resolve, reject) {
    /** @type {string} */
    var id = this.uuid_();
    var args = {
      'subject': this.canonicalSubject_(subject),
      'message': JSON.stringify(message),
      'sender_message_id': id,
    };


    this.sendRPC_('pin', args, function() {
      this.pins_[id] = args;
      resolve(id);
    });
  }.bind(this));
};

/**
 * Unpin a message from the given subject, storing it and notifying listeners.
 *
 * @param {string} id ID returned by pin()'s resolve callback
 * @return {Promise}
 */
Cosmopolite.prototype.unpin = function(id) {
  return new Promise(function(resolve, reject) {
    var pin = this.pins_[id];
    var args = {
      'subject': pin['subject'],
      'sender_message_id': pin['sender_message_id'],
    };

    delete this.pins_[id];

    this.sendRPC_('unpin', args, resolve);
  }.bind(this));
};

/**
 * Generate a string identifying us to be included in log messages.
 *
 * @return {string} Log line prefix.
 * @const
 * @private
 */
Cosmopolite.prototype.loggingPrefix_ = function() {
  if (this.instanceID_) {
    return 'cosmopolite (' + this.namespace_ + ' / ' + this.instanceID_ + '):';
  } else {
    return 'cosmopolite (' + this.namespace_ + '):';
  }
};

/**
 * Generate a v4 UUID.
 *
 * @return {string} A universally-unique random value.
 * @const
 * @private
 */
Cosmopolite.prototype.uuid_ = function() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    /** @type {number} */
    var r = (Math.random() * 16) | 0;
    if (c == 'x') {
      return r.toString(16);
    } else {
      return (r & (0x03 | 0x08)).toString(16);
    }
  });
};

/**
 * Canonicalize a subject name or object
 *
 * @param {typeSubjectLoose} subject A simple or complex representation of a
 *     subject
 * @return {typeSubject} A canonicalized object for RPCs
 * @const
 * @private
 */
Cosmopolite.prototype.canonicalSubject_ = function(subject) {
  if (typeof(subject) == 'number') {
    subject = subject.toString();
  }
  if (typeof(subject) == 'string') {
    subject = {
      'name': subject,
    };
  }
  if (subject['readable_only_by'] === null) {
    delete subject['readable_only_by'];
  }
  if (subject['writable_only_by'] === null) {
    delete subject['writable_only_by'];
  }
  return subject;
};


/**
 * Callback when a script loads.
 *
 * @private
 */
Cosmopolite.prototype.onLoad_ = function() {
  if (--this.numScriptsToLoad_ > 0) {
    return;
  }
  if (this.shutdown_) {
    // Shutdown during startup
    return;
  }
  this.registerMessageHandlers_();
  this.createChannel_();
};

/**
 * Callback for a message from another browser window
 *
 * @param {string} data
 * @private
 */
Cosmopolite.prototype.onReceiveMessage_ = function(data) {
  switch (data) {
    case 'login_complete':
      if (this.socket_) {
        this.socket_.close();
      }
      break;
    case 'logout_complete':
      localStorage.removeItem(this.namespace_ + ':client_id');
      localStorage.removeItem(this.namespace_ + ':google_user_id');
      if (this.socket_) {
        this.socket_.close();
      }
      break;
    default:
      console.log(this.loggingPrefix_(), 'unknown event type:', data);
      break;
  }
};

/**
 * Register onReceiveMessage to receive callbacks
 *
 * Note that we share this bus with at least the channel code, so spurious
 * messages are normal.
 *
 * @private
 */
Cosmopolite.prototype.registerMessageHandlers_ = function() {
  /**
   * @param {Event} e
   * @this {Cosmopolite}
   */
  this.messageHandler_ = (function(e) {
    if (e.origin != window.location.origin) {
      // Probably talkgadget
      return;
    }
    console.log(this.loggingPrefix_(), 'received browser message:', e.data);
    this.onReceiveMessage_(e.data);
  }).bind(this);
  window.addEventListener('message', this.messageHandler_);
};

/**
 * Callback for a sendMessage RPC ack by the server.
 *
 * @param {typeMessage} message Message details.
 * @param {?function()} resolve Promise resolution callback.
 * @param {?function()} reject Promise rejection callback.
 * @param {Object} response Server RPC response.
 * @private
 */
Cosmopolite.prototype.onMessageSent_ = function(
    message, resolve, reject, response) {
  // No message left behind.
  var messageQueue = JSON.parse(localStorage[this.messageQueueKey_]);
  messageQueue = messageQueue.filter(function(queuedMessage) {
    return message['sender_message_id'] != queuedMessage['sender_message_id'];
  });
  localStorage[this.messageQueueKey_] = JSON.stringify(messageQueue);
  var result = response['result'];
  if (result == 'ok' || result == 'duplicate_message') {
    if (resolve) {
      resolve();
    }
  } else {
    if (reject) {
      reject();
    }
  }
};

/**
 * Send a single RPC to the server.
 *
 * See sendRPCs_()
 *
 * @param {string} command Command name to call
 * @param {Object} args Arguments to pass to server
 * @param {?function(Object)=} onSuccess Success callback function
 * @private
 */
Cosmopolite.prototype.sendRPC_ = function(command, args, onSuccess) {
  /** @type {typeRPC} */
  var rpc = {
    'command': command,
    'arguments': args,
    'onSuccess': onSuccess,
  };
  if (this.maySendRPC_()) {
    this.sendRPCs_([rpc]);
  } else {
    // Queue instead of sending.
    this.rpcQueue_.push(rpc);
  }
};

/**
 * Send one or more RPCs to the server.
 *
 * Wraps handling of authentication to the server, even in cases where we need
 * to retry with more data. Also retries in cases of failure with exponential
 * backoff.
 *
 * @param {Array.<typeRPC>} commands List of commands to execute
 * @param {number=} delay Seconds waited before executing this call for backoff
 * @private
 */
Cosmopolite.prototype.sendRPCs_ = function(commands, delay) {
  if (this.shutdown_ || !commands.length) {
    return;
  }
  var request = {
    'instance_id': this.instanceID_,
    'commands': [],
  };
  commands.forEach(function(command) {
    var request_command = {
      'command': command['command'],
    };
    if ('arguments' in command) {
      request_command['arguments'] = command['arguments'];
    }
    request.commands.push(request_command);
  });
  if (this.namespace_ + ':client_id' in localStorage) {
    request['client_id'] = localStorage[this.namespace_ + ':client_id'];
  }
  if (this.namespace_ + ':google_user_id' in localStorage) {
    request['google_user_id'] =
      localStorage[this.namespace_ + ':google_user_id'];
  }

  var xhr = new XMLHttpRequest();
  xhr.responseType = 'json';

  var retryAfterDelay = (function(newCommands) {
    var intDelay =
      xhr.getResponseHeader('Retry-After') ||
      Math.min(32, Math.max(2, delay || 2));
    console.log(
      this.loggingPrefix_(),
      'RPC failed; will retry in ' + intDelay + ' seconds');
    var retry = (function() {
      this.sendRPCs_(newCommands, Math.pow(intDelay, 2));
    }).bind(this);
    window.setTimeout(retry, intDelay * 1000);
  }).bind(this);

  xhr.addEventListener('load', function(e) {
    if (xhr.status != 200) {
      retryAfterDelay(commands);
      return;
    }
    var data = xhr.response;

    if ('google_user_id' in data) {
      localStorage[this.namespace_ + ':google_user_id'] =
        data['google_user_id'];
    }
    if ('client_id' in data) {
      localStorage[this.namespace_ + ':client_id'] = data['client_id'];
    }

    if (data['status'] == 'retry') {
      // Discard delay
      this.sendRPCs_(commands);
      return;
    }
    if (data['status'] != 'ok') {
      console.log(this.loggingPrefix_(),
        'server returned unknown status:', data['status']);
      // TODO(flamingcow): Refresh the page? Show an alert?
      return;
    }

    // Handle events that were immediately available as if they came over the
    // channel. Fire them before the message callbacks, so clients can use
    // events like the subscribe promise fulfillment as a barrier for initial
    // data.
    data['events'].forEach(this.onServerEvent_, this);

    /** @type {Array.<typeRPC>} */
    var retryCommands = [];

    for (var i = 0; i < data['responses'].length; i++) {
      var response = data['responses'][i];
      if (response['result'] == 'retry') {
        retryCommands.push(commands[i]);
        continue;
      }
      if (commands[i]['onSuccess']) {
        commands[i]['onSuccess'].bind(this)(data['responses'][i]);
      }
    }

    if (retryCommands.length) {
      retryAfterDelay(retryCommands);
    }
  }.bind(this));

  xhr.addEventListener('error', retryAfterDelay);
  xhr.open('POST', this.urlPrefix_ + '/api');
  xhr.send(JSON.stringify(request));
};

/**
 * Are we currently clear to put RPCs on the wire?
 *
 * @return {boolean}
 * @const
 * @private
 */
Cosmopolite.prototype.maySendRPC_ = function() {
  if (!(this.namespace_ + ':client_id' in localStorage)) {
    return false;
  }

  if (this.channelState_ != Cosmopolite.ChannelState_.OPEN) {
    return false;
  }

  return true;
};

/**
 * Handle tasks needed after reconnecting the channel
 *
 * @private
 */
Cosmopolite.prototype.onReconnect_ = function() {
  if (!this.maySendRPC_()) {
    return;
  }

  /** @type {Array.<typeRPC>} */
  var rpcs = this.rpcQueue_;
  this.rpcQueue_ = [];
  for (var subject in this.subscriptions_) {
    /** @type {typeSubscription} */
    var subscription = this.subscriptions_[subject];
    /** @type {typeSubject} */
    var canonicalSubject = /** @type {typeSubject} */ (JSON.parse(subject));
    if (subscription.state != Cosmopolite.SubscriptionState_.ACTIVE) {
      continue;
    }
    /** @type {number} */
    var last_id = 0;
    if (subscription.messages.length > 0) {
      last_id = subscription.messages[subscription.messages.length - 1]['id'];
    }
    rpcs.push({
      'command': 'subscribe',
      'arguments': {
        'subject': canonicalSubject,
        'last_id': last_id,
      }
    });
  }
  for (var id in this.pins_) {
    /** @type {typeMessage} */
    var pin = this.pins_[id];
    rpcs.push({
      'command': 'pin',
      'arguments': pin,
    });
  }
  this.sendRPCs_(rpcs);
};

/**
 * Send RPC to create a server -> client channel
 *
 * @private
 */
Cosmopolite.prototype.createChannel_ = function() {
  if (this.channelState_ == Cosmopolite.ChannelState_.CLOSED) {
    this.channelState_ = Cosmopolite.ChannelState_.PENDING;
  } else {
    return;
  }

  /** @type {string} */
  this.instanceID_ = this.uuid_();

  var rpcs = [
    {
      'command': 'createChannel',
      'onSuccess': this.onCreateChannel_,
    },
  ];
  // sendRPCs instead of sendRPC so we don't queue.
  this.sendRPCs_(rpcs);
};

/**
 * Callback for channel creation on the server side
 *
 * @suppress {missingProperties}
 *
 * @param {Object} data
 * @private
 */
Cosmopolite.prototype.onCreateChannel_ = function(data) {
  if (this.shutdown_) {
    return;
  }

  if (this.channelState_ == Cosmopolite.ChannelState_.PENDING) {
    this.channelState_ = Cosmopolite.ChannelState_.OPENING;
  } else {
    return;
  }

  var channel = new goog.appengine.Channel(data['token']);
  console.log(this.loggingPrefix_(), 'opening channel:', data['token']);
  this.socket_ = channel.open({
    onopen: this.onSocketOpen_.bind(this),
    onclose: this.onSocketClose_.bind(this),
    onmessage: this.onSocketMessage_.bind(this),
    onerror: this.onSocketError_.bind(this),
  });
};

/**
 * Callback from channel library for successful open
 *
 * @private
 */
Cosmopolite.prototype.onSocketOpen_ = function() {
  console.log(this.loggingPrefix_(), 'channel opened');

  if (this.shutdown_ && this.socket_) {
    this.socket_.close();
  }

  if (this.channelState_ == Cosmopolite.ChannelState_.OPENING) {
    this.channelState_ = Cosmopolite.ChannelState_.OPEN;
    if (this.callbacks_.onConnect) {
      this.callbacks_.onConnect();
    }
  } else {
    return;
  }

  this.onReconnect_();
};

/**
 * Callback from channel library for closure; reopen.
 *
 * @private
 */
Cosmopolite.prototype.onSocketClose_ = function() {
  console.log(this.loggingPrefix_(), 'channel closed');

  if (this.shutdown_) {
    return;
  }

  if (this.channelState_ == Cosmopolite.ChannelState_.OPEN) {
    this.channelState_ = Cosmopolite.ChannelState_.CLOSED;
    if (this.callbacks_.onDisconnect) {
      this.callbacks_.onDisconnect();
    }
  } else {
    return;
  }

  // We treat a disconnection as if all pins disappeared
  for (var subject in this.subscriptions_) {
    var subscription = this.subscriptions_[subject];
    subscription.pins.forEach(function(pin) {
      // Stupid hack that saves complexity elsewhere
      pin['message'] = JSON.stringify(pin['message']);
      this.onUnpin_(pin);
    }, this);
  }

  this.createChannel_();
};

/**
 * Callback from channel library for message reception over channel
 *
 * @param {{data: string}} msg
 * @private
 */
Cosmopolite.prototype.onSocketMessage_ = function(msg) {
  this.onServerEvent_(/** @type {typeEvent} */ (JSON.parse(msg.data)));
};

/**
 * Callback from channel library for error on channel
 *
 * @param {{description: string, code: number}} msg
 * @private
 */
Cosmopolite.prototype.onSocketError_ = function(msg) {
  console.log(this.loggingPrefix_(), 'socket error:', msg);
  if (this.socket_) {
    this.socket_.close();
  }
};

/**
 * Callback on receiving a 'close' event from the server
 *
 * @private
 */
Cosmopolite.prototype.onClose_ = function() {
  console.log(this.loggingPrefix_(), 'server asked us to close our socket');
  if (this.socket_) {
    this.socket_.close();
  }
};

/**
 * Callback on receiving a 'login' event from the server
 *
 * @param {typeLogin} e
 * @private
 */
Cosmopolite.prototype.onLogin_ = function(e) {
  if (this.callbacks_.onLogin) {
    this.callbacks_.onLogin(
        e['google_user'],
        this.urlPrefix_ + '/auth/logout');
  }
};

/**
 * Callback on receiving a 'logout' event from the server
 *
 * @param {typeLogout} e
 * @private
 */
Cosmopolite.prototype.onLogout_ = function(e) {
  if (this.callbacks_.onLogout) {
    this.callbacks_.onLogout(
      this.urlPrefix_ + '/auth/login');
  }
};

/**
 * Callback on receiving a 'message' event from the server
 *
 * @param {typeMessage} e
 * @private
 */
Cosmopolite.prototype.onMessage_ = function(e) {
  /** @type {string} */
  var subjectString = JSON.stringify(e['subject']);
  /** @type {typeSubscription} */
  var subscription = this.subscriptions_[subjectString];
  if (!subscription) {
    console.log(
      this.loggingPrefix_(),
      'message from unrecognized subject:', e);
    return;
  }
  /** @type {boolean} */
  var duplicate = subscription.messages.some(function(message) {
    return message['id'] == e.id;
  });
  if (duplicate) {
    console.log(this.loggingPrefix_(), 'duplicate message:', e);
    return;
  }
  e['message'] = JSON.parse(e['message']);

  // Reverse search for the position to insert this message, as iit will most
  // likely be at the end.
  /** @type {?number} */
  var insertAfter;
  for (var insertAfter = subscription.messages.length - 1;
       insertAfter >= 0; insertAfter--) {
    var message = subscription.messages[insertAfter];
    if (message['id'] < e['id']) {
      break;
    }
  }
  subscription.messages.splice(insertAfter + 1, 0, e);

  if (this.callbacks_.onMessage) {
    this.callbacks_.onMessage(e);
  }
};

/**
 * Callback on receiving a 'pin' event from the server
 *
 * @param {typeMessage} e
 * @private
 */
Cosmopolite.prototype.onPin_ = function(e) {
  /** @type {string} */
  var subjectString = JSON.stringify(e['subject']);
  /** @type {typeSubscription} */
  var subscription = this.subscriptions_[subjectString];
  if (!subscription) {
    console.log(
      this.loggingPrefix_(),
      'message from unrecognized subject:', e);
    return;
  }
  /** @type {boolean} */
  var duplicate = subscription.pins.some(function(pin) {
    return pin['id'] == e.id;
  });
  if (duplicate) {
    console.log(this.loggingPrefix_(), 'duplicate pin:', e);
    return;
  }
  e['message'] = JSON.parse(e['message']);

  subscription.pins.push(e);
  if (this.callbacks_.onPin) {
    this.callbacks_.onPin(e);
  }
};

/**
 * Callback on receiving an 'unpin' event from the server
 *
 * @param {typeMessage} e
 * @private
 */
Cosmopolite.prototype.onUnpin_ = function(e) {
  /** @type {string} */
  var subjectString = JSON.stringify(e['subject']);
  /** @type {typeSubscription} */
  var subscription = this.subscriptions_[subjectString];
  if (!subscription) {
    console.log(
      this.loggingPrefix_(),
      'message from unrecognized subject:', e);
    return;
  }
  /** @type {?number} */
  var index;
  for (index = 0; index < subscription.pins.length; index++) {
    var pin = subscription.pins[index];
    if (pin['id'] == e['id']) {
      break;
    }
  }
  if (index == subscription.pins.length) {
    console.log(this.loggingPrefix_(), 'unknown pin:', e);
    return;
  }
  e['message'] = JSON.parse(e['message']);

  subscription.pins.splice(index, 1);
  if (this.callbacks_.onUnpin) {
    this.callbacks_.onUnpin(e);
  }
};

/**
 * Callback for Cosmopolite event (received via channel or pseudo-channel)
 *
 * @param {typeEvent} e
 * @private
 */
Cosmopolite.prototype.onServerEvent_ = function(e) {
  if (this.shutdown_) {
    return;
  }
  if (e['profile']) {
    /** @type {string} */
    this.profile_ = e['profile'];
    this.profilePromises_.forEach(function(resolve) {
      resolve(this.profile_);
    }, this);
    this.profilePromises_ = [];
  }
  switch (e['event_type']) {
    case 'close':
      this.onClose_();
      break;
    case 'login':
      this.onLogin_(/** @type {typeLogin} */ (e));
      break;
    case 'logout':
      this.onLogout_(/** @type {typeLogout} */ (e));
      break;
    case 'message':
      this.onMessage_(/** @type {typeMessage} */ (e));
      break;
    case 'pin':
      this.onPin_(/** @type {typeMessage} */ (e));
      break;
    case 'unpin':
      this.onUnpin_(/** @type {typeMessage } */ (e));
      break;
    default:
      // Client out of date? Force refresh?
      console.log(this.loggingPrefix_(), 'unknown channel event:', e);
      break;
  }
};

/** @type {function(new:Cosmopolite, ?typeCallbacks=, ?string=, ?string=)} */
window.Cosmopolite = Cosmopolite;
