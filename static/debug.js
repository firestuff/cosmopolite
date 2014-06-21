var cosmo;
var elements = {};
var selectedSubject = null;
var pins = {};
var senders = {};

var onReady = function() {
  var elementIDs = [
    'connectionStatus',
    'loginAction',
    'loginStatus',
    'messageList',
    'messageText',
    'pinList',
    'pinText',
    'readID',
    'subjectList',
    'subjectName',
    'username',
    'writeID'
  ];
  for (var i = 0; i < elementIDs.length; i++) {
    elements[elementIDs[i]] = document.getElementById(elementIDs[i]);
  }

  var callbacks = {
    'onConnect': onConnect,
    'onDisconnect': onDisconnect,
    'onLogin': onLogin,
    'onLogout': onLogout,
    'onMessage': onMessage,
    'onPin': onPin,
    'onUnpin': onUnpin,
  }
  cosmo = new Cosmopolite(callbacks, null, null, 'UA-37845853-3');
  cosmo.trackEvent('send', 'pageview');

  elements['messageText'].addEventListener('keypress', messageKeyPress);
  elements['pinText'].addEventListener('keypress', pinKeyPress);
  document.getElementById('pin').addEventListener('click', pin);
  document.getElementById('sendMessage').addEventListener('click', sendMessage);
  document.getElementById('sendJSON').addEventListener('click', sendJSON);
  document.getElementById('subscribe').addEventListener('click', subscribe);
};

document.addEventListener('DOMContentLoaded', onReady);

var onConnect = function() {
  elements['connectionStatus'].innerHTML = '';
  elements['connectionStatus'].appendChild(
      document.createTextNode('Connected'));
};

var onDisconnect = function() {
  elements['connectionStatus'].innerHTML = '';
  elements['connectionStatus'].appendChild(
      document.createTextNode('Disconnected'));
};

var onLogin = function(username, logout_url) {
  elements['loginStatus'].innerHTML = '';
  elements['loginStatus'].appendChild(document.createTextNode('Logged in'));

  elements['username'].innerHTML = '';
  elements['username'].appendChild(document.createTextNode(username));

  elements['loginAction'].innerHTML = '';
  var link = document.createElement('a');
  link.href = logout_url;
  link.target = '_blank';
  link.appendChild(document.createTextNode('Log out'));
  elements['loginAction'].appendChild(link);
};

var onLogout = function(login_url) {
  elements['loginStatus'].innerHTML = '';
  elements['loginStatus'].appendChild(
      document.createTextNode('Not logged in'));

  elements['username'].innerHTML = '';

  elements['loginAction'].innerHTML = '';
  var link = document.createElement('a');
  link.href = login_url;
  link.target = '_blank';
  link.appendChild(document.createTextNode('Log in'));
  elements['loginAction'].appendChild(link);
};

var onMessage = function(msg) {
  addToList(msg, elements['messageList']);
};

var onPin = function(msg) {
  var item = addToList(msg, elements['pinList'], pins);
  if (msg['sender'] == cosmo.currentProfile()) {
    item.addEventListener('contextmenu', deletePin);
  }
};

var onUnpin = function(msg) {
  var item = pins[msg['id']];
  item.parentNode.removeChild(item);
};

var selectSubject = function() {
  if (selectedSubject == this) {
    return;
  }
  if (selectedSubject) {
    selectedSubject.className = '';
  }
  this.className = 'selected';
  selectedSubject = this;

  elements['messageList'].innerHTML = '';
  cosmo.getMessages(this.subject).forEach(onMessage);

  elements['pinList'].innerHTML = '';
  cosmo.getPins(this.subject).forEach(onPin);
};

