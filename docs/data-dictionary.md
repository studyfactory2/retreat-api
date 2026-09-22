# Retreat MVP column dictionary

Generated from the Prisma schema for this model slice. This is a reference for DTO/service design; it does not create a migration or implement APIs. Regenerate/update it when the schema changes.

`?` means nullable, `[]` indicates a relation collection rather than a stored column. UUID IDs are stored as PostgreSQL text to remain compatible with the existing User/Property schema. `uuid()` and `@updatedAt` are Prisma-managed. New instant columns use timestamptz(3); visitDate uses date. Existing User/Property timestamps retain their original type.

See [data-model.md](data-model.md) for JSON shapes, permissions, workflow invariants, and the implementation plan.

## Enums

| Enum | Values |
|---|---|
| Role | ADMIN, STAFF, GUEST |
| StayStatus | ACTIVE, CANCELLED |
| StaySource | MANUAL, EXCEL |
| StayRevisionAction | CREATED, CORRECTED, CANCELLED, RESTORED |
| ImportStatus | PREVIEW, CONFIRMED, CANCELLED, FAILED |
| ImportRowAction | CREATE, UPDATE, SKIP |
| ImportRowStatus | VALID, NEEDS_REVIEW, INVALID |
| ChecklistType | CHECK_IN, CHECK_OUT, MAINTENANCE |
| SubmissionStatus | DRAFT, SUBMITTED, CANCELLED |
| SubmissionRevisionAction | SUBMITTED, CORRECTED, CANCELLED, RESTORED |
| ActorSource | ADMIN_SESSION, GUEST_QR, STAFF_QR, PRIVATE_LINK, SYSTEM |
| AttachmentKind | PHOTO, IMPORT_SOURCE |
| AttachmentStatus | PENDING, READY, FAILED, DELETED |
| PhotoPurpose | DEFECT, MAINTENANCE_BEFORE, MAINTENANCE_AFTER, REPAIR |
| IssueStatus | NEW, IN_PROGRESS, RESOLVED |
| IssueEventType | REPORTED, UPDATED, STATUS_CHANGED, REPAIR_REPORTED, RESOLVED, REOPENED, CANCELLED, RESTORED |

## User

Shared administrator, worker, and guest profiles.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| name | String / text | required | Display name; historical records keep their own label snapshots. |
| role | Role / Role | required; default GUEST | Person category; not proof of authorization. |
| loginId | String? / text | nullable; unique | Optional unique administrator login ID. |
| passwordHash | String? / text | nullable | Password hash only; never return in DTOs. |
| phone | String? / text | nullable | Optional contact number; not a unique person identifier. |
| company | String? / text | nullable | Company name captured for this record. |
| department | String? / text | nullable | Department captured for this record. |
| isActive | Boolean / boolean | required; default true | Soft deactivation flag. |
| createdAt | DateTime / timestamp(3) | required; default now() | Creation instant. |
| updatedAt | DateTime / timestamp(3) | required; Prisma updatedAt | Last current-record update instant. |

Composite keys/indexes:

- `@@index([role, isActive])`

## Property

An entire retreat, its current worker, and QR capabilities.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| name | String / text | required; unique | Display name; historical records keep their own label snapshots. |
| region | String? / text | nullable | region |
| isActive | Boolean / boolean | required; default true | Soft deactivation flag. |
| staffUserId | String? / text | nullable; foreign key | Current assigned active STAFF profile. |
| vehicleRegistrationEnabled | Boolean / boolean | required; default false | Enables guest vehicle collection through personal stay links. |
| guestQrTokenHash | String? / text | nullable; unique | SHA-256 digests of independent random guest/staff QR capabilities; never plaintext tokens. |
| staffQrTokenHash | String? / text | nullable; unique | staffQrTokenHash |
| guestQrRotatedAt | DateTime? / Timestamptz(3) | nullable | Last guest QR issuance/rotation instant. |
| staffQrRotatedAt | DateTime? / Timestamptz(3) | nullable | Last staff QR issuance/rotation instant. |
| createdAt | DateTime / timestamp(3) | required; default now() | Creation instant. |
| updatedAt | DateTime / timestamp(3) | required; Prisma updatedAt | Last current-record update instant. |

Foreign keys:

- (staffUserId) → User(id); Restrict deletion.

Composite keys/indexes:

- `@@index([staffUserId])`

## Stay

