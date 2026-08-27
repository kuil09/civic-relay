# Data Model

## 설계 원칙

- 사례의 구조화 정본은 `case.json`이다.
- 모든 식별자는 사례 안에서 안정적이어야 한다.
- 시간은 ISO 8601 UTC다.
- 외부 사실과 수신자에는 마지막 검증 시각이 있다.
- 승인과 발송 이력은 덮어쓰지 않고 추가한다.
- 공개본에서 제거할 필드는 스키마의 `x-civic-relay-sensitive`로 표시한다.

## Case

주요 필드:

| 필드 | 의미 |
|---|---|
| `schema_version` | 데이터 모델 버전 |
| `case_id` | 사례 안정 식별자 |
| `status` | 현재 단계 |
| `jurisdiction.adapter_id` | Adapter selected by `init --jurisdiction`; optional only for legacy cases |
| `original_statement` | 사용자의 최초 원문 |
| `problem_definition` | 조사 가능한 문제 정의 |
| `claims` | 관찰·사실·추론·가치 판단·제안 |
| `sources` | 출처와 현재성 메타데이터 |
| `legal_layers` | 변경 가능한 법·제도 계층 |
| `authorities` | 입법·행정·집행·감독·운영 권한 |
| `stakeholders` | 수혜·부담·권리·집행 주체 |
| `options` | 현행 유지안을 포함한 대안 |
| `counterarguments` | 강한 반론과 잔여 위험 |
| `recipients` | 권한에 근거한 실제 전달 대상 |
| `approvals` | 사람의 단계별 승인과 해시 |
| `dispatches` | 외부 전달 결과 |
| `responses` | 회신과 후속 작업 |

## Claim

`type`은 다음 중 하나다.

- `observation`: 사용자가 직접 관찰한 사실. `origin=user_observation` 필요
- `fact`: 외부에서 검증 가능한 사실. 최소 하나의 `source_ids` 필요
- `inference`: 사실에서 도출한 해석
- `value_judgment`: 가치 선택
- `proposal`: 바꾸고 싶은 규칙이나 운영 방식

`use_in_proposal=true`인 주장은 출처 또는 사용자 관찰 표시가 없으면 검증 오류다.

## Source

- `source_type`: law, assembly, government, statistics, research, media, stakeholder, community
- `official`: 공식 1차 자료인지
- `published_at`, `checked_at`, `effective_at`
- `locator`: URL 또는 문서 식별자
- `supports`, `contradicts`: 연결된 주장 ID
- `confidence`: high, medium, low

## Authority와 Legal Layer

법적 계층과 권한 주체를 분리한다. 법률을 바꾸는 주체와 집행하는 주체가 같지 않을 수 있기 때문이다.

- `legal_layers[].level`: law, decree, ordinance, local_rule, guideline, management_rule, private_policy
- `authorities[].action`: legislate, regulate, administer, enforce, supervise, operate, convene
- `authorities[].jurisdiction`: direct, joint, reference

## Recipient

수신자는 권한 지도를 발송 시점의 실제 기관·의원실·공식 채널로 해석한 결과다.

필수 필드:

- `recipient_id`
- `organization`
- `role`
- `jurisdiction_type`
- `reason`
- `expected_action`
- `official_channel`
- `channel_source`
- `verified_at`
- `selected`
- `verification_status`

`selected=true`인 수신자는 `send` 직전에 현재성 게이트를 통과해야 한다.

## Approval

- `stage`: problem, evidence, policy, recipients, document, dispatch
- `actor`: 승인한 사람
- `confirmed_human`: 반드시 true
- `approved_at`
- `content_hash`
- `scope`: 해시에 포함된 파일과 구조화 필드

승인 대상이 바뀌면 재계산한 해시가 달라지고 승인은 자동으로 만료된다.

## Dispatch

중복 키는 다음으로 계산한다.

```text
sha256(case_id + document_hash + recipient_id)
```

공급자 결과와 관계없이 같은 성공 키는 자동 재발송하지 않는다.

## Response

- 원문 파일
- 수신자·발송 ID
- 분류
- AI 요약
- 사람이 수정한 분류
- 추가 조사와 후속 요청

회신 부재는 `no_response` 상태이지 거부가 아니다.
