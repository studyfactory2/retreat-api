# Administrator issue management

`AdminIssuesModule` under `src/components/admin-issues/` manages problems already
reported through submitted checklists or standalone guest reports. Input and response DTOs live under
`src/libs/dto/admin-issue/`. The service handles actions, the reader validates
historical records/evidence, and the photo service issues private viewing links.

Every route requires an active administrator's `Authorization: Bearer <JWT>`.
Guest/staff/private QR tokens cannot use these endpoints. UUID path parameters,
DTOs and unexpected fields are validated. Responses use no-store/no-referrer,
including failures. No schema change, migration or new package is required.

| Method | Route | Result |
| --- | --- | --- |
| GET | /admin/issues | Paginated issue summaries |
| GET | /admin/issues/:id | Current issue, original report and latest event |
| GET | /admin/issues/:id/history | Paginated full events, newest first |
| GET | /admin/issues/:id/recurrence-candidates | Paginated earlier reports for the current issue version |
| GET | /admin/issues/:id/events/:eventId/photos/:photoId/view | Private photo URL and expiry |
| POST | /admin/issues/:id/notes | Add an action note; 200 detail response |
| POST | /admin/issues/:id/status | Change status; 200 detail response |
| POST | /admin/issues/:id/urgency | Change urgency with a reason; 200 detail response |
| POST | /admin/issues/:id/recurrence | Link, change or remove an earlier-report relationship; 200 detail response |

## Finding issues

The list accepts optional `propertyId`, `status` (NEW/IN_PROGRESS/RESOLVED),
`isUrgent` (exact true/false), and `from`/`to` (YYYY-MM-DD). Both dates are inclusive
**Korean calendar days of reportedAt**, not checklist visit dates. For example,
`from=2026-09-17&to=2026-09-17` covers 2026-09-16 15:00 UTC up to, but excluding,
2026-09-17 15:00 UTC. Impossible dates, reversed ranges and timestamps are rejected.

List/history use `page` (default 1, maximum 100000) and `limit` (default 20,
maximum 100). Responses are `{ items, total, page, limit, totalPages }`. Sorting
uses reportedAt descending then ID descending; history uses version descending.
Each read uses a repeatable-read transaction for consistent counts and records.

The list excludes cancelled issues. Direct detail/history links retain cancelled
records for review, but all mutations reject them. Inactive properties,
staff reassignment and expired guest links do not hide administrator history.

Summaries contain ID, captured property/category labels, title, area, urgency,
status, version and timestamps. Detail returns `{ issue, report, latestEvent }`.
`issue` includes description, source submission/item/revision, original template
context, resolution/cancellation metadata and current version. `report` retains
the initial reporter and evidence even after newer administrator notes exist.

Events expose type, actor identity/name/role, source, note, from/to status, time,
resulting historical record and photo metadata. Internal request keys, credentials
and raw snapshots/storage fields are not exposed. Labels and actor names remain
captured in each event. New administrator events capture current property/category
labels without rewriting earlier events. Guest identity is self-reported; staff
identity reflects the confirmed assignment, not a password-verified login.

## Notes and status changes

Send the latest `issue.currentVersion` as the numeric `expectedVersion`.
Missing/string/invalid versions are rejected. A stale version returns 409
ISSUE_CHANGED. Refresh the record before retrying; an old request never silently
overwrites a newer action or appends a duplicate note.

```json
{ "expectedVersion": 2, "note": "수리 기사 방문을 요청했습니다." }
```

Notes are trimmed, nonblank and at most 2000 characters. A note creates an UPDATED
event and advances the version without changing status or resolution metadata.
Notes may also be added to resolved issues.

```json
{
  "expectedVersion": 3,
  "status": "RESOLVED",
  "note": "필터 교체 후 냉방 작동을 확인했습니다."
}
```

| From | To | Requirement / event |
| --- | --- | --- |
| NEW | IN_PROGRESS | Optional note; STATUS_CHANGED |
| NEW or IN_PROGRESS | RESOLVED | Required action note; RESOLVED |
| RESOLVED | IN_PROGRESS | Required reopening note; REOPENED |

Same-status requests return 409 ISSUE_STATUS_UNCHANGED. Returning to NEW is not
supported. Resolution records server time and the current administrator's ID;
reopening clears the current resolution fields while retaining the prior event.
Reopening continues the same issue. Recurrence connects a separate report without
changing either report's status; see the relationship flow below.

Each action rechecks the active ADMIN account inside a serializable transaction,
checks the version, updates the issue and inserts one full historical event
atomically. Staff repair claims remain NEW until administrator confirmation;
initial issue versions may already be 2 because a repair report is a second event.

## Urgency changes

`POST /admin/issues/:id/urgency` requires the current numeric version, an actual
boolean and a trimmed, nonblank reason of at most 500 Unicode characters:

```json
{ "expectedVersion": 3, "isUrgent": true, "note": "누수로 전기 설비 점검이 필요합니다." }
```

Missing/null/string urgency values and unexpected fields are invalid. A value that
already matches returns `409 ISSUE_URGENCY_UNCHANGED`; a stale version returns
`409 ISSUE_CHANGED`. Both create no event. Successful actions update only urgency,
version and update time, preserving status, resolution, source and evidence. The
atomic `UPDATED` event captures the reason, administrator and complete new record.
Urgency changes are also allowed on resolved records and do not reopen them.

