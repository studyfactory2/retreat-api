# retreat-api

NestJS backend for the retreat management web app. Package manager: npm.

## Current slice

GET /admin/reports/excel downloads one Korean `.xlsx` workbook with guest
submissions, completed maintenance and issue summaries. Select required from/to
dates and an optional property; checklists use submission dates, issues use
reported dates, and all times display as UTC+09:00. Exports preserve captured
names and current saved revisions. Requests over 62 days or 5,000 combined
records are rejected rather than truncated. No migration is needed. See
[the Excel report guide](docs/admin-reports.md).

GET /admin/dashboard summarizes the selected Seoul day's planned arrivals,
departures and checklist evidence, plus maintenance starts/completions and current
unfinished work/open issues. GET /admin/maintenance provides a paginated cleaning
record list with captured staff identity and explicit expired/blocked/review states.
These are separate administrator modules; neither endpoint changes records or
asserts physical occupancy/room readiness. No migration is needed. See
[the dashboard and maintenance guide](docs/admin-dashboard-maintenance.md).

GET /admin/calendar returns paginated stays for an inclusive Seoul date range
with separate entry/exit checklist states: scheduled, not submitted, submitted,
or needs review. Duplicates and changed/uncertain stay associations are explicit;
no overdue deadline is assumed. New private submissions capture their reviewed
stay context; old evidence stays unchanged. No migration is needed. See
[the calendar guide](docs/admin-calendar.md).

Administrators can find unmatched guest QR checklists, review same-property/day
stay candidates, and link, correct or remove an association with a reason.
Version checks protect edits; every change preserves guest answers/photos and
appends administrator history. Guest view/edit links retain their existing scope.
No migration is needed. See [the linking guide](docs/admin-submission-stays.md).

Administrators can review or skip roster preview rows through
POST /admin/stay-imports/:id/review, then confirm the batch through
POST /admin/stay-imports/:id/confirm. Confirmation rechecks conflicts and saves
new stays, original revision snapshots and import references atomically. Version
checks prevent stale edits; repeated confirmation returns the saved receipt.
No migration is needed. See [the import workflow guide](docs/admin-stay-imports.md).

Administrators can upload the fixed-format `.xls` guest roster and retrieve a
saved, paginated preview through POST /admin/stay-imports/preview and
GET /admin/stay-imports/:id. The preview flags missing times, ambiguous rows,
unmapped properties and overlaps before explicit confirmation. Add the documented
private `imports/*` S3 permissions before a live upload. No migration is needed.
See [the roster preview guide](docs/admin-stay-imports.md).

Guests can correct submitted check-in/out answers and notes through
POST /guest/submissions/correct. Each meaningful edit preserves the original and
appends a revision plus related issue audit events. No additional migration is
needed. See [the correction guide](docs/guest-submission-corrections.md).

Guests can reopen completed check-in/out answers and photos using their saved
checklist token through GET /guest/submissions/current and the scoped photo-view
route. This read-only slice needs no additional migration. See
[the guest checklist viewing guide](docs/guest-submissions.md).

Personal guest stay links now support administrator issuance/replacement/revocation,
private stay context and linked check-in/out draft starts. Run the user-managed
`npx prisma migrate dev --name add_guest_stay_links` before starting this version.
See [the stay-link guide](docs/guest-stay-links.md) for expiry and access behavior.

Guest problem reports now accept up to 10 optional photos. Uploads use private
per-photo tokens, JPEG normalization and private S3; submission claims the photos
atomically as immutable report evidence. See [the guest photo guide](docs/guest-issue-photos.md).

Guests can submit standalone text reports through their property's guest QR.
GET /guest/issues/categories lists active choices; POST /guest/issues/report
creates an issue and original report together, with safe duplicate retries.
See [the guest reporting guide](docs/guest-issues.md).

Administrator issue categories now support paginated search, creation, renaming,
display ordering and activation through GET/POST /admin/issue-categories.
Updates check updatedAt, and the shared 기타 fallback is protected. See
[the category management guide](docs/admin-issue-categories.md).

Administrator issue management now lists reported problems, preserves original
reports and event history, provides private evidence viewing, and records action
notes and version-checked status changes. See
[the issue management guide](docs/admin-issues.md).

Administrators can list completed checklists, read their captured answers and
photo metadata, browse revision history, and request private photo viewing links
through GET /admin/submissions routes. See
[the administrator review guide](docs/admin-submissions.md).

