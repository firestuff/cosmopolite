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
      // Break the callback out from the message handling flow, so a
      // Cosmopolite instance created by the callback doesn't see the message.
      window.setTimeout(callback, 100);
    }
  };

  window.addEventListener('message', innerCallback);
  window.open('/cosmopolite/auth/logout');
};

QUnit.testStart(localStorage.clear.bind(localStorage));
QUnit.testDone(localStorage.clear.bind(localStorage));

QUnit.module('All platforms');

QUnit.test('Construct/shutdown', function(assert) {
  assert.expect(2);
  var cosmo = new Cosmopolite(null, randstring());
  assert.ok(true, 'new Cosmopolite() succeeds');
  cosmo.shutdown();
  assert.ok(true, 'shutdown() succeeds');
});

QUnit.asyncTest('onConnect/onLogout fires', function(assert) {
  assert.expect(2);

  var numCallbacks = 0;

  logout(function() {
    var cosmo = new Cosmopolite(null, randstring());

    cosmo.addEventListener('connect', function(e) {
      assert.ok(true, 'onConnect fired');
      if (++numCallbacks == 2) {
        cosmo.shutdown();
        QUnit.start();
      }
    });

    cosmo.addEventListener('logout', function(e) {
      assert.ok(true, 'onLogout fired');
      if (++numCallbacks == 2) {
        cosmo.shutdown();
        QUnit.start();
      }
    });
  });
});

QUnit.asyncTest('Message round trip', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject, 'subject matches');
    assert.equal(e.detail['message'], message, 'message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.sendMessage(subject, message);
  cosmo.subscribe(subject, -1);
});

QUnit.asyncTest('Message round trip without channel', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject, 'subject matches');
    assert.equal(e.detail['message'], message, 'message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.channelState_ = Cosmopolite.ChannelState_.OPENING;
  cosmo.sendMessage(subject, message);
  cosmo.subscribe(subject, -1);
});

QUnit.asyncTest('Bulk subscribe', function(assert) {
  assert.expect(2);

  var subject1 = randstring();
  var subject2 = randstring();
  var message = randstring();

  var messages = 0;

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.equal(e.detail['message'], message, 'message matches');
    if (++messages == 2) {
      cosmo.shutdown();
      QUnit.start();
    }
  });
  cosmo.sendMessage(subject1, message);
  cosmo.sendMessage(subject2, message);
  cosmo.subscribe([subject1, subject2], -1);
});

QUnit.asyncTest('Complex object', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message = {
    'foo': 'bar',
    5: 'zig',
    'zag': [16, 22, 59, 76],
    'boo': {
      'nested': 'object',
      10: 100
    },
    'unicode': '☠☣☃𠜎'
  };

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject, 'subject matches');
    assert.deepEqual(e.detail['message'], message, 'message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.sendMessage(subject, message);
  cosmo.subscribe(subject, -1);
});

QUnit.asyncTest('sendMessage Promise', function(assert) {
  assert.expect(3);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());
  cosmo.sendMessage(subject, message).then(function(msg) {
    assert.ok(true, 'sendMessage Promise fulfilled');
    assert.equal(msg['subject']['name'], subject);
    assert.equal(msg['message'], message);
    cosmo.shutdown();
    QUnit.start();
  });
});

QUnit.asyncTest('subscribe/unsubscribe Promise', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());
  cosmo.subscribe(subject).then(function() {
    assert.ok(true, 'subscribe Promise fulfilled');
    cosmo.unsubscribe(subject).then(function() {
      assert.ok(true, 'unsubscribe Promise fulfilled');
      cosmo.shutdown();
      QUnit.start();
    });
  });
});

QUnit.asyncTest('Duplicate message suppression', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message1 = randstring();
  var message2 = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  // Break cosmo's UUID generator so that it generates duplicate values.
  cosmo.uuid_ = function() {
    return '4';
    // chosen by fair dice roll.
    // guaranteed to be random.
  };

  cosmo.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject, 'subject matches');
    assert.equal(e.detail['message'], message1, 'message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.sendMessage(subject, message1).then(function() {
    cosmo.sendMessage(subject, message2).then(function() {
      cosmo.subscribe(subject, -1);
    });
  });
});

