/**
 * C# `Math.Round(double)`: nearest integer, a midpoint goes to the even neighbour
 * (item 40). `Math.round` would send every midpoint up. Never returns -0.
 */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  let result: number;
  if (diff < 0.5) result = floor;
  else if (diff > 0.5) result = floor + 1;
  else result = floor % 2 === 0 ? floor : floor + 1;
  return result === 0 ? 0 : result;
}
