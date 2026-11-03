import {
  summariesCancel,
  summariesCancelLocalModel,
  summariesCheckCli,
  summariesChooseCli,
  summariesChooseLocalModel,
  summariesCopyActions,
  summariesGenerate,
  summariesHardware,
  summariesLoadTab,
  summariesProviderStatus,
  summariesSaveNotes,
  summariesSetTemplate,
  summariesToggleAction,
} from '@vozella/contracts';
import type { SummariesController } from '../summaries/summaries-controller';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface SummariesHandlerDeps {
  readonly server: IpcServerDeps;
  readonly controller: SummariesController;
}

/** Wires the summary channels. One line per channel; the rules live in core. */
export function registerSummariesHandlers(deps: SummariesHandlerDeps): void {
  const { server, controller } = deps;

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
  registerRequest(server, summariesCopyActions, ({ meetingId }) =>
    controller.copyActions(meetingId),
  );
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
