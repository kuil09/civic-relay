# 관할 어댑터

## 목적

Civic Relay의 정책 분석 코어는 특정 국가의 법체계·의회 명칭·행정부 구조를 상수로 갖지 않는다. 관할 어댑터는 다음 정보를 교체 가능한 데이터로 제공한다.

- 법적 계층과 상대적 순위
- 권한 주체 유형과 가능한 조치
- 법령·의회·행정의 공식 자료원
- 수신자를 찾기 위한 역할과 공식 해석 경로
- 언어·시간대·날짜·직책·연락 채널 정규화
- 법령과 수신자 정보의 현재성 정책

## 어댑터가 하지 않는 일

어댑터는 정책 결론을 내리거나 현직자를 영구 저장하지 않는다. 다음 정보는 실행 시점에 공식 자료로 다시 확인해야 한다.

- 현직 의원·위원·부처 담당자
- 위원장·간사·소위원회 구성
- 조직 개편 이후의 부서명
- 공개 업무 이메일·문의 폼·우편 주소
- 법안 상태와 시행 중인 조문

## 파일 구조

```text
adapters/jurisdiction/
├── KR.json
├── US-FED.json
└── README.md
```

파일명은 어댑터 `id`와 일치해야 한다. ID는 대문자와 숫자, 하이픈만 사용한다.

## 현재성

`verification_policy`는 최소한 다음을 정의한다.

- `recipient_ttl_hours`
- `law_ttl_hours`
- `official_source_required: true`
- `unknown_id_policy: error`

TTL은 사실이 자동으로 틀렸다는 의미가 아니라, 외부 전달 전에 다시 확인해야 한다는 뜻이다.

## 두 번째 관할을 두는 이유

대한민국과 미국 연방정부는 법적 계층, 의회 구조, 행정 규칙의 형식이 다르다. 두 어댑터가 같은 코어 계약을 통과하게 함으로써 대한민국의 제도 명칭을 공통 모델로 오인하는 것을 방지한다.

## Case Initialization

Select the adapter explicitly when creating a case:

```bash
node src/cli.js init example-case --jurisdiction US-FED
```

The selected ID is stored as `case.json.jurisdiction.adapter_id`. For legacy compatibility the field is optional in the schema, so cases created before this field was introduced remain valid. When `--jurisdiction` is omitted, the CLI uses the documented `KR` default and reports that decision. It never infers jurisdiction from language, current directory, or locale. Adapter validation happens before case directory creation, so an invalid or unknown ID leaves no partial case.

## 확장 절차

1. `schemas/jurisdiction-adapter.schema.json`을 따른 JSON 파일을 만든다.
2. 현직자·직접 연락처를 넣지 않는다.
3. 공식 자료원은 HTTPS 주소와 용도를 기록한다.
4. `jurisdictions --root`로 검증한다.
5. 기존 두 관할과 다른 구조가 표현되는지 테스트한다.
6. 코어를 수정해야 한다면 관할 차이인지 제품 공통 개념인지 먼저 구분한다.
