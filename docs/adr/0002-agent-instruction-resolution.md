# ADR 0002: AGENTS.md is the single operating contract

- Status: accepted
- Date: 2026-08-27
- Issues: #1, #4, #22

## Decision

`AGENTS.md`를 핵심 행동 규칙의 단일 진실 공급원으로 삼는다. `CLAUDE.md`와 향후 도구별 파일은 이를 참조하는 얇은 어댑터다. 스킬은 단계별 계약만 추가한다.

## Consequences

중복 규칙의 드리프트를 줄인다. 도구별 파일이 충돌하면 `AGENTS.md`가 우선한다.
