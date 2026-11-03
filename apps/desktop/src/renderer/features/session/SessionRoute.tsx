import { copyCommand, createCopyFeedback, type SessionTab } from '@vozella/core';
import { FileText, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Icon, Notice, Skeleton, SkeletonText, Tabs, cn } from '../../ui';
import { ProviderGateDialogs, ProviderUnavailableNotice } from '../summaries/ProviderGateDialogs';
import { SummaryTab } from '../summaries/SummaryTab';
import { useProviderGate } from '../summaries/use-provider-gate';
import { RetranscribeControl } from '../transcription/RetranscribeControl';
import { CopyNotice } from './CopyNotice';
import { RenameDialog } from './RenameDialog';
import { BackLink, SessionHeader } from './SessionHeader';
import { TranscriptSlot, type CopySource } from './TranscriptSlot';
import { useSession } from './use-session';

const navigateTo = (tag: 'History' | 'Recording'): void => {
  // Pages ask the workspace to navigate; the shell is the only listener that does.
  void window.vozella.invoke('workspace.dispatch', { action: { type: 'navigateTo', tag } });
};

/** Copy feedback from core: one timer, restarted on every copy (items 58 to 60). */
function useCopyFeedback(): {
  readonly visible: boolean;
  readonly show: () => void;
  readonly dismiss: () => void;
} {
  const feedback = useMemo(
    () =>
      createCopyFeedback({
        setTimeout: (task, ms) => window.setTimeout(task, ms),
        clearTimeout: (handle) => {
          window.clearTimeout(handle as number);
        },
      }),
    [],
  );
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const off = feedback.subscribe(setVisible);
    return () => {
      off();
      feedback.dismiss();
    };
  }, [feedback]);
  const show = useCallback(() => {
    feedback.show();
  }, [feedback]);
  const dismiss = useCallback(() => {
    feedback.dismiss();
  }, [feedback]);
  return { visible, show, dismiss };
}

function SessionSkeleton({ label }: { readonly label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-5">
      <Skeleton className="h-8 w-2/3" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-32" />
      </div>
      <div className="flex gap-5 border-b border-hairline pb-2.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
      <SkeletonText lines={6} />
    </div>
  );
}

/**
 * Container of the session page (spec 2.1): resolves the open meeting, owns the header actions
 * and mounts the two tabs. The tabs do their own work; the page only asks them for copy text.
 */
