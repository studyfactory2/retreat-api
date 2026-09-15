# retreat-api

NestJS backend for the retreat management web app. Package manager: npm.

## Current slice

Slice 2 adds PostgreSQL through Prisma 5.22.0, matching jagong-api. A shared
DatabaseModule exports PrismaService for feature services to inject. Startup
checks the database connection, and shutdown disconnects the client.

The existing configuration, validation, error handling, and GET /health remain.
The health endpoint reports application liveness only; it does not query the
database on each request. Business tables, administrator login, guest forms,
maintenance, and storage will follow the app and data-model discussion.

## Local setup

Use Node.js 22. The project reads a local .env file; no .env.example is
maintained. Configure your own local PostgreSQL connection in .env:

    NODE_ENV=development
    PORT=3100
    CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
    DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/retreat_dev?schema=public&connect_timeout=5"

Use your PostgreSQL role and credentials in the URL; passwordless local setups
can omit :YOUR_PASSWORD. The configured database must already exist. The API
does not create databases or apply migrations at startup.

Run npm install. The postinstall hook generates Prisma Client; npm run build
also refreshes it automatically. Generated files stay inside node_modules.

The local .env is excluded from Git. Runtime environment variables override
values from that file. PORT must be an integer from 1 to 65535. NODE_ENV supports
development, test, or production. CORS_ORIGINS is a comma-separated list of
HTTP(S) origins; URLs with paths, query strings, credentials, or wildcards fail
startup. Production requires an explicit nonempty origins list.
DATABASE_URL is required and must specify a PostgreSQL host and database name.
Database connection failures stop startup without logging the connection URL.

Run:

    npm run start:dev

Verify:

    curl http://localhost:3100/health

Expected response:

    {"status":"ok","service":"retreat-api"}

There is no global route prefix. GET / and GET /api/health return 404.
CORS controls browser response access and does not authenticate requests.
Requests from scripts or native clients can omit Origin; future protected
routes must enforce authentication and authorization independently.

## Verification

    npm run lint
    npm run prisma:validate
    npm run build
    npm test -- --runInBand
    npm run test:e2e -- --runInBand
    git diff --check

The starter lint command applies formatting fixes. Configuration tests cover
invalid startup settings. HTTP tests cover health, CORS, security headers, DTO
validation, malformed JSON, and safe error responses. Test-only routes are not
registered in the running application.
HTTP foundation tests use a replacement Prisma provider and do not require a
running database. Their success is not evidence of a live database connection.

## Database workflow

Both prisma and @prisma/client are pinned to 5.22.0. The schema lives at
prisma/schema.prisma. Slice 2 intentionally defines no models: the generation
script uses --allow-no-models so connection setup can be verified before table
design. There is no initial migration or seed yet.

After we agree on models and update the schema, the user creates and applies
development migrations with:

    npx prisma migrate dev --name meaningful_change_name

Prisma 5.22 also regenerates the client during that command. To refresh client
types without changing the database, run npm run prisma:generate. Keep generated
migration SQL in Git. Use development migrations only against a development DB.

Reference: https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production

## Working agreement

Work one approved slice at a time. Report verification results and provide a
commit message at the handoff. The user handles staging, commits, pushes,
migrations, and deployment. See PROJECT.md for code conventions.
