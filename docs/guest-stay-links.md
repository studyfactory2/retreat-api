# Personal guest stay links

The administrator issues a private link for one existing Stay and manually sends
it to that guest. Possession of this link authorizes that stay; it is not proof
of the person's identity. No guest login, automatic message delivery or public
roster lookup is introduced.

## Migration required

The user creates and applies the development migration:

```bash
npx prisma migrate dev --name add_guest_stay_links
```

This adds five invitation fields to Stay and nullable stayLinkVersion to
ChecklistSubmission. Existing stays have version 0 and no issued link; existing
QR drafts have a null stayLinkVersion. No tables, default guests or invitations
are created. Run the migration before starting the updated API. The assistant
generates Prisma Client and checks code but does not apply database changes.

## Administrator routes

All require the existing ADMIN bearer JWT. Each handler has its own RolesGuard.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /admin/stays/:id/guest-link | Safe issuance/access status |
| POST | /admin/stays/:id/guest-link/issue | Issue or replace the invitation |
| POST | /admin/stays/:id/guest-link/revoke | Revoke the invitation and child access |

All return 200. Both POST bodies require integers:

```json
{ "expectedRevision": 1, "expectedLinkVersion": 0 }
```

Use the GET response's stayRevision and version. Stale values return 409
STAY_LINK_CHANGED. Invitation version increments independently of Stay's
currentRevision; link operations do not create a business StayRevision.
The mutating transaction rechecks the active administrator and both versions.
Revoke is also allowed for cancelled stays and inactive properties.

Status returns stayId, issued, enabled, version, stayRevision, issuedForRevision,
expiresAt and updatedAt. No hash or old token is exposed. Issue additionally
returns url, using FRONTEND_URL + /guest/stay#token=<opaque-secret>. Only this
response contains the new raw token. Store/copy the returned link; if it is lost,
refresh status and issue a replacement. Repeating issuance with stale versions
cannot recover a previous token.

## Expiry and invalidation policy

- Initial policy: the invitation expires exactly seven days after planned
  checkout. The manager can issue it before arrival while that deadline is future.
- Only ACTIVE stays at active properties can receive or use a link.
- Replacement/revocation increments the invitation version and disables all
  draft tokens created through older versions.
- Any stay revision change, including guest/date/notes edits or cancellation,
  disables its existing link and child access. Restoring a stay does not revive
  those credentials; the administrator must issue a new invitation.
- Property deactivation suspends access. Reactivation can resume an otherwise
  still-valid invitation. Revoke it explicitly if permanent revocation is needed.
- Historical submissions and photos remain accessible through administrator APIs.
  Revocation does not delete or alter their saved evidence.

Stay stores only a domain-separated SHA-256 token digest. Tokens are random
32-byte secrets and must never appear in API query strings, logs or analytics.
The browser reads the fragment and sends Authorization: Bearer <token>.
Responses/errors use Cache-Control: no-store and Referrer-Policy: no-referrer.

## Guest routes

| Method | Route | Result |
| --- | --- | --- |
| GET | /guest/stays/current | This stay and available guest checklists; 200 |
| POST | /guest/stays/drafts/start | Start a linked check-in/out draft; 201 |

The current response explicitly includes stayId, guestName, checkInAt, checkOutAt,
expiresAt, property {id,name,region}, and active CHECK_IN/CHECK_OUT checklist
definitions. It does not expose internal notes, account IDs, credentials, other
stays or the whole roster. Unknown query/body fields are rejected.

Start body:

```json
{ "requestKey": "<new-uuid-v4>", "type": "CHECK_IN" }
```

CHECK_OUT is also allowed. The server selects stayId, property, guest details and
the relevant planned arrival/departure date in Asia/Seoul. The caller cannot
supply a different stay, name, date, property or author. The submission records
PRIVATE_LINK and captures the invitation version and existing checklist snapshot.
Planned dates do not prove physical arrival/departure; this slice adds no GPS or
arrival-time gate.

Start returns the existing StartDraftDto: draft, accessToken, url and expiresAt.
This new token is scoped to one draft and expires at the earlier of seven days
after creation or invitation expiry. Retain the draft token/link to continue
through existing current/save/photo/submit/receipt routes. All these operations
also recheck the parent stay and invitation version, including photo finalization
and the recheck after private URL signing. An already issued S3 URL may remain
usable for its existing short lifetime after revocation.

The existing requestKey policy remains: duplicate creation requests return
409 DRAFT_REQUEST_EXISTS and never recover a secret. A different request key may
create a separate checklist; this slice does not deduplicate by stay/type or add
a draft recovery/list endpoint. Future calendar review must account for duplicate
submissions. The completed draft token now also supports read-only captured
answers/photos through [guest checklist viewing](guest-submissions.md). Corrections
remain a later slice; the original minimal receipt endpoint is unchanged.

## Compatibility and follow-ups

Property guest/staff QR flows retain their current behavior. QR submissions remain
unmatched until a later reviewed matching flow; names are never used for automatic
identity matching. A property QR, staff QR, admin JWT, photo token or draft token
cannot substitute for a stay invitation.

The guest access guard lives under auth/guards and is provided by GuestStaysModule.
Shared StayAccessModule is used by guest context and the existing draft service.
Guest routes are throttled per process (60/minute; draft starts 10/minute per IP).
No new tests/spec files, messaging provider, frontend screens, guide/vehicle forms,
Excel import or calendar endpoint are included. Live migrated-PostgreSQL and
browser integration checks follow the user-run migration.
