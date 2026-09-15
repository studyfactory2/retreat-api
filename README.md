# retreat-api

NestJS backend for the retreat management web app. Package manager: npm.

## Current slice

The first data-model slice defines User, Property, and Role (ADMIN, STAFF, GUEST)
in Prisma 5.22.0. Users are person profiles; guest and staff profiles do not
require login credentials. Each property can reference one assigned staff user.
These are model definitions only. The user applies the migration below to create
the database tables; login, staff assignment APIs, and QR access are later slices.

The shared DatabaseModule exports PrismaService for feature services to inject.
Startup checks the database connection, and shutdown disconnects the client.

The existing configuration, validation, error handling, and GET /health remain.
The health endpoint reports application liveness only; it does not query the
database on each request. Stays, checklists, issue records, and uploads will be
added in separate slices.

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
    npm run test:e2e -- --runInBand
    git diff --check

The starter lint command applies formatting fixes. Existing HTTP tests cover
health, CORS, security headers, DTO
validation, malformed JSON, and safe error responses. Test-only routes are not
registered in the running application.
HTTP foundation tests use a replacement Prisma provider and do not require a
running database. Their success is not evidence of a live database connection.
Do not create new test files or restore tests the user deleted. Run relevant
existing checks and use focused runtime verification when needed.

## Database workflow

Both prisma and @prisma/client are pinned to 5.22.0. The schema lives at
prisma/schema.prisma. The current schema defines User, Property, and Role.
There is no seed or generated migration yet.

To create the initial tables in the local development database, the user runs:

    npx prisma migrate dev --name init_users_properties

For subsequent schema changes, use the same command with a descriptive new name.

Prisma 5.22 also regenerates the client during that command. To refresh client
types without changing the database, run npm run prisma:generate. Keep generated
migration SQL in Git. Use development migrations only against a development DB.

Reference: https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production

## Working agreement

Work one approved slice at a time. Report verification results and provide a
commit message at the handoff. The user handles staging, commits, pushes,
migrations, and deployment. See PROJECT.md for code conventions.
