const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  firebaseDelete: (payload) => ipcRenderer.invoke("firebase-delete", payload),
  firebaseVideo: () => ipcRenderer.invoke("firebase-video"),
  receiveScannedFiles: (callback) =>
    ipcRenderer.on("scanned-files", (event, files) => callback(files)),
});

