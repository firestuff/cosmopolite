#include <assert.h>
#include <unistd.h>

#include "cosmopolite.h"
#include "cosmopolite-int.h"

#define RUN_TEST(func) run_test(#func, func)

#define ANSI_COLOR_RED     "\x1b[31m"
#define ANSI_COLOR_GREEN   "\x1b[32m"
#define ANSI_COLOR_YELLOW  "\x1b[33m"
#define ANSI_COLOR_RESET   "\x1b[0m"

typedef struct {
  pthread_mutex_t lock;
  pthread_cond_t cond;

  const json_t *last_message;
  bool logout_fired;
  bool connect_fired;
  bool disconnect_fired;
} test_state;


void on_connect(void *passthrough) {
  test_state *state = passthrough;
  assert(!pthread_mutex_lock(&state->lock));
  state->connect_fired = true;
  assert(!pthread_cond_signal(&state->cond));
  assert(!pthread_mutex_unlock(&state->lock));
}

void on_disconnect(void *passthrough) {
  test_state *state = passthrough;
  assert(!pthread_mutex_lock(&state->lock));
  state->disconnect_fired = true;
  assert(!pthread_cond_signal(&state->cond));
  assert(!pthread_mutex_unlock(&state->lock));
}

void on_logout(void *passthrough) {
  test_state *state = passthrough;
  assert(!pthread_mutex_lock(&state->lock));
  state->logout_fired = true;
  assert(!pthread_cond_signal(&state->cond));
  assert(!pthread_mutex_unlock(&state->lock));
}

void on_message(const json_t *message, void *passthrough) {
  test_state *state = passthrough;
  assert(!pthread_mutex_lock(&state->lock));
  state->last_message = message;
  assert(!pthread_cond_signal(&state->cond));
  assert(!pthread_mutex_unlock(&state->lock));
}

const json_t *wait_for_message(test_state *state) {
  assert(!pthread_mutex_lock(&state->lock));
  while (!state->last_message) {
    assert(!pthread_cond_wait(&state->cond, &state->lock));
  }

  const json_t *ret = state->last_message;
  state->last_message = NULL;
  assert(!pthread_mutex_unlock(&state->lock));
  return ret;
}

void wait_for_logout(test_state *state) {
  assert(!pthread_mutex_lock(&state->lock));
  while (!state->logout_fired) {
    assert(!pthread_cond_wait(&state->cond, &state->lock));
  }

  state->logout_fired = false;
  assert(!pthread_mutex_unlock(&state->lock));
}

void wait_for_connect(test_state *state) {
  assert(!pthread_mutex_lock(&state->lock));
  while (!state->connect_fired) {
    assert(!pthread_cond_wait(&state->cond, &state->lock));
  }

  state->connect_fired = false;
  assert(!pthread_mutex_unlock(&state->lock));
}

void wait_for_disconnect(test_state *state) {
  assert(!pthread_mutex_lock(&state->lock));
  while (!state->disconnect_fired) {
    assert(!pthread_cond_wait(&state->cond, &state->lock));
  }

  state->disconnect_fired = false;
  assert(!pthread_mutex_unlock(&state->lock));
}

test_state *create_test_state() {
  test_state *ret = malloc(sizeof(test_state));
  assert(ret);

  assert(!pthread_mutex_init(&ret->lock, NULL));
  assert(!pthread_cond_init(&ret->cond, NULL));
  ret->last_message = NULL;
  ret->logout_fired = false;
  ret->connect_fired = false;
  ret->disconnect_fired = false;
  return ret;
}

void destroy_test_state(test_state *state) {
  assert(!pthread_mutex_destroy(&state->lock));
  assert(!pthread_cond_destroy(&state->cond));
  free(state);
}

cosmo *create_client(test_state *state) {
  char client_id[COSMO_UUID_SIZE];
  cosmo_uuid(client_id);

  cosmo_callbacks callbacks = {
    .connect = on_connect,
    .disconnect = on_disconnect,
    .logout = on_logout,
    .message = on_message,
  };

  cosmo *ret = cosmo_create("https://playground.cosmopolite.org/cosmopolite", client_id, &callbacks, state);
  // ret->debug = true;
  return ret;
}

