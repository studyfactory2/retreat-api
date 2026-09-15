# retreat-api

NestJS backend for the retreat management web app. Package manager: npm.

## Current slice

The first data-model slice defines User, Property, and Role (ADMIN, STAFF, GUEST)
in Prisma 5.22.0. Users are person profiles; guest and staff profiles do not
require login credentials. Each property can reference one assigned staff user.
Administrator login now uses POST /users/login and GET /users/me with a Bearer
token in the Authorization header. Staff assignment APIs and QR access are
later slices. The initial User/Property migration is present.

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
JWT_SECRET is required and must contain at least 32 bytes. Generate a random
value for each environment and put it in the ignored .env. Never commit it.

## Administrator authentication

After applying the initial migration, create the first administrator locally:

    npm run admin:create

The command asks for a login ID, name, and hidden password with confirmation.
Use at least 12 characters and at most 72 UTF-8 bytes. It refuses to run if any
ADMIN already exists and never overwrites accounts. There is no public signup
or default administrator password.

POST /users/login accepts:

    {"loginId":"your-admin-id","password":"your-password","autoLogin":false}

The response is { user, token, tokenType: "Bearer", expiresIn }.
user contains only id, name, role, and loginId; expiresIn is seconds.
Tokens last 7 days, or 30 days when autoLogin is true, matching the copied flow.
autoLogin is optional and must be a JSON boolean. Login IDs are trimmed and
case-sensitive; passwords are never trimmed.

Call GET /users/me and future protected endpoints with:

    Authorization: Bearer <token>

Only active ADMIN accounts with credentials can log in. Every protected request
rechecks the current user in PostgreSQL. STAFF/GUEST person profiles do not use
this password flow; their scoped QR/private-link access is a later slice.
Missing, malformed, invalid, and expired tokens return 401. A valid account
without the required route role returns 403. Auth responses contain no password
hashes. AuthUser exposes the current safe profile with an id field.

RolesGuard authenticates as well as checking @Roles(Role.ADMIN); do not stack
AuthGuard with it. Metadata works on classes and handlers. WithoutGuard is
optional authentication for public routes only and never protects records.

Login is limited to 10 requests per minute per connecting IP per API process
using Nest Throttler (https://docs.nestjs.com/security/rate-limiting).
Before AWS deployment, configure trusted proxies for the actual network topology;
multiple API instances need shared rate-limit storage. Forwarded headers are
not trusted in local development. Use HTTPS outside local development.
There is no refresh-token/session table or server logout endpoint in this slice.
Removing a token from the browser does not revoke a copied token; expiry,
deactivation, or rotating the signing secret will prevent further access.

## Start the API

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
The initial users/properties migration is present. No migration is needed for
the authentication slice. Administrator creation is an explicit terminal command.

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
