import { parseYouTubeUrl } from '@vozella/core';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog, Field, Input } from '../../ui';

export interface YouTubeImportDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Called with the normal `watch?v=` form of the link; the dialog has already closed. */
  readonly onImport: (url: string) => void;
}

/**
 * Asks for a YouTube video link (spec 2.12.1). Import waits for a link the parser accepts. The
 * error shows once the user leaves the field or presses Enter on a link that is not a video, so
 * a link being typed is not called wrong halfway through; a paste is judged at once.
 */
export function YouTubeImportDialog({ open, onOpenChange, onImport }: YouTubeImportDialogProps) {
  const t = useT();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [judged, setJudged] = useState(false);

  useEffect(() => {
    if (open) {
      setValue('');
      setJudged(false);
    }
  }, [open]);

  const parsed = parseYouTubeUrl(value);
  const blank = value.trim() === '';
  const showError = judged && !blank && parsed === null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Ui_ImportYouTubeTitle')}
      closeLabel={t('Ui_Close')}
      initialFocus={inputRef}
      actions={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('Ui_ImportYouTubeCancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={parsed === null}>
            {t('Ui_ImportYouTubeSubmit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed === null) return;
          onOpenChange(false);
          onImport(parsed.url);
        }}
      >
        <Field
          label={t('Ui_ImportYouTubeLabel')}
          error={showError ? t('Ui_ErrorYouTubeUrl') : undefined}
        >
          <Input
            ref={inputRef}
            type="url"
            inputMode="url"
            value={value}
            placeholder={t('Ui_ImportYouTubePlaceholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            onPaste={() => {
              setJudged(true);
            }}
            onBlur={() => {
              setJudged(true);
            }}
            onKeyDown={(event) => {
              // A disabled Import blocks implicit submission, so Enter on a bad link explains why.
              if (event.key === 'Enter' && parsed === null) setJudged(true);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}
