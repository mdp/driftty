When working with environment configuration, read `.env.schema` and the example
schemas for variable names, defaults, and validation rules. Do not read or print
secret-bearing `.env` files, SSH private keys, or deployment backups. Do not print
`config/profiles.yaml`, which may contain legacy credentials.

Use `npm run env:check` for redacted validation. For another deployment directory,
use `npm run env:check -- --path /path/to/deployment/`. Use the `compose`,
`compose:cloudflare`, and `compose:development` npm scripts to validate and inject
configuration before Compose runs. Avoid raw `varlock load --format json`,
`--format env`, `--format shell`, `printenv`, and unwrapped `docker compose config`
output, which can expose secrets. `config --quiet` validates without printing them.

Use `npm run env:encrypt` to replace sensitive plaintext values in the root `.env`
with device-local encrypted references. The matching example commands are
`env:encrypt:cloudflare` and `env:encrypt:development`. Do not inspect an env file
before encrypting it; the command discovers sensitive fields from its schema and
asks the user to confirm them interactively.

Keep credentials in ignored local files or an explicitly configured secret
provider. Commit schema changes when adding or changing environment variables.
