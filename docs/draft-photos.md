# Draft photos

Photos are uploaded through NestJS to a private S3 bucket. PostgreSQL stores
metadata and draft/property ownership in the existing Attachment table. This
gallery does not persist photo grouping. [Final submission](checklist-submissions.md)
now assigns item/cleaning-area purposes and preserves the original photo links.
No schema change or migration is required.

## Routes

Every route requires `Authorization: Bearer <private draft token>`. Shared QR
tokens and administrator JWTs cannot access this gallery. The existing expiry,
active-property, DRAFT status and current staff-assignment rules apply.

| Method | Route | Result |
| --- | --- | --- |
| POST | /submission-drafts/photos | 201 with the READY photo metadata |
| GET | /submission-drafts/photos | READY photos and upload limits |
| GET | /submission-drafts/photos/:id/view | Temporary private viewing URL and expiry |
| POST | /submission-drafts/photos/:id/remove | 200 with id and DELETED status |

Upload multipart/form-data containing exactly one `file` and no text fields.
Let the browser set the multipart Content-Type boundary. All other mutation
bodies are empty. Each route is limited to 60 requests/minute/IP per process.
At most four full uploads are accepted concurrently per process, with at most
two image transformations at once. Excess requests return 429 and can be retried.
Draft authorization runs before multipart buffering and is checked again during
service operations. No public object URLs, bucket paths or credentials appear in
photo metadata responses. Viewing URLs are short-lived bearer credentials: do
not log them, share them, or send them to analytics.

## Image rules

Initial implementation limits (not mandatory client photo counts):

- 10 MiB maximum input per image; 40 PENDING/READY photos per draft.
- JPEG, PNG and WebP actual image content; one frame and at most 40 million pixels.
- HEIC, GIF, SVG and other formats are rejected with a message to use supported
  images. Native iPhone HEIC conversion is not implemented.
- Orientation is normalized; images are resized to fit 2560 by 2560 without
  enlargement and encoded as JPEG quality 85. Embedded metadata is removed.
- The returned filename describes the original file; contentType, size, width,
  height and stored checksum describe the normalized JPEG.

The frontend should queue uploads with low concurrency, display each failure,
and let the user retry. A lost successful upload response can be reconciled by
listing the gallery before retrying; requests do not have an idempotency key.

## Storage and consistency

Upload reserves a PENDING record in a serializable transaction, including pending
reservations in the limit. Only the server chooses ownership and a unique key
under photos/<property>/<draft>/<attachment>. S3 receives the normalized bytes
and SHA-256 checksum outside the database transaction. A second transaction
rechecks draft access and changes PENDING to READY only after S3 succeeds.
Photo operations do not replace checklist answers or advance their edit timestamp.

Failed uploads are marked FAILED and storage cleanup is attempted. If a failure
response follows an already-committed READY state, cleanup preserves that photo.
Process termination or a cleanup/storage failure can leave abandoned records or
objects. The five-minute upload lease prevents their late finalization; an
operator can reconcile eligible files with the [cleanup command](upload-cleanup.md).
Expired PENDING reservations count until reconciled. Scheduling remains a
deployment follow-up.

Removal is allowed only from an accessible draft with no submitted-revision,
issue-event or import references. It marks the row DELETED before removing the
S3 object; the row remains for traceability. Repeating remove retries an S3
deletion that failed after the database update. Historical evidence is protected.

Viewing URLs last at most two minutes and are capped by the remaining draft
lifetime. Already-issued URLs can remain usable for their short lifetime even
after access changes. Successful object deletion also stops subsequent reads.
Photo grouping and immutable historical links are handled by the final-submission
slice. Draft gallery access closes after submission; a minimal completion receipt
remains available through the separate receipt endpoint.

## Configuration

Use the existing ignored backend .env with AWS_REGION and S3_BUCKET_NAME.
For local development, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY supply the
dedicated development user's credentials. Optional AWS_SESSION_TOKEN supports
temporary local credentials. Never place AWS secrets in React or Git.

The SDK uses its default credential chain. Production on EC2 should use an
instance role scoped to the production bucket and omit permanent credential
variables. The local development bucket is retreat-photos-dev in ap-northeast-2;
production uses a separate private bucket. Keep Block Public Access enabled,
ACLs disabled, and SSE-S3 encryption. Only s3:PutObject, s3:GetObject and
s3:DeleteObject for the bucket's photos/* prefix are needed for these operations.

Region/bucket must be configured together; without both, storage operations return
503 while other API features remain available. Startup does not test S3 access.
Uploads pass through NestJS, so browser-to-S3 upload CORS is not needed. Standard
image display can use the signed viewing URL; canvas/fetch uses may require S3
CORS later. Production proxy body/time limits must accommodate the bounded upload.

The package manifest overrides Multer to 2.3.0 to apply its multipart parser
security fixes while retaining NestJS 11. Revisit the override when the Nest
platform adapter itself depends on a patched Multer release.

References: [Nest uploads](https://docs.nestjs.com/techniques/file-upload),
[AWS S3 SDK](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html),
[Sharp output](https://sharp.pixelplumbing.com/api-output/).
