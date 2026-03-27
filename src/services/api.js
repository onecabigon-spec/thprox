import axios from 'axios';

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
    // 1. Try Official API if threadsApiKey is provided
    if (credentials.threadsApiKey) {
      try {
        // Step 1: Create Media Container (Text-only for now as per simple request)
        // Note: graph.threads.net/v1.0/me/threads is valid for the token owner
        const containerRes = await axios.post(`https://graph.threads.net/v1.0/me/threads`, null, {
          params: {
            media_type: 'TEXT',
            text: content,
            access_token: credentials.threadsApiKey
          }
        });
        const creationId = containerRes.data.id;

        // Step 2: Publish
        const publishRes = await axios.post(`https://graph.threads.net/v1.0/me/threads_publish`, null, {
          params: {
            creation_id: creationId,
            access_token: credentials.threadsApiKey
          }
        });
        return { success: true, id: publishRes.data.id };
      } catch (e) {
        console.error("Official Threads API failed:", e.response?.data || e.message);
        return { success: false, error: "Official Threads API Error: " + (e.response?.data?.error?.message || e.message) };
      }
    }

    // 2. Fall back to Puppeteer (Electron only)
    if (isElectron) return await window.electronAPI.postToThreads(accountId, credentials, content, imagePath);
    return { success: false, error: "Direct posting via Puppeteer is only available in the Windows EXE version. Please set up the Official Threads API key to post from the web." };
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
  },

  // Official API Verification & Insights
  testThreadsConnection: async (token) => {
    try {
      const res = await axios.get(`https://graph.threads.net/v1.0/me`, {
        params: {
          fields: 'id,username',
          access_token: token
        }
      });
      return { success: true, username: res.data.username, id: res.data.id };
    } catch (e) {
      console.error("Threads Connection Test failed:", e.response?.data || e.message);
      return { success: false, error: e.response?.data?.error?.message || e.message };
    }
  },

  getThreadsMedia: async (token) => {
    try {
      const res = await axios.get(`https://graph.threads.net/v1.0/me/threads`, {
        params: {
          fields: 'id,media_url,shortcode,text,timestamp,media_type,permalink',
          access_token: token,
          limit: 10
        }
      });
      return { success: true, data: res.data.data };
    } catch (e) {
      console.error("Threads Media fetch failed:", e.response?.data || e.message);
      return { success: false, error: e.response?.data?.error?.message || e.message };
    }
  },

  getThreadsUserInsights: async (token) => {
    try {
      // Supported User metrics: likes, replies, followers_count, follower_demographics, reposts, views, quotes, clicks
      const res = await axios.get(`https://graph.threads.net/v1.0/me/threads_insights`, {
        params: {
          metric: 'views,likes,replies,reposts,quotes',
          access_token: token
        },
        timeout: 15000 // 15 seconds timeout
      });
      console.log(`[API:Insights] Successfully fetched user insights.`);
      return { success: true, data: res.data.data };
    } catch (e) {
      console.error("[API:Insights] Threads User Insights failed:", e.response?.data || e.message);
      return { success: false, error: e.response?.data?.error?.message || e.message };
    }
  },

  getThreadsMediaInsights: async (token, mediaId) => {
    try {
      // Metric names: views, likes, replies, reposts, quotes
      const res = await axios.get(`https://graph.threads.net/v1.0/${mediaId}/insights`, {
        params: {
          metric: 'views,likes,replies,reposts,quotes',
          access_token: token
        },
        timeout: 15000 // 15 seconds timeout
      });
      console.log(`[API:Insights] Successfully fetched media insights for ${mediaId}.`);
      return { success: true, data: res.data.data };
    } catch (e) {
      console.error(`[API:Insights] Threads Media Insights failed for ${mediaId}:`, e.response?.data || e.message);
      return { success: false, error: e.response?.data?.error?.message || e.message };
    }
  }
};

export default apiService;
