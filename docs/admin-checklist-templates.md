# Administrator checklist-template APIs

A template defines the questions shown at one property. It is separate from a
guest's answers or a staff cleaning job. There is one current template per property
and type: CHECK_IN, CHECK_OUT, or MAINTENANCE. All routes require the existing
administrator Bearer token and return Cache-Control: no-store.

| Method | Route                                            | Purpose                                    |
| ------ | ------------------------------------------------ | ------------------------------------------ |
| POST   | /admin/checklist-templates                       | Create initial configuration (201)         |
| GET    | /admin/checklist-templates                       | Filtered, paginated templates (200)        |
| GET    | /admin/checklist-templates/:id                   | Current template details (200)             |
| POST   | /admin/checklist-templates/:id/update            | Publish changes to any template type (200) |
| GET    | /admin/checklist-templates/:id/versions          | Paginated published versions (200)         |
| GET    | /admin/checklist-templates/:id/versions/:version | Read a captured version (200)              |

## Create initial configuration

```json
{
  "propertyId": "<property UUID>",
  "type": "MAINTENANCE",
  "title": "청소·정비 체크리스트",
  "sections": [
    {
      "title": "욕실",
      "items": [
        {
          "label": "온수가 정상적으로 나오나요?",
          "required": true,
          "answerType": "NORMAL_ABNORMAL"
        }
      ]
    }
  ]
}
```

The example illustrates the payload, not the client's final checklist wording.
The property must exist and be active. Guest CHECK_IN/CHECK_OUT templates can be
configured and edited here, including a Jeju rental-car section once its actual
questions are supplied. CHECK_IN, CHECK_OUT, and MAINTENANCE have the same edit
and version-history rules.

Creation generates the template, section, and item IDs on the server. Do not
supply section/item IDs on create. The server sets version 1, isActive true, and
definition.schemaVersion 1. Duplicate property/type combinations return 409,
including when the existing template is inactive. No real templates are seeded.

## Definition and response

The response includes id, propertyId, type, title, version, definition, isActive,
createdAt, updatedAt, and property { id, name, region, isActive }. It includes no
credentials, staff profiles, or QR digests. Dates serialize as UTC ISO strings.

```json
{
  "schemaVersion": 1,
  "sections": [
    {
      "id": "<server-generated section UUID>",
      "title": "욕실",
      "items": [
        {
          "id": "<server-generated item UUID>",
          "label": "온수가 정상적으로 나오나요?",
          "required": true,
          "answerType": "NORMAL_ABNORMAL"
        }
      ]
    }
  ]
}
```

schemaVersion describes the JSON format and remains 1. The template's separate
version increments on meaningful changes. Array order is display order.

Titles are trimmed, nonblank, and at most 150 characters; labels at most 300.
There must be 1-20 sections, 1-50 items per section, and no more than 500 items
overall. required must be a JSON boolean; answerType must be NORMAL_ABNORMAL.
Required means the item must eventually be answered; it does not require a defect
description or photo. Null fields, malformed nested objects, unsupported answer
types, arbitrary raw definition JSON, and unknown properties are rejected.

## Publish template changes

Send expectedVersion from the latest template response. At least one of title,
sections, or isActive must be provided. Property and type are immutable.

```json
{
  "expectedVersion": 1,
  "title": "정비 체크리스트",
  "sections": [
    {
      "id": "<existing section UUID>",
      "title": "욕실",
      "items": [
        {
          "id": "<existing item UUID>",
          "label": "온수 상태를 확인해 주세요.",
          "required": true,
          "answerType": "NORMAL_ABNORMAL"
        },
        {
          "label": "수건이 준비되어 있나요?",
          "required": true,
          "answerType": "NORMAL_ABNORMAL"
        }
      ]
    }
  ]
}
```

