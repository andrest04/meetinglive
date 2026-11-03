import type { CSSProperties } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import { Notepad } from './Notepad';
import { useNotepad } from './use-notepad';

/** The Record page's notes block: hidden unless a take records or is processed. */
export function NotepadPanel({ maxHeight = null }: { readonly maxHeight?: number | null }) {
  const t = useT();
  const { visible, notes, setNotes } = useNotepad();
  if (!visible) return null;
  return (
    <section
      className="flex flex-col gap-1.5"
      aria-labelledby="notepad-heading"
      style={
        maxHeight === null
          ? undefined
          : ({ '--notepad-max-height': `${String(maxHeight)}px` } as CSSProperties)
      }
    >
      <h2 id="notepad-heading" className="flex min-h-7 items-center text-ui font-medium text-ink">
        {t('RecordPage_SessionNotes.Header')}
      </h2>
      <Notepad
        value={notes}
        onChange={setNotes}
        label={t('RecordPage_SessionNotes.Header')}
        placeholder={t('RecordPage_SessionNotes.PlaceholderText')}
      />
    </section>
  );
}
