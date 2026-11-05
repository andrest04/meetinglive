import type { LocationDto } from '@vozella/contracts';
import { FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { ReactNode } from 'react';
import { Button, Notice, SectionHeader, SkeletonText } from '../../ui';

type LocationChoice =
  | { readonly status: 'changed'; readonly location: LocationDto }
  | { readonly status: 'cancelled' }
  | { readonly status: 'refused'; readonly message: string };

/**
 * A title, optional actions, and the value below. Paths are read, not timed, so they use the UI face
 * at 13px rather than 12px mono, wrap anywhere, and can be selected to copy.
 */
export function DataRow({
  title,
  value,
  children,
}: {
  title: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      className="flex flex-col gap-1.5 border-b border-hairline py-3.5 last:border-b-0"
    >
      <div className="flex min-h-8 items-center justify-between gap-6">
        <span className="text-ui-lg font-medium text-ink">{title}</span>
        {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
      </div>
      <span className="text-ui break-all text-ink-muted select-text">{value}</span>
    </div>
  );
}

/** Where the library and app data live, and the folder picker. The version is in About. */
export function DataSection() {
  const t = useT();
  const [location, setLocation] = useState<LocationDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLocation(await window.vozella.invoke('library.getLocation', {}));
  }, []);

  useEffect(() => {
    void load();
    return window.vozella.on('library.changed', (event) => {
      if (event.reason === 'location') void load();
    });
  }, [load]);

  const apply = async (request: Promise<LocationChoice>): Promise<void> => {
    const result = await request;
    if (result.status === 'changed') {
      setLocation(result.location);
      setNotice(null);
    } else if (result.status === 'refused') {
      setNotice(t('Ui_LibraryFolderRefused', result.message));
    }
  };

  return (
    <div>
      <SectionHeader level={2} compact title={t('Settings_Data.Text')} className="pb-2" />
      {location === null ? (
        <SkeletonText lines={3} className="py-3" />
      ) : (
        <>
          {notice ? (
            <Notice
              tone="warning"
              className="mb-2"
              onDismiss={() => {
                setNotice(null);
              }}
              dismissLabel={t('Ui_Close')}
            >
              {notice}
            </Notice>
          ) : null}
          {location.sharesMeetingLive ? (
            <Notice className="mb-2">{t('Ui_LibraryFolderShared')}</Notice>
          ) : null}
          <DataRow title={t('Settings_MeetingsLocation.Header')} value={location.libraryRoot}>
            {location.source === 'chosen' ? (
              <Button
                variant="quiet"
                onClick={() => {
                  void apply(window.vozella.invoke('library.setLocation', { path: null }));
                }}
              >
                {t('Ui_LibraryResetFolder')}
              </Button>
            ) : null}
            <Button
              onClick={() => {
                void apply(window.vozella.invoke('library.chooseLocation', {}));
              }}
            >
              {t('Ui_LibraryChooseFolder')}
            </Button>
            <Button
              icon={FolderOpen}
              onClick={() => {
                void window.vozella.invoke('library.openFolder', {}).then((result) => {
                  setNotice(result.opened ? null : t('Ui_LibraryOpenFailed', result.error ?? ''));
                });
              }}
            >
              {t('Settings_OpenFolder.Content')}
            </Button>
          </DataRow>
          <DataRow title={t('Settings_AppDataLocation.Header')} value={location.appDataRoot} />
        </>
      )}
    </div>
  );
}
