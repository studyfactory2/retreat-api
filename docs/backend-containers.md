# Backend containers: first production setup

This step packages the API, a fresh PostgreSQL 16 database, and an optional
operator container. It does not configure public HTTPS, a frontend deployment,
or automatic Git pulls. Run the commands below on EC2 only when the server
configuration is ready. The user owns all builds, migrations and live operations.

## What Compose runs

- `db`: PostgreSQL on the private `database` Docker network, with no host port.
- `api`: the nonroot production image from `Dockerfile`; waits for database
  readiness. It is reachable on the EC2 host at `127.0.0.1:8081` only.
- `operator`: development tools, application source, scripts and committed
  migrations in a separate image. It runs only when explicitly selected. Its
  default command displays Prisma help; it never migrates or seeds on startup.

The API and operator also have an outbound network for S3/EC2 role credentials.
Keep IMDSv2 required and the instance metadata response hop limit at 2.
Database readiness and `/health` are not proof of applied migrations, S3 access,
or working application workflows.

The fixed volume `retreat-postgres-data` survives container recreation and normal
`docker compose down`. Never use `down -v` or delete this volume to fix a startup
problem. Persistence is not a backup; backup/restore verification is a separate
release step. Use only one production stack with this volume name.

## Server configuration

Create the ignored `.env` in the cloned **backend** repository on EC2. Do not copy
the Mac development `.env`. Keep permissions at `chmod 600 .env`.

Required settings (replace the placeholder values before running anything):

```dotenv
POSTGRES_PASSWORD=REPLACE_WITH_A_RANDOM_64_CHARACTER_HEX_VALUE
JWT_SECRET=REPLACE_WITH_A_DIFFERENT_RANDOM_64_CHARACTER_HEX_VALUE
FRONTEND_URL=https://REPLACE_WITH_THE_ACTUAL_FRONTEND_HOST
AWS_REGION=ap-northeast-2
S3_BUCKET_NAME=retreat-photos-prod-studyfactorylab
```

Run `openssl rand -hex 32` twice on your own terminal to generate the two distinct
secrets; enter them into the server file. The database password must use only
hexadecimal characters in this setup because Compose inserts it into a PostgreSQL
URL without URL-encoding it. Do not use the placeholder text as a password.

`FRONTEND_URL` must be the actual HTTPS frontend origin, without a path. The same
origin must later be used for the frontend's `VITE_FRONTEND_URL`. Do not invent a
temporary hostname or weaken production URL validation to get past startup.

Compose sets `NODE_ENV=production`, `PORT=3100`, `DATABASE_URL` and `CORS_ORIGINS`.
The database host inside Docker is `db`, not `localhost`; its database/user are
both `retreat`. There is no need to duplicate those four variables in this server
file. Existing local development settings remain unchanged.

Do not add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or `AWS_SESSION_TOKEN`.
The EC2 role supplies credentials, and this Compose file passes only the listed
settings to the application. Production starts fresh in the new bucket; leave
the development database and `retreat-photos-dev` unchanged.

PostgreSQL uses `POSTGRES_PASSWORD` only when initializing an empty volume.
Changing `.env` later does not change the stored database password. A rotation
must also update the database deliberately; deleting the volume is not a remedy.
The initial `retreat` PostgreSQL role is administrator-capable for this dedicated
database container. It is not a restricted runtime-only database role.

## First server run, one command at a time

These commands assume you are in the backend repository on EC2, with Docker and
Compose already installed. They are documentation, not commands run by Codex.
The current 2 GiB server has no swap: arrange the memory/swap step before image
builds. Build one repository at a time, before handling user uploads. The initial
memory ceilings are 1 GiB for the API, 512 MiB for PostgreSQL, and 768 MiB for the
optional operator. Run first-time operator commands before starting the API; the
three ceilings plus the OS exceed this server's RAM. These are unbenchmarked
limits, not capacity guarantees, and they do not limit Docker build memory. Swap
provides a slower buffer; measure real photo/import workloads before client use.

