#ifndef _COSMOPOLITE_INT_H
#define _COSMOPOLITE_INT_H

// Declarations that aren't in the public API but are available to the test suite.

struct cosmo {
  char client_id[COSMO_UUID_SIZE];
  char instance_id[COSMO_UUID_SIZE];
  cosmo_callbacks callbacks;
  void *passthrough;

  pthread_mutex_t lock;
  pthread_cond_t cond;
  bool shutdown;
  char *profile;
  json_t *command_queue;
  json_t *ack;
  json_t *subscriptions;
  uint64_t next_delay_ms;
  unsigned int seedp;

  enum {
    INITIAL_CONNECT,
    CONNECTED,
    DISCONNECTED,
  } connect_state;
  struct timespec last_success;

  enum {
    LOGIN_UNKNOWN,
    LOGGED_OUT,
    LOGGED_IN,
  } login_state;

  pthread_t thread;
  CURL *curl;
};

#endif
