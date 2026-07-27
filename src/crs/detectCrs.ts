import proj4 from 'proj4';
import { lookupEpsg } from './projections';
import type { CrsDetectionResult } from '../types';

/**
 * COMPD_CS["...", PROJCS[...], VERT_CS[...]] 에서 내부 PROJCS/GEOGCS 블록을
 * 브래킷 카운팅으로 추출합니다. 다른 형식이면 원본을 그대로 반환합니다.
 */
function extractInnerCrs(wkt: string): string {
  const upper = wkt.trim().toUpperCase();
  if (!upper.startsWith('COMPD_CS')) return wkt;

  // PROJCS 또는 GEOGCS 블록 시작 위치 탐색
  for (const kw of ['PROJCS[', 'GEOGCS[', 'PROJCRS[', 'GEOGCRS[']) {
    const idx = upper.indexOf(kw);
    if (idx < 0) continue;
    let depth = 0;
    for (let i = idx; i < wkt.length; i++) {
      if (wkt[i] === '[') depth++;
      else if (wkt[i] === ']') {
        depth--;
        if (depth === 0) return wkt.slice(idx, i + 1);
      }
    }
  }
  return wkt;
}

/**
 * WKT 문자열에서 선형 단위 계수(m/unit)를 추출합니다.
 */
function extractLinearUnit(wkt: string): number {
  const lenMatch = wkt.match(/LENGTHUNIT\s*\[\s*"[^"]*"\s*,\s*([\d.]+(?:[eE][+-]?\d+)?)/i);
  if (lenMatch) {
    const f = parseFloat(lenMatch[1]);
    if (f > 0) return f;
  }
  const allUnits = [...wkt.matchAll(/\bUNIT\s*\[\s*"[^"]*"\s*,\s*([\d.]+(?:[eE][+-]?\d+)?)/gi)];
  for (let i = allUnits.length - 1; i >= 0; i--) {
    const f = parseFloat(allUnits[i][1]);
    if (f >= 0.05) return f;
  }
  return 1.0;
}

/**
 * WKT에서 EPSG 코드를 추출합니다.
 */
function extractEpsgCode(wkt: string): string | null {
  const idMatches = [...wkt.matchAll(/\bID\s*\[\s*"EPSG"\s*,\s*(\d+)/gi)];
  if (idMatches.length > 0) return idMatches[idMatches.length - 1][1];
  const authMatch = wkt.match(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d+)"/i);
  if (authMatch) return authMatch[1];
  return null;
}

/**
 * COPC 파일의 WKT VLR에서 좌표계·단위를 자동 감지합니다.
 * WKT가 없거나 CRS를 판단할 수 없으면 null을 반환합니다 — 호출 측에서
 * 기본값(EPSG:4326) 사용 여부를 결정합니다.
 *
 * @param wkt COPC info VLR의 WKT 문자열
 * @param url proj4에 등록할 임시 좌표계 이름을 만들 때 사용하는 COPC URL
 */
export function detectCrs(wkt: string | undefined, url: string): CrsDetectionResult | null {
  if (!wkt) return null;
  const trimmed = wkt.trim();

  const crsWkt = extractInnerCrs(trimmed);
  const crsUpper = crsWkt.toUpperCase();

  if (/^GEOG(?:CS|CRS)\b/.test(crsUpper) || /^GEOGRAPHICCRS\b/.test(crsUpper) || /^GEODCRS\b/.test(crsUpper)) {
    return { proj: 'EPSG:4326', projDef: null, zFactor: 1.0, xyFactor: 111320 };
  }

  const zFactor = extractLinearUnit(trimmed);
  const proj = `CRS:${url.replace(/\W+/g, '_')}`;

  try {
    proj4.defs(proj, crsWkt);
    proj4(proj, 'EPSG:4326', [0, 0]);
    return { proj, projDef: crsWkt, zFactor, xyFactor: zFactor };
  } catch {
    // WKT2 또는 지원되지 않는 형식 → 2단계로
  }

  // COMPD_CS(수평+수직 CRS 복합)인 경우 trimmed 전체에서 찾으면 마지막
  // ID[...]가 수직 CRS(예: NAVD88)의 EPSG 코드일 수 있으므로, 앞서 추출한
  // 수평 CRS 블록(crsWkt)에서만 찾는다.
  const epsgCode = extractEpsgCode(crsWkt);
  if (epsgCode) {
    const proj4Def = lookupEpsg(epsgCode);
    if (proj4Def) {
      proj4.defs(proj, proj4Def);
      return { proj, projDef: proj4Def, zFactor, xyFactor: zFactor };
    }
  }

  return null;
}
