# Scheduled messaging (Slice 17)

Messaging is disabled by default. This implementation does not connect SOLAPI,
approve templates, apply database migrations, issue personal links, or send any
real messages during development verification. See `messaging.md` for the provider
and manual preview/send contracts.

## Delivery schedule

- Guest check-in: exactly 168 hours before the scheduled check-in instant.
- Guest checkout: the previous Korea calendar day, at the configured hour.
  The initial proposed hour is 15:00 KST; confirm it with the client before enabling.
- Staff: new cleaning tasks created after activation, and subsequently observed
  material task/assignee changes or cancellations. Existing tasks are baselined
  silently on initial activation.
- Guest changes/cancellations: changes observed after initial baselining while
  the stay has not ended. A cancelled stay gets cancellation text without a link.
- No staff overdue-reminder escalation or SMS fallback is enabled. The client's
  original request included SMS; the later AlimTalk-only question still needs an
  answer before the owner enables delivery.

A row scan runs about once per minute. It compares current material state; this is
not an event log of every edit. Multiple edits between scans become one notice of
the latest state. Starting/completing a staff check does not create a new assignment.
Past-due cleaning tasks remain actionable until cancelled/completed; their due
instant is not a checkout time. Reassignment uses the property's current active
staff member. An already delivered old staff QR/link is not recalled by a phone
edit; rotate the QR explicitly when access ownership changes.

## Configuration (server only)

Keep these disabled while the SOLAPI console/channel/templates are being prepared:

```text
MESSAGING_ENABLED=false
MESSAGING_TEMPLATES_APPROVED=false
MESSAGING_AUTOMATION_ENABLED=false
```

After owner approval and successful controlled delivery tests, set the existing
provider settings documented in `messaging.md`, all seven approved template IDs,
then choose:

```text
MESSAGING_AUTOMATION_ENABLED=true
MESSAGING_AUTOMATION_START_AT=<an explicit future ISO timestamp with timezone>
MESSAGING_CHECKOUT_REMINDER_HOUR=15
```

The automation start timestamp is a gate. The persisted first successful worker
activation is the no-backlog cutoff, so delayed rollout never blasts historical
notices. The worker requires all seven templates and the provider to be ready.
Re-enabling automation keeps the original persisted activation and pending state.

Reminders whose due instant precedes activation or the stay's creation are shown
as skipped/manual-only. Short-notice bookings need an administrator's explicit
preview and send. A one-hour grace window permits restart recovery; older overdue
jobs are skipped for manual review rather than sent unexpectedly. Blocked readiness
is retried within that window. Changing the schedule updates unsent reminders;
an already requested reminder is not sent again. A separate change notice handles
subsequent changes.

## Safety and durability

- Durable Prisma target/job rows and a renewable database lease coordinate workers.
- All due jobs are paged; a group of blocked jobs cannot starve later ready jobs.
- Existing committed dispatch attempts are recovered before reconciliation changes
  job status. A crash after provider submission cannot trigger a second submission.
- Stable event sequences distinguish repeated A-to-B-to-A changes at one task version.
- Recipient, schedule, source version and preview context are rechecked before a
  dispatch claim and again before provider I/O. Provider I/O is outside retried DB
  transactions. No exactly-once delivery claim is made: an ambiguous provider
  timeout remains unknown, with no automatic resend.
- Claims are permanent idempotency records. A confirmed failed delivery may be
  manually retried through a new confirmed preview; the automatic job does not
  blindly retry it.
- Prepared guest codes do not certify the physical lock was changed. No raw door
  passwords are placed in a message. Existing private links enforce their own
  disclosure windows; old legacy/unrecoverable/stale links block sending until an
  administrator prepares a usable current link.
- Phone/address/body/link/code values are not persisted in automation rows or logs.
  Recipients in dispatch history are masked. Material fingerprints are HMAC values.
- JWT-key rotation triggers one full baseline pass without broad change notices.
  Pending event notices are marked for manual review; future reminder schedules
  are rebuilt. Core deduplication is stable across JWT rotation.
- Accepted/SENDING and identifiable UNKNOWN provider results are polled in bounded
  batches while automation is enabled, for up to 72 hours. Failed lookup never
  resends a message or claims delivery. After that, use the manual history refresh
  and SOLAPI console. Manual refresh is also available when automation is off.

`MessageAutomationJob.COMPLETED` means that a dispatch attempt was recorded, not
that the recipient received it. Delivery truth is `MessageDispatch.status`:
SENDING / ACCEPTED / DELIVERED / FAILED / UNKNOWN. UI labels preserve this difference.

## Administrator UI

In **이용 일정 → 일정 상세 → 안내 메시지**, choose the kind and preview before
manual sending. Cleaning task details expose the same panel for the current staff
assignee. Automatic queue rows show their scheduled time, state and actionable
reason separately from delivery history. Loading or previewing never issues or
rotates a guest/staff link.

Endpoints, all administrator-only and no-store:

- `GET /admin/message-automation/stays/:id`
- `GET /admin/message-automation/tasks/:id`

These endpoints are read-only. Server deployment configuration controls activation.

## Migration and acceptance

The additive migration is generated with Prisma's offline schema diff. It creates
messaging enums and four messaging/automation tables. It does not modify existing
booking/checklist/photo data. It was not applied to any database.

After reviewing the diff, the user can apply pending local migrations with:

```sh
npx prisma migrate dev
npx prisma generate
```

Production uses `npx prisma migrate deploy` in the user's normal release process;
never use `migrate dev` in production. Restart the API after applying the schema.
No backfill command is needed; automatic baselining runs only after explicit activation.

Local verification uses fake Prisma/provider objects and mocked browser responses.
Before enabling real delivery, verify migrations on the intended database, exact
approved text/button variables, one controlled recipient, Korean schedule timing,
change/cancel readiness, provider result reconciliation and restart behavior in the
actual hosting environment. Console approval and real delivery are not established
by the local checks.
