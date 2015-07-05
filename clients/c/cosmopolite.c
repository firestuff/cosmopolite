#include <assert.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <time.h>

#include <uuid/uuid.h>

#include "cosmopolite.h"
#include "cosmopolite-int.h"

#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))

#define CYCLE_MS 10000
#define CYCLE_STAGGER_FACTOR 10
#define CONNECT_TIMEOUT_S 60

#ifdef __MACH__
// OS X is missing clock_gettime()
#define CLOCK_MONOTONIC 0
#define CLOCK_REALTIME 0
int clock_gettime(int clk_id, struct timespec *ts) {
    struct timeval tv;
    int err = gettimeofday(&tv, NULL);
    if (err) {
      return err;
    }
    ts->tv_sec  = tv.tv_sec;
    ts->tv_nsec = tv.tv_usec * 1000;
    return 0;
}
#endif

enum {
  SUBSCRIPTION_PENDING,
  SUBSCRIPTION_ACTIVE,
};

typedef struct {
  char *send_buf;
  size_t send_buf_len;

  char *recv_buf;
  size_t recv_buf_len;

  int64_t retry_after;
} cosmo_transfer;

static void cosmo_log(cosmo *instance, const char *fmt, ...) {
  if (!instance->debug) {
    return;
  }

  va_list ap;
  va_start(ap, fmt);

  fprintf(stderr, "%s: ", instance->instance_id);
  vfprintf(stderr, fmt, ap);
  fprintf(stderr, "\n");

  va_end(ap);
}

static void cosmo_append_command(struct cosmo_command **head, struct cosmo_command **tail, struct cosmo_command *command) {
  command->prev = *tail;
  if (command->prev) {
    command->prev->next = command;
  }
  command->next = NULL;
  *tail = command;
  if (!*head) {
    *head = command;
  }
}

static json_t *cosmo_find_subscription(cosmo *instance, json_t *subject) {
  size_t i;
  json_t *subscription;
  json_array_foreach(instance->subscriptions, i, subscription) {
    if (json_equal(json_object_get(subscription, "subject"), subject)) {
      return subscription;
    }
  }
  return NULL;
}

void cosmo_remove_subscription(cosmo *instance, json_t *subject) {
  size_t i;
  json_t *subscription;
  json_array_foreach(instance->subscriptions, i, subscription) {
    if (json_equal(json_object_get(subscription, "subject"), subject)) {
      json_array_remove(instance->subscriptions, i);
      break;
    }
  }
}

static void cosmo_send_command_locked(cosmo *instance, json_t *command, promise *promise_obj) {
  struct cosmo_command *command_obj = malloc(sizeof(*command_obj));
  command_obj->command = command;
  command_obj->promise = promise_obj;
  cosmo_append_command(&instance->command_queue_head, &instance->command_queue_tail, command_obj);
  instance->next_delay_ms = 0;
}

// Takes ownership of command.
static void cosmo_send_command(cosmo *instance, json_t *command, promise *promise_obj) {
  assert(command);
  assert(!pthread_mutex_lock(&instance->lock));
  cosmo_send_command_locked(instance, command, promise_obj);
  assert(!pthread_cond_signal(&instance->cond));
  assert(!pthread_mutex_unlock(&instance->lock));
}

static size_t cosmo_read_callback(void *ptr, size_t size, size_t nmemb, void *userp) {
  cosmo_transfer *transfer = userp;
  size_t to_write = min(transfer->send_buf_len, size * nmemb);
  memcpy(ptr, transfer->send_buf, to_write);
  transfer->send_buf += to_write;
  transfer->send_buf_len -= to_write;
  return to_write;
}

static size_t cosmo_write_callback(void *ptr, size_t size, size_t nmemb, void *userp) {
  cosmo_transfer *transfer = userp;
  size_t to_read = size * nmemb;
  transfer->recv_buf = realloc(transfer->recv_buf, transfer->recv_buf_len + to_read + 1);
  assert(transfer->recv_buf);
  memcpy(transfer->recv_buf + transfer->recv_buf_len, ptr, to_read);
  transfer->recv_buf_len += to_read;
  transfer->recv_buf[transfer->recv_buf_len] = '\0';
  return to_read;
}

