# Administrator submission review

Implementation: `src/components/admin-submissions/` owns the controller, service,
snapshot reader and `AdminSubmissionsModule`. Contracts live in
`src/libs/dto/admin-submission/`. The module imports authentication and storage,
and is registered independently from guest/staff `SubmissionsModule`.

Read completed guest check-in/check-out and staff maintenance checklists with the
existing administrator `Authorization: Bearer <admin JWT>` header. Every route
requires a current active ADMIN account. Guest/staff QR and private draft tokens
do not grant administrator access. All responses, including access errors, use
`Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

| Method | Route | Response |
| --- | --- | --- |
| GET | /admin/submissions | Filtered, paginated summary list |
| GET | /admin/submissions/:id | Current saved revision in full |
| GET | /admin/submissions/:id/history | Paginated full revisions, newest first |
| GET | /admin/submissions/:id/revisions/:revisionId/photos/:photoId/view | Private photo URL and expiry |

Path identifiers must be UUID v4 values. DRAFT and nonexistent submissions return
404 on individual-record routes. Only SUBMITTED/CANCELLED records with a saved
revision and submission timestamp enter the list. This slice does not implement
corrections or cancellations; it can read the corresponding stored statuses.

## List and filters

Example: `GET /admin/submissions?type=CHECK_IN&from=2026-09-01&to=2026-09-30&page=1&limit=20`.

| Query | Meaning |
| --- | --- |
| propertyId | Optional property UUID v4 |
| type | Optional CHECK_IN, CHECK_OUT or MAINTENANCE |
| status | Optional SUBMITTED or CANCELLED; default includes both |
| linkStatus | Optional UNLINKED guest QR records or LINKED records; see the linking guide |
| from / to | Optional inclusive visit-date bounds, YYYY-MM-DD |
| page | Integer 1–100000; default 1 |
| limit | Integer 1–100; default 20 |

Dates filter the recorded **visit date**, not the upload/submission timestamp.
Invalid calendar dates, timestamps instead of dates, reversed ranges, invalid
enums, repeated/array values and unexpected query fields return 400. Sorting is
submission time descending, then ID descending for stable ties. Pagination/counts
share a repeatable-read database snapshot. An empty page has `items: []`.

Responses use `{ items, total, page, limit, totalPages }`. Each summary includes:

- `id`, `type`, `status`, `currentRevision` and `visitDate`.
- `stayId` and `authorSource` for reviewing current associations.
- Captured `property: { id, name, region }` and `author: { id, name, role }`.
- `startedAt`, `submittedAt`, `cancelledAt`.
- `answeredItemCount`, `abnormalItemCount`, `photoCount`.

The list omits author contact details and complete answers. Abnormal-item counts
describe checklist answers, not the current number/status of managed issues.

## Detail and history

Detail returns `{ id, status, currentRevision, revision }`. History accepts only
`page` and `limit` with the same bounds/defaults and returns the list envelope.
Each revision contains its ID/version/action/status, creation time, optional
reason, actor source and captured `actor: { id, role, name }`, plus:

- `record`: captured property, type, visit date, optional stayId, author source,
  author identity/contact fields, template with sections/items, answers and dates.
- `photos`: ID, READY status, filename, JPEG content type, bytes, dimensions,
  creation time and captured purpose/section/item/area/sort order.

Timestamps serialize as ISO strings; visitDate stays YYYY-MM-DD. Guest author IDs
can be null because QR details are self-reported. A saved staff name/ID identifies
the confirmed assignment and does not constitute a password-verified login.

Historical wording and names come from the revision snapshot. Changing or
deactivating a property, editing a template, reassigning staff, or expiring a guest
private link does not rewrite or hide these administrator records. Detail shows
the current saved revision; history preserves older versions separately. Malformed
stored snapshots or inconsistent photo associations fail safely instead of
silently substituting current live data.

## Private photo viewing

Use a photo ID from a revision's `photos` array and that revision's ID. The API
checks the submission, exact revision association, owning property/submission,
PHOTO kind and READY state before signing. A photo from another record/revision,
an unattached draft photo or a removed photo cannot be requested through this
route. Internal hashes, tokens, receipt payloads and S3 keys/bucket fields are not
returned in the list/detail/history contracts.

The view response is `{ url, expiresAt }`. S3 remains private; the URL is a bearer
capability valid for at most 120 seconds from signing. It naturally contains the
signed S3 object address. Administrator access and photo association are rechecked
after signing, before releasing the URL. Once issued, a URL can remain usable
until expiry even if administrator access is subsequently revoked. Request a new
URL when needed; do not persist it as the photo's permanent address.

## Boundary

These four endpoints are reads. The separate AdminSubmissionStaysModule owns
candidate discovery and administrator linking under the same URL namespace;
see [the linking guide](admin-submission-stays.md). No migration or dependency is
needed. Calendar calculation, React screens and deployment remain separate work.
