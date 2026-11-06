import { ExternalLink, Globe, Send } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Icon,
  IconButton,
  Input,
  Notice,
  Tooltip,
  cn,
  useReducedMotion,
} from '../../ui';
import { MarkdownView, type LinkHandler } from '../summaries/MarkdownView';

export const PANEL_SLIDE_MS = 220;
const SLIDE_DIP = 16;

export interface ChatPanelLabels {
  readonly title: string;
  readonly openApp: string;
  readonly empty: string;
  readonly errorTitle: string;
  readonly progress: string;
  readonly webBadge: string;
  readonly chipMissed: string;
  readonly chipMissedName: string;
  readonly chipExplain: string;
  readonly chipExplainName: string;
  readonly askPlaceholder: string;
  readonly askName: string;
  readonly webToggleName: string;
  readonly webTooltip: string;
  readonly sendName: string;
  readonly sendTooltip: string;
}

export interface ChatPanelProps {
  readonly labels: ChatPanelLabels;
  readonly edge: 'Left' | 'Right' | 'Top' | 'Bottom';
  /** False when the OS asks for no animations. */
  readonly animate: boolean;
  /** The streamed answer, Markdown. Empty until the first piece arrives. */
  readonly answerText: string;
  readonly isAnswering: boolean;
  /** Ready text of a failed ask (may be empty), or null when there is no error. */
  readonly error: { readonly message: string } | null;
  readonly usedWeb: boolean;
  /** A take is running: asking is possible. */
  readonly canAsk: boolean;
  readonly canUseWeb: boolean;
  readonly forceWeb: boolean;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly onSend: () => void;
  readonly onChip: (which: 'missed' | 'explain') => void;
  readonly onToggleWeb: () => void;
  readonly onOpenApp: () => void;
  readonly onLink: LinkHandler;
  /** The detected question card, above the chips (it renders nothing without a card). */
  readonly question?: ReactNode;
}

const OFFSET: Record<ChatPanelProps['edge'], string> = {
  Right: `${String(SLIDE_DIP)}px 0`,
  Left: `${String(-SLIDE_DIP)}px 0`,
  Top: `0 ${String(-SLIDE_DIP)}px`,
  Bottom: `0 ${String(SLIDE_DIP)}px`,
};

const NO_DRAG = 'pill-no-drag';

/**
 * The expanded copilot (spec 2.8): header, answer area, two preset chips and the typed ask, in
 * rows with 12 DIP padding and 8 gap. Presentational: the container owns the ask and the links.
 * The detected-question card comes in through `question` (live question detection, 2026-11-05).
 */
