# CLI-managed workspaces

Each Driftty configuration is one directory containing shared settings,
workspace definitions, state, and separate Varlock environments for each
project. The sandbox does not install or depend on Varlock.

## Select project environment variables

```yaml
projects:
  - id: bigbrother
    label: Big Brother
    provider: vercel
    repository:
      url: https://github.com/1984vc/bigbrother.git
      directory: /workspace/bigbrother
    secrets:
      env:
        GH_TOKEN: shared:GITHUB_TOKEN
        POSTHOG_PERSONAL_API_KEY: POSTHOG_PERSONAL_API_KEY
        OPENROUTER_API_KEY: OPENROUTER_API_KEY
```

The left side is the variable name inside the sandbox. `shared:NAME` resolves
from the root shared Varlock environment; unprefixed names resolve only from
`projects/<id>`'s Varlock environment. This explicit mapping is the sandbox
allowlist. Orchestration credentials such as `VERCEL_TOKEN` are rejected and
never forwarded.

The config root's `.env.schema` and `.env`/`.env.local` hold shared settings
and credentials; each project has its own `projects/<id>/.env.schema` and
`.env`/`.env.local`. Mark credentials `@sensitive` and use Varlock's normal
encryption flow (for example, `varlock encrypt --file .env` from each relevant
directory). Driftty resolves only the selected source names from the
appropriate scope. Project credentials are not stored in the shared root env.

## What gets sent and where it lives

The host CLI resolves the selected values, then sends them to the loopback-only
workspace API. The daemon sends them to the sandbox over the provider execution
channel. Values are not put in command arguments, workspace records, or normal
logs. The provider and the sandbox are trusted with the plaintext during
delivery.

For persistence across sandbox stop/resume, the sandbox stores the selected
environment in `~/.config/driftty/system.env`, owned by the sandbox user with
mode `0600` in a `0700` directory. Driftty loads it into the dedicated tmux
session so project shells and newly created windows receive the values. Setup
commands and repository clone receive the selected values directly as process
environment variables. **The sandbox copy is plaintext at rest** in this alpha;
any code running as that sandbox user can read it. Host Varlock encryption
protects the host copy only and its key is never copied to the sandbox.

Refreshing values changes the sandbox file and tmux environment for future
shells. Existing processes retain the values they already received. Use the
explicit terminal restart option only if terminating processes in Driftty's
dedicated `coding` tmux session is acceptable.

## Start and manage

```sh
driftty serve --config ./driftty-mdp-config
driftty project secrets bigbrother --config ./driftty-mdp-config
driftty workspace create bigbrother --name bigbrother-debug --config ./driftty-mdp-config
driftty workspace list --config ./driftty-mdp-config
driftty workspace status bigbrother-debug --config ./driftty-mdp-config
driftty workspace open bigbrother-debug --config ./driftty-mdp-config
driftty workspace stop bigbrother-debug --config ./driftty-mdp-config
driftty workspace resume bigbrother-debug --config ./driftty-mdp-config
driftty workspace retry bigbrother-debug --config ./driftty-mdp-config
driftty workspace secrets status bigbrother-debug --config ./driftty-mdp-config
driftty workspace secrets sync bigbrother-debug --config ./driftty-mdp-config
driftty workspace secrets sync bigbrother-debug --restart-terminal --config ./driftty-mdp-config
```

See [`examples/driftty-config`](../examples/driftty-config) for a credential-free
template. The ignored `driftty-mdp-config/` directory is the personal config
copy and is the default config path for local CLI use.

`project secrets` validates that the selected host values resolve, without
printing them. Create, resume, retry, and sync all resolve values using the
host's regular Varlock configuration. Sync replaces the complete declared set;
removed variables are removed from the sandbox environment file. Deleting a
sandbox copy does not revoke a credential at its issuer.

The workspace management API is bound to loopback by default. Sandbox URLs use
the gateway's `DRIFTTY_PASSWORD`. The Vercel provider credentials stay on the
daemon and are never sent to the project sandbox.
