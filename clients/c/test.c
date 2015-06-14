#include <unistd.h>

#include "cosmopolite.h"

#define RUN_TEST(func) run_test(#func, func)

#define ANSI_COLOR_RED     "\x1b[31m"
#define ANSI_COLOR_GREEN   "\x1b[32m"
#define ANSI_COLOR_YELLOW  "\x1b[33m"
#define ANSI_COLOR_RESET   "\x1b[0m"

void on_message(const json_t *message, void *passthrough) {
  printf("new message: %lld\n", json_integer_value(json_object_get(message, "id")));
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

bool message_round_trip() {
  cosmo *client = create_client();

  json_t *subject = random_subject(NULL, NULL);
  cosmo_subscribe(client, subject, -1, 0);

  json_decref(subject);
  cosmo_shutdown(client);
  return true;
}

int main(int argc, char *argv[]) {
  RUN_TEST(test_create_destroy);
  RUN_TEST(message_round_trip);
  return 0;
}
