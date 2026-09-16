# SSH profiles and routing

The gateway reads a YAML file mounted at `/config/profiles.yaml`:

```yaml
profiles:
  - slug: baz
    label: Baz server
    host_label: Production
    host: baz.example.net
    port: 22
    user: mark
    key: baz
    sessions:
      - name: main
        label: Main terminal
        directory: /home/mark
    new_sessions:
      enabled: true
      directory: /home/mark
      prefix: driftty-
      # max: 20
```

The profile appears at `/baz/`; its pinned terminal is `/baz/main/`. A pinned
session is created when first opened. New sessions use the configured prefix so
unrelated remote tmux sessions stay hidden. Gateway restarts rediscover them;
browser disconnects do not end them.

Omit both `sessions` and `new_sessions` for a direct interactive SSH login. A
direct profile may use `autorun` to start a command in its login shell. `port`
defaults to 22. `slug`, `label`, `host`, `user`, and `key` are required.

Profiles sharing a host are grouped by `host_label` (which defaults to `label`),
then by SSH user. Each user gets a separate **+** control and session namespace.
The profile slug `local` is reserved for local tmux mode.
