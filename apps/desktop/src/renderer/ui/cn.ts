/** Joins class names, skipping falsy parts. Tokens are few enough that no merge step is needed. */
export function cn(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
