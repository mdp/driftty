"""Apply narrowly scoped startup changes to checksum-pinned upstream source.

Exact, unique matches intentionally fail closed when updating ttyd versions.
HTTP/WS authentication code is not modified.
"""
from pathlib import Path
import sys

source = Path(sys.argv[1])
text = source.read_text()


def replace(old, new):
    global text
    if text.count(old) != 1:
        raise SystemExit(f"Expected one upstream match: {old!r}")
    text = text.replace(old, new, 1)


replace('// command line options', '#include "driftty-defaults.c"\n\n// command line options')
replace('{"writable", no_argument, NULL, \'W\'},', '{"writable", no_argument, NULL, \'W\'},\n                                        {"readonly", no_argument, NULL, 1000},')
replace('ttyd is a tool for sharing terminal over the web', 'driftty-terminal is a mobile-first web terminal (powered by ttyd)')
replace('    ttyd [options] <command>', '    driftty-terminal [options] <command>')
replace('Network interface to bind (eg: eth0)', 'Network interface to bind (default: 127.0.0.1)')
replace('Credential for basic authentication (format: username:password)', 'Basic auth username:password (default: driftty + generated 30-character password)')
replace('Allow clients to write to the TTY (readonly by default)', 'Allow clients to write to the TTY (enabled by default)\\n"\n           "        --readonly          Disable terminal input')
replace('Do not allow websocket connection from different origin\\n', 'Reject cross-origin websocket connections (enabled by default)\\n')
replace('          TTYD_VERSION\n', '          DRIFTTY_VERSION\n')
replace('if (server->credential != NULL) lwsl_notice("  credential: %s\\n", server->credential);', 'if (server->credential != NULL) lwsl_notice("  Basic authentication enabled\\n");')
replace('  ts->client_count = 0;', '  ts->client_count = 0;\n  ts->writable = true;\n  ts->check_origin = true;')
replace('  char iface[128] = "";', '  char iface[128] = "127.0.0.1";\n  char generated_password[31] = "";')
replace('printf("ttyd version %s\\n", TTYD_VERSION);', 'printf("driftty-terminal %s (ttyd %s)\\n", DRIFTTY_VERSION, TTYD_VERSION);')
replace("      case 'W':", "      case 1000:\n        server->writable = false;\n        break;\n      case 'W':")
replace('if (info.port < 0)', 'if (info.port < 0 || info.port > 65535)')
replace("if (strchr(optarg, ':') == NULL)", "if (strchr(optarg, ':') == NULL || optarg[0] == ':' || strchr(optarg, ':')[1] == '\\0')")
replace('        lws_b64_encode_string(optarg, strlen(optarg), b64_text, sizeof(b64_text));', '        if (lws_b64_encode_string(optarg, strlen(optarg), b64_text, sizeof(b64_text)) < 0) {\n          fprintf(stderr, "driftty-terminal: credential is too long\\n");\n          return 1;\n        }\n        free(server->credential);')
replace('  lws_set_log_level(debug_level, NULL);', '  if (server->credential == NULL && server->auth_header == NULL &&\n      !driftty_generate_credential(generated_password)) return 1;\n\n  lws_set_log_level(debug_level, NULL);')
replace('  lwsl_notice(" Listening on port: %d\\n", port);', '''  lwsl_notice(" Listening on port: %d\\n", port);
  fprintf(stderr, "\\ndriftty-terminal %s\\n", DRIFTTY_VERSION);
  if (!(info.options & LWS_SERVER_OPTION_UNIX_SOCK))
    fprintf(stderr, "URL: %s://%s:%d%s\\n", ssl ? "https" : "http", iface, port, endpoints.index);
  if (generated_password[0]) {
    fprintf(stderr, "Username: driftty\\nPassword: %s\\n", generated_password);
    fprintf(stderr, "A new password is generated on each start. Use -c to choose credentials.\\n");
    memset(generated_password, 0, sizeof(generated_password));
  }
  if (!ssl) fprintf(stderr, "Remote access: use an SSH tunnel or trusted VPN; Basic Auth does not encrypt HTTP.\\n");''')
source.write_text(text)
