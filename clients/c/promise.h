#ifndef _PROMISE_H
#define _PROMISE_H

#include <stdbool.h>

typedef struct promise promise;

// (passthrough, result)
typedef void (*promise_callback)(void *, void *);
typedef void (*promise_cleanup)(void *);

promise *promise_create(promise_callback on_success, promise_callback on_failure, void *passthrough);
bool promise_wait(promise *promise_obj, void **result);
void promise_destroy(promise *promise_obj);

void promise_complete(promise *promise_obj, void *result, promise_cleanup cleanup, bool success);
// Shortcuts for promise_complete()
void promise_succeed(promise *promise_obj, void *result, promise_cleanup cleanup);
void promise_fail(promise *promise_obj, void *result, promise_cleanup cleanup);

#endif
