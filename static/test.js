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

/*
A quick note on testing philosophy:

These tests cover both the client (JavaScript) and the server (Python), as
well as the server's interaction with appengine (via dev_appserver or a
deployed instance). There is intentionally no mock server. The client and
server interactions are complex and tests should be structured to verify them,
not to verify the behavior of a simulation.
*/

/*
These tests break if you turn on global pollution detection because of at
least:

* $, jQuery: jQuery's noConflict() doesn't actually delete $ or jQuery; it
    sets them to undefined.
* goog: goog.appengine.Channel doesn't provide any kind of noConflict()
    equivalent.
* closure_lm_*: The Channel code has a bug that puts this in globals.
*/

var randstring = function() {
  var ret = [];
  for (var i = 0; i < 16; i++) {
    var ran = (Math.random() * 16) | 0;
    ret.push(ran.toString(16));
  }
  return ret.join('');
};

var logout = function(callback) {
  var innerCallback = function(e) {
    window.removeEventListener('message', innerCallback);
    if (e.origin != window.location.origin ||
        e.data != 'logout_complete') {
      return;
    }
    if (callback) {
      callback();
    }
  };

  window.addEventListener('message', innerCallback);
  window.open('/cosmopolite/auth/logout');
};

QUnit.testStart(localStorage.clear.bind(localStorage));
QUnit.testDone(localStorage.clear.bind(localStorage));

module('All platforms');

test('Construct/shutdown', function() {
  expect(2);
  var cosmo = new Cosmopolite({});
  ok(true, 'new Cosmopolite() succeeds');
  cosmo.shutdown();
  ok(true, 'shutdown() succeeds');
});

asyncTest('onLogout fires', function() {
  expect(1);

  logout(function() {
    var callbacks = {
      'onLogout': function(login_url) {
        ok(true, 'onLogout fired');
        cosmo.shutdown();
        start();
      }
    };
    var cosmo = new Cosmopolite(callbacks);
  });
});

asyncTest('Message round trip', function() {
  expect(2);

  var subject = randstring();
  var message = randstring();

  var callbacks = {
    'onReady': function() {
      cosmo.sendMessage(subject, message);
      cosmo.subscribe(subject, -1);
    },
    'onMessage': function(e) {
      equal(e['subject'], subject, 'subject matches');
      equal(e['message'], message, 'message matches');
      cosmo.shutdown();
      start();
    },
  };

  var cosmo = new Cosmopolite(callbacks, null, randstring());
});

asyncTest('Overwrite key', function() {
  expect(8);

  var subject = randstring();
  var message1 = randstring();
  var message2 = randstring();
  var key = randstring();

  var messages = 0;

  var callbacks = {
    'onReady': function() {
      cosmo.subscribe(subject, -1);
      cosmo.sendMessage(subject, message1, key);
    },
    'onMessage': function(e) {
      messages++;
      equal(e['subject'], subject, 'subject matches');
      equal(e['key'], key, 'key matches');
      if (messages == 1) {
        equal(e['message'], message1, 'message #1 matches');
        equal(cosmo.getKeyMessage(subject, key)['message'], message1, 'message #1 matches by key')
        cosmo.sendMessage(subject, message2, key);
        return;
      }
      equal(e['message'], message2, 'message #2 matches');
      equal(cosmo.getKeyMessage(subject, key)['message'], message2, 'message #2 matches by key')
      cosmo.shutdown();
      start();
    },
  };

  var cosmo = new Cosmopolite(callbacks, null, randstring());
});

asyncTest('Complex object', function() {
  expect(2);

  var subject = randstring();
  var message = {
    'foo': 'bar',
    5: 'zig',
    'zag': [16, 22, 59, 76],
    'boo': {
      'nested': 'object',
      10: 100,
    },
    'unicode': '☠☣☃𠜎',
  };

  var callbacks = {
    'onReady': function() {
      cosmo.sendMessage(subject, message);
      cosmo.subscribe(subject, -1);
    },
    'onMessage': function(e) {
      equal(e['subject'], subject, 'subject matches');
      deepEqual(e['message'], message, 'message matches');
      cosmo.shutdown();
      start();
    },
  };

  var cosmo = new Cosmopolite(callbacks, null, randstring());
});


module('dev_appserver only');

asyncTest('Login', function() {
  expect(2);

  logout(function() {
    var callbacks = {
      'onLogin': function(login_url) {
        ok(true, 'onLogin fired');
        cosmo.shutdown();
        logout();
        start();
      },
      'onLogout': function(login_url) {
        ok(true, 'onLogout fired');
        // Entirely magic URL that sets the login cookie and redirects.
        window.open('/_ah/login?email=test%40example.com&action=Login&continue=/cosmopolite/static/login_complete.html');
      }
    };
    var cosmo = new Cosmopolite(callbacks);
  });
});
