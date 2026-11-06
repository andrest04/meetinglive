import {
  summariesCancel,
  summariesCancelLocalModel,
  summariesCheckCli,
  summariesChooseCli,
  summariesChooseLocalModel,
  summariesCopyActions,
  summariesCopyText,
  summariesGenerate,
  summariesHardware,
  summariesLoadTab,
  summariesProviderStatus,
  summariesReplaceSummary,
  summariesSaveNotes,
  summariesSetTemplate,
  summariesToggleAction,
  summariesWriteClipboard,
} from '@vozella/contracts';
import type { SummariesController } from '../summaries/summaries-controller';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface SummariesHandlerDeps {
  readonly server: IpcServerDeps;
  readonly controller: SummariesController;
  /** The system clipboard write (Electron's `clipboard.writeText` in the app). */
  readonly writeClipboard: (text: string) => Promise<void>;
}

/** Wires the summary channels. One line per channel; the rules live in core. */
export function registerSummariesHandlers(deps: SummariesHandlerDeps): void {
  const { server, controller, writeClipboard } = deps;

  registerRequest(server, summariesLoadTab, ({ meetingId }) => controller.loadTab(meetingId));
  registerRequest(server, summariesGenerate, (input) => controller.generate(input));
  registerRequest(server, summariesCancel, ({ meetingId }) => ({
    cancelled: controller.cancel(meetingId),
  }));
  registerRequest(server, summariesSaveNotes, ({ meetingId, text }) =>
    controller.saveNotes(meetingId, text),
  );
  registerRequest(server, summariesToggleAction, ({ meetingId, index, done }) =>
    controller.toggleAction(meetingId, index, done),
  );
  registerRequest(server, summariesReplaceSummary, ({ meetingId, source }) =>
    controller.replaceSummary(meetingId, source),
  );
  registerRequest(server, summariesCopyActions, ({ meetingId }) =>
    controller.copyActions(meetingId),
  );
  registerRequest(server, summariesCopyText, async ({ meetingId, mode }) => ({
    text: await controller.copyText(meetingId, mode),
  }));
  registerRequest(server, summariesWriteClipboard, async ({ text }) => {
    try {
      await writeClipboard(text);
      return { status: 'written' as const };
    } catch (error) {
      return {
        status: 'failed' as const,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  });
  registerRequest(server, summariesSetTemplate, ({ meetingId, templateId }) =>
    controller.setTemplate(meetingId, templateId),
  );
  registerRequest(server, summariesProviderStatus, () => controller.providerStatus());
  registerRequest(server, summariesHardware, () => controller.hardwareOptions());
  registerRequest(server, summariesCheckCli, ({ kind }) => controller.checkCli(kind));
  registerRequest(server, summariesChooseLocalModel, ({ fileName }) =>
    controller.chooseLocalModel(fileName),
  );
  registerRequest(server, summariesCancelLocalModel, ({ fileName }) => {
    controller.cancelLocalModel(fileName);
    return { cancelled: true as const };
  });
  registerRequest(server, summariesChooseCli, ({ kind }) => controller.chooseCli(kind));
}
