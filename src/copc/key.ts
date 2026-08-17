/** Parses a COPC hierarchy node key ("D-X-Y-Z") into its four integer components. */
export function parseKey(key: string): [number, number, number, number] {
  return key.split('-').map(Number) as [number, number, number, number];
}
