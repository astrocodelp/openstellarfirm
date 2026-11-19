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
  send: (id, text, attachmentIds) =>
    call(IPC.send, id, text, attachmentIds ?? []),
  pickAttachments: (id) => call(IPC.pickAttachments, id),
  addAttachment: (id, name, bytes) => call(IPC.addAttachment, id, name, bytes),
  removeAttachment: (id, attachmentId) =>
    call(IPC.removeAttachment, id, attachmentId),
  pendingAttachments: (id) => call(IPC.pendingAttachments, id),
  openAttachment: (id, attachmentId) =>
    call(IPC.openAttachment, id, attachmentId),
  attachmentPreview: (id, attachmentId) =>
    call(IPC.attachmentPreview, id, attachmentId),
  ocrLanguages: () => call(IPC.ocrLanguages),
  downloadOcrLanguage: (code) => call(IPC.downloadOcrLanguage, code),
  cancelOcrLanguage: (code) => call(IPC.cancelOcrLanguage, code),
  removeOcrLanguage: (code) => call(IPC.removeOcrLanguage, code),
  onOcrProgress: (listener) => listen(IPC.ocrProgress, listener),
  stop: (id) => call(IPC.stop, id),
  pending: (id) => call(IPC.pending, id),
  decide: (id, approvalId, decision) =>
    call(IPC.decide, id, approvalId, decision),
  checkConnection: (input) => call(IPC.checkConnection, input),
  saveConnection: (input) => call(IPC.saveConnection, input),
  removeConnection: (id) => call(IPC.removeConnection, id),
  checkComposio: (input) => call(IPC.checkComposio, input),
  saveComposio: (input) => call(IPC.saveComposio, input),
  checkCatalog: (input) => call(IPC.checkCatalog, input),
  saveCatalog: (input) => call(IPC.saveCatalog, input),
  lookupCompany: (domain) => call(IPC.lookupCompany, domain),
  removeConnectionTool: (assistantId, connectionId, tool) =>
    call(IPC.removeConnectionTool, assistantId, connectionId, tool),
  checkMail: (input) => call(IPC.checkMail, input),
  saveMail: (input) => call(IPC.saveMail, input),
  removeMail: (id) => call(IPC.removeMail, id),
  removeMailRead: (assistantId, accountId) =>
    call(IPC.removeMailRead, assistantId, accountId),
  saveSource: (input) => call(IPC.saveSource, input),
  removeSource: (id) => call(IPC.removeSource, id),
  probeModels: (input) => call(IPC.probeModels, input),
  checkSource: (id) => call(IPC.checkSource, id),
  setSourceModel: (id, model) => call(IPC.setSourceModel, id, model),
  detectLocal: () => call(IPC.detectLocal),
  setSettings: (patch) => call(IPC.setSettings, patch),
  openCloud: (target, assistantId) => call(IPC.openCloud, target, assistantId),
  openLink: (name) => call(IPC.openLink, name),
  openDataFolder: () => call(IPC.openDataFolder),
  clearApprovals: () => call(IPC.clearApprovals),
  deleteAllChats: () => call(IPC.deleteAllChats),
  checkNow: () => call(IPC.checkNow),
  checkForUpdate: () => call(IPC.checkForUpdate),
  dismissUpdate: () => call(IPC.dismissUpdate),
  searchChats: (query) => call(IPC.searchChats, query),
  exportChat: (id) => call(IPC.exportChat, id),
  copyMessage: (id, messageId) => call(IPC.copyMessage, id, messageId),
  copyCode: (id, messageId, index) => call(IPC.copyCode, id, messageId, index),
  openAnswerLink: (id, messageId, href) =>
    call(IPC.openAnswerLink, id, messageId, href),
  memory: (id) => call(IPC.memory, id),
  addNote: (id, text) => call(IPC.addNote, id, text),
  editNote: (id, noteId, text) => call(IPC.editNote, id, noteId, text),
  removeNote: (id, noteId) => call(IPC.removeNote, id, noteId),
  setMemoryOn: (id, on) => call(IPC.setMemoryOn, id, on),
  forgetMessage: (id, messageId) => call(IPC.forgetMessage, id, messageId),
  undoForget: (id) => call(IPC.undoForget, id),
  clearChat: (id) => call(IPC.clearChat, id),
  summariseChat: (id) => call(IPC.summariseChat, id),
  keepSummary: (id, summaryId) => call(IPC.keepSummary, id, summaryId),
  undoSummary: (id, summaryId) => call(IPC.undoSummary, id, summaryId),
  recordSources: () => call(IPC.recordSources),
  recordStart: (sourceId) => call(IPC.recordStart, sourceId),
  recordStop: () => call(IPC.recordStop),
  recordStatus: () => call(IPC.recordStatus),
  recordAddFrame: (jpeg, atMs) => call(IPC.recordAddFrame, jpeg, atMs),
  recordRemoveFrame: (frameId) => call(IPC.recordRemoveFrame, frameId),
  recordClear: () => call(IPC.recordClear),
  recordPlan: (assistantId, sourceId) =>
    call(IPC.recordPlan, assistantId, sourceId),
  recordDraft: (assistantId, notes, sourceId) =>
    call(IPC.recordDraft, assistantId, notes, sourceId),
  recordCancel: () => call(IPC.recordCancel),
  onRecord: (listener) => listen(IPC.record, listener),
  saveOwnSkill: (input) => call(IPC.saveOwnSkill, input),
  removeOwnSkill: (id) => call(IPC.removeOwnSkill, id),
  onDelta: (listener) => listen(IPC.delta, listener),
  onDone: (listener) => listen(IPC.done, listener),
  onActivity: (listener) => listen(IPC.activity, listener),
  onApproval: (listener) => listen(IPC.approval, listener),
  computerStatus: () => call(IPC.computerStatus),
  computerSetup: () => call(IPC.computerSetup),
  computerView: (id) => call(IPC.computerView, id),
  computerStart: (id) => call(IPC.computerStart, id),
  computerShot: (id) => call(IPC.computerShot, id),
  computerHold: (id, hold) => call(IPC.computerHold, id, hold),
  computerInput: (id, input) => call(IPC.computerInput, id, input),
  computerStop: (id) => call(IPC.computerStop, id),
  computerRemove: (id) => call(IPC.computerRemove, id),
  computerOpenExchange: (id) => call(IPC.computerOpenExchange, id),
  onComputerProgress: (listener) => listen(IPC.computerProgress, listener),
  computerRunning: () => call(IPC.computerRunning),
  computerList: () => call(IPC.computerList),
  computerFrame: (id, frameId) => call(IPC.computerFrame, id, frameId),
  petsStatus: () => call(IPC.petsStatus),
  petsTurnOn: () => call(IPC.petsTurnOn),
  petsTurnOff: () => call(IPC.petsTurnOff),
  petsNewCertificate: () => call(IPC.petsNewCertificate),
  petsStartAdding: () => call(IPC.petsStartAdding),
  petsConfirm: (code) => call(IPC.petsConfirm, code),
  petsForget: (id) => call(IPC.petsForget, id),
  petsRename: (id, name) => call(IPC.petsRename, id, name),
  petsSetVoiceKey: (key) => call(IPC.petsSetVoiceKey, key),
  petsClearVoiceKey: () => call(IPC.petsClearVoiceKey),
  petsSetConfig: (id, config) => call(IPC.petsSetConfig, id, config),
  petsDiscardDraft: (id) => call(IPC.petsDiscardDraft, id),
  onSerialChoose: (listener) => listen(IPC.serialChoose, listener),
  serialChosen: (requestId, portId) =>
    call(IPC.serialChosen, requestId, portId),
  onComputerState: (listener) => listen(IPC.computerState, listener),
};

contextBridge.exposeInMainWorld("stellarOpen", api);
