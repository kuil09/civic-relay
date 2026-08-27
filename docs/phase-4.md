# Phase 4 Design Boundary

Phase 4는 MVP 코어를 웹서비스로 강제 전환하지 않는다. 협업·공개 사례·다관할 기능은 선택 기능이며 기존 로컬 사례는 마이그레이션 없이 계속 동작해야 한다.

## 구현 파동

### Phase 4.1 — 관할 어댑터

- 어댑터 스키마와 로더
- 대한민국과 미국 연방 어댑터
- 공식 자료원·현재성·정규화 규칙
- 현직자·직접 연락처의 영구 저장 금지

추적: #26

### Phase 4.2 — 공개 사례 라이브러리

- `redact`를 통과한 사례만 게시
- 수신자 정보는 제거 또는 영구 발송 불가
- 원 사례의 사실을 재사용 패턴과 분리
- 무결성 manifest와 정적 카탈로그

추적: #27

### Phase 4.3 — 협업 편집

역할 후보:

- 사례 작성자
- 근거 검토자
- 정책안 편집자
- 수신자 검증자
- 발송 승인자
- 공개본 관리자

개인 의견, 단체 공식안, 공동 서명은 별도 엔터티다. 참여 사실은 동의나 공동 명의를 뜻하지 않는다. AI는 사람의 승인·동의·서명을 생성할 수 없다.

Implementation boundary:

- `collaboration.json` is an optional, hash-chained append-only ledger.
- Participant registration, contribution, review, dissent, conflict opening, human conflict resolution, approval, co-signature consent, and withdrawal are separate event types.
- Co-signature consent is bound to a target document hash and becomes stale after document changes.
- Conflicts reference multiple prior hashes for one target. A human resolution is bound to the current hash, becomes stale after revision, and unresolved conflicts block joint attribution.
- Document hashes provide version lineage without copying sensitive document contents into the ledger.
- Public redaction pseudonymizes private participant identities and re-chains the sanitized ledger.
- Collaboration approval remains separate from the six approval stages in `case.json`.

추적: #28

## 횡단 품질

- 다관할 계약 격리
- 공개본 개인정보·경로 차단
- 패턴과 사실의 오염 방지
- 공동 명의 동의 만료
- 기존 MVP 회귀 테스트

추적: #29
