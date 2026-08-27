# 공개 사례 라이브러리

## 목적

공개 사례 라이브러리는 익명화된 정책 사례를 정적 번들로 내보내고, 다른 사용자가 문제 구조·대안·반론 패턴을 참고할 수 있게 한다. 공개 사례는 발송 목록이나 사실 데이터베이스가 아니다.

## 게시 흐름

```text
비공개 사례
→ redact
→ 익명화 결과 검토
→ publish-case
→ 공개 번들 검증
→ build-library
```

```bash
node src/cli.js redact cases/example --output build/example-redacted
node src/cli.js publish-case build/example-redacted --output public/example
node src/cli.js build-library public
```

## 공개 번들

```text
public/example/
├── public-case.json
├── summary.md
├── policy-patterns.json
├── redaction-manifest.json
└── integrity-manifest.json
```

`public-case.json`의 `dispatchable` 값은 항상 `false`다. 공개된 수신자 정보나 과거 검증 결과를 실제 전달에 사용할 수 없다.

## 재사용 가능한 것

- 문제 정의 방식
- 조사 질문
- 이해관계자 역할·관심·위험 패턴
- 정책 대안의 메커니즘
- 비용·집행·권리 영향·되돌림 가능성 비교축
- 반론·대응·잔여 위험 구조

## 재사용할 수 없는 것

- 원 사례의 사실과 출처를 새 사례의 사실로 간주하는 것
- 수신자·연락처·현직 정보
- 발송·회신 기록
- 사용자 원문과 개인 식별정보
- 원 사례의 작성자·동의·대표성을 새 사례로 이전하는 것

## 무결성과 재현성

공개 번들은 파일별 SHA-256 해시를 갖는다. 동일한 익명화 스냅샷을 반복 게시하면 핵심 파일 내용이 같아야 한다. 카탈로그는 상대 번들 경로만 기록하며 원본 로컬 경로를 노출하지 않는다.

## 실패 조건

다음 조건에서는 게시가 중단된다.

- `redaction-manifest.json` 부재
- 이메일·전화번호·토큰 잔존
- 로컬 절대 경로 노출
- 금지된 사례 고유 필드 포함
- 무결성 해시 불일치
- 중복 `publication_id`
