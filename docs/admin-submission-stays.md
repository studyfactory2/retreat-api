# Administrator checklist-to-stay linking

`AdminSubmissionStaysModule` owns this workflow under
`src/components/admin-submission-stays/`, independently of the submission reader
and guest correction modules. DTOs live in `libs/dto/admin-submission-stay/`.
Use the existing administrator `Authorization: Bearer <admin JWT>` header.
Every handler requires ADMIN and returns no-store responses; shared HTTP setup
also applies no-referrer headers. No schema change or migration is needed.

## Workflow

1. List completed, unmatched property-QR checklists with
   `GET /admin/submissions?linkStatus=UNLINKED&page=1&limit=20`.
2. Read `/admin/submissions/:id` to review the guest's original name, contact
   details, visit date and checklist answers.
3. Get `/admin/submissions/:id/stay-candidates?page=1&limit=20` and choose the
   correct planned stay after comparing its guest details.
4. POST `/admin/submissions/:id/link-stay` with the current submission revision,
   selected stay revision and a reason.

Names and phone numbers never trigger automatic matching or profile merging.
This association connects an inspection checklist to an itinerary; it is not
evidence of physical arrival or departure.

## Eligible records and candidates

Only SUBMITTED CHECK_IN/CHECK_OUT records with `authorSource: GUEST_QR` and no
`stayLinkVersion` are eligible. They may already have an administrator-selected
stay, allowing correction or removal of a mistaken association. Personal stay-link
checklists are already associated and cannot be reassigned here. DRAFT, CANCELLED
and MAINTENANCE records return 409 `INELIGIBLE_SUBMISSION`.

Candidates are ACTIVE stays at the same active property. For CHECK_IN, the
planned arrival day in Asia/Seoul must equal the recorded visit date; CHECK_OUT
uses the departure day. Midnight is inclusive and the next midnight is exclusive.
A submission made on a later date still uses its recorded visit date. If the
guest entered the wrong visit date, this workflow does not rewrite it or offer
stays from another day; leave the record unmatched for separate review.

Candidate responses contain:

```text
submissionId, currentRevision, currentStayId, visitDate, type,
items, total, page, limit, totalPages
```

Each item contains `id`, `propertyId`, `guestName`, `company`, `department`,
`phone`, `checkInAt`, `checkOutAt`, `currentRevision` and `alreadyLinked`.
Dates serialize as ISO timestamps; visitDate remains YYYY-MM-DD. Candidates
sort by arrival timestamp and ID. Pagination uses the existing defaults of
page 1 / limit 20, with maximum limit 100.

`alreadyLinked` means another SUBMITTED checklist of the same type currently
references that stay. The POST rechecks this and returns 409
`STAY_CHECKLIST_ALREADY_LINKED`; concurrent administrator links cannot both win.
This is a linking-time check, not a new database uniqueness constraint. Existing
private-link submission behavior is unchanged and may create another checklist
later or concurrently. Calendar work must handle such duplicates explicitly.

## Link or replace an association

```http
POST /admin/submissions/<submission-id>/link-stay
Content-Type: application/json
Authorization: Bearer <admin JWT>
```

```json
{
  "expectedRevision": 1,
  "stayId": "11111111-1111-4111-8111-111111111111",
  "expectedStayRevision": 2,
  "reason": "이용객 정보와 이용 일정을 확인하여 연결했습니다."
}
```

The same endpoint replaces an incorrect current stay. `stayId` must be a UUID v4
or explicit null; it cannot be omitted. Version values must be JSON integers
from 1 through 2147483646. A linking request requires expectedStayRevision.
The trimmed reason is required and must contain 1–1000 characters. Unknown body
fields, nonempty POST queries and malformed path/query values return 400.

The transaction rechecks active administrator credentials, current submission
revision, target stay revision, property, dates and duplicate associations.
Changed submissions return 409 `SUBMISSION_CHANGED`; changed stays return 409
`STALE_STAY_REVISION`; incompatible or inactive stays return 409
`STAY_NOT_ELIGIBLE`. Missing submissions or stays return 404.

## Remove an association

```json
{
  "expectedRevision": 2,
  "stayId": null,
  "reason": "잘못 연결된 이용 일정이므로 연결을 해제했습니다."
}
```

Omit expectedStayRevision when unlinking. Unlinking is allowed even if the
previous stay has since been cancelled or its property deactivated. The
submission itself must still be an eligible SUBMITTED guest QR record.

Both operations return:

```text
{ id, stayId, revision, updatedAt, changed }
```

Already-unlinked to null is a no-op. Linking to the same stay at the same
previously reviewed stay revision is also a no-op. Both return changed:false
without appending history. Reconfirming a stay whose revision changed records
fresh review context when all other eligibility checks still pass.

An exact successful retry with the old expectedRevision, same administrator,
normalized target/version and reason returns the original saved result. This
can return an older revision after later edits; GET the current detail to refresh
the UI. Changed stale input is rejected. No-op requests create no retry receipt.

## History, photos and guest access

A meaningful change atomically updates only stayId/currentRevision/updatedAt,
appends a CORRECTED revision with administrator identity and reason, and copies
the current revision's photo associations. All earlier snapshots remain intact.
The original guest author, visit date, submittedAt, answers, template wording,
photos and issue evidence are preserved. No Stay or guest profile is modified.

The new snapshot records `stayLinkChange` for this administrator action and its
retry digest. `stayMatch` records the reviewed stay ID/revision, guest name and
planned dates; unlinking sets it to null. Later guest answer corrections carry
stayMatch forward, but do not copy the administrator action or retry digest.
This internal context supports a later calendar consistency check; it is not a
new public response field. Existing admin history shows actor, reason and the
captured stayId for each revision.

Private submission tokens, expiry and authorSource remain unchanged. The
existing token still authorizes only that guest's own checklist and photos;
linking grants no access to stay details or other submissions. The original
submission receipt remains readable under its existing access conditions.
Historical administrator linking does not require an unexpired guest token.

## Existing list additions and boundaries

`GET /admin/submissions` now accepts linkStatus=UNLINKED or LINKED. UNLINKED
selects eligible completed guest QR records without a stay. Combining UNLINKED
with MAINTENANCE or CANCELLED returns 400 `INVALID_SUBMISSION_LINK_FILTER`.
LINKED selects records with a stayId, respecting other existing filters and
status defaults. Omitting linkStatus preserves the original list behavior.
Summaries additionally expose stayId and authorSource. Current snapshot reads
check the stored association against the submission; old history may have a
different captured stayId.

Candidate reads are limited to 60/minute/IP and changes to 10/minute/IP per
process. Deployment proxy/shared rate-limit configuration remains separate.
This slice adds no migration, dependency, test file, frontend, automatic matching,
calendar endpoint or missing-checklist calculation. It does not implement guest
identity verification or physical check-in tracking.
