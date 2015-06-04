#include <assert.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include <jansson.h>
#include <curl/curl.h>
#include <uuid/uuid.h>

#define COSMO_UUID_SIZE 37
#define COSMO_CHECK_SECONDS 10

#define min(a, b) ((a) < (b) ? (a) : (b))

typedef struct {
  char client_id[COSMO_UUID_SIZE];
  char instance_id[COSMO_UUID_SIZE];

  pthread_mutex_t lock;
  pthread_cond_t cond;
  bool shutdown;
  json_t *command_queue;

  pthread_t thread;
} cosmo;

typedef struct {
  char *send_buf;
  size_t send_buf_len;

  char *recv_buf;
  size_t recv_buf_len;
} cosmo_transfer;

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

static char *cosmo_build_rpc(cosmo *instance, json_t *commands) {
  json_t *to_send = json_pack("{sssssO}", "client_id", instance->client_id, "instance_id", instance->instance_id, "commands", commands);
  assert(to_send);
  char *ret = json_dumps(to_send, 0);
  assert(ret);
  json_decref(to_send);
  return ret;
}

static bool cosmo_send_http_int(cosmo *instance, cosmo_transfer *transfer, CURL *curl) {
  CURLcode res;
 
  curl_easy_setopt(curl, CURLOPT_URL, "https://playground.cosmopolite.org/cosmopolite/api");
  curl_easy_setopt(curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
  curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
  curl_easy_setopt(curl, CURLOPT_SSL_CIPHER_LIST, "ECDH+AESGCM:EDH+AESGCM:AES256+EECDH:AES256+EDH");
  curl_easy_setopt(curl, CURLOPT_POST, 1L);
  curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, transfer->send_buf_len);
  curl_easy_setopt(curl, CURLOPT_READFUNCTION, cosmo_read_callback);
  curl_easy_setopt(curl, CURLOPT_READDATA, transfer);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, cosmo_write_callback);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, transfer);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, COSMO_CHECK_SECONDS);
  res = curl_easy_perform(curl);

  if (res != CURLE_OK) {
    fprintf(stderr, "curl_easy_perform() failed: %s\n", curl_easy_strerror(res));
    return false;
  }

  long return_code;
  assert(curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &return_code) == CURLE_OK);
  if (return_code != 200) {
    fprintf(stderr, "server returned error: %ld\n", return_code);
    return false;
  }

  return true;
}

// Takes ownership of request.
static char *cosmo_send_http(cosmo *instance, char *request) {
  CURL *curl = curl_easy_init();
  assert(curl);
  cosmo_transfer transfer = {
    .send_buf = request,
    .send_buf_len = strlen(request),
    .recv_buf = NULL,
    .recv_buf_len = 0
  };

  int ret = cosmo_send_http_int(instance, &transfer, curl);

  curl_easy_cleanup(curl);
  free(request);

  return ret ? transfer.recv_buf : NULL;
}

// Takes ownership of commands.
static json_t *cosmo_send_rpc(cosmo *instance, json_t *commands) {
  char *request = cosmo_build_rpc(instance, commands);

  char *response = cosmo_send_http(instance, request);
  if (!response) {
    return commands;
  }

  json_error_t error;
  json_t *received = json_loads(response, 0, &error);
  if (!received) {
    fprintf(stderr, "json_loads() failed: %s (json: \"%s\")\n", error.text, response);
    free(response);
    return commands;
  }
  printf("response: %s\n", response);
  free(response);

  json_t *command_responses = json_object_get(received, "responses");
  if (!command_responses) {
    fprintf(stderr, "response lacks \"responses\" key\n");
    return commands;
  }

  json_t *to_retry = json_array();
  size_t index;
  json_t *command;
  json_array_foreach(commands, index, command) {
    json_t *command_response = json_array_get(command_responses, index);
    json_t *result = json_object_get(command_response, "result");
    if (!result) {
      fprintf(stderr, "response lacks \"result\" key\n");
      json_array_append(to_retry, command);
      continue;
    }
    if (!strcmp(json_string_value(result), "retry")) {
      json_array_append(to_retry, command);
      continue;
    }
    // Other result code.
  }

  json_decref(commands);
  json_decref(received);

  return to_retry;
}