Use `bash deploy.sh help` to see the available commands. Run the script as the
checkout owner, without `sudo`; it uses `sudo` for Docker when necessary. It can
be invoked from another directory because it resolves its own repository path.
The server `.env` is parsed by Compose, never executed as shell code. Inherited
application environment variables are cleared so the server file supplies the
five required settings. Configuration validation does not print their values.

The deployment checkout uses `develop`. `pull`, `prepare`, `migrate`, `admin`, and
`up` require a clean checkout, including untracked files. The ignored `.env` is
preserved. The script never resets, stashes, switches branches, or commits.

Fetch and fast-forward the deployment branch when an update is available:

```sh
bash deploy.sh pull
```

This performs only `git pull --ff-only origin develop`, using your existing GitHub
authentication. It does not build or start anything. A conflict or divergence
stops the pull. Run the next command separately so it reads the updated script.

Validate configuration and build both images sequentially:

```sh
bash deploy.sh prepare
```

The API and operator images are tagged with the full current Git commit ID.
Every later command uses that same checkout's commit; after pulling another
commit, run `prepare` again. This avoids deploying an old `local` image by mistake.
Preparation never starts services or applies migrations. Image tags are local;
there is no registry upload or automatic image pruning in this script.

Start only PostgreSQL and wait for it to become healthy:

```sh
bash deploy.sh db
```

This preserves an existing database container with `--no-recreate`. Changes to
PostgreSQL configuration or its image therefore need a separately planned update.
It does not recreate the database when you deploy a new API release.

Apply existing committed migrations to the fresh production database:

```sh
bash deploy.sh migrate
```

This runs Prisma `migrate deploy`, followed by `migrate status`, using the operator
image. It requires that image and an already healthy database. Before migrating
an existing production database, take a verified backup and review the migrations.
This command does not run `migrate dev`, `db push`, or seed any data.

Create your first administrator interactively:

```sh
bash deploy.sh admin
```

Enter your login ID, administrator name, password, and password confirmation at
the prompts. Password entry is hidden. The existing `admin:create` script refuses
if any administrator already exists. Run it in a terminal, without piping input;
the wrapper preserves the interactive terminal. Later, use those credentials at
the frontend's `/admin/login` page. There is no public administrator signup.

Start the API using the prepared image, then check it from the EC2 terminal:

```sh
bash deploy.sh up
curl --fail http://127.0.0.1:8081/health
```

`up` first checks Prisma migration status and stops if it fails. It does not apply
migrations. It starts or updates only the API, without rebuilding, pulling an API
image, or restarting PostgreSQL, and waits up to 120 seconds for API health.
A failed health check returns an error; it does not automatically roll back the
container or the database. Inspect the logs before taking the next action.

Expected health response: `{"status":"ok","service":"retreat-api"}`. This is
application liveness, not full database/S3 acceptance. The host-only address is not
the future public API address. Do not open EC2 port 5432 or 3100; public HTTPS and
proxy configuration remain a separate infrastructure step.

Inspect status or bounded logs if a command fails:

```sh
bash deploy.sh status
bash deploy.sh logs
```

These two commands remain available with local Git changes so diagnostics are
not blocked. Keep the server `.env` available for Compose configuration parsing.
For later API updates, the sequence is `pull`, `prepare`, an explicit `migrate`
when appropriate after backup/review, then `up`. Do not repeat `admin`. On this
small server, arrange a maintenance window if running the operator alongside the
API would exceed available memory. HTTPS setup and workload testing still need
to be completed before serving users.

## References

- [Compose database startup ordering](https://docs.docker.com/compose/how-tos/startup-order/)
- [Explicit one-off services using profiles](https://docs.docker.com/compose/how-tos/profiles/)
- [Official PostgreSQL image and initialization behavior](https://hub.docker.com/_/postgres)
- [Compose one-off command options](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Compose startup and health options](https://docs.docker.com/reference/cli/docker/compose/up/)
