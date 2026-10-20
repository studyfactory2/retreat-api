# Administrator account settings

Slice 4 adds the authenticated administrator's own profile and password settings.
It does not add invitations, account creation, login-ID changes or password reset.

## Schema prerequisite and rollout

`User.sessionVersion Int @default(0)` must exist before starting this API version.
The assistant updated the schema only. No migration was generated or applied.
The operator runs these commands in the development API checkout:

```sh
npx prisma migrate dev --name add_admin_session_version
npx prisma generate
```

Review and commit the generated migration with the API change. Apply committed
migrations through the existing production migration workflow before starting
the updated API, then deploy the client. Do not run `migrate dev` in production.
Existing users start at version zero. Previously issued administrator JWTs with
no version claim remain valid only while their account's version is zero.

## Routes

All routes require an active administrator Bearer session, operate on its user
ID, and return `Cache-Control: no-store`. Payloads cannot choose another user.

| Route | Contract |
| --- | --- |
| `GET /admin/account` | Safe profile: id, name, loginId, role, phone, company, department, updatedAt |
| `POST /admin/account/profile` | name, optional nullable phone/company/department, expectedUpdatedAt |
| `POST /admin/account/password` | currentPassword, newPassword, confirmPassword; returns `{ passwordChanged: true }` |

The name is required (maximum 100 characters). Contact is at most 32 characters;
company and department are at most 100. Text is trimmed; blank optional values
become null. Login ID, role, status, session version and unrelated fields are
rejected by the whitelist. Profile saves compare the returned `updatedAt` and
advance it monotonically. A stale edit returns `409 ACCOUNT_CHANGED` rather than
overwriting another tab. Profile changes do not revoke login sessions or rewrite
historical snapshots.

Passwords are never trimmed. New passwords use the existing bcrypt policy:
at least eight Unicode characters and at most 72 UTF-8 bytes. Confirmation must
match, the current password must verify, and the new password must differ.
Password requests are limited to five per minute per client IP by the existing
Nest throttler and configured trusted-proxy behavior. As with the existing
login limiter, this storage is local to each API process.

The password hash and incremented session version are written atomically with
a condition on the old hash, active administrator role and session version.
Only one concurrent password change can succeed. Every authenticated request
compares the signed JWT version with the database version. All older tokens
for that administrator are rejected after a successful change; other accounts
remain valid. The browser clears the matching credential and requires login
with the new password. Requests already in progress are not cancelled by token
revocation; the account mutation endpoints additionally compare the version at
write time. No credential/hash/version is exposed by profile responses.

## Client behavior and verification boundary

Profile and password forms have separate save actions. Unsaved profile edits
must be saved or discarded before changing the password. Network errors, 5xx or
malformed success responses are treated as uncertain writes: profile replay is
blocked until an explicit reread, and password replay is blocked in favor of
logging in again. No mutation automatically retries. A stale request cannot
replace a newer session or clear another tab's newer credential.

Local checks use an in-memory Prisma adapter and fictional browser responses.
They do not verify a real database migration, production proxy behavior,
multi-process rate limiting or physical-device acceptance.
