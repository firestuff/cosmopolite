#ifndef _COSMOPOLITE_H
#define _COSMOPOLITE_H

#include <curl/curl.h>
#include <jansson.h>
#include <pthread.h>
#include <stdbool.h>

#define COSMO_UUID_SIZE 37

typedef struct {
  char client_id[COSMO_UUID_SIZE];
  char instance_id[COSMO_UUID_SIZE];

  pthread_mutex_t lock;
  pthread_cond_t cond;
  bool shutdown;
  char *profile;
  json_t *command_queue;
  json_t *subscriptions;
  uint64_t next_delay_ms;

  pthread_t thread;
  CURL *curl;
} cosmo;

void cosmo_uuid(char *uuid);

cosmo *cosmo_create(const char *base_url, const char *client_id);
void cosmo_shutdown(cosmo *instance);

const char *cosmo_current_profile(cosmo *instance);

json_t *cosmo_subject(const char *name, const char *readable_only_by, const char *writeable_only_by);
void cosmo_subscribe(cosmo *instance, json_t *subject, const json_int_t messages, const json_int_t last_id);
void cosmo_unsubscribe(cosmo *instance, json_t *subject);
void cosmo_send_message(cosmo *instance, json_t *subject, json_t *message);

json_t *cosmo_get_messages(cosmo *instance, json_t *subject);
json_t *cosmo_get_last_message(cosmo *instance, json_t *subject);

// TODO
json_t *cosmo_get_pins(cosmo *instance, json_t *subject);
void cosmo_pin(cosmo *instance, json_t *subject, json_t *message);
void cosmo_unpin(cosmo *instance, json_t *subject, json_t *message);

#endif