When sections is supplied, it replaces the whole current section list. Keep IDs
for existing sections/items; omit IDs for new ones. Omitted existing items or
sections are removed from the current definition. Reorder arrays to change order.
An existing item ID must remain in its original section; moving a question to a
different section means removing it and creating it there without an ID. Unknown,
duplicate, cross-template, and previously removed IDs cannot be supplied. New IDs
come from the server, not from labels or array positions.

Omitting sections preserves the definition. isActive false disables a
template; true reactivates it. All edits require an active property. Administrators
can still read templates and their versions belonging to inactive properties.
New guest/staff checks require both property and template to be active.

The version check and update are atomic. Stale requests return 409
STALE_TEMPLATE_VERSION; refetch and review before retrying. Submitting unchanged
values with the latest version returns the existing template without increasing
its version. Empty updates are rejected. New IDs or changed array order count as
changes. Creation and update use serializable transactions with bounded retries.
The authenticated administrator must still be active with the ADMIN role inside
that transaction. The server captures the administrator's current ID and name;
clients cannot supply the publisher. The template update and new version row
are committed together. Saving publishes immediately; there is no unpublished
server-side editor draft or scheduled publication.

These APIs never write ChecklistSubmission or SubmissionRevision. Their captured
templates and history remain untouched. A check captures its questions, title and
template version when its draft is successfully created. An existing draft keeps
that snapshot when saved or submitted, including its original required questions,
answers and photo associations. A newly required question is only required for a
new check started after publication. Existing authorization, staff assignment,
property activity and access-expiry rules still apply. Disabling the template
prevents new starts; it does not itself invalidate an existing draft.

A reservation, invitation, QR link, or open start page does not reserve a template
version. A new draft uses the active version read in its creation transaction.
Concurrent publication and draft creation are serialized; either the complete
old version or the complete new version is captured.

## Published version history

`GET /admin/checklist-templates/:id/versions` accepts only page (default 1,
maximum 100000) and limit (default 10, maximum 100). It returns:

