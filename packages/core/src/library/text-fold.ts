const NON_ASCII = /[^\t\n\r -~]/g;

const foldedUnits = new Map<string, string>();

function foldUnit(unit: string): string {
  const known = foldedUnits.get(unit);
  if (known !== undefined) return known;
  const base = (unit.normalize('NFD')[0] ?? unit).toLowerCase();
  const result = base.length === 1 ? base : unit;
  foldedUnits.set(unit, result);
  return result;
}

/**
 * Lowercase with accents removed, one UTF-16 unit for one unit: an offset found in the result is
 * the same offset in the original. Text that stores its accents as separate marks keeps the marks,
 * because dropping them would break that promise.
 */
export function foldText(text: string): string {
  return text.replace(NON_ASCII, foldUnit).toLowerCase();
}

/** The words of a search, folded. A decomposed query is composed first, so it folds as typed text. */
export function foldedWords(query: string): readonly string[] {
  return foldText(query.normalize('NFC'))
    .split(/\s+/)
    .filter((word) => word !== '');
}

export function hasAllWords(foldedValue: string, words: readonly string[]): boolean {
  return words.every((word) => foldedValue.includes(word));
}
