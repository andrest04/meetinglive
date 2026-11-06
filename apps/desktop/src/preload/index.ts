// Preload: the only bridge between the page and the main process. It exposes the typed
// API from packages/contracts and nothing else. No ipcRenderer, no Node.
import { createApi, type ClientTransport } from '@vozella/contracts';
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { createChatFilesBridge } from './chat-files';

const transport: ClientTransport = {
  send: (name, input) => ipcRenderer.invoke(name, input),
  subscribe: (name, listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload);
    };
    ipcRenderer.on(name, wrapped);
    return () => {
      ipcRenderer.removeListener(name, wrapped);
    };
  },
};

const api = createApi(transport);

contextBridge.exposeInMainWorld('vozella', api);
// Dropped files: the path is read here and sent to main, which checks it. The page never sees it.
contextBridge.exposeInMainWorld(
  'vozellaFiles',
  createChatFilesBridge(api, (file) => webUtils.getPathForFile(file)),
);
