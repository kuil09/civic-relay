# ADR 0004: Local private cases and explicit public exports

- Status: accepted
- Date: 2026-08-27
- Issues: #2, #3, #19, #22

## Decision

실제 사례는 `cases/`에 로컬 저장하고 Git에서 기본 제외한다. 공개할 때는 `redact`로 별도 디렉터리를 만들고 redaction manifest를 남긴다.

## Consequences

공개 예제와 실제 사례의 경계가 명확해진다. 비공개 저장 자체를 암호화하지는 않으므로 운영체제와 저장장치 보안이 필요하다.
