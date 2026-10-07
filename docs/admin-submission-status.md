# Administrator checklist cancellation and restoration

Administrator submission details support these independent actions for CHECK_IN,
CHECK_OUT and MAINTENANCE records:

| Method | Route                          | Transition            |
| ------ | ------------------------------ | --------------------- |
| POST   | /admin/submissions/:id/cancel  | SUBMITTED → CANCELLED |
| POST   | /admin/submissions/:id/restore | CANCELLED → SUBMITTED |

Both routes require an active ADMIN JWT, a UUID v4 path ID and no query fields.
RolesGuard checks the request; the service checks the active administrator again
inside the serializable transaction. Requests are limited to 10/minute/IP/process,
with no-store/no-referrer responses. Guest QR, staff QR and private-link tokens
cannot authorize these actions. Historical records remain manageable at inactive
properties and after private-link expiry.

## Request and receipt

Both actions accept exactly:

```json
{
  "expectedRevision": 3,
  "reason": "중복 제출 확인 후 취소"
}
```

expectedRevision must be an actual integer from 1 through 2147483646. reason is a
required string, trimmed, nonblank and limited to 1000 Unicode characters. Missing
values, null, wrong types and unsupported fields return 400. Answers, status,
photos, cancelledAt and stay information cannot be supplied in these requests.

A successful cancellation returns HTTP 200:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "status": "CANCELLED",
  "revision": 4,
  "updatedAt": "2026-10-07T02:00:00.000Z",
  "cancelledAt": "2026-10-07T02:00:00.000Z"
}
```

Restoration returns the same shape with status SUBMITTED and cancelledAt null.
There is no changed flag: a new same-state action is rejected, not treated as a
successful no-op. The exception is a proven exact retry of an earlier successful
action, which returns that original action's receipt without writing again.

After either receipt, fetch the existing detail/history APIs for the latest state.
A replay receipt may describe an older action than the current record; it is not
permission to show its status as the latest without a refreshed detail read.

## Atomic behavior and preservation

The service reuses Slice 4A's current-record validation with an explicit
submitted/cancelled option. The existing correction wrapper remains
submitted-only. Validation compares captured/current author, template, answers,
identifiers, dates and photo ownership/associations before any write.

The transaction checks expectedRevision and source status, then conditionally
updates only status, cancelledAt, currentRevision and updatedAt. It appends one
immutable CANCELLED or RESTORED revision containing ADMIN_SESSION actor ID/name/
role and the required reason, and copies the current photo associations to that
revision. A failed conditional update, history insert or photo association insert
rolls back the entire action. Earlier revisions and attachments are never changed
or deleted; no storage call occurs.

Cancellation records cancelledAt at the new revision timestamp. Restoration
clears it while preserving the original submittedAt. Both preserve the original
author, property, captured template, visit date, answers, notes, stay association,
private-token hash/expiry and every other current record field. Restoration copies
the latest cancelled revision, not an earlier original submission. It therefore
never recovers repair information or photo associations removed by a correction.
It does not restore, reactivate, change or revalidate an associated stay.

Linked issues are completely independent: these actions neither query nor write
issues/events. Their urgency, status, resolution, cancellation, recurrence, source
references and original photo evidence stay unchanged. A cancelled checklist may
remain the historical source of an active issue, and existing issue readers keep
that historical context readable.

## Conflict and exact-retry behavior

- 404 SUBMISSION_NOT_FOUND: no record with the supplied ID.
- 409 INELIGIBLE_SUBMISSION: a draft or unsupported record is not manageable.
- 409 INVALID_SUBMISSION_TRANSITION: the current revision is already in the wrong
  source state (for example, cancelling an already-cancelled current revision).
- 409 SUBMISSION_CHANGED: a stale/different request, another administrator/action,
  failed conditional update or competing revision insertion.
- 409 CONCURRENT_UPDATE: exhausted existing serializable conflict retries.
- 401 INVALID_ADMIN_ACCESS: the administrator is no longer active/eligible.
- Corrupt saved snapshots/photo associations fail closed through existing stored
  record errors. Public 5xx messages remain generic under the common filter.

A normalized digest binds administrator ID, action, expectedRevision and trimmed
reason. On an older expectedRevision, the service reads only the immutable
expectedRevision+1 revision and verifies action, status, ADMIN_SESSION actor,
digest and snapshot. A match returns its original receipt without changing the
current row. For example, cancelling with expectedRevision 3 creates revision 4;
restoring with expectedRevision 4 creates revision 5. Retrying the original cancel
request returns its revision-4 receipt and leaves revision 5 submitted. Replaying
the old restoration after another cancellation likewise
does not restore again. Different content, actor or action cannot reuse a receipt.

Copied metadata in later correction/stay-link snapshots cannot substitute for the
original action: replay also requires the revision's own action/status/actor and
expected revision. The UI must not automatically retry after a lost response; it
preserves the reason and requires reading the latest record before another write.
Known database-aborted serialization retries retain the existing transaction
helper behavior; they do not authorize blind client/network retries.

## Access, receipts and operational views

Cancelled submissions cannot be corrected or linked to stays. Administrator
list/detail/history/photos remain available. Guest/staff private resolution
already accepts only DRAFT/SUBMITTED, so cancellation blocks those entry, photo,
correction, receipt and final-submit replay paths. Restoration does not renew
expiry or bypass property activity, staff assignment/account or linked-stay checks.
When access remains valid after restoration, final-submission receipts/replays
still read unchanged revision 1 and report the original submission evidence.

Existing calendar/dashboard checklist queries, valid maintenance completion
counts and checklist exports exclude cancelled records. Restoration includes them
again under their existing validation/date rules. If another valid checklist was
submitted in the meantime, restoring an older record may produce the existing
DUPLICATE_SUBMISSIONS review state; the action does not silently remove another
submission. Changed/cancelled stays retain their existing scheduling and review
rules. Open issue counts and issue export rows remain governed by issue state,
independently of checklist cancellation.

No schema, migration or dependency changes are needed. Temporary mocked database
probes exercise actual DTOs, services, readers and atomic-failure paths; these are
not live PostgreSQL concurrency, authenticated HTTP, S3 or browser/device tests.
The user controls operational acceptance, service lifecycle and deployment.
