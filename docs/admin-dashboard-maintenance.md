# Administrator dashboard and maintenance progress

Two independent feature modules expose administrator-only GET endpoints. Both
require `Authorization: Bearer <admin JWT>`, recheck the current ADMIN account,
use no-store/no-referrer headers and allow 60 requests/minute/IP/process per route.
They read existing records without changing submissions, stays, issues or tokens.

## Dashboard

```http
GET /admin/dashboard?date=2026-09-21&propertyId=<property-uuid>
```

Both query fields are optional. `date` defaults to today's Asia/Seoul date and
accepts only valid YYYY-MM-DD dates in 1900–2100. `propertyId` is a UUID v4; an
unknown property returns 404 `PROPERTY_NOT_FOUND`. Omission includes all properties,
including inactive properties with records. Unknown/repeated/invalid query fields
return 400. The dashboard has no page/limit query and counts all matching records.

Example response (illustrative data):

```json
{
  "date": "2026-09-21",
  "today": "2026-09-21",
  "timezone": "Asia/Seoul",
  "asOf": "2026-09-21T01:00:00.000Z",
  "stays": { "arrivals": 4, "departures": 3 },
  "checklists": {
    "checkIn": { "scheduled": 0, "notSubmitted": 2, "submitted": 1, "needsReview": 1, "total": 4 },
    "checkOut": { "scheduled": 0, "notSubmitted": 1, "submitted": 2, "needsReview": 0, "total": 3 }
  },
  "maintenance": {
    "started": 3,
    "completed": 2,
    "completionNeedsReview": 0,
    "unfinished": { "total": 4, "resumable": 1, "expired": 1, "accessBlocked": 1, "needsReview": 1 }
  },
  "issues": { "new": 2, "inProgress": 1, "total": 3 }
}
```

| Field | Meaning |
| --- | --- |
| stays.arrivals | ACTIVE stays whose planned checkInAt falls on the selected day |
| stays.departures | ACTIVE stays whose planned checkOutAt falls on the selected day |
| checklists.checkIn | Current entry-checklist classification for those arrivals |
| checklists.checkOut | Current exit-checklist classification for those departures |
| maintenance.started | Noncancelled DRAFT/SUBMITTED maintenance records started on the selected day |
| maintenance.completed | Valid current submitted maintenance records submitted on that day |
| maintenance.completionNeedsReview | Submitted records for that day whose saved evidence cannot be classified as completed |
| maintenance.unfinished | All current maintenance drafts, including older work, split by current access/evidence state |
| issues | All current noncancelled NEW/IN_PROGRESS issues, including older reports |

Days run from 00:00 Seoul inclusive to the following midnight exclusive. A departure
at midnight belongs to that new day. Same-day stays count in both event groups;
visits spanning the whole day without arriving/departing do not count as events.
Cancelled stays are excluded. The checklist rules are shared with the
[calendar](admin-calendar.md): only correctly linked guest evidence satisfies a
stay, duplicates/changed or invalid evidence needs review, and missing future
checklists are scheduled. Each checklist total equals its corresponding stay count.

The selected date changes event windows, not the time at which state is evaluated.
`asOf` is the request classification time; `today` is its Seoul date. Selecting a
past date shows today's saved evidence for that date, not what the database looked
like then. The interface should label unfinished work and open issues as current.
Starts and completions can occur on different days and are not subtracted to
derive unfinished work. All maintenance numbers count submission records; repeated
draft starts can represent more than one record for the same cleaning job.

## Maintenance record list

```http
GET /admin/maintenance?view=UNFINISHED&page=1&limit=20
GET /admin/maintenance?from=2026-09-21&to=2026-09-21&dateField=SUBMITTED&view=COMPLETED
```

| Query | Contract |
| --- | --- |
| propertyId | Optional property UUID v4; includes historical records at inactive properties |
| from / to | Optional together; inclusive valid Seoul dates, years 1900–2100, maximum 62 days |
| dateField | STARTED (default) or SUBMITTED; selects date filtering and descending ordering |
| view | ALL (default), UNFINISHED (DRAFT), or COMPLETED (SUBMITTED) |
| page | Integer 1–100000, default 1 |
| limit | Integer 1–100, default 20 |

