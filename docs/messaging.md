# Slice 16 messaging foundation

Administrator messaging uses fixed Korean AlimTalk drafts for guest reservations
and cleaning tasks. Sending and template approval both default to disabled.
Console/channel/template approval and a live controlled delivery check are still
required before enabling production. SMS fallback is not implemented; every
provider request explicitly sets `disableSms: true`. The client's SMS decision
remains pending.

## Server configuration

No secrets, template IDs, channel IDs or provider responses are returned to the
browser. No `.env.example` is provided. Configure these on the API server later:

| Setting | Default / meaning |
| --- | --- |
| `MESSAGING_ENABLED` | `false`; explicit `true` enables eligible sends |
| `MESSAGING_TEMPLATES_APPROVED` | `false`; set `true` only after the exact content, variables and buttons below are approved for the configured channel |
| `SOLAPI_API_KEY`, `SOLAPI_API_SECRET` | Server-only SOLAPI credentials |
| `SOLAPI_PF_ID` | Approved Kakao channel profile |
| `SOLAPI_SENDER` | Optional registered numeric sender; no SMS fallback uses it |
| `SOLAPI_TEMPLATE_GUEST_CHECKIN` | Approved entry template ID |
| `SOLAPI_TEMPLATE_GUEST_CHECKOUT` | Approved checkout template ID |
| `SOLAPI_TEMPLATE_GUEST_CHANGE` | Approved reservation-change template ID |
| `SOLAPI_TEMPLATE_GUEST_CANCEL` | Approved reservation-cancellation template ID |
| `SOLAPI_TEMPLATE_STAFF_ASSIGNMENT` | Approved cleaning-assignment template ID |
| `SOLAPI_TEMPLATE_STAFF_CHANGE` | Approved cleaning-change template ID |
| `SOLAPI_TEMPLATE_STAFF_CANCEL` | Approved cleaning-cancellation template ID |

The status route describes local configuration only. It does not verify provider
balance, console approval, channel operation, delivery, or the actual door lock.
Global `ready` means all seven templates are configured. A preview's `canSend`
checks its own template and current domain conditions. Missing another template
does not block an otherwise ready manually selected kind.

Automation configuration and release boundaries are in
[message-automation.md](message-automation.md). The common environment
validator preserves `MESSAGING_AUTOMATION_ENABLED` as a string (`false` by
default), `MESSAGING_AUTOMATION_START_AT` as an optional strict ISO timestamp with
timezone, and `MESSAGING_CHECKOUT_REMINDER_HOUR` as a 0–23 string (`15` by default).
Automation requires an explicit start timestamp before it can be enabled.

## Administrator API

All handlers explicitly require ADMIN and RolesGuard. Responses are `no-store`.
Preview and send accept no caller-selected phone number, message text, link,
provider configuration, mode, or delivery status. Unknown body/query properties
are rejected by the shared validation pipeline. Send and refresh are throttled.

| Route | Input / result |
| --- | --- |
| `GET /admin/messaging/status` | Local readiness, safe blockers and per-kind configured booleans |
| `GET /admin/messaging/stays/:id` | Guest kinds and latest 30 dispatch receipts |
| `GET /admin/messaging/tasks/:id` | Staff kinds and latest 30 dispatch receipts |
| `POST /admin/messaging/stays/:id/preview` | `{kind}`; recipient name/masked phone, body, buttons, blockers, warnings and preview key |
| `POST /admin/messaging/tasks/:id/preview` | Same for a cleaning task |
| `POST /admin/messaging/stays/:id/send` | `{kind, requestKey: UUIDv4, previewKey}`; dispatch receipt |
| `POST /admin/messaging/tasks/:id/send` | Same for a cleaning task |
| `POST /admin/messaging/dispatches/:id/refresh` | `{}`; refreshes a known provider message ID, never resends |

Contracts: `src/libs/dto/messaging/messaging.ts` and `messaging.input.ts`.
Preview body/buttons contain the actual existing private link in the transient
administrator response. They must not be persisted in browser storage, analytics,
client logs or screenshots used as fixtures. Dispatch history contains only
masked-recipient metadata, status, safe error code and timestamps.

