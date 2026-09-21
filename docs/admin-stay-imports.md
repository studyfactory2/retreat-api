# Excel roster preview

The administrator can upload the client's fixed-format legacy `.xls` roster and
retrieve a saved, paginated preview. This slice writes `Attachment`, `ImportBatch`
and `ImportRow` only. It never creates or updates stays, guests, stay history, or
calendar entries. Confirmation, reviewed corrections and applying rows are the
following slice. No schema change or new migration is required.

## Endpoints

| Method | Route | Result |
| --- | --- | --- |
| POST | /admin/stay-imports/preview | 201: saved preview metadata, summary and first 20 rows |
| GET | /admin/stay-imports/:id | 200: metadata, full summary and filtered page of rows |

Both routes require an active ADMIN bearer token. Guest/staff QR, private links
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
Preview checks are point-in-time; confirmation must revalidate mappings, dates,
overlaps and expected stay versions before writing operational data.

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
POST is limited to 10/minute/IP/process and GET to 60; deployment proxy settings
remain part of release configuration.

The supplied workbook has 172 nonblank data rows: 83 guest candidates, three
managed availability rows and 86 unrelated rows. With all five properties mapped
and no database conflicts, 67 candidates are ready and 16 require review.
These numbers describe the sample, not an assumption for future uploads.

Local parser/HTTP probes use fake database and S3 providers. Real PostgreSQL and
AWS permissions/upload/failure behavior still require an integration check after
the policy update. No live workbook upload, migration or deployment is performed
by local verification.