static size_t cosmo_header_callback(char *ptr, size_t size, size_t nmemb, void *userp) {
  cosmo_transfer *transfer = userp;
  size_t length = size * nmemb;
#define RETRY_AFTER_HEADER "Retry-After: 0\r\n"
#define RETRY_AFTER_HEADER_SIZE (sizeof(RETRY_AFTER_HEADER) - 1)
  if (length == RETRY_AFTER_HEADER_SIZE &&
      strncasecmp(ptr, RETRY_AFTER_HEADER, RETRY_AFTER_HEADER_SIZE) == 0) {
    transfer->retry_after = 0;
  }
  return length;
}

static char *cosmo_build_rpc(const cosmo *instance, const json_t *commands) {
  json_t *to_send = json_pack("{sssssO}", "client_id", instance->client_id, "instance_id", instance->instance_id, "commands", commands);
  assert(to_send);
  char *ret = json_dumps(to_send, 0);
  assert(ret);
  json_decref(to_send);
  return ret;
}

static bool cosmo_send_http_int(cosmo *instance, cosmo_transfer *transfer) {
  CURLcode res;
 
  assert(!curl_easy_setopt(instance->curl, CURLOPT_POSTFIELDSIZE, transfer->send_buf_len));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_READDATA, transfer));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_WRITEDATA, transfer));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_HEADERDATA, transfer));
  res = curl_easy_perform(instance->curl);

  if (res) {
    return false;
  }

  long return_code;
  assert(curl_easy_getinfo(instance->curl, CURLINFO_RESPONSE_CODE, &return_code) == CURLE_OK);
  if (return_code != 200) {
    return false;
  }

  return true;
}

// Takes ownership of request.
static char *cosmo_send_http(cosmo *instance, char *request) {
  cosmo_transfer transfer = {
    .send_buf = request,
    .send_buf_len = strlen(request),
    .recv_buf = NULL,
    .recv_buf_len = 0,
    .retry_after = -1
  };

  int ret = cosmo_send_http_int(instance, &transfer);

  if (transfer.retry_after >= 0) {
    instance->next_delay_ms = transfer.retry_after * 1000;
  }

  free(request);

  return ret ? transfer.recv_buf : NULL;
}

static void cosmo_handle_message(cosmo *instance, json_t *event) {
  json_t *subject;
  int id;
  char *message_content;
  if (json_unpack(event, "{sosiss}", "subject", &subject, "id", &id, "message", &message_content)) {
    cosmo_log(instance, "invalid message event");
    return;
  }

  json_error_t err;
  json_t *message_object = json_loads(message_content, JSON_DECODE_ANY, &err);
  if (!message_object) {
    cosmo_log(instance, "error parsing message content: %s", err.text);
    return;
  }
  json_object_set_new(event, "message", message_object);

  assert(!pthread_mutex_lock(&instance->lock));
  json_t *subscription = cosmo_find_subscription(instance, subject);
  if (!subscription) {
    cosmo_log(instance, "message from unknown subject");
    assert(!pthread_mutex_unlock(&instance->lock));
    return;
  }

  json_t *messages = json_object_get(subscription, "messages");
  ssize_t insert_after;
  for (insert_after = json_array_size(messages) - 1; insert_after >= 0; insert_after--) {
    json_t *message = json_array_get(messages, insert_after);
    json_int_t message_id = json_integer_value(json_object_get(message, "id"));
    if (message_id == id) {
      assert(!pthread_mutex_unlock(&instance->lock));
      return;
    }
    if (message_id < id) {
      break;
    }
  }
  json_array_insert(messages, insert_after + 1, event);
  assert(!pthread_mutex_unlock(&instance->lock));

  if (instance->callbacks.message) {
    cosmo_log(instance, "callbacks.message()");
    instance->callbacks.message(event, instance->passthrough);
  }
}

static void cosmo_handle_client_id_change(cosmo *instance) {
  if (instance->callbacks.client_id_change) {
    cosmo_log(instance, "callbacks.client_id_change()");
    instance->callbacks.client_id_change(instance->passthrough, instance->client_id);
  }
}

