# Civic Relay

Civic Relay는 시민이 생활 현장에서 발견한 문제를 **검증 가능한 정책 의제**, **권한 지도**, **정책 제안서**, **전달 패키지**로 변환하는 오픈소스 AI 에이전트 하네스다.

이 저장소는 중앙 웹서비스가 아니다. 저장소를 복제한 개인이나 단체가 자신의 에이전트 환경에서 사례를 조사하고, 파일로 검토하며, 명시적으로 승인한 뒤 공식 업무 연락 경로로 전달하도록 설계되어 있다.

## 무엇을 해결하는가

시민은 문제를 발견해도 다음을 알아내는 데 큰 비용을 치른다.

- 어느 법률·시행령·조례·운영규칙이 관련되는가
- 국회, 중앙부처, 지자체, 공공기관, 민간 관리주체 중 누가 권한을 갖는가
- 복수 상임위원회와 부처가 함께 논의해야 하는가
- 반대 의견과 권리 충돌을 포함해도 검토할 수 있는 대안은 무엇인가
- 어느 공식 경로로 무엇을 보내야 내부 검토와 이관이 가능한가

Civic Relay는 글쓰기보다 **제도 접근 비용**을 줄인다.

## 5분 시작

요구사항은 Node.js 22 이상뿐이다. 런타임 의존성은 없다.

```bash
# 저장소 안에서
node src/cli.js init apartment-night-delivery \
  --jurisdiction KR \
  --title "공동주택 심야 물류 하역" \
  --statement "오래된 공동주택의 심야 배송 정차 공간 문제를 검토하고 싶다."

node src/cli.js status cases/apartment-night-delivery
node src/cli.js validate cases/apartment-night-delivery
```

에이전트에게 직접 요청할 때는 다음 형식을 사용한다.

```text
Civic Relay로 새 사례를 시작한다.
문제: <자유로운 설명>
지역: <선택>
원하는 결과: 조사 / 정책 제안 / 전달 패키지 / 발송
```

에이전트는 `AGENTS.md`와 관련 `skills/*/SKILL.md`를 읽고 사례 파일을 채운다.

## 기본 명령

```bash
node src/cli.js init <slug> [--title <title>] [--statement <text>] [--jurisdiction <adapter-id>]
node src/cli.js validate <case-path> [--json]
node src/cli.js readiness <case-path> [--stage case|send|publication]
node src/cli.js status <case-path>
node src/cli.js build <case-path>
node src/cli.js verify-recipients <case-path> [--max-age-hours 24]
node src/cli.js approve <case-path> --stage <stage> --actor <name> --confirm-human
node src/cli.js draft-mail <case-path>
node src/cli.js dispatch <case-path> --mode draft|send
node src/cli.js record-response <case-path> --recipient <id> --classification <type> --file <path>
node src/cli.js redact <case-path> [--output <path>]
node src/cli.js collaboration-add-participant <case-path> --id <participant-id> --name <display-name> --kind human|organization|ai --role <role|role>
node src/cli.js collaboration-record <case-path> --type <event-type> --actor <id> --target <file[#/pointer]>
node src/cli.js collaboration-status <case-path> --target <file[#/pointer]> [--identity <id|id>]
```

`validate` reports structural validity only. Use `readiness --stage case|send|publication` for semantic and operational readiness. `build` may create an incomplete review preview, but its manifest and review document report structural validation and case readiness separately. A successful preview build does not mean the case is ready to publish or send.

`dispatch --mode send`는 기본적으로 비활성화되어 있다. 유효한 6단계 승인, 최신 수신자 검증, 중복 발송 검사, 외부 메일 어댑터가 모두 있어야 실행된다.

## 관할 어댑터

법체계·의회·행정부·공식 자료원은 관할 어댑터로 분리한다.

```bash
node src/cli.js jurisdictions
node src/cli.js jurisdiction KR
node src/cli.js jurisdiction US-FED
```

현재 대한민국과 미국 연방정부 어댑터가 포함되어 있다. 어댑터에는 현직자 명단과 직접 연락처를 저장하지 않는다. 공식 조회 경로와 정규화·현재성 검증 규칙만 제공한다. 알 수 없는 관할 ID는 기본 관할로 대체되지 않고 오류가 된다.

`init --jurisdiction <adapter-id>` records the selected adapter in `case.json.jurisdiction.adapter_id`. Omitting the option uses the documented `KR` default and prints that choice; neither the statement language nor the working directory selects a jurisdiction. Use `jurisdictions` before initialization when the applicable jurisdiction is uncertain. An unknown adapter is rejected before any case directory is created.

## 공개 사례 라이브러리

익명화된 사례는 실제 발송과 분리된 정적 공개 번들로 만들 수 있다.

```bash
node src/cli.js redact cases/example --output build/example-redacted
node src/cli.js publish-case build/example-redacted --output public/example
node src/cli.js build-library public
```

공개 번들의 `dispatchable` 값은 항상 `false`다. 재사용 대상은 문제 프레임·조사 질문·이해관계자 역할·정책 대안·반론 패턴이다. 원 사례의 사실·출처·수신자·발송·회신·동의는 새 사례로 이전되지 않는다.

## Optional collaboration ledger

Collaboration is opt-in and does not migrate existing local cases. `collaboration.json` is an append-only, hash-chained event ledger. It does not replace the six human approval stages in `case.json`.

