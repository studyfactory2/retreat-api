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
- Local frontend port 5175, used by FRONTEND_URL and the CORS allowlist.
- No global /api prefix.
- PostgreSQL through Prisma 5.22.0, matching jagong-api exactly.
- prisma and @prisma/client must remain on the same version.
- The user runs npx prisma migrate dev --name <name> for development migrations.
- Runtime environment variables override .env.

## Structure

- src/main.ts: process startup, listening, graceful shutdown.
- src/config/: validated runtime settings and shared HTTP setup.
- src/components/: each feature owns its folder, module, controller and services.
  Top-level route features are registered in components.module.ts; shared modules
  are imported by the features that use them.
- src/components/auth/guards/: all application-owned guard files. Feature guards
  remain registered in the module that provides their dependencies; file location
  does not require importing feature modules into AuthModule.
- src/components/photo-processing/: shared image preparation, photo limits and
  upload capacity, imported by both checklist and guest complaint uploads.
- src/components/admin-users/: administrator staff management, separate from
  users/ login and current-profile routes.
- src/components/admin-property-qr/: administrator QR status and rotation,
  separate from qr/ guest/staff context and scoped property resolution.
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

AdminUsersController serves /admin/staff through AdminUsersService in its own
AdminUsersModule; the original
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

## Administrator stay management slice

StaysController implements seven GET/POST routes under /admin/stays, all explicitly
protected by ADMIN and RolesGuard. See docs/admin-stays.md for input/response
contracts. Creation, correction, cancellation, and restoration run through
StaysService and save Stay + StayRevision together in serializable transactions.
The current revision starts at 1. Mutations require expectedRevision, compare the
current version, and use a conditional write before creating the next snapshot.

Stay is a planned visit, not a guest login or proof of physical check-in. ACTIVE
means the visit has not been cancelled. Manual creation stores guest details as
snapshots, leaves guestUserId unset, and sets source MANUAL plus the authenticated
administrator as creator. The browser cannot submit role/source/creator/profile
IDs, raw snapshots, or an arbitrary status. Property cannot be changed after
creation; cancel/recreate a stay assigned to the wrong property.

Timestamps require an ISO date/time with explicit Z or colon offset, seconds,
and optional 1-3 fractional digits. Date-only/local-without-offset strings and
invalid calendar dates are rejected. Convert display dates to Asia/Seoul in the
client. Departure must be later than arrival. Stay list from/to filters use
overlap with a half-open interval; omitted status includes ACTIVE and CANCELLED.

Create, date changes, and restoration require an active property. ACTIVE visits
at a property cannot overlap; checkout exactly at the next arrival is allowed.
Availability is checked inside the same serializable transaction as the write,
including concurrent creation/restoration. Cancelling releases the schedule and
preserves all prior data. Restore checks availability again. Restore/cancel require
a reason. Cancelled stays must be restored before edits. An active stay on an
inactive property can still have guest/notes corrections or be cancelled; its
dates cannot change until the property is reactivated.

Snapshots explicitly include every Stay scalar plus property labels at that time,
and actor snapshots include id/name/role but not credentials. Current property
or administrator profile changes cannot rewrite old snapshots. History is newest
revision first and paginated. PaginationInput now holds shared page/limit rules;
existing ListInput extends it without changing staff/property query behaviour.

No schema changes, migrations, Excel import, guest invitations, QR generation,
vehicle forms, guides, or frontend changes are part of this slice. New guide/vehicle
requirements and final staff/guest access policy remain separate follow-ups.

## Administrator checklist-template slice

ChecklistTemplatesController implements create/list/detail/update under
/admin/checklist-templates, with explicit ADMIN/guard/no-store/static-log handlers.
See docs/admin-checklist-templates.md for nested DTOs and request examples.
One current template exists per property/type (CHECK_IN, CHECK_OUT, MAINTENANCE).
Create requires an active property, rejects caller IDs, and stores version 1.
Guest templates are fixed after initial configuration through these MVP APIs;
routine title/sections/activity updates are MAINTENANCE-only. Property/type never
change. All updates require an active property and expectedVersion. Meaningful
updates increment version atomically; identical values preserve the version.