static void cosmo_handle_connect(cosmo *instance) {
  if (instance->connect_state == CONNECTED) {
    return;
  }
  instance->connect_state = CONNECTED;
  if (instance->callbacks.connect) {
    cosmo_log(instance, "callbacks.connect()");
    instance->callbacks.connect(instance->passthrough);
  }
}

static void cosmo_handle_disconnect(cosmo *instance) {
  if (instance->connect_state == DISCONNECTED) {
    return;
  }
  instance->connect_state = DISCONNECTED;
  if (instance->callbacks.disconnect) {
    cosmo_log(instance, "callbacks.disconnect()");
    instance->callbacks.disconnect(instance->passthrough);
  }
}

static void cosmo_handle_login(cosmo *instance, json_t *event) {
  if (instance->login_state == LOGGED_IN) {
    return;
  }
  instance->login_state = LOGGED_IN;
  if (instance->callbacks.login) {
    cosmo_log(instance, "callbacks.login()");
    instance->callbacks.login(instance->passthrough);
  }
}

static void cosmo_handle_logout(cosmo *instance, json_t *event) {
  if (instance->login_state == LOGGED_OUT) {
    return;
  }
  instance->login_state = LOGGED_OUT;
  if (instance->callbacks.logout) {
    cosmo_log(instance, "callbacks.logout()");
    instance->callbacks.logout(instance->passthrough);
  }
}

static void cosmo_handle_event(cosmo *instance, json_t *event) {
  json_t *event_id = json_object_get(event, "event_id");
  if (event_id) {
    json_array_append(instance->ack, event_id);
  }

  const char *event_type = json_string_value(json_object_get(event, "event_type"));
  if (!strcmp(event_type, "message")) {
    cosmo_handle_message(instance, event);
  } else if (!strcmp(event_type, "login")) {
    cosmo_handle_login(instance, event);
  } else if (!strcmp(event_type, "logout")) {
    cosmo_handle_logout(instance, event);
  } else {
    cosmo_log(instance, "unknown event type: %s", event_type);
  }
}

static void cosmo_complete_subscribe(cosmo *instance, struct cosmo_command *command, json_t *response, char *result) {
  json_t *subject;
  assert(!json_unpack(command->command, "{s{so}}", "arguments", "subject", &subject));

  if (strcmp(result, "ok")) {
    cosmo_remove_subscription(instance, subject);
    promise_fail(command->promise, NULL, NULL);
    return;
  }

  assert(!pthread_mutex_lock(&instance->lock));
  json_t *subscription = cosmo_find_subscription(instance, subject);
  if (subscription) {
    // Might have unsubscribed later
    json_object_set_new(subscription, "state", json_integer(SUBSCRIPTION_ACTIVE));
  }
  assert(!pthread_mutex_unlock(&instance->lock));

  promise_succeed(command->promise, NULL, NULL);
}

static void cosmo_complete_unsubscribe(cosmo *instance, struct cosmo_command *command, json_t *response, char *result) {
  promise_complete(command->promise, NULL, NULL, (strcmp(result, "ok") == 0));
}

static void cosmo_complete_send_message(cosmo *instance, struct cosmo_command *command, json_t *response, char *result) {
  json_t *message;
  int err = json_unpack(response, "{so}", "message", &message);
  if (err || (strcmp(result, "ok") && strcmp(result, "duplicate_message"))) {
    promise_fail(command->promise, NULL, NULL);
  } else {
    char *message_content;
    assert(!json_unpack(message, "{ss}", "message", &message_content));
    json_t *message_object = json_loads(message_content, JSON_DECODE_ANY, NULL);
    assert(message_object);
    json_object_set_new(message, "message", message_object);

    json_incref(message);
    promise_succeed(command->promise, message, (promise_cleanup) json_decref);
  }
}

