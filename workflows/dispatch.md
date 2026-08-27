# Dispatch Workflow

1. 수신자 공식 경로와 현직을 다시 검증한다.
2. `recipients`와 `document` 승인의 해시를 확인한다.
3. `delivery-packaging`으로 개별 초안을 만든다.
4. `build/review.md`에서 제목·본문·첨부·배포 고지를 검토한다.
5. 사용자가 `dispatch`를 승인한다.
6. 중복 키를 검사한다.
7. 수신자별로 개별 발송한다.
8. 결과를 `10-dispatch-manifest.json`과 `case.json.dispatches`에 기록한다.

어느 게이트라도 실패하면 실제 외부 변경은 0건이어야 한다.
