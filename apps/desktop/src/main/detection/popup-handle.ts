import { meetingPromptHide, meetingPromptShow } from '@vozella/contracts';
import type { PopupHandle } from './meeting-detection-controller';
import { sendEvent } from '../ipc/ipc-server';
import type { MeetingPromptWindow } from '../windows/meeting-prompt-window';

/** The slice of Electron's WebContents the sender needs. */
interface PopupContents {
  readonly id: number;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  isLoading(): boolean;
  once(event: 'did-finish-load', listener: () => void): void;
}

/**
 * Joins the controller to the popup window: shows it, lets the IPC guard trust its page, and
 * pushes show/hide to it. An event sent while the page is still loading waits for the load.
 */
export function createPopupHandle(
  window: MeetingPromptWindow,
  trustSender: (webContentsId: number) => void,
): PopupHandle {
  const contents = (): PopupContents | null => {
    const win = window.current();
    return win ? (win.webContents as unknown as PopupContents) : null;
  };
  const whenLoaded = (run: (target: PopupContents) => void): void => {
    const target = contents();
    if (!target) return;
    if (target.isLoading()) target.once('did-finish-load', () => run(target));
    else run(target);
  };
  return {
    show: () => {
      trustSender(window.show().webContents.id);
    },
    hide: () => {
      window.hide();
    },
    notifyShow: () => {
      whenLoaded((target) => {
        sendEvent(target, meetingPromptShow, {});
      });
    },
    notifyHide: (animated) => {
      whenLoaded((target) => {
        sendEvent(target, meetingPromptHide, { animated });
      });
    },
    dispose: () => {
      window.dispose();
    },
  };
}
