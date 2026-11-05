import { useEffect, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { SectionHeader, SkeletonText } from '../../ui';
import { DataRow } from './DataSection';

/** The app version, in a section of its own at the end of the page. */
export function AboutSection() {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.vozella
      .invoke('library.getLocation', {})
      .then((location) => {
        if (alive) setVersion(location.version);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <SectionHeader level={2} compact title={t('Ui_About')} className="pb-2" />
      {version === null ? (
        <SkeletonText lines={1} className="py-3" />
      ) : (
        <DataRow title={t('Ui_AboutVersion')} value={version} />
      )}
    </div>
  );
}