Current scheduled visit and guest details.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| propertyId | String / text | required; foreign key | Owning or selected whole property. |
| guestUserId | String? / text | nullable; foreign key | Optional guest-profile association. |
| guestName | String / text | required | Guest name snapshot, independent of later profile edits. |
| company | String? / text | nullable | Company name captured for this record. |
| department | String? / text | nullable | Department captured for this record. |
| phone | String? / text | nullable | Optional contact number; not a unique person identifier. |
| checkInAt | DateTime / Timestamptz(3) | required | Arrival instant, normalized explicitly from source. |
| checkOutAt | DateTime / Timestamptz(3) | required | Departure instant; must be later than arrival. |
| status | StayStatus / StayStatus | required; default ACTIVE | Current lifecycle/workflow state. |
| source | StaySource / StaySource | required; default MANUAL | Original creation method. |
| notes | String? / text | nullable | Optional current administrative notes. |
| createdByUserId | String / text | required; foreign key | Administrator who created the visit. |
| guestLinkTokenHash | String? / text | nullable; unique | Domain-separated digest of the stay invitation; never expose it. |
| guestLinkExpiresAt | DateTime? / Timestamptz(3) | nullable | Initial invitation expiry: planned checkout plus seven days. |
| guestLinkVersion | Int / integer | required; default 0 | Separate invitation generation counter; increments on issue/revoke. |
| guestLinkStayRevision | Int? / integer | nullable | Stay revision for which the invitation was issued; mismatch disables access. |
| guestLinkUpdatedAt | DateTime? / Timestamptz(3) | nullable | Last monotonic issuance/revocation timestamp. |
| currentRevision | Int / integer | required; default 0 | Increment transactionally with each immutable StayRevision, starting at 1 on creation. |
| cancelledAt | DateTime? / Timestamptz(3) | nullable | Cancellation instant; null while not cancelled. |
| cancellationReason | String? / text | nullable | Optional retained explanation for cancellation. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |
| updatedAt | DateTime / Timestamptz(3) | required; Prisma updatedAt | Last current-record update instant. |

Foreign keys:

- (propertyId) → Property(id); Restrict deletion.
- (guestUserId) → User(id); Restrict deletion.
- (createdByUserId) → User(id); Restrict deletion.

Composite keys/indexes:

- `@@unique([id, propertyId])`
- `@@index([propertyId, status, checkInAt])`
- `@@index([propertyId, status, checkOutAt])`
- `@@index([guestUserId])`
- `@@index([createdByUserId])`

## StayVehicle

Current vehicle details for one stay; at most one row per stay. See
[vehicle API contracts](stay-vehicles.md).

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| stayId | String / text | primary key; foreign key | Parent stay; no name-based matching. |
| plateNumber | String? / text | nullable | Normalized plate, null if explicitly cleared. |
| version | Int / integer | default 1 | Independent optimistic edit version, including clears. |
| stayRevision | Int / integer | required | Stay revision authenticated at the most recent vehicle save. |
| createdAt | DateTime / Timestamptz(3) | default now() | First-save instant. |
| updatedAt | DateTime / Timestamptz(3) | @updatedAt | Latest-save instant. |

Foreign key: stayId → Stay(id), Restrict deletion. Vehicle saves do not advance
Stay.currentRevision. After any stay revision change, guests must re-enter their
plate through a current invitation; the old plate is admin-only until replaced.
Versions prevent stale overwrites, but do not create a vehicle history archive.

## StayRevision

Immutable complete version of a scheduled visit.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| stayId | String / text | required; foreign key | stayId |
| version | Int / integer | required | Revision/version number; positive and unique where declared. |
| action | StayRevisionAction / StayRevisionAction | required | Operation represented by this row. |
| snapshot | Json / jsonb | required | Versioned immutable full state; see the JSON contract guide. |
| actorUserId | String / text | required; foreign key | Optional or required acting person; authenticate independently. |
| actorSnapshot | Json / jsonb | required | Versioned actor name/role/context snapshot. |
| reason | String? / text | nullable | Optional reason for the historical action. |
| importRowId | String? / text | nullable; unique; foreign key | Optional spreadsheet row responsible for this revision. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |

Foreign keys:

- (stayId) → Stay(id); Restrict deletion.
- (actorUserId) → User(id); Restrict deletion.
- (importRowId) → ImportRow(id); Restrict deletion.

Composite keys/indexes:

- `@@unique([stayId, version])`
- `@@index([actorUserId])`

## ImportBatch