Definitions use schemaVersion 1, ordered sections/items, and NORMAL_ABNORMAL
answers. Server-generated UUIDs identify sections/items. An update retains only
IDs from the current template and original section; new entries omit IDs. Removed
IDs cannot be supplied later. Limits: 20 sections, 50 items per section, 500 total,
150-character titles, 300-character labels. Nested unknown values and duplicates
are rejected. Stored JSON is validated before exposing typed definitions.

These services never update captured submission templates or revision history.
Draft-time capture and photo/submission validation belong to later slices. No
schema changes, migrations, guest/staff access flow, real template seeding, QR,
uploads, guides, vehicle registration, or frontend are added. Jeju rental-car
wording must be supplied before configuring those actual guest templates.

## Property QR access slice

AdminPropertyQrModule owns ADMIN GET /admin/properties/:id/qr and POST
/admin/properties/:id/qr/guest/rotate plus /staff/rotate. Every rotation requires
expectedRotatedAt (null before first issuance, otherwise the last UTC timestamp),
checks an active property, and writes a new hash/monotonic timestamp atomically.
Competing stale requests fail. Raw 32-byte tokens appear only in the returned
frontend URL fragment; stored SHA-256 digests include the flow. Save/print the
returned link because status cannot reconstruct it. No expiry is imposed on
printed property QR; rotate to replace. Property deactivation suspends access,
and reactivation restores the same QR unless replaced.

QrModule owns public guest/staff context and exports QrService for scoped
property resolution. Issuance and resolution share the pure qr/qr-token.ts hash
helper so existing printed QR tokens retain the same meaning. Each controller's
own module applies the no-store/no-referrer middleware.

GET /qr/guest and /qr/staff consume opaque tokens through Authorization: Bearer.
They return only safe property labels and active flow-specific checklist definitions.
Staff context also returns active STAFF assignment id/name or null. Public context
never includes roster/history/contact details or QR digests. Missing configuration
is represented by empty checklists/null assignee. Assignment context is not identity
verification, and future writes must revalidate scope/configuration independently.

FRONTEND_URL is a validated origin, local default http://localhost:5175 and required
HTTPS in production. Future React pages /guest and /staff read the token fragment,
then call the matching API; QR rendering/pages are not implemented here. Public
endpoints use per-endpoint/IP throttling at 60/minute; login policy is unchanged.
QR middleware sets no-store/no-referrer before guards/handlers. See docs/qr-access.md.

No schema/migration, package, real QR issuance, image generation, personal stay
invitation, guide/vehicle feature, upload, submission, or frontend implementation
is part of this slice. No new test/spec files are added.

## Checklist draft slice

SubmissionDraftsModule adds guest/staff draft starts and private current/save
endpoints under /submission-drafts. All are GET/POST with strict DTOs, throttling,
no-store responses and static logs. See docs/submission-drafts.md for contracts.
Start validates the property QR, current staff assignment and active matching
template in the same serializable transaction. It captures immutable template and
author snapshots; staff starts record server time and Seoul date. Guest details
are self-reported, without account creation or stay matching.

Each draft has its own random token, stored only as a domain-separated digest.
Initial draft access expires after seven days and requires an active property;
staff access also requires the same current active assignee. Shared QR cannot
reopen drafts. Duplicate request keys never disclose/recover credentials. Saves
replace the validated answer set with an expectedUpdatedAt concurrency check;
incomplete drafts are allowed and currentRevision stays zero. Template edits do
not alter captured wording. No schema changes, migrations or new test files.

Photo storage is covered by the separate slice below. Final submission, issue
creation, revision history APIs, personal stay invitations and the submitted-link
lifetime remain later slices. A saved draft must not count as a completed
check-in, check-out or cleaning.

## Draft photo slice

AttachmentsModule provides upload, list, private view and removal under
/submission-drafts/photos, using the private draft token and current draft access
rules. S3Service uses AWS SDK v3 with the default credential chain (local .env
credentials; EC2 instance role in production). PhotoImageService validates actual
JPEG/PNG/WebP bytes and normalizes them to bounded JPEGs without metadata.
Existing Attachment rows track PENDING/READY/FAILED/DELETED and scoped ownership.
No schema changes, migrations, submitted records, issue creation, photo grouping
or new test/spec files are part of this slice. See docs/draft-photos.md for limits,
private URL expiry, deletion/cleanup behavior and deployment follow-ups.

