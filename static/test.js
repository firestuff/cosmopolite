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

* goog: goog.appengine.Channel seems to always be global.
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
  var cosmo = new Cosmopolite({}, null, randstring());
  ok(true, 'new Cosmopolite() succeeds');
  cosmo.shutdown();
  ok(true, 'shutdown() succeeds');
});

asyncTest('onConnect/onLogout fires', function() {
  expect(2);

  var numCallbacks = 0;

  logout(function() {
    var callbacks = {
      'onConnect': function() {
        ok(true, 'onConnect fired');
        if (++numCallbacks == 2) {
          cosmo.shutdown();
          start();
        }
      },
      'onLogout': function(login_url) {
        ok(true, 'onLogout fired');
        if (++numCallbacks == 2) {
          cosmo.shutdown();
          start();
        }
      }
    };
    var cosmo = new Cosmopolite(callbacks, null, randstring());
  });
});

asyncTest('Message round trip', function() {
  expect(2);

  var subject = randstring();
  var message = randstring();

  var callbacks = {
    'onMessage': function(e) {
      equal(e['subject']['name'], subject, 'subject matches');
      equal(e['message'], message, 'message matches');
      cosmo.shutdown();
      start();
    },
  };

  var cosmo = new Cosmopolite(callbacks, null, randstring());
  cosmo.sendMessage(subject, message);
  cosmo.subscribe(subject, -1);
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
    'onMessage': function(e) {
      equal(e['subject']['name'], subject, 'subject matches');
      deepEqual(e['message'], message, 'message matches');
      cosmo.shutdown();
      start();
    },
  };

  var cosmo = new Cosmopolite(callbacks, null, randstring());
  cosmo.sendMessage(subject, message);
  cosmo.subscribe(subject, -1);
});

asyncTest('sendMessage Promise', function() {
  expect(1);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite({}, null, randstring());
  cosmo.sendMessage(subject, message).then(function() {
    ok(true, 'sendMessage Promise fulfilled');
    cosmo.shutdown();
    start();
  });
});

asyncTest('subscribe/unsubscribe Promise', function() {
  expect(2);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite({}, null, randstring());
  cosmo.subscribe(subject).then(function() {
    ok(true, 'subscribe Promise fulfilled');
    cosmo.unsubscribe(subject).then(function() {
      ok(true, 'unsubscribe Promise fulfilled');
      cosmo.shutdown();
      start();
    });
  });
});

asyncTest('Duplicate message suppression', function() {
  expect(2);

  var subject = randstring();
  var message1 = randstring();
  var message2 = randstring();

  var callbacks = {
    'onMessage': function (msg) {
      equal(msg['subject']['name'], subject, 'subject matches');
      equal(msg['message'], message1, 'message matches');
      cosmo.shutdown();
      start();
    },
  };

  var cosmo = new Cosmopolite(callbacks, null, randstring());
  // Break cosmo's UUID generator so that it generates duplicate values.
  cosmo.uuid_ = function() {
    return '4';
    // chosen by fair dice roll.
    // guaranteed to be random.
  };
  cosmo.sendMessage(subject, message1).then(function() {
    cosmo.sendMessage(subject, message2).then(function() {
      cosmo.subscribe(subject, -1);
    });
  });
});

asyncTest('Message persistence', function() {
  expect(2);

  var subject = randstring();
  var message = randstring();
  var namespace = randstring();

  // Send a message and shut down too fast for it to hit the wire.
  var cosmo1 = new Cosmopolite({}, null, namespace);
  cosmo1.sendMessage(subject, message);
  cosmo1.shutdown();

  var callbacks = {
    'onMessage': function(msg) {
      equal(msg['subject']['name'], subject, 'subject matches');
      equal(msg['message'], message, 'message matches');
      cosmo2.shutdown();
      start();
    },
  };

  var cosmo2 = new Cosmopolite(callbacks, null, namespace);
  cosmo2.subscribe(subject, -1);
  // Should pick up the message from the persistent queue.
});

test('getMessages/subscribe', function() {
  expect(2);

  var subject = randstring();

  var cosmo = new Cosmopolite({}, null, randstring());
  throws(
    cosmo.getMessages.bind(undefined, subject),
    'getMessages before subscribe fails');
  cosmo.subscribe(subject);
  // Verify that we can call getMessages immediately after subscribe
  cosmo.getMessages(subject);
  ok(true, 'getMessages after subscribe succeeds');

  cosmo.shutdown();
});

