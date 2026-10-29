# Slice 7: staff handover and deactivation

These routes require an active administrator and return `Cache-Control: no-store`.
No staff profile, booking, submitted record, stored photo or historical author is
deleted or transferred. Staff deactivation updates the current operating
assignment and revokes the departing worker's access.

## Preview

`GET /admin/staff/:id/deactivation-preview` returns a repeatable-read snapshot:

```ts
{
  staff: StaffDto;
  expectedStateToken: string; // 64 lowercase hex characters; use unchanged
  properties: Array<{
    id: string;
    name: string;
    region: string | null;
    isActive: boolean;
    unfinishedDraftCount: number;
  }>;
  unfinishedDraftCount: number;
  latestDeactivation: StaffDeactivationAudit | null;
}
```

The total counts DRAFT maintenance records authored by this worker that still
have a private access token, including expired/blocked links and former-property
drafts. Per-property counts cover the listed current assignments, so their sum
can be smaller than the total. These drafts are not reauthored or handed to the
replacement. The normal expired-draft cleanup policy remains in effect; this is
not a promise to preserve unfinished uploads indefinitely.

The state token covers the source profile, exact assignment set and property
state, staff QR versions, and the worker's maintenance private-token records.
It contains no reusable credential. Reload the preview after a conflict.

Inactive staff can also be previewed. `latestDeactivation` allows recovery after
a lost response and retains snapshot names after profile/property renaming.
It is the latest deactivation event, not a complete lifecycle history. A later
reactivation or profile edit can make `staff.updatedAt` newer than the event.

## Confirm handover

`POST /admin/staff/:id/deactivate` accepts:

```ts
{
  expectedStateToken: string;
  assignments: Array<{
    propertyId: string; // UUIDv4
    replacementStaffId: string | null; // UUIDv4 or explicit null
  }>;
}
```

Include exactly one entry for every property shown by the fresh preview, up to
1,000 entries. Every operating property requires a currently active STAFF profile
other than the departing worker; one replacement may take several properties.
An inactive property's replacement must be `null`; its assignment
is cleared. Duplicate, extra or missing properties are rejected. An empty array
is valid only when there are no assignments. Actor identity is taken from the
authenticated administrator, not from the body.

Within one serializable transaction the server rechecks all eligibility, applies
each assignment, revokes access, marks the source inactive, and writes the audit.
Conditional writes plus the preview fingerprint reject stale confirmations.
P2034 serialization conflicts use the existing three-attempt retry helper.
If any operation or audit insert fails, the entire transaction rolls back.

Response: `{ staff: StaffDto, ...StaffDeactivationAudit }`, where:

```ts
type StaffDeactivationAudit = {
  id: string;
  deactivatedAt: string; // ISO timestamp in the JSON response
  actor: { id: string; name: string };
  assignments: Array<{
    propertyId: string;
    propertyName: string;
    propertyRegion: string | null;
    isActive: boolean; // state at handover
    replacementStaffId: string | null;
    replacementStaffName: string | null;
  }>;
  revokedDraftCount: number;
  reassignedPropertyIds: string[];
  clearedPropertyIds: string[];
  staffQrReissuePropertyIds: string[];
};
```

The reissue list equals the active reassigned property list. Use the existing
administrator QR page to issue and distribute each new staff QR deliberately.
No replacement secret is returned by this request, so a lost response cannot
lose the only copy of a new credential. Until reissue, replacement staff cannot
enter through those shared staff QR links. Guest QR and private guest stays are
unchanged.

## Access and preservation

- Revoke the staff QR hash on **all** departing assignments, including inactive
  properties. Changing assignee alone is unsafe because shared staff QR access
  resolves the current property's staff member.
- Ordinary `POST /admin/properties/:id/staff` assignment changes also revoke the
  prior staff QR atomically, including unassignment; saving the same identity
  preserves it. This prevents future manual reassignments from leaving valid QR
  copies with the previous worker. Already reassigned properties from before this
  fix cannot be attributed to former staff from current assignments alone; an
  administrator should reissue any such previously shared staff QR deliberately.
- Permanently null all MAINTENANCE private-token hashes authored by the source,
  across every property and status. This includes submitted/cancelled receipt
  links; `revokedDraftCount` counts only DRAFT rows. Admin access to saved records
  and their photos is unchanged.
- The narrowly parameterized SQL updates only `privateTokenHash`. It must not
  change `ChecklistSubmission.updatedAt`, which is checked against immutable
  submitted snapshots, nor `privateTokenExpiresAt`, used by draft cleanup.
- Completed authors, revisions, photos, issues and booking history remain as
  originally stored. No old work becomes the replacement's work.
- Explicit `{ "isActive": true }` through the existing staff update route
  reactivates the profile only. Assignments and revoked credentials never revive
  automatically. Assign a retreat and issue a new QR separately if needed.
- Old deployed clients must not deactivate using `/:id/update`; that transition
  now returns `STAFF_DEACTIVATION_REQUIRED`, even for an unassigned worker.

## Errors and client recovery

| Code | HTTP | Meaning |
|---|---|---|
| `STAFF_NOT_FOUND` | 404 | Source is missing or is not STAFF |
| `STAFF_ALREADY_INACTIVE` | 409 | Reload preview/latest event to check the outcome |
| `STAFF_HANDOVER_CHANGED` | 409 | Profile, assignment, QR or maintenance state changed |
| `STAFF_HANDOVER_ASSIGNMENTS_INVALID` | 400 | Incomplete, duplicate, self, or invalid clear/transfer selection |
| `STAFF_REPLACEMENT_UNAVAILABLE` | 409 | Replacement is missing, inactive, or not STAFF |
| `STAFF_DEACTIVATION_REQUIRED` | 409 | Legacy update cannot deactivate active staff |
| `CONCURRENT_UPDATE` | 409 | Serializable retries exhausted; reload and retry |

For a network failure or an uncertain response, do not claim success or blindly
repeat the write. Read the preview again; display inactive status and the latest
event when committed, or require a refreshed confirmation when still active.

## Migration and verification boundary

`20261029060000_add_staff_deactivation_audit` adds a narrow audit table with
restrictive source/actor relations, immutable actor/source/property/replacement
name snapshots, draft count and timestamp. The user must apply this migration
before enabling the API/client feature. No existing operational data is rewritten
by the migration, and it does not backfill earlier deactivations.

Unit tests use mocked Prisma delegates. They verify guards, DTO validation,
stale/conflict rejection, write scopes, token-only SQL, transaction boundaries,
audit recovery, and legacy-update protection. They do not prove database isolation,
rollback or deployed access revocation; those require user-run integration checks
against a disposable migrated database before production rollout.
