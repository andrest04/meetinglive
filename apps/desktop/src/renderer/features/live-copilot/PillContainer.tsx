import type { PillStateDto, RecordingStateDto } from '@vozella/contracts';
import { EXPANDED_RADIUS_DIP } from '@vozella/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { useElapsed } from '../record/use-elapsed';
import { ChatPanelContainer } from './ChatPanelContainer';
import { CapsuleView, hintSide, type CapsuleHint } from './CapsuleView';

const clampLevel = (level: number): number =>
  Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : 0;

/**
 * The pill window page. Main owns the geometry and the take; this container asks for both once
 * (`pill.ready`, `recording.getState`), then follows `pill.state`, `pill.hint`, `recording.state`
 * and `audio.recording.level`, and sends the four buttons back through the bridge.
 */
export function PillContainer() {
  const t = useT();
  const [pill, setPill] = useState<PillStateDto | null>(null);
  const [recording, setRecording] = useState<RecordingStateDto | null>(null);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState<CapsuleHint | null>(null);
  const hintTimer = useRef<number | null>(null);
  const hintCount = useRef(0);
  const animations = useRef(true);
  animations.current = pill?.animationsEnabled ?? true;

  const clearHintTimer = useCallback((): void => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = null;
  }, []);

  useEffect(() => {
    const offs = [
      window.vozella.on('pill.state', setPill),
      window.vozella.on('recording.state', (next) => {
        setRecording(next);
        setLevel(clampLevel(next.micLevel));
      }),
      window.vozella.on('audio.recording.level', (event) => {
        setLevel(clampLevel(event.level));
      }),
      window.vozella.on('pill.hint', (event) => {
        clearHintTimer();
        if (!event.show) {
          setHint(null);
          return;
        }
        hintCount.current += 1;
        setHint({
          id: hintCount.current,
          message: t('LiveCopilot_StartedMessage'),
          side: hintSide(event.edge),
          pulse: event.pulse && animations.current,
        });
        // Main closes the hint too; this is the page's own bound if that message is lost.
        hintTimer.current = window.setTimeout(() => {
          hintTimer.current = null;
          setHint(null);
        }, event.durationMs);
      }),
    ];
    // The page may start after main pushed its first state: ask for the current one.
    void window.vozella
      .invoke('pill.ready', {})
      .then(setPill)
      .catch(() => undefined);
    void window.vozella
      .invoke('recording.getState', {})
      .then(({ liveText: _liveText, ...state }) => {
        setRecording((current) => current ?? state);
        setLevel((current) => (current === 0 ? clampLevel(state.micLevel) : current));
      })
      .catch(() => undefined);
    return () => {
      for (const off of offs) off();
      clearHintTimer();
    };
    // `t` is read when a hint arrives; a language change applies to the next hint.
  }, [clearHintTimer]);

  const elapsed = useElapsed(
    recording
      ? {
          elapsedMs: recording.elapsedMs,
          elapsedAsOfMs: recording.elapsedAsOfMs,
          isTicking: recording.isTicking,
        }
      : null,
  );

  const send = (name: 'pill.togglePause' | 'pill.stop' | 'pill.openApp'): void => {
    void window.vozella.invoke(name, {}).catch(() => undefined);
  };
  const toggleExpanded = (): void => {
    if (!pill) return;
    void window.vozella
      .invoke('pill.setExpanded', { expanded: !pill.expanded })
      .then(setPill)
      .catch(() => undefined);
  };

  if (!pill) return <div data-testid="pill-root" className="fixed inset-0" />;

  return (
    <div data-testid="pill-root" className="fixed inset-0" style={{ opacity: pill.opacity }}>
      {pill.panel ? (
        <div
          data-testid="pill-panel"
          className="absolute box-border overflow-hidden border border-hairline bg-paper-raised forced-colors:border-[CanvasText]"
          style={{
            left: pill.panel.x,
            top: pill.panel.y,
            width: pill.panel.width,
            height: pill.panel.height,
            borderRadius: EXPANDED_RADIUS_DIP,
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.32)',
          }}
        >
          <ChatPanelContainer
            edge={pill.edge}
            animate={pill.animationsEnabled}
            recording={recording?.isRecording ?? false}
            onOpenApp={() => {
              send('pill.openApp');
            }}
          />
        </div>
      ) : null}
      <CapsuleView
        edge={pill.edge}
        vertical={pill.vertical}
        expanded={pill.expanded}
        rect={pill.capsule}
        contentOpacity={pill.contentOpacity}
        paused={recording?.isPaused ?? false}
        level={level}
        running={pill.visible}
        elapsed={elapsed}
        hint={hint}
        labels={{
          openApp: t('LiveCopilot_OpenApp.AutomationProperties.Name'),
          pause: t('LiveCopilot_Pause.AutomationProperties.Name'),
          resume: t('LiveCopilot_Resume.AutomationProperties.Name'),
          stop: t('LiveCopilot_Stop.AutomationProperties.Name'),
          expand: t('LiveCopilot_Expand.AutomationProperties.Name'),
          collapse: t('LiveCopilot_Collapse.AutomationProperties.Name'),
          collapseTooltip: t('LiveCopilot_Collapse.ToolTipService.ToolTip'),
          statusRecording: t('LiveCopilot_StatusRecording'),
          statusPaused: t('LiveCopilot_StatusPaused'),
        }}
        onOpenApp={() => {
          send('pill.openApp');
        }}
        onTogglePause={() => {
          send('pill.togglePause');
        }}
        onStop={() => {
          send('pill.stop');
        }}
        onToggleExpanded={toggleExpanded}
      />
    </div>
  );
}
