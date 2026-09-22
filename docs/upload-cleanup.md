# Abandoned photo cleanup

This manual operator command is separate from HTTP features. No server timer,
scheduled job, administrator route or frontend action is installed.

## Setup and commands

The user creates/applies the two nullable Attachment columns and index:

```sh
npx prisma migrate dev --name add_upload_cleanup_tracking
```

Use the backend directory and its existing `.env`. The command uses DATABASE_URL,
AWS_REGION and S3_BUCKET_NAME, with the same AWS credential chain as photo uploads.
It uses ts-node, so this npm command requires the project's development dependencies.
For production, apply the reviewed migration through the deployment process first.

```sh
# Preview only: no database writes or S3 requests; default batch size is 100.
npm run uploads:cleanup

# Preview a smaller batch.
npm run uploads:cleanup -- --limit 25

# Explicitly delete eligible files and update their tracking rows.
npm run uploads:cleanup -- --execute --limit 25

# No configuration or database connection required.
npm run uploads:cleanup -- --help
```

Only --execute, --limit and standalone --help are accepted. Limit is an integer
from 1 to 500. Unknown, duplicate or incomplete options fail before configuration
loads. The command starts a Nest application context without an HTTP listener.

## Eligibility

Each run freezes a cutoff one hour before its start. This grace period exceeds
the normal upload timeout and allows slow work to settle.

Every candidate must be a PHOTO in the configured bucket, have no submission
revision photo, issue event photo or import-batch reference, and have no completed
storage-deletion marker. Checklist owners must still be DRAFT with revision zero
and no revisions. Non-checklist candidates must have an upload claim and no
authenticated uploader. These constraints protect historical owners even with
missing photo joins. IMPORT_SOURCE is always excluded.

| State | Additional condition |
|---|---|
| PENDING / FAILED | A non-null upload lease expired at or before the cutoff. |
| READY checklist photo | Its draft's private access expiry is at or before the cutoff. |
| READY complaint photo | Its unclaimed upload expiry is at or before the cutoff. |
| DELETED | Has deletedAt and either deletion predates the cutoff or a cleanup/recovery attempt already exists. |

Null/unknown expirations are not interpreted as expired. Photos from submitted or
cancelled checklist owners remain protected. Property or staff deactivation alone
does not make photos eligible.

Only exact server-generated keys are deleted:
`photos/<property UUID>/<submission UUID>/<attachment UUID>.jpg` or
`photos/<property UUID>/issues/<attachment UUID>.jpg`.
Unexpected keys produce UNSAFE_LOCATION without an S3 operation or status change.
Execute records their inspection time so they cannot block every later batch.
An operator must investigate them; the command never guesses a corrected key.

## Deletion, retries and races

Execute rechecks eligibility inside a serializable transaction and marks a photo
DELETED before requesting S3 deletion. The attachment row remains as a tombstone;
no submission, revision, issue, import source or business record is deleted.
Network operations run outside database transactions.

storageCleanupAttemptedAt advances monotonically as an attempt generation.
After S3 success, storageDeletedAt is written only if that generation still matches
and the photo remains unreferenced and DELETED. S3 failures, database acknowledgement
failures and interruptions retain work for another run. Completed markers exclude
already deleted files. Unique keys are never reused; repeat deletion is supported.

Both upload failure paths reopen deletion for unreferenced non-READY photos.
If a delayed upload finishes after cleanup, recovery clears storageDeletedAt,
advances the generation and tries deletion again. An older cleanup acknowledgement
cannot overwrite newer recovery. READY photos are preserved if their commit
succeeded but the upload handler lost its database response.

Runs read at most limit + 1 candidate rows and process at most limit, ordering
unattempted files first, then least-recent attempts. hasMore means another candidate
existed when the batch was read; it is not a live queue count. Run another preview
before continuing. Failed files can be retried on the next run; investigate
persistent failures instead of launching a tight unattended retry loop.

After the existing database startup message, the command prints JSON with mode,
cutoff, limit, scanned/deleted/skipped/failed counts, hasMore and attachment IDs
with reasons/outcomes. It omits names, filenames, tokens, buckets and storage keys.
PREVIEW means eligible at read time; execute always rechecks. CHANGED means
concurrent work prevented the claim or acknowledgement. Failures exit 1; other
completed runs exit 0. Runtime errors use generic messages.

## Completion boundary

This reconciles known database photo attachments. It is not an S3 inventory sweep,
historical evidence retention policy or import-source cleanup. Untracked objects
or a process terminated after an unusually delayed write can still need manual
reconciliation. With bucket versioning, ordinary deletion does not purge retained
versions. The marker confirms the deletion request, not erasure of every version.

Scheduling on EC2, retention decisions and live S3 integration remain deployment
work. Implementation verification does not execute cleanup against project data.
User-owned migrations and execution are separate.
