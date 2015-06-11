#include <unistd.h>

#include "cosmopolite.h"

void on_message(const json_t *message, void *passthrough) {
  printf("new message: %lld\n", json_integer_value(json_object_get(message, "id")));
}

int main(int argc, char *argv[]) {
  char client_id[COSMO_UUID_SIZE];
  cosmo_uuid(client_id);

  cosmo_callbacks callbacks = {
    .message = on_message
  };

  cosmo *instance = cosmo_create("https://playground.cosmopolite.org/cosmopolite", client_id, &callbacks, NULL);
  json_t *subject = cosmo_subject("foobar", NULL, NULL);
  cosmo_subscribe(instance, subject, -1, 0);
  json_decref(subject);
  sleep(20);
  cosmo_shutdown(instance);

  return 0;
}
