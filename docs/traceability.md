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
