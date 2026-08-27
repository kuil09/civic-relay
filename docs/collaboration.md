# Collaboration Ledger

`collaboration.json` is an optional Phase 4 ledger. A case without this file remains a valid local-only case. The first `collaboration-add-participant` command creates the ledger.

## Contract

The ledger is an ordered list of hash-chained entries. Every entry records:

- a stable entry ID and event type;
- the actor and UTC timestamp;
- a case-relative target, optionally followed by a JSON Pointer;
- the SHA-256 hash of the target file at recording time;
- the previous entry hash and the current entry hash; and
- event-specific payload data.

The supported roles describe provenance and expected responsibility:

| Role | Meaning |
|---|---|
| `case_author` | Records authorship and primary case stewardship. |
| `evidence_reviewer` | Reviews source quality and claim support. |
| `policy_editor` | Edits options, counterarguments, and policy documents. |
| `recipient_verifier` | Verifies recipient roles and official channels. |
| `dispatch_approver` | Records collaboration provenance around delivery review. It does not replace the six case approval stages. |
| `public_release_manager` | May explicitly represent a registered organization for supported human decisions. |

Roles do not grant authority, imply endorsement, or create consent.

## Event Types

- `participant_registered`: registers a human, organization, or AI participant and its visibility.
- `contribution`: records authored or edited work.
- `review`: records review activity without implying approval.
- `dissent`: preserves disagreement without deleting prior history.
- `conflict_opened`: links two or more earlier entries for the same target that attest to different document hashes.
- `conflict_resolved`: records a human-confirmed outcome for an open conflict against the current document hash.
- `approval`: records a collaboration-level human decision. It does not satisfy a `case.json` approval stage.
- `co_sign_consent`: records explicit human-confirmed consent for one identity and one document hash.
- `consent_withdrawal`: appends a withdrawal that references an earlier co-sign consent.

Human-only events require `--confirm-human`. An AI or organization participant cannot be the actor for approval, conflict resolution, co-sign consent, or withdrawal. A human with the `public_release_manager` role may explicitly act for a registered organization by setting `--identity` to that organization ID; the ledger records both the human actor and represented identity. The role alone never creates consent.

## CLI

Register a private human participant:

```bash
node src/cli.js collaboration-add-participant cases/example \
  --id author-1 \
  --name "Kim Citizen" \
  --kind human \
  --role case_author \
  --visibility private
```

Record work against a whole document or a JSON Pointer inside `case.json`:

```bash
node src/cli.js collaboration-record cases/example \
  --type contribution \
  --actor author-1 \
  --target 'case.json#/claims/claim-001' \
  --summary "Drafted and sourced the claim."
```

Record and inspect explicit co-signature consent:

```bash
node src/cli.js collaboration-record cases/example \
  --type co-sign-consent \
  --actor author-1 \
  --identity author-1 \
  --target 07-policy-proposal.md \
  --confirm-human

node src/cli.js collaboration-status cases/example \
  --target 07-policy-proposal.md \
  --identity author-1
```

Withdraw a prior consent without removing it from history:

```bash
node src/cli.js collaboration-record cases/example \
  --type consent-withdrawal \
  --actor author-1 \
  --target 07-policy-proposal.md \
  --consent-entry entry-00000000-0000-0000-0000-000000000000 \
  --confirm-human
```

Multiple roles or required identities use `|` or comma separators. Quote pipe-separated values so the shell does not interpret the pipe, for example `--role 'case_author|policy_editor'`. The equivalent comma form is `--role case_author,policy_editor`.

Open and resolve a conflict between two recorded document versions:

```bash
node src/cli.js collaboration-record cases/example \
  --type conflict-opened \
  --actor author-1 \
  --target 07-policy-proposal.md \
  --conflicting-entry entry-first-version\|entry-second-version \
  --summary "The candidate versions make incompatible requests."

node src/cli.js collaboration-record cases/example \
  --type conflict-resolved \
  --actor author-1 \
  --target 07-policy-proposal.md \
  --conflict-entry entry-open-conflict \
  --outcome merged \
  --confirm-human \
  --summary "Merged the shared evidence and retained the narrower request."
```

Conflict outcomes are `adopt_current`, `merged`, and `rejected_change`.

## Consent Boundary

Joint attribution is valid only when the caller supplies the intended identity set and every identity has a non-withdrawn co-sign consent for the current target hash. Participant registration, contribution volume, role assignment, review, or collaboration approval cannot substitute for that consent.

When the target file changes, the old consent remains in the ledger as historical evidence but moves to `stale_consents`. A new explicit consent is required for the new document hash.

The existing six stages in `case.json` remain authoritative for problem, evidence, policy, recipients, document, and dispatch approval. Collaboration events never create or refresh those approvals.

## Conflict and Version Boundary

The ledger treats each target SHA-256 value as a document version identifier. `collaboration-status` derives `document_versions` from the ordered entries and reports the entry IDs that attested to each hash. It does not copy document contents into the ledger; Git or a separately governed archive remains responsible for retaining bytes when historical reconstruction is required.

A conflict can be opened only by referencing at least two earlier entries for the same target with different document hashes. Opening a conflict preserves both candidates and does not choose a winner. Resolving it requires a registered human, `--confirm-human`, one of the explicit outcomes, and the current target hash. AI actors may identify a conflict but cannot resolve it.

An unresolved conflict blocks joint attribution even when every requested identity has current consent. If the target changes after resolution, the resolution remains in history as stale and the conflict becomes unresolved for the new version. A new human resolution is required; overwriting or deleting the earlier conflict or resolution is never required.

## Public Redaction

`redact` pseudonymizes every participant marked `visibility: "private"`, updates all references to that identity, redacts recognized contact data and secrets in free text, marks the derivative as `public_copy: true`, and rebuilds its hash chain. Public identities remain only when explicitly marked public.

The public policy-pattern bundle still excludes authorship, consent, and representativeness. `collaboration-status` reports hash freshness separately from authority. A public-copy consent or resolution whose `document_hash` still matches is `hash_current: true` and `authoritative: false`; a record for different bytes is reported in the corresponding stale collection. `authoritative_consents` and `authoritative_resolution` are always empty on a public copy, and `joint_attribution_valid` is always false. A public collaboration ledger cannot be reused as a dispatch authorization or as evidence of consent or conflict resolution in another case.

## Validation and Failure Modes

`validate` checks the optional ledger when present. It reports the violated contract and `collaboration.json` path for malformed entries, unknown actors, AI-created human decisions, invalid targets, invalid conflict references, and broken hash chains. Stale consent, unresolved conflicts, and stale conflict resolutions are warnings because document revision is legitimate. Hash-current records on a public copy receive distinct non-authoritative warnings instead of false stale warnings. None satisfies joint attribution.
