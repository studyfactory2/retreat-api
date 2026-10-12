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

Validate without printing resolved secrets:

```sh
sudo docker compose --env-file .env -f compose.production.yml config --quiet
```

Build the API and operator sequentially; this does not start services:

```sh
sudo docker compose --env-file .env -f compose.production.yml --parallel 1 build api operator
```

Start only PostgreSQL and wait for it to become ready:

```sh
sudo docker compose --env-file .env -f compose.production.yml up -d --wait --wait-timeout 120 db
```

Apply the existing committed migrations to the fresh production database. Use
`migrate deploy`, not `migrate dev` or `db push`:

```sh
sudo docker compose --env-file .env -f compose.production.yml run --rm --no-deps operator node node_modules/prisma/build/index.js migrate deploy
sudo docker compose --env-file .env -f compose.production.yml run --rm --no-deps operator node node_modules/prisma/build/index.js migrate status
```

Create the first administrator using the existing interactive command. Do not add
`-T`: the command requires a terminal and hides password entry. It refuses to
overwrite an existing administrator.

```sh
sudo docker compose --env-file .env -f compose.production.yml run --rm --no-deps operator npm run admin:create
```

Start the API using the built image, then check it from the EC2 terminal:

```sh
sudo docker compose --env-file .env -f compose.production.yml up -d --no-build --wait --wait-timeout 120 api
curl --fail http://127.0.0.1:8081/health
```

Expected response: `{"status":"ok","service":"retreat-api"}`. This host-only
endpoint is not the future public API address. Do not open EC2 port 5432 or 3100;
HTTPS ingress/proxy handling is the next infrastructure step.

Inspect status or bounded logs if a command fails:

```sh
sudo docker compose --env-file .env -f compose.production.yml ps
sudo docker compose --env-file .env -f compose.production.yml logs --tail=100 api db
```

Before updating a populated database, take a verified backup and review the new
migrations. The API never applies migrations itself, and this step adds no new
migration or seed data. Separate `deploy.sh` scripts come later.

## References

- [Compose database startup ordering](https://docs.docker.com/compose/how-tos/startup-order/)
- [Explicit one-off services using profiles](https://docs.docker.com/compose/how-tos/profiles/)
- [Official PostgreSQL image and initialization behavior](https://hub.docker.com/_/postgres)
