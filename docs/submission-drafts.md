# Checklist submission drafts

This slice starts and saves drafts. Separate [photo endpoints](draft-photos.md)
now attach images to these drafts. It does not submit a completed checklist,
create issues, match a planned stay, create guest accounts, or
implement the future prearrival invitation. No schema change is required.

## HTTP contract

All routes use `Authorization: Bearer <opaque token>`. They do not accept an
administrator JWT. The start routes require the matching shared property QR
token; current/save require the private draft token returned by start.

| Method | Route | Credential | Success |
| --- | --- | --- | --- |
| POST | /submission-drafts/guest/start | Guest property QR | 201 |
| POST | /submission-drafts/staff/start | Staff property QR | 201 |
| GET | /submission-drafts/current | Private draft token | 200 |
| POST | /submission-drafts/save | Private draft token | 200 |

Guest start example (requestKey is a fresh client-generated UUID per attempt):

```json
{
  "requestKey": "bf2791f0-48dc-4e60-8a52-585411342234",
  "type": "CHECK_IN",
  "visitDate": "2026-09-16",
  "guestName": "예시 이용객",
  "company": "예시 회사",
  "department": null,
  "phone": null
}
```

`type` is CHECK_IN or CHECK_OUT. Name is required (100 characters maximum);
company/department (150) and phone (50) are optional and nullable. Visit date is
a real calendar date from 1900 through 2100, not proof of a reservation or stay.
Guest identity is self-reported. There is no name-based automatic profile matching.

Staff start accepts only `requestKey` and `confirmedStaffId` (UUIDs). The current
active STAFF assignee must match that confirmation. MAINTENANCE type, start time,
Seoul visit date, and staff id/name snapshot are set by the server. This confirms
the displayed assignment; it does not authenticate the human holding the QR.

Start returns `{ draft, accessToken, url, expiresAt }`. The future frontend URL
is `FRONTEND_URL/draft#token=...`; the React page is not implemented in this slice.
The token appears only in this creation response, and only a domain-separated
SHA-256 digest is stored. Current/save responses never return the raw token or URL.
Do not log, expose to analytics, or share these bearer credentials with other guests.

The draft response contains id, safe current property labels, type, DRAFT status,
visitDate, captured author/template, answers, startedAt, createdAt, updatedAt and
expiresAt. No roster, other drafts, credentials, token digest, or arbitrary record
selection is exposed. Template and author snapshots are server-built and immutable.

## Saving answers

Send the complete answer list, not just changed items:

```json
{
  "expectedUpdatedAt": "2026-09-16T01:00:00.000Z",
  "items": [
    { "itemId": "aa18533e-f3fc-4dba-b471-098d872fd9a1", "value": "NORMAL" },
    {
      "itemId": "b1ce53d1-29eb-49a7-bbdb-5df76e3bd2aa",
      "value": "ABNORMAL",
      "description": "온수가 나오지 않습니다.",
      "isUrgent": true
    }
  ],
  "generalNote": null
}
```

Use actual item IDs from the draft's captured template, and the latest returned
updatedAt with all milliseconds. Unknown/duplicate items and nested unknown fields
are rejected. Missing required answers are allowed while drafting, including an
empty list. Saving replaces all answers; omitted/blank generalNote becomes null.
Defaults: description/repairNote null, isUrgent/repairReported false. Description
and repairNote allow 2000 characters, generalNote 4000, and at most 500 answers.

NORMAL cannot carry an abnormal description, urgency, or repair claim. Staff may
send repairReported and repairNote on ABNORMAL answers; a nonempty repairNote
requires repairReported true. This only records the worker's claim and cannot
close an issue. Guest requests must omit both repair fields, even false/null.
The response uses a common normalized answer shape, so a guest form must omit
those two fields when constructing a save request rather than repost the response
unchanged. Issue category assignment and photo fields are deferred and rejected
by these DTOs. The broader data-model document describes their future contract.

## Access and concurrency

- The initial draft token lifetime is seven days from creation, fixed rather than
  sliding. This is an implementation default for drafts, not a client-confirmed
  lifetime for future submitted-checklist edit links. No expiry renewal or token
  recovery endpoint exists here. Expired records remain stored; cleanup policy is
  a later operational decision.
- All draft reads/writes require DRAFT status, an unexpired token and an active
  property. Staff drafts additionally require the original worker still to be the
  current active STAFF assignee. Reassignment/deactivation suspends access; returning
  the same assignment/activity before expiry permits access again.
- Rotating a property QR prevents new starts through the old QR. Already-issued
  private draft tokens are separate and remain valid subject to the rules above.
- Template edits/deactivation do not rewrite existing drafts. They retain the
  captured wording/version; new drafts require a currently active matching template.
- Start validates QR, assignment, template and creates the draft in one serializable
  transaction. Reusing a requestKey returns 409 DRAFT_REQUEST_EXISTS without any
  existing draft details or credential. It never recovers/replaces someone else's
  token. Concurrent duplicate starts create at most one row.
- The client should persist the returned private credential immediately. If the
  successful response is lost, retrying the requestKey cannot recover it. Starting
  with a new key creates a separate draft; the abandoned draft stays incomplete.
- Save uses a serializable transaction and conditional updatedAt write. Competing
  saves cannot silently overwrite each other: 409 DRAFT_CHANGED requires reloading
  current and reconciling the form. Every successful save advances updatedAt.
- Draft saves keep currentRevision at zero and create no SubmissionRevision. Final
  submission/history and the post-submission access policy are separate slices.

Start endpoints allow 10 requests/minute per endpoint/IP; current/save allow 60.
Limits are in memory per process, as with the existing login/QR endpoints. No-store
and no-referrer middleware precede guards and handlers (body-parser rejection can
precede route middleware). Logs contain static operation names only.

## Typical errors

- 400 VALIDATION_ERROR / INVALID_VISIT_DATE: malformed or unexpected input.
- 400 INVALID_DRAFT_ITEM / INVALID_DRAFT_ANSWERS / STAFF_ANSWER_ONLY: invalid answers.
- 401 INVALID_QR: unusable or wrong-flow property QR on a start route.
- 401 INVALID_DRAFT_ACCESS: unusable, expired, inactive, completed or inaccessible draft.
- 409 STAFF_ASSIGNMENT_CHANGED / CHECKLIST_UNAVAILABLE: refresh property context.
- 409 DRAFT_REQUEST_EXISTS: request identifier already used; no draft details returned.
- 409 DRAFT_CHANGED / CONCURRENT_UPDATE: reload and retry with current state.
- 429: endpoint limit exceeded.

No real property configuration, QR issuance, migrations, uploads, frontend or
business-data seeding are performed as part of this slice.
