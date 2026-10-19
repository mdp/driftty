# Driftty configuration example

Copy this directory and use the copy as Driftty's single configuration root:

```sh
cp -R examples/driftty-config ./driftty-mdp-config
driftty serve --config ./driftty-mdp-config
driftty workspace create example-app --config ./driftty-mdp-config --name example-app-dev
```

Replace the placeholder repository in `workspaces.yaml` with your project.
Explicit sandbox environment allowlists use shared bindings like `shared:NAME` and
resolve from the config root's Varlock files. Unprefixed sources resolve only
from `projects/<project-id>/.env.schema` and that project's `.env` / `.env.local`.
Thus each project's API credentials remain project-owned,
while GitHub can be shared. Vercel credentials are used by the host to provision
and are not allowed as sandbox bindings.

Put credentials in the appropriate local `.env` or `.env.local`; do not put
values in `workspaces.yaml`. To encrypt sensitive values in place with Varlock,
run `varlock encrypt --file .env` once from the config root and once from the
project directory. Real configuration directories and their runtime state
should be private and excluded from Git.

The `driftty-mdp-config/` directory at the repository root is ignored and is
intended as the personal configuration copy. It contains no real credentials.
