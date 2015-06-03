#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include <jansson.h>
#include <curl/curl.h>
#include <uuid/uuid.h>

#define COSMO_UUID_SIZE 37
#define COSMO_CLIENT_ID_SIZE COSMO_UUID_SIZE
#define COSMO_CHECK_SECONDS 10

#define min(a, b) ((a) < (b) ? (a) : (b))

typedef struct {
  char client_id[COSMO_CLIENT_ID_SIZE];
  char instance_id[COSMO_UUID_SIZE];

  pthread_mutex_t lock;
  int shutdown;

  pthread_t thread;

  char *send_buf;
  size_t send_buf_len;
} cosmo;

static void cosmo_generate_uuid(char *uuid) {
  uuid_t uu;
  uuid_generate(uu);
  uuid_unparse_lower(uu, uuid);
}

static size_t cosmo_read_callback(void *ptr, size_t size, size_t nmemb, void *userp) {
  cosmo *instance = userp;
  size_t to_write = min(instance->send_buf_len, size * nmemb);
  memcpy(ptr, instance->send_buf, to_write);
  ptr += to_write;
  instance->send_buf_len -= to_write;
  return to_write;
}

static void cosmo_send_rpc(cosmo *instance) {
  json_t *packed = json_pack("{sssss[]}", "client_id", instance->client_id, "instance_id", instance->instance_id, "commands");
  assert(packed);
  char *serialized = json_dumps(packed, 0);
  assert(serialized);
  json_decref(packed);

  instance->send_buf = serialized;
  instance->send_buf_len = strlen(instance->send_buf);

  CURL *curl;
  CURLcode res;
 
  curl = curl_easy_init();
  curl_easy_setopt(curl, CURLOPT_URL, "https://playground.cosmopolite.org/cosmopolite/api");
  curl_easy_setopt(curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
  curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
  curl_easy_setopt(curl, CURLOPT_SSL_CIPHER_LIST, "ECDH+AESGCM:EDH+AESGCM:AES256+EECDH:AES256+EDH");
  curl_easy_setopt(curl, CURLOPT_POST, 1L);
  curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, instance->send_buf_len);
  curl_easy_setopt(curl, CURLOPT_READFUNCTION, cosmo_read_callback);
  curl_easy_setopt(curl, CURLOPT_READDATA, instance);
  res = curl_easy_perform(curl);
  if (res != CURLE_OK)
    fprintf(stderr, "curl_easy_perform() failed: %s\n", curl_easy_strerror(res));

  curl_easy_cleanup(curl);

  printf("\n");

  free(serialized);
}

static void *cosmo_thread_main(void *arg) {
  cosmo *instance = arg;

  assert(!pthread_mutex_lock(&instance->lock));
  while (!instance->shutdown) {

    pthread_mutex_unlock(&instance->lock);
    {
      time_t t1, t2;

      assert(time(&t1) != -1);
      cosmo_send_rpc(instance);

      pthread_mutex_lock(&instance->lock);
      if (instance->shutdown) {
        break;
      }
      pthread_mutex_unlock(&instance->lock);

      assert(time(&t2) != -1);
      time_t elapsed = t2 - t1;
      time_t to_wait = COSMO_CHECK_SECONDS - elapsed;

      if (to_wait > 0) {
        sleep(to_wait);
      }
    }
    pthread_mutex_lock(&instance->lock);

  }
  pthread_mutex_unlock(&instance->lock);
  return NULL;
}

void cosmo_generate_client_id(char *client_id) {
  cosmo_generate_uuid(client_id);
}

cosmo *cosmo_create(char *client_id) {
  curl_global_init(CURL_GLOBAL_DEFAULT);

  cosmo *instance = malloc(sizeof(cosmo));
  assert(instance);
  strcpy(instance->client_id, client_id);
  cosmo_generate_uuid(instance->instance_id);
  assert(!pthread_mutex_init(&instance->lock, NULL));
  instance->shutdown = 0;

  assert(!pthread_create(&instance->thread, NULL, cosmo_thread_main, instance));
  return instance;
}

void cosmo_destroy(cosmo *instance) {
  pthread_mutex_lock(&instance->lock);
  instance->shutdown = 1;
  pthread_mutex_unlock(&instance->lock);
  assert(!pthread_join(instance->thread, NULL));
  assert(!pthread_mutex_destroy(&instance->lock));
  free(instance);

  curl_global_cleanup();
}


int main(int argc, char *argv[]) {
  char client_id[COSMO_CLIENT_ID_SIZE];
  cosmo_generate_client_id(client_id);
  cosmo *instance = cosmo_create(client_id);
  sleep(60);
  cosmo_destroy(instance);

  return 0;
}