asyncTest('subscribe barrier', function() {
  expect(4);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite({}, null, randstring());

  cosmo.sendMessage(subject, message).then(function() {
    cosmo.subscribe(subject, -1).then(function() {
      // We are validating that the message event generated by the subscribe
      // call has already been processed by the time this promise fires
      equal(cosmo.getMessages(subject).length, 1, 'one message');
      equal(cosmo.getMessages(subject)[0]['subject']['name'], subject, 'subject matches');
      equal(cosmo.getMessages(subject)[0]['message'], message, 'message matches');
      deepEqual(cosmo.getMessages(subject)[0], cosmo.getLastMessage(subject), 'getLastMessage works');
      cosmo.shutdown();
      start();
    });
  });
});

asyncTest('resubscribe', function() {
  expect(4);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite({}, null, randstring());

  cosmo.sendMessage(subject, message).then(function() {
    cosmo.subscribe(subject).then(function() {
      equal(cosmo.getMessages(subject).length, 0, 'zero messages');
      cosmo.subscribe(subject, -1).then(function() {
        var messages = cosmo.getMessages(subject);
        equal(messages.length, 1, 'one message');
        equal(messages[0]['subject']['name'], subject, 'subject matches');
        equal(messages[0]['message'], message, 'message matches');
        cosmo.shutdown();
        start();
      });
    });
  });
});

asyncTest('Message ordering', function() {
  expect(3);

  var subject = randstring();
  var messages = [ 'A', 'B', 'C', 'D' ];

  var cosmo = new Cosmopolite({}, null, randstring());

  var sendNextMessage = function() {
    if (messages.length) {
      cosmo.sendMessage(subject, messages.shift()).then(sendNextMessage);
    } else {
      cosmo.subscribe(subject, 1).then(function() {
        cosmo.subscribe(subject, 2).then(function() {
          var fetched = cosmo.getMessages(subject);
          equal(fetched.length, 2, 'two messages');
          equal(fetched[0]['message'], 'C', 'message 0: C matches');
          equal(fetched[1]['message'], 'D', 'message 1: D matches');
          cosmo.shutdown();
          start();
        });
      });
    }
  };

  sendNextMessage();
});

asyncTest('Reconnect channel', function() {
  expect(5);

  var subject = randstring();
  var message = randstring();

  var callbacks = {
    'onConnect': function() {
      ok(true, 'onConnect fired');
    },
    'onDisconnect': function() {
      ok(true, 'onDisconnect fired');
    },
    'onMessage': function(msg) {
      equal(msg['subject']['name'], subject, 'subject matches');
      equal(msg['message'], message, 'message matches');
      cosmo.shutdown();
      start();
    },
  };

  var cosmo = new Cosmopolite(callbacks, null, randstring());
  cosmo.subscribe(subject, 0).then(function() {
    // Reach inside to forcefully close the socket
    cosmo.socket_.close();
    cosmo.sendMessage(subject, message);
  });
});

asyncTest('subscribe ACL', function() {
  expect(2);

  var subject = randstring();

  logout(function() {
    var tempCosmo = new Cosmopolite({}, null, randstring());
    tempCosmo.getProfile().then(function(tempProfile) {
      tempCosmo.shutdown();

      var cosmo = new Cosmopolite({}, null, randstring());
      cosmo.getProfile().then(function(profile) {
        cosmo.subscribe({
          'name':             subject,
          'readable_only_by': profile,
        }).then(function() {
          ok(true, 'correct ACL succeeds');

          cosmo.subscribe({
            'name':             subject,
            'readable_only_by': tempProfile,
          }).then(null, function() {
            ok(true, 'bad ACL fails');
            cosmo.shutdown();
            start();
          });

        });
      });
    });
  });
});

asyncTest('sendMessage ACL', function() {
  expect(2);

  var subject = randstring();
  var message = randstring();

  logout(function() {
    var tempCosmo = new Cosmopolite({}, null, randstring());
    tempCosmo.getProfile().then(function(tempProfile) {
      tempCosmo.shutdown();

      var cosmo = new Cosmopolite({}, null, randstring());
      cosmo.getProfile().then(function(profile) {
        cosmo.sendMessage({
          'name':             subject,
          'writable_only_by': profile,
        }, message).then(function() {
          ok(true, 'correct ACL succeeds');

          cosmo.sendMessage({
            'name':             subject,
            'writable_only_by': tempProfile,
          }, message).then(null, function() {
            ok(true, 'bad ACL fails');
            cosmo.shutdown();
            start();
          });

        });
      });
    });
  });
});

