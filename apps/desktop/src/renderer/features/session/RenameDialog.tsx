import { canSubmitRename } from '@vozella/core';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog, Field, Input } from '../../ui';

/**
 * Rename a meeting (spec 2.3). Primary is the default button and stays disabled while the name is
 * blank; a short hint says why instead of the old silent refusal (B13). `problem` is a refusal
 * from main, such as a run in progress, shown under the field.
 */
export function RenameDialog({
  open,
  currentTitle,
  problem,
  busy,
  onSubmit,
  onClose,
}: {
  readonly open: boolean;
  readonly currentTitle: string;
  readonly problem: string | null;
  readonly busy: boolean;
  readonly onSubmit: (text: string) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(currentTitle);

  useEffect(() => {
    if (open) setText(currentTitle);
  }, [open, currentTitle]);

  const valid = canSubmitRename(text);
  const submit = (): void => {
    if (valid && !busy) onSubmit(text.trim());
  };
  const hint = problem ?? (valid ? null : t('Ui_SessionRenameBlankHint'));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('SessionRename_Title')}
      closeLabel={t('Ui_Close')}
      initialFocus={input}
      actions={
        <>
          <Button onClick={onClose}>{t('SessionRename_Cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" disabled={!valid || busy}>
            {t('SessionRename_Primary')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={t('SessionRename_Name.Header')} error={hint}>
          <Input
            ref={input}
            value={text}
            placeholder={t('SessionRename_Name.PlaceholderText')}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onFocus={(event) => {
              event.target.select();
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}
