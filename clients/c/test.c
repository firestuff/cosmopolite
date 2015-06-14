#include <assert.h>
#include <unistd.h>

#include "cosmopolite.h"

#define RUN_TEST(func) run_test(#func, func)

#define ANSI_COLOR_RED     "\x1b[31m"
#define ANSI_COLOR_GREEN   "\x1b[32m"
#define ANSI_COLOR_YELLOW  "\x1b[33m"
#define ANSI_COLOR_RESET   "\x1b[0m"

pthread_mutex_t message_lock;
pthread_cond_t message_cond;
const json_t *last_message;

void on_message(const json_t *message, void *passthrough) {
  assert(!pthread_mutex_lock(&message_lock));
  assert(!last_message);
  last_message = message;
  assert(!pthread_cond_signal(&message_cond));
  assert(!pthread_mutex_unlock(&message_lock));
}

const json_t *wait_for_message() {
  assert(!pthread_mutex_lock(&message_lock));
  if (!last_message) {
    assert(!pthread_cond_wait(&message_cond, &message_lock));
  }

  const json_t *ret = last_message;
  last_message = NULL;
  assert(!pthread_mutex_unlock(&message_lock));
  return ret;
}

cosmo *create_client() {
  char client_id[COSMO_UUID_SIZE];
  cosmo_uuid(client_id);

  cosmo_callbacks callbacks = {
    .message = on_message
  };

  return cosmo_create("https://playground.cosmopolite.org/cosmopolite", client_id, &callbacks, NULL);
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

void run_test(const char *func_name, bool (*test)(void)) {
  fprintf(stderr, ANSI_COLOR_YELLOW "%50s" ANSI_COLOR_RESET ": ", func_name);
  if (test()) {
    fprintf(stderr, ANSI_COLOR_GREEN "PASS" ANSI_COLOR_RESET "\n");
  } else {
    fprintf(stderr, ANSI_COLOR_RED "FAIL" ANSI_COLOR_RESET "\n");
  }
}

bool test_create_destroy() {
  cosmo *client = create_client();
  cosmo_shutdown(client);
  return true;
}

bool test_message_round_trip() {
  cosmo *client = create_client();

  json_t *subject = random_subject(NULL, NULL);
  cosmo_subscribe(client, subject, -1, 0);

  json_t *message_out = random_message();
  cosmo_send_message(client, subject, message_out);
  const json_t *message_in = wait_for_message();
  assert(json_equal(message_out, json_object_get(message_in, "message")));

  json_decref(subject);
  json_decref(message_out);
  cosmo_shutdown(client);
  return true;
}

int main(int argc, char *argv[]) {
  assert(!pthread_mutex_init(&message_lock, NULL));
  assert(!pthread_cond_init(&message_cond, NULL));

  RUN_TEST(test_create_destroy);
  RUN_TEST(test_message_round_trip);

  assert(!pthread_cond_destroy(&message_cond));
  assert(!pthread_mutex_destroy(&message_lock));

  return 0;
}
