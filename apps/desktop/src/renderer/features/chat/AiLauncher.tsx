import { MessagesSquare } from 'lucide-react';
import { useEffect, type Ref } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Icon, ShortcutHint, Tooltip, cn } from '../../ui';
import { PANEL_TOGGLE_KEYS } from './ai-panel-layout';

/** Room the launcher takes at the bottom right; toasts stack above it while it shows. */
const LAUNCHER_CLEARANCE = '48px';

export interface AiLauncherProps {
  readonly ref?: Ref<HTMLButtonElement>;
  /** Id of the panel it opens. */
  readonly controls: string;
  readonly onOpen: () => void;
}

/** The round button at the bottom right that opens the AI panel. Shown only while it is closed. */
export function AiLauncher({ ref, controls, onOpen }: AiLauncherProps) {
  const t = useT();
  const label = t('Ui_AiPanelOpen');

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--launcher-clearance', LAUNCHER_CLEARANCE);
    return () => {
      root.style.removeProperty('--launcher-clearance');
    };
  }, []);

  return (
    <Tooltip side="left" content={<ShortcutHint label={label} chords={[PANEL_TOGGLE_KEYS]} />}>
      <button
        ref={ref}
        type="button"
        id="BtnAiPanelOpen"
        data-testid="BtnAiPanelOpen"
        aria-label={label}
        aria-expanded={false}
        aria-controls={controls}
        onClick={onOpen}
        className={cn(
          'app-no-drag fixed right-4 bottom-4 z-30 inline-flex size-10 animate-fade-in items-center justify-center',
          'rounded-full border border-ink bg-ink text-on-ink',
          'transition-opacity duration-150 ease-out-quick hover:opacity-85 active:opacity-70',
          'forced-colors:border-[ButtonText]',
        )}
      >
        <Icon icon={MessagesSquare} size={20} />
      </button>
    </Tooltip>
  );
}
