#include <unistd.h>

#include "cosmopolite.h"

int main(int argc, char *argv[]) {
  char client_id[COSMO_UUID_SIZE];
  cosmo_generate_uuid(client_id);
  cosmo *instance = cosmo_create("https://playground.cosmopolite.org/cosmopolite", client_id);
  json_t *subject = cosmo_subject("foobar", NULL, NULL);
  cosmo_subscribe(instance, subject, -1, 0);
  json_decref(subject);
  sleep(120);
  cosmo_destroy(instance);

  return 0;
}