The initial `REPORTED` event is never rewritten. An identical standalone guest
retry returns its original receipt and original urgency even after these actions.
Changing the retry's urgency still returns `ISSUE_REQUEST_CHANGED`. The urgency flag
does not send SMS, push notifications or place a call.

## Connecting an earlier issue

Read `GET /admin/issues/:id/recurrence-candidates?expectedVersion=3&page=1&limit=20`.
The required query version explicitly parses decimal digits; the normal pagination
limits apply. The response uses the existing issue-summary list shape
`{ items, total, page, limit, totalPages }`. The active ADMIN, source record and its
version are checked again inside a repeatable-read transaction. A cancelled or
stale source is rejected. No caller-selected property or date cutoff is accepted.

Candidates belong to the source's property, are noncancelled with a saved version,
and have a **strictly earlier `reportedAt` timestamp**. An equal timestamp is not
earlier. Any NEW/IN_PROGRESS/RESOLVED status is eligible. The source and currently
linked target are excluded. Filtering and counting happen before SQL pagination;
sort order is reportedAt descending, then ID descending. Browse later pages to
see all matches. Candidate summaries validate their current saved snapshot. The
candidate list is discovery, not a reservation: every save rechecks eligibility.

`POST /admin/issues/:id/recurrence` links a target or replaces the current target:

```json
{
  "expectedVersion": 3,
  "recurrenceOfIssueId": "00000000-0000-4000-8000-000000000002",
  "note": "이전 냉방 수리와 같은 증상으로 확인했습니다."
}
```

Explicit `recurrenceOfIssueId: null` removes the link. The field is required, and a
non-null value must be a version-4 UUID. The trimmed reason is required and limited
to 500 Unicode characters for linking, replacing and removing. An unchanged target
(including null when already unlinked) returns `409 ISSUE_RECURRENCE_UNCHANGED`.

The serializable transaction rechecks the active administrator, source version,
noncancelled source and target eligibility. It also validates the target's current
detail/evidence and defensively follows its ancestry. Self-links, reaching the
source, existing cycles, missing ancestors, cross-property ancestors and invalid
chronology are rejected. A cancelled ancestor may remain as historical context;
the direct selected target must not be cancelled. Traversal checks at most 100
records and fails closed with `ISSUE_RECURRENCE_REVIEW_REQUIRED` if more are needed.
This safety limit does not label a longer chain as a cycle. A damaged or excessively
long historical chain can therefore fail on save even if its immediate candidate
meets the list's property/date/cancellation filters.

Removing a link deliberately skips every old-target eligibility/ancestry check.
It remains possible if that target later became cancelled or otherwise ineligible.
Changing/removing the relationship updates only the source's relationship, version
and update time, and inserts an `UPDATED` event with the reason and full snapshot.
The target and its version, status, evidence and events are never modified. Source
resolution and original evidence likewise remain intact. The current relationship
is available as `issue.recurrenceOfIssueId` in the unchanged detail response; use
existing `GET /admin/issues/:targetId` for its navigable title/date/status summary.
Historical events retain their relationship and urgency values at each version.

Use `UPDATED` as a general record-update label in clients rather than assuming it
always means a note. Reasons and resulting historical values distinguish these
actions without adding an event enum or schema migration. All new routes retain
administrator JWT authorization, no-store/no-referrer and strict DTO validation.
After a lost or malformed mutation response, read the current detail/history before
another action; do not automatically resend a possibly committed write.

## Evidence and boundaries

Use photo IDs from an event's `photos`. A view URL is scoped to the exact issue,
event and photo. The reader verifies ready PHOTO ownership, property, source
submission and the matching historical item/purpose association. Event photo
sortOrder values can have gaps inherited from the complete submission; preserve
their order instead of treating them as contiguous positions.

Viewing links expire after at most 120 seconds, with administrator access and
evidence checked again after signing. Already-issued links can remain usable until
expiry after later access revocation. Signed URLs naturally contain the S3 object
address and should not be stored as permanent image addresses. This slice adds no
administrator photo uploads or evidence replacement.

Other relevant errors include 400 VALIDATION_ERROR / ISSUE_NOTE_REQUIRED /
INVALID_ISSUE_STATUS_CHANGE; 401 UNAUTHENTICATED; 404 ISSUE_NOT_FOUND /
ISSUE_EVENT_NOT_FOUND / ISSUE_PHOTO_NOT_FOUND; 409 ISSUE_CANCELLED /
CONCURRENT_UPDATE. Inconsistent stored snapshots/evidence fail with a safe 500.

New action errors include `400 ISSUE_REASON_REQUIRED`, `409 ISSUE_URGENCY_UNCHANGED`,
`ISSUE_RECURRENCE_UNCHANGED`, `INVALID_ISSUE_RECURRENCE`, `ISSUE_RECURRENCE_CYCLE` and
`ISSUE_RECURRENCE_REVIEW_REQUIRED`. These are separate from stale `ISSUE_CHANGED`.

Category editing is documented in [admin-issue-categories.md](admin-issue-categories.md).
Standalone guest text reports now use this workflow; see [guest-issues.md](guest-issues.md).
Complaint photo uploads use [guest-issue-photos.md](guest-issue-photos.md).
Cancellation controls, notifications and deployment remain separate work.
Checklist abnormalities still use the existing shared 기타 fallback.
