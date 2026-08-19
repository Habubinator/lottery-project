/** Floor TON to 2 decimal places (never round up — safe for balance checks). */
export function floorTonAmount(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}