Omitting dates includes all dates. SUBMITTED ordering puts null dates last when
there is no date range. IDs break equal-timestamp ties. List and count use the same
filter/transaction; an out-of-range page returns an empty items array with normal
totals. Only noncancelled MAINTENANCE DRAFT/SUBMITTED rows are eligible.

Supplying just one date or combining `dateField=SUBMITTED` with `view=UNFINISHED`
returns 400 `INVALID_MAINTENANCE_FILTER`. Bad range order/length returns
`INVALID_DATE_RANGE`; unknown properties return `PROPERTY_NOT_FOUND`. DTO validation
rejects invalid dates, arrays, unknown fields and unsupported values.

The envelope contains `items`, `total`, `page`, `limit`, `totalPages`, `asOf` and
`timezone: "Asia/Seoul"`. Each item contains:

```text
id, property: { id, name, region, isActive }, staff: { id, name },
status, reviewReasons, startedAt, updatedAt, submittedAt, expiresAt, currentRevision
```

Timestamps serialize as ISO strings. startedAt can be null for damaged/legacy
records; submittedAt is null for normal drafts; expiresAt is null for completed
records. Opening a staff checklist creates startedAt; it does not prove physical
work began. updatedAt records the most recent saved change, not a staff heartbeat.

| Item status | Meaning |
| --- | --- |
| UNFINISHED | Valid saved draft, unexpired token and current staff/property access |
| EXPIRED | Otherwise structurally valid draft whose continuation token has expired |
| ACCESS_BLOCKED | Structurally valid, unexpired draft whose token or current staff/property access is unavailable |
| COMPLETED | SUBMITTED with a valid current immutable revision agreeing with the submission's scalar fields |
| NEEDS_REVIEW | Invalid/inconsistent lifecycle, source, author evidence, draft content or submitted snapshot |

Structural errors take precedence over expiry; expiry takes precedence over access
blockers. Review reasons are `INVALID_RECORD`, `TOKEN_EXPIRED`, `TOKEN_UNAVAILABLE`,
`PROPERTY_INACTIVE`, `STAFF_ASSIGNMENT_CHANGED` and `STAFF_INACTIVE`. A blocked record
can contain several access reasons. Expired/blocked drafts stay visible and are
never counted as completed. There is no automatic token recovery/cancellation here.
Draft template/answer parsing uses the existing draft rules; incomplete answers
are allowed, while malformed stored content is flagged for review.

`view=COMPLETED` selects submitted database records before safe classification,
so its results can include NEEDS_REVIEW. The client must use each item's status;
the page total is a matching-record count, not a certified-completion count.
`view=UNFINISHED` likewise includes expired, blocked and invalid drafts. There is
no derived-status query filter that silently filters only the returned page.

Staff names come from the saved author snapshot (drafts) or immutable current
revision (completed records), never from a renamed/reassigned live staff profile.
Invalid evidence can return a null staff name. Valid completed records preserve
captured property name/region and expose current property.isActive separately;
drafts use current property labels. Deactivation, reassignment and token expiry
do not erase historical completed work. This is recorded staff attribution through
the existing staff QR flow, not additional identity verification.

## Drilldowns and implementation boundary

- Planned arrivals/departures and checklist details: `/admin/calendar` for the day;
  the UI selects the arrival/departure event and fetches all needed pages.
- Maintenance started on the day: `/admin/maintenance?from=<day>&to=<day>&dateField=STARTED`.
- Submitted maintenance on the day: the SUBMITTED/COMPLETED example above; display
  NEEDS_REVIEW separately from validated completions.
- Current unfinished maintenance: `/admin/maintenance?view=UNFINISHED` without dates.
- Completed answers/history: existing `/admin/submissions/:id` routes.
- Current open problems: existing `/admin/issues` status-filtered lists.

Dashboard aggregation uses one repeatable-read transaction with a 30-second timeout,
processing stays and relevant maintenance evidence in batches of 100. No first-page
cap or query per stay is used. Maintenance lists page in SQL before classification.
Only current revisions are loaded. Responses omit raw snapshots, answers, contact
details, photo data, token hashes and storage keys. The endpoints never rotate
credentials or update records during reads.

No schema, migration, dependency, new test file, frontend screen, physical presence
tracking, automatic room readiness or overdue deadline is introduced. The user
controls staging, commits, database migrations and deployment.
