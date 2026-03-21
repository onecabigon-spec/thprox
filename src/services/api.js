/**
 * API Service Wrapper
 * This layer abstracts Electron-specific calls to allow the app to run in a web browser.
 * When running in Electron, it delegates to window.electronAPI.
 * When running on the web, it can be extended with fallbacks (e.g., Manus AI connectors).
 */

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const apiService = {
  isElectron,
  // LLM / AI
  callAI: async (provider, apiKey, model, prompt) => {
    if (isElectron) {
      return await window.electronAPI.callExternalLLM(provider, apiKey, model, prompt);
    }
    
    // Web Fallback (CORS permitting or using a proxy if needed)
    if (provider === 'manus') {
        try {
            const response = await axios.post('https://api.manus.im/v1/chat/completions', {
                model: model || 'manus-1',
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            return { success: true, content: response.data.choices[0].message.content };
        } catch (e) {
            return { success: false, error: e.response?.data?.error?.message || e.message };
        }
    }

    console.warn("Web Mode: General callAI triggered. Implement web-based AI call or use Manus AI connector.");
    return { success: false, error: "Web environment detected. This model is only supported in the Windows version." };
  },

  // Browser Automation (Electron Only)
  startBrowserSession: async (accountId, credentials, options) => {
    if (isElectron) return await window.electronAPI.startBrowserSession(accountId, credentials, options);
    return { success: false, error: "Browser automation is only available in the Windows EXE version." };
  },

  postToThreads: async (accountId, credentials, content, imagePath) => {
    if (isElectron) return await window.electronAPI.postToThreads(accountId, credentials, content, imagePath);
    return { success: false, error: "Direct posting via Puppeteer is only available in the Windows EXE version." };
  },

  runAction: async (accountId, action, payload) => {
    if (isElectron) return await window.electronAPI.runPuppeteerAction(accountId, action, payload);
    return { success: false, error: "Action only available in the Windows EXE version." };
  },

  autoLike: async (accountId, credentials) => {
    if (isElectron) return await window.electronAPI.autoLike(accountId, credentials);
    return { success: false, error: "Auto-like only available in Windows version." };
  },

  // GitHub Sync (Available in both if implemented via REST)
  githubPush: async ({ token, repo, path: filePath, content, message }) => {
    if (isElectron) return await window.electronAPI.githubPush({ token, repo, path: filePath, content, message });
    
    // Web Fallback (GitHub REST API)
    try {
        const baseUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
        const headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        };

        let sha;
        try {
            const getRes = await axios.get(baseUrl, { headers });
            sha = getRes.data.sha;
        } catch (e) {}

        const putRes = await axios.put(baseUrl, {
            message: message || `Updated ${filePath} via AutoThreader (Web)`,
            content: btoa(unescape(encodeURIComponent(content))), // Cross-browser base64
            sha
        }, { headers });

        return { success: true, sha: putRes.data.content.sha };
    } catch (e) {
        return { success: false, error: e.response?.data?.message || e.message };
    }
  },

  githubPull: async ({ token, repo, path: filePath }) => {
    if (isElectron) return await window.electronAPI.githubPull({ token, repo, path: filePath });
    
    // Web Fallback (GitHub REST API)
    try {
        const baseUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
        const headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        };

        const res = await axios.get(baseUrl, { headers });
        const content = decodeURIComponent(escape(atob(res.data.content)));
        
        return { success: true, content, sha: res.data.sha };
    } catch (e) {
        if (e.response?.status === 404) return { success: true, content: null, message: "File not found" };
        return { success: false, error: e.response?.data?.message || e.message };
    }
  },

  // Image Generation
  generateImage: async (apiKey, prompt) => {
    if (isElectron) return await window.electronAPI.generateImage(apiKey, prompt);
    return { success: false, error: "Image generation is currently only available in the Windows version." };
  },

  // Note.com Integration
  postToNote: async (accountId, credentials, title, content) => {
    if (isElectron) return await window.electronAPI.postToNote(accountId, credentials, title, content);
    return { success: false, error: "Note.com posting only available in Windows version." };
  },

  // Engagement & Replies
  autoEngage: async (accountId, credentials, settings) => {
    if (isElectron) return await window.electronAPI.autoEngage(accountId, credentials, settings);
    return { success: false, error: "Auto-engagement only available in Windows version." };
  },

  checkRepliesAndDM: async (accountId, credentials, dmContent) => {
    if (isElectron) return await window.electronAPI.checkRepliesAndDM(accountId, credentials, dmContent);
    return { success: false, error: "DM check only available in Windows version." };
  },

  runAction: async (accountId, action, payload) => {
    if (isElectron) return await window.electronAPI.runPuppeteerAction(accountId, action, payload);
    return { success: false, error: "Action only available in the Windows EXE version." };
  },

  // Official API Connect
  connectOfficialApi: (config) => {
    if (isElectron) return window.electronAPI.connectOfficialApi(config);
    return { success: false, error: "Official API connection not available in browser mode." };
  },

  openLoginWindow: async (accountId, type) => {
    if (isElectron) return await window.electronAPI.openLoginWindow(accountId, type);
    return { success: false, error: "Manual login window only available in Windows version." };
  },

  clearSession: async (accountId, type) => {
    if (isElectron) return await window.electronAPI.clearSession(accountId, type);
    return { success: false, error: "Session clearing only available in Windows version." };
  },

  // System Utilities
  onLog: (callback) => {
    if (isElectron) return window.electronAPI.onLogMessage(callback);
    console.log("Web Mode: Log listener registered.");
  },

  logToServer: (message) => {
    if (isElectron) return window.electronAPI.logToServer(message);
    console.log(`[LOG] ${message}`);
  },

  getSystemStatus: async () => {
    if (isElectron) return await window.electronAPI.getSystemStatus();
    return { success: true, status: "Web environment" };
  },

  getTrends: async (query) => {
    if (isElectron) return await window.electronAPI.getTrends(query);
    return { success: false, error: "Trends API only available in Windows version." };
  }
};

export default apiService;
