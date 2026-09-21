# Guest submitted checklist viewing

Guests can reopen one completed check-in/out checklist using the private
`accessToken` returned when its draft was created. The frontend retains this token
from the saved `/draft#token=...` link and sends it in the Authorization Bearer
header. A property QR or parent stay invitation cannot replace this token.

This is a read-only slice. It adds no editing, history browsing, token recovery,
list endpoint, frontend screen, messaging, schema change or migration.

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /guest/submissions/current | Read this token's completed guest checklist |
| GET | /guest/submissions/photos/:id/view | Request a private photo viewing URL |

Both return 200, reject unknown query fields, and use no-store/no-referrer headers
on successes and errors. Both have a 60/minute per-IP, per-process throttle.
Photo IDs must be UUID v4. Authorization is enforced in the guard and again in
the service's read transaction.

## Access and response

Only SUBMITTED CHECK_IN/CHECK_OUT records with GUEST_QR or PRIVATE_LINK origin
are eligible. Drafts, cancelled records, staff maintenance records, expired
credentials and inactive properties are denied. For linked stays, the existing
parent invitation checks still apply: replacement/revocation, expiry, cancellation
and stay revision changes block access. Possession of the private token authorizes
one record; names and supplied IDs never grant access.

`current` returns id, type, status, revision, captured property labels, visitDate,
guest {name,company,department,phone}, captured template and answers, submittedAt,
updatedAt, expiresAt, and photo metadata. Answers include their saved descriptions
and general note. Current property/template/profile edits cannot replace this
captured wording. The latest committed submission revision is checked against its
parent record; malformed stored records fail with the shared safe 5xx response.

Photo metadata includes id, filename, JPEG size/dimensions, createdAt, purpose,
sectionId, itemId, areaLabel and sortOrder. No raw snapshots, storage locations,
credential digests, request hashes, account IDs, administrator notes or actor
history are exposed. Photo metadata itself does not contain a signed URL.

## Private photo access

A photo must occur in both the saved revision snapshot and its persisted photo
associations, with matching order/grouping, submission/property ownership and a
READY PHOTO attachment. Unsubmitted uploads and other submissions' photos cannot
be signed. A valid token with an unrelated photo ID receives 404.

The view route returns {url,expiresAt}. URLs last at most 120 seconds, further
capped by the checklist token's remaining lifetime. After signing, the service
rechecks authorization, parent invitation, current revision, association and
storage location before returning the URL. A revocation during signing therefore
prevents delivery. A URL already delivered can remain usable for its short signed
lifetime; changing a database token does not revoke an existing S3 signature.

## Source organization and compatibility

GuestSubmissionsModule owns the controller/service and provides
GuestSubmissionAccessGuard, whose file is under auth/guards. It imports the existing
SubmissionDraftsModule for scoped access resolution and StorageModule for signing.
The immutable snapshot parser and record types are shared under libs; the guest
feature never imports an administrator controller/service/module. The parser's
validation behavior and administrator response contracts are unchanged.

Existing submission receipts, draft mutations and administrator history remain
available through their existing routes. Submitted guest corrections are a later
slice because they must preserve revisions, evidence and related issue history.