## Final checklist submission slice

SubmissionsModule adds POST /submissions/submit and GET /submissions/receipt using
the existing private draft token, unchanged expiry/activity/assignment rules,
throttling and no-store middleware. See docs/checklist-submissions.md. Submission
validates saved answers against captured required items and explicitly associates
every READY photo with its purpose and captured item/section/area. Pending uploads
block completion; photo ownership/status are checked separately from answer CAS.

One serializable transaction updates SUBMITTED/currentRevision 1/submittedAt,
saves an immutable full snapshot and photo joins, and bulk creates abnormal-item
issues/events/evidence. Staff repair claims produce events but never resolve issues.
An active shared 기타 fallback is used/created transactionally; inactive categories
are not reactivated. Preserve the fallback name until category management provides
an explicit fallback setting. Matching retry fingerprints return the same receipt.

This slice's completed private access exposes the original minimal receipt
(property, type, visit/start/completion dates and counts), without extending expiry.
The existing draft mutation/photo paths still reject completed submissions. No
submitted answer/photo viewing, corrections, admin review/issue APIs, stay matching,
schema changes, migration, new packages or new test/spec files were included in
this original slice. Later review slices below add scoped read access.

## Administrator submission review slice

Administrator review lives in its own AdminSubmissionsModule under
src/components/admin-submissions/, registered alongside SubmissionsModule in
ComponentsModule. Its request/response contracts live under
src/libs/dto/admin-submission/. SubmissionsModule owns guest/staff submission and
receipt routes. Shared pure submission validators are reused without duplicating
services or importing the whole SubmissionsModule into administrator review.

GET /admin/submissions provides completed-record filtering and pagination;
detail, paginated history, and revision-scoped photo viewing are available below
that route. Every handler uses the ADMIN RolesGuard and no-store/no-referrer
middleware. See docs/admin-submissions.md for the response contracts.

Historical wording, property labels and author details come from saved revision
snapshots, not live profiles/templates. DRAFT records stay inaccessible. Activity,
staff assignment changes and private-link expiry do not hide administrator history.
Snapshot fields are explicitly projected; raw JSON, hashes, tokens and storage
keys are never included in detail/history responses. Photo signing verifies both
the historical association and attachment ownership/status. Administrator access
and association are checked again after signing; URLs expire after 120 seconds.

This slice adds no mutations, schema changes, migrations, packages or test files.
Guest corrections, cancellation, issue management and planned-stay matching remain
separate work; the presence of CANCELLED/history read contracts does not implement
those write workflows.

## Administrator issue management slice

AdminIssuesModule is a separate sibling feature under src/components/admin-issues/,
with DTOs under src/libs/dto/admin-issue/. Its six ADMIN endpoints list/read issues,
event history and evidence, and add notes/change status. See docs/admin-issues.md.
The reader preserves original report/event snapshots and validates evidence scope;
the photo service handles bounded private URLs. GET list dates mean inclusive
Korean reported-at days. Cancelled issues are hidden from the default list, remain
historically readable, and reject changes.

POST actions require expectedVersion, recheck the active administrator within a
serializable transaction and atomically append one event while updating the issue.
Resolve and reopen require notes. Resolution records administrator/time; reopening
clears current resolution metadata without deleting the old event. Plain notes use
UPDATED and preserve status. Staff repair claims never auto-resolve, and may mean
the initial currentVersion is already 2. Photo ordering within an event can be
gapped because it comes from the submission's global photo order.

No schema/migration/package/test-file additions. Direct complaints, categories,
urgency editing, cancellation/recurrence writes and frontend remain later work.

## Administrator issue category slice