export function SessionRoute() {
  const t = useT();
  const session = useSession();
  const gate = useProviderGate();
  const copy = useCopyFeedback();
  const copySourceRef = useRef<CopySource | null>(null);
  const [copyProblem, setCopyProblem] = useState<string | null>(null);
  const [revealFailed, setRevealFailed] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameProblem, setRenameProblem] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const { meeting } = session;
  const { show: showCopied, dismiss: dismissCopy } = copy;
  const meetingId = meeting?.id ?? null;

  // Notices belong to one meeting; opening another one starts clean.
  useEffect(() => {
    setCopyProblem(null);
    setRevealFailed(false);
    setRenameOpen(false);
    dismissCopy();
  }, [meetingId, dismissCopy]);

  const onCopy = useCallback(() => {
    const source = copySourceRef.current;
    if (source === null) return;
    void (async () => {
      setCopyProblem(null);
      try {
        const text = copyCommand(await source());
        if (text === null) return;
        const written = await window.vozella.invoke('summaries.writeClipboard', { text });
        if (written.status === 'written') showCopied();
        else setCopyProblem(t('Ui_SummaryCopyFailed', written.detail));
      } catch (error) {
        setCopyProblem(t('Ui_SummaryCopyFailed', error instanceof Error ? error.message : ''));
      }
    })();
  }, [showCopied, t]);

  const onOpenLocation = useCallback(() => {
    if (meetingId === null) return;
    setRevealFailed(false);
    void window.vozella
      .invoke('session.revealFile', { id: meetingId })
      .then((answer) => {
        if (!answer.revealed) setRevealFailed(true);
      })
      .catch(() => {
        setRevealFailed(true);
      });
  }, [meetingId]);

  const closeRename = useCallback(() => {
    setRenameOpen(false);
    setRenameProblem(null);
  }, []);

  const onRename = useCallback(
    (title: string) => {
      if (meetingId === null) return;
      setRenameBusy(true);
      void (async () => {
        try {
          const { status } = await window.vozella.invoke('session.rename', {
            id: meetingId,
            title,
          });
          if (status === 'blocked') {
            setRenameProblem(t('Ui_SessionRenameBlockedText'));
            return;
          }
          closeRename();
          session.refresh();
          // The inner tab re-reads the meeting from disk after a rename (item 35).
          if (status !== 'missing') session.reloadContent();
        } catch (error) {
          setRenameProblem(
            t('Ui_SessionRenameFailedText', error instanceof Error ? error.message : ''),
          );
        } finally {
          setRenameBusy(false);
        }
      })();
    },
    [closeRename, meetingId, session, t],
  );

  const tabs = useMemo(() => {
    if (meetingId === null) return [];
    const animation =
      session.slide === 'FromRight'
        ? 'animate-slide-from-right'
        : session.slide === 'FromLeft'
          ? 'animate-slide-from-left'
          : undefined;
    const wrap = (key: string, node: ReactNode) => (
      <div key={`${key}-${String(session.contentKey)}`} className={cn(animation)}>
        {node}
      </div>
    );
    return [
      {
        value: 'Transcript',
        label: t('SessionPage_TabTranscript.Text'),
        testId: 'SelectorSessionTranscript',
        icon: <Icon icon={FileText} size={14} />,
        content: wrap(
          'transcript',
          <TranscriptSlot meetingId={meetingId} copySourceRef={copySourceRef} />,
        ),
      },
      {
        value: 'Summary',
        label: t('SessionPage_TabSummary.Text'),
        testId: 'SelectorSessionSummary',
        icon: <Icon icon={Sparkles} size={14} />,
        content: wrap(
          'summary',
          <SummaryTab
            meetingId={meetingId}
            runSetup={gate.runSetup}
            copySourceRef={copySourceRef}
          />,
        ),
      },
    ];
  }, [gate.runSetup, meetingId, session.contentKey, session.slide, t]);

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-5 pb-10">
      <BackLink
        onBack={() => {
          navigateTo('History');
        }}
      />
      {session.phase === 'loading' ? <SessionSkeleton label={t('Ui_Loading')} /> : null}
      {session.phase === 'error' ? (
        <Notice tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('Ui_SessionPageLoadFailedText')}</span>
            <Button size="sm" onClick={session.retry}>
              {t('Ui_SessionPageRetryContent')}
            </Button>
          </div>
        </Notice>
      ) : null}
      {session.phase === 'empty' ? (
        <div className="flex flex-col items-start gap-4 py-6">
          <p className="text-read text-ink-muted">{t('SessionPage_Empty.Text')}</p>
          <Button
            data-testid="BtnSessionEmptyRecord"
            variant="primary"
            onClick={() => {
              navigateTo('Recording');
            }}
          >
            {t('SessionPage_EmptyCta.Content')}
          </Button>
        </div>
      ) : null}
      {meeting !== null && session.phase === 'loaded' ? (
        <>
          <SessionHeader
            title={meeting.title}
            onRename={() => {
              setRenameProblem(null);
              setRenameOpen(true);
            }}
            onCopy={onCopy}
            onOpenLocation={onOpenLocation}
          />
          {copy.visible ? <CopyNotice onDismiss={dismissCopy} /> : null}
          {copyProblem !== null ? (
            <Notice
              tone="warning"
              onDismiss={() => {
                setCopyProblem(null);
              }}
              dismissLabel={t('Ui_Close')}
            >
              {copyProblem}
            </Notice>
          ) : null}
          {revealFailed ? (
            <Notice
              onDismiss={() => {
                setRevealFailed(false);
              }}
              dismissLabel={t('Ui_Close')}
            >
              {t('Ui_SessionPageOpenLocationFailedText')}
            </Notice>
          ) : null}
          <ProviderUnavailableNotice gate={gate} />
          <Tabs
            tabs={tabs}
            value={session.tab}
            onValueChange={(next) => {
              session.selectTab(next as SessionTab);
            }}
            label={t('Ui_SessionPageTabsLabel')}
            listTestId="SelectorSessionTabs"
          />
          <RetranscribeControl
            meetingId={meeting.id}
            meetingTitle={meeting.title}
            onFinished={() => {
              session.refresh();
              session.reloadContent();
            }}
          />
          <RenameDialog
            open={renameOpen}
            currentTitle={meeting.title}
            problem={renameProblem}
            busy={renameBusy}
            onSubmit={onRename}
            onClose={closeRename}
          />
        </>
      ) : null}
      <ProviderGateDialogs gate={gate} />
    </section>
  );
}
