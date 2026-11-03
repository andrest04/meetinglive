// Preload: the only bridge between the page and the main process. It exposes the typed
// API from packages/contracts and nothing else. No ipcRenderer, no Node.
import { createApi, type ClientTransport } from '@vozella/contracts';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

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

contextBridge.exposeInMainWorld('vozella', createApi(transport));