AdminIssueCategoriesModule owns GET/POST /admin/issue-categories and
POST /admin/issue-categories/:id/update, with separate DTOs and explicit ADMIN
guards. Lists support search, activity filters and stable pagination. Creation
starts active; updates allow name, sortOrder and isActive, with required
expectedUpdatedAt and a conditional write inside a serializable transaction.
Duplicate names and stale edits return safe 409 errors.

The shared FALLBACK_ISSUE_CATEGORY_NAME constant identifies 기타 for category
management and checklist issue creation. This category cannot be renamed or
deactivated; ordinary categories cannot be renamed into it. Sorting and explicit
reactivation remain allowed. No categories are seeded at startup. Existing issue
references and historical labels remain intact. No schema/migration, packages,
new tests, guest category route or direct complaint upload workflow are added.
See docs/admin-issue-categories.md for contracts and limitations.

## Guest text-reporting slice

GuestIssuesModule owns GET /guest/issues/categories and POST /guest/issues/report.
The guest property QR is supplied as an Authorization Bearer token; both routes
resolve an active property in their database transaction. No administrator login
or guest account is used. Guest identity is self-reported, without stay matching.

Reports accept requestKey, categoryId, guestName, title and optional description.
A serializable transaction creates a NEW/version-1 Issue and a full REPORTED
IssueEvent with GUEST_QR source and a captured GUEST actor with no user ID. All
checklist source fields remain null. Existing administrator issue readers, notes
and status changes support these reports using the same snapshot contract.

The request UUID is namespaced by property. Identical normalized retries return
the original minimal receipt; changed content under the same key returns 409.
The original report is compared before checking current category activity, so
replays survive category changes and administrator actions but still require a
current guest QR. No reports, people or mutable status are exposed through a
guest list/detail endpoint. See docs/guest-issues.md for the complete contract.

No migrations, schema changes, packages, default category seeding, new tests,
complaint photos, notifications, guest correction/private links or frontend
screens are included in this slice.

## Guest complaint photo slice

GuestIssuePhotosModule owns upload, private view and remove under
/guest/issues/photos. Guest QR access is checked before multipart parsing and
inside state-changing transactions. Each READY upload returns a separate random
photo token; only its domain-separated digest is stored. A property QR alone
cannot list/view/remove somebody else's uploads. See docs/guest-issue-photos.md.

ReportGuestIssueInput accepts up to 10 ordered {id, token} claims. The report
transaction validates READY PHOTO ownership, consumes the 24-hour claim expiry
and inserts IssueEventAttachment joins to the first REPORTED event atomically.
Digests remain for authenticated retry comparisons, never in public DTOs. Submitted
photos cannot be reused, replaced or removed via upload endpoints. Replays require
the same photo IDs, order and valid tokens; text-only requests remain compatible.

The existing Multer limits, PhotoImageService and S3Service are reused. A shared
PhotoProcessingModule provides image processing and a shared four-upload capacity
service; interceptor instances delegate to it across both upload features. The
two-image-processing limit remains per process. No schema/migration/packages/new
test files are added. Expired abandoned uploads need a deployment cleanup job
that excludes linked evidence. Browser/device checks, live AWS verification and
frontend implementation remain separate from local API probes.

## Personal guest stay link slice

AdminStayLinksModule owns status/issue/revoke under /admin/stays/:id/guest-link;
GuestStaysModule owns /guest/stays/current and /guest/stays/drafts/start.
StayAccessModule shares invitation resolution with SubmissionDraftsModule; the
GuestStayAccessGuard file lives under auth/guards and is provided by the guest
feature. See docs/guest-stay-links.md for contracts and client handling.

Stay has a nullable domain-separated invitation digest/expiry/issued revision/
updated timestamp and a version counter. ChecklistSubmission.stayLinkVersion
binds child capabilities to the original invitation. Any stay revision change,
revocation/replacement, cancellation, inactive property or expiry blocks linked
draft reads/writes/photos/submission/receipts; administrator history is unchanged.
The initial invitation policy is checkout plus seven days, and draft expiry is
capped by both its existing seven-day lifetime and parent invitation expiry.
Guest author/date/property/stayId come from the resolved Stay in the same
serializable transaction as draft creation. Existing QR draft behavior remains.

