/** CopcDataSource 공개 옵션 */
export interface CopcDataSourceOptions {
  proj?: string;
  projDef?: string | null;
  geoidOffset?: number;
  concurrency?: number;
  debounceMs?: number;
  maxCacheNodes?: number;
  maxVisibleNodes?: number;
  pixelSize?: number;
  sseThreshold?: number;
}

/** WKT VLR에서 CRS를 자동 감지한 결과 */
export interface CrsDetectionResult {
  /** proj4에 등록된 좌표계 이름 (EPSG:xxxx 또는 CRS:<url 기반 식별자>) */
  proj: string;
  /** proj4.defs에 등록한 원본 정의 문자열 (지리좌표계인 경우 null) */
  projDef: string | null;
  /** Z축 단위를 미터로 변환하는 계수 */
  zFactor: number;
  /** XY축 단위를 미터로 변환하는 계수 */
  xyFactor: number;
}
