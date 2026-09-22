# Property usage guides

One optional plain-text guide belongs to one property. Administrator and guest
routes live in separate feature modules. They use GET/POST and no /api prefix.
The existing QR/stay response contracts are unchanged; the frontend loads the
guide separately when the guest opens the guide screen.

## Database setup

PropertyGuide is a new table; existing records require no backfill. The user runs:

```sh
npx prisma migrate dev --name add_property_guides
```

Do this before calling the new guide routes. Prisma client generation alone does
not create the table. No migration is generated or applied by this slice.

## Administrator

Both routes require the existing ADMIN Bearer token:

- `GET /admin/properties/:id/guide`
- `POST /admin/properties/:id/guide` (200 for both first save and later updates)

No query parameters are accepted. The property ID must be a UUID v4. Missing
property returns 404 PROPERTY_NOT_FOUND. GET returns `{ property, guide }`, where
property contains id/name/region/isActive, and guide is null before the first save.
An existing guide contains title/content/isPublished/version/updatedByUserId and
createdAt/updatedAt timestamps.

POST fully replaces the guide with:

```json
{
  "expectedVersion": 0,
  "title": "휴양소 이용 안내",
  "content": "입실 후 시설 상태를 확인해 주세요.\n퇴실 전 사용한 물품을 정리해 주세요.",
  "isPublished": false
}
```

Use expectedVersion 0 only when guide is null; afterward send the current guide
version. A successful first save creates version 1; every subsequent save
increments it, including changes to publication. Stale or concurrent first saves
return 409 PROPERTY_GUIDE_CHANGED instead of overwriting a newer guide. After a
lost response, GET the current guide before retrying the save. Saves recheck the
active administrator inside a serializable transaction.

All four fields are required. Title is trimmed, nonblank and at most 100 Unicode
characters, with no internal newline. Content is trimmed, nonblank and at most
20,000 Unicode characters; CRLF/CR becomes LF. NUL characters are rejected. The
version is a JSON integer from 0 to 2147483646; isPublished is a JSON boolean.
Nulls, unexpected fields and string coercions are rejected.

Unpublish by saving the same title/content with isPublished false and the current
version. There is no separate delete endpoint or revision archive for guides.
An unpublished guide keeps its text for the administrator but is hidden from
guests. Editing a published guide with isPublished true updates the visible
content immediately; no parallel draft/published copies exist. Inactive
properties may be prepared by an administrator, but cannot be accessed by guests.

## Guest access

- `GET /guest/property-guides/qr`: Bearer token from the guest property QR.
- `GET /guest/property-guides/stay`: Bearer token from the private stay link.

Neither route accepts a property ID, stay ID, token in the query string, or any
other query parameter. Each uses only its designated token resolver; staff QR,
administrator JWT and submission receipt tokens cannot substitute for guest
access. Invalid/rotated QR tokens and inactive properties are rejected. Private
links also reject expiry, revocation, cancellation and stay-revision mismatches
under the existing StayAccessService rules.

Authorization and the property-scoped published-guide read share one
RepeatableRead transaction. Return shape:

```json
{
  "property": { "id": "<property-uuid>", "name": "휴양소", "region": "부산" },
  "guide": {
    "title": "휴양소 이용 안내",
    "content": "입실 후 시설 상태를 확인해 주세요.",
    "version": 2,
    "updatedAt": "2026-09-22T01:00:00.000Z"
  }
}
```

Missing and unpublished guides both return 200 with `guide: null`. The frontend
can display "등록된 이용 안내가 없습니다." without revealing draft content. Guest
responses omit admin identities, publication state, guest details and credentials.
The latest published text is shown; reading does not record acceptance or a
historical snapshot.

Both kinds of guest link grant the same published guide access. Guides are for
general instructions; do not put private guest data or restricted entry codes
in this shared content. Those would require a separate access contract.

## Frontend and operations

Render title/content as escaped text (for example React text children with
`white-space: pre-wrap`), never innerHTML or executable Markdown. There is no HTML
rendering, PDF upload, remote fetch, link preview or rich text in this slice.

All guide routes set Cache-Control: no-store and Referrer-Policy: no-referrer,
including errors. Guest reads and admin reads are limited to 60/minute/IP/process;
admin saves to 20/minute/IP/process. Production proxy/multiple-instance handling
follows the existing application deployment rules. Tokens and guide text are
never included in static route logs.

The client still needs to supply final guide wording. Guest phone UI and live
deployment verification follow frontend integration.