QUnit.asyncTest('Message persistence', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message = randstring();
  var namespace = randstring();

  // Send a message and shut down too fast for it to hit the wire.
  var cosmo1 = new Cosmopolite(null, namespace);
  cosmo1.sendMessage(subject, message);
  cosmo1.shutdown();

  var cosmo2 = new Cosmopolite(null, namespace);

  cosmo2.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject, 'subject matches');
    assert.equal(e.detail['message'], message, 'message matches');
    cosmo2.shutdown();
    QUnit.start();
  });

  cosmo2.subscribe(subject, -1);
  // Should pick up the message from the persistent queue.
});

QUnit.test('getMessages/subscribe', function(assert) {
  assert.expect(2);

  var subject = randstring();

  var cosmo = new Cosmopolite(null, randstring());
  assert.throws(
      cosmo.getMessages.bind(undefined, subject),
      'getMessages before subscribe fails');
  cosmo.subscribe(subject);
  // Verify that we can call getMessages immediately after subscribe
  cosmo.getMessages(subject);
  assert.ok(true, 'getMessages after subscribe succeeds');

  cosmo.shutdown();
});

QUnit.asyncTest('subscribe barrier', function(assert) {
  assert.expect(4);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.sendMessage(subject, message).then(function() {
    cosmo.subscribe(subject, -1).then(function() {
      // We are validating that the message event generated by the subscribe
      // call has already been processed by the time this promise fires
      assert.equal(cosmo.getMessages(subject).length, 1, 'one message');
      assert.equal(cosmo.getMessages(subject)[0]['subject']['name'], subject,
          'subject matches');
      assert.equal(cosmo.getMessages(subject)[0]['message'], message,
          'message matches');
      assert.deepEqual(cosmo.getMessages(subject)[0],
          cosmo.getLastMessage(subject), 'getLastMessage works');
      cosmo.shutdown();
      QUnit.start();
    });
  });
});

QUnit.asyncTest('resubscribe', function(assert) {
  assert.expect(4);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.sendMessage(subject, message).then(function() {
    cosmo.subscribe(subject).then(function() {
      assert.equal(cosmo.getMessages(subject).length, 0, 'zero messages');
      cosmo.subscribe(subject, -1).then(function() {
        var messages = cosmo.getMessages(subject);
        assert.equal(messages.length, 1, 'one message');
        assert.equal(messages[0]['subject']['name'], subject,
            'subject matches');
        assert.equal(messages[0]['message'], message, 'message matches');
        cosmo.shutdown();
        QUnit.start();
      });
    });
  });
});

QUnit.asyncTest('Message ordering', function(assert) {
  assert.expect(3);

  var subject = randstring();
  var messages = ['A', 'B', 'C', 'D'];

  var cosmo = new Cosmopolite(null, randstring());

  var sendNextMessage = function() {
    if (messages.length) {
      cosmo.sendMessage(subject, messages.shift()).then(sendNextMessage);
    } else {
      cosmo.subscribe(subject, 1).then(function() {
        cosmo.subscribe(subject, 2).then(function() {
          var fetched = cosmo.getMessages(subject);
          assert.equal(fetched.length, 2, 'two messages');
          assert.equal(fetched[0]['message'], 'C', 'message 0: C matches');
          assert.equal(fetched[1]['message'], 'D', 'message 1: D matches');
          cosmo.shutdown();
          QUnit.start();
        });
      });
    }
  };

  sendNextMessage();
});

QUnit.asyncTest('Reconnect channel', function(assert) {
  assert.expect(5);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('connect', function(e) {
    assert.ok(true, 'onConnect fired');
  });

  cosmo.addEventListener('disconnect', function(e) {
    assert.ok(true, 'onDisconnect fired');
  });

  cosmo.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject, 'subject matches');
    assert.equal(e.detail['message'], message, 'message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.subscribe(subject, 0).then(function() {
    // Reach inside to forcefully close the socket
    cosmo.socket_.close();
    cosmo.sendMessage(subject, message);
  });
});

QUnit.asyncTest('subscribe ACL', function(assert) {
  assert.expect(2);

  var subject = randstring();

  logout(function() {
    var tempCosmo = new Cosmopolite(null, randstring());
    tempCosmo.getProfile().then(function(tempProfile) {
      tempCosmo.shutdown();

      var cosmo = new Cosmopolite(null, randstring());
      cosmo.getProfile().then(function(profile) {
        cosmo.subscribe({
          'name': subject,
          'readable_only_by': profile
        }).then(function() {
          assert.ok(true, 'correct ACL succeeds');

          cosmo.subscribe({
            'name': subject,
            'readable_only_by': tempProfile
          }).then(null, function() {
            assert.ok(true, 'bad ACL fails');
            cosmo.shutdown();
            QUnit.start();
          });

        });
      });
    });
  });
});

