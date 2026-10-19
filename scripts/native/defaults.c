// Included by ttyd's server.c. Only startup defaults change; authentication is
// still enforced by upstream ttyd's HTTP and WebSocket handlers.
#include <sys/random.h>
#include "driftty-version.h"

static bool driftty_generate_credential(char password[31]) {
  static const char alphabet[] = "0123456789abcdefghijklmnopqrstuvwxyz";
  size_t length = 0;
  while (length < 30) {
    unsigned char bytes[64];
    ssize_t count = getrandom(bytes, sizeof(bytes), 0);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      fprintf(stderr, "driftty-terminal: secure password generation failed\n");
      return false;
    }
    for (ssize_t i = 0; i < count && length < 30; i++) {
      // 252 is divisible by 36: rejection sampling avoids modulo bias.
      if (bytes[i] < 252) password[length++] = alphabet[bytes[i] % 36];
    }
  }
  password[30] = '\0';
  char credential[39];  // "driftty:" + 30 characters + NUL
  char encoded[64];
  snprintf(credential, sizeof(credential), "driftty:%s", password);
  if (lws_b64_encode_string(credential, strlen(credential), encoded, sizeof(encoded)) < 0) return false;
  server->credential = strdup(encoded);
  return server->credential != NULL;
}