export function ChatPanel(props: ChatPanelProps) {
  const { labels } = props;
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const showEmpty = props.answerText === '' && !props.isAnswering && props.error === null;
  const sendDisabled = !props.canAsk || props.text.trim() === '';

  // Opening: fade in and slide 16 DIP from the docked edge over 220 ms. Closing unmounts at once.
  useEffect(() => {
    const node = root.current;
    if (!props.animate || reduced || !node || typeof node.animate !== 'function') return;
    const run = node.animate(
      [
        { opacity: 0, translate: OFFSET[props.edge] },
        { opacity: 1, translate: '0 0' },
      ],
      { duration: PANEL_SLIDE_MS, easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)' },
    );
    return () => {
      run.cancel();
    };
    // Only the opening plays; a later edge change (a snap) does not replay it.
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!sendDisabled) props.onSend();
  };

  return (
    <div
      ref={root}
      data-testid="LiveCopilotPanel"
      className={cn('flex h-full flex-col gap-2 p-3 text-ink', NO_DRAG)}
    >
      <header className="flex min-h-8 items-center justify-between gap-2 ps-1">
        <h2
          id="TxtLiveCopilotTitle"
          data-testid="TxtLiveCopilotTitle"
          className="min-w-0 truncate text-ui-lg font-medium"
        >
          {labels.title}
        </h2>
        <IconButton
          id="BtnLiveCopilotOpenApp"
          data-testid="BtnLiveCopilotOpenApp"
          label={labels.openApp}
          icon={ExternalLink}
          onClick={props.onOpenApp}
          className={cn('text-ink-muted', NO_DRAG)}
        />
      </header>

      <div
        id="LiveCopilotAnswerArea"
        data-testid="LiveCopilotAnswerArea"
        tabIndex={0}
        role="region"
        aria-label={labels.title}
        aria-busy={props.isAnswering}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-control border border-hairline bg-paper p-3 select-text forced-colors:border-[CanvasText]"
      >
        <div className="flex flex-col gap-2">
          {props.error !== null ? (
            <Notice tone="error" testId="InfoLiveCopilotError">
              <p className="font-medium">{labels.errorTitle}</p>
              {props.error.message === '' ? null : (
                <p className="text-ui text-ink-muted">{props.error.message}</p>
              )}
            </Notice>
          ) : null}
          {props.isAnswering || props.usedWeb ? (
            <div className="flex min-h-5 items-center gap-2">
              {props.isAnswering ? (
                <span
                  id="ProgressLiveCopilot"
                  data-testid="ProgressLiveCopilot"
                  role="progressbar"
                  aria-label={labels.progress}
                  className="size-5 shrink-0 animate-spin rounded-full border-2 border-hairline border-t-ink motion-reduce:animate-none forced-colors:border-t-[Highlight]"
                />
              ) : null}
              {props.usedWeb ? (
                <span id="BadgeLiveCopilotWeb" data-testid="BadgeLiveCopilotWeb">
                  <Badge tone="outline">
                    <Icon icon={Globe} size={12} />
                    {labels.webBadge}
                  </Badge>
                </span>
              ) : null}
            </div>
          ) : null}
          {props.answerText === '' ? null : (
            <MarkdownView
              source={props.answerText}
              onLink={props.onLink}
              testId="MdLiveCopilotAnswer"
              className="text-ui-lg select-text [&_h2]:mt-3 [&_h2]:text-ui-lg [&_h3]:mt-3 [&_h3]:text-ui-lg [&_h4]:mt-3 [&_h4]:text-ui-lg"
            />
          )}
          {showEmpty ? (
            <p data-testid="TxtLiveCopilotEmpty" className="text-ui text-ink-muted">
              {labels.empty}
            </p>
          ) : null}
        </div>
      </div>

      {props.question}

      <div className="flex gap-2">
        {(
          [
            ['missed', 'BtnLiveCopilotChipMissed', labels.chipMissed, labels.chipMissedName],
            ['explain', 'BtnLiveCopilotChipExplain', labels.chipExplain, labels.chipExplainName],
          ] as const
        ).map(([which, id, label, name]) => (
          <Button
            key={id}
            id={id}
            data-testid={id}
            size="sm"
            aria-label={name}
            disabled={!props.canAsk}
            onClick={() => {
              props.onChip(which);
            }}
            className={NO_DRAG}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          id="TxtLiveCopilotAsk"
          data-testid="TxtLiveCopilotAsk"
          className={cn('min-w-0 flex-1', NO_DRAG)}
          aria-label={labels.askName}
          placeholder={labels.askPlaceholder}
          value={props.text}
          onChange={(event) => {
            props.onTextChange(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <IconButton
          id="ToggleLiveCopilotWeb"
          data-testid="ToggleLiveCopilotWeb"
          label={labels.webToggleName}
          icon={Globe}
          variant="secondary"
          tooltip={false}
          title={labels.webTooltip}
          disabled={!props.canUseWeb}
          aria-pressed={props.canUseWeb && props.forceWeb}
          onClick={props.onToggleWeb}
          className={cn(props.canUseWeb && props.forceWeb && 'border-ink bg-pressed', NO_DRAG)}
        />
        <Tooltip content={labels.sendTooltip} side="top">
          <Button
            id="BtnLiveCopilotSend"
            data-testid="BtnLiveCopilotSend"
            variant="primary"
            aria-label={labels.sendName}
            disabled={sendDisabled}
            onClick={props.onSend}
            className={cn('size-8 px-0', NO_DRAG)}
          >
            <Icon icon={Send} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
