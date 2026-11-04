# Guest reservation passwords (Slice 15)

The existing personal reservation link can display that reservation's room code
and the property's shared-entrance code when configured. Shared property QR,
staff QR, draft tokens, and administrator sessions cannot call these guest routes.
No database change, migration, account creation, or backfill is required.

## Visibility and eligibility

The server opens access exactly seven days (168 hours) before the current
reservation check-in timestamp and closes it at checkout. The opening boundary
is inclusive and checkout is exclusive. The existing invitation may remain valid
after checkout for other guest functions; that grace period does not extend
password access. Link expiry, revocation/rotation, cancellation, inactive property,
and an invitation issued for an old reservation revision deny access as before.

Both password fields require an eligible prepared reservation code. The existing
Slice 13 checks are reused: contact/name changes, cancellation/restoration,
source-revision availability, property mode/fixed-code changes, and neighboring
reservation code conflicts must be resolved before disclosure. A missing room
code or a review-required code hides the entire password card's values, including
the shared entrance. Missing shared entrance configuration alone is allowed.
Fixed properties use the prepared reservation's fixed code, not a live fallback.
Vacancy codes, adjacent guests' codes, code methods, and audit history are never
returned by the guest contract.

Guests may view the prepared code before staff physically change the lock,
matching the agreed seven-day advance disclosure. Availability does not assert
that the physical lock was changed, and it does not permit early check-in. This
slice does not send messages or operate a door lock.

## API

All routes use the personal-stay `Authorization: Bearer ...` credential. The
reservation is derived from that token; no stay/property IDs are accepted as
query or body input. `Cache-Control: no-store` and `Referrer-Policy: no-referrer`
are set by middleware before authentication and validation, including error paths.

- `GET /guest/stays/current/access-codes`: returns `stayId`, `propertyId`,
  `state` (`SCHEDULED`, `AVAILABLE`, `ENDED`, `UNAVAILABLE`), `opensAt`, `closesAt`,
  `serverTime`, `entranceAvailable`, `roomAvailable`, `roomMode`, and a nullable
  `fingerprint`. This response contains no plaintext or ciphertext. Outside the
  release window it does not decrypt codes or expose their availability/mode.
- `POST /guest/stays/current/access-codes/reveal`: accepts `kind` (`ENTRANCE` or
  `ROOM`) and the latest 64-character lowercase hexadecimal `fingerprint`.
  Returns only that field's `code` plus `stayId`, `propertyId`, `kind`,
  `fingerprint`, `serverTime`, and `visibleUntil`. The latter is the earliest of
  thirty seconds from response construction, checkout, and invitation expiry.

The fingerprint covers the reservation, property, invitation, schedule and code
versions without including a code or credential. Every reveal reauthorizes the
invitation and re-evaluates eligibility in a serializable transaction. Response
construction rechecks time after the transaction, so requests crossing checkout
or invitation expiry cannot return a code. Metadata and reveal are throttled at
30 and 10 requests per minute, respectively, under the existing throttler policy.
No code or token is logged, persisted to a new location, or included in normal
guest-context/record/export responses.

Errors use the existing common API format:

- `401 INVALID_STAY_ACCESS`: invitation unavailable; the guest flow should stop.
- `403 GUEST_ACCESS_CODE_NOT_AVAILABLE`: valid invitation but no current code
  access; refresh password metadata without discarding the rest of the guest page.
- `409 GUEST_ACCESS_CODE_CHANGED`: reload metadata before another explicit reveal.
- `503 SERVICE_UNAVAILABLE`: generic unavailable response from the global filter.
- Existing validation and rate-limit errors remain unchanged.

The client masks codes by default, requests a fresh reveal for copying, hides
values after the bounded duration and on blur/navigation, and uses server-relative
timing rather than trusting the device clock. It must not store codes in browser
storage, URLs, or analytics. Hiding access cannot erase a password already copied
or photographed; the separate staff change process remains necessary.

## Verification and release boundary

Local build, focused lint/format, and isolated fixture probes cover the time
boundaries, authorization, source review, fixed-code changes, stale versions,
short reveals, sanitized errors, and HTTP no-store behavior. These probes use
fictional in-memory data and do not contact PostgreSQL, S3, or a messaging service.
They do not prove live database concurrency, actual lock state, deployed TLS, or
physical-device behavior. Existing encryption configuration is reused. Deploy
the API before the frontend; no Prisma migration is needed for this slice.
The previously identified end-to-end HTTPS requirement for real access-code use
remains an infrastructure prerequisite and is not changed here.