```bash
node src/cli.js collaboration-add-participant cases/example \
  --id author-1 --name "Kim Citizen" --kind human --role case_author
node src/cli.js collaboration-record cases/example \
  --type contribution --actor author-1 --target 07-policy-proposal.md
node src/cli.js collaboration-record cases/example \
  --type co-sign-consent --actor author-1 --identity author-1 \
  --target 07-policy-proposal.md --confirm-human
node src/cli.js collaboration-status cases/example \
  --target 07-policy-proposal.md --identity author-1
```

Participation and contribution never imply co-signature consent. Consent is bound to the target document hash, becomes stale when the document changes, and requires explicit human confirmation. Conflicts link earlier entries for different hashes of one target; only a human can resolve them for the current hash, and unresolved conflicts block joint attribution. `collaboration-status` exposes the hash lineage without copying historical document contents into the ledger. `redact` pseudonymizes private participant identities while preserving ledger integrity and making copied consent and resolution records non-authoritative.

The supported roles are `case_author`, `evidence_reviewer`, `policy_editor`, `recipient_verifier`, `dispatch_approver`, and `public_release_manager`. They describe provenance and responsibility, not authority. Event types are `participant_registered`, `contribution`, `review`, `dissent`, `conflict_opened`, `conflict_resolved`, `approval`, `co_sign_consent`, and `consent_withdrawal`. The human-only events are `approval`, `co_sign_consent`, `consent_withdrawal`, and `conflict_resolved`; each requires `--confirm-human`. Conflict outcomes are `adopt_current`, `merged`, and `rejected_change`. For list options such as `--role` and `--identity`, use a comma or a quoted pipe, for example `--role 'case_author|policy_editor'`.

## 사례 산출물

```text
cases/<case-slug>/
├── 00-intake.md
├── 01-issue-brief.md
├── 02-evidence-dossier.md
├── 03-law-and-authority-map.md
├── 04-stakeholder-map.md
├── 05-options-memo.md
├── 06-counterarguments.md
├── 07-policy-proposal.md
├── 08-recipient-matrix.csv
├── 09-cover-emails/
├── 10-dispatch-manifest.json
├── 11-responses/
├── 12-follow-up.md
├── collaboration.json          # optional
└── case.json
```

`build` 명령은 다음 검토 패키지를 만든다.

- 한 페이지 요약
- 정책 제안서
- 근거 부록
- 수신자 매트릭스
- 승인·현재성·누락 항목을 모은 리뷰 문서
- 문서 해시가 포함된 패키지 명세

## 작업 단계

```text
문제 입력
→ 사실·가설 분리
→ 공식 자료 조사
→ 법·제도 계층 분석
→ 권한·상임위원회 라우팅
→ 이해관계자·반론 분석
→ 정책 대안 비교
→ 정책 제안서
→ 수신자 현재성 검증
→ 사용자 승인
→ 개별 초안 또는 발송
→ 회신·후속 조치
```

## 승인 단계

1. `problem` — 문제 정의
2. `evidence` — 근거와 불확실성
3. `policy` — 대안과 반론
4. `recipients` — 수신자와 선정 이유
5. `document` — 제목·본문·첨부·배포 고지
6. `dispatch` — 지금 이 채널로 보낼 것인지

승인에는 사람의 이름, 시각, 대상 파일과 구조화 데이터의 해시가 남는다. 승인 뒤 내용이 바뀌면 기존 승인은 만료된다.

## 핵심 원칙

- 정당이나 인지도가 아니라 실제 권한으로 라우팅한다.
- 사용자의 원문과 AI의 분석을 구분한다.
- 공식 1차 자료를 우선하고 모든 핵심 사실에 출처를 붙인다.
- 가장 강한 반론과 현행 유지안을 포함한다.
- 현직자·조직·연락처는 발송 직전에 다시 검증한다.
- 여러 수신자에게 같은 핵심 문서를 개별적으로 전달한다.
- 사용자가 명시적으로 승인하지 않은 문장은 보내지 않는다.
- 동일 사례·문서·수신자의 반복 발송을 차단한다.
- 실제 이메일·토큰·개인 사례는 저장소에 커밋하지 않는다.
- 공개 사례는 사실 데이터베이스나 발송 목록으로 사용하지 않는다.

## 대표 예제

[`examples/apartment-night-delivery/`](examples/apartment-night-delivery/)는 공동주택 심야 물류 하역 문제를 다음 권리와 책임의 충돌로 다룬다.

- 장애인 이동권
- 물류 노동자의 작업 안전
- 입주민의 통행과 소방·회차 안전
- 오래된 공동주택의 구조적 주차 부족
- 관리사무소·택배사·지자체·국회·정부의 권한 차이

예제의 수신자 정보는 실제 발송에 재사용할 수 없도록 기본적으로 만료 상태다.

## 개발

```bash
npm test
npm run check
npm run validate:example
```

기술 결정은 [`docs/adr/`](docs/adr/)에 기록한다. 기여자는 먼저 [`CONTRIBUTING.md`](CONTRIBUTING.md)와 [`AGENTS.md`](AGENTS.md)를 읽어야 한다.

## 문서

- [PRD](PRD.md)
- [철학](PHILOSOPHY.md)
- [에이전트 운영 계약](AGENTS.md)
- [데이터 모델](docs/data-model.md)
- [스킬 계약](docs/skill-contract.md)
- [관할 어댑터](docs/jurisdiction-adapters.md)
- [공개 사례 라이브러리](docs/public-case-library.md)
- [Redaction manifest](docs/redaction-manifest.md)
- [Collaboration ledger](docs/collaboration.md)
- [로드맵](ROADMAP.md)

## 라이선스

MIT
