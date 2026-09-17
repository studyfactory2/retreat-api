# Administrator issue categories

Categories are shared across properties. This module manages the existing
IssueCategory table; it does not change issue reports or their history.
Every handler requires an active ADMIN Bearer token and returns no-store and
no-referrer headers. Routes use GET/POST with no global /api prefix.

| Method | Route | Result |
| --- | --- | --- |
| GET | /admin/issue-categories | Paginated categories (200) |
| POST | /admin/issue-categories | Create an active category (201) |
| POST | /admin/issue-categories/:id/update | Update a category (200) |

## Listing

Optional query fields: search (trimmed, max 100 characters), isActive (exactly
true or false), page (default 1, max 100000), limit (default 20, max 100).
Omitting isActive includes both active and inactive categories. Search matches
part of the name, case-insensitively. Results sort by sortOrder, name and id,
all ascending. Rows and count share a repeatable-read database snapshot.

Response: { items, total, page, limit, totalPages }. Each item contains only:
id, name, sortOrder, isActive, isFallback, createdAt and updatedAt.
Date fields serialize to UTC timestamps with milliseconds.

## Creation and updates

Example creation body:

```json
{ "name": "냉난방", "sortOrder": 20 }
```

Names are trimmed, nonblank and at most 100 characters. sortOrder is an optional
JSON integer from 0 through 2147483647, defaulting to 0. New categories are active;
creation does not accept isActive. Name uniqueness follows the database's exact,
case-sensitive comparison, including inactive categories.

Example update body:

```json
{
  "expectedUpdatedAt": "2026-09-17T00:00:00.000Z",
  "name": "냉난방 시설",
  "sortOrder": 30,
  "isActive": false
}
```

Use the exact updatedAt returned by the latest category response, not the example
timestamp. At least one editable field is required. Optional fields may be omitted
but cannot be null. Boolean values must be JSON booleans; numbers must be JSON
numbers. Unknown fields are rejected. A stale expectedUpdatedAt returns 409
ISSUE_CATEGORY_CHANGED, so the client must reload before retrying.

Writes recheck the administrator inside a serializable transaction. A conditional
update and strictly increasing updatedAt prevent concurrent overwrites. A valid
no-op returns the existing category without changing its timestamp. Duplicates
return 409 ISSUE_CATEGORY_NAME_EXISTS and leave the existing data unchanged.

## Protected fallback and history

기타 is the shared fallback used when a checklist produces an abnormal-item issue.
The writer and category service use FALLBACK_ISSUE_CATEGORY_NAME from one shared
constant. The response identifies that row with isFallback: true.

- It cannot be renamed or deactivated.
- A normal category cannot be renamed into 기타.
- Its display order can change, and an inactive legacy row can be reactivated.
- If absent, it can be created through the ordinary create endpoint. Checklist
  issue creation also retains its existing lazy creation behavior.

These protected edits return 409 ISSUE_CATEGORY_FALLBACK_PROTECTED. No categories
are automatically seeded at startup. There is no hard-delete endpoint. Renaming
or deactivating a category preserves issue foreign keys and all previously
captured labels. Later administrator issue events capture the current label;
category changes themselves do not create issue events or a category audit trail.

Other errors include 400 VALIDATION_ERROR / INVALID_ISSUE_CATEGORY_ID / EMPTY_UPDATE,
401 UNAUTHENTICATED, 404 ISSUE_CATEGORY_NOT_FOUND and 409 CONCURRENT_UPDATE.

The guest-facing category list and standalone complaint/photo workflow remain a
separate slice. Existing checklist abnormalities continue to use 기타 rather than
automatically inferring a category from their text. No migration is required.
