# Jurisdiction Adapter Contract

관할 어댑터는 코어의 정책 판단을 대신하지 않고 해당 국가·지역의 제도 구조를 설명한다.

최소 산출물:

```json
{
  "id": "KR",
  "legal_layers": [],
  "authority_types": [],
  "official_sources": [],
  "recipient_roles": [],
  "verification_policy": {}
}
```

어댑터는 현직자 명단을 영구 상수로 제공하지 않는다. 공식 조회 경로와 정규화 규칙을 제공하고 실행 시점 결과에는 `verified_at`을 붙인다.