asyncTest('pin/unpin', function() {
  expect(5);

  var subject = randstring();
  var message = randstring();

  var callbacks = {
    'onPin': function(e) {
      equal(subject, e['subject']['name'], 'onPin: subject matches');
      equal(message, e['message'], 'onPin: message matches');
      equal(cosmo.getPins(subject).length, 1);
      pin.then(function(id) {
        cosmo.unpin(id);
      });
    },
    'onUnpin': function(e) {
      equal(subject, e['subject']['name'], 'onUnpin: subject matches');
      equal(message, e['message'], 'onUnpin: message matches');
      cosmo.shutdown();
      start();
    },
  }

  var cosmo = new Cosmopolite(callbacks, null, randstring());
  cosmo.subscribe(subject);
  var pin = cosmo.pin(subject, message);
});

asyncTest('Repin', function() {
  expect(8);

  var subject = randstring();
  var message = randstring();

  var pins = 0;

  var callbacks = {
    'onPin': function(e) {
      equal(subject, e['subject']['name'], 'onPin: subject matches');
      equal(message, e['message'], 'onPin: message matches');
      equal(cosmo.getPins(subject).length, 1);
      if (++pins == 1) {
        cosmo.socket_.close();
      } else {
        cosmo.shutdown();
        start();
      }
    },
    'onUnpin': function(e) {
      equal(subject, e['subject']['name'], 'onUnpin: subject matches');
      equal(message, e['message'], 'onUnpin: message matches');
    },
  }

  var cosmo = new Cosmopolite(callbacks, null, randstring());
  cosmo.subscribe(subject);
  var pin = cosmo.pin(subject, message);
});


module('dev_appserver only');

asyncTest('Login', function() {
  expect(3);

  var anonymousProfile;

  logout(function() {
    var callbacks = {
      'onLogout': function(login_url) {
        ok(true, 'onLogout fired');
        anonymousProfile = cosmo.currentProfile();
        // Entirely magic URL that sets the login cookie and redirects.
        window.open('/_ah/login?email=test%40example.com&action=Login&continue=/cosmopolite/static/login_complete.html');
      },
      'onLogin': function(login_url) {
        ok(true, 'onLogin fired');
        notEqual(anonymousProfile, cosmo.currentProfile(), 'profile changed');
        cosmo.shutdown();
        logout();
        start();
      },
    };
    var cosmo = new Cosmopolite(callbacks, null, randstring());
  });
});

asyncTest('Profile merge', function() {
  expect(6);

  var subject = randstring();
  var message = randstring();

  var messages = 0;

  logout(function() {
    var callbacks = {
      'onMessage': function(msg) {
        messages++;
        equal(msg['subject']['name'], subject,
              'message #' + messages + ': subject matches');
        equal(msg['message'], message,
              'message #' + messages + ': message matches');
        equal(msg['sender'], cosmo.currentProfile(),
              'message #' + messages + ': profile matches');
        if (messages == 1) {
          cosmo.unsubscribe(subject);
          // Entirely magic URL that sets the login cookie and redirects.
          window.open('/_ah/login?email=test%40example.com&action=Login&continue=/cosmopolite/static/login_complete.html');
        }
        if (messages == 2) {
          cosmo.shutdown();
          start();
        }
      },
      'onLogin': function(logout_url) {
        cosmo.subscribe(subject, -1);
      },
    };
    var cosmo = new Cosmopolite(callbacks, null, randstring());
    cosmo.sendMessage(subject, message);
    cosmo.subscribe(subject, -1);
  });
});

asyncTest('Two channels, one client', function() {
  expect(2);

  var namespace = randstring();
  var subject = randstring();
  var message = randstring();

  var callbacks = {
    'onMessage': function(msg) {
      equal(msg['subject']['name'], subject, 'subject matches');
      equal(msg['message'], message, 'message matches');
      cosmo1.shutdown();
      start();
    },
  };

  var cosmo1 = new Cosmopolite(callbacks, null, namespace);
  cosmo1.subscribe(subject).then(function() {
    var cosmo2 = new Cosmopolite({}, null, namespace);
    cosmo2.sendMessage(subject, message).then(function() {
      cosmo2.shutdown();
    });
  });
});
