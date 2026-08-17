import { EPSG_TABLE } from './epsgTable';

/**
 * Looks up a proj4 definition string from the local table by EPSG code.
 * @param code  EPSG code (number or string)
 */
export function lookupEpsg(code: string | number): string | null {
  return EPSG_TABLE[parseInt(String(code), 10)] ?? null;
}