static void cosmo_complete_rpc(cosmo *instance, struct cosmo_command *command, json_t *response) {
  char *command_name, *result;
  assert(!json_unpack(command->command, "{ss}", "command", &command_name));
  assert(!json_unpack(response, "{ss}", "result", &result));
  if (!strcmp(command_name, "subscribe")) {
    cosmo_complete_subscribe(instance, command, response, result);
  } else if (!strcmp(command_name, "unsubscribe")) {
    cosmo_complete_unsubscribe(instance, command, response, result);
  } else if (!strcmp(command_name, "sendMessage")) {
    cosmo_complete_send_message(instance, command, response, result);
  }
}

// Takes ownership of arguments.
static json_t *cosmo_command(const char *name, const json_t *arguments) {
  return json_pack("{ssso}", "command", name, "arguments", arguments);
}

static void cosmo_resubscribe(cosmo *instance) {
  size_t i;
  json_t *subscription;
  json_array_foreach(instance->subscriptions, i, subscription) {
    int state;
    json_t *subject, *messages;
    assert(!json_unpack(subscription, "{sisoso}", "state", &state, "subject", &subject, "messages", &messages));

    if (state == SUBSCRIPTION_PENDING) {
      continue;
    }

    json_t *arguments = json_pack("{sO}", "subject", subject);
    if (json_array_size(messages)) {
      // Restart at the last actual ID we received.
      json_t *last_message = json_array_get(messages, json_array_size(messages) - 1);
      json_object_set(arguments, "last_id", json_object_get(last_message, "id"));
    } else {
      json_t *num_messages = json_object_get(subscription, "num_messages");
      if (num_messages) {
        json_object_set(arguments, "messages", num_messages);
      }
      json_t *last_id = json_object_get(subscription, "last_id");
      if (last_id) {
        json_object_set(arguments, "last_id", last_id);
      }
    }

    cosmo_send_command_locked(instance, cosmo_command("subscribe", arguments), NULL);
  }
}

// Takes ownership of commands.
// Takes ownership of ack.
static struct cosmo_command *cosmo_send_rpc(cosmo *instance, struct cosmo_command *commands, json_t *ack) {
  json_t *int_commands = json_array();

  // Always poll.
  json_t *arguments = json_pack("{so}", "ack", ack);
  json_array_append_new(int_commands, cosmo_command("poll", arguments));
  struct cosmo_command *command_iter = commands;
  while (command_iter) {
    json_array_append(int_commands, command_iter->command);
    command_iter = command_iter->next;
  }

  char *request = cosmo_build_rpc(instance, int_commands);
  cosmo_log(instance, "--> %s", request);

  char *response = cosmo_send_http(instance, request);
  json_decref(int_commands);
  if (!response) {
    return commands;
  }
  cosmo_log(instance, "<-- %s", response);

  json_error_t error;
  json_t *received = json_loads(response, 0, &error);
  if (!received) {
    cosmo_log(instance, "json_loads() failed: %s (json: \"%s\")", error.text, response);
    free(response);
    return commands;
  }
  free(response);

  json_t *command_responses, *events, *profile;
  if (json_unpack(received, "{sososo}", "profile", &profile, "responses", &command_responses, "events", &events)) {
    cosmo_log(instance, "invalid server response");
    json_decref(received);
    return commands;
  }

  // TODO: major locking problems through here
  if (!json_equal(instance->profile, profile)) {
    json_decref(instance->profile);
    json_incref(profile);
    instance->profile = profile;
    struct cosmo_get_profile *get_profile_iter = instance->get_profile_head;
    while (get_profile_iter) {
      struct cosmo_get_profile *next = get_profile_iter->next;
      json_incref(instance->profile);
      promise_succeed(get_profile_iter->promise, instance->profile, (promise_cleanup)json_decref);
      free(get_profile_iter);
      get_profile_iter = next;
    }
    instance->get_profile_head = NULL;
  }

  assert(!clock_gettime(CLOCK_MONOTONIC, &instance->last_success));
  cosmo_handle_connect(instance);

  size_t index;
  json_t *event;
  json_array_foreach(events, index, event) {
    cosmo_handle_event(instance, event);
  }