The user runs npx prisma migrate dev --name add_guest_stay_links. No migration
is generated/applied by the assistant. Prisma client generation and mocked HTTP
verification do not prove migrated PostgreSQL/browser behavior. No frontend,
automatic delivery, guest corrections, resume/token-recovery, calendar matching,
new test files or additional tables are part of this slice.

## Guest completed-checklist viewing slice

GuestSubmissionsModule owns GET /guest/submissions/current and
GET /guest/submissions/photos/:id/view. GuestSubmissionAccessGuard lives under
auth/guards and is provided by the guest feature. The existing submission token
authorizes one SUBMITTED guest CHECK_IN/CHECK_OUT record; no parent invitation,
property QR, staff work token or supplied name substitutes for that credential.
The service reuses private submission access checks, including stay invitation
version/revision/expiry and property activity, then reads the immutable current
revision and validates its photo associations. See docs/guest-submissions.md.

The response explicitly projects captured guest/template/answer/photo fields.
Photo URLs are bounded by 120 seconds and the remaining submission token lifetime;
authorization, revision and evidence ownership are rechecked after signing.
The shared parser is now libs/submissions/submission-snapshot.ts, with neutral
record types under libs/dto/submission-record. Administrator DTO names/shapes and
snapshot validation remain unchanged by that mechanical extraction.

No new schema/migration/packages/test files, frontend, guest corrections, history
browsing or credential recovery. Runtime verification with replacement Prisma/S3
providers does not establish live database/AWS/browser behavior.

## Guest answer/note correction slice

GuestSubmissionsModule also owns POST /guest/submissions/correct through its
GuestSubmissionCorrectionsService. It reuses the private submitted-record guard
and reader, accepts only guest answers/notes plus expectedRevision/optional reason,
and appends immutable CORRECTED snapshots in a serializable transaction. An exact
successful retry is recovered from the next revision's normalized request digest;
changed stale input returns 409. No-op edits do not create revisions. Neither
submittedAt nor private access expiry is extended. See
docs/guest-submission-corrections.md for request, history and photo behavior.

Guest corrections reconcile changed item reports in the same transaction. New
abnormalities create deduplicated issues; existing ones receive UPDATED events.
Manager resolution/cancellation and original evidence/source references remain
intact. Photos on still-abnormal answers are retained in the new revision; photos
on cleared/normal answers remain only in original history/evidence. Replacement
uploads and arbitrary photo selection are outside this slice. The neutral issue
snapshot parser/builder lives under libs/issues with shared record DTOs, keeping
guest correction logic independent of administrator feature modules.

No schema/migration, package, frontend or test-file additions. The user retains
control of commits/migrations/deployment; live database/AWS/browser verification
remains separate from local synthetic HTTP/transaction checks.

## Administrator Excel roster preview slice

AdminStayImportsModule owns POST /admin/stay-imports/preview and paginated
GET /admin/stay-imports/:id with explicit ADMIN/RolesGuard and no-store headers.
Upload accepts one legacy .xls file up to 5 MiB plus optional propertyMappings
JSON text. It saves only a private IMPORT_SOURCE Attachment and ImportBatch/Rows;
no Stay, guest profile, StayRevision or calendar data is changed. See
docs/admin-stay-imports.md for format, mappings, response and IAM instructions.

SheetJS 0.20.3 is pinned to its official distribution. A bounded worker reads
the original cell values/types/formats without evaluating formulas. The fixed
template parser distinguishes managed stays, availability and unrelated sheets,
preserves explicit Asia/Seoul times, and flags missing times or ambiguous guest
columns. Mappings explicitly select existing properties; names never merge
guests. Source and active-database overlaps require review. Cancelled stays do
not block the preview. Original values and row numbers remain available.

ImportSourceStorageService is separate from photo storage and uses the existing
S3 configuration/credential chain with a private imports/ prefix. The IAM user
and future EC2 role need PutObject/DeleteObject permissions for that prefix.
The attachment becomes READY atomically with the complete saved preview; failed
unreferenced uploads are marked FAILED and deletion is attempted. Referenced
sources are protected during uncertain commit cleanup. Repeated uploads create
separate previews. A future confirmation slice must revalidate before applying.

