# Administrator checklist-template APIs

A template defines the questions shown at one property. It is separate from a
guest's answers or a staff cleaning job. There is one current template per property
and type: CHECK_IN, CHECK_OUT, or MAINTENANCE. All four routes require the existing
administrator Bearer token and return Cache-Control: no-store.

| Method | Route                                 | Purpose                             |
| ------ | ------------------------------------- | ----------------------------------- |
| POST   | /admin/checklist-templates            | Create initial configuration (201)  |
| GET    | /admin/checklist-templates            | Filtered, paginated templates (200) |
| GET    | /admin/checklist-templates/:id        | Current template details (200)      |
| POST   | /admin/checklist-templates/:id/update | Edit a maintenance template (200)   |

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
configured here initially, including a Jeju rental-car section once its actual
questions are supplied. Their title, definition, and activity are fixed after
creation through these MVP APIs. Routine editing is limited to MAINTENANCE.

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

## Update maintenance templates

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

Omitting sections preserves the definition. isActive false disables a maintenance
template; true reactivates it. All edits require an active property. Administrators
can still read templates belonging to inactive properties. Future guest/staff
flows must require both property and template to be active.

The version check and update are atomic. Stale requests return 409
STALE_TEMPLATE_VERSION; refetch and review before retrying. Submitting unchanged
values with the latest version returns the existing template without increasing
its version. Empty updates are rejected. New IDs or changed array order count as
changes. Creation and update use serializable transactions with bounded retries.

These APIs never write ChecklistSubmission or SubmissionRevision. Their captured
templates and history remain untouched. The current template row is versioned,
but this slice does not add a separate archive of every template edit. The later
submission slice must capture its template/version when a draft starts, so existing
drafts and submitted answers keep their original questions.

## List and errors

GET supports propertyId, type, isActive, search, page (default 1, max 100000), and
limit (default 20, max 100). Search matches template title or property name,
case-insensitively. isActive filters the template, not the property's activity.
Omitting filters includes all template types and activity states. Results order
by propertyId, type, then id and return { items, total, page, limit, totalPages }.
An empty result has totalPages 0. Every path/property ID must be UUID v4.

| HTTP | Code                                                     | Meaning                                      |
| ---- | -------------------------------------------------------- | -------------------------------------------- |
| 400  | VALIDATION_ERROR / INVALID_CHECKLIST_TEMPLATE_ID         | Invalid body, query, or path                 |
| 400  | EMPTY_UPDATE                                             | No editable field supplied                   |
| 400  | INVALID_CHECKLIST_SECTION_ID / INVALID_CHECKLIST_ITEM_ID | ID cannot be retained here                   |
| 400  | DUPLICATE_CHECKLIST_ID / CHECKLIST_TOO_LARGE             | Duplicate IDs or too many items              |
| 404  | PROPERTY_NOT_FOUND / CHECKLIST_TEMPLATE_NOT_FOUND        | Record does not exist                        |
| 409  | CHECKLIST_TEMPLATE_EXISTS                                | Property/type already configured             |
| 409  | PROPERTY_INACTIVE                                        | Property cannot be configured while inactive |
| 409  | GUEST_TEMPLATE_FIXED                                     | Guest templates are fixed after setup        |
| 409  | STALE_TEMPLATE_VERSION / CONCURRENT_UPDATE               | Conflicting update                           |

This slice adds no schema/migration, new test files, guest/staff authentication,
QR/public routes, photo uploads, submitted answers, guides, vehicle registration,
bulk property editing, or frontend. Jeju question content remains a configuration
input; Gyeongju vehicle registration is a separate feature.
