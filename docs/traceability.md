# PRD Traceability

| 수용 기준 | 구현 위치 | 자동 검증 |
|---|---|---|
| AC-01 원문 보존 | `issue-intake`, case schema | `validate`, tests |
| AC-02 권한 설명 | law/authority skills, `03-*` | stage invariant |
| AC-03 출처 완전성 | claims/sources | `validate` |
| AC-04 수신자 근거 | recipient schema | `verify-recipients` |
| AC-05 현재성 | recipient verification | send gate |
| AC-06 반론 포함 | counterargument skill | minimum count |
| AC-07 대안 비교 | option skill | status quo + 3 |
| AC-08 승인 | approval hash | send gate tests |
| AC-09 개별 전달 | file outbox/adapter contract | isolation test |
| AC-10 배포 투명성 | distribution notice/manifest | dispatch invariant |
| AC-11 재발송 차단 | dispatch key | duplicate test |
| AC-12 사례 재현 | complete case folder | example validation |

## Phase 4 Quality Contract (#29)

| Scenario | Production boundary | Automated evidence |
|---|---|---|
| 1. KR and US-FED share one adapter contract | `src/lib/jurisdiction.js` | `tests/jurisdiction.test.js` |
| 2. Office holders and direct contacts are rejected | adapter validation | `tests/jurisdiction.test.js` |
| 3. Unknown jurisdiction IDs do not fall back to KR | adapter loading | `tests/jurisdiction.test.js` |
| 4. Unredacted cases cannot be published | `publishCase` redaction-manifest gate | `tests/library.test.js` |
| 5. Public bundles reject contacts and tokens | public-bundle sensitive-data scan | `tests/library.test.js` |
| 6. Public catalogs expose no source path | sanitized manifest and relative catalog entries | `tests/library.test.js` |
| 7. Case facts are not promoted to reusable patterns | policy-pattern allowlist | `tests/library.test.js` |
| 8. Participation does not imply co-sign consent | explicit identity set and consent events | `tests/collaboration.test.js` |
| 9. Document changes expire prior consent | target SHA-256 comparison | `tests/collaboration.test.js` |
| 10. AI actors cannot create human approval or signature records | participant-kind and human-confirmation gates | `tests/collaboration.test.js` |
| 11. Legacy cases work without Phase 4 files | optional collaboration and public-library boundaries | `tests/collaboration.test.js`, existing MVP tests |
| 12. Existing CLI works without public or collaboration features | unchanged core commands and optional imports | `tests/collaboration.test.js` CLI process test |
| Public collaboration privacy | pseudonymization, `public_copy` authority block, and ledger re-chaining | `tests/collaboration.test.js` |
| Structural validity is not semantic completion | dedicated case, send, and publication readiness contracts; preview builds remain available | `tests/library.test.js` |
| Empty patterns cannot be published | publication readiness rejects missing claims, sources, policy alternatives, and strong counterarguments through the production CLI | `tests/library.test.js` |
| Library aggregation cannot mutate a bundle | bundle-root and nested-output preflight checks run before any index write | `tests/library.test.js` |
| Initialization selects a verified jurisdiction | explicit adapter ID, documented KR default, and pre-create rejection | `tests/init-and-validation.test.js` |
| Redacted derivatives expose no local roots | path-free manifest v2 with relative file references and source/output hashes | `tests/privacy-and-response.test.js`, `tests/library.test.js` |
| Public collaboration freshness is not authority | separate hash-current, authoritative, non-authoritative, and stale status collections | `tests/collaboration.test.js` |
| Collaboration CLI values are discoverable | help output lists roles, event types, human-only events, outcomes, and list syntax | `tests/collaboration.test.js` |
| Phase 4 conflict resolution | divergent-hash conflict references, human-only outcomes, revision expiry, and joint-attribution block | `tests/collaboration.test.js` |
| Phase 4 document version lineage | ordered target hashes and attesting entry IDs exposed by collaboration status | `tests/collaboration.test.js` |
