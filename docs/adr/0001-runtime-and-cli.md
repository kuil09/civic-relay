# ADR 0001: Node.js 22 ESM and zero runtime dependencies

- Status: accepted
- Date: 2026-08-27
- Issues: #5, #22

## Context

저장소는 다양한 에이전트 환경에서 복제되어야 하고 설치 실패가 정책 작업을 막아서는 안 된다.

## Decision

Node.js 22 이상, ESM, 런타임 의존성 0을 사용한다. CLI 인자, 해시, 파일, 테스트는 Node 표준 라이브러리로 구현한다.

## Consequences

- `npm install` 없이 핵심 명령과 테스트를 실행할 수 있다.
- 완전한 JSON Schema 검증기 대신 코어 불변조건 검증을 직접 유지한다.
- 향후 의존성을 추가할 때 이식성·보안·공급망 비용을 ADR로 설명해야 한다.

## Revisit when

표준 라이브러리만으로 유지하기 어려운 관할 어댑터나 문서 렌더러가 코어에 들어올 때.
