#include <assert.h>
#include <pthread.h>
#include <stdlib.h>

#include "promise.h"

struct promise {
  bool will_wait;
  promise_callback on_success;
  promise_callback on_failure;
  void *passthrough;

  bool fulfilled;
  pthread_mutex_t lock;
  pthread_cond_t cond;

  bool success;
  void *result;
};

promise *promise_create(bool will_wait, promise_callback on_success, promise_callback on_failure, void *passthrough) {
  promise *promise_obj = malloc(sizeof(*promise_obj));
  promise_obj->will_wait = will_wait;
  promise_obj->on_success = on_success;
  promise_obj->on_failure = on_failure;
  promise_obj->passthrough = passthrough;

  promise_obj->fulfilled = false;
  assert(!pthread_mutex_init(&promise_obj->lock, NULL));
  assert(!pthread_cond_init(&promise_obj->cond, NULL));
  return promise_obj;
}

static void promise_destroy(promise *promise_obj) {
  assert(!pthread_mutex_destroy(&promise_obj->lock));
  assert(!pthread_cond_destroy(&promise_obj->cond));
  free(promise_obj);
}

bool promise_wait(promise *promise_obj, void **result) {
  assert(promise_obj);
  assert(!pthread_mutex_lock(&promise_obj->lock));
  assert(promise_obj->will_wait);
  while (!promise_obj->fulfilled) {
    pthread_cond_wait(&promise_obj->cond, &promise_obj->lock);
  }
  assert(!pthread_mutex_unlock(&promise_obj->lock));

  // promise_obj is now filled in, and owned solely by us.
  bool success = promise_obj->success;
  if (result) {
    *result = promise_obj->result;
  }
  promise_destroy(promise_obj);
  return success;
}

void promise_complete(promise *promise_obj, void *result, bool success) {
  if (!promise_obj) {
    return;
  }

  assert(!pthread_mutex_lock(&promise_obj->lock));

  if (success && promise_obj->on_success) {
    promise_obj->on_success(promise_obj->passthrough, result);
  } else if (!success && promise_obj->on_failure) {
    promise_obj->on_failure(promise_obj->passthrough, result);
  }

  if (promise_obj->will_wait) {
    // We don't own promise_obj; pass to promise_wait()
    promise_obj->result = result;
    promise_obj->success = success;
    promise_obj->fulfilled = true;
    assert(!pthread_cond_signal(&promise_obj->cond));
    assert(!pthread_mutex_unlock(&promise_obj->lock));
  } else {
    // We own promise_obj
    assert(!pthread_mutex_unlock(&promise_obj->lock));
    promise_destroy(promise_obj);
  }
}

void promise_succeed(promise *promise_obj, void *result) {
  promise_complete(promise_obj, result, true);
}

void promise_fail(promise *promise_obj, void *result) {
  promise_complete(promise_obj, result, false);
}