One workbook upload and review/confirmation lifecycle.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| sourceAttachmentId | String / text | required; unique; foreign key | Private original roster workbook. |
| status | ImportStatus / ImportStatus | required; default PREVIEW | Current lifecycle/workflow state. |
| parserVersion | String / text | required; default "retreat-roster-v1" | Version of the fixed-format roster parser. |
| timezone | String / text | required; default "Asia/Seoul" | Time zone used when interpreting this workbook. |
| version | Int / integer | required; default 1 | Revision/version number; positive and unique where declared. |
| uploadedByUserId | String / text | required; foreign key | Authenticated uploader when present. |
| confirmedByUserId | String? / text | nullable; foreign key | Administrator who confirmed the preview. |
| confirmedAt | DateTime? / Timestamptz(3) | nullable | Successful batch confirmation instant. |
| cancelledAt | DateTime? / Timestamptz(3) | nullable | Cancellation instant; null while not cancelled. |
| failureMessage | String? / text | nullable | Safe operator-facing parsing/import failure text. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |
| updatedAt | DateTime / Timestamptz(3) | required; Prisma updatedAt | Last current-record update instant. |

Foreign keys:

- (sourceAttachmentId) → Attachment(id); Restrict deletion.
- (uploadedByUserId) → User(id); Restrict deletion.
- (confirmedByUserId) → User(id); Restrict deletion.

Composite keys/indexes:

- `@@index([status, createdAt])`
- `@@index([uploadedByUserId])`
- `@@index([confirmedByUserId])`

## ImportRow

One located source row with raw data, review, and applied provenance.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| batchId | String / text | required; foreign key | Containing workbook preview. |
| sheetName | String / text | required | Original workbook sheet name. |
| rowNumber | Int / integer | required | Positive original row number within the sheet. |
| rawData | Json / jsonb | required | Preserved source headers/cells and time strings. |
| normalizedData | Json? / jsonb | nullable | Versioned proposed normalized visit values. |
| validationStatus | ImportRowStatus / ImportRowStatus | required; default NEEDS_REVIEW | Whether the row is valid, unresolved, or invalid. |
| validationMessages | Json / jsonb | required; default "[]" | Structured review messages. |
| action | ImportRowAction / ImportRowAction | required; default SKIP | Operation represented by this row. |
| propertyId | String? / text | nullable; foreign key | Owning or selected whole property. |
| stayId | String? / text | nullable; foreign key | Reviewed update target or newly created stay after confirmation. |
| expectedStayRevision | Int? / integer | nullable | Version of the target visit reviewed by the administrator. |
| beforeSnapshot | Json? / jsonb | nullable | Complete visit state immediately before this row was applied. |
| afterSnapshot | Json? / jsonb | nullable | Complete visit state immediately after this row was applied. |
| appliedAt | DateTime? / Timestamptz(3) | nullable | Successful row application instant. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |
| updatedAt | DateTime / Timestamptz(3) | required; Prisma updatedAt | Last current-record update instant. |

Foreign keys:

- (batchId) → ImportBatch(id); Restrict deletion.
- (propertyId) → Property(id); Restrict deletion.
- (stayId, propertyId) → Stay(id, propertyId); Restrict deletion.

Composite keys/indexes:

- `@@unique([batchId, sheetName, rowNumber])`
- `@@index([batchId, action, validationStatus])`
- `@@index([propertyId])`
- `@@index([stayId, propertyId])`

## ChecklistTemplate

Current checklist definition for one property and type.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| propertyId | String / text | required; foreign key | Owning or selected whole property. |
| type | ChecklistType / ChecklistType | required | Record kind or checklist/event classification. |
| title | String / text | required | Display title, including generated issue titles. |
| version | Int / integer | required; default 1 | Revision/version number; positive and unique where declared. |
| definition | Json / jsonb | required | Versioned JSON contract: ordered sections/items with stable IDs; see docs/data-model.md. |
| isActive | Boolean / boolean | required; default true | Soft deactivation flag. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |
| updatedAt | DateTime / Timestamptz(3) | required; Prisma updatedAt | Last current-record update instant. |

Foreign keys:

- (propertyId) → Property(id); Restrict deletion.

Composite keys/indexes:

- `@@unique([propertyId, type])`
- `@@unique([id, propertyId])`

## ChecklistSubmission