No schema/migration, frontend or test-file additions. The user retains control
of commits and AWS configuration. Local parser and HTTP probes use synthetic
database/S3 providers; live PostgreSQL/AWS integration remains unverified.

## Administrator import review and confirmation slice

AdminStayImportReviewService owns POST /admin/stay-imports/:id/review and
AdminStayImportConfirmationService owns POST /admin/stay-imports/:id/confirm
inside the existing admin-stay-imports feature. Both require ADMIN, current batch
expectedVersion, strict JSON and empty queries. Shared validation reloads active
administrator/property state, enforces final stay field rules, preserves untouched
source warnings and recomputes dynamic conflicts. Review accepts 1-100 complete
CREATE replacements or SKIP choices; no automatic UPDATE/matching is supported.
Original source cells remain immutable, with latest review metadata stored beside
the normalized data. See docs/admin-stay-imports.md for full contracts.

Confirmation creates EXCEL/ACTIVE stays, revision-1 snapshots and import-row
references in one serializable transaction, then returns a stored receipt. All
unresolved candidates block confirmation; a fully skipped batch can confirm with
zero stays. Conditional batch version writes and same-version replay prevent
duplicate confirmations. Existing stays and guest profiles remain untouched.
Rows expose applied stay IDs/timestamps; confirmed batch metadata is visible in
the saved preview. Failed confirmation reports fresh row errors without partial
stays or changing the saved preview.

Bulk writes use bounded parameterized statements. The serializable helper now
accepts optional timeout/maxWait settings; only import review/confirmation opt
into 60s/10s, preserving other callers' defaults. No schema, migration, dependency,
frontend or test-file additions. User owns commits and production operations.

## Administrator checklist-to-stay linking slice

AdminSubmissionStaysModule independently owns GET
/admin/submissions/:id/stay-candidates and POST
/admin/submissions/:id/link-stay. Existing admin submission lists add a
linkStatus filter and stayId/authorSource summary fields. All new routes require
ADMIN, strict DTOs and no-store responses. See docs/admin-submission-stays.md.

Only completed GUEST_QR check-in/out records without a stay-link version can be
linked, relinked or unlinked. Candidate stays must be active at the same active
property with the relevant arrival/departure date equal to the recorded visit
date in Asia/Seoul. Names do not automatically match people. Required submission
and target stay revisions prevent stale decisions; required reasons and captured
administrator actors document every meaningful change. A cancelled target or
inactive property does not prevent removing a mistaken association.

Serializable writes preserve original guest details, dates, answers, photo joins,
issue evidence, receipts and private capabilities. CORRECTED snapshots retain
history; exact actor-bound retries recover the original result. The snapshot's
stayLinkChange describes only the administrator action, while stayMatch captures
the reviewed stay revision/dates and survives later guest answer corrections.
Current admin readers validate stayId consistency; old history retains old IDs.

Link-time duplicate checks protect concurrent administrator linking, but do not
introduce a global uniqueness rule for existing private-link finalization.
Future calendar work must handle duplicates and changed stay revisions explicitly.
No schema, migration, dependency, new test file, frontend, calendar endpoint or
missing-checklist calculation is included. The user controls commits and rollout.

## Administrator calendar slice

AdminCalendarModule owns GET /admin/calendar with explicit ADMIN, no-store and
60/minute/IP throttling. Required from/to are inclusive Seoul dates with a 62-day
maximum; optional propertyId and stable stay pagination are supported. ACTIVE
means not cancelled; stays at inactive properties remain visible. Arrivals before
the exclusive range end and departures at/after the range start are included,
including midnight checkout events. See docs/admin-calendar.md.

Separate checkIn/checkOut states are SCHEDULED, NOT_SUBMITTED, SUBMITTED or
NEEDS_REVIEW. Missing records on future days are scheduled; no overdue deadline
is assumed. Only linked SUBMITTED guest checklists count. Duplicates always need
review. Singleton current snapshots are validated against submission scalars and
captured stayMatch revision/name/full dates. Any changed stay revision is reviewed;
invalid or missing context cannot silently count as completion. All rows/counts
share a repeatable-read transaction; duplicate evidence is counted without loading
all snapshots. Existing admin submission lists add an optional stayId drilldown.

