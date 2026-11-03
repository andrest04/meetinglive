import { useEffect, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { MeetingPopup, type PopupPhase } from '../../popup/MeetingPopup';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

function viewAfterShow(current: { showId: number }): { phase: PopupPhase; showId: number } {
  return { phase: prefersReducedMotion() ? 'shown' : 'in', showId: current.showId + 1 };
}

type Action = 'meetingPrompt.start' | 'meetingPrompt.dismiss' | 'meetingPrompt.neverAgain';

/** Listens to main's show and hide events and sends the three buttons back through the bridge. */
export function MeetingPopupContainer() {
  const t = useT();
  const [view, setView] = useState<{ phase: PopupPhase; showId: number }>({
    phase: 'hidden',
    showId: 0,
  });

  useEffect(() => {
    const appear = (): void => {
      // W9: every show restarts from a clean state, so the card is never left invisible.
      setView(viewAfterShow);
    };
    const offShow = window.vozella.on('meetingPrompt.show', appear);
    const offHide = window.vozella.on('meetingPrompt.hide', ({ animated }) => {
      setView((current) => ({
        ...current,
        phase: animated && !prefersReducedMotion() ? 'out' : 'hidden',
      }));
    });
    // The page may have started after main sent its show: ask once, now that it is listening.
    void window.vozella
      .invoke('meetingPrompt.ready', {})
      .then(({ shown }) => {
        if (shown)
          setView((current) => (current.phase === 'hidden' ? viewAfterShow(current) : current));
      })
      .catch(() => undefined);
    return () => {
      offShow();
      offHide();
    };
  }, []);

  const send = (name: Action): void => {
    void window.vozella.invoke(name, {}).catch(() => undefined);
  };

  return (
    <MeetingPopup
      phase={view.phase}
      showId={view.showId}
      title={t('MeetingPrompt_Title.Text')}
      subtitle={t('MeetingPrompt_Subtitle.Text')}
      startLabel={t('MeetingPrompt_Start.Content')}
      moreLabel={t('MeetingPrompt_More.AutomationProperties.Name')}
      dismissLabel={t('MeetingPrompt_Dismiss.Text')}
      neverAgainLabel={t('MeetingPrompt_NeverAgain.Text')}
      onStart={() => {
        send('meetingPrompt.start');
      }}
      onDismiss={() => {
        send('meetingPrompt.dismiss');
      }}
      onNeverAgain={() => {
        send('meetingPrompt.neverAgain');
      }}
      onHover={(inside) => {
        void window.vozella.invoke('meetingPrompt.hover', { inside }).catch(() => undefined);
      }}
    />
  );
}
