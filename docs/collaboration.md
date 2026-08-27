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

The supported roles are `case_author`, `evidence_reviewer`, `policy_editor`, `recipient_verifier`, `dispatch_approver`, and `public_release_manager`. Roles describe provenance and expected responsibility. They do not grant authority, imply endorsement, or create consent.

## Event Types

- `participant_registered`: registers a human, organization, or AI participant and its visibility.
- `contribution`: records authored or edited work.
- `review`: records review activity without implying approval.
- `dissent`: preserves disagreement without deleting prior history.
- `approval`: records a collaboration-level human decision. It does not satisfy a `case.json` approval stage.
- `co_sign_consent`: records explicit human-confirmed consent for one identity and one document hash.
- `consent_withdrawal`: appends a withdrawal that references an earlier co-sign consent.

Human-only events require `--confirm-human`. An AI or organization participant cannot be the actor for approval, co-sign consent, or withdrawal. A human with the `public_release_manager` role may explicitly act for a registered organization by setting `--identity` to that organization ID; the ledger records both the human actor and represented identity. The role alone never creates consent.

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

Multiple roles or required identities use `|` or comma separators.

## Consent Boundary

Joint attribution is valid only when the caller supplies the intended identity set and every identity has a non-withdrawn co-sign consent for the current target hash. Participant registration, contribution volume, role assignment, review, or collaboration approval cannot substitute for that consent.

When the target file changes, the old consent remains in the ledger as historical evidence but moves to `stale_consents`. A new explicit consent is required for the new document hash.

The existing six stages in `case.json` remain authoritative for problem, evidence, policy, recipients, document, and dispatch approval. Collaboration events never create or refresh those approvals.

## Public Redaction

`redact` pseudonymizes every participant marked `visibility: "private"`, updates all references to that identity, redacts recognized contact data and secrets in free text, marks the derivative as `public_copy: true`, and rebuilds its hash chain. Public identities remain only when explicitly marked public.

The public policy-pattern bundle still excludes authorship, consent, and representativeness. `collaboration-status` treats every public-copy consent as non-authoritative, even when the target bytes happen to be unchanged. A public collaboration ledger cannot be reused as a dispatch authorization or as evidence of consent in another case.

## Validation and Failure Modes

`validate` checks the optional ledger when present. It reports the violated contract and `collaboration.json` path for malformed entries, unknown actors, AI-created human decisions, invalid targets, and broken hash chains. Stale consent is reported as a warning because document revision is legitimate, but stale consent never satisfies joint attribution.