QUnit.asyncTest('sendMessage ACL', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message = randstring();

  logout(function() {
    var tempCosmo = new Cosmopolite(null, randstring());
    tempCosmo.getProfile().then(function(tempProfile) {
      tempCosmo.shutdown();

      var cosmo = new Cosmopolite(null, randstring());
      cosmo.getProfile().then(function(profile) {
        cosmo.sendMessage({
          'name': subject,
          'writable_only_by': profile
        }, message).then(function() {
          assert.ok(true, 'correct ACL succeeds');

          cosmo.sendMessage({
            'name': subject,
            'writable_only_by': tempProfile
          }, message).then(null, function() {
            assert.ok(true, 'bad ACL fails');
            cosmo.shutdown();
            QUnit.start();
          });

        });
      });
    });
  });
});

QUnit.asyncTest('"me" ACL', function(assert) {
  assert.expect(7);

  var subject = {
    'name': randstring(),
    'readable_only_by': 'me',
    'writable_only_by': 'me'
  };
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject['name'],
        'subject matches');
    assert.equal(e.detail['subject']['readable_only_by'], 'me',
        'readable_only_by matches');
    assert.equal(e.detail['subject']['writable_only_by'], 'me',
        'writable_only_by matches');
    assert.equal(e.detail['message'], message, 'message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.sendMessage(subject, message).then(function(msg) {
    assert.equal(msg['subject']['name'], subject['name'],
        'subject matches');
    assert.equal(msg['subject']['readable_only_by'], 'me',
        'readable_only_by matches');
    assert.equal(msg['subject']['writable_only_by'], 'me',
        'writable_only_by matches');
  });
  cosmo.subscribe(subject, -1);
});

QUnit.asyncTest('pin/unpin', function(assert) {
  assert.expect(5);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('pin', function(e) {
    assert.equal(subject, e.detail['subject']['name'],
        'onPin: subject matches');
    assert.equal(message, e.detail['message'],
        'onPin: message matches');
    assert.equal(cosmo.getPins(subject).length, 1);
    pin.then(function(id) {
      cosmo.unpin(id);
    });
  });

  cosmo.addEventListener('unpin', function(e) {
    assert.equal(subject, e.detail['subject']['name'],
        'onUnpin: subject matches');
    assert.equal(message, e.detail['message'],
        'onUnpin: message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.subscribe(subject);
  var pin = cosmo.pin(subject, message);
});

QUnit.asyncTest('Repin', function(assert) {
  assert.expect(8);

  var subject = randstring();
  var message = randstring();

  var pins = 0;

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('pin', function(e) {
    assert.equal(subject, e.detail['subject']['name'],
        'onPin: subject matches');
    assert.equal(message, e.detail['message'],
        'onPin: message matches');
    assert.equal(cosmo.getPins(subject).length, 1);
    if (++pins == 1) {
      cosmo.socket_.close();
    } else {
      cosmo.shutdown();
      QUnit.start();
    }
  });

  cosmo.addEventListener('unpin', function(e) {
    assert.equal(subject, e.detail['subject']['name'],
        'onUnpin: subject matches');
    assert.equal(message, e.detail['message'],
        'onUnpin: message matches');
  });

  cosmo.subscribe(subject);
  var pin = cosmo.pin(subject, message);
});

QUnit.asyncTest('Duplicate subject', function(assert) {
  assert.expect(4);

  var subject = randstring();
  var message1 = randstring();
  var message2 = randstring();

  var messages = 0;

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('connect', function(e) {
    cosmo.sendMessage(subject, message1);
    cosmo.sendMessage(subject, message2);
    cosmo.subscribe(subject, -1);
  });

  cosmo.addEventListener('message', function(e) {
    assert.equal(subject, e.detail['subject']['name'], 'subject matches');
    if (e.detail['message'] == message1) {
      assert.equal(message1, e.detail['message'], 'message1 matches');
    } else {
      assert.equal(message2, e.detail['message'], 'message2 matches');
    }
    if (++messages == 2) {
      cosmo.shutdown();
      QUnit.start();
    }
  });
});

QUnit.asyncTest('Multiple event listeners', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.ok(true, 'first callback fired');
  });

  cosmo.addEventListener('message', function(e) {
    assert.ok(true, 'second callback fired');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.sendMessage(subject, message);
  cosmo.subscribe(subject, -1);
});

QUnit.asyncTest('stopImmediatePropagation', function(assert) {
  assert.expect(1);

  var subject = randstring();
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.ok(true, 'first callback fired');
    e.stopImmediatePropagation();
    window.setTimeout(function() {
      cosmo.shutdown();
      QUnit.start();
    }, 500);
  });

  cosmo.addEventListener('message', function(e) {
    assert.ok(false, 'second callback fired');
  });

  cosmo.sendMessage(subject, message);
  cosmo.subscribe(subject, -1);
});