Current guest inspection or staff job, including drafts and scoped access.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| requestKey | String / text | required; unique | Client-generated UUID for idempotent draft/start requests; not an authorization token. |
| propertyId | String / text | required; foreign key | Owning or selected whole property. |
| type | ChecklistType / ChecklistType | required | Record kind or checklist/event classification. |
| templateId | String / text | required; foreign key | Source template, constrained to the same property. |
| templateVersion | Int / integer | required | Captured template version at draft start. |
| templateSnapshot | Json / jsonb | required | Captured versioned definition; independent of future template edits. |
| stayId | String? / text | nullable; foreign key | Optional reviewed calendar match; never infer identity from a name alone. |
| stayLinkVersion | Int? / integer | nullable | Invitation generation captured by a stay-linked guest draft; null for existing QR drafts. |
| authorUserId | String? / text | nullable; foreign key | Optional attributed profile; QR does not authenticate that person. |
| authorSnapshot | Json / jsonb | required | Versioned claimed author name/company/department. |
| authorSource | ActorSource / ActorSource | required | How the author reached the form. |
| visitDate | DateTime / Date | required | Local inspection/work date; SQL date. |
| status | SubmissionStatus / SubmissionStatus | required; default DRAFT | Current lifecycle/workflow state. |
| draftAnswers | Json? / jsonb | nullable | Mutable versioned answers while the record is a draft. |
| currentRevision | Int / integer | required; default 0 | Current immutable-history version; updated atomically. |
| startedAt | DateTime? / Timestamptz(3) | nullable | Maintenance start instant. |
| submittedAt | DateTime? / Timestamptz(3) | nullable | Original successful submission/completion instant. |
| cancelledAt | DateTime? / Timestamptz(3) | nullable | Cancellation instant; null while not cancelled. |
| privateTokenHash | String? / text | nullable; unique | Digest of a per-submission capability; never expose the stored value. |
| privateTokenExpiresAt | DateTime? / Timestamptz(3) | nullable | Configured private-link expiration; nullable. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |
| updatedAt | DateTime / Timestamptz(3) | required; Prisma updatedAt | Last current-record update instant. |

Foreign keys:

- (propertyId) → Property(id); Restrict deletion.
- (templateId, propertyId) → ChecklistTemplate(id, propertyId); Restrict deletion.
- (stayId, propertyId) → Stay(id, propertyId); Restrict deletion.
- (authorUserId) → User(id); Restrict deletion.

Composite keys/indexes:

- `@@unique([id, propertyId])`
- `@@index([propertyId, type, status, visitDate])`
- `@@index([propertyId, type, startedAt])`
- `@@index([stayId, type, status])`
- `@@index([templateId, propertyId])`
- `@@index([authorUserId])`

## SubmissionRevision

Immutable submitted version and actor context.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| submissionId | String / text | required; foreign key | Owning submission; may be null for non-checklist uploads. |
| version | Int / integer | required | Revision/version number; positive and unique where declared. |
| action | SubmissionRevisionAction / SubmissionRevisionAction | required | Operation represented by this row. |
| status | SubmissionStatus / SubmissionStatus | required | Current lifecycle/workflow state. |
| snapshot | Json / jsonb | required | Includes template wording, answers, claimed author, dates, and matching state; photos have real FK links. |
| actorSource | ActorSource / ActorSource | required | Authenticated session, QR, private link, or system context. |
| actorUserId | String? / text | nullable; foreign key | Optional or required acting person; authenticate independently. |
| actorSnapshot | Json / jsonb | required | Versioned actor name/role/context snapshot. |
| reason | String? / text | nullable | Optional reason for the historical action. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |

Foreign keys:

- (submissionId) → ChecklistSubmission(id); Restrict deletion.
- (actorUserId) → User(id); Restrict deletion.

Composite keys/indexes:

- `@@unique([submissionId, version])`
- `@@unique([id, submissionId])`
- `@@index([actorUserId])`

## Attachment

Private uploaded object metadata, verified status, and ownership.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| kind | AttachmentKind / AttachmentKind | required | Photo or workbook source file. |
| status | AttachmentStatus / AttachmentStatus | required; default PENDING | Current lifecycle/workflow state. |
| storageBucket | String / text | required | Private object-storage bucket name. |
| storageKey | String / text | required; unique | Unique opaque storage object key; never accept arbitrary client paths. |
| originalFilename | String / text | required | Original display filename; sanitize before use. |
| contentType | String / text | required | Verified MIME type after upload completion. |
| sizeBytes | Int / integer | required | Verified positive object size in bytes. |
| checksumSha256 | String? / text | nullable | Optional confirmed content digest. |
| width | Int? / integer | nullable | Optional image width in pixels. |
| height | Int? / integer | nullable | Optional image height in pixels. |
| propertyId | String? / text | nullable; foreign key | PHOTO requires a property; multi-property roster source files have no property. |
| submissionId | String? / text | nullable; foreign key | Owning submission; may be null for non-checklist uploads. |
| uploadedByUserId | String? / text | nullable; foreign key | Authenticated uploader when present. |
| uploadTokenHash | String? / text | nullable; unique | Per-upload claim for anonymous pending files; never accepted as a read token for history. |
| uploadExpiresAt | DateTime? / Timestamptz(3) | nullable | Expiration of a pending upload/claim. |
| readyAt | DateTime? / Timestamptz(3) | nullable | Upload verification completion instant. |
| deletedAt | DateTime? / Timestamptz(3) | nullable | Deletion marker for permitted unreferenced files only. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |

