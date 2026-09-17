# Guest problem reports

Guests can report a problem during a stay independently of check-in/check-out.
This is the text-reporting slice; optional complaint photos are separate work.
There is no guest signup or login. The property QR identifies the property;
the submitted guest name is self-reported and does not verify a stay or identity.

## Access and categories

Use the token from the property's guest QR in the header:

```http
Authorization: Bearer <guest-qr-token>
```

This is the raw QR token, not an administrator JWT or checklist draft token.
Staff QR tokens, revoked guest QR tokens and inactive properties return 401
INVALID_QR. Every request rechecks the property. Tokens are never query parameters.
Responses, including errors, carry Cache-Control: no-store and
Referrer-Policy: no-referrer. Static route logs do not include report content.

GET /guest/issues/categories returns 200:

```json
{ "items": [{ "id": "<category-uuid>", "name": "온수" }] }
```

This small picker returns all active shared categories ordered by sortOrder,
name and id. It accepts no query parameters and exposes only id/name. Categories
are configured through the administrator endpoints; this route does not seed
defaults. An empty list means the administrator must activate/create a category.

## Submit a report

POST /guest/issues/report returns 200 for both first submission and matching
retries. Example body (replace the placeholder category ID):

```json
{
  "requestKey": "32621284-d907-40a1-9a69-71a898de62f6",
  "categoryId": "<category-uuid>",
  "guestName": "홍길동",
  "title": "욕실 온수가 나오지 않습니다",
  "description": "샤워기에서 찬물만 나옵니다."
}
```

- requestKey: a client-generated UUIDv4 for one report attempt.
- categoryId: an active category UUIDv4.
- guestName: trimmed, nonblank, maximum 100 characters.
- title: a short summary, trimmed, nonblank, maximum 300 characters.
- description: optional text, maximum 2000 characters after trimming. Omission,
  null or blank text all mean no description.

No propertyId, userId, role, status, urgency flag, raw snapshot, photo IDs or
other fields are accepted. The server gets the property from the QR and sets
NEW status, version 1 and server timestamps. It saves Issue + REPORTED IssueEvent
atomically, capturing the original category/property labels and guest name.
The actor has role GUEST, source GUEST_QR and no user ID. No User or Stay is created
or matched; all checklist source links remain null.

Response:

```json
{
  "issueId": "<issue-uuid>",
  "status": "RECEIVED",
  "property": { "id": "<property-uuid>", "name": "가평 휴양소" },
  "receivedAt": "2026-09-17T01:00:00.000Z"
}
```

RECEIVED acknowledges the original submission, not the current repair status.
The receipt omits names, report text, internal request keys and administrator
history. It is returned directly from POST; this slice adds no guest issue
listing, detail lookup, receipt lookup or private edit/view link.

## Retry behavior

Generate requestKey once before submitting and retain it with the pending form.
After an uncertain network result, resend the same key and normalized body.
Repeated taps and concurrent identical submissions return the same receipt,
with exactly one issue and one initial event. UUID casing is normalized; outer
whitespace is trimmed. The same key with different report content returns 409
ISSUE_REQUEST_CHANGED; this does not edit the original report. A genuinely new
report needs a new key. Distinct keys intentionally create distinct reports.

Keys are scoped to the property. Replays compare the immutable first event,
including category ID, guest name, title and description, before current category
activity is checked. Category rename/deactivation, property rename and subsequent
administrator notes/status updates do not change the original receipt. QR
replacement or property deactivation still revokes the old request access.
The key and property QR do not grant access to other guest reports or history.

## Administrator handoff and limits

New reports appear in the existing /admin/issues list/detail/history APIs, with
the submitted name and original text available to the administrator. Existing
notes and NEW → IN_PROGRESS → RESOLVED management apply. No external notification
or automatic SMS/Kakao message is sent.

Both routes use ThrottlerGuard: categories 60/minute/IP and reports 10/minute/IP
per API process and handler. Invalid requests and retries also consume this
allowance. Rate-limit responses are 429; production proxy/shared-limit setup
remains a deployment task.

Expected errors include 400 VALIDATION_ERROR, 401 INVALID_QR,
409 ISSUE_CATEGORY_UNAVAILABLE / ISSUE_REQUEST_CHANGED / CONCURRENT_UPDATE,
and 429 TOO_MANY_REQUESTS. Stored-record inconsistencies return a safe 500.
No schema changes, migrations or new packages are required. Photo support will
reuse image processing and private S3 storage with complaint-specific ownership;
the current checklist draft photo routes must not be used for arbitrary reports.