QUnit.asyncTest('Local subject -- Message round trip', function(assert) {
  assert.expect(3);

  var subject = {
    'name': randstring(),
    'local': true
  };
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject['name'],
        'subject matches');
    assert.ok(e.detail['subject']['local'], 'subject still local');
    assert.equal(e.detail['message'], message, 'message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.subscribe(subject, -1);
  cosmo.sendMessage(subject, message);
});

QUnit.asyncTest('Local subject -- Subject is distinct', function(assert) {
  assert.expect(1);

  var subject1 = {
    'name': randstring(),
    'local': true
  };
  var subject2 = subject1['name'];
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('message', function(e) {
    assert.ok(false, 'message received on wrong subject');
  });

  cosmo.subscribe(subject2, -1).then(function() {
    assert.ok(true, 'subscribe resolved');
    cosmo.sendMessage(subject1, message);
    window.setTimeout(function() {
      cosmo.shutdown();
      QUnit.start();
    }, 5000);
  });
});

QUnit.asyncTest('Local subject -- ACLs are rejected', function(assert) {
  assert.expect(4);

  var subject_read = {
    'name': randstring(),
    'readable_only_by': 'foo',
    'local': true
  };
  var subject_write = {
    'name': randstring(),
    'writable_only_by': 'foo',
    'local': true
  };
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.subscribe(subject_read, -1).then(function() {
    assert.ok(false, 'subscribe of readable_only_by/local resolved');
  }).catch(function() {
    assert.ok(true, 'subscribe of readable_only_by/local failed');
  });

  cosmo.subscribe(subject_write, -1).then(function() {
    assert.ok(false, 'subscribe of writable_only_by/local resolved');
  }).catch(function() {
    assert.ok(true, 'subscribe of writable_only_by/local failed');
  });

  cosmo.sendMessage(subject_read, message).then(function() {
    assert.ok(false, 'sendMessage of readable_only_by/local resolved');
  }).catch(function() {
    assert.ok(true, 'sendMessage of readable_only_by/local failed');
  });

  cosmo.sendMessage(subject_write, message).then(function() {
    assert.ok(false, 'sendMessage of writable_only_by/local resolved');
  }).catch(function() {
    assert.ok(true, 'sendMessage of writable_only_by/local failed');
    cosmo.shutdown();
    QUnit.start();
  });
});

QUnit.asyncTest('Local subject -- pin/unpin', function(assert) {
  assert.expect(7);

  var subject = {
    'name': randstring(),
    'local': true
  };
  var message = randstring();

  var cosmo = new Cosmopolite(null, randstring());

  cosmo.addEventListener('pin', function(e) {
    assert.equal(subject['name'], e.detail['subject']['name'],
        'onPin: subject matches');
    assert.ok(e.detail['subject']['local'], 'onPin: local set');
    assert.equal(message, e.detail['message'],
        'onPin: message matches');
    assert.equal(cosmo.getPins(subject).length, 1);
    pin.then(function(id) {
      cosmo.unpin(id);
    });
  });

  cosmo.addEventListener('unpin', function(e) {
    assert.equal(subject['name'], e.detail['subject']['name'],
        'onUnpin: subject matches');
    assert.ok(e.detail['subject']['local'], 'onUnpin: local set');
    assert.equal(message, e.detail['message'],
        'onUnpin: message matches');
    cosmo.shutdown();
    QUnit.start();
  });

  cosmo.subscribe(subject);
  var pin = cosmo.pin(subject, message);
});




module('dev_appserver only');

QUnit.asyncTest('Login', function(assert) {
  assert.expect(3);

  var anonymousProfile;

  logout(function() {
    var cosmo = new Cosmopolite(null, randstring());

    cosmo.addEventListener('login', function(e) {
      assert.ok(true, 'onLogin fired');
      assert.notEqual(anonymousProfile, cosmo.currentProfile(),
          'profile changed');
      cosmo.shutdown();
      logout();
      QUnit.start();
    });

    cosmo.addEventListener('logout', function(e) {
      assert.ok(true, 'onLogout fired');
      anonymousProfile = cosmo.currentProfile();
      // Entirely magic URL that sets the login cookie and redirects.
      window.open(
          '/_ah/login?email=test%40example.com&action=Login' +
          '&continue=/cosmopolite/static/login_complete.html');
    });
  });
});

