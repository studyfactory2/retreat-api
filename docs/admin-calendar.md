# Administrator calendar

`AdminCalendarModule` owns `GET /admin/calendar` in its own component folder.
Use `Authorization: Bearer <admin JWT>` with the current ADMIN account. The route
uses RolesGuard, no-store/no-referrer headers and a 60/minute/IP/process limit.
It reads planned stays and checklist evidence without changing either.

## Request and dates

```http
GET /admin/calendar?from=2026-09-01&to=2026-09-30&page=1&limit=100
Authorization: Bearer <admin JWT>
```

| Query | Contract |
| --- | --- |
| from / to | Required valid YYYY-MM-DD dates, years 1900–2100 |
| propertyId | Optional property UUID v4 |
| page | Integer 1–100000, default 1 |
| limit | Integer 1–100, default 20 |

The range is inclusive in Asia/Seoul, must be ordered, and can contain at most
62 days. Invalid dates, repeated/array values and unknown fields return 400;
invalid range order or length returns `INVALID_CALENDAR_RANGE`. A well-formed
but nonexistent propertyId returns 404 `PROPERTY_NOT_FOUND`.

Only ACTIVE (not cancelled) stays are returned. Past stays remain eligible;
ACTIVE is not a statement that a guest is currently present. Stays must arrive
before midnight after `to` and depart at or after midnight starting `from`.
This includes long visits spanning the whole view, same-day stays, and a checkout
exactly at the range start. The departure event remains visible on its day;
this does not extend the underlying occupancy interval or permit overlapping stays.

Existing stays at inactive properties remain visible, with property.isActive
included. Disabling a property must not hide its historical records. Results
sort by checkInAt and ID; total counts all matching stays, not only the page.
An empty or out-of-range page has items:[] and the normal pagination metadata.
Fetch every page needed to draw the complete view; there is no silent row cap.

## Response

The envelope contains `from`, `to`, `timezone: "Asia/Seoul"`, `asOf`, `today`,
`items`, `total`, `page`, `limit` and `totalPages`. `asOf` is the request's
classification time and `today` its Seoul date. Timestamps serialize as ISO
strings. Each stay exposes only:

```text
id, property: { id, name, region, isActive }, guestName,
checkInAt, checkOutAt, currentRevision, checkIn, checkOut
```

Both checklist fields have this shape:

```json
{
  "type": "CHECK_IN",
  "expectedDate": "2026-09-21",
  "status": "NOT_SUBMITTED",
  "submissionCount": 0,
  "submissionId": null,
  "reviewReasons": []
}
```

CHECK_IN uses the planned arrival's Seoul date; CHECK_OUT uses the departure's.
Both statuses are included even when one event is outside the requested window,
so a spanning stay retains its complete inspection context.

| Status | Meaning |
| --- | --- |
| SCHEDULED | No linked submitted checklist, and its expected day is after today |
| NOT_SUBMITTED | No linked submitted checklist, and its expected day is today or earlier |
| SUBMITTED | Exactly one submitted checklist with valid current evidence and matching captured stay context |
| NEEDS_REVIEW | Duplicate records, changed stay context, or evidence that cannot be safely classified |

There is no overdue state or assumed deadline. NOT_SUBMITTED on the expected
day does not mean late, even before the planned arrival/departure time. A valid
early submission can show SUBMITTED for a future visit. Checklist completion
does not assert physical check-in, presence, checkout or cleaning completion.

## Matching and review

Only linked SUBMITTED CHECK_IN/CHECK_OUT records count. DRAFT, CANCELLED,
MAINTENANCE and unlinked guest QR submissions do not satisfy a stay's checklist.
The API does not infer links from a person's name or phone number. Unmatched QR
records remain available through `/admin/submissions?linkStatus=UNLINKED` and
the [administrator linking workflow](admin-submission-stays.md).

`submissionCount` counts all linked SUBMITTED records of the relevant type.
More than one always gives NEEDS_REVIEW / DUPLICATE_SUBMISSIONS; no newest record
is silently chosen. Zero records gives SCHEDULED or NOT_SUBMITTED. Exactly one
provides its submissionId, even if it needs review, for administrator detail access.
Duplicate or absent groups have submissionId:null.

The current saved revision is parsed and checked against the live submission's
IDs, source, type, status, date, template, author ID and timestamps. Eligible
sources are manually linked GUEST_QR and stay-linked PRIVATE_LINK. The internal
stayMatch must agree with the stay ID, current revision, guest name and both full
planned timestamps. A manually reviewed QR guest name may differ from the stay
name; a private-link author must agree with its captured stayMatch guest name.

| Review reason | Meaning |
| --- | --- |
| DUPLICATE_SUBMISSIONS | More than one submitted record references this stay/type |
| STAY_CHANGED | Captured stay revision, guest name or full dates differ from the current stay |
| VISIT_DATE_MISMATCH | Recorded inspection date differs from the relevant current arrival/departure day |
| MISSING_MATCH_CONTEXT | No saved stayMatch context, including legacy personal-link records |
| INVALID_SUBMISSION_RECORD | Missing/inconsistent current revision or malformed stored evidence/context |

Any stay revision change, including a notes-only correction or cancel/restore,
conservatively requires review. For eligible QR submissions, the existing linking
endpoint can reconfirm an unchanged-date association at the new stay revision.
This calendar slice does not add reassignment or reconfirmation for private-link
submissions, cancel duplicate checklists, or rewrite old evidence automatically.

To inspect duplicate records, use the newly supported stayId list filter:

```http
GET /admin/submissions?stayId=<stay-id>&type=CHECK_IN&status=SUBMITTED
```

This filter combines with existing filters and is paginated. LINKED preserves
the requested stayId. Combining stayId with UNLINKED returns 400
`INVALID_SUBMISSION_LINK_FILTER`. For one record use its submissionId detail/history.

## Personal-link evidence and historical access

New private-link finalizations now capture stayMatch in the original revision
within the existing serializable transaction. The capture includes only stay ID,
revision, guest name and planned timestamps; parent access is rechecked and no
invitation secrets are added. Existing exact submission retries return their
original receipt without backfilling metadata. Guest corrections already carry
stayMatch forward. Manually linked QR records already captured the same context.

Legacy personal-link submissions with no captured stay version are flagged for
review rather than guessing from mutable invitations or history timestamps.
Their original records remain readable under the administrator APIs.

Calendar classification does not check current guest token expiry, revocation,
replacement or invitation version. Those govern guest access, not whether a
historical submission happened. A valid captured record still counts after an
invitation expires/reissues, provided the stay itself has not changed.

## Bounds and completion boundary

Stay rows, total, grouped counts and singleton snapshots use one repeatable-read
transaction. At most 100 stays / 200 stay-type groups are classified per page.
Counts include every duplicate, but snapshots are loaded only for singleton
groups, taking one revision per submission. There is no query per stay. Raw
snapshots, checklist answers, photo data, contact details, hashes, tokens and
storage keys are not returned by this endpoint.

No schema/migration, new dependency, test file, UI, dashboard aggregates, Excel
export, guest identity verification, physical presence tracking or overdue policy
is added. The user retains control of commits, migrations and deployment.
