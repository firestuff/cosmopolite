#include <unistd.h>

#include "cosmopolite.h"

int main(int argc, char *argv[]) {
  char client_id[COSMO_UUID_SIZE];
  cosmo_uuid(client_id);
  cosmo *instance = cosmo_create("https://playground.cosmopolite.org/cosmopolite", client_id);
  json_t *subject = cosmo_subject("foobar", NULL, NULL);
  cosmo_subscribe(instance, subject, -1, 0);
  json_t *message = json_string("test from C");
  cosmo_send_message(instance, subject, message);
  json_decref(message);
  json_decref(subject);
  sleep(5);
  printf("profile: %s\n", cosmo_current_profile(instance));
  sleep(120);
  cosmo_shutdown(instance);

  return 0;
}
