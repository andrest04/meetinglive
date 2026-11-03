import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Notice, Progress } from '../../ui';
import { LinkedText } from './cli-hint';
import type { CliPanelContext } from './SetupWizardDialog';
import { useCliCheck } from './use-cli-check';

async function chooseCli(kind: CliPanelContext['kind']): Promise<boolean> {
  const answer = await window.vozella.invoke('summaries.chooseCli', { kind });
  return answer.status === 'saved';
}

/**
 * The wizard's CheckingCli step. It looks once on entering: a CLI that is there is saved as the
 * provider and the wizard closes. Otherwise the panel says where to get it, with Check again and
 * Back. Check again saves through `summaries.chooseCli`, which re-checks PATH itself.
 */
export function CliCheckPanel({ kind, onBack, onReady }: CliPanelContext) {
  const t = useT();
  const [entry, setEntry] = useState<'checking' | 'missing'>('checking');
  const cli = useCliCheck(kind, chooseCli, onReady, 'Cli_NotFoundCheckAgain');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void chooseCli(kind)
      .catch(() => false)
      .then((found) => {
        if (found) onReady();
        else setEntry('missing');
      });
  }, [kind, onReady]);

  if (entry === 'checking') return <Progress label={t('Ui_Loading')} value={null} />;
  return (
    <div className="flex flex-col gap-3" data-testid="PanelCliCheck">
      <Notice tone="warning">
        <p className="font-medium">{t('CliSetup_NotFound.Title')}</p>
        <p className="mt-1" data-testid="TxtCliMessage">
          <LinkedText text={cli.message} />
        </p>
      </Notice>
      <div className="flex gap-2">
        <Button data-testid="BtnBackToEngineChoice" onClick={onBack}>
          {t('Setup_Back.Content')}
        </Button>
        <Button
          variant="primary"
          data-testid="BtnRecheckCli"
          disabled={cli.checking}
          onClick={cli.recheck}
        >
          {t('Setup_CheckAgain.Content')}
        </Button>
      </div>
    </div>
  );
}