json_t *random_subject(const char *readable_only_by, const char *writeable_only_by) {
  char uuid[COSMO_UUID_SIZE];
  cosmo_uuid(uuid);
  char name[COSMO_UUID_SIZE + 20];
  sprintf(name, "/test/%s", uuid);
  return cosmo_subject(name, readable_only_by, writeable_only_by);
}

json_t *random_message() {
  char uuid[COSMO_UUID_SIZE];
  cosmo_uuid(uuid);
  return json_string(uuid);
}

void run_test(const char *func_name, bool (*test)(test_state *)) {
  test_state *state = create_test_state();
  fprintf(stderr, ANSI_COLOR_YELLOW "%50s" ANSI_COLOR_RESET ": ", func_name);
  if (test(state)) {
    fprintf(stderr, ANSI_COLOR_GREEN "PASS" ANSI_COLOR_RESET "\n");
  } else {
    fprintf(stderr, ANSI_COLOR_RED "FAIL" ANSI_COLOR_RESET "\n");
  }
  destroy_test_state(state);
}

bool test_create_shutdown(test_state *state) {
  cosmo *client = create_client(state);
  cosmo_shutdown(client);
  return true;
}

bool test_message_round_trip(test_state *state) {
  cosmo *client = create_client(state);

  json_t *subject = random_subject(NULL, NULL);
  cosmo_subscribe(client, subject, -1, 0);

  json_t *message_out = random_message();
  cosmo_send_message(client, subject, message_out);
  const json_t *message_in = wait_for_message(state);
  assert(json_equal(message_out, json_object_get(message_in, "message")));

  json_decref(subject);
  json_decref(message_out);

  cosmo_shutdown(client);
  return true;
}

bool test_connect_logout_fires(test_state *state) {
  cosmo *client = create_client(state);
  wait_for_connect(state);
  wait_for_logout(state);
  cosmo_shutdown(client);
  return true;
}

bool test_reconnect(test_state *state) {
  cosmo *client = create_client(state);
  wait_for_connect(state);
  assert(!curl_easy_setopt(client->curl, CURLOPT_TIMEOUT_MS, 1));
  wait_for_disconnect(state);
  assert(!curl_easy_setopt(client->curl, CURLOPT_TIMEOUT_MS, 10000));
  wait_for_connect(state);
  cosmo_shutdown(client);
  return true;
}

bool test_resubscribe(test_state *state) {
  cosmo *client = create_client(state);

  json_t *subject = random_subject(NULL, NULL);
  cosmo_subscribe(client, subject, -1, 0);

  json_t *message_out = random_message();
  cosmo_send_message(client, subject, message_out);
  const json_t *message_in = wait_for_message(state);
  assert(json_equal(message_out, json_object_get(message_in, "message")));
  json_decref(message_out);

  // Reach in and reset the instance ID so we look new.
  cosmo_uuid(client->instance_id);

  message_out = random_message();
  cosmo_send_message(client, subject, message_out);
  message_in = wait_for_message(state);
  assert(json_equal(message_out, json_object_get(message_in, "message")));
  json_decref(message_out);

  json_decref(subject);

  cosmo_shutdown(client);
  return true;
}

bool test_bulk_subscribe(test_state *state) {
  cosmo *client = create_client(state);

  json_t *subject1 = random_subject(NULL, NULL);
  json_t *subject2 = random_subject(NULL, NULL);
  json_t *subjects = json_pack("[oo]", subject1, subject2);
  cosmo_subscribe(client, subjects, -1, 0);

  json_t *message_out = random_message();
  cosmo_send_message(client, subject1, message_out);
  const json_t *message_in = wait_for_message(state);
  assert(json_equal(message_out, json_object_get(message_in, "message")));
  json_decref(message_out);

  message_out = random_message();
  cosmo_send_message(client, subject2, message_out);
  message_in = wait_for_message(state);
  assert(json_equal(message_out, json_object_get(message_in, "message")));
  json_decref(message_out);

  json_decref(subjects);

  cosmo_shutdown(client);
  return true;
}

int main(int argc, char *argv[]) {
  RUN_TEST(test_create_shutdown);
  RUN_TEST(test_connect_logout_fires);
  RUN_TEST(test_message_round_trip);
  RUN_TEST(test_resubscribe);
  RUN_TEST(test_reconnect);
  RUN_TEST(test_bulk_subscribe);

  return 0;
}
