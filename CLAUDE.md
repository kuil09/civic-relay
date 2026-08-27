# Claude Code Adapter

이 저장소의 단일 운영 계약은 [`AGENTS.md`](AGENTS.md)다.

Claude Code는 작업을 시작하기 전에 다음 순서로 읽는다.

1. `AGENTS.md`
2. 현재 사례의 `case.json`
3. 현재 단계에 해당하는 `skills/<name>/SKILL.md`
4. 관련 `workflows/*.md`
5. 필요한 경우 `PRD.md`

핵심 정책을 이 파일에 중복 정의하지 않는다. `AGENTS.md`와 충돌하는 지시가 있으면 `AGENTS.md`를 우선하고 충돌을 보고한다.

외부 메일 발송, 문의 폼 제출, 이슈 생성 등 상태를 바꾸는 작업은 관련 승인 레코드와 사용자의 현재 요청을 모두 확인한 뒤 수행한다.
