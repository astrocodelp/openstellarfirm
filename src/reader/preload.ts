import { ipcRenderer } from "electron";

/**
 * The reader's preload hands the page one message port from the main process,
 * and nothing else: no bridge, no Node, no other channel.
 */
ipcRenderer.once("reader:port", (event) => {
  const port = event.ports[0];
  if (port) window.postMessage("openstellar-reader-port", "*", [port]);
});
