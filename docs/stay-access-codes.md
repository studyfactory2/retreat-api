# Reservation access codes (Slice 13)

Administrators explicitly prepare a room code from a reservation. This slice
prepares and stores numbers only. It does not change a physical lock, disclose
codes to guests/staff, send notifications, or automatically assign codes during
reservation creation/import. Existing reservations require no backfill.

## API

All routes require an active administrator session and return `Cache-Control:
no-store`. Under `/admin/stays/:id/access-code`:

- `GET` returns masked metadata, current reservation/settings/code versions,
  availability, review reasons, and the five latest metadata-only audit events.
- `POST` requires `expectedStayRevision`, `expectedSettingsVersion`,
  `expectedCodeVersion` and `action` (`PREPARE`, `REPLACE`, or `CONFIRM`).
  `method` (`AUTO`, `PHONE_LAST6`, or `FIXED`) is required for preparation and
  replacement, and must be omitted for confirmation. The response is metadata.
- `POST /reveal` requires the three expected versions and returns the saved code.
  Explicit administrator reveal remains possible for cancelled/ended records;
  this does not make those records eligible for guest disclosure.

A zero settings/code version means that record has not been created. Stale
versions return 409. No raw codes are included in ordinary reservation DTOs,
reservation revision snapshots, export records, or access-code event history.

## Preparation and changes

Rotating properties support secure server-generated six-digit codes (leading
zeros retained) or the last six digits of the reservation's saved phone number.
Phone inputs must contain 7–15 digits with only an optional leading `+`, spaces,
parentheses, or hyphens. Invalid/missing phone numbers cannot use this method.
No assumption about ownership or actual door-lock hardware support is made.

The immediate preceding and following non-cancelled reservations at that
property are checked, including a completed preceding stay. A known matching
code is rejected for the phone method and retried for automatic generation.
Replacing a rotating code also excludes that reservation's previous code.
Fixed properties instead copy the configured fixed room code; intentional fixed
code reuse is allowed. The stored reservation code never silently follows later
property setting changes.

Phone/name changes and restoration after cancellation require explicit review.
`CONFIRM` keeps the number and acknowledges those changes. A room-policy change,
changed fixed code, neighboring code conflict, or unavailable source revision
requires replacement or correction of the underlying data. Changed dates keep
the existing number and re-evaluate its current neighboring reservations.
Changing a contact's formatting alone does not require review.

Cancelled, ended, inactive-property, or unconfigured reservations cannot prepare,
replace, or confirm a code. Cancellation and restoration are derived from the
existing immutable reservation history. A consistent current revision snapshot
is required when saving. Preparation never means the physical lock was changed.

## Persistence and safeguards

`StayAccessCode` stores only the current encrypted code, preparation metadata,
and source reservation/settings versions. `StayAccessCodeEvent` retains
versioned actor-name/action/method/time metadata, not previous raw codes.
The encryption uses the existing validated `ACCESS_LINK_ENCRYPTION_KEYS` keyring
and `ACCESS_LINK_ACTIVE_KEY_ID`. Keep old keys for decryption; there is no
plaintext fallback. AES-256-GCM uses a fresh nonce and an AAD domain bound to the
reservation identity, separate from QR tokens and property code settings.

Mutations run in serializable transactions, check active administrator status,
recheck all three optimistic versions and neighboring reservations, and save the
current encrypted code plus audit event atomically. Unexpected database/crypto
errors are sanitized. Guards and throttling apply to metadata and reveal too.
Client requests must resolve an ambiguous save result through a fresh metadata
read before another write; repeating a lost response is not automatic retry.

This slice introduces no public code access. Later guest/staff features must
re-evaluate reservation eligibility, current source/policy review state, and
release windows before disclosure. They must not infer eligibility from a stored
code alone. End-to-end HTTPS remains an infrastructure prerequisite for real
access-code use and is not changed by this feature.

## Migration and local verification

`20261103010000_add_stay_access_codes` was generated using Prisma 5.22
`migrate diff --from-schema-datamodel ... --to-schema-datamodel ... --script`.
It adds two enums and two tables; it does not rewrite reservation data.
The developer applies pending migrations locally with `npx prisma migrate dev`
and regenerates the client with `npx prisma generate`. Production uses
`npx prisma migrate deploy` in the normal release process. No backfill is needed.

Build, focused lint, Prisma validation/generation, and isolated runtime probes
can run without a database. An in-memory transaction probe does not prove
PostgreSQL concurrency behavior. Apply the migration and exercise competing
administrative edits in an isolated development database before release.
