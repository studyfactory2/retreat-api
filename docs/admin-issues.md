# Administrator issue management

`AdminIssuesModule` under `src/components/admin-issues/` manages problems already
reported through submitted checklists. Input and response DTOs live under
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
| GET | /admin/issues/:id/events/:eventId/photos/:photoId/view | Private photo URL and expiry |
| POST | /admin/issues/:id/notes | Add an action note; 200 detail response |
| POST | /admin/issues/:id/status | Change status; 200 detail response |

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
records for review, but notes/status changes reject them. Inactive properties,
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
Reopening concerns the same issue; linking a separate recurring problem is later work.

Each action rechecks the active ADMIN account inside a serializable transaction,
checks the version, updates the issue and inserts one full historical event
atomically. Staff repair claims remain NEW until administrator confirmation;
initial issue versions may already be 2 because a repair report is a second event.

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

Category editing is documented in [admin-issue-categories.md](admin-issue-categories.md).
Direct guest complaints, urgency editing, cancellation,
recurrence linking, notifications, frontend screens and deployment remain later
slices. Checklist abnormalities still use the existing shared 기타 fallback.
