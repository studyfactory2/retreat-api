# Excel roster preview

The administrator can upload the client's fixed-format legacy `.xls` roster and
retrieve a saved, paginated preview, review candidate rows and explicitly confirm
them into stays. Upload/review only save import data. Confirmation creates new
`Stay` and `StayRevision` records together with the applied row references. It
does not create guest accounts or overwrite existing stays. No schema change or
new migration is required.

## Endpoints

| Method | Route | Result |
| --- | --- | --- |
| POST | /admin/stay-imports/preview | 201: saved preview metadata, summary and first 20 rows |
| GET | /admin/stay-imports/:id | 200: metadata, full summary and filtered page of rows |
| POST | /admin/stay-imports/:id/review | 200: updated preview and first 20 rows |
| POST | /admin/stay-imports/:id/confirm | 200: saved confirmation receipt |

All routes require an active ADMIN bearer token. Guest/staff QR, private links
and staff accounts do not grant access. All responses have no-store/no-referrer
headers. Uploads recheck administrator activity before creating their attachment
and again after storage, before saving the preview.

POST is multipart/form-data with one `file`, maximum 5 MiB. The optional
`propertyMappings` text field contains a JSON array, for example:

```json
[{"sheetName":"부산휴양소(해운대)","propertyId":"<existing-property-uuid>"}]
```

Mappings explicitly connect exact workbook sheet names to existing properties.
They are not guessed from database names. Duplicate sheets or property IDs,
unknown/unmanaged sheets and nonexistent properties are rejected. An inactive
property is flagged for review. Omitted mappings are allowed; unmapped candidate
rows need review and cannot be considered ready. The mapping field has a 32 KiB
limit and at most 40 entries. Other fields/files/query parameters are rejected.

GET accepts `page` (default 1), `limit` (default 20, maximum 100), optional
`validationStatus` (VALID, NEEDS_REVIEW, INVALID), and optional `action`
(CREATE, UPDATE, SKIP). Rows sort by sheetName, then original rowNumber.
The summary always describes the entire batch, independently of page filters.
It contains mutually exclusive total/ready/needsReview/invalid/skipped counts.

Responses project filename/size, batch metadata, and preview rows. They do not
expose storage keys, bucket names, checksums or credentials. Row rawData preserves
the original A:L cell values, types, formats and formula flags. These include
personal information and remain administrator-only. normalizedData is the proposed
stay data, not a newly created stay. Validation messages use stable codes and
Korean text; existing overlap references contain at most 20 stay IDs.

## Supported workbook and row rules

This version reads the supplied legacy OLE/BIFF `.xls` format, not renamed HTML,
CSV, `.xlsx`, or password-protected files. It uses the pinned official
[SheetJS 0.20.3 distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).

The recognized sheets are 부산휴양소(해운대), 부산휴양소(기장), 경주휴양소,
애월1호점, 애월2호점 and 가평휴양소; Unicode normalization and whitespace are
ignored only for recognizing these names/resource labels. Property mappings keep
the exact original sheet name. Unrelated sheets are recorded as SKIP. Gapyeong is
supported by the same template although absent from the supplied sample.

Row 1 headers must match A번호, B자원명, C아이디, D이동전화, E제목, empty F/G/H,
I시작일, J종료일, K요청날짜 or 상태, optional empty L header. Data normally uses
Ecompany, Fdepartment, Gguest name, Hposition, Iarrival, Jdeparture, and Lnotes.
Blank rows are omitted. Original row numbers survive; merged/fill-down layouts
are not inferred. Company/department/name/notes limits follow the stay contracts.

An exact E value 예약 가능일 with empty D/F/G/H is availability, not a stay.
C may contain a shared account; it is never used as a booking/person identity.
K예약 alone never causes a guest to be skipped. Names/phones do not merge profiles.
Unexpected guest/department/position patterns, a request title in the company
column, missing contact details, resource mismatches and hidden sheets need review.
Formula/error cells and malformed/invalid date ranges are flagged as invalid.

Text timestamps and numeric Excel dates respect the workbook date system.
Explicit source times are interpreted in Asia/Seoul and converted to UTC; even
explicit midnight is preserved. Date-only values keep their local date with a
null timestamp and MISSING_TIME. Standard 15:00/11:00 times are never invented.
The parser does not enforce a check-in hour that the client has not specified.

Overlapping source stays are flagged on both rows. Date-only boundaries use
conservative whole-day intervals for possible conflicts. Exact checkout/arrival
boundaries do not overlap. Active database stays are checked for mapped properties;
possible duplicates require review and never become automatic UPDATE operations.
Cancelled stays are excluded. A later upload omitting a stay never cancels it.

CREATE means a proposed action only. Invalid and review rows cannot be applied
without a later explicit correction or skip. All non-stay rows have SKIP.
Preview checks are point-in-time; confirmation revalidates properties, dates and
overlaps inside the same transaction that creates stays.

## Review candidate rows

POST `/:id/review` accepts JSON with the current batch `expectedVersion` and
1–100 row edits. Each edit references a row ID from that batch and chooses
CREATE or SKIP. UPDATE is not supported. Other body/query fields are rejected.

```json
{
  "expectedVersion": 1,
  "rows": [
    {
      "id": "<candidate-row-uuid>",
      "action": "CREATE",
      "data": {
        "propertyId": "<existing-property-uuid>",
        "guestName": "Sample Guest",
        "company": null,
        "department": null,
        "phone": null,
        "notes": "Details checked against the original roster",
        "checkInAt": "2026-10-01T15:00:00+09:00",
        "checkOutAt": "2026-10-02T11:00:00+09:00"
      }
    },
    { "id": "<other-candidate-row-uuid>", "action": "SKIP" }
  ]
}
```

