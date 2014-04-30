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

var cosmopolite = {};

cosmopolite.Client = function(opt_callbacks, opt_urlPrefix, opt_namespace) {
  this.callbacks_ = opt_callbacks || {};
  this.urlPrefix_ = opt_urlPrefix || '/cosmopolite';
  this.namespace_ = opt_namespace || 'cosmopolite';

  this.stateCache_ = {};

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

cosmopolite.Client.prototype.onLoad_ = function() {
  if (--this.numScriptsToLoad_ > 0) {
    return;
  }
  this.$ = jQuery.noConflict(true);
  this.registerMessageHandlers_();
  this.getUser_();
  this.createChannel_();
};

// Message from another browser window
cosmopolite.Client.prototype.onReceiveMessage_ = function(data) {
  switch (data) {
    case 'login_complete':
      this.getUser_();
      break;
    case 'logout_complete':
      localStorage.removeItem(this.namespace_ + ':client_id');
      localStorage.removeItem(this.namespace_ + ':google_user_id');
      this.$('#google_user').empty();
      this.getUser_();
      break;
    default:
      console.log('Unknown message type');
      break;
  }
};

cosmopolite.Client.prototype.registerMessageHandlers_ = function() {
  this.$(window).on('message', this.$.proxy(function(e) {
    if (e.originalEvent.origin != window.location.origin) {
      console.log(
        'Received message from bad origin: ' + e.originalEvent.origin);
      return;
    }
    console.log('Received message: ' + e.originalEvent.data);
    this.onReceiveMessage_(e.originalEvent.data);
  }, this));
};

cosmopolite.Client.prototype.sendRPC_ = function(command, data, onSuccess, delay) {
  if (this.namespace_ + ':client_id' in localStorage) {
    data['client_id'] = localStorage[this.namespace_ + ':client_id'];
  }
  if (this.namespace_ + ':google_user_id' in localStorage) {
    data['google_user_id'] = localStorage[this.namespace_ + ':google_user_id'];
  }
  this.$.ajax({
    url: this.urlPrefix_ + '/api/' + command,
    type: 'post',
    data: data,
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
        this.sendRPC_(command, data, onSuccess);
        return;
      }
      if (data['status'] != 'ok') {
        console.log(
            'Server returned unknown status (' + data['status'] + ') for RPC '
            + command);
        // TODO(flamingcow): Refresh the page? Show an alert?
        return;
      }
      if (onSuccess) {
      	this.$.proxy(onSuccess, this)(data.response);
      }
    })
    .fail(function(xhr) {
      var intDelay =
        xhr.getResponseHeader('Retry-After') ||
        Math.min(32, Math.max(2, delay || 2));
      console.log(
        'RPC ' + command + ' failed. Will retry in ' + intDelay + ' seconds');
      function retry() {
        this.sendRPC_(command, data, onSuccess, Math.pow(intDelay, 2));
      }
      window.setTimeout(this.$.proxy(retry, this), intDelay * 1000);
    });
};

cosmopolite.Client.prototype.getUser_ = function() {
  this.sendRPC_('getUser', {}, function(data) {
    if ('google_user' in data) {
      if ('onLogin' in this.callbacks_) {
        this.callbacks_['onLogin'](
          data['google_user'],
	  this.urlPrefix_ + '/auth/logout');
      }
    } else {
      if ('onLogout' in this.callbacks_) {
        this.callbacks_['onLogout'](
          this.urlPrefix_ + '/auth/login');
      }
    }
  });
};

cosmopolite.Client.prototype.setValue = function(key, value) {
  this.sendRPC_('setValue', {
    'key': key,
    'value': value,
  })
};

cosmopolite.Client.prototype.getValue = function(key) {
  return this.stateCache_[key];
};

cosmopolite.Client.prototype.createChannel_ = function() {
  this.sendRPC_('createChannel', {}, this.onCreateChannel_);
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
  // Handle messages that were immediately available as if they came over the
  // channel.
  data['messages'].forEach(this.onServerMessage_, this);
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
  this.onServerMessage_(JSON.parse(msg.data));
};

cosmopolite.Client.prototype.onServerMessage_ = function(msg) {
  switch (msg.message_type) {
    case 'state':
      var key = msg['key'];
      var value = msg['value'];
      if (this.stateCache_[key] == value) {
        // Duplicate message.
        break;
      }
      this.stateCache_[key] = value;
      if ('onStateChange' in this.callbacks_) {
        this.callbacks_['onStateChange'](key, value);
      }
      break;
    default:
      // Client out of date? Force refresh?
      console.log('Unknown message type: ' + msg.message_type);
      break;
  }
};

cosmopolite.Client.prototype.onSocketError_ = function(msg) {
  console.log('Socket error: ' + msg);
  this.socket.close();
};