Saved checklists can now be completed through POST /submissions/submit. Completion
atomically preserves revision 1, photo associations and abnormal-item issues.
GET /submissions/receipt returns a minimal private confirmation. See
[the submission API guide](docs/checklist-submissions.md).

Checklist drafts support private photo upload, listing, temporary viewing links
and removal through GET/POST /submission-drafts/photos. Files live in private S3;
metadata and ownership stay in PostgreSQL. See [the photo API guide](docs/draft-photos.md).

Property QR access now issues/replaces separate guest and staff links, reports
issuance status, and resolves scoped property/checklist context. The frontend will
render the returned links as QR images. See [the QR access guide](docs/qr-access.md).

Administrator checklist-template management now supports initial property-specific
guest/maintenance configuration and version-checked maintenance edits through
GET/POST /admin/checklist-templates routes. See [the template API guide](docs/admin-checklist-templates.md).

Administrator stay management now supports creating, listing, correcting,
cancelling, restoring, and reviewing the history of planned visits through
GET/POST /admin/stays routes. Each mutation saves a versioned snapshot; conflicting
dates and stale edits are rejected. See [the stay API guide](docs/admin-stays.md).

Administrator staff and property management now has GET/POST routes under /admin.
Create/edit/deactivate staff profiles and properties, assign/unassign workers,
and query paginated lists. See [the API guide](docs/admin-management.md) for
examples and response contracts. These endpoints use the existing administrator
Bearer login. Staff credentials and guest verification remain a later decision.

The complete MVP Prisma schema now defines 15 tables for users/properties,
visits and roster imports, checklist definitions/submissions/history, photos,
and issue management. Read [the ER and service guide](docs/data-model.md),
[column dictionary](docs/data-dictionary.md), and [ER source](docs/retreat-erd.mmd).
The complete-model migration is present. Other operational APIs remain separate work.

Administrator login uses POST /users/login and GET /users/me with a Bearer
token in the Authorization header. Guest/staff profiles do not require login
credentials. Each property can reference one assigned staff user.

The shared DatabaseModule exports PrismaService for feature services to inject.
Startup checks the database connection, and shutdown disconnects the client.

The existing configuration, validation, error handling, and GET /health remain.
The health endpoint reports application liveness only; it does not query the
database on each request. Submitted-record corrections remain a separate slice
using the defined model.

## Source organization

Each feature has its own folder and Nest module under src/components. Login and
current-profile routes live in users; administrator staff management lives in
admin-users. Public QR context/resolution lives in qr; administrator issuance
and rotation live in admin-property-qr. URLs and request/response contracts are
unchanged by this separation.

All application guard files live in auth/guards. Feature-specific guards are
registered by the module that provides the services they need. Shared image
preparation, photo limits and upload capacity live in photo-processing and are
reused by attachments and guest-issue-photos. Request/response DTOs remain under
src/libs/dto/<feature>.

## Local setup

Use Node.js 22. The project reads a local .env file; no .env.example is maintained.
FRONTEND_URL controls issued QR destinations (local default http://localhost:5175;
production requires an explicit HTTPS origin). Include that frontend origin in
CORS_ORIGINS as well. Configure the local values in .env:

    NODE_ENV=development
    FRONTEND_URL=http://localhost:5175
    PORT=3100
    CORS_ORIGINS=http://localhost:5175,http://127.0.0.1:5175
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
prisma/schema.prisma and defines the complete 15-table MVP model.
The initial users/properties and complete-model migrations are present. The user
controls applying migrations; administrator creation is an explicit terminal command.

Apply the existing migrations and generate/apply this model's remaining changes
in the local development database with:

    npx prisma migrate dev --name complete_mvp_data_model

The assistant has not generated/applied this migration. For subsequent schema
changes, use the same command with a descriptive new name.

Prisma 5.22 also regenerates the client during that command. To refresh client
types without changing the database, run npm run prisma:generate. Keep generated
migration SQL in Git. Use development migrations only against a development DB.

Reference: https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production

## Abandoned photo cleanup

`npm run uploads:cleanup` previews eligible abandoned photos. Deletion requires
`--execute`; `--limit` accepts 1–500 (default 100). The user first runs
`npx prisma migrate dev --name add_upload_cleanup_tracking` for the new tracking
columns. Historical evidence and all import source workbooks are preserved.
See [the cleanup guide](docs/upload-cleanup.md) for exact rules, retries and limits.
Scheduling and live S3 verification remain deployment work.

## Working agreement

Work one approved slice at a time. Report verification results and provide a
commit message at the handoff. The user handles staging, commits, pushes,
migrations, and deployment. See PROJECT.md for code conventions.
