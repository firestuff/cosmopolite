/*
Copyright 2014, Ian Gulliver

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// We use long keys in many places. Provide a method to trim those down for
// human readability.
String.prototype.hashCode = function() {
  var hash = 0;
  for (i = 0; i < this.length; i++) {
    var char = this.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
};

var cosmopolite = {};

cosmopolite.Client = function(opt_callbacks, opt_urlPrefix, opt_namespace) {
  this.callbacks_ = opt_callbacks || {};
  this.urlPrefix_ = opt_urlPrefix || '/cosmopolite';
  this.namespace_ = opt_namespace || 'cosmopolite';

  this.stateCache_ = {};
  this.subscriptions_ = {};

  var scriptUrls = [
    'https://ajax.googleapis.com/ajax/libs/jquery/2.1.0/jquery.min.js',
    '/_ah/channel/jsapi',
  ];
  this.numScriptsToLoad_ = scriptUrls.length;
  scriptUrls.forEach(function(scriptUrl) {
    var script = document.createElement('script');
    script.src = scriptUrl;
    script.onload = this.onLoad_.bind(this);
    document.body.appendChild(script);
  }, this);
};

cosmopolite.Client.prototype.setValue = function(key, value, is_public) {
  this.sendRPC_('setValue', {
    'key': key,
    'value': value,
    'public': is_public,
  });
  // Provide immediate feedback without waiting for a round trip.
  // We'll also get a response from the server, so this should be eventually
  // consistent.
  if ('onStateChange' in this.callbacks_) {
    this.callbacks_['onStateChange'](key, value);
  }
};

cosmopolite.Client.prototype.getValue = function(key) {
  return this.stateCache_[key];
};

cosmopolite.Client.prototype.subscribe = function(subject, messages) {
  if (subject in this.subscriptions_) {
    console.log('Not sending duplication subscription request for subject:', subject);
    return;
  }
  this.subscriptions_[subject] = {
    'messages': [],
  };
  this.sendRPC_('subscribe', {
    'subject': subject,
    'messages': messages,
  });
};

cosmopolite.Client.prototype.unsubscribe = function(subject) {
  delete this.subscriptions_[subject];
  this.sendRPC_('unsubscribe', {
    'subject': subject,
  });
};

cosmopolite.Client.prototype.sendMessage = function(subject, message) {
  this.sendRPC_('sendMessage', {
    'subject': subject,
    'message': message,
  });
};

cosmopolite.Client.prototype.getMessages = function(subject) {
  return this.subscriptions_[subject].messages;
};

cosmopolite.Client.prototype.onLoad_ = function() {
  if (--this.numScriptsToLoad_ > 0) {
    return;
  }
  this.$ = jQuery.noConflict(true);
  this.registerMessageHandlers_();
  this.createChannel_();
};

// Message from another browser window
cosmopolite.Client.prototype.onReceiveMessage_ = function(data) {
  switch (data) {
    case 'login_complete':
      this.socket.close();
      break;
    case 'logout_complete':
      localStorage.removeItem(this.namespace_ + ':client_id');
      localStorage.removeItem(this.namespace_ + ':google_user_id');
      this.$('#google_user').empty();
      this.socket.close();
      break;
    default:
      console.log('Unknown event type:', data);
      break;
  }
};

cosmopolite.Client.prototype.registerMessageHandlers_ = function() {
  this.$(window).on('message', this.$.proxy(function(e) {
    if (e.originalEvent.origin != window.location.origin) {
      console.log(
        'Received message from bad origin:', e.originalEvent.origin);
      return;
    }
    console.log('Received browser message:', e.originalEvent.data);
    this.onReceiveMessage_(e.originalEvent.data);
  }, this));
};

cosmopolite.Client.prototype.sendRPC_ = function(command, args, onSuccess) {
  this.sendRPCs_([
    {
      'command': command,
      'arguments': args,
      'onSuccess': onSuccess,
    }
  ]);
};

cosmopolite.Client.prototype.sendRPCs_ = function(commands, delay) {
  var request = {
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
    request['google_user_id'] = localStorage[this.namespace_ + ':google_user_id'];
  }
  this.$.ajax({
    url: this.urlPrefix_ + '/api',
    type: 'post',
    data: JSON.stringify(request),
    dataType: 'json',
    context: this,
  })
    .done(function(data, stat, xhr) {
      if ('google_user_id' in data) {
        localStorage[this.namespace_ + ':google_user_id'] =
          data['google_user_id'];
      }
      if ('client_id' in data) {
        localStorage[this.namespace_ + ':client_id'] = data['client_id'];
      }
      if (data['status'] == 'retry') {
        // Discard delay
        this.sendRPCs_(commands, onSuccess);
        return;
      }
      if (data['status'] != 'ok') {
        console.log('Server returned unknown status:', data['status']);
        // TODO(flamingcow): Refresh the page? Show an alert?
        return;
      }
      for (var i = 0; i < data.responses.length; i++) {
        if (commands[i]['onSuccess']) {
          this.$.proxy(commands[i]['onSuccess'], this)(data.responses[i]);
        }
      }
      // Handle events that were immediately available as if they came over the
      // channel.
      data['events'].forEach(this.onServerEvent_, this);
    })
    .fail(function(xhr) {
      var intDelay =
        xhr.getResponseHeader('Retry-After') ||
        Math.min(32, Math.max(2, delay || 2));
      console.log(
        'RPC failed. Will retry in ' + intDelay + ' seconds');
      function retry() {
        this.sendRPCs_(commands, Math.pow(intDelay, 2));
      }
      window.setTimeout(this.$.proxy(retry, this), intDelay * 1000);
    });
};

cosmopolite.Client.prototype.createChannel_ = function() {
  var rpcs = [
    {
      'command':   'createChannel',
      'onSuccess': this.onCreateChannel_,
    },
  ];
  // TODO(flamingcow): Need to restart from the latest message.
  for (var subject in this.subscriptions_) {
    rpcs.push({
      'command': 'subscribe',
      'arguments': {
        'subject':  subject,
        'messages': 0,
      }
    });
  }
  this.sendRPCs_(rpcs);
};

cosmopolite.Client.prototype.onCreateChannel_ = function(data) {
  var channel = new goog.appengine.Channel(data['token']);
  console.log('Opening channel...');
  this.socket = channel.open({
    onopen: this.$.proxy(this.onSocketOpen_, this),
    onclose: this.$.proxy(this.onSocketClose_, this),
    onmessage: this.$.proxy(this.onSocketMessage_, this),
    onerror: this.$.proxy(this.onSocketError_, this),
  });
};

cosmopolite.Client.prototype.onSocketOpen_ = function() {
  console.log('Channel opened');
};

cosmopolite.Client.prototype.onSocketClose_ = function() {
  if (!this.socket) {
    return;
  }
  console.log('Channel closed');
  this.socket = null;
  this.createChannel_();
};

cosmopolite.Client.prototype.onSocketMessage_ = function(msg) {
  this.onServerEvent_(JSON.parse(msg.data));
};

cosmopolite.Client.prototype.onServerEvent_ = function(e) {
  switch (e.event_type) {
    case 'state':
      var key = e['key'];
      if (this.stateCache_[key] &&
          this.stateCache_[key]['value'] == e['value'] &&
          this.stateCache_[key]['last_set'] == e['last_set'] &&
          this.stateCache_[key]['public'] == e['public']) {
        // Duplicate event.
        break;
      }
      this.stateCache_[key] = {
        'value':    e['value'],
        'last_set': e['last_set'],
        'public':   e['public'],
      }
      if ('onStateChange' in this.callbacks_) {
        this.callbacks_['onStateChange'](key, this.stateCache_[key]);
      }
      break;
    case 'login':
      if ('onLogin' in this.callbacks_) {
        this.callbacks_['onLogin'](
            e['google_user'],
            this.urlPrefix_ + '/auth/logout');
      }
      break;
    case 'logout':
      if ('onLogout' in this.callbacks_) {
        this.callbacks_['onLogout'](
          this.urlPrefix_ + '/auth/login');
      }
      break;
    case 'message':
      if (!(e['subject'] in this.subscriptions_)) {
        console.log('Message from unrecognized subject:', e);
        break;
      }
      var subscription = this.subscriptions_[e['subject']];
      var duplicate = subscription.messages.some(function(message) {
        return message['id'] == e.id;
      });
      if (duplicate) {
        console.log('Duplicate message:', e);
        break;
      }
      subscription.messages.push(e);
      if ('onMessage' in this.callbacks_) {
        this.callbacks_['onMessage'](e);
      }
      break;
    default:
      // Client out of date? Force refresh?
      console.log('Unknown channel event:', e);
      break;
  }
};

cosmopolite.Client.prototype.onSocketError_ = function(msg) {
  console.log('Socket error:', msg);
  this.socket.close();
};
