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

## Remaining model sequence

The remaining model names are the working design, to be added with their slices:

1. User and Property: shared people and whole-retreat definitions (defined).
2. Stay and ImportBatch: scheduled visits and reviewed Excel imports.
3. ChecklistTemplate, ChecklistSubmission, SubmissionRevision: per-property
   checklist definitions, guest/staff records, and preserved historical versions.
4. Attachment: stored file metadata and ownership.
5. IssueCategory, Issue, IssueEvent: configurable categories and repair history.

The calendar and missing-checklist indicators derive from stays and submissions.
Reports are generated from operational records. They need no separate tables in
this first design. Later models will add relations to User and Property.

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

## References

- Nest configuration: https://docs.nestjs.com/techniques/configuration
- Nest CORS: https://docs.nestjs.com/security/cors