QUnit.asyncTest('Profile merge', function(assert) {
  assert.expect(6);

  var subject = randstring();
  var message = randstring();

  var messages = 0;

  logout(function() {
    var cosmo = new Cosmopolite(null, randstring());

    cosmo.addEventListener('login', function(e) {
      cosmo.subscribe(subject, -1);
    });

    cosmo.addEventListener('message', function(e) {
      messages++;
      assert.equal(e.detail['subject']['name'], subject,
          'message #' + messages + ': subject matches');
      assert.equal(e.detail['message'], message,
          'message #' + messages + ': message matches');
      assert.equal(e.detail['sender'], cosmo.currentProfile(),
          'message #' + messages + ': profile matches');
      if (messages == 1) {
        cosmo.unsubscribe(subject);
        // Entirely magic URL that sets the login cookie and redirects.
        window.open(
            '/_ah/login?email=test%40example.com&action=Login' +
            '&continue=/cosmopolite/static/login_complete.html');
      }
      if (messages == 2) {
        cosmo.shutdown();
        QUnit.start();
      }
    });

    cosmo.sendMessage(subject, message);
    cosmo.subscribe(subject, -1);
  });
});

QUnit.asyncTest('Two channels, one client', function(assert) {
  assert.expect(2);

  var namespace = randstring();
  var subject = randstring();
  var message = randstring();

  var cosmo1 = new Cosmopolite(null, namespace);

  cosmo1.addEventListener('message', function(e) {
    assert.equal(e.detail['subject']['name'], subject, 'subject matches');
    assert.equal(e.detail['message'], message, 'message matches');
    cosmo1.shutdown();
    QUnit.start();
  });

  cosmo1.subscribe(subject).then(function() {
    var cosmo2 = new Cosmopolite(null, namespace);
    cosmo2.sendMessage(subject, message).then(function() {
      cosmo2.shutdown();
    });
  });
});

QUnit.asyncTest('subscribe admin ACL', function(assert) {
  assert.expect(2);

  var subject = randstring();

  logout(function() {
    var cosmo = new Cosmopolite(null, randstring());

    cosmo.addEventListener('login', function(e) {
      cosmo.subscribe({
        'name': subject,
        'readable_only_by': 'admin'
      }).then(function() {
        assert.ok(true, 'logged in succeeds');

        cosmo.shutdown();
        QUnit.start();
      });
    });

    cosmo.subscribe({
      'name': subject,
      'readable_only_by': 'admin'
    }).then(null, function() {
      assert.ok(true, 'logged out fails');

      window.open(
          '/_ah/login?email=test%40example.com&admin=True&action=Login' +
          '&continue=/cosmopolite/static/login_complete.html');
    });
  });
});

QUnit.asyncTest('sendMessage admin ACL', function(assert) {
  assert.expect(2);

  var subject = randstring();
  var message = randstring();

  logout(function() {
    var cosmo = new Cosmopolite(null, randstring());

    cosmo.addEventListener('login', function(e) {
      cosmo.sendMessage({
        'name': subject,
        'writable_only_by': 'admin'
      }, message).then(function() {
        assert.ok(true, 'logged in succeeds');

        cosmo.shutdown();
        QUnit.start();
      });
    });

    cosmo.sendMessage({
      'name': subject,
      'writable_only_by': 'admin'
    }, message).then(null, function() {
      assert.ok(true, 'logged out fails');

      window.open(
          '/_ah/login?email=test%40example.com&admin=True&action=Login' +
          '&continue=/cosmopolite/static/login_complete.html');
    });
  });
});


QUnit.module('Hogfather');

QUnit.asyncTest('Construct/shutdown', function(assert) {
  assert.expect(4);

  var cosmo = new Cosmopolite(null, randstring());
  assert.ok(true, 'new Cosmopolite() succeeds');

  var hogfather = new Hogfather(cosmo, randstring());
  assert.ok(true, 'new Hogfather()) succeeds');

  window.setTimeout(function() {
    hogfather.shutdown();
    assert.ok(true, 'Hogfather.shutdown() succeeds');

    cosmo.shutdown();
    assert.ok(true, 'Cosmopolite.shutdown() succeeds');

    QUnit.start();
  }, 10 * 1000);

});
