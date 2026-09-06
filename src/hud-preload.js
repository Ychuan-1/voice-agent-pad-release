const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('voiceHud', { onState: (callback) => ipcRenderer.on('hud:state', (_event, state) => callback(state)) });