A preview key is a signed fingerprint valid for ten minutes. Sending checks the
latest recipient, subject version, property/assignee state, content, link,
prepared-code metadata and configured provider/template routing. The request key
is scoped to subject/kind and looked up before preview expiry checks; retrying an
uncertain original request returns the original receipt even after the domain
changes. A reused key for another subject/kind returns
`MESSAGE_REQUEST_KEY_CONFLICT`. An expired/changed preview returns
`MESSAGE_PREVIEW_CHANGED`; current readiness failures return `MESSAGING_BLOCKED`.
An existing pending/accepted/delivered/unknown equivalent event returns
`MESSAGE_ALREADY_REQUESTED` for a different request key.

## Domain and privacy guarantees

Guest check-in, checkout and change notices require an active reservation, active
property, valid normalized Korean mobile number and an existing recoverable,
unexpired private reservation link issued for its current revision. Cancellation
notices require a cancelled reservation and omit links/buttons. Previews and
sends never create or rotate links. A reservation edit invalidates a link bound
to its earlier revision; an administrator must prepare the latest link first.

Check-in additionally calls the existing `AdminStayAccessService.readContext`
readiness logic. PREPARED, no blocker, and a readable saved code are required.
Source-history gaps, changed guest/phone, cancel/restore, property policy changes
and neighboring-code conflicts remain blocking. Door codes are never put in
messages or dispatch records. Prepared application data does not establish that
any physical lock was changed. Guests read codes through their private page,
from exactly seven days before check-in until checkout.

Staff assignment/change notices require PLANNED or IN_PROGRESS tasks, an active
property, an active assigned STAFF profile, its valid phone number, and the
current recoverable staff QR. Cancel notices require CANCELLED tasks and omit
links/buttons. Assignment and phone/profile changes are included in preflight.
Current staff QR authorization is property scoped. Changing a staff phone alone
does not revoke a previously shared QR; identity/phone corrections still need
administrator review of previously distributed links.

No raw recipient phone, private link, rendered body, template variables,
credentials or provider response bodies are stored in MessageDispatch. Provider
errors are reduced to fixed safe codes or four-digit status codes. Controllers
log static operation names only. Provider exceptions are deliberately discarded
because they can contain headers and request bodies.

## Claim, delivery and failure behavior

A unique durable idempotency claim is committed before any remote I/O. A second
serializable preflight checks latest domain data immediately before the provider
request. Provider I/O is outside the transaction and is never retried by that
transaction helper. A definitive local preflight failure stores FAILED and does
not call the provider. Normal database/remote systems cannot make cancellation
and an external delivery atomic; a domain change after final preflight may race
with a provider request already starting.

The provider adapter uses native server fetch with SOLAPI HMAC authentication,
a fixed HTTPS endpoint, disabled redirects and a ten-second timeout. It performs
one send request, without automatic retry. Explicit HTTP request rejection or a
verified sole failed-message result is FAILED. Conflicting/malformed results,
transport timeouts, server errors, or missing message identifiers are UNKNOWN.
`2000`/`3000` mean ACCEPTED/pending; only `4000` means DELIVERED. The legacy
pending code `2100` stays ACCEPTED. Ambiguous codes `3014`/`3048` stay UNKNOWN.
Definitive final failure codes map to FAILED. No accepted receipt is described
as delivered.

| Application status | Meaning |
| --- | --- |
| SENDING | A claim exists; the provider attempt is in progress |
| ACCEPTED | Provider acceptance/pending receipt; delivery is not established |
| DELIVERED | Provider reported `4000` |
| FAILED | Known rejection/failure, including no-send local preflight failure |
| UNKNOWN | Outcome cannot be safely established; do not blindly retry |

A SENDING claim older than 60 seconds is shown as UNKNOWN, including process
crashes between claim, request and response persistence. Unknown outcomes retain
the deduplication claim. Refresh can only look up a recorded provider message
ID; otherwise manual console reconciliation is needed. Failed refresh does not
erase an existing ACCEPTED receipt. Terminal results cannot be regressed by an
older concurrent refresh. A proven FAILED dispatch releases its event claim so
an administrator may intentionally send a new request after addressing the
problem; the original request key always returns its original outcome.

