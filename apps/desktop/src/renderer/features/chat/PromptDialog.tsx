import type { ChatPromptSaveOutcomeDto } from '@vozella/contracts';
import { USER_PROMPT_LIMIT, USER_PROMPT_NAME_MAX, USER_PROMPT_TEXT_MAX } from '@vozella/core';
import { CircleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog, Field, Icon, Input, RadioGroup, Select, Textarea } from '../../ui';
import { ENGINE_LABEL, type PromptFormValues } from './chat-prompts-view';

/** What opens the editor: a new prompt (with suggested values) or an existing one. */
export interface PromptEditorRequest {
  /** Set when editing; unset creates. */
  readonly id?: string;
  readonly initial: PromptFormValues;
}

export interface PromptDialogProps {
  readonly request: PromptEditorRequest;
  readonly onSave: (values: PromptFormValues, id?: string) => Promise<ChatPromptSaveOutcomeDto>;
  readonly onClose: () => void;
}

const DEFAULT_ENGINE = 'default';

/**
 * Create or edit a saved prompt: name, the prompt, one meeting or several, and the engine. Rules
 * are checked here first, in plain words next to the field; main checks them again.
 */
export function PromptDialog({ request, onSave, onClose }: PromptDialogProps) {
  const t = useT();
  const [values, setValues] = useState<PromptFormValues>(request.initial);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = useRef<HTMLInputElement>(null);

  const nameError = touched && values.name.trim() === '' ? t('Ui_ChatPromptNameRequired') : null;
  const promptError =
    touched && values.prompt.trim() === '' ? t('Ui_ChatPromptTextRequired') : null;

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (busy || values.name.trim() === '' || values.prompt.trim() === '') return;
    setBusy(true);
    setProblem(null);
    const outcome = await onSave(
      { ...values, name: values.name.trim(), prompt: values.prompt.trim() },
      request.id,
    );
    setBusy(false);
    switch (outcome.status) {
      case 'saved':
        onClose();
        return;
      case 'limit':
        setProblem(t('Ui_ChatPromptLimit', USER_PROMPT_LIMIT));
        return;
      case 'not-found':
        setProblem(t('Ui_ChatPromptGone'));
        return;
      case 'failed':
        setProblem(t('Ui_ChatPromptSaveFailed'));
    }
  };

  const engineOptions = [
    { value: DEFAULT_ENGINE, label: t('Ui_ChatPromptEngineDefault') },
    ...(['claude-code', 'codex', 'local'] as const).map((engine) => ({
      value: engine,
      label: t(ENGINE_LABEL[engine]),
    })),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={request.id === undefined ? t('Ui_ChatPromptNewTitle') : t('Ui_ChatPromptEditTitle')}
      closeLabel={t('Ui_Close')}
      initialFocus={name}
      actions={
        <>
          <Button data-testid="BtnChatPromptCancel" onClick={onClose}>
            {t('Ui_ChatPromptCancel')}
          </Button>
          <Button
            variant="primary"
            data-testid="BtnChatPromptSave"
            disabled={busy}
            onClick={() => void submit()}
          >
            {t('Ui_ChatPromptSave')}
          </Button>
        </>
      }
    >
      <div data-testid="FormChatPrompt" className="flex flex-col gap-4 p-0.5">
        <Field
          label={t('Ui_ChatPromptName')}
          description={t('Ui_ChatPromptNameHelp')}
          error={nameError ?? undefined}
        >
          <Input
            ref={name}
            data-testid="TxtChatPromptName"
            value={values.name}
            maxLength={USER_PROMPT_NAME_MAX}
            onChange={(event) => {
              setValues((v) => ({ ...v, name: event.target.value }));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </Field>
        <Field label={t('Ui_ChatPromptText')} error={promptError ?? undefined}>
          <Textarea
            data-testid="TxtChatPromptText"
            rows={5}
            value={values.prompt}
            maxLength={USER_PROMPT_TEXT_MAX}
            onChange={(event) => {
              setValues((v) => ({ ...v, prompt: event.target.value }));
            }}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-ui font-medium text-ink" aria-hidden="true">
            {t('Ui_ChatPromptFor')}
          </span>
          <RadioGroup
            label={t('Ui_ChatPromptFor')}
            orientation="horizontal"
            value={values.availability}
            onValueChange={(next) => {
              if (next === 'single' || next === 'multiple') {
                setValues((v) => ({ ...v, availability: next }));
              }
            }}
            options={[
              { value: 'single', label: t('Ui_ChatPromptForSingle') },
              { value: 'multiple', label: t('Ui_ChatPromptForMultiple') },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-ui font-medium text-ink" aria-hidden="true">
            {t('Ui_ChatPromptEngine')}
          </span>
          <Select
            label={t('Ui_ChatPromptEngine')}
            testId="CmbChatPromptEngine"
            options={engineOptions}
            value={values.engine ?? DEFAULT_ENGINE}
            onValueChange={(next) => {
              const engine =
                next === 'claude-code' || next === 'codex' || next === 'local' ? next : null;
              setValues((v) => ({ ...v, engine }));
            }}
            className="self-start"
          />
          <p className="text-ui text-ink-muted">{t('Ui_ChatPromptEngineHelp')}</p>
        </div>
        {problem ? (
          <p role="alert" className="flex gap-1.5 text-ui text-ink">
            <Icon icon={CircleAlert} size={14} className="mt-[3px] shrink-0" />
            <span>{problem}</span>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export interface DeletePromptDialogProps {
  readonly name: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/** "Delete this prompt?" The safe button takes the focus. */
export function DeletePromptDialog({ name, onConfirm, onClose }: DeletePromptDialogProps) {
  const t = useT();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('Ui_ChatPromptDeleteTitle')}
      closeLabel={t('Ui_Close')}
      initialFocus={cancel}
      actions={
        <>
          <Button ref={cancel} data-testid="BtnChatPromptDeleteCancel" onClick={onClose}>
            {t('Ui_ChatPromptCancel')}
          </Button>
          <Button variant="primary" data-testid="BtnChatPromptDeleteConfirm" onClick={onConfirm}>
            {t('Ui_ChatPromptDeleteConfirm')}
          </Button>
        </>
      }
    >
      <p className="text-ui-lg text-ink">{t('Ui_ChatPromptDeleteBody', name)}</p>
    </Dialog>
  );
}
