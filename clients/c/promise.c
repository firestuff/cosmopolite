#include <assert.h>
#include <pthread.h>
#include <stdlib.h>

#include "promise.h"

struct promise {
  promise_callback on_success;
  promise_callback on_failure;
  void *passthrough;

  bool fulfilled;
  pthread_mutex_t lock;
  pthread_cond_t cond;

  bool success;
  void *result;
  promise_cleanup cleanup;
};

promise *promise_create(promise_callback on_success, promise_callback on_failure, void *passthrough) {
  promise *promise_obj = malloc(sizeof(*promise_obj));
  promise_obj->on_success = on_success;
  promise_obj->on_failure = on_failure;
  promise_obj->passthrough = passthrough;

  promise_obj->fulfilled = false;
  assert(!pthread_mutex_init(&promise_obj->lock, NULL));
  assert(!pthread_cond_init(&promise_obj->cond, NULL));
  return promise_obj;
}

void promise_destroy(promise *promise_obj) {
  assert(!pthread_mutex_destroy(&promise_obj->lock));
  assert(!pthread_cond_destroy(&promise_obj->cond));
  if (promise_obj->result && promise_obj->cleanup) {
    promise_obj->cleanup(promise_obj->result);
  }
  free(promise_obj);
}

bool promise_wait(promise *promise_obj, void **result) {
  assert(promise_obj);
  assert(!pthread_mutex_lock(&promise_obj->lock));
  while (!promise_obj->fulfilled) {
    pthread_cond_wait(&promise_obj->cond, &promise_obj->lock);
  }
  assert(!pthread_mutex_unlock(&promise_obj->lock));

  bool success = promise_obj->success;
  if (result) {
    *result = promise_obj->result;
  }
  return success;
}

void promise_complete(promise *promise_obj, void *result, promise_cleanup cleanup, bool success) {
  if (!promise_obj) {
    if (result && cleanup) {
      cleanup(result);
    }
    return;
  }

  assert(!pthread_mutex_lock(&promise_obj->lock));

  if (success && promise_obj->on_success) {
    promise_obj->on_success(promise_obj->passthrough, result);
  } else if (!success && promise_obj->on_failure) {
    promise_obj->on_failure(promise_obj->passthrough, result);
  }

  promise_obj->result = result;
  promise_obj->cleanup = cleanup;
  promise_obj->success = success;
  promise_obj->fulfilled = true;
  assert(!pthread_cond_signal(&promise_obj->cond));
  assert(!pthread_mutex_unlock(&promise_obj->lock));
}

void promise_succeed(promise *promise_obj, void *result, promise_cleanup cleanup) {
  promise_complete(promise_obj, result, cleanup, true);
}

void promise_fail(promise *promise_obj, void *result, promise_cleanup cleanup) {
  promise_complete(promise_obj, result, cleanup, false);
}
