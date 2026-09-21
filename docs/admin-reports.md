# Administrator Excel reports

`AdminReportsModule` owns one administrator-only download route:

```http
GET /admin/reports/excel?from=2026-09-01&to=2026-09-30
Authorization: Bearer <admin JWT>
```

Add `propertyId=<property-uuid>` for one property. Omit it for all properties,
including historical records at inactive properties. The current administrator
account is authenticated by RolesGuard for every request. No `/api` prefix is used.

## Inputs and limits

| Query | Contract |
| --- | --- |
| from | Required valid YYYY-MM-DD date in 1900–2100 |
| to | Required valid YYYY-MM-DD date in 1900–2100 |
| propertyId | Optional UUID v4; unknown property returns 404 |

Dates are inclusive, ordered, and limited to 62 days. The server translates the
range to `[from 00:00, day-after-to 00:00)` in fixed UTC+09:00, consistent with the
application's Seoul business-date helpers. Date formatting is independent of the
server's timezone. Invalid/repeated/array query values, timestamps, and unknown
fields are rejected. There is no page/limit parameter: an accepted request exports
every matching record.

The combined maximum is 5,000 records across all three sheets, with an XLSX size
limit of 16 MiB. A larger request fails and asks the manager to narrow the period
or property; it never silently exports just the first page. The route permits
10 requests/minute/IP/process and one active generation per process. Multiple
deployed API processes have independent limits.

## Workbook contents

The workbook contains exactly three sheets. Each has Korean headings, period and
property metadata, generation time, a sheet record count and combined record
count. Data rows are sorted by the relevant event time and ID. Nonempty tables
have column filters. Empty sheets retain headings and show zero records plus an
empty-state message. Dates/timestamps and counts are numeric Excel cells; blank
optional fields remain blank. All timestamps display Korean time (UTC+09:00).

| Sheet | Records and columns |
| --- | --- |
| 입퇴실 제출 | Submitted CHECK_IN/CHECK_OUT records: inspection date, captured property/guest name, type, submission time, answered/abnormal item counts, photo count, region, linked stay ID, submission ID and revision |
| 정비 제출 | Valid submitted MAINTENANCE records: inspection date, captured property/staff name, start/submission time, answered/abnormal item counts, photo count, region, submission ID and revision |
| 이상사항 | Noncancelled problems: reported time, captured property label, title, current status, urgency, category, area, resolved time, region, issue ID and version |

The first two sheets filter by **submittedAt**, not visitDate or startedAt. A
checklist inspected yesterday but submitted today belongs in today's submission
report. Inspection/start dates remain separate columns. An early or late checklist
can therefore show an inspection date outside the selected submission period.

Issues filter by **reportedAt**, with NEW, IN_PROGRESS and RESOLVED all included.
Status and resolved time are current at generation time. A problem reported during
the period but resolved afterward appears resolved. Older open issues outside the
selected reported-date window are absent; the dashboard's current open-issue total
uses a different scope and can be larger.

Only currently SUBMITTED, noncancelled checklist records are eligible. Drafts,
expired/blocked unfinished work and cancelled submissions are excluded. Cancelled
issues are excluded. This is a submission activity report: it does not list guests
who never submitted, infer presence or certify room readiness. Use the calendar
for missing submissions and `/admin/maintenance?view=UNFINISHED` for open cleaning
records. Unlinked guest QR submissions remain eligible and have a blank stay ID.

Each row uses the latest saved revision/event, preserving names and labels captured
in that evidence. Renaming or deactivating a live property/staff profile does not
replace historical labels. The property filter label at the top is the property's
current name; individual historical rows may legitimately use older names.
Reissuing/expiring guest or staff access does not erase historical submissions.
The report does not change records or recreate state as it was at the period end.

The three summaries include counts, not individual answers, full correction
history, photo files or photo viewing links. Photo counts describe captured
submission evidence; generating a report does not contact S3 or verify current
storage availability. The existing authenticated detail/history/photo routes
remain the way to inspect those records.

## Download response

Successful responses are HTTP 200 with:

```text
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="retreat-report-2026-09-01-2026-09-30.xlsx"
Content-Length: <actual byte length>
Cache-Control: no-store
Referrer-Policy: no-referrer
Access-Control-Expose-Headers: Content-Disposition
```

The future React client should send the existing administrator Authorization
header, check response.ok, then read the successful response as a Blob. Create an
object URL for the file download and revoke it afterward. Read an unsuccessful
response as the normal JSON API error, so an error body is never saved as `.xlsx`.
An ordinary anchor alone cannot attach the required Bearer header. Allowed origins
can read Content-Disposition to use the server filename.

No report is stored on disk or S3. The filename contains validated dates only,
so guest/property names cannot enter response headers. All user-supplied workbook
text is written as literal string cells, including values beginning with `=`, `+`,
`-`, `@`, tabs or URLs. No formulas, hyperlinks, macros or external data connections
are generated. Contact details, credentials, tokens and storage keys are omitted.

## Error responses

| Status / code | Meaning |
| --- | --- |
| 400 VALIDATION_ERROR | Missing/invalid dates, invalid UUID, repeated fields or unsupported query |
| 400 INVALID_REPORT_RANGE | Reversed dates or more than 62 days |
| 401 / 403 | Missing/invalid administrator authentication or insufficient role |
| 404 PROPERTY_NOT_FOUND | Well-formed property ID does not exist |
| 409 REPORT_RECORD_NEEDS_REVIEW | An eligible saved submission or issue has missing/inconsistent current evidence |
| 413 REPORT_TOO_LARGE | More than 5,000 combined records or output over 16 MiB |
| 429 REPORT_EXPORT_BUSY | This process is already generating another report |
| 429 | Per-route request limit reached |
| 500 | Unexpected database/generation failure; shared safe server error |

Damaged eligible evidence rejects the whole request before a file is returned.
The endpoint does not silently omit damaged rows, invent a completion state or
fall back to mutable names. The report's 409 conversion applies only to record
validation; database failures remain server errors. Error responses keep no-store
headers and do not receive XLSX content type or download disposition.

## Implementation and verification boundary

The controller handles the route and authorization, AdminReportsService coordinates
generation/download, AdminReportReaderService reads and validates records, and
AdminReportWorkbookService formats XLSX using the existing xlsx dependency. The
reader uses one RepeatableRead transaction (30-second timeout), counts first and
loads current evidence in 100-record batches. It compares collected totals to the
counts and retains only summary rows between batches.

No schema changes or migration are required. No new tests/spec files, packages,
frontend, scheduled reports, PDF export or deployment changes are included.
The user controls staging, commits, migrations and deployment.
