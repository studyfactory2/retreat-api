# Slice 14: staff cleaning tasks

## Operator flow

Administrators open **청소·정비 → 정비 작업**. A reservation created or changed
through the existing manual or Excel-import flows synchronizes one automatic
cleaning task for its departing stay in the same transaction. Administrators can
add a manual task, reschedule unfinished work, or cancel with a reason. The current
property assignee handles the task; this feature adds no staff login or per-task
assignee. New tasks require an active property. Starting requires an active
assigned staff profile and maintenance checklist.

For reservations that predate deployment, **일정 동기화** initializes tasks whose
checkout is today or later in Seoul. Staff task refresh also synchronizes that
property through an explicit POST. Historical checkouts are not represented as
newly completed work. Existing unfinished tasks remain eligible for reconciliation
even when overdue. Synchronization is bounded to 200 reservations per request and
rejects before writes if exceeded; administrators should select one property.
No GET request creates tasks. There is no background scheduler in this slice.

Staff scan the existing property staff QR, choose a task, confirm the assigned
staff name, and start or resume:

1. Complete the existing checklist. Its original template version stays pinned.
2. Upload at least one completed-work photo and identify it as **정비 후**.
   Before, defect and repair photos retain their existing optional behavior.
3. Verify the premises are vacant, physically change the door-lock code where
   needed, and confirm **비밀번호 변경 완료** before final submission.

A task cannot begin before its due time or the departing booking's checkout.
Current scheduled occupancy also blocks start, reveal and completion. Scheduled
times are not evidence that a person actually left; the staff confirmation is a
manual attestation. The system does not operate or electronically verify a lock.

The **추가 정비 기록** secondary entry and existing private draft links remain
compatible. A generic record does not complete a scheduled task or grant access
to its password. Existing standalone maintenance submission rules are unchanged.

## Which password is used

The departure that creates a task and the next stay that supplies its password
are different relations. The earliest active next reservation is selected after
the departing checkout (after the scheduled due time for a manual task):

- Rotating property with a next stay: use its prepared Slice 13 code, including
  all existing contact/name/restoration/neighbor-code review checks.
- Rotating property without a next stay: use its configured vacancy code.
- Fixed property: show **변경 불필요 · 고정 번호**. No change checkbox or code
  reveal is required; the vacant-premises confirmation still applies.
- Missing settings/code or a code requiring review: show **관리자 확인 필요**.
  Checklist answers and photos remain saved, but final completion is blocked.

For rotating properties, a next stay whose check-in time has already passed
blocks that old task's password operation; it is not skipped in favor of another
future stay. The administrator must review the schedule and create appropriate
follow-up work. Updating a planned code does not mean the physical lock changed.
Guest disclosure and AlimTalk/SMS delivery are outside this slice.

## Resume, concurrency and evidence

Authorized QR resume rotates the private working token for the same draft and
renews its lifetime. The previous token is revoked; checklist version, saved
answers and uploaded photos remain. As in the existing photo workflow, photo
purpose/location choices are finalized at submission and need reselection after
reopening. If the assignee changed, a new authored attempt is created; the old
attempt and photos remain retained and inaccessible to its old working link.

A fingerprint binds confirmation to the task/version/due time, departure and
next-stay revisions, code/settings versions, assignee, and current QR generation.
It contains no password. Server-side validation is repeated in the same
serializable transaction as final checklist revision, attachment references,
issues and task completion. Changing any bound state invalidates stale completion.
A failed transaction does not leave a completed task or partial submission.

At least one READY after-cleaning attachment, all required checklist answers and
applicable confirmations are enforced on the original submit endpoint too.
Submitted retries use the original request hash and revision-one receipt; they do
not run a new lock operation against later code settings. Different replay inputs
conflict. Completed task evidence is immutable and stores versions/identities and
staff attestation metadata, never code digits.

Completed tasks display **확인 필요** when relevant booking/settings/code state or
the linked submitted record changes. This is a follow-up signal, not a rewrite of
history. Administrators can inspect the submitted record and add a manual task.
Automatic schedule cancellation can restore an unfinished task when the booking
is restored. An explicit administrator task cancellation is not auto-reversed.

## Access and retained photos

Every task list/start validates the current active property staff QR and active
assignee. Every task-linked private draft/photo/submit/code request additionally
validates the current attempt and QR generation. Guest QR, administrator JWT and
generic private-draft credentials do not substitute for a staff task credential.
A shared staff QR establishes property access, not proof of a person's identity.
Keep QR images and working links within the assigned staff group.

Codes are absent from lists, drafts, completion JSON, logs and URL query strings.
Only explicit private reveal returns plaintext, with no-store/no-referrer headers
on success and error paths. The client masks it, hides it after 30 seconds and on
blur/navigation, and clears confirmations when returning or refreshing context.
It does not persist codes in browser storage. Existing private photo delivery and
processing are reused; app bearer credentials are not sent to photo hosts.

READY task-linked photos are excluded from cleanup based only on expired private
credentials, including work waiting on a changed/cancelled schedule. Existing
pending/failed/explicitly-deleted cleanup rules remain. No cleanup job was run as
part of implementation. Retained evidence still needs the existing storage backup
and access controls; this slice does not modify AWS or transport configuration.

## Migration and deployment

`20261103060000_add_cleaning_tasks` was generated with installed Prisma 5.22.0
using schema-to-schema `prisma migrate diff --script`. It adds task enums/table,
nullable draft linkage and QR-generation fields, indexes, and same-property
foreign keys. SQL was not manually authored. Existing submission snapshots and
credentials are not rewritten. No data backfill or account creation is needed.

The migration was generated and Prisma Client regenerated in an isolated copy.
No development or production database was contacted or migrated. The user applies
the checked-in migration before starting the updated API:

```sh
# Local development, in retreat-api
npx prisma migrate dev
npx prisma generate

# Production release, under the existing deployment procedure
npx prisma migrate deploy
npx prisma generate
```

Do not create another migration with a new name for the already generated schema
change. Deploy API/schema before the frontend, then use task synchronization for
existing current/upcoming reservations. Existing keyring configuration from
Slices 12/13 must remain available. Git commits and deployments remain user-owned.

## Verification boundaries

Build/type/lint, isolated service/HTTP probes and responsive browser fixtures are
local evidence. They do not establish live PostgreSQL concurrency, real S3
upload/download, actual lock changes, EC2 deployment, or physical-device behavior.
The acceptance checks should include:

- Today/future booking sync, cancellation/restoration and manual rescheduling.
- Same task resume with saved answers/photos after token expiry or QR rotation.
- Required AFTER photo; missing/reviewed next code; vacancy and fixed modes.
- Change a booking/code while staff review is open: final submission must conflict
  and retain work until the updated state is confirmed.
- Complete once, retry safely, then correct/cancel the submitted record and verify
  the task's historical evidence remains with a review indicator.
