# Roadmap

GitHub 상위 추적 이슈: #24

## 완료 — Phase 0~3

PR #25에서 다음 범위를 구현했다.

- #1~#5 계약·스키마·CLI 기반
- #6~#13 조사·정책 제안 파이프라인
- #14~#18 수신자·승인·전달·회신 루프
- #19~#20 개인정보·테스트·CI
- #21 기준 종단간 사례
- #22 ADR

## Phase 4 — Optional extensions to the verified core

- #26 jurisdiction adapter schema, loader, and KR/US-FED implementations
- #27 public case bundles, catalog, and policy-pattern reuse
- #28 collaboration role, contribution, consent, and conflict ledger
- #29 Phase 4 isolation, reproducibility, and security contract tests

상위 이슈: #23

### Wave A

`#26 + #27 + #29 일부`

관할 차이를 코어 밖으로 분리하고, 익명화된 정적 공개 사례를 생성한다.

### Wave B

`#28 + #29 나머지`

Collaboration contributions and joint-attribution consent remain separate and bind to document hashes. Explicit conflict events retain divergent version hashes, require a human resolution, and expire that resolution after a new revision.

## 유지 조건

- 기존 로컬 단독 사용은 계속 가능해야 한다.
- 공개 사례는 실제 발송에 사용할 수 없다.
- 관할 어댑터에는 현직자·직접 연락처를 저장하지 않는다.
- 원 사례의 사실·수신자·동의는 새 사례로 자동 이전하지 않는다.
