# Administrator submitted-checklist corrections

`POST /admin/submissions/:id/correct` requires an active ADMIN login JWT through
RolesGuard. The administrator is checked again inside the serializable write
transaction. There are no query parameters and no guest, staff QR or private-link
credential substitutions. The route is limited to 10 requests/minute/IP/process
and sends no-store/no-referrer headers through the administrator module.

Submitted CHECK_IN, CHECK_OUT and MAINTENANCE records are eligible, including
historical records from inactive properties or expired private links. Missing
records return 404 SUBMISSION_NOT_FOUND. DRAFT/CANCELLED records return
409 INELIGIBLE_SUBMISSION. This does not cancel, restore, finish or relink records.

## Request and response

```json
{
  "expectedRevision": 3,
  "items": [
    {
      "itemId": "11111111-1111-4111-8111-111111111111",
      "value": "ABNORMAL",
      "description": "창문 잠금장치를 확인했습니다.",
      "isUrgent": false
    }
  ],
  "generalNote": null,
  "reason": "관리자 현장 확인 후 체크 결과 정정"
}
```

- expectedRevision is an actual integer from 1 through 2147483646.
- items is the complete desired answer set, at most 500 entries. Required items
  from the captured template must remain answered; omit an optional item to clear
  its answer. Unknown IDs, duplicates, unsupported fields and unsupported values
  are rejected. Captured templates, not current live templates, govern validation.
- Each item accepts only itemId, value (NORMAL/ABNORMAL), optional nullable
  description (trimmed, at most 2000 Unicode characters), and optional strict
  boolean isUrgent (omission means false). NORMAL requires no description and
  false urgency. No client repair fields or photo association fields are accepted.
- generalNote is required as a nullable string. Null or whitespace-only text
  clears it; otherwise it is trimmed and limited to 4000 Unicode characters.
- reason is required, trimmed, nonblank and limited to 1000 Unicode characters.
  It describes the correction and is recorded separately from the general note.

A successful response is HTTP 200:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "status": "SUBMITTED",
  "revision": 4,
  "updatedAt": "2026-10-07T02:00:00.000Z",
  "changed": true
}
```

Answer ordering and whitespace are normalized. An unchanged answer/note set
returns changed:false with the current revision and timestamp; reason-only input
does not create a revision. The frontend should then read the existing detail and
history APIs. A receipt alone does not replace those complete current-state reads.

## Atomic history and issue rules

The transaction validates the current captured record, author/template/answer
copies, scalar identifiers/timestamps and current photo joins/owners. It checks
expectedRevision, conditionally updates the submitted row, adds one CORRECTED
revision and retained photo joins, then reconciles affected checklist issues.
Any failure rolls back all these writes. Damaged stored evidence fails closed.
The original author, property, template, visit/submission date and stay association
remain unchanged. The correction actor is ADMIN_SESSION with the active
administrator's own ID/name/role and the required reason.

Existing issues are found by submission/item, preventing a second issue when an
answer goes NORMAL and later ABNORMAL again. Latest issue state and original
REPORTED evidence are validated with the existing administrator issue reader.
For an existing issue, an abnormal description may change, but its urgency,
status, resolution, cancellation, recurrence and original source references stay
unchanged. Every affected existing issue gets an ADMIN_SESSION UPDATED event
pointing at the new submission revision. Its original events/photos are untouched.
NORMAL or omitted answers never resolve, repair, cancel or remove an issue.
General-note-only edits do not create issue events.

Answer urgency and issue urgency have separate responsibilities: this correction
saves the answer's urgency in checklist history, but **always preserves existing
issue priority**, including an administrator's Slice 3 decision. To change that
priority use the issue urgency action. A newly abnormal item with no prior issue
creates one NEW issue using the corrected answer's urgency and an ADMIN_SESSION
REPORTED event. The original submission author is never impersonated.

## Maintenance and photo consequences

Staff repairReported/repairNote survive while the same saved answer remains
ABNORMAL. NORMAL or omission removes dependent repair information only from the
new current answer. An answer changed back to ABNORMAL does not resurrect removed
repair data. Earlier revisions and repair-report events remain available.

- DEFECT associations remain only for still-ABNORMAL answers.
- REPAIR associations remain only for still-ABNORMAL answers whose saved staff
  repairReported is still true.
- MAINTENANCE_BEFORE/MAINTENANCE_AFTER associations retain their existing valid
  captured section/item/area location, even if its answer is NORMAL or omitted.
- Retained association order is compacted. No association is reassigned to another
  item, and no upload, stored attachment or historical join is deleted.
- Removing an association from the current revision does not remove original
  issue evidence. Later corrections do not restore removed current associations.

The frontend review must describe current photo/repair removals before confirming.
There is no invented photo minimum and no change to staff repair controls.

## Concurrent changes and retries

409 SUBMISSION_CHANGED rejects stale/different requests; 409 ISSUE_CHANGED
rejects issue contention; exhausted serializable retries return the established
409 CONCURRENT_UPDATE. The frontend must preserve input and fetch the latest
record after a conflict or uncertain response, without automatically retrying.

For a known identical successful correction, a later retry can read the immutable
expectedRevision+1 correction receipt without writing again. Its ADMIN_SESSION
actor ID and digest must match. The digest covers only normalized requested
answers, general note, reason, expected revision and administrator ID; it does not
reconstruct request content from later repair/photo state. Another administrator,
a different reason or changed content cannot replay that receipt. A returned retry
receipt can describe an earlier revision than the latest current record, so the
client still refreshes detail/history. Current eligibility/admin access is checked
before any replay. Original final-submission version-1 receipts and their request
hash/replay behavior remain unchanged.

No schema, migration, dependency, notification, cancellation or deployment changes
are part of this slice. Temporary in-memory probes can exercise actual DTOs and
services but do not prove PostgreSQL isolation, real JWT/HTTP/S3 or browser/device
acceptance. The user performs live verification and controls deployment.
