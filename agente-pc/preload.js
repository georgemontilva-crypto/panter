const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("panter", {
  onView: (callback) => ipcRenderer.on("view", (_event, view) => callback(view)),
  getView: () => ipcRenderer.invoke("view"),
  setup: (input) => ipcRenderer.invoke("setup", input),
  maintenance: (input) => ipcRenderer.invoke("maintenance", input),
  // Pantalla de juegos
  onItems: (callback) => ipcRenderer.on("items", (_event, items) => callback(items)),
  getItems: () => ipcRenderer.invoke("items"),
  launch: (key) => ipcRenderer.invoke("launch", key),
});
