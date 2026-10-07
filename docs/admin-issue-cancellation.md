# Administrator issue cancellation and restoration

These actions distinguish an invalid report from a fixed problem. Resolving means
that the problem was fixed; reopening means that a resolved problem needs further
work. Cancelling means the report was mistaken or duplicated. Restoring only undoes
that cancellation and preserves the report's saved processing status.

| Method | Route                     | Effect                                               |
| ------ | ------------------------- | ---------------------------------------------------- |
| POST   | /admin/issues/:id/cancel  | Set cancellation metadata; append CANCELLED          |
| POST   | /admin/issues/:id/restore | Clear current cancellation metadata; append RESTORED |

Both routes require an active ADMIN JWT, UUID v4 issue ID, no query parameters and
exactly this body:

```json
{
  "expectedVersion": 3,
  "reason": "중복 신고로 확인되어 취소"
}
```

expectedVersion is an actual integer from 1 through 2147483646. reason is trimmed,
required, nonblank and limited to 1000 Unicode characters. Unsupported fields,
null, string versions and other malformed values are rejected.
The reason field differs from note on the existing status/urgency/recurrence APIs;
those contracts and their existing limits are unchanged. The new routes apply
10 requests/minute/IP/process, ADMIN guards and no-store/no-referrer headers.

## Receipt and refresh contract

Success returns HTTP 200 with a minimal receipt:

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "eventId": "00000000-0000-4000-8000-000000000002",
  "version": 4,
  "status": "RESOLVED",
  "updatedAt": "2026-10-07T02:00:00.000Z",
  "cancelledAt": "2026-10-07T02:00:00.000Z",
  "cancellationReason": "중복 신고로 확인되어 취소"
}
```

status remains NEW, IN_PROGRESS or RESOLVED. Cancellation is represented by
cancelledAt/cancellationReason, not a fourth processing status. Restoration returns
both cancellation fields as null. Cancellation time equals this action's updatedAt.
There is no changed flag: an invalid same-state request fails rather than adding a
meaningless event. A verified exact retry returns the original action's receipt.

The receipt may be historical if the same request is retried after another action.
Always refresh `GET /admin/issues/:id` and `/history` before presenting the current
state. Never overwrite a newer detail with the receipt's old status or cancellation
fields. There is no automatic client retry after a lost or malformed response.

## Transaction and evidence preservation

Within a serializable transaction the service rechecks the active administrator,
reads the current issue, and uses the established administrator reader to validate
its latest snapshot and original REPORTED evidence, including photo associations.
It then checks the version/transition and conditionally updates only:

- cancelledAt and cancellationReason;
- currentVersion and updatedAt.

Cancellation is allowed for any noncancelled NEW/IN_PROGRESS/RESOLVED issue.
Restoration is allowed only for a cancelled issue. The complete resulting snapshot
and the administrator's ID/name/role are appended in one ADMIN_SESSION CANCELLED
or RESTORED event. The reason is stored in event.note; cancellation also stores it
in the current cancellationReason. fromStatus/toStatus are the same processing
status. sourceRevisionId is null on these administrator events while the issue's
original source references remain in every full snapshot.

Original reportedAt, REPORTED event/photos, description, urgency, category,
resolution metadata, source checklist/item/revision and recurrence relationships
are unchanged. A resolved issue remains resolved. Existing captured labels are
preserved by these actions. No prior event, attachment file, event-photo join,
source checklist, stay or recurrence target is updated or deleted. No storage call
is made. Any failed conditional update or event insertion rolls back the action.
Inactive properties and expired guest/staff links do not restrict administrator
historical access.

Submission corrections retain their existing domain behavior. In particular, an
administrator correction can append an UPDATED audit event to a cancelled linked
issue and update its abnormal description while preserving its independently
managed cancellation/urgency/status. Guest correction keeps its existing answer-
derived behavior. Restoration starts from that latest saved issue, not the earlier
cancellation snapshot, so newer corrected content is preserved.

## Safe retries and conflicts

A digest binds administrator ID, action, expectedVersion and trimmed reason in the
new event's internal adminCancellationChange snapshot metadata. An older version
request reads only immutable event expectedVersion+1. Its event type, ADMIN_SESSION
actor, digest, reason and complete historical snapshot must agree before returning
that original receipt. No update is issued on this path.

For example, cancelling version 3 produces cancellation event 4, and restoring
version 4 produces event 5. Replaying the original cancellation returns its event-4
receipt while leaving event 5/current state restored. Replaying an earlier restore
after another cancellation likewise cannot restore again. A later correction that
drops internal lifecycle metadata does not affect the immutable event lookup.
Different content, action or administrator cannot reuse the prior receipt.

- 400 VALIDATION_ERROR: strict DTO validation failed.
- 400 ISSUE_CANCELLATION_REASON_REQUIRED: internal reason validation failed.
- 401 UNAUTHENTICATED: the current administrator is inactive/ineligible.
- 404 ISSUE_NOT_FOUND: the issue is absent.
- 409 INVALID_ISSUE_CANCELLATION_TRANSITION: the current version is already in the
  wrong source state (already cancelled, or attempting to restore an active issue).
- 409 ISSUE_CHANGED: stale/different request or failed conditional/unique write.
- 409 CONCURRENT_UPDATE: exhausted existing database serialization retries.
- Corrupt saved evidence fails closed with the established safe server errors.

Known database-aborted serialization failures use the existing retry helper; this
is separate from blindly resending a potentially committed network request.

## List filter and downstream behavior

`GET /admin/issues` adds optional `cancellation=active|cancelled|all`. Omission is
active, preserving the existing noncancelled list. active filters cancelledAt:null;
cancelled requires a non-null cancellation timestamp; all removes this filter.
The filter is applied before both SQL pagination and counting in the existing
repeatable-read read. Property, processing status, urgency, inclusive Seoul report
date filtering and reportedAt/ID descending ordering are unchanged.

Issue summaries now explicitly include cancelledAt (ISO timestamp or null).
Recurrence-candidate summaries include the same field and remain noncancelled.
Clients should preserve this selection in URL filters and return navigation, with
Korean labels 취소 제외 / 취소만 / 전체 and a visible 취소 badge on cancelled rows.

Direct detail/history/photos remain readable for cancelled reports. Existing
administrator note/status/urgency/recurrence actions remain blocked with
ISSUE_CANCELLED; restoration is the available lifecycle action. Cancelled reports
are excluded from active operational issue counts and issue exports. Restored
reports reappear under their unchanged processing-status rules: a restored resolved
issue does not count as an open problem. Existing recurrence relationships are
never removed; cancelled historical targets remain readable but are not eligible
as newly selected direct recurrence targets.

The original standalone guest-report receipt and exact request replay continue
using its immutable REPORTED event, irrespective of later cancellation/restoration.
This feature changes no schema, dependencies, guest authorization, notifications
or deployment. Temporary probes use actual DTOs/services/readers over synthetic
transactions; live database isolation, JWT/HTTP, object storage and browser/mobile
acceptance still require separate verification.
