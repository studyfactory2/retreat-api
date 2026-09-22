# Photos for guest problem reports

This adds optional photos to the existing guest reporting workflow. Photos are
stored privately in S3; PostgreSQL stores metadata, ownership and evidence links.
There is no guest account or public photo list. Checklist uploads remain separate.

## Routes and access

Every route requires Authorization: Bearer <current-property-guest-QR-token>.
Staff QR, administrator JWT and inactive/replaced guest QR credentials are rejected.

| Method | Route | Result |
| --- | --- | --- |
| POST | /guest/issues/photos | Upload one file; 201 |
| GET | /guest/issues/photos/:id/view | Temporary private viewing URL; 200 |
| POST | /guest/issues/photos/:id/remove | Remove an unsubmitted photo; 200 |

Upload multipart/form-data with exactly one `file` part and no other fields.
Do not set the multipart Content-Type manually in the browser; let FormData add
the boundary. Unsupported query/body fields are rejected. View/remove also require
X-Photo-Token: <token-returned-for-this-photo>. Remove accepts an empty body.
Keep both credentials out of URLs, logs and analytics. Responses use no-store and
no-referrer, including errors. CORS preflight allows these headers for configured
origins through the existing reflected-header policy.

Upload response:

```json
{
  "photo": {
    "id": "<photo-uuid>",
    "status": "READY",
    "filename": "bathroom.jpg",
    "contentType": "image/jpeg",
    "sizeBytes": 23456,
    "width": 1200,
    "height": 900,
    "createdAt": "2026-09-21T01:00:00.000Z"
  },
  "token": "<opaque-photo-token>",
  "expiresAt": "2026-09-22T01:00:01.000Z"
}
```

The server creates a random 32-byte token and stores only its SHA-256 digest,
bound to the photo ID and guest-issue-photo domain. The browser retains the photo
metadata, token and expiry with the pending report. Knowing a photo ID and scanning
the shared QR is insufficient to view/remove/claim it. Tokens are credentials;
there is no token recovery endpoint. A lost upload response requires uploading
again, leaving an expiring abandoned upload for later cleanup.

## Limits and storage

- Each input is at most 10 MiB and 40 million pixels.
- Only still JPEG, PNG and WebP are accepted; HEIC and animations are rejected.
- Actual file bytes are validated, independently of the declared MIME type.
- Images become JPEGs up to 2560 × 2560, preserving aspect ratio and stripping
  metadata such as EXIF/GPS. Original files are not retained.
- A report accepts up to 10 photos, in the supplied array order.
- READY unsubmitted claims expire after 24 hours. PENDING upload leases last
  five minutes; a stalled/expired upload cannot become ready afterward.
- Uploads are limited to 10/minute/IP; view/remove to 60/minute/IP per handler.
  Limits are per process. Checklist and complaint uploads share four in-flight
  upload slots and two concurrent image-processing slots.

S3 objects use the existing private bucket and photos/<propertyId>/issues/<id>.jpg
prefix. Database reservation precedes S3 upload; the READY transition rechecks
current QR access and the pending lease. Failed uploads mark the reservation
FAILED and attempt object deletion. Ambiguous database failures never delete
objects already marked READY.

## Preview, remove and submit

View returns {url, expiresAt}; the link lasts at most 120 seconds and never beyond
the unsubmitted claim lifetime at issuance. QR, token and unclaimed state are
checked again after signing. A previously issued URL may remain usable until
expiry after later removal, submission or QR rotation.

Remove marks an unclaimed row DELETED before deleting its S3 object. Repeating
remove with the same credentials can retry a failed S3 deletion until claim
expiry. Submitted, expired or foreign photos cannot be removed. The token digest
and original expiry are retained on deleted uploads for this retry behavior.

Submit the existing report body with this additional field:

```json
{
  "photos": [
    { "id": "<first-photo-uuid>", "token": "<first-photo-token>" },
    { "id": "<second-photo-uuid>", "token": "<second-photo-token>" }
  ]
}
```

Wait for each upload's READY response first. In the same serializable transaction
as Issue and REPORTED event creation, the server checks property, token, expiry,
READY state, valid JPEG metadata, and absence of existing report/checklist/import
links. It clears claim expiry and creates ordered evidence links atomically.
If any claim fails, the issue, event and all claim changes roll back.

The digest remains after submission solely to validate identical report retries.
The exact ordered IDs and their tokens must be resent with the same requestKey.
Changing the photo list/order returns 409 ISSUE_REQUEST_CHANGED; invalid, expired,
claimed-by-another-report or foreign credentials return 409 ISSUE_PHOTO_UNAVAILABLE.
Retries do not append links or delete/reupload objects. Omitted photos and [] are
equivalent for text-only reports. A report cannot acquire extra photos afterward.

The existing administrator issue detail/history exposes safe evidence metadata;
its authenticated photo-view endpoint signs bounded URLs. Raw token/digest/storage
fields are not added to administrator DTOs. Submitted evidence cannot be mutated
through guest upload routes, even by the uploader.

## Deployment follow-ups

No migrations, packages, default data, new test files or AWS policy changes are
required. Existing S3 permission for photos/* covers the new object prefix.
The manual [cleanup command](upload-cleanup.md) reconciles eligible abandoned
photos and rechecks all references before deletion. Scheduling remains separate. Never
apply blanket age-based S3 expiry to the issues prefix: submitted evidence lives
there too, and its claim expiry is null. Multi-instance throttling, trusted proxy
configuration, actual browser/device upload tests and live S3 verification remain
deployment/integration checks.
