import type { PillEdgeDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { askLive, connectLiveAsk, setWebSearch, useLiveAskStore } from '../record/use-live-ask';
import { answerErrorMessage } from '../record/LiveAskDock';
import { LiveQuestionSlot } from '../record/LiveQuestionSlot';
import { ChatPanel } from './ChatPanel';
import { classifyPillLink } from './pill-links';
import type { MouseEvent } from 'react';

/** The globe of the web badge string is drawn as an icon (the design system has no emoji). */
export const withoutLeadingEmoji = (text: string): string =>
  text.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '');

export interface ChatPanelContainerProps {
  readonly edge: PillEdgeDto;
  readonly animate: boolean;
  /** A take is running (not merely a pill on screen). */
  readonly recording: boolean;
  readonly onOpenApp: () => void;
}

/**
 * Wires the panel to the live ask store the Record page already uses (`recording.answer`, the
 * web toggle that outlives a take) and to the bridge. A send clears the typed text only when main
 * took the question, so a stale question cannot shadow a later ask.
 */
export function ChatPanelContainer({
  edge,
  animate,
  recording,
  onOpenApp,
}: ChatPanelContainerProps) {
  const t = useT();
  const answer = useLiveAskStore((s) => s.answer);
  const forceWeb = useLiveAskStore((s) => s.webSearch);
  const [text, setText] = useState('');

  useEffect(() => connectLiveAsk(), []);

  // A new take starts with an empty box: a draft left from before it is not carried over.
  const wasRecording = useRef(recording);
  useEffect(() => {
    if (recording && !wasRecording.current) setText('');
    wasRecording.current = recording;
  }, [recording]);

  const send = useCallback((): void => {
    const question = text.trim();
    if (!recording || question === '') return;
    void askLive(question).then((accepted) => {
      if (accepted) setText((current) => (current.trim() === question ? '' : current));
    });
  }, [text, recording]);

  const chip = useCallback(
    (which: 'missed' | 'explain'): void => {
      if (!recording) return;
      const prompt = t(
        which === 'missed' ? 'LiveCopilot_PromptMissed' : 'LiveCopilot_PromptExplain',
      );
      void askLive(prompt, { preset: true });
    },
    [recording, t],
  );

  const onLink = useCallback((href: string, event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    const target = classifyPillLink(href);
    if (target === null) return;
    // A refused or failed launch is ignored, as in the WinUI window.
    void window.vozella.invoke('chat.openExternal', { url: target }).catch(() => undefined);
  }, []);

  return (
    <ChatPanel
      edge={edge}
      animate={animate}
      answerText={answer.text}
      isAnswering={answer.isAnswering}
      error={answer.error === null ? null : { message: answerErrorMessage(answer, t) }}
      usedWeb={answer.usedWeb}
      canAsk={recording}
      canUseWeb={answer.canUseWebSearch}
      forceWeb={forceWeb}
      text={text}
      labels={{
        title: t('LiveCopilot_Title'),
        openApp: t('LiveCopilot_OpenApp.AutomationProperties.Name'),
        empty: t('Ui_LiveCopilotEmpty'),
        errorTitle: t('RecordPage_LiveAnswerError.Title'),
        progress: t('RecordPage_LiveAnswerProgress.AutomationProperties.Name'),
        webBadge: withoutLeadingEmoji(t('LiveCopilot_WebBadge.Text')),
        chipMissed: t('LiveCopilot_ChipMissed.Content'),
        chipMissedName: t('LiveCopilot_ChipMissed.AutomationProperties.Name'),
        chipExplain: t('LiveCopilot_ChipExplain.Content'),
        chipExplainName: t('LiveCopilot_ChipExplain.AutomationProperties.Name'),
        askPlaceholder: t('RecordPage_LiveAsk.PlaceholderText'),
        askName: t('RecordPage_LiveAsk.AutomationProperties.Name'),
        webToggleName: t('LiveCopilot_WebToggle.AutomationProperties.Name'),
        webTooltip: t(
          answer.canUseWebSearch ? 'LiveCopilot_WebTooltipOn' : 'LiveCopilot_WebTooltipOff',
        ),
        sendName: t('LiveCopilot_Send.AutomationProperties.Name'),
        sendTooltip: t('LiveCopilot_Send.ToolTipService.ToolTip'),
      }}
      onTextChange={setText}
      onSend={send}
      onChip={chip}
      onToggleWeb={() => {
        setWebSearch(!forceWeb);
      }}
      onOpenApp={onOpenApp}
      onLink={onLink}
      question={<LiveQuestionSlot className="pill-no-drag" />}
    />
  );
}
