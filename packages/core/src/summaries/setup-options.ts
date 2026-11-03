import type { ModelRow } from '../settings/local-models';

/**
 * The model the setup wizard pre-selects (spec 2.7): the first model already on disk, else the
 * first one rated Recommended, else the first row. Null only for an empty list.
 */
export function defaultModelFileName(
  rows: readonly Pick<ModelRow, 'fileName' | 'downloaded' | 'fit'>[],
): string | null {
  const pick =
    rows.find((row) => row.downloaded) ?? rows.find((row) => row.fit === 'Recommended') ?? rows[0];
  return pick?.fileName ?? null;
}
