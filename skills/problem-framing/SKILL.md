# problem-framing

## 목적

개인의 경험을 조사 가능한 공공 문제로 정의하고 현상·원인 가설·영향·범위를 분리한다.

## 실행 조건

`00-intake.md`와 `original_statement`가 존재할 때.

## 입력

- `00-intake.md`
- `case.json.original_statement`, `jurisdiction`, `desired_change`

## 절차

- 관찰된 현상을 한 문장으로 적는다.
- 사용자의 원인 설명을 검증 전 가설로 분리한다.
- 피해·비용·권리 영향과 영향을 받는 집단을 식별한다.
- 개인 사례가 공공 문제로 일반화될 근거와 한계를 적는다.
- 공간·시간·시설·대상 범위를 지나치게 넓히지 않는다.
- 조사로 반증 가능한 질문을 만든다.

## 판단 규칙

- `AGENTS.md`의 공식 자료 우선순위와 승인 경계를 따른다.
- 사실과 관찰, 추론, 가치 판단, 제안을 혼합하지 않는다.
- 실행 결과는 `complete`, `partial`, `blocked`, `not_applicable` 중 하나로 기록한다.

## 출력

- `01-issue-brief.md`
- 초기 observation/inference/proposal claims

## `case.json` 변경 범위

- `problem_definition`, `claims`, `jurisdiction`, `status`

선언한 필드 밖의 구조화 상태와 승인 이력은 변경하지 않는다.

## 자체 검증

- 문제와 해결안이 별도 문단이다.
- 원인 가설에는 미검증 표시가 있다.
- 과잉 일반화의 한계가 기록된다.

## 실패·불확실성 처리

- 공공성 근거가 약하면 개인 민원일 가능성을 기록한다.
- 서로 다른 문제는 하위 문제 또는 별도 사례 후보로 나눈다.

## 금지 행동

- 사용자의 최초 안을 문제 정의와 동일시
- 통계 없이 빈도·규모를 단정
- 감정 표현을 사실 근거로 사용
- 승인 레코드를 스스로 생성하거나 사람을 대신해 승인하지 않는다.

## 다음 단계

`evidence-research`

## PRD 추적

CR-002~005, AC-01, PRD 8~9
