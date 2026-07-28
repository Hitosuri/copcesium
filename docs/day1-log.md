# Day 1 종료 기록 — 팀원 A (COPC metadata · CRS · hierarchy)

## 완료한 작업

- `src/types.ts`: `CopcDataSourceOptions`, `CrsDetectionResult`, `NodeBounds`,
  `NodeRenderData`, `LoadedNode` — 팀원 B와의 사전 인터페이스 합의 포함
- `src/crs/projections.ts`: 로컬 EPSG → proj4 정의 테이블 (한국/미국/유럽/일본/호주)
- `src/crs/detectCrs.ts`: WKT 기반 CRS 자동 감지 (지리좌표계 → proj4 직접 파싱 →
  로컬 테이블 폴백 4단계), COMPD_CS(수평+수직 복합) 처리
- `src/copc/node.ts`: `getDepth`, `getChildKeys` (옥트리 키 파싱)
- `src/copc/hierarchy.ts`: `Copc.create()` + `loadHierarchyPage()`로 메타데이터·
  계층 로딩
- `src/CopcDataSource.ts`: 위 모듈을 연결해 `load()`가 실제로 동작 (스텁 제거)
- 테스트 3개 파일, 13개 케이스 (`vi.mock('copc')`로 네트워크 없이 검증)
- 소스 코드 내 한글 주석/에러 메시지를 전부 영어로 번역

## Merge한 PR

- PR #7 (`feat: initialize COPC loading core`) — **오픈, 리뷰 대기 중** (아직 미병합)

## 발견한 문제 / 알려진 한계

- `detectCrs()`가 계산하는 `zFactor`/`xyFactor`(단위→미터 변환 계수)가
  `CopcDataSource.load()`에서 `resolved`로 옮겨지지 않고 버려짐 — Day2 Worker가
  실제 좌표 변환을 할 때 이 값을 저장할 자리를 다시 설계해야 함
- `loadCopcHierarchy()`는 루트 계층 페이지(`rootHierarchyPage`)만 로드하고
  `pages`(하위 계층 페이지)는 무시함 — 트리가 매우 커서 다중 페이지로 나뉜
  COPC 파일에서는 일부 노드가 누락될 수 있음
- `copc/hierarchy.ts`의 에러 메시지 변환 로직이 `copc` 패키지가 실제로 던지는
  에러 문구(`"Invalid header"` 등)에 의존하는 정규식 매칭이라, 패키지 버전업 시
  조용히 어긋날 수 있음

## 설계 변경 사항

- 원래 계획서(`copcesium 2인 팀 4일 병렬 업무 분담 계획.pdf`)는
  `src/copc/metadata.ts`와 `hierarchy.ts`를 분리하는 안이었으나, `Copc.create()`
  이후 cube 추출과 `loadHierarchyPage()`가 한 흐름이라 `hierarchy.ts` 하나로
  통합함 (PR #7 Design decisions에 기록)

## 다음 날 선행 조건

- 없음 — Day2 A 작업(WorkerPool, 포인트 변환 Worker, NodeCache) 바로 시작 가능
- 팀원 B는 이미 B-1(#13)/B-2(#16) 브랜치(`feat/13-...`, `feat/16-...`)로 작업 중

## 담당자별 기여

- **팀원 A**: Day1 전체 (metadata/hierarchy/CRS 이식, PR #7, Issue #8→#14/#9→#15
  재정리, 영어 번역, 이 로그)
- **팀원 B (Jangmyun)**: B-1/B-2 이슈(#13, #16) 생성 및 브랜치 작업 착수 (`main`에
  PR 템플릿 위치 조정 커밋 1건 포함)
