# Final checklist submission

This slice completes a saved guest or maintenance draft. The existing tables
store the first immutable revision, photo associations, abnormal-item issues and
their initial events in one serializable transaction. No migration is required.

## Routes and access

| Method | Route | Result |
| --- | --- | --- |
| POST | /submissions/submit | 200 completion receipt, including identical retries |
| GET | /submissions/receipt | 200 original completion receipt |

Both routes require `Authorization: Bearer <private draft token>`. A shared QR or
administrator JWT does not grant access. Tokens keep the original seven-day
expiry; submission does not extend access. Property activity and, for staff,
the same current active assignment are rechecked. Cancelled submissions are
inaccessible. Requests are limited to 60 per minute per endpoint/IP and responses
use no-store/no-referrer. No credentials appear in responses or application logs.

Receipt access reveals only this record's property label, checklist type, visit
date, start/completion times, original revision number, answer/photo/issue counts
and link expiry. It does not expose answers, author/contact details, issue records,
photos, revision history or other people's records. Guest answers/photos are now
available through [guest checklist viewing](guest-submissions.md); corrections
remain separate work. Administrator access is documented in
[administrator submission review](admin-submissions.md).

## Submit the latest saved answers

Save the form through `POST /submission-drafts/save` first. Use its latest
`updatedAt` in this request; the server submits the saved answers, not new answers
supplied in this body. Required answers are checked against the **captured**
template, even when the live template has since changed.

```json
{
  "expectedUpdatedAt": "2026-09-16T05:00:00.000Z",
  "photos": [
    {
      "attachmentId": "3ab02c90-0c8b-4e20-882a-877791c2ce04",
      "purpose": "DEFECT",
      "itemId": "aa18533e-f3fc-4dba-b471-098d872fd9a1"
    }
  ]
}
```

Use actual draft/attachment IDs; the IDs above are illustrative. `photos` is
required, with `[]` when no images were uploaded. All READY photos in the draft
must appear exactly once, at most 40. Remove unwanted photos before submitting.
Any PENDING upload blocks completion, including expired reservations awaiting
the operational cleanup described in [draft photos](draft-photos.md). Deleted,
failed or other-draft photos cannot be submitted. Unknown body fields are rejected.

Each photo accepts `attachmentId`, `purpose`, optional `sectionId`, `itemId`, and
`areaLabel` (trimmed, at most 150 characters). IDs must belong to the captured
template. An item's section is filled automatically if omitted; a mismatched
section is rejected. Array order becomes the stored photo order.

| Purpose | Rule |
| --- | --- |
| DEFECT | Guest or staff; must reference an answered ABNORMAL item. |
| MAINTENANCE_AFTER | Staff only; specify section, item or area label. |
| MAINTENANCE_BEFORE | Optional staff photo; same location rule. |
| REPAIR | Staff only; ABNORMAL item with `repairReported: true`. |

Photo associations are selected at final submission; draft save/gallery APIs do
not yet persist those selections. No fixed photo minimum or mandatory cleaning
areas are invented; those client rules remain to be configured in a later slice.
Defect descriptions/photos stay optional.

## Atomic completion and retry behavior

Completion checks the saved-answer timestamp plus current photo ownership/status,
then saves SUBMITTED/currentRevision 1/submittedAt, the full template/author/answer
snapshot, photo joins, issues and issue evidence together. It serializes against
draft saving, upload finalization and removal. Failure rolls back all database
changes. No S3 request occurs inside the transaction.

An identical submit retry returns the original receipt without another revision,
issue or event. The normalized photo order/associations and expectedUpdatedAt must
match the first request. A different request after completion returns 409
CHECKLIST_ALREADY_SUBMITTED; fetch the receipt instead of attempting another save.
On reload, the frontend can request the receipt first: 409 CHECKLIST_NOT_SUBMITTED
means load the existing draft form. Invalid/expired credentials return 401.

The receipt uses the property label saved at submission time. Later property or
template edits do not rewrite the historical record. Existing draft save/upload/
remove/view endpoints remain DRAFT-only after completion, protecting the evidence.

## Initial issue creation

Each ABNORMAL answer creates one NEW issue and a REPORTED event. Source submission,
item and original revision are recorded, with that item's DEFECT photos linked as
evidence. A staff repair claim creates an additional REPAIR_REPORTED event and
links REPAIR photos, but keeps the issue NEW. The [administrator issue workflow](admin-issues.md)
records action notes and administrator resolution. A normal answer creates no issue.

For this slice, abnormalities use the shared fallback category `기타` (Other).
It is created lazily in the same transaction if absent; an existing inactive
category is never reactivated and causes 409 ISSUE_CATEGORY_UNAVAILABLE. Keep this
canonical name until category management introduces an explicit fallback setting.
Category names, property labels and actors are captured in the issue event history.
No category management or direct-complaint endpoint is introduced here.

## Relevant errors

- 400 VALIDATION_ERROR / INVALID_SUBMISSION_PHOTOS / INCOMPLETE_CHECKLIST.
- 401 INVALID_DRAFT_ACCESS: wrong, expired or currently inaccessible private link.
- 409 DRAFT_CHANGED / SUBMISSION_PHOTOS_CHANGED: reload and reconcile the form.
- 409 PHOTO_UPLOAD_PENDING: wait for upload completion; abandoned rows need cleanup.
- 409 CHECKLIST_NOT_SUBMITTED / CHECKLIST_ALREADY_SUBMITTED.
- 409 ISSUE_CATEGORY_UNAVAILABLE / CONCURRENT_UPDATE.

Stay matching, missing-checklist detection, automatic SMS/Kakao, submitted-record
corrections and direct complaint reporting remain future slices.
An unmatched submitted guest checklist does not automatically satisfy a Stay.
