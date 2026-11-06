import { MessageSquarePlus, PanelRightClose } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ChatScopeDecision } from '@vozella/core';
import { readStored, writeStored } from '../../app/preference-storage';
import { useT } from '../../i18n/I18nProvider';
import { Icon, IconButton, Splitter, cn } from '../../ui';
import { clampSize } from '../../ui/splitter-logic';
import { AiLauncher } from './AiLauncher';
import { LiveBadge } from './LiveBadge';
import {
  DOCK_MIN_CONTENT_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_OPEN_KEY,
  PANEL_WIDTH_KEY,
  isPanelToggle,
  panelMode,
  parseStoredOpen,
  parseStoredWidth,
} from './ai-panel-layout';
import { SCOPE_ICON, scopeLabel } from './chat-scope-label';
import { useLocalSendActive } from './chat-local-send';
import { useChatScope } from './use-chat-scope';
import { useRecordingPaused } from './use-recording-paused';
import { LiveQuestionSlot } from '../record/LiveQuestionSlot';
import { useLiveQuestionsStore } from '../record/use-live-questions';

/** Kept from the chat bar so automation and tests keep finding the chat by the same id. */
const PANEL_ID = 'BarMeetingChat';

type FocusAfter = 'composer' | 'launcher' | null;

export interface AiPanelAreaProps {
  /** The page column. It stays mounted whether the panel is closed, docked or floating. */
  readonly children: ReactNode;
  /** The chat itself (messages, composer), for the scope the panel resolved. */
  readonly body: (scope: ChatScopeDecision) => ReactNode;
}

/** Width of the element, followed with a ResizeObserver; null until the first measurement. */
function useObservedWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}

/**
 * The page and the AI panel beside it (spec 2.1). A launcher at the bottom right opens the panel;
 * Ctrl+J toggles it. It docks on the right and resizes, or floats over the page when docking
 * would leave the page too narrow. It stays open across pages, remembers its width and open
 * state, and disappears on Settings, where the chat has no scope.
 */