  json_t *poll_response = json_array_get(command_responses, 0);
  json_t *instance_generation;
  if (json_unpack(poll_response, "{so}", "instance_generation", &instance_generation)) {
    cosmo_log(instance, "invalid poll response");
  } else {
    assert(!pthread_mutex_lock(&instance->lock));
    if (!json_equal(instance_generation, instance->generation)) {
      json_decref(instance->generation);
      json_incref(instance_generation);
      instance->generation = instance_generation;
      cosmo_resubscribe(instance);
    }
    assert(!pthread_mutex_unlock(&instance->lock));
  }

  command_iter = commands;
  struct cosmo_command *to_retry_head = NULL, *to_retry_tail = NULL;
  json_t *command_response;
  json_array_foreach(command_responses, index, command_response) {
    if (index == 0) {
      // Skip poll response; don't increment command_iter
      continue;
    }

    if (!command_iter) {
      cosmo_log(instance, "more responses than requests");
      continue;
    }
    struct cosmo_command *command_next = command_iter->next;

    char *result;
    if (json_unpack(command_response, "{ss}", "result", &result)) {
      cosmo_log(instance, "invalid command response");
      cosmo_append_command(&to_retry_head, &to_retry_tail, command_iter);
      command_iter = command_next;
      continue;
    }
    if (!strcmp(result, "retry")) {
      cosmo_append_command(&to_retry_head, &to_retry_tail, command_iter);
      command_iter = command_next;
      continue;
    }

    cosmo_complete_rpc(instance, command_iter, command_response);

    json_decref(command_iter->command);
    free(command_iter);
    command_iter = command_next;
  }

  json_decref(received);

  return to_retry_head;
}

static void *cosmo_thread_main(void *arg) {
  cosmo *instance = arg;

  assert(!pthread_mutex_lock(&instance->lock));
  while (!instance->shutdown) {
    struct cosmo_command *commands = instance->command_queue_head;
    instance->command_queue_head = instance->command_queue_tail = NULL;
    json_t *ack = instance->ack;
    instance->ack = json_array();

    instance->next_delay_ms = CYCLE_MS;
    instance->next_delay_ms += rand_r(&instance->seedp) % (instance->next_delay_ms / CYCLE_STAGGER_FACTOR);

    assert(!pthread_mutex_unlock(&instance->lock));
    struct cosmo_command *to_retry = cosmo_send_rpc(instance, commands, ack);
    {
      struct timespec now;
      assert(!clock_gettime(CLOCK_MONOTONIC, &now));
      if (now.tv_sec - instance->last_success.tv_sec > CONNECT_TIMEOUT_S) {
        cosmo_handle_disconnect(instance);
      }
    }
    assert(!pthread_mutex_lock(&instance->lock));

    if (to_retry) {
      to_retry->prev = instance->command_queue_tail;
      if (to_retry->prev) {
        to_retry->prev->next = to_retry;
      }
      instance->command_queue_tail = to_retry;
      if (!instance->command_queue_head) {
        instance->command_queue_head = to_retry;
      }
    }

#define MS_PER_S 1000
#define NS_PER_MS 1000000
    struct timespec ts;
    assert(!clock_gettime(CLOCK_REALTIME, &ts));
    uint64_t target_ms = (ts.tv_sec * MS_PER_S) + (ts.tv_nsec / NS_PER_MS) + instance->next_delay_ms;
    ts.tv_sec = target_ms / MS_PER_S;
    ts.tv_nsec = (target_ms % MS_PER_S) * NS_PER_MS;
    pthread_cond_timedwait(&instance->cond, &instance->lock, &ts);
  }
  assert(!pthread_mutex_unlock(&instance->lock));
  return NULL;
}


// Public interface below

void cosmo_uuid(char *uuid) {
  uuid_t uu;
  uuid_generate(uu);
  uuid_unparse_lower(uu, uuid);
}

void cosmo_get_profile(cosmo *instance, promise *promise_obj) {
  assert(!pthread_mutex_lock(&instance->lock));
  if (json_is_string(instance->profile)) {
    json_t *profile = instance->profile;
    json_incref(profile);
    assert(!pthread_mutex_unlock(&instance->lock));
    promise_succeed(promise_obj, instance->profile, (promise_cleanup)json_decref);
    return;
  }
  struct cosmo_get_profile *entry = malloc(sizeof(*entry));
  assert(entry);
  entry->next = instance->get_profile_head;
  entry->promise = promise_obj;
  instance->get_profile_head = entry;
  assert(!pthread_mutex_unlock(&instance->lock));
}

