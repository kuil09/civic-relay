# Architecture

## 시스템 경계

Civic Relay 코어는 외부 웹서비스가 아니라 로컬 파일을 읽고 쓰는 결정론적 도구다. 검색, 브라우저, 메일, 문서 렌더러는 에이전트 호스트가 제공하는 선택적 어댑터다.

```text
사용자
  ↓
에이전트 오케스트레이터
  ├─ skills/*/SKILL.md
  ├─ 공식 자료 검색 도구
  ├─ Civic Relay CLI
  │    ├─ case.json
  │    ├─ Markdown artifacts
  │    ├─ validation / approval / hash
  │    └─ build / redact / dispatch request
  └─ 외부 어댑터
       ├─ 웹 검색
       ├─ 메일
       └─ PDF 등 렌더러
```

## 정본

- `case.json`: 사례 상태, 구조화 엔터티, 승인·발송·회신 이력
- `00`~`12` 문서: 사람이 검토하는 근거와 판단의 서술
- `build/package-manifest.json`: 특정 시점의 전달 패키지 해시
- `10-dispatch-manifest.json`: 실제 외부 변경 이력

구조화 데이터와 문서가 충돌하면 자동으로 한쪽을 정답으로 선택하지 않는다. 검증 오류로 보고하고 사람이 수정한다.

## 신뢰 경계

1. 사용자 원문은 신뢰하지 않되 변형하지 않고 보존한다.
2. 외부 검색 결과는 공식 원문을 확인하기 전까지 근거 후보다.
3. 저장소의 현직자·연락처 예시는 항상 오래된 것으로 본다.
4. AI가 만든 승인 레코드는 무효다.
5. 외부 어댑터의 성공 응답은 공급자 ID와 함께 기록하되 정책적 효과로 해석하지 않는다.

## 상태 흐름

```text
intake → research → draft → review → approved → dispatched → follow_up → closed
```

상태는 작업의 진척을 나타낼 뿐 품질 보증이 아니다. 각 상태에는 별도의 검증 불변조건이 적용된다.

## 확장점

- `skills/`: 모델과 무관한 작업 계약
- `adapters/jurisdiction/`: 법체계·의회·행정부·공식 자료원의 관할별 차이
- 외부 메일 어댑터: JSON stdin/stdout 프로토콜
- 렌더러: Markdown 정본에서 PDF 등 파생물 생성