static void *cosmo_thread_main(void *arg) {
  cosmo *instance = arg;

  assert(!pthread_mutex_lock(&instance->lock));
  while (!instance->shutdown) {
    while (json_array_size(instance->command_queue)) {
      json_t *commands = instance->command_queue;
      instance->command_queue = json_array();

      assert(!pthread_mutex_unlock(&instance->lock));
      json_t *to_retry = cosmo_send_rpc(instance, commands);
      assert(!pthread_mutex_lock(&instance->lock));

      json_array_extend(instance->command_queue, to_retry);
      json_decref(to_retry);
    }
    assert(!pthread_cond_wait(&instance->cond, &instance->lock));
  }
  assert(!pthread_mutex_unlock(&instance->lock));
  return NULL;
}

// Takes ownership of command.
static void cosmo_send_command(cosmo *instance, json_t *command) {
  assert(command);
  assert(!pthread_mutex_lock(&instance->lock));
  json_array_append_new(instance->command_queue, command);
  assert(!pthread_cond_signal(&instance->cond));
  assert(!pthread_mutex_unlock(&instance->lock));
}

// Takes ownership of arguments.
static json_t *cosmo_command(char *name, json_t *arguments) {
  return json_pack("{ssso}", "command", name, "arguments", arguments);
}


// Public interface below

void cosmo_generate_uuid(char *uuid) {
  uuid_t uu;
  uuid_generate(uu);
  uuid_unparse_lower(uu, uuid);
}

json_t *cosmo_subject(char *name, char *readable_only_by, char *writeable_only_by) {
  json_t *ret = json_pack("{ss}", "name", name);
  if (readable_only_by) {
    json_object_set_new(ret, "readable_only_by", json_string(readable_only_by));
  }
  if (writeable_only_by) {
    json_object_set_new(ret, "writeable_only_by", json_string(writeable_only_by));
  }
  return ret;
}

void cosmo_subscribe(cosmo *instance, json_t *subject, json_int_t messages, json_int_t last_id) {
  json_t *arguments = json_pack("{sO}", "subject", subject);
  if (messages) {
    json_object_set_new(arguments, "messages", json_integer(messages));
  }
  if (last_id) {
    json_object_set_new(arguments, "last_id", json_integer(last_id));
  }
  cosmo_send_command(instance, cosmo_command("subscribe", arguments));
}

cosmo *cosmo_create(char *client_id) {
  curl_global_init(CURL_GLOBAL_DEFAULT);

  cosmo *instance = malloc(sizeof(cosmo));
  assert(instance);
  strcpy(instance->client_id, client_id);
  cosmo_generate_uuid(instance->instance_id);
  assert(!pthread_mutex_init(&instance->lock, NULL));
  assert(!pthread_cond_init(&instance->cond, NULL));
  instance->shutdown = false;
  instance->command_queue = json_array();

  assert(!pthread_create(&instance->thread, NULL, cosmo_thread_main, instance));
  return instance;
}

void cosmo_destroy(cosmo *instance) {
  pthread_mutex_lock(&instance->lock);
  instance->shutdown = 1;
  pthread_cond_signal(&instance->cond);
  pthread_mutex_unlock(&instance->lock);
  assert(!pthread_join(instance->thread, NULL));
  assert(!pthread_mutex_destroy(&instance->lock));
  assert(!pthread_cond_destroy(&instance->cond));
  json_decref(instance->command_queue);
  free(instance);

  curl_global_cleanup();
}


int main(int argc, char *argv[]) {
  char client_id[COSMO_UUID_SIZE];
  cosmo_generate_uuid(client_id);
  cosmo *instance = cosmo_create(client_id);
  json_t *subject = cosmo_subject("foobar", NULL, NULL);
  cosmo_subscribe(instance, subject, -1, 0);
  json_decref(subject);
  sleep(5);
  cosmo_destroy(instance);

  return 0;
}
