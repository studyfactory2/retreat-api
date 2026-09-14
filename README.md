# retreat-api

NestJS backend for the retreat management web app. Package manager: npm.

## Current slice

Slice 1 provides validated configuration, request validation, standard error
responses, Helmet headers, configured browser origins, and GET /health.
The health endpoint reports application liveness only. PostgreSQL, administrator
login, guest forms, maintenance, and storage will arrive in later slices.

## Local setup

Use Node.js 22 and run npm install. The project reads a local .env file;
no .env.example is maintained. Set these values in .env:

    NODE_ENV=development
    PORT=3100
    CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

The local .env is excluded from Git. Runtime environment variables override
values from that file. PORT must be an integer from 1 to 65535. NODE_ENV supports
development, test, or production. CORS_ORIGINS is a comma-separated list of
HTTP(S) origins; URLs with paths, query strings, credentials, or wildcards fail
startup. Production requires an explicit nonempty origins list.

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
    npm run build
    npm test -- --runInBand
    npm run test:e2e -- --runInBand
    git diff --check

The starter lint command applies formatting fixes. Configuration tests cover
invalid startup settings. HTTP tests cover health, CORS, security headers, DTO
validation, malformed JSON, and safe error responses. Test-only routes are not
registered in the running application.

## Database plan

PostgreSQL will use Prisma in Slice 2. The user creates and applies development
migrations with:

    npx prisma migrate dev --name meaningful_change_name

Prisma and database credentials are not configured in Slice 1.

## Working agreement

Work one approved slice at a time. Report verification results and provide a
commit message at the handoff. The user handles staging, commits, pushes,
migrations, and deployment. See PROJECT.md for code conventions.
