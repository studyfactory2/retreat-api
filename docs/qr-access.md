# Property QR access

The backend issues secure links and resolves their property/flow. The future React
frontend renders each link as a printable QR image. This slice does not render QR
images or implement guest/staff forms, uploads, personal stay links, or submissions.

## Administrator routes

These routes use the existing administrator Authorization: Bearer <JWT> header.
Each controller handler explicitly requires ADMIN and RolesGuard.

| Method | Route | Purpose |
|---|---|---|
| GET | /admin/properties/:id/qr | Current guest/staff issuance status |
| POST | /admin/properties/:id/qr/guest/rotate | Issue or replace guest link |
| POST | /admin/properties/:id/qr/staff/rotate | Issue or replace staff link |

All successful responses are 200. IDs are UUID v4. GET returns propertyId,
propertyIsActive, and guest/staff { issued, enabled, rotatedAt }. It never returns
a raw token, digest, or previous URL. enabled means the property is active and that
QR has been issued; it does not imply staff/checklist configuration is complete.

Each POST requires exactly this body for first issuance:

```json
{ "expectedRotatedAt": null }
```

For replacement, copy the corresponding rotatedAt from the latest status:

```json
{ "expectedRotatedAt": "2026-09-16T01:00:00.123Z" }
```

That timestamp is an example, not a real QR revision. The field is required,
nullable only for never-issued QR, and otherwise exact UTC ISO with milliseconds.
Stale or competing requests return 409 STALE_QR_CODE. Refetch status and explicitly
decide whether replacement is still intended; do not blindly retry credential
rotation. Timestamps advance monotonically, including replacements in one
millisecond. The check and write run in one serializable transaction.

The POST response is { propertyId, flow: GUEST|STAFF, url, rotatedAt }. Only this
response exposes the usable link. Save/download/print it at this point. Only a
SHA-256 digest is stored, so the server cannot redisplay an existing link later.
If the saved QR is lost, replacement invalidates the previous printed copies.
Replacing guest QR leaves staff QR unchanged, and vice versa.

Issuance requires an active property. Deactivation suspends both QR links without
erasing them; reactivation makes the same links usable again. To permanently
replace an old link, rotate it. There is no separate disable endpoint in this slice.

## Browser links and API access

FRONTEND_URL configures the destination origin. Local development defaults to
http://localhost:5175. Production requires an explicitly configured HTTPS origin.
Credentials, paths, query strings, fragments, and wildcard hosts are not accepted.
It is separate from CORS_ORIGINS; include the frontend origin in that allowlist too.
For example, using a frontend origin of
https://retreat.example would produce these frontend routes:

```text
https://retreat.example/guest#token=<random-guest-token>
https://retreat.example/staff#token=<random-staff-token>
```

The fragment is not sent in ordinary HTTP URL requests or referrers. The frontend
must read it, keep it out of analytics/error telemetry, and send its token in the
Authorization header to the corresponding API route:

```text
GET /qr/guest
Authorization: Bearer <guest-QR-token>

GET /qr/staff
Authorization: Bearer <staff-QR-token>
```

These are opaque property QR credentials, not administrator JWTs. A guest token
cannot resolve staff context or access admin APIs. Each token contains 32 random
bytes, encoded as 43 base64url characters. The stored hash includes the flow name.
Tokens are not accepted from request bodies, URL parameters, or query strings.
There is no guest/staff account login in this flow.

## Safe context response

Both responses contain flow, property { id, name, region }, and active checklists
{ id, type, title, version, definition }. Guest context includes only CHECK_IN and
CHECK_OUT. Staff context includes only MAINTENANCE plus assignedStaff { id, name }
or null. Assignment is returned only for a currently active STAFF profile.

No roster, stay details, phone numbers, guest names, passwords, administrator
profiles, QR digests, historical submissions, or issue records are returned.
Only the property attached to the supplied token is resolved. Supplying a property
ID in a query cannot change that scope.

Missing/inactive templates result in an empty or partial checklist array. Missing,
inactive, or invalid staff assignment results in assignedStaff null. Links can be
printed before configuration is complete; the future UI must explain unavailable
forms rather than claiming a job can be submitted. This is assignment context,
not proof that the named worker is holding the phone. Actual identity confirmation
and attribution are part of the future submission flow.

Reads use one repeatable-read transaction to keep context internally consistent.
Every future write must independently validate the QR, active property, appropriate
template, and staff assignment; a previous context response is not a permanent
authorization grant. Reassignment updates future context without altering past
records. Template changes affect future context and do not rewrite submissions.

## Errors and operational limits

Missing/malformed/unknown/wrong-flow/replaced tokens and inactive properties all
return the same 401 INVALID_QR response. Admin missing properties return 404
PROPERTY_NOT_FOUND; inactive-property issuance returns 409 PROPERTY_INACTIVE.
Invalid admin bodies/IDs return 400; stale issuance returns 409 STALE_QR_CODE.
Exhausted serializable retries return 409 CONCURRENT_UPDATE.

Public context routes are limited to 60 requests/minute/IP per endpoint using the
existing in-memory Nest throttler. It is per process; production proxy/IP handling
and shared multi-instance limiting remain deployment work. Login retains its
existing separate 10/minute policy.

QR middleware sets Cache-Control: no-store and Referrer-Policy: no-referrer before
guards and handlers, covering authentication and business failures as well as
success. Controller logs contain static action names only. Never log Authorization
headers or issuance response bodies/URLs in frontend, server, or proxy tooling.

No new table, migration, dependency, QR image file, automatic message delivery,
guest private link, guide, vehicle registration, upload, or submission is added.
Existing per-submission privateTokenHash fields are separate from property QR.
Guest stay invitations still require their own design and implementation.