Foreign keys:

- (propertyId) → Property(id); Restrict deletion.
- (submissionId, propertyId) → ChecklistSubmission(id, propertyId); Restrict deletion.
- (uploadedByUserId) → User(id); Restrict deletion.

Composite keys/indexes:

- `@@unique([id, submissionId])`
- `@@index([submissionId, propertyId])`
- `@@index([propertyId, createdAt])`
- `@@index([status, uploadExpiresAt])`
- `@@index([uploadedByUserId])`

## SubmissionRevisionAttachment

Historical use of one photo in one submitted version.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| revisionId | String / text | required; foreign key | Immutable submission version using the photo. |
| attachmentId | String / text | required; foreign key | Referenced stored file. |
| submissionId | String / text | required; foreign key | Owning submission; may be null for non-checklist uploads. |
| purpose | PhotoPurpose / PhotoPurpose | required | How the photo is used in this submitted version. |
| sectionId | String? / text | nullable | Stable section UUID from captured template JSON. |
| itemId | String? / text | nullable | Stable item UUID from captured template JSON. |
| areaLabel | String? / text | nullable | Captured location/area label for display. |
| sortOrder | Int / integer | required; default 0 | Nonnegative display order. |

Foreign keys:

- (revisionId, submissionId) → SubmissionRevision(id, submissionId); Restrict deletion.
- (attachmentId, submissionId) → Attachment(id, submissionId); Restrict deletion.

Composite keys/indexes:

- `@@id([revisionId, attachmentId])`
- `@@index([attachmentId, submissionId])`
- `@@index([revisionId, submissionId])`

## IssueCategory

Administrator-managed shared problem category.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| name | String / text | required; unique | Display name; historical records keep their own label snapshots. |
| sortOrder | Int / integer | required; default 0 | Nonnegative display order. |
| isActive | Boolean / boolean | required; default true | Soft deactivation flag. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |
| updatedAt | DateTime / Timestamptz(3) | required; Prisma updatedAt | Last current-record update instant. |

Composite keys/indexes:

- `@@index([isActive, sortOrder])`

## Issue

Current problem state and original source.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| requestKey | String / text | required; unique | Client/server request key deduplicates standalone report retries. |
| propertyId | String / text | required; foreign key | Owning or selected whole property. |
| categoryId | String / text | required; foreign key | Shared current category. |
| title | String / text | required | Display title, including generated issue titles. |
| description | String? / text | nullable | Optional report description. |
| areaLabel | String? / text | nullable | Captured location/area label for display. |
| isUrgent | Boolean / boolean | required; default false | Priority flag that guests, workers, and admin may request. |
| status | IssueStatus / IssueStatus | required; default NEW | Current lifecycle/workflow state. |
| sourceSubmissionId | String? / text | nullable; foreign key | Optional source checklist/job. |
| sourceItemId | String? / text | nullable | Stable item ID, not label text or array position. Unique with sourceSubmissionId. |
| sourceRevisionId | String? / text | nullable; foreign key | Original or event-source immutable submission revision. |
| recurrenceOfIssueId | String? / text | nullable; foreign key | Previous resolved problem in the same property; null for a first occurrence. |
| currentVersion | Int / integer | required; default 0 | Current issue event version, updated transactionally. |
| reportedAt | DateTime / Timestamptz(3) | required; default now() | Original problem report instant. |
| resolvedAt | DateTime? / Timestamptz(3) | nullable | Administrator-confirmed resolution instant. |
| resolvedByUserId | String? / text | nullable; foreign key | Administrator who confirmed the resolution. |
| cancelledAt | DateTime? / Timestamptz(3) | nullable | Cancellation instant; null while not cancelled. |
| cancellationReason | String? / text | nullable | Optional retained explanation for cancellation. |
| updatedAt | DateTime / Timestamptz(3) | required; Prisma updatedAt | Last current-record update instant. |

