# ADR 0006: Recipient verification expires after 24 hours for send

- Status: accepted
- Date: 2026-08-27
- Issues: #14, #15, #17, #22

## Decision

실제 발송의 기본 현재성 유효기간은 24시간이다. 초안과 조사에는 오래된 데이터를 표시한 채 사용할 수 있지만 `send`에는 사용할 수 없다. 관할 설정은 더 짧게 만들 수 있으나 자동으로 늘릴 수 없다.

## Rationale

위원회 배치, 직책, 조직 개편, 공개 연락 경로는 짧은 기간에도 바뀔 수 있다. 발송 직전 검증 비용이 오발송 비용보다 작다.
