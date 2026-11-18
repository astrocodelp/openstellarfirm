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
  exportBackup: (includeChats) => call(IPC.exportBackup, includeChats),
  importBackup: () => call(IPC.importBackup),
  addFolder: (id) => call(IPC.addFolder, id),
  removeFolder: (id, folder) => call(IPC.removeFolder, id, folder),
  removeSite: (id, site) => call(IPC.removeSite, id, site),
  messages: (id) => call(IPC.messages, id),
  send: (id, text) => call(IPC.send, id, text),
  stop: (id) => call(IPC.stop, id),
  pending: (id) => call(IPC.pending, id),
  decide: (id, approvalId, decision) =>
    call(IPC.decide, id, approvalId, decision),
  checkConnection: (input) => call(IPC.checkConnection, input),
  saveConnection: (input) => call(IPC.saveConnection, input),
  removeConnection: (id) => call(IPC.removeConnection, id),
  removeConnectionTool: (assistantId, connectionId, tool) =>
    call(IPC.removeConnectionTool, assistantId, connectionId, tool),
  saveSource: (input) => call(IPC.saveSource, input),
  removeSource: (id) => call(IPC.removeSource, id),
  probeModels: (input) => call(IPC.probeModels, input),
  checkSource: (id) => call(IPC.checkSource, id),
  detectLocal: () => call(IPC.detectLocal),
  setSettings: (patch) => call(IPC.setSettings, patch),
  openCloud: (target, assistantId) => call(IPC.openCloud, target, assistantId),
  onDelta: (listener) => listen(IPC.delta, listener),
  onDone: (listener) => listen(IPC.done, listener),
  onActivity: (listener) => listen(IPC.activity, listener),
  onApproval: (listener) => listen(IPC.approval, listener),
};

contextBridge.exposeInMainWorld("stellarOpen", api);
