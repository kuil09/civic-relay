# Redaction Manifest

`redact` creates a separate derivative case and writes `redaction-manifest.json` inside it. Manifest version `2.0` contains no source or output absolute paths.

## Version 2.0

The top-level `source_snapshot_hash` is the SHA-256 digest of the sorted source file paths and hashes. Each file record contains:

- `path`: a case-relative path;
- `handling`: `processed_text` or `copied_binary`;
- `copied`: the legacy compatibility flag, true only for byte-for-byte binary copies;
- `redacted`: whether the redaction process actually changed recognized content;
- `source_hash` and `output_hash`: SHA-256 provenance without local paths; and
- `redactions`: counts by recognized redaction category.

`processed_text` means the text passed through the redaction pipeline. It does not mean a match was found. Check `redacted` and `redactions` for actual transformations. `copied_binary` means the bytes were copied unchanged and were not inspected by the text scanner.

## Migration

Legacy unversioned or version `1.0` manifests may contain `source`, `output`, and only the `copied` flag. Existing published fixtures and legacy redacted cases remain readable by the publication path, but newly generated derivatives use version `2.0`. Tools should prefer `handling` and `redacted` when present and treat `copied` as compatibility metadata.

## Sharing Boundary

A redacted case is a review artifact, not an automatic publication guarantee. Review every `copied_binary` file and inspect the derivative before sharing it because binary metadata and unrecognized identifiers are outside the text scanner's boundary.

A public policy-pattern bundle is intended for sharing only after `publish-case` succeeds and `validatePublicBundle` reports valid. The bundle excludes case-specific delivery and consent records and rejects recognized secrets, contact data, and local absolute paths. That validation is still a technical floor, so human review remains appropriate for sensitive releases.