Foreign keys:

- (propertyId) → Property(id); Restrict deletion.
- (categoryId) → IssueCategory(id); Restrict deletion.
- (sourceSubmissionId, propertyId) → ChecklistSubmission(id, propertyId); Restrict deletion.
- (sourceRevisionId, sourceSubmissionId) → SubmissionRevision(id, submissionId); Restrict deletion.
- (recurrenceOfIssueId, propertyId) → Issue(id, propertyId); Restrict deletion.
- (resolvedByUserId) → User(id); Restrict deletion.

Composite keys/indexes:

- `@@unique([id, propertyId])`
- `@@unique([sourceSubmissionId, sourceItemId])`
- `@@index([propertyId, status, cancelledAt, reportedAt])`
- `@@index([propertyId, isUrgent, status])`
- `@@index([categoryId])`
- `@@index([sourceSubmissionId, propertyId])`
- `@@index([sourceRevisionId, sourceSubmissionId])`
- `@@index([recurrenceOfIssueId, propertyId])`
- `@@index([resolvedByUserId])`

## IssueEvent

Immutable activity and resulting problem state.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| id | String / text | required; primary key; default uuid() | Stable record identifier. |
| issueId | String / text | required; foreign key | Parent issue. |
| version | Int / integer | required | Revision/version number; positive and unique where declared. |
| type | IssueEventType / IssueEventType | required | Record kind or checklist/event classification. |
| actorSource | ActorSource / ActorSource | required | Authenticated session, QR, private link, or system context. |
| actorUserId | String? / text | nullable; foreign key | Optional or required acting person; authenticate independently. |
| actorSnapshot | Json / jsonb | required | Versioned actor name/role/context snapshot. |
| sourceRevisionId | String? / text | nullable; foreign key | Original or event-source immutable submission revision. |
| note | String? / text | nullable | Optional report/repair/event explanation. |
| fromStatus | IssueStatus? / IssueStatus | nullable | Previous workflow status where relevant. |
| toStatus | IssueStatus? / IssueStatus | nullable | Resulting workflow status where relevant. |
| snapshot | Json / jsonb | required | Full resulting issue state, including category/property labels as they were at this time. |
| createdAt | DateTime / Timestamptz(3) | required; default now() | Creation instant. |

Foreign keys:

- (issueId) → Issue(id); Restrict deletion.
- (actorUserId) → User(id); Restrict deletion.
- (sourceRevisionId) → SubmissionRevision(id); Restrict deletion.

Composite keys/indexes:

- `@@unique([issueId, version])`
- `@@index([actorUserId])`
- `@@index([sourceRevisionId])`

## PropertyGuide

One optional current guide per property. General guest instructions are plain
text; unpublished content is administrator-only. Guides have optimistic versions,
not immutable revision history. See [the API contract](property-guides.md).

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| propertyId | String / text | primary key; foreign key | Exactly one guide per property at most. |
| title | String / text | required | Plain-text title, API maximum 100 characters. |
| content | String / text | required | Plain-text instructions, API maximum 20,000 characters. |
| isPublished | Boolean / boolean | default false | Guest visibility; parent property/link must also be accessible. |
| version | Int / integer | default 1 | Incremented on every save; expectedVersion prevents lost updates. |
| updatedByUserId | String / text | required; foreign key | Last authenticated administrator who saved the guide. |
| createdAt | DateTime / Timestamptz(3) | default now() | First-save instant. |
| updatedAt | DateTime / Timestamptz(3) | @updatedAt | Latest-save instant. |

Foreign keys: propertyId → Property(id), updatedByUserId → User(id), both Restrict
deletion. Index: `@@index([updatedByUserId])`. API validation enforces content and
actor rules; the database foreign key alone does not assert administrator role.

## IssueEventAttachment

Historical photo evidence attached to an issue event.

| Column | Prisma / PostgreSQL type | Constraints | Meaning |
|---|---|---|---|
| eventId | String / text | required; foreign key | Immutable issue event using the photo. |
| attachmentId | String / text | required; foreign key | Referenced stored file. |
| sortOrder | Int / integer | required; default 0 | Nonnegative display order. |

Foreign keys:

- (eventId) → IssueEvent(id); Restrict deletion.
- (attachmentId) → Attachment(id); Restrict deletion.

Composite keys/indexes:

- `@@id([eventId, attachmentId])`
- `@@index([attachmentId])`
