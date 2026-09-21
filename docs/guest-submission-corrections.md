# Guest checklist corrections

`POST /guest/submissions/correct` lets the holder of a valid completed guest
checklist token correct answers and notes. The guest module owns this operation;
staff maintenance records and administrator account tokens do not grant access.
The route uses the same private token as the completed viewing endpoints, not the
property QR or parent stay invitation. Every correction rechecks guest scope,
property activity, token expiry and any linked stay invitation in its transaction.

## Request and result

```json
{
  "expectedRevision": 1,
  "items": [
    {
      "itemId": "<captured-checklist-item-uuid>",
      "value": "ABNORMAL",
      "description": "창문 손잡이가 느슨합니다.",
      "isUrgent": false
    }
  ],
  "generalNote": "수정한 전체 메모",
  "reason": "이상 내용 설명을 정정합니다."
}
```

Send the complete desired answer list against the captured template; required
items must still be answered. Optional omitted items are cleared. Each item accepts
only itemId, NORMAL/ABNORMAL value, optional description and optional isUrgent.
Descriptions are at most 2000 characters. NORMAL answers cannot carry a defect
description or urgency. Staff repair fields, photos, guest/property/stay IDs,
template changes, arbitrary status and other unknown fields are rejected.

expectedRevision is the revision returned by GET /guest/submissions/current.
Omitting generalNote preserves its current value; null or blank clears it. A
supplied note is at most 4000 characters. reason is optional, but when supplied
must be nonblank text of at most 1000 characters; null is rejected.

HTTP 200 returns {id,status:"SUBMITTED",revision,updatedAt,changed}. A meaningful
change creates the next revision. An unchanged answer set/note returns changed:false
without a new revision or issue event; a reason by itself does not create a change.
Answer order and surrounding text whitespace do not create spurious revisions.

The route rejects query parameters and applies a 10/minute per-IP, per-process
limit. Success/error responses use no-store/no-referrer headers. No request values
or private tokens are logged.

## History, retries and concurrency

One serializable transaction conditionally updates the submission's revision and
current answers, appends a CORRECTED SubmissionRevision, associates retained photos,
and records related issue changes. A conflict or failure rolls back all of them.
The snapshot preserves captured property/guest/template wording and the original
submittedAt. Correction time is recorded separately by the revision and updatedAt.
Private access does not get extended. The original completion receipt remains
unchanged and the original submission retry continues to return that receipt.

A correction stores a digest of its normalized request and expectedRevision.
Repeating the exact successful request returns that correction's result, even if
a later correction exists; reload GET current to obtain the latest version.
Changing the payload while reusing an old expectedRevision returns 409
SUBMISSION_CHANGED. A no-op request is not persisted as a separate retry record.
Revoked/expired access cannot replay a successful correction.

## Photo behavior in this slice

Guests cannot upload replacements, select arbitrary photo IDs or delete stored
photos here. Existing defect photos stay in the latest revision while their
associated answer remains ABNORMAL. Changing that item to NORMAL or clearing an
optional answer omits those associations from the new revision. Their original
revision associations, stored images and issue evidence remain intact for the
administrator. Later changing the answer back does not automatically reattach
photos from older revisions. Retained photo order is normalized for the new snapshot.

## Related problems

Newly abnormal items create a problem only if none already exists for that
submission/item. A changed item with an existing problem appends an UPDATED event
pointing to the correction revision; it does not create another problem. An
ABNORMAL correction updates the current description/urgency and retains the
original report, original source revision and evidence. A NORMAL or cleared answer
adds an explicit correction note while keeping the problem's current fields.

Manager-controlled status, resolution, cancellation and original source references
are preserved, including on resolved/cancelled problems. Guest edits never resolve,
reopen, cancel or restore a problem. Existing issue evidence is not duplicated on
UPDATED events; new problem reports link their applicable defect photos normally.
General-note-only changes do not add issue events. Malformed stored issue history
fails safely rather than overwriting it.

## Verification boundary

No schema, migration, package or new test/spec files are required. Guest viewing,
administrator submission/history and issue/history readers consume the new saved
revisions through their existing contracts. Mocked transaction/HTTP probes do not
prove live PostgreSQL concurrency, AWS delivery or frontend behavior; those remain
integration checks before release.
