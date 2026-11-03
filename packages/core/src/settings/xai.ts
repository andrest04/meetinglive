/** xAI (Grok) model choice rules. Spec 2.5. The network and the credentials belong to the xAI module. */

export const DEFAULT_XAI_MODEL_ID = 'grok-4.6';
const PREFERRED = ['grok-4.6', 'grok-4.7', 'grok-4.3', 'grok-4.5', 'grok-4-fast'];

const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * The model to use: the saved one when it is listed (ignoring case, in the saved casing), the
 * default when nothing is listed, then the preferred order, then the first listed.
 */
export function resolveXaiModelId(
  selected: string | null | undefined,
  listed: readonly string[],
): string {
  if (selected !== null && selected !== undefined && selected.trim() !== '') {
    if (listed.some((id) => sameId(id, selected))) return selected;
  }
  if (listed.length === 0) return DEFAULT_XAI_MODEL_ID;
  for (const preferred of PREFERRED) {
    const match = listed.find((id) => sameId(id, preferred));
    if (match !== undefined) return match;
  }
  return listed[0] ?? DEFAULT_XAI_MODEL_ID;
}

/**
 * Reconciles the list a combo shows with the models just fetched without blanking it: drops what
 * is gone, inserts what is new at its index, and always keeps `resolved`. Entries that are present
 * but out of place are not moved.
 */
export function mergeModelList(
  current: readonly string[],
  models: readonly string[],
  resolved: string,
): string[] {
  const target = models.includes(resolved) ? [...models] : [...models, resolved];
  const list = current.filter((id) => target.includes(id));
  for (let i = 0; i < target.length; i += 1) {
    const wanted = target[i];
    if (wanted === undefined || list[i] === wanted) continue;
    if (!list.includes(wanted)) list.splice(Math.min(i, list.length), 0, wanted);
  }
  return list;
}
