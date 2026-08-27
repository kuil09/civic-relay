# Jurisdiction Adapter Contract

관할 어댑터는 코어의 정책 판단을 대신하지 않고 국가·지역별 제도 구조와 공식 검증 경로를 설명한다.

현재 기본 어댑터:

- `KR.json` — 대한민국
- `US-FED.json` — 미국 연방정부

어댑터는 다음 항목을 제공한다.

```json
{
  "id": "KR",
  "legal_layers": [],
  "authority_types": [],
  "official_sources": [],
  "recipient_roles": [],
  "normalization": {},
  "verification_policy": {}
}
```

## 금지 데이터

- 현직자 명단
- 의원·공무원·담당자의 이름
- 직접 이메일·전화번호
- 장기 보존된 수신자 목록

어댑터는 공식 조회 경로와 정규화·검증 규칙만 제공한다. 실행 시점에 확인한 사람·기관·연락 채널은 사례 데이터에 `verified_at`과 출처를 붙여 저장하며, 어댑터의 영구 상수로 취급하지 않는다.

## 명령

```bash
node src/cli.js jurisdictions
node src/cli.js jurisdictions --json
node src/cli.js jurisdiction KR
node src/cli.js jurisdiction US-FED
```

사용자 정의 어댑터는 별도 디렉터리에 두고 `--root`로 검증할 수 있다.

```bash
node src/cli.js jurisdictions --root ./my-adapters
node src/cli.js jurisdiction LOCAL-CITY --root ./my-adapters
```

알 수 없는 관할 ID는 기본 관할로 조용히 대체되지 않고 오류가 된다.