json_t *cosmo_current_profile(cosmo *instance) {
  assert(!pthread_mutex_lock(&instance->lock));
  json_t *profile = instance->profile;
  json_incref(profile);
  assert(!pthread_mutex_unlock(&instance->lock));
  return profile;
}

json_t *cosmo_subject(const char *name, const char *readable_only_by, const char *writeable_only_by) {
  json_t *ret = json_pack("{ss}", "name", name);
  if (readable_only_by) {
    json_object_set_new(ret, "readable_only_by", json_string(readable_only_by));
  }
  if (writeable_only_by) {
    json_object_set_new(ret, "writeable_only_by", json_string(writeable_only_by));
  }
  return ret;
}

void cosmo_subscribe(cosmo *instance, json_t *subjects, const json_int_t messages, const json_int_t last_id, promise *promise_obj) {
  if (json_is_array(subjects)) {
    json_incref(subjects);
  } else {
    subjects = json_pack("[O]", subjects);
    assert(subjects);
  }

  assert(!pthread_mutex_lock(&instance->lock));
  size_t i;
  json_t *subject;
  json_array_foreach(subjects, i, subject) {
    json_t *subscription = cosmo_find_subscription(instance, subject);
    if (!subscription) {
      subscription = json_pack("{sOs[]si}", "subject", subject, "messages", "state", SUBSCRIPTION_PENDING);
      json_array_append_new(instance->subscriptions, subscription);
    }

    json_t *arguments = json_pack("{sO}", "subject", subject);
    if (messages) {
      json_object_set_new(arguments, "messages", json_integer(messages));
      json_object_set_new(subscription, "num_messages", json_integer(messages));
    }
    if (last_id) {
      json_object_set_new(arguments, "last_id", json_integer(last_id));
      json_object_set_new(subscription, "last_id", json_integer(last_id));
    }
    cosmo_send_command_locked(instance, cosmo_command("subscribe", arguments), promise_obj);
  }
  assert(!pthread_mutex_unlock(&instance->lock));

  pthread_cond_signal(&instance->cond);

  json_decref(subjects);
}

void cosmo_unsubscribe(cosmo *instance, json_t *subject, promise *promise_obj) {
  assert(!pthread_mutex_lock(&instance->lock));
  cosmo_remove_subscription(instance, subject);
  assert(!pthread_mutex_unlock(&instance->lock));

  json_t *arguments = json_pack("{sO}", "subject", subject);
  cosmo_send_command(instance, cosmo_command("unsubscribe", arguments), promise_obj);
}

void cosmo_send_message(cosmo *instance, json_t *subject, json_t *message, promise *promise_obj) {
  char sender_message_id[COSMO_UUID_SIZE];
  cosmo_uuid(sender_message_id);
  char *encoded = json_dumps(message, JSON_ENCODE_ANY);
  json_t *arguments = json_pack("{sOssss}",
      "subject", subject,
      "message", encoded,
      "sender_message_id", sender_message_id);
  cosmo_send_command(instance, cosmo_command("sendMessage", arguments), promise_obj);
  free(encoded);
}

json_t *cosmo_get_messages(cosmo *instance, json_t *subject) {
  assert(!pthread_mutex_lock(&instance->lock));
  json_t *subscription = cosmo_find_subscription(instance, subject);
  if (!subscription) {
    assert(!pthread_mutex_unlock(&instance->lock));
    return NULL;
  }
  json_t *messages = json_object_get(subscription, "messages");
  json_t *ret = json_deep_copy(messages);
  assert(!pthread_mutex_unlock(&instance->lock));

  return ret;
}