```ts
{
  templateId: string;
  currentVersion: number;
  items: Array<{
    version: number;
    title: string;
    isActive: boolean;
    publishedAt: string; // UTC ISO timestamp
    actor: { id: string; name: string } | null;
    source: 'PUBLISHED' | 'BASELINE';
    sectionCount: number;
    itemCount: number;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

Items are ordered by version descending. The detail route returns the same
summary fields plus templateId, propertyId, type and the full captured definition.
Version path parameters are decimal integers from 1 through 2147483647. A valid
but unrecorded version returns 404 CHECKLIST_VERSION_NOT_FOUND. Historical titles,
question text, order, required flags, activity and publisher names come from the
saved version, not today's user profile or template. History reads use a consistent
database snapshot and remain available when the property/template is inactive.

Version rows are append-only through these APIs. There is no version edit, delete,
or restore endpoint. A later correction is another publication, not a rewrite of
an older version. A no-op save creates no history entry.

After the schema migration, the separate Prisma Client backfill stores **only
each existing template's current version** as BASELINE with its existing updatedAt
and a null actor. This timestamp is the known last save time, not proof of the
original publication time. Earlier versions cannot be reconstructed reliably and
are not invented. Individual old submissions still retain their own snapshots.
New publications have source PUBLISHED and an actor. Both the existing updatedAt
column and archived publishedAt use TIMESTAMPTZ(3). Copying the Date preserves its
instant regardless of the deployment database session's time zone.

## List and errors

GET supports propertyId, type, isActive, search, page (default 1, max 100000), and
limit (default 20, max 100). Search matches template title or property name,
case-insensitively. isActive filters the template, not the property's activity.
Omitting filters includes all template types and activity states. Results order
by propertyId, type, then id and return { items, total, page, limit, totalPages }.
An empty result has totalPages 0. Every path/property ID must be UUID v4.

| HTTP | Code                                                     | Meaning                                                                                    |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 400  | VALIDATION_ERROR / INVALID_CHECKLIST_TEMPLATE_ID         | Invalid body, query, or path                                                               |
| 400  | EMPTY_UPDATE                                             | No editable field supplied                                                                 |
| 400  | INVALID_CHECKLIST_SECTION_ID / INVALID_CHECKLIST_ITEM_ID | ID cannot be retained here                                                                 |
| 400  | DUPLICATE_CHECKLIST_ID / CHECKLIST_TOO_LARGE             | Duplicate IDs or too many items                                                            |
| 404  | PROPERTY_NOT_FOUND / CHECKLIST_TEMPLATE_NOT_FOUND        | Record does not exist                                                                      |
| 400  | INVALID_CHECKLIST_VERSION                                | Invalid history version path                                                               |
| 404  | CHECKLIST_VERSION_NOT_FOUND                              | Version was not archived                                                                   |
| 409  | CHECKLIST_TEMPLATE_EXISTS                                | Property/type already configured                                                           |
| 409  | PROPERTY_INACTIVE                                        | Property cannot be configured while inactive                                               |
| 409  | STALE_TEMPLATE_VERSION / CONCURRENT_UPDATE               | Conflicting update                                                                         |
| 409  | CHECKLIST_HISTORY_UNAVAILABLE                            | Current version is missing from the archive; stop edits and inspect the deployment cutover |

## Deployment prerequisite

The migration is `20261029080000_add_checklist_template_versions`. Its SQL was
generated by the installed Prisma 5.22 CLI from the previous and current schema
files, without connecting to a database. It creates the history enum, table,
primary key, index and foreign keys; it does not copy existing data. No handwritten
SQL is required. Positive version numbers and source/actor consistency are
validated by the API and backfill code, not database CHECK constraints.

The separate `checklist:versions:backfill` command uses Prisma Client operations
only. Without arguments it checks existing data without writing. `--apply` first
checks every template, then creates missing baselines in serializable transactions.
An existing matching current version is left intact. Invalid data, a conflicting
current archive or a missing current version when earlier history exists causes
failure instead of rewriting or fabricating history. A later failure reports how
many baselines were already committed; matching baselines are skipped on a rerun.
Stop template writes for the entire cutover: an old API process writing after
baseline capture would not create an archive entry. Existing guest/staff drafts
need no migration and must not be restarted.

For local development, stop the API, then run from `retreat-api`:

```sh
npx prisma migrate dev
npm run checklist:versions:backfill -- --apply
npm run start:dev
```

Run each command only after the previous one succeeds. The migration already
exists, so no `--name` is needed. Prisma 5.22 `migrate dev` also regenerates Prisma
Client; `prisma generate` alone does not update the database. If Prisma reports
drift or requests a reset, stop and investigate instead of accepting a reset.
An optional read-only backfill check is `npm run checklist:versions:backfill`.

Before the operator's deployment:

1. Announce a brief pause in checklist editing and stop the old API using the
   existing deployment runbook's service commands, so it cannot publish during
   the backfill. No deployment-script change is included here.
2. Build the release, including Prisma Client generation, using the existing
   runbook. Apply the committed migration with the production `migrate deploy`
   workflow, then run `npm run checklist:versions:backfill -- --apply` in the
   matching operator image against that same database. Keep the API stopped until
   both commands succeed. `migrate dev` is for local development only.
3. Start the new API. Check current templates and their baseline history, then
   deploy the client and resume template editing. New API publications must each
   add one version row. The backfill is an explicit one-time operator step, not an
   automatic startup task or a change to `deploy.sh`.

If the old API already wrote during this window, a meaningful new update fails
closed with CHECKLIST_HISTORY_UNAVAILABLE when its current version has no archive.
Do not retry by changing expectedVersion or fabricate a lost version. Inspect the
affected records before deciding a recovery plan.

This change does not run migrations or alter production data automatically. It
adds no new authentication, QR/public routes, photo-upload behavior or bulk
property editing. Jeju question content remains a configuration input; Gyeongju
vehicle registration is a separate feature.
