# Guest vehicle details

This slice collects one current vehicle plate per stay for the manager. It does
not submit plates to an external parking system or assert parking approval.

## Database and property setup

The user runs this migration before using the changed property or guest APIs:

```sh
npx prisma migrate dev --name add_stay_vehicles
```

Property gains vehicleRegistrationEnabled (default false). StayVehicle is an
optional one-to-one table keyed by stayId. Existing properties are disabled and
no vehicles are seeded. No migration is generated/applied by the assistant.

Existing administrator property create/update bodies accept optional strict
boolean vehicleRegistrationEnabled; reads include the flag. Enable Gyeongju via
the existing `POST /admin/properties/:id/update` with:

```json
{ "vehicleRegistrationEnabled": true }
```

Setting it false stops guest saves and hides the plate in guest vehicle reads,
but preserves existing data for administrator review. It does not cancel stays,
invalidate links or block checklist submission. No property-name matching or
hardcoded region rule is used. GET /guest/stays/current also includes this flag
under property, so the client can decide whether to display the vehicle form.

## Guest routes

- `GET /guest/stays/vehicle`
- `POST /guest/stays/vehicle` (200 on first save and later updates)

Both require `Authorization: Bearer <personal-stay-token>`. They accept no query
parameters. The token determines the stay; client-supplied stay/property IDs are
rejected. Shared guest/staff QR, administrator JWT and submission tokens do not
grant this access. Existing expiry/revocation/cancellation/inactive-property and
stay-revision checks apply in the guard and inside the service transaction.

Example GET response before any save:

```json
{
  "stayId": "<stay-uuid>",
  "property": { "id": "<property-uuid>", "name": "경주", "region": "경주" },
  "enabled": true,
  "version": 0,
  "plateNumber": null,
  "needsConfirmation": false,
  "updatedAt": null
}
```

POST requires both fields:

```json
{ "expectedVersion": 0, "plateNumber": "123가 4567" }
```

The response has the same shape with version 1, plateNumber "123가4567", and an
updatedAt timestamp. Subsequent saves send the returned version. To clear a plate,
send plateNumber null and the current version. Clearing keeps the row, increments
its version and records the current stay revision; absence of the field is invalid.
There is no vehicle deletion route, and null does not assert that the guest has
no vehicle. A lost-response retry should first GET the latest saved state.

Version must be an integer from 0 through 2147483646; numeric strings are rejected.
For a non-null plate, the API applies Unicode NFC, trims surrounding whitespace,
removes ordinary spaces and uppercases Latin letters. The result must be 3–20
characters drawn from digits, A–Z, Hangul syllables or hyphens, including at least
one digit. Internal tabs/newlines, markup, URLs and arbitrary punctuation are
rejected. These are input bounds, not verification of an officially issued plate.
The same plate may be used by different stays; it is not a person identifier.

Disabled properties return 200 with enabled false, plateNumber/updatedAt null and
needsConfirmation false. Guest saves return 409 VEHICLE_REGISTRATION_DISABLED.
Stale versions/concurrent first saves return 409 STAY_VEHICLE_CHANGED. Wrong or
expired links use the existing 401 INVALID_STAY_ACCESS error. Reads use
RepeatableRead; saves resolve the live parent and flag inside Serializable and
use conditional version writes. Plate values never enter static application logs.

## Stay changes and private access

Vehicle saves record Stay.currentRevision in StayVehicle.stayRevision without
changing Stay.currentRevision, StayRevision or the guest-link version. Thus a
plate correction does not invalidate the guest's invitation or checklist state.

Any later administrator stay change advances the stay revision and disables the
old invitation under existing rules. After a new invitation is issued, the guest
does not see a plate captured for a previous stay revision: plateNumber and
updatedAt are null. needsConfirmation is true if a non-null old plate exists and
collection is enabled. The vehicle version is still returned for safe replacement.
Even date/note-only stay edits require reconfirmation; this conservative behavior
also prevents leaking the prior guest's plate when guest details are changed.

Reissuing a link without changing the stay revision preserves the current plate.
The capability identifies the invited stay; it is not independent proof of who
typed the details. Vehicle versions protect editing; no full plate revision
archive is created, and a correction replaces the previous plate value.

## Administrator view

`GET /admin/stays/:id/vehicle` requires ADMIN and a UUID v4 stay ID. No queries
are accepted. Missing stay returns 404 STAY_NOT_FOUND.

It returns `{ stay, vehicle, needsReview }`. Stay includes ID, guestName, dates,
status, currentRevision and property id/name/region/isActive/vehicleRegistrationEnabled.
Vehicle is null before first save; afterward it includes plateNumber (nullable),
version, stayRevision, createdAt and updatedAt. needsReview is true only for a
non-cleared plate recorded against a different stay revision. Cancelled/inactive
stays and disabled properties remain visible to the administrator. The response
contains no invitation tokens, credentials, phone numbers or staff details.

Admin viewing lives in admin-stay-vehicles; guest reading/saving lives in
guest-stay-vehicles. Property settings stay in the existing properties feature.
All routes are GET/POST without /api. Privacy middleware sends no-store and
no-referrer on successful and error responses. Read limits are 60/min/IP/process;
guest saves are 20/min/IP/process. The reused GuestStayAccessGuard remains in
auth/guards. No public roster search, admin plate-edit screen, Excel plate export,
parking-provider integration or new test files are added in this slice.