json_t *cosmo_get_last_message(cosmo *instance, json_t *subject) {
  assert(!pthread_mutex_lock(&instance->lock));
  json_t *subscription = cosmo_find_subscription(instance, subject);
  if (!subscription) {
    assert(!pthread_mutex_unlock(&instance->lock));
    return NULL;
  }
  json_t *messages = json_object_get(subscription, "messages");
  json_t *last_message = json_array_get(messages, json_array_size(messages) - 1);
  json_t *ret = json_deep_copy(last_message);
  assert(!pthread_mutex_unlock(&instance->lock));

  return ret;
}

cosmo *cosmo_create(const char *base_url, const char *client_id, const cosmo_callbacks *callbacks, const cosmo_options *options, void *passthrough) {
  curl_global_init(CURL_GLOBAL_DEFAULT);

  cosmo *instance = malloc(sizeof(cosmo));
  assert(instance);

  instance->seedp = (unsigned int) time(NULL);

  instance->debug = getenv("COSMO_DEBUG");

  memcpy(&instance->callbacks, callbacks, sizeof(instance->callbacks));
  if (options) {
    memcpy(&instance->options, options, sizeof(instance->options));
  } else {
    memset(&instance->options, 0, sizeof(instance->options));
  }
  instance->passthrough = passthrough;

  cosmo_uuid(instance->instance_id);
  if (client_id) {
    strcpy(instance->client_id, client_id);
  } else {
    cosmo_uuid(instance->client_id);
    cosmo_handle_client_id_change(instance);
  }

  assert(!pthread_mutex_init(&instance->lock, NULL));
  assert(!pthread_cond_init(&instance->cond, NULL));

  instance->curl = curl_easy_init();
  assert(instance->curl);
  char api_url[strlen(base_url) + 5];
  sprintf(api_url, "%s/api", base_url);
  assert(!curl_easy_setopt(instance->curl, CURLOPT_URL, api_url));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_SSLVERSION, CURL_SSLVERSION_TLSv1_2));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_SSL_CIPHER_LIST, "EECDH+AESGCM:EDH+AESGCM:AES256+EECDH:AES256+EDH"));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_TIMEOUT_MS, CYCLE_MS));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_POST, 1L));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_READFUNCTION, cosmo_read_callback));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_WRITEFUNCTION, cosmo_write_callback));
  assert(!curl_easy_setopt(instance->curl, CURLOPT_HEADERFUNCTION, cosmo_header_callback));

  instance->shutdown = false;
  instance->profile = json_null();
  instance->get_profile_head = NULL;
  instance->generation = json_null();
  instance->command_queue_head = instance->command_queue_tail = NULL;
  instance->ack = json_array();
  assert(instance->ack);
  instance->subscriptions = json_array();
  assert(instance->subscriptions);
  instance->next_delay_ms = 0;

  instance->connect_state = INITIAL_CONNECT;
  instance->login_state = LOGIN_UNKNOWN;
  instance->last_success.tv_sec = 0;

  assert(!pthread_create(&instance->thread, NULL, cosmo_thread_main, instance));
  return instance;
}

void cosmo_shutdown(cosmo *instance) {
  pthread_mutex_lock(&instance->lock);
  instance->shutdown = true;
  instance->next_delay_ms = 0;
  pthread_cond_signal(&instance->cond);
  pthread_mutex_unlock(&instance->lock);
  assert(!pthread_join(instance->thread, NULL));

  assert(!pthread_mutex_destroy(&instance->lock));
  assert(!pthread_cond_destroy(&instance->cond));
  struct cosmo_command *command_iter = instance->command_queue_head;
  while (command_iter) {
    json_decref(command_iter->command);
    struct cosmo_command *next = command_iter->next;
    free(command_iter);
    command_iter = next;
  }
  json_decref(instance->ack);
  json_decref(instance->subscriptions);
  json_decref(instance->profile);
  struct cosmo_get_profile *get_profile_iter = instance->get_profile_head;
  while (get_profile_iter) {
    struct cosmo_get_profile *next = get_profile_iter->next;
    promise_fail(get_profile_iter->promise, NULL, NULL);
    free(get_profile_iter);
    get_profile_iter = next;
  }
  json_decref(instance->generation);
  curl_easy_cleanup(instance->curl);

  free(instance);

  curl_global_cleanup();
}

