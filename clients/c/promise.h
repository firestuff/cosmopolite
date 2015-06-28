#ifndef _PROMISE_H
#define _PROMISE_H

#include <stdbool.h>

typedef struct promise promise;

// (passthrough, result)
typedef void (*promise_callback)(void *, void *);

promise *promise_create(bool will_wait, promise_callback on_success, promise_callback on_failure, void *passthrough);
bool promise_wait(promise *promise_obj, void **result);

void promise_complete(promise *promise_obj, void *result, bool success);
// Shortcuts for promise_complete()
void promise_succeed(promise *promise_obj, void *result);
void promise_fail(promise *promise_obj, void *result);

#endif
