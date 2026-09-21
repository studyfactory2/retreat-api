# Administrator staff and property APIs

These endpoints implement the property/staff management slice. All require the
existing active administrator's `Authorization: Bearer <token>` header. Routes
use GET/POST only and have no `/api` prefix. Each handler declares its own
`@Roles(Role.ADMIN)` and `@UseGuards(RolesGuard)` decorators and logs only a static
action name. Responses have `Cache-Control: no-store`.

Staff routes are owned by AdminUsersModule/Controller/Service in
src/components/admin-users. UsersModule retains login and current-profile routes;
PropertiesModule retains property management and staff assignment.

## Routes

| Method | Path | Result | Success |
|---|---|---|---|
| POST | /admin/staff | Create an active STAFF profile | 201 |
| GET | /admin/staff | Paginated staff list | 200 |
| GET | /admin/staff/:id | Staff details with assigned properties | 200 |
| POST | /admin/staff/:id/update | Edit or activate/deactivate a staff profile | 200 |
| POST | /admin/properties | Create an active, unassigned property | 201 |
| GET | /admin/properties | Paginated property list | 200 |
| GET | /admin/properties/:id | Property details with assigned staff | 200 |
| POST | /admin/properties/:id/update | Edit or activate/deactivate a property | 200 |
| POST | /admin/properties/:id/staff | Assign or unassign staff | 200 |

All path IDs must be UUIDs. Unsupported methods do not mutate records.
The existing `/users/login` and `/users/me` routes retain their behaviour.

## Staff inputs

Create with `POST /admin/staff`:

```json
{
  "name": "정비 담당자",
  "phone": "010-0000-0000",
  "company": "관리업체",
  "department": "정비팀"
}
```

Only name is required. Names are trimmed, nonblank, and at most 100 characters.
Phone is at most 32 characters; company/department are at most 100. Optional text
may be omitted or null; blank optional text becomes null. Phone is a contact
string, not a verified or unique identifier.

The server sets role STAFF and isActive true. Role, loginId, password, passwordHash,
and other fields are rejected. This creates a profile, not a staff login account.

Update with `POST /admin/staff/:id/update`:

```json
{ "name": "변경된 담당자", "phone": null }
```

The same profile fields and a JSON boolean `isActive` are accepted. Omitted fields
remain unchanged; null/blank clears optional text. Name cannot be null or blank.
An empty update and `isActive: null` or `"false"` are invalid.

To deactivate, send `{ "isActive": false }`. This returns 409
`STAFF_HAS_ASSIGNMENTS` while any property still references the worker, including
inactive properties. Unassign or reassign those properties first. Reactivate with
`{ "isActive": true }`. Administrator/guest IDs are not valid staff targets.

## Property inputs

Create with `POST /admin/properties`:

```json
{ "name": "제주 애월 1호점", "region": "제주" }
```

Name is required, trimmed, nonblank, and at most 100 characters. Region is optional,
nullable, and at most 100 characters. Exact duplicate property names return 409
`PROPERTY_NAME_EXISTS`; inactive properties still reserve their names. Property
creation always starts active and unassigned. Use the assignment route next.

Update with `POST /admin/properties/:id/update`:

```json
{ "name": "제주 애월 1호점", "region": "제주", "isActive": true }
```

At least one field is required. Null/blank clears region; name and isActive cannot
be null. Deactivation preserves the property, staff assignment, and all operational
records. It does not automatically cancel visits or resolve issues.

Assign with `POST /admin/properties/:id/staff`:

```json
{ "staffUserId": "<staff UUID returned by the staff API>" }
```

The property and worker must be active, and the worker must have role STAFF.
One worker may cover several properties; each property has one current assignee.
The response returns the updated property and a safe staff summary.

Unassign using the same route:

```json
{ "staffUserId": null }
```

The field is required: omitting it or sending an empty string is invalid.
Unassignment also works for inactive properties. An administrator's or guest's ID
is rejected as `STAFF_NOT_FOUND`; an inactive worker gives `STAFF_INACTIVE` (409).
Assigning to an inactive property gives `PROPERTY_INACTIVE` (409).

## Lists and responses

Both list routes accept `page` (default 1, maximum 100000), `limit` (default 20,
maximum 100), `search` (up to 100 characters), and `isActive=true|false`.
Omitting isActive includes both active and inactive records. Query booleans accept
only literal true/false; pagination uses positive decimal integers. Arrays,
unknown query fields, and malformed values are rejected.

Staff search matches name, phone, company, or department. Property search matches
name or region; property lists also accept `region` (case-insensitive exact match)
and `staffUserId` (UUID). Search is case-insensitive. Lists are ordered by creation
time descending, then ID descending, and return:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "totalPages": 0
}
```

Example: `GET /admin/properties?page=1&limit=20&isActive=true&region=제주`.
The frontend should URL-encode query parameters. Out-of-range pages return an
empty items array with the actual total and totalPages.

Staff responses contain id, name, role, phone, company, department, isActive,
createdAt, updatedAt, and assignedProperties (id, name, region, isActive).
Property responses contain id, name, region, isActive, staffUserId, createdAt,
updatedAt, and staff (id, name, phone, isActive) or null. Dates serialize as ISO
strings. Credentials, tokens, and QR hashes are never returned.

## Validation and completion boundary

Invalid input returns 400, missing staff/properties return 404, and documented
business conflicts return 409 with Korean messages. Missing/invalid administrator
authentication returns 401. Role restrictions still apply independently of the
URL prefix. There are no public staff/property mutation routes or DELETE routes.

Assignment and deactivation validate and write in serializable transactions so
competing requests cannot leave an inactive worker assigned. Serialization
conflicts retry up to three attempts, then return 409 `CONCURRENT_UPDATE`.

No schema changes, migrations, staff login, guest verification, QR issuance,
Excel import, checklists, uploads, or frontend changes belong to this slice.
