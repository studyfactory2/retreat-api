# retreat-api project reference

## Product and working agreement

QR-based retreat operations for guests, cleaning staff, and one administrator.
Five properties initially; a sixth may follow. Client-facing text is Korean;
code and technical documentation are English.

Implement one approved slice at a time. The user controls staging, commits,
pushes, database migrations, and deployment. After implementation, report the
checks performed and provide one commit message. Keep unrelated user changes.
Do not create new test/spec files or restore tests the user deleted. Existing
tests may remain; use relevant existing checks, lint/build, and runtime probes.

## Runtime decisions

- NestJS 11 and TypeScript, managed with npm.
- Local configuration in .env only; no .env.example.
- Default port 3100.
- No global /api prefix.
- PostgreSQL through Prisma 5.22.0, matching jagong-api exactly.
- prisma and @prisma/client must remain on the same version.
- The user runs npx prisma migrate dev --name <name> for development migrations.
- Runtime environment variables override .env.

## Structure

- src/main.ts: process startup, listening, graceful shutdown.
- src/config/: validated runtime settings and shared HTTP setup.
- src/components/: one module per feature, registered in components.module.ts.
- src/libs/dto/<feature>/: input DTOs and response contracts.
- src/libs/filters/: common exception handling.
- src/database/: global DatabaseModule and injectable PrismaService.
- prisma/schema.prisma: PostgreSQL datasource, models, and database enums.
- prisma/migrations/: created by the user's first development migration.

This follows the familiar Jagong module and DTO organization. Keep feature
logic in its own service when needed. Avoid creating empty feature modules.

## HTTP conventions

- English routes; Korean user-facing messages.
- Use GET for reads and POST for every mutation. Administrator management routes
  start with /admin; existing /users/login and /users/me stay unchanged.
- On each administrator handler, declare @Roles(Role.ADMIN) and
  @UseGuards(RolesGuard), then the route decorator. Use public async methods,
  a static console.log such as 'POST: createStaff', and return await the service.
  Do not include request bodies, credentials, tokens, or personal data in logs.
- Use request DTO classes with class-validator decorators.
- Unexpected properties and invalid DTO values return 400.
- Implicit type conversion is disabled. Add explicit conversions where needed.
- Return typed success payloads directly; errors use the common error response.
- Public errors use an HttpException subclass with an object containing code
  and message. Example: BadRequestException({ code: 'INVALID_STAY',
  message: '이용 일정을 확인해 주세요.' }).
- Unmarked HTTP error messages fall back to safe Korean status messages.
- All 5xx messages are generic in responses; diagnostic stacks stay in server
  logs. Error paths omit query strings.
- Validation errors add an errors array of field names and messages. Never
  include input values or sensitive data in validation message templates.
- CORS is an origin allowlist, with credentials disabled. It is not authorization.
- Configure production and HTTP tests through the same configureApp function.

## Slice 1 completion boundary

GET /health returns application liveness, not database or storage readiness.
The old starter routes were removed. Tests cover environment validation and
the shared HTTP behavior.

## Slice 2 completion boundary

The API requires DATABASE_URL and connects to PostgreSQL during module
initialization. PrismaService disconnects on application shutdown. Startup
failure also closes application resources; connection credentials are not logged.

Use the global PrismaService directly in feature services, following Jagong's
organization. No Prisma 7 adapter, generated source directory, or prisma.config.ts
is needed with the selected Prisma 5.22.0 setup.

Slice 2 established the connection with an empty local database. Client
generation supports --allow-no-models; postinstall and prebuild generate the
client without altering the database. The user controls development migrations.

HTTP tests replace PrismaService so they cannot connect to a developer database.
Live connection verification is a separate check.

## First data-model slice

The schema now defines User, Property, and Role (ADMIN, STAFF, GUEST).
No migration has been generated or applied by the assistant. The user runs
npx prisma migrate dev --name init_users_properties to create these tables.
This slice does not implement login, CRUD routes, guest matching, QR access,
or seed accounts/properties.

- User is a person profile. Login ID and password hash are optional for profiles
  that use scoped QR/private links. Future account provisioning must set login
  credentials together and enforce the permitted login roles.
- Names and phone numbers are not unique person identifiers. Import and guest
  matching must not merge profiles solely because their names match.
- Property represents an entire retreat. One property has at most one current
  staff assignee; the same staff profile can be referenced by multiple properties.
- The staff foreign key enforces that a user exists, not their role. Property
  services must require an active STAFF assignee. A stored role alone grants no
  access without the relevant login or scoped link.
- isActive supports deactivation. Assigned staff cannot be physically deleted
  while a property references them. Future historical records preserve their
  own author and guest snapshots when profiles or assignments change.

## Authentication slice

POST /users/login accepts loginId, password, and optional boolean autoLogin.
GET /users/me returns the safe current administrator profile. Header format is
Authorization: Bearer <token>; no cookies or /api prefix. JWT_SECRET is required,
validated, and stored only in local .env or runtime environment configuration.
JWT signing/verifying uses HS256 with retreat-api issuer and retreat-admin audience.
The JWT carries userId; current name/role/account activity come from the database.
AuthUser provides a safe profile with id, name, role, and loginId.

