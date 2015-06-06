#ifndef _COSMOPOLITE_H
#define _COSMOPOLITE_H

#include <pthread.h>
#include <jansson.h>

#define COSMO_UUID_SIZE 37

typedef struct {
  char *api_url;
  char client_id[COSMO_UUID_SIZE];
  char instance_id[COSMO_UUID_SIZE];

  pthread_mutex_t lock;
  pthread_cond_t cond;
  bool shutdown;
  json_t *command_queue;
  uint64_t next_delay_ms;

  pthread_t thread;
} cosmo;

void cosmo_generate_uuid(char *uuid);

cosmo *cosmo_create(const char *base_url, const char *client_id);
void cosmo_destroy(cosmo *instance);

json_t *cosmo_subject(const char *name, const char *readable_only_by, const char *writeable_only_by);
void cosmo_subscribe(cosmo *instance, const json_t *subject, const json_int_t messages, const json_int_t last_id);

#endif