CREATE submits the complete reviewed stay data using the manual stay creation
field rules. Optional company/department/phone/notes omitted from the request
become null; this is replacement, not a patch. Explicitly reviewing a complete
row acknowledges the original parsing warnings, including an intentionally
unavailable optional phone number. New times need an explicit timezone and a
departure later than arrival. Times are normalized to UTC and local dates to
Asia/Seoul. Unknown properties, duplicate row IDs and cross-batch row IDs fail.
An existing but inactive property remains flagged for review.

SKIP must omit data. Candidate normalized values remain available so that the
administrator can later restore the row with a full CREATE review. Availability
and unrelated rows have no normalized stay and cannot be promoted to CREATE.
Original rawData and the stored source file are never changed. Candidate rows
keep the latest review's actor/name/role, time and action in normalizedData.review;
this is latest-review metadata, not a separate history of every preview edit.

Every successful review increments the batch version once, even if supplied
values match. It rechecks all remaining candidates and recalculates overlap
warnings. Skipping an overlapping row can clear the warning on the other row.
Static source warnings on untouched rows remain until explicitly reviewed.
Concurrent/stale edits and changes to confirmed batches return 409.

## Confirm reviewed stays

POST `/:id/confirm` accepts only `{ "expectedVersion": <current-version> }`.
All non-SKIP rows must be valid CREATE candidates. Unresolved rows block the
whole confirmation with 409 IMPORT_ROWS_NOT_READY. The error's `errors` array
identifies up to 100 affected row IDs and their current validation messages.
These checks are fresh; a new conflict can block a previously valid preview.
The saved preview is unchanged on failure. Review the affected rows to save a
refreshed preview and then confirm its new version.

Confirmation checks the current administrator and source state, then uses one
serializable transaction for active-property/overlap checks, batch version claim,
Stay creation, revision-1 snapshots and applied ImportRow links. Stay source is
EXCEL, status ACTIVE, creator is the confirming administrator and guestUserId
remains null. The import row's afterSnapshot and linked StayRevision preserve
what was created. No existing stay is matched by name, updated or cancelled.

The response is `{ batchId, status, version, confirmedAt, confirmedByUserId,
createdCount, skippedCount }`. Batch version increments once and status becomes
CONFIRMED. Retrying with the same pre-confirmation expectedVersion returns the
original receipt without duplicate stays; another version returns 409. Later
stay/profile/property changes do not rewrite the receipt or saved snapshots.
An all-SKIP batch may be confirmed with createdCount 0.

GET now includes confirmedAt/confirmedByUserId on the batch and stayId/appliedAt
on each row. Use existing /admin/stays endpoints for later stay corrections.
Import review/confirmation transactions allow 60 seconds, with a 10-second
connection wait; writes are bounded in chunks. Serialization failures use the
existing retry helper. A failure rolls back the entire transaction.

## Private source storage and failure handling

Original workbooks use the existing AWS_REGION and S3_BUCKET_NAME configuration
and AWS SDK credential chain. The separate ImportSourceStorageService stores
`imports/<uuid>.xls` privately with SHA-256 checksums and conditional creation.
Photo storage and its existing `photos/` scope are unchanged.

Add this statement to the development IAM user's policy and, at deployment, the
EC2 instance role policy, adjusting the bucket name for the environment:

```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:DeleteObject"],
  "Resource": "arn:aws:s3:::retreat-photos-dev/imports/*"
}
```

Keep the bucket private. This slice provides no source-download route and needs
no public bucket permission or additional browser-to-S3 CORS configuration.
The multipart upload goes through the backend.

The upload creates a PENDING source attachment, uploads to S3, then atomically
marks it READY and saves the complete preview/rows. Failure marks an unreferenced
PENDING source FAILED and attempts deletion. An uncertain successful commit cannot
delete its already-READY, referenced source. Cleanup failures retain a safe log
message and a tracked attachment for a later cleanup retry. Successfully saved
sources are retained; previews are not idempotent, so another upload creates a
new preview. Stay-level duplicates are only flagged, never applied by this slice.

## Limits and verification boundary

Parsing runs in a worker with a 5-second limit and a 256 MiB V8 old-generation
limit (not a total process memory guarantee). There are at most two active parser
workers and two in-flight import uploads per process. Workbooks are limited to
40 sheets, 2,000 rows per sheet, 5,000 retained rows total and 32 source columns.
Only A:L are interpreted. The worker validates original dimensions so a truncated
read cannot silently pass. Each source text cell is limited to 4,000 characters.
Each POST route is limited to 10/minute/IP/process and GET to 60; deployment proxy settings
remain part of release configuration.

The supplied workbook has 172 nonblank data rows: 83 guest candidates, three
managed availability rows and 86 unrelated rows. With all five properties mapped
and no database conflicts, 67 candidates are ready and 16 require review.
These numbers describe the sample, not an assumption for future uploads.

Parser and HTTP contract probes use replacement providers. Review/confirmation
was also checked against disposable PostgreSQL fixtures, including simultaneous
confirmation/review requests, competing manual bookings, rollback after database
failure and a 5,000-row batch. The maximum-size local run took about 43 seconds;
this does not establish performance on the deployment server. Live AWS
permissions/upload/failure behavior and the deployed environment still require
integration checks after the policy update. No live workbook upload, application
migration or deployment is performed by local verification.
