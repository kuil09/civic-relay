# 공동주택 심야 물류 하역 예제

이 예제는 한 시민의 생활 관찰을 법·권한·이해관계·대안·반론·전달 경로로 구조화한다.

## 중요한 경계

- 장애인전용주차구역 예외안을 제품의 정답으로 채택하지 않는다.
- 현직 의원 이름과 실제 이메일을 저장하지 않는다.
- 모든 수신자는 `stale_by_design`, `selected=false`다.
- 실제 사용자는 공식 자료 조사와 현재성 검증을 다시 실행해야 한다.
- 실제 발송은 하지 않는다.

## 검증

```bash
node src/cli.js validate examples/apartment-night-delivery
node src/cli.js build examples/apartment-night-delivery
```

`build`는 예제 디렉터리를 수정하므로 저장소 작업 트리에서 결과를 확인한 뒤 생성물을 제거하거나 별도 복사본에서 실행한다.
