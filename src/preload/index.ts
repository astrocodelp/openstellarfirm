import { contextBridge, ipcRenderer } from "electron";
import { IPC, type IpcResult, type OpenApi } from "../shared/types";

/** The only door between the page and the main process. */

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function listen<T>(
  channel: string,
  listener: (payload: T) => void,
): () => void {
  const handler = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: OpenApi = {
  getState: () => call(IPC.getState),
  saveAssistant: (input) => call(IPC.saveAssistant, input),
  removeAssistant: (id) => call(IPC.removeAssistant, id),
  exportAssistant: (id) => call(IPC.exportAssistant, id),
  importAssistant: () => call(IPC.importAssistant),
  messages: (id) => call(IPC.messages, id),
  send: (id, text) => call(IPC.send, id, text),
  stop: (id) => call(IPC.stop, id),
  saveSource: (input) => call(IPC.saveSource, input),
  removeSource: (id) => call(IPC.removeSource, id),
  probeModels: (input) => call(IPC.probeModels, input),
  checkSource: (id) => call(IPC.checkSource, id),
  detectLocal: () => call(IPC.detectLocal),
  setSettings: (patch) => call(IPC.setSettings, patch),
  onDelta: (listener) => listen(IPC.delta, listener),
  onDone: (listener) => listen(IPC.done, listener),
};

contextBridge.exposeInMainWorld("stellarOpen", api);
