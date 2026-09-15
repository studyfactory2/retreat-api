# Administrator stay APIs

One Stay is a planned guest visit at one entire property. It is separate from the
guest's actual checklist submission. ACTIVE means the visit is not cancelled,
not that the guest is physically present. These routes require the existing
administrator Bearer token, return no-store responses, and use GET/POST only.

## Routes

| Method | Path | Purpose | Success |
|---|---|---|---|
| POST | /admin/stays | Create a manual visit and revision 1 | 201 |
| GET | /admin/stays | Filtered, paginated list | 200 |
| GET | /admin/stays/:id | Current visit details | 200 |
| POST | /admin/stays/:id/update | Correct an active visit | 200 |
| POST | /admin/stays/:id/cancel | Cancel an active visit | 200 |
| POST | /admin/stays/:id/restore | Restore a cancelled visit | 200 |
| GET | /admin/stays/:id/history | Paginated immutable history | 200 |

All IDs in paths and propertyId inputs must be UUID v4 values. Every handler
declares ADMIN role and RolesGuard separately and logs only a static action name.
Credentials, guest details, request bodies, and personal links are not logged.

## Create

POST /admin/stays:

```json
{
  "propertyId": "<property UUID>",
  "guestName": "이용객",
  "company": "회사명",
  "department": "부서명",
  "phone": "010-0000-0000",
  "checkInAt": "2026-09-20T15:00:00+09:00",
  "checkOutAt": "2026-09-22T11:00:00+09:00",
  "notes": "관리자 메모"
}
```

Required: propertyId, guestName, checkInAt, checkOutAt. Guest name is trimmed,
nonblank, and at most 100 characters. Company/department are nullable and at most
100 characters, phone 32, notes 2000. Optional text can be cleared with null or
blank text; omitted fields remain unset on create and unchanged on update.

The property must exist and be active. The server sets source MANUAL, status ACTIVE,
currentRevision 1, and createdByUserId from the administrator's authenticated
session. It creates no guest account. guestUserId, creator/source/status, revision
history, and other undeclared fields cannot be supplied by the browser.

## Dates and availability

Use ISO date/time strings with explicit timezone, including seconds: a Z suffix
or an offset such as +09:00, with optional 1-3 fractional digits. Years 1000-9999
are accepted. Date-only strings, timestamps without timezone, impossible dates,
and invalid clock values are rejected. API responses serialize instants in UTC;
the frontend displays them in Asia/Seoul. In query strings, encode + as %2B.

Departure must be strictly later than arrival. For the same property, two ACTIVE
stays cannot overlap. The intervals are half-open: checkout at 11:00 and the next
arrival at 11:00 are allowed. Cancelled stays do not block availability. A stay
may span months; filters include every visit overlapping the requested interval.

Checks and writes share a serializable transaction. Simultaneous overlapping
create/update/restore requests cannot both reserve the same interval. This rule
is enforced by these services, not by a new database exclusion constraint; later
import paths must use the same transaction and conflict rules.

## Correct, cancel, and restore

Every mutation requires expectedRevision from the current Stay response. Send it
as a JSON integer, not a string. A stale value returns 409 STALE_STAY_REVISION;
refetch and review the newer record before deciding whether to retry.

POST /admin/stays/:id/update:

```json
{
  "expectedRevision": 1,
  "checkOutAt": "2026-09-23T11:00:00+09:00",
  "phone": null,
  "reason": "이용 일정 변경"
}
```

Allowed fields are guestName, company, department, phone, notes, checkInAt,
checkOutAt, and optional reason. At least one visit field must be supplied;
expectedRevision/reason alone is not an update. The updated response carries
currentRevision 2. Even a repeated field value is recorded as a new correction
when explicitly submitted with the latest revision.

Property cannot be changed after creation. Cancel and create a replacement for
the correct property. This avoids moving previously linked checklists/history.
Cancelled visits must be restored before editing. Date changes require an active
property and recheck availability. Guest/notes corrections and cancellation remain
available for active stays whose property has since been deactivated.

POST /admin/stays/:id/cancel:

```json
{ "expectedRevision": 2, "reason": "이용 취소 요청" }
```

The result becomes CANCELLED with currentRevision 3, cancelledAt, and
cancellationReason. History and linked records remain; this does not cancel or
resolve checklist submissions/issues automatically. A repeated cancellation with
an old revision gives a stale conflict; with the latest revision, it gives
INVALID_STAY_STATE.

POST /admin/stays/:id/restore:

```json
{ "expectedRevision": 3, "reason": "취소 처리 정정" }
```

Restoration requires an active property and available original dates. It returns
ACTIVE with currentRevision 4 and clears current cancellation fields. The earlier
cancellation reason/time remain in revision 3. Reasons for cancel/restore are
required, trimmed, nonblank, and at most 1000 characters. A correction reason is
optional and can be null. Cancellation/restoration do not change source or creator.

## Lists and history

GET /admin/stays supports page (default 1, max 100000), limit (default 20, max 100),
propertyId, status (ACTIVE or CANCELLED), search (max 100 characters), from, and to.
Omitting status includes both states. Search matches guest name, company,
department, or phone case-insensitively. Results sort by checkInAt ascending then
ID ascending. from and to are optional explicit-zone timestamps; if both are
provided, from must be earlier. Filters use checkOutAt > from and checkInAt < to.

Example: `/admin/stays?status=ACTIVE&from=2026-09-01T00:00:00%2B09:00&to=2026-10-01T00:00:00%2B09:00`.

List results use `{ items, total, page, limit, totalPages }`. An empty result has
totalPages 0; a page past the end has empty items with the actual total. Unknown
filters, array values, malformed numbers, and isActive are rejected. Existing
staff/property lists still accept their own isActive filter unchanged.

Stay responses contain all Stay scalar fields, plus safe property
`{ id, name, region, isActive }` and createdBy `{ id, name }` summaries. They never
include QR hashes, login credentials, or the full User record. Date fields become
ISO strings, and nullable fields remain null.

GET /admin/stays/:id/history accepts only page/limit and returns the same list
envelope, ordered by revision version descending. Each item includes id, stayId,
version, action, snapshot, actorUserId, actorSnapshot, reason, importRowId, and
createdAt. The snapshot contains schemaVersion 1, all Stay scalar values, and
property labels at that time. Actor snapshots contain id, name, and role without
loginId or credentials. Profile/property renames cannot change older snapshots.

## Errors and boundary

| Code | HTTP | Meaning |
|---|---|---|
| VALIDATION_ERROR / INVALID_STAY_ID | 400 | Invalid body/query/path value |
| INVALID_DATE_RANGE | 400 | End is not later than start |
| EMPTY_UPDATE | 400 | No editable visit field provided |
| STAY_NOT_FOUND / PROPERTY_NOT_FOUND | 404 | Requested record does not exist |
| PROPERTY_INACTIVE | 409 | Cannot create, reschedule, or restore at this property |
| STAY_OVERLAP | 409 | An active visit already overlaps these dates |
| STALE_STAY_REVISION | 409 | Another change has advanced the version |
| INVALID_STAY_STATE | 409 | Action is incompatible with current state |
| CONCURRENT_UPDATE | 409 | Transaction conflicted after three attempts |

Authentication remains administrator-only. Unauthenticated, invalid-token, and
currently unsupported staff/guest sessions receive 401. No new schema/migration,
guest login/invitations, guide or vehicle fields, Excel import, actual checklist
completion, dashboard UI, or frontend is implemented in this slice.
