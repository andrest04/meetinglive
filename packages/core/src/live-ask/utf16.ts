/**
 * UTF-16 safe cuts for the live answer path. The C# code cut by code unit and could split a
 * surrogate pair, leaving a lone surrogate in the prompt (live-copilot bug 16). These cuts take
 * at most `max` code units and drop a half pair instead of keeping it.
 */

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** The first `max` code units, without a trailing half of a surrogate pair. */
export function takeHead(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.length > 0 && isHigh(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
}

/** The last `max` code units, without a leading half of a surrogate pair. */
export function takeTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  return cut.length > 0 && isLow(cut.charCodeAt(0)) ? cut.slice(1) : cut;
}
