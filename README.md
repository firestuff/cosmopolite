cosmopolite
===========

See https://www.cosmopolite.org/ for tutorial, reference, etc.

Client/server publish/subscribe and key/value storage for AppEngine.

Components:
* A server API built on the AppEngine Python framework.
* A browser client library written in JavaScript.

Feature overview:
* Near-realtime notification to subscribers of messages published to a "subject"
* Server-side storage of past messages for replay later to clients
* Support for associating a key with a message and for lookup of the most recent
    message for a given key
* Client identification persistence via localStorage tokens or in combination
    with Google account signin
* Complex messages supported via transparent JSON serialization
* Server-side strict ordering of messages
* Client-side message queueing in localStorage and resumption on restart
* Message duplication detection and elimination
* Promise support for notification of client -> server operation completion
