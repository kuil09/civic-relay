# ADR 0005: File drafts by default and explicit external send adapter

- Status: accepted
- Date: 2026-08-27
- Issues: #16, #17, #22

## Decision

기본 어댑터는 수신자별 `.eml` 또는 공식 문의용 Markdown을 `build/outbox/`에 만드는 file-outbox다. 실제 `send`는 `CIVIC_RELAY_MAIL_ADAPTER` 환경변수로 지정한 외부 실행 파일과 JSON stdin/stdout 프로토콜을 사용한다.

## Required send gates

- 6단계 승인
- 승인 해시 유효성
- 수신자 검증 24시간 이내
- 공식 업무 채널
- 배포 고지 일치
- 중복 발송 키 부재

## Consequences

코어는 Gmail 등 특정 공급자 자격증명을 보유하지 않는다. 에이전트 호스트가 제공하는 메일 도구를 작은 어댑터로 연결할 수 있다.
