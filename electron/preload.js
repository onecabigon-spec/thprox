const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Official API Actions
  connectOfficialApi: (config) => ipcRenderer.invoke('api:connect', config),
  
  // Puppeteer Browser Actions
  startBrowserSession: (accountId, credentials, options = {}) => ipcRenderer.invoke('browser:start', accountId, credentials, options),
  stopBrowserSession: (accountId) => ipcRenderer.invoke('browser:stop', accountId),
  runPuppeteerAction: (accountId, actionType, payload) => ipcRenderer.invoke('browser:action', accountId, actionType, payload),
  postToThreads: (accountId, credentials, content, imagePath) => ipcRenderer.invoke('browser:postToThreads', accountId, credentials, content, imagePath),
  postToNote: (accountId, credentials, title, content) => ipcRenderer.invoke('browser:postToNote', accountId, credentials, title, content),
  autoLike: (accountId, credentials) => ipcRenderer.invoke('browser:autoLike', accountId, credentials),
   
  // High-Performance APIs
  generateImage: (apiKey, prompt) => ipcRenderer.invoke('api:generateImage', apiKey, prompt),
  callExternalLLM: (provider, apiKey, model, prompt) => ipcRenderer.invoke('api:callExternalLLM', provider, apiKey, model, prompt),
  getTrends: (query) => ipcRenderer.invoke('api:getTrends', query),
  autoEngage: (accountId, credentials, settings) => ipcRenderer.invoke('browser:autoEngage', accountId, credentials, settings),
  checkRepliesAndDM: (accountId, credentials, dmContent) => ipcRenderer.invoke('browser:checkRepliesAndDM', accountId, credentials, dmContent),
  
  // System Utility
  getSystemStatus: () => ipcRenderer.invoke('system:status'),
  onLogMessage: (callback) => ipcRenderer.on('system:log', (event, message) => callback(message)),
  logToServer: (message) => ipcRenderer.send('system:log-to-server', message),
  openLoginWindow: (accountId, type) => ipcRenderer.invoke('browser:open-login-window', accountId, type),
  clearSession: (accountId, type) => ipcRenderer.invoke('system:clear-session', accountId, type),

  // GitHub Sync
  githubPush: (config) => ipcRenderer.invoke('github:push', config),
  githubPull: (config) => ipcRenderer.invoke('github:pull', config)
});
