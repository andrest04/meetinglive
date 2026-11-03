import type { ReactNode } from 'react';
import { ArrowLeft, Copy, FolderOpen, Pencil } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import { Button, IconButton, Icon, cn } from '../../ui';

/** The back link, shown in every state so the page always has a way out. */
export function BackLink({ onBack }: { readonly onBack: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      data-testid="BtnSessionBack"
      onClick={onBack}
      className={cn(
        '-ms-1.5 inline-flex h-7 w-fit items-center gap-1.5 rounded-control pe-2 ps-1.5 text-ui-lg text-ink-muted',
        'transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink',
      )}
    >
      <Icon icon={ArrowLeft} size={14} />
      {t('SessionPage_Back.AutomationProperties.Name')}
    </button>
  );
}

/** Title, rename, copy, open location and the actions the page adds. Presentational: the container owns every action. */
export function SessionHeader({
  title,
  onRename,
  onCopy,
  onOpenLocation,
  renameDisabled = false,
  extraActions,
}: {
  readonly title: string;
  readonly onRename: () => void;
  readonly onCopy: () => void;
  readonly onOpenLocation: () => void;
  /** B4: a run for this meeting is going, so the title cannot change now. */
  readonly renameDisabled?: boolean;
  /** More buttons for the action row, such as Re-transcribe. */
  readonly extraActions?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <h1
          title={title}
          className="min-w-0 truncate text-title font-semibold tracking-[-0.02em] text-ink"
        >
          {title}
        </h1>
        <IconButton
          data-testid="BtnSessionRename"
          label={t('SessionPage_Rename.ToolTipService.ToolTip')}
          icon={Pencil}
          size="sm"
          disabled={renameDisabled}
          onClick={onRename}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="BtnSessionCopy" size="sm" icon={Copy} onClick={onCopy}>
          {t('SessionPage_Copy.AutomationProperties.Name')}
        </Button>
        <Button
          data-testid="BtnSessionOpenLocation"
          size="sm"
          variant="quiet"
          icon={FolderOpen}
          onClick={onOpenLocation}
        >
          {t('SessionPage_OpenLocation.AutomationProperties.Name')}
        </Button>
        {extraActions}
      </div>
    </header>
  );
}