export function AiPanelArea({ children, body }: AiPanelAreaProps) {
  const t = useT();
  const { decision, name, canStartNewChat } = useChatScope();
  const [open, setOpenState] = useState(() => parseStoredOpen(readStored(PANEL_OPEN_KEY)));
  const [width, setWidth] = useState(() => parseStoredWidth(readStored(PANEL_WIDTH_KEY)));
  // A new chat remounts the body, which drops its draft and error with the old messages.
  const [epoch, setEpoch] = useState(0);
  const localSending = useLocalSendActive();
  const recordingPaused = useRecordingPaused();
  const area = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<FocusAfter>(null);
  const available = useObservedWidth(area);
  // In Live scope the panel shows the detected question, unless the Record dock already does.
  const dockShowsQuestion = useLiveQuestionsStore((s) => s.docks > 0);

  const visible = decision.isVisible;
  const showing = visible && open;
  const mode = panelMode(available, width);
  const docked = showing && mode === 'dock';
  const overlay = showing && mode === 'overlay';

  const setOpen = useCallback((next: boolean, focus: FocusAfter): void => {
    focusAfter.current = focus;
    setOpenState(next);
    writeStored(PANEL_OPEN_KEY, String(next));
  }, []);

  // Focus moves once the panel or the launcher is on screen.
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'composer') {
      panel.current?.querySelector<HTMLElement>('#TxtMeetingChat')?.focus();
    } else if (target === 'launcher') {
      launcher.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isPanelToggle(event)) return;
      // A modal dialog owns the keyboard; the panel would open behind it.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      if (!open) {
        setOpen(true, 'composer');
        return;
      }
      const focusInside = panel.current?.contains(document.activeElement) ?? false;
      setOpen(false, focusInside ? 'launcher' : null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [visible, open, setOpen]);

  // A floating panel closes on a click on the page or the sidebar. Popups are portaled outside
  // the shell (tooltips, menus, dialogs), so a click in them keeps it open.
  useEffect(() => {
    if (!overlay) return;
    const onPointerDown = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node) || panel.current?.contains(target)) return;
      if (!area.current?.parentElement?.contains(target)) return;
      setOpen(false, null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [overlay, setOpen]);

  const startNewChat = (): void => {
    void window.vozella
      .invoke('chat.newChat', {})
      .then((result) => {
        if (result.started) setEpoch((value) => value + 1);
      })
      .catch(() => undefined);
  };

  // Docked, the page keeps its minimum: the handle stops before the panel would push it into
  // overlay mode.
  const maxWidth =
    available === null
      ? PANEL_MAX_WIDTH
      : clampSize(available - DOCK_MIN_CONTENT_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
  const label = scopeLabel(t, decision, name);

  const aside = (
    <aside
      ref={panel}
      id={PANEL_ID}
      data-testid={PANEL_ID}
      data-mode={mode}
      aria-label={t('Chat_Bar.AutomationProperties.Name')}
      hidden={!showing}
      onKeyDown={(event) => {
        if (!overlay || event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        setOpen(false, 'launcher');
      }}
      style={overlay ? { width: Math.min(width, available ?? width) } : undefined}
      className={cn(
        'min-h-0 flex-col bg-paper-raised text-ink',
        showing ? 'flex' : 'hidden',
        docked && 'h-full animate-fade-in',
        overlay &&
          'absolute inset-y-0 right-0 z-30 animate-slide-from-right border-s border-hairline shadow-overlay',
        'forced-colors:border-[CanvasText]',
      )}
    >
      {/* Empty chrome: drags the window and sits behind the caption buttons. */}
      <div className="app-drag h-10 shrink-0" />
      <div className="flex h-10 shrink-0 items-center gap-1 ps-4 pe-2">
        {decision.kind === 'Live' ? (
          <span className="flex min-w-0 flex-1">
            <LiveBadge
              label={label}
              paused={recordingPaused}
              pausedLabel={t('Ui_ChatLivePaused')}
            />
          </span>
        ) : (
          <>
            <Icon icon={SCOPE_ICON[decision.kind]} className="text-ink-muted" />
            <span
              data-testid="LblMeetingChatScope"
              className="min-w-0 flex-1 truncate text-ui-lg font-medium"
            >
              {label}
            </span>
          </>
        )}
        <IconButton
          id="BtnMeetingChatNew"
          data-testid="BtnMeetingChatNew"
          label={t('Chat_New.AutomationProperties.Name')}
          icon={MessageSquarePlus}
          disabled={!canStartNewChat || localSending}
          onClick={startNewChat}
          className="text-ink-muted hover:text-ink"
        />
        <IconButton
          id="BtnAiPanelClose"
          data-testid="BtnAiPanelClose"
          label={t('Ui_AiPanelClose')}
          icon={PanelRightClose}
          onClick={() => {
            setOpen(false, 'launcher');
          }}
          className="text-ink-muted hover:text-ink"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        {decision.kind === 'Live' ? (
          <LiveQuestionSlot show={showing && !dockShowsQuestion} className="mb-3" />
        ) : null}
        <Fragment key={epoch}>{body(decision)}</Fragment>
      </div>
    </aside>
  );

  return (
    <div ref={area} className="relative flex min-w-0 flex-1">
      <Splitter
        fixedPane="end"
        collapsed={!docked}
        label={t('Ui_AiPanelResize')}
        defaultSize={PANEL_DEFAULT_WIDTH}
        initialSize={width}
        minSize={PANEL_MIN_WIDTH}
        maxSize={maxWidth}
        onSizeChange={(next) => {
          setWidth(next);
          writeStored(PANEL_WIDTH_KEY, String(next));
        }}
        first={children}
        second={aside}
      />
      {visible && !open ? (
        <AiLauncher
          ref={launcher}
          controls={PANEL_ID}
          onOpen={() => {
            setOpen(true, 'composer');
          }}
        />
      ) : null}
    </div>
  );
}