Password login is ADMIN-only. STAFF/GUEST profiles remain separate from login
authorization and will use scoped QR/private links later. MembershipGuard and
Jagong branch/membership fields were removed. RolesGuard includes authentication
and honors method or class @Roles metadata. WithoutGuard remains optional auth
for public routes only. Expected auth failures are 401; role denials are 403;
database failures propagate to the shared 5xx handler.

Tokens retain the copied 7-day lifetime, or 30 days for autoLogin. No refresh or
server logout/revocation table is implemented. Login throttling is 10/minute/IP,
in memory per process; deployment needs topology-specific proxy configuration.
Credentials and names are not logged by auth. Password hashing uses bcrypt cost
12, with 12-character minimum and 72 UTF-8 byte maximum for new passwords.

npm run admin:create is an interactive first-admin command, never a startup seed.
It refuses any existing ADMIN and does not overwrite user records. The user runs
it explicitly after their initial migration. scripts is excluded from the Nest
build to preserve dist/main. No schema changes or migrations accompany auth.
Existing HTTP tests use test-only environment settings from the npm script; the
stale reference to deleted test/setup-env.ts was removed without restoring it.

## Complete MVP model baseline

The user requested all MVP tables before implementing the remaining feature APIs.
prisma/schema.prisma now defines 15 models: User, Property, Stay, StayRevision,
ImportBatch, ImportRow, ChecklistTemplate, ChecklistSubmission, SubmissionRevision,
Attachment, SubmissionRevisionAttachment, IssueCategory, Issue, IssueEvent,
IssueEventAttachment. QR digests are nullable Property fields. Checklists have
validated JSON definitions and immutable submission snapshots with stable item IDs.

Read docs/data-model.md before implementing feature DTOs/services. It defines
relationships, JSON contracts, ownership rules, history transactions, derived views,
and the planned feature DTO/service map. docs/data-dictionary.md lists every stored
column; docs/retreat-erd.mmd contains the full Mermaid ER diagram.

This is schema definition only. The user runs:
npx prisma migrate dev --name complete_mvp_data_model
The assistant does not generate/apply migrations, seed business data, or add
feature routes in this slice. Existing administrator authentication is preserved.

History/photo joins are append-only by service contract. Foreign keys do not
enforce actor roles, workflow transitions, JSON shape, or all optional-link
consistency. Implement the documented invariants transactionally; use restrictive
deletion plus deactivation/cancellation. Expected-version checks prevent stale
imports/corrections from overwriting newer data. Never merge guests/stays on name
alone or cancel visits because a later workbook omits them.

Calendar, missing-checklist indicators, dashboard cards, and reports derive from
operational data; no separate persistence tables are required for these views.

## Confirmed domain constraints for later slices

- Guest and staff QR links are separate per property.
- A QR resolves context; it does not independently verify a person's identity.
- Staff upload after-cleaning photos; before photos are not required.
- Descriptions/photos for reported defects are optional.
- Manager confirmation closes an issue; normal cleaning completion is separate.
- Preserve original submitted wording and answers when checklist templates change.
- Keep correction and cancellation history.
- The client confirmed fixed-format Excel upload with preview before applying it
  to the calendar. Missing entry/exit submissions must be visible. Only managed
  property sheets and real stays are imported; availability rows are not stays.
- Each location is one whole property; no separate Room model is needed.
- Guest entry/exit checklists are mostly fixed. Jeju needs an extra rental-car
  checklist section; the actual items still need to be supplied.
- Maintenance templates are editable per property. Bulk updates across properties
  are not required for the first release.
- Guest private view/edit links are accepted; automatic SMS/Kakao delivery is
  undecided. Guest and staff profiles do not imply a registration requirement.
- Excel exports are accepted. Explain the PDF alternative before treating PDF
  reports as an additional confirmed requirement.
- Calendar, roster import, and missing-submission detection are separate slices.

## Administrator staff/property management slice

AdminUsersController serves /admin/staff through UsersService; the original
UsersController keeps authentication endpoints. PropertiesController serves
/admin/properties through PropertiesService. All nine new handlers explicitly
require RolesGuard and ADMIN. See docs/admin-management.md for request examples,
response fields, status codes, and filters.

Staff creation produces an active STAFF profile without login credentials.
Administrator creation and changing account roles/credentials are not exposed by
these DTOs. Individual staff login and guest stay invitations are proposals still
awaiting the client's answer; this slice does not finalize those access flows.

Properties are created active and unassigned. Assignment is a separate POST and
requires an active property and active STAFF user. Explicit staffUserId: null
unassigns, including on an inactive property. Staff deactivation requires that
all property assignments have already been removed or transferred, including
assignments to inactive properties. Records are deactivated, never deleted here.
Property deactivation does not cancel stays, close issues, or erase assignments.

runSerializableTransaction is shared by assignment, property updates, and staff
updates. Assignment and staff deactivation validate and write within the same
serializable transaction, retrying P2034 up to three attempts. This prevents
concurrent requests from assigning an inactive worker. A final retry conflict is
a safe 409 response. Lists use a repeatable-read transaction for rows and totals.

Inputs use explicit transformations for query numbers/booleans; names are trimmed,
and nullable contact/region fields can be cleared with null or blank text. Unknown
fields and empty updates are rejected. Responses use explicit database selects,
excluding credentials and QR digests. No schema or migration changes are required.

## References

- Nest configuration: https://docs.nestjs.com/techniques/configuration
- Nest CORS: https://docs.nestjs.com/security/cors