var addToList = function(msg, list, trackobj) {
  if (selectedSubject && (
        msg['subject']['name'] != selectedSubject.subject['name'] ||
        msg['subject']['readable_only_by'] !=
          selectedSubject.subject['readable_only_by'] ||
        msg['subject']['writable_only_by'] !=
          selectedSubject.subject['writable_only_by'])) {
    return;
  }

  var item = document.createElement('item');
  item.message = msg;

  {
    var row = document.createElement('row');
    row.appendChild(document.createTextNode('Sender: '));
    row.appendChild(document.createTextNode(senderID(msg)));
    item.appendChild(row);
  }
  {
    var row = document.createElement('row');
    row.appendChild(document.createTextNode('Created: '));
    row.appendChild(document.createTextNode(
          (new Date(msg['created'] * 1000)).toString()));
    item.appendChild(row);
  }
  item.appendChild(document.createTextNode(JSON.stringify(msg['message'])));

  list.insertBefore(item, list.firstChild);

  if (trackobj) {
    trackobj[msg['id']] = item;
  }

  return item;
};

var deletePin = function(e) {
  cosmo.unpin(this.message['sender_message_id']);
  e.preventDefault();
};

var deleteSubject = function(e) {
  cosmo.unsubscribe(this.subject);
  if (selectedSubject == this) {
    selectedSubject = null;
    elements['messageList'].innerHTML = '';
    elements['pinList'].innerHTML = '';
  }
  this.parentNode.removeChild(this);
  e.preventDefault();
};

var addSubject = function(subject, error) {
  var item = document.createElement('item');
  item.subject = subject;

  item.appendChild(document.createTextNode(subject['name']));

  {
    var row = document.createElement('row');
    row.appendChild(document.createTextNode('Read: '));
    row.appendChild(
        document.createTextNode(elements['readID'].selectedOptions[0].text));
    item.appendChild(row);
  }

  {
    var row = document.createElement('row');
    row.appendChild(document.createTextNode('Write: '));
    row.appendChild(
      document.createTextNode(elements['writeID'].selectedOptions[0].text));
    item.appendChild(row);
  }

  item.addEventListener('click', selectSubject);
  item.addEventListener('contextmenu', deleteSubject);
  if (error) {
    var error = document.createElement('error');
    error.appendChild(item);
    elements['subjectList'].appendChild(error);
  } else {
    elements['subjectList'].appendChild(item);
  }

  if (!selectedSubject) {
    selectSubject.bind(item)();
  }
};

var subscribe = function() {
  var subject = {
    'name': elements['subjectName'].value
  };
  if (elements['readID'].value != '(all)') {
    var value = elements['readID'].value;
    subject['readable_only_by'] = value;
  }
  if (elements['writeID'].value != '(all)') {
    var value = elements['writeID'].value;
    subject['writable_only_by'] = value;
  }
  cosmo.subscribe(subject, -1).then(function() {
    addSubject(subject);
  }, function() {
    addSubject(subject, true);
  });
};

var sendMessage = function() {
  if (!selectedSubject) {
    alert('Please select a subject.');
    return;
  }
  cosmo.sendMessage(selectedSubject.subject, elements['messageText'].value);
  elements['messageText'].value = '';
};

var sendJSON = function() {
  if (!selectedSubject) {
    alert('Please select a subject.');
    return;
  }
  var parsed;
  try {
    parsed = JSON.parse(elements['messageText'].value);
  } catch (err) {
    alert('Invalid JSON: ' + err.message);
    return;
  }
  cosmo.sendMessage(selectedSubject.subject, parsed);
  elements['messageText'].value = '';
};

var messageKeyPress = function(e) {
  if (e.keyCode == 13) {
    sendMessage();
  }
};

var pin = function() {
  if (!selectedSubject) {
    alert('Please select a subject.');
    return;
  }
  cosmo.pin(selectedSubject.subject, elements['pinText'].value);
  elements['pinText'].value = '';
};

var pinKeyPress = function(e) {
  if (e.keyCode == 13) {
    pin();
  }
};

var senderID = function(msg) {
  var id = Math.abs(msg['sender'].hashCode() % 1000000);
  if (msg['sender'] == cosmo.currentProfile()) {
    return 'me';
  }
  if (!senders[id]) {
    senders[id] = msg['sender'];
    {
      var option = document.createElement('option');
      option.value = msg['sender'];
      option.appendChild(document.createTextNode(id));
      elements['readID'].appendChild(option);
    }
    {
      var option = document.createElement('option');
      option.value = msg['sender'];
      option.appendChild(document.createTextNode(id));
      elements['writeID'].appendChild(option);
    }
  }
  return id;
};