New PRIVATE_LINK finalizations capture stayMatch in the original snapshot with
parent access rechecked inside the existing serializable transaction. Exact
retries and legacy snapshots remain unchanged. Existing guest corrections preserve
the context. Legacy private submissions without it are flagged for review; there
is no speculative backfill or new private reassignment endpoint. Current guest
invitation expiry/revocation/reissue does not erase historical calendar completion.

No schema, migration, dependency or new test file is introduced. This is API work;
frontend calendar, dashboard, exports, overdue policy and deployment remain
separate. Calendar states do not assert physical guest presence or cleaning.

## Administrator dashboard and maintenance progress slice

AdminDashboardModule owns GET /admin/dashboard; AdminMaintenanceModule owns
GET /admin/maintenance. Each has its own controller/service/DTOs, explicit ADMIN
and RolesGuard, 60/minute/IP throttling, and no-store/no-referrer middleware.
See docs/admin-dashboard-maintenance.md for filters, counts, states and drilldowns.

Dashboard defaults to today's Seoul date. Arrival/entry counts use checkInAt;
departure/exit counts use checkOutAt. It counts every ACTIVE stay with an event on
that day, processing bounded batches in one repeatable-read transaction. Calendar
and dashboard share libs/calendar/checklist-status.ts and libs/dates/seoul-date.ts
so singleton evidence, duplicate handling and changed stay context agree. Calendar
pagination and its date/error contract remain unchanged. The aggregate is not
calculated from the first calendar page.

Maintenance reads share libs/maintenance/maintenance-progress.ts. Started counts
use startedAt; completed counts require valid current submitted evidence and use
submittedAt. Invalid submitted evidence has its own review count. Unfinished
counts include all current drafts, even those started before the selected date;
open issues likewise include older noncancelled NEW/IN_PROGRESS records. These
are present-state views over a selected day, not a historical reconstruction.

Maintenance lists page in SQL before classifying at most 100 records. Optional
from/to must be paired, ordered Seoul dates spanning at most 62 days. view selects
ALL, UNFINISHED (drafts) or COMPLETED (submitted records); invalid submitted records
still appear with NEEDS_REVIEW. Derived status is not an input filter. Staff names
come from captured evidence, never a mutable profile fallback. Completed evidence
uses captured property labels and is independent of current assignment/expiry.

These routes are read-only and require no schema, migrations or new dependencies.
No new test files are introduced. Cleaning records are not deduplicated work jobs,
physical cleaner presence or automatic room-ready decisions. Frontend, exports,
guides, vehicle registration, cleanup and deployment remain separate work.

## Administrator Excel report slice

AdminReportsModule owns GET /admin/reports/excel. Its controller explicitly uses
ADMIN/RolesGuard, no-store/no-referrer middleware and 10/minute/IP/process
throttling. It returns an XLSX attachment with an ASCII filename; Content-Disposition
is exposed to allowed browser origins. There is no global /api prefix.

GetAdminReportInput requires from/to date-only values in 1900–2100; propertyId is
optional. AdminReportReaderService enforces inclusive UTC+09:00 days with a 62-day
maximum. It counts submitted/noncancelled guest and maintenance records plus
noncancelled issues first, rejects more than 5,000 combined records, then reads
100-row keyset batches within one RepeatableRead transaction (30-second timeout).
All properties, including inactive ones, are eligible. Records sort by event date
then ID within each sheet after bounded reads. No list-page truncation is used.

Checklist selection uses submittedAt, not visitDate. Issues use reportedAt and
their current status at export time. Draft/cancelled submissions and cancelled
issues are excluded. Current immutable revisions/event snapshots are validated
against scalar fields; damaged eligible evidence rejects the whole export with
409 REPORT_RECORD_NEEDS_REVIEW. Existing issue readers retain their own error
contract. Historical labels and author names come from saved evidence, independent
of current property/staff activity or token expiry. No links are inferred by name.

