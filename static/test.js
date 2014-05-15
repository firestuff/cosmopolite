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

var randstring = function() {
  var ret = [];
  for (var i = 0; i < 16; i++) {
    var ran = (Math.random() * 16) | 0;
    ret.push(ran.toString(16));
  }
  return ret.join('');
};

QUnit.testStart(localStorage.clear.bind(localStorage));
QUnit.testDone(localStorage.clear.bind(localStorage));

QUnit.testStart(function() {
  // Log us out.
  var req = new XMLHttpRequest();
  req.open('GET', '/cosmopolite/auth/logout', false);
  req.send();
});

module('General');

test('Construct/shutdown', function() {
  expect(2);
  var cosmo = new Cosmopolite({});
  ok(true, 'new Cosmopolite() succeeds');
  cosmo.shutdown();
  ok(true, 'shutdown() succeeds');
});

asyncTest('onLogout fires', function() {
  expect(1);
  var callbacks = {
    'onLogout': function(login_url) {
      ok(true, 'onLogout fired');
      cosmo.shutdown();
      start();
    }
  };
  var cosmo = new Cosmopolite(callbacks);
});

asyncTest('Message round trip', function() {
  expect(2);

  var subject = randstring();
  var message = randstring();

  var callbacks1 = {
    'onReady': function() {
      cosmo1.sendMessage(subject, message);
    },
  };

  var callbacks2 = {
    'onReady': function() {
      cosmo2.subscribe(subject, -1);
    },
    'onMessage': function(e) {
      equal(e['subject'], subject, 'subject matches');
      equal(e['message'], message, 'message matches');
      cosmo1.shutdown();
      cosmo2.shutdown();
      start();
    },
  };

  var cosmo1 = new Cosmopolite(callbacks1, null, randstring());
  var cosmo2 = new Cosmopolite(callbacks2, null, randstring());
});

asyncTest('Overwrite key', function() {
  expect(8);

  var subject = randstring();
  var message1 = randstring();
  var message2 = randstring();
  var key = randstring();

  var messages1 = 0;

  var callbacks1 = {
    'onReady': function() {
      cosmo1.subscribe(subject, -1);
      cosmo1.sendMessage(subject, message1, key);
    },
    'onMessage': function(e) {
      messages1++;
      if (messages1 == 1) {
        cosmo1.sendMessage(subject, message2, key);
      }
    },
  };

  var messages2 = 0;

  var callbacks2 = {
    'onReady': function() {
      cosmo2.subscribe(subject, -1);
    },
    'onMessage': function(e) {
      messages2++;
      equal(e['subject'], subject, 'subject matches');
      equal(e['key'], key, 'key matches');
      if (messages2 == 1) {
        equal(e['message'], message1, 'message #1 matches');
        equal(cosmo2.getKeyMessage(subject, key)['message'], message1, 'message #1 matches by key')
        return;
      }
      equal(e['message'], message2, 'message #2 matches');
      equal(cosmo2.getKeyMessage(subject, key)['message'], message2, 'message #2 matches by key')
      cosmo1.shutdown();
      cosmo2.shutdown();
      start();
    },
  };

  var cosmo1 = new Cosmopolite(callbacks1, null, randstring());
  var cosmo2 = new Cosmopolite(callbacks2, null, randstring());
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

  var callbacks1 = {
    'onReady': function() {
      cosmo1.sendMessage(subject, message);
    },
  };

  var callbacks2 = {
    'onReady': function() {
      cosmo2.subscribe(subject, -1);
    },
    'onMessage': function(e) {
      equal(e['subject'], subject, 'subject matches');
      deepEqual(e['message'], message, 'message matches');
      cosmo1.shutdown();
      cosmo2.shutdown();
      start();
    },
  };

  var cosmo1 = new Cosmopolite(callbacks1, null, randstring());
  var cosmo2 = new Cosmopolite(callbacks2, null, randstring());
});


module('dev_appserver only');

asyncTest('Login', function() {
  expect(2);
  var callbacks = {
    'onLogin': function(login_url) {
      ok(true, 'onLogin fired');
      cosmo.shutdown();
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
