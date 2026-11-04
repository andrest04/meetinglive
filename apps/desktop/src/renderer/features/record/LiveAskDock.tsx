import type { RecordingAnswerDto } from '@vozella/contracts';
import { Globe } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { isCtrlEnter } from '../../app/shortcuts';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { IconButton, Input, Notice, cn } from '../../ui';
import { askLive, setWebSearch, useLiveAskStore } from './use-live-ask';

export const answerErrorMessage = (
  answer: RecordingAnswerDto,
  translate: (key: StringKey) => string,
): string => {
  const { error } = answer;
  if (error === null) return '';
  return error.key === null ? error.text : translate(error.key as StringKey);
};

/**
 * The typed question under the live transcript (spec 2.8, items 2 and 3). Ctrl+Enter inside the
 * box asks; the web toggle is enabled only when the provider can search the web and keeps its
 * state between takes. Answers appear in the side panel (`AnswerCard`).
 */
export function LiveAskDock({ enabled }: { readonly enabled: boolean }) {
  const t = useT();
  const answer = useLiveAskStore((s) => s.answer);
  const webSearch = useLiveAskStore((s) => s.webSearch);
  const [text, setText] = useState('');
  const wasEnabled = useRef(enabled);
  useEffect(() => {
    // A new take starts with an empty box.
    if (enabled && !wasEnabled.current) setText('');
    wasEnabled.current = enabled;
  }, [enabled]);
  const canWeb = answer.canUseWebSearch;
  const canAsk = enabled && text.trim() !== '';

  const submit = (): void => {
    if (canAsk) void askLive(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (isCtrlEnter(event)) {
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  };

  const message = answerErrorMessage(answer, t);
  return (
    <div className="flex flex-col gap-2" data-testid="live-ask-dock">
      {answer.error !== null ? (
        <Notice tone="error" data-testid="live-answer-error">
          <p className="font-medium">{t('RecordPage_LiveAnswerError.Title')}</p>
          {message === '' ? null : <p className="text-ui text-ink-muted">{message}</p>}
        </Notice>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          id="TxtLiveAsk"
          data-testid="TxtLiveAsk"
          className="min-w-0 flex-1"
          aria-label={t('RecordPage_LiveAsk.AutomationProperties.Name')}
          title={t('RecordPage_LiveAskTooltip')}
          placeholder={t('RecordPage_LiveAsk.PlaceholderText')}
          value={text}
          disabled={!enabled}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <IconButton
          id="ToggleLiveWebSearch"
          data-testid="ToggleLiveWebSearch"
          label={t(canWeb ? 'LiveCopilot_WebTooltipOn' : 'LiveCopilot_WebTooltipOff')}
          icon={Globe}
          variant="secondary"
          disabled={!enabled || !canWeb}
          aria-pressed={canWeb && webSearch}
          className={cn(canWeb && webSearch && 'border-ink bg-pressed')}
          onClick={() => {
            setWebSearch(!webSearch);
          }}
        />
        <span
          role="progressbar"
          aria-label={t('RecordPage_LiveAnswerProgress.AutomationProperties.Name')}
          aria-busy={answer.isAnswering}
          hidden={!answer.isAnswering}
          className="size-5 shrink-0 animate-spin rounded-full border-2 border-hairline border-t-ink motion-reduce:animate-none"
        />
      </div>
    </div>
  );
}