AdminReportWorkbookService uses the existing xlsx dependency. It writes three
Korean summary sheets with filterable columns, numeric counts, sortable numeric
dates, period/property/output-time metadata and per-sheet/combined record counts.
Text uses explicit string cells, never formulas/hyperlinks. Phone numbers, tokens,
storage keys, signed URLs, detailed answers, images and full history are omitted.
The XLSX byte limit is 16 MiB; oversized exports return 413 REPORT_TOO_LARGE.

AdminReportsService permits one in-process generation at a time and clears its
guard in finally on success/failure. Busy generation returns 429 REPORT_EXPORT_BUSY.
Only successful output receives XLSX headers; failures use the shared JSON error
format. The file is generated in memory, returned directly and not stored in S3.
See docs/admin-reports.md for download usage, dates, exclusions and errors.

No schema, migration, new package, new test file, frontend or deployment changes
are included. Guides, vehicle registration, final client configuration, upload
cleanup and release verification remain separate slices.

## Property usage guide slice

AdminPropertyGuidesModule owns GET/POST /admin/properties/:id/guide with explicit
ADMIN/RolesGuard. POST fully replaces title/content/isPublished and requires
expectedVersion (0 only on first creation). Serializable saves recheck the active
administrator, reject stale versions and map concurrent creation conflicts to
409 PROPERTY_GUIDE_CHANGED. Inactive properties can be configured for later use.

GuestPropertyGuidesModule independently owns GET /guest/property-guides/qr and
/guest/property-guides/stay. Each accepts only its designated guest Bearer token
through the existing QR/stay resolver. The resolved property and published guide
are read in one RepeatableRead transaction; missing/hidden guides return null.
No property ID selection, private guest details or editor IDs appear in guest
responses. Existing QR and guest-stay context contracts remain unchanged.

New PropertyGuide is a one-to-one optional property table with plain-text content,
publication state, version, last administrator ID and timestamps. There is no
guide revision archive or separate published/draft copy. General instructions
are equally available through valid guest QR and private links; restricted entry
codes/private guest data require a separate access design. Frontend must render
escaped text, never HTML. See docs/property-guides.md for DTOs and error cases.

All guide routes reject unexpected query parameters and send no-store/no-referrer
headers. Read limits are 60/min/IP/process; admin save limit is 20/min/IP/process.
The user runs npx prisma migrate dev --name add_property_guides. No migration,
business seed, new package or new test file is created by the assistant. Actual
guide content, frontend, vehicle capture, cleanup and deployment remain separate.

## Guest stay vehicle slice

Property.vehicleRegistrationEnabled defaults false and is managed through the
existing administrator property create/update DTOs. Property reads and the
private guest stay context expose it. No property is automatically enabled.
StayVehicle holds one current nullable plate per stay, its own version, the
captured stayRevision and timestamps. Plate saves never change the stay/link
revision or checklist evidence. The user runs npx prisma migrate dev --name
add_stay_vehicles; the assistant does not generate/apply migrations.

GuestStayVehiclesModule owns GET/POST /guest/stays/vehicle through the existing
GuestStayAccessGuard and private stay resolver inside each transaction. It accepts
no client-selected stay/property ID. Disabled properties hide guest plate data
and reject saves; stale versions and concurrent first saves return 409. Null
explicitly clears the plate while preserving its edit version. New invitations
for changed stay revisions hide the old plate and request reconfirmation.

AdminStayVehiclesModule owns GET /admin/stays/:id/vehicle with ADMIN/RolesGuard.
It retains visibility of disabled/cancelled/inactive historical context and flags
non-cleared plates from older stay revisions as needsReview. Vehicle input bounds
do not verify a legal registration; this feature collects details for the manager
without integrating a parking provider. See docs/stay-vehicles.md for complete
contracts, plain-data rendering, edit semantics and completion boundaries.

All new routes use no-store/no-referrer, strict DTOs/empty queries and existing
per-process throttling. No package, seed, new test file, frontend, migration or
deployment is included. Cleanup, final content/configuration and release checks
remain separate work.

## References

- Nest configuration: https://docs.nestjs.com/techniques/configuration
- Nest CORS: https://docs.nestjs.com/security/cors