The event deduplication hash uses nonsecret subject IDs, versions, property and
staff update timestamps, code version, and existing link version/hash metadata.
It excludes credentials and phone numbers and remains stable across JWT secret
rotation. Context/preview fingerprints use HMAC with the JWT secret; rotation
invalidates previews without resetting event deduplication. Automatic job keys
are namespaced internally as `automatic:<job-key>`; browser keys as
`manual:<uuid>`. Automation cannot be selected through public send input.

## Fixed Korean draft templates

These are approval drafts, not console-verified templates. Dates are rendered in
Korea time as `YYYY-MM-DD HH:mm`. Register the exact selected template text,
variable names and web-link button before turning approval on. Guest links use
`/guest/stay#token=...`; staff links use `/staff#token=...`.

`GUEST_CHECKIN` — button `개인 예약 확인`, URL `#{링크}`

```text
#{이름}님, #{휴양소} 입실 안내입니다.
입실: #{입실일시}
퇴실: #{퇴실일시}
개인 예약 페이지에서 이용 안내와 입실 체크리스트를 확인해 주세요.
예약 비밀번호는 입실 7일 전부터 퇴실 시각까지 개인 예약 페이지에서 확인할 수 있습니다.
개인 예약: #{링크}
```

`GUEST_CHECKOUT` — button `개인 예약 확인`, URL `#{링크}`

```text
#{이름}님, #{휴양소} 퇴실 안내입니다.
입실: #{입실일시}
퇴실: #{퇴실일시}
퇴실 전 개인 예약 페이지에서 퇴실 체크리스트를 작성해 주세요.
개인 예약: #{링크}
```

`GUEST_CHANGE` — button `개인 예약 확인`, URL `#{링크}`

```text
#{이름}님, #{휴양소} 예약 내용이 변경되었습니다.
입실: #{입실일시}
퇴실: #{퇴실일시}
아래 개인 예약 페이지에서 변경된 이용 일정을 확인해 주세요.
개인 예약: #{링크}
```

`GUEST_CANCEL` — no button or link

```text
#{이름}님, #{휴양소} 예약이 취소되었습니다.
입실: #{입실일시}
퇴실: #{퇴실일시}
취소된 예약의 개인 이용 링크는 사용할 수 없습니다.
```

`STAFF_ASSIGNMENT` — button `청소 일정 확인`, URL `#{링크}`

```text
#{이름}님, #{휴양소} 청소가 배정되었습니다.
청소 예정: #{청소일시}
직원 페이지에서 청소 일정을 확인해 주세요. 청소 완료 후 체크리스트와 사진을 제출해 주세요.
직원 페이지: #{링크}
```

`STAFF_CHANGE` — button `청소 일정 확인`, URL `#{링크}`

```text
#{이름}님, #{휴양소} 청소 일정이 변경되었습니다.
청소 예정: #{청소일시}
직원 페이지에서 변경된 청소 일정을 확인해 주세요.
직원 페이지: #{링크}
```

`STAFF_CANCEL` — no button or link

```text
#{이름}님, #{휴양소} 청소 일정이 취소되었습니다.
청소 예정: #{청소일시}
해당 일정의 청소를 진행하지 마세요.
```

## Verified references and local verification boundary

The adapter was checked against SOLAPI's official
[send contract](https://solapi.com/developers/api/messages),
[message lookup contract](https://solapi.com/developers/api/msg-getList),
[HMAC authentication](https://solapi.com/developers/api/authentication-api-key)
and [status code guide](https://solapi.com/guides/message-status-codes).

Local validation covers Prisma schema/client generation, TypeScript/Nest build,
changed-code lint, and temporary offline service/provider/domain probes using
fictional values. The probes intercept every provider request and replace Prisma;
no PostgreSQL connection, migration application, console action or live message
was performed. There are no new test/spec files in this repository. An actual
migration, real PostgreSQL concurrency check, approved-template registration,
channel/link-button compatibility and controlled device delivery remain runtime
release checks owned by the user.
