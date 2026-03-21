import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import fs from 'fs';
import os from 'os';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true
    }
  });

  console.log('--- SYSTEM DEBUG ---');
  console.log('Chrome Version:', process.versions.chrome);
  console.log('process.env.VITE_DEV_SERVER_URL:', process.env.VITE_DEV_SERVER_URL);
  
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('Loading Development Server URL...');
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    console.log('VITE_DEV_SERVER_URL not found. Loading dist/index.html...');
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('system:log-to-server', (event, message) => {
  console.log(`[Renderer] ${message}`);
});

// --- Puppeteer IPC Handlers ---
const browserSessions = new Map(); // Store active browsers

/**
 * Finds the system's Chrome or Edge executable.
 * This is crucial for production builds where the default Puppeteer browser 
 * is not bundled in the ASAR.
 */
function getExecutablePath() {
  if (process.env.VITE_DEV_SERVER_URL) {
    // In development, we use the default downloaded browser in .cache/puppeteer
    return undefined; 
  }

  if (process.platform === 'win32') {
    // Common installation paths for Chrome and Edge on Windows
    const winPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe')
    ];

    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (process.platform === 'darwin') {
    // macOS paths
    const macPaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];

    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  return undefined; // Fallback to default
}

// Helper to ensure a browser session exists
async function ensureBrowserSession(accountId, service = 'threads', credentials = {}, options = {}) {
  const sessionKey = `${service}_${accountId}`;
  if (browserSessions.has(sessionKey)) {
    return browserSessions.get(sessionKey);
  }

  // Default to headless: true for background tasks, but allow override
  const isHeadless = options.headless !== undefined ? options.headless : true;
  
  mainWindow.webContents.send('system:log', `Launching ${isHeadless ? 'headless ' : ''}automated browser for ${service} (${credentials.username || accountId})...`);
  
  const launchArgs = isHeadless ? [] : ['--start-maximized'];
  if (credentials.proxy && credentials.proxy.host) {
    const { host, port } = credentials.proxy;
    launchArgs.push(`--proxy-server=${host}:${port}`);
    mainWindow.webContents.send('system:log', `Connecting via proxy: ${host}:${port}`);
  }

  const executablePath = getExecutablePath();
  if (!process.env.VITE_DEV_SERVER_URL && !executablePath) {
    mainWindow.webContents.send('system:log', `[ERROR] Chrome/Edge not found. Please install a browser to use automation features.`);
    throw new Error("自動化に使用するブラウザ（ChromeまたはEdge）が見つかりませんでした。ブラウザをインストールして再度お試しください。");
  }

  const userDataDir = path.join(app.getPath('userData'), 'puppeteer', sessionKey);
  if (!fs.existsSync(path.dirname(userDataDir))) {
    fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
  }

  const browser = await puppeteer.launch({ 
    executablePath: executablePath,
    headless: isHeadless,
    defaultViewport: null,
    userDataDir: userDataDir,
    args: launchArgs
  });
  const page = await browser.newPage();

  if (credentials.proxy && credentials.proxy.username) {
    await page.authenticate({
      username: credentials.proxy.username,
      password: credentials.proxy.password
    });
    mainWindow.webContents.send('system:log', `Proxy authentication enabled for ${credentials.proxy.username}`);
  }
  
  const sessionData = { browser, page };
  browserSessions.set(sessionKey, sessionData);
  const displayLabel = credentials.threadsUsername || credentials.username || accountId;
  mainWindow.webContents.send('system:log', `Browser started for ${service} (${displayLabel})`);
  
  // If we are in headful mode, return early to NOT block the UI while the user interacts
  if (!isHeadless) {
     mainWindow.webContents.send('system:log', `Manual login window opened. Please complete authentication in the browser window.`);
     // Run navigation in background
     page.goto(service === 'threads' ? 'https://www.threads.net/login' : 'https://note.com/login').catch(() => {});
     return sessionData; 
  }

  // Auto-login logic (only for headless or if skipAutoLogin is false)
  if (service === 'threads' && credentials && credentials.username) {
    mainWindow.webContents.send('system:log', `[Threads:${credentials.username}] Navigating to login page...`);
    // Threads may redirect to .com, so we use a flexible navigation approach
    await page.goto('https://www.threads.net/login', { waitUntil: 'networkidle2' });
    const currentUrl = page.url();
    const domain = currentUrl.includes('threads.com') ? 'threads.com' : 'threads.net';
    
    const usernameSelector = 'input[type="text"]';
    await page.waitForSelector(usernameSelector, { timeout: 15000 });
    
    mainWindow.webContents.send('system:log', `[Threads:${credentials.username}] Entering credentials...`);
    await page.type(usernameSelector, credentials.username, { delay: 50 });
    await page.type('input[type="password"]', credentials.password, { delay: 50 });
    
    await page.keyboard.press('Enter');
    mainWindow.webContents.send('system:log', `[Threads:${credentials.username}] Waiting for authentication...${!isHeadless ? ' (Manual 2FA entry is possible)' : ''}`);
    
    // In headful mode, we give the user much more time (e.g. 2 minutes) for 2FA
    const loginTimeout = isHeadless ? 30000 : 120000;
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: loginTimeout });
    } catch (e) {
      if (!isHeadless) {
        mainWindow.webContents.send('system:log', `[Threads:${credentials.username}] Navigation timed out, but check if manual login was successful...`);
      } else {
        throw e;
      }
    }
  } else if (service === 'note' && credentials && credentials.email) {
    mainWindow.webContents.send('system:log', `[Note:${credentials.email}] Navigating to login page...`);
    await page.goto('https://note.com/login', { waitUntil: 'networkidle2' });

    try {
      await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
      mainWindow.webContents.send('system:log', `[Note:${credentials.email}] Entering credentials...`);
      await page.type('input[type="email"], input[name="email"]', credentials.email, { delay: 50 });
      await page.type('input[type="password"], input[name="password"]', credentials.password, { delay: 50 });
      await page.click('button[type="submit"], button.p-login__button');
      
      mainWindow.webContents.send('system:log', `[Note:${credentials.email}] Waiting for authentication...`);
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    } catch (e) {
      mainWindow.webContents.send('system:log', `[Note:Login] Warning: ${e.message}`);
    }
  }

  return session;
}

ipcMain.handle('browser:start', async (event, accountId, credentials, options = {}) => {
  try {
    const session = await ensureBrowserSession(accountId, 'threads', credentials, options);
    const { page, browser } = session;
    
    // If we just started, we might need to fetch profile data
    if (credentials && credentials.username) {
      
      try {
        mainWindow.webContents.send('system:log', `[${credentials.username}] Fetching profile data...`);
        const domain = page.url().includes('threads.com') ? 'threads.com' : 'threads.net';
        await page.goto(`https://www.${domain}/@${credentials.username}`, { waitUntil: 'networkidle2', timeout: 15000 });
        
        // Wait briefly for React to render the profile header
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const profileData = await page.evaluate((credentials) => {
          let avatarUrl = null;
          let followers = 0;
          let name = null;
          let bio = null;
          let recentPost = null;
          
          try {
            // Threads is an SPA, but often updates meta tags for SEO. Let's check them.
            const ogImage = document.querySelector('meta[property="og:image"]')?.content;
            if (ogImage) avatarUrl = ogImage;
            
            const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
            if (ogTitle) {
               // Usually format: "Name (@username) on Threads"
               name = ogTitle.split('(@')[0].trim();
            }

            const ogDesc = document.querySelector('meta[property="og:description"]')?.content;
            if (ogDesc) {
               // Usually format: "X Followers. Bio text..."
               const parts = ogDesc.split('Followers.');
               if (parts.length > 1) {
                  const numStr = parts[0].replace(/,/g, '').trim();
                  if (numStr.includes('K')) followers = parseFloat(numStr) * 1000;
                  else if (numStr.includes('M')) followers = parseFloat(numStr) * 1000000;
                  else followers = parseInt(numStr, 10);
                  
                  bio = parts[1].trim();
               } else {
                  // Fallback for Japanese "X人のフォロワー"
                  const jpParts = ogDesc.split('人のフォロワー。');
                  if (jpParts.length > 1) {
                     const numStr = jpParts[0].replace(/,/g, '').trim();
                     if (numStr.includes('万')) followers = parseFloat(numStr) * 10000;
                     else followers = parseInt(numStr, 10);
                     
                     bio = jpParts[1].trim();
                  } else {
                     bio = ogDesc;
                  }
               }
            }
            
            // Fallback DOM scraping if meta tags are missing
            if (!avatarUrl) {
               const imgs = Array.from(document.querySelectorAll('img'));
               const avatarImg = imgs.find(img => img.alt && (img.alt.includes('profile picture') || img.alt.includes('プロフィール写真')));
               if (avatarImg) avatarUrl = avatarImg.src;
            }
            
            if (!followers) {
               const textNodes = Array.from(document.querySelectorAll('span'));
               const followerEl = textNodes.find(el => el.textContent && 
                 (el.textContent.includes('フォロワー') || el.textContent.includes('followers')) && el.textContent.length < 30);
               if (followerEl) {
                  const match = followerEl.textContent.match(/[\d,kKmM万]+/);
                  if (match) {
                     let numStr = match[0].replace(/,/g, '').toLowerCase();
                     if (numStr.includes('k')) followers = parseFloat(numStr) * 1000;
                     else if (numStr.includes('m')) followers = parseFloat(numStr) * 1000000;
                     else if (numStr.includes('万')) followers = parseFloat(numStr) * 10000;
                     else followers = parseInt(numStr, 10);
                  }
               }
            }

            if (!name) {
               const h1 = document.querySelector('h1');
               if (h1 && h1.textContent) name = h1.textContent;
            }
            // Extract Most Recent Post and Engagement Metrics
            let totalInteractions = 0;
            let sampleSize = 0;
            try {
                let postParent = null;
                
                // Strategy 1: Look for post hyperlink wrapper
                const postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]'));
                
                // For engagement, search for likes/replies across up to 3 posts
                const topPosts = postLinks.slice(0, 3);
                sampleSize = topPosts.length;
                
                topPosts.forEach(link => {
                  const parent = link.closest('div[role="article"]') || link.parentElement?.parentElement?.parentElement;
                  if (parent) {
                    const textContent = parent.innerText || "";
                    // Regex to find numbers followed by likes/replies indicators
                    const likeMatch = textContent.match(/(\d+)\s*(likes|いいね)/i);
                    const replyMatch = textContent.match(/(\d+)\s*(replies|返信)/i);
                    if (likeMatch) totalInteractions += parseInt(likeMatch[1], 10);
                    if (replyMatch) totalInteractions += parseInt(replyMatch[1], 10);
                  }
                });

                if (postLinks.length > 0) {
                  postParent = postLinks[0].closest('div');
                  for(let i=0; i<5; i++) { if(postParent && postParent.parentElement) postParent = postParent.parentElement; }
                }
                
                // Strategy 2: Fallback to time tag if no post link found
                if (!postParent) {
                  const timeEl = document.querySelector('time');
                  if (timeEl) {
                     postParent = timeEl.parentElement;
                     for(let i=0; i<8; i++) { if(postParent && postParent.parentElement) postParent = postParent.parentElement; }
                  }
                }
                
                // Extract data from the assumed container
                if (postParent) {
                   const spans = Array.from(postParent.querySelectorAll('span[dir="auto"]'));
                   // Filter out username, display name, and empty spans
                   const textSpans = spans.filter(s => {
                      const txt = s.textContent ? s.textContent.trim() : "";
                      return txt.length > 1 && txt !== name && txt !== credentials.username && txt !== 'いいね！' && txt !== '返信';
                   });
                   
                   const longestSpan = textSpans.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
                   let contentStr = longestSpan ? longestSpan.textContent : null;
                   
                   const timeEl = postParent.querySelector('time');
                   let timeStr = timeEl ? timeEl.textContent : "最近の投稿";
                   
                   if (contentStr) {
                      recentPost = { time: timeStr, content: contentStr };
                   }
                }
            } catch(e) {
                console.error("Post extraction warning", e);
            }

            let engagementRate = 0;
            if (followers > 0 && sampleSize > 0) {
              engagementRate = ((totalInteractions / sampleSize) / followers) * 100;
              if (engagementRate > 100) engagementRate = 100; // Cap at 100% just in case
            }
            
            return { 
               avatarUrl, 
               name: name || undefined,
               bio: bio || undefined,
               followers: isNaN(followers) ? 0 : followers,
               engagement: parseFloat(engagementRate.toFixed(2)),
               recentPost: recentPost || undefined
            };
          } catch(e) {
             console.error("DOM Extrac error", e);
          }
          
          return { 
             avatarUrl, 
             name: name || undefined,
             bio: bio || undefined,
             followers: isNaN(followers) ? 0 : followers,
             recentPost: recentPost || undefined
          };
        }, credentials);
        
        mainWindow.webContents.send('system:log', `[${credentials.username}] Profile data synced.`);
        // Clean undefined to avoid JSON parse errors across IPC
        if (!profileData.avatarUrl) delete profileData.avatarUrl;
        
        // Auto-close if requested (e.g. for silent refresh)
        if (options.autoClose) {
          mainWindow.webContents.send('system:log', `[${credentials.username}] Auto-closing browser after profile fetch.`);
          const sessionKey = `threads_${accountId}`;
          await browser.close();
          browserSessions.delete(sessionKey);
        }

        return { success: true, profileData };
        
      } catch (scrapeError) {
        console.log('Error scraping profile details:', scrapeError);
        // If profile scraping fails, just return success true anyway
      }
    }

    return { success: true };
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('browser:open-login-window', async (event, accountId, type = 'threads') => {
  try {
    const partition = `persist:${type}_account_${accountId}`;
    const url = type === 'threads' ? 'https://www.threads.net/login' : 'https://note.com/login';
    
    const ses = session.fromPartition(partition);
    const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
    ses.setUserAgent(ua);

    let loginWindow = new BrowserWindow({
      width: 600,
      height: 800,
      title: `Manual Login - ${type}`,
      webPreferences: {
        partition: partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      }
    });

    console.log(`[LoginWindow] Opening ${url} in partition ${partition} with UA: ${ua}`);

    loginWindow.webContents.on('did-finish-load', () => {
      const currentUrl = loginWindow.webContents.getURL();
      console.log(`[LoginWindow] Finished loading: ${currentUrl}`);
      
      if (currentUrl.includes('login_success=true') || currentUrl.includes('threads.net/') && !currentUrl.includes('login')) {
         console.log("[LoginWindow] Login success detected via URL. Auto-closing...");
         setTimeout(() => {
           if (!loginWindow.isDestroyed()) loginWindow.close();
         }, 1500);
      }
    });

    loginWindow.webContents.on('will-navigate', (event, url) => {
      console.log(`[LoginWindow] Navigating to: ${url}`);
      if (url.includes('login_success=true')) {
        console.log("[LoginWindow] Success URL detected in navigation. Closing soon...");
      }
    });

    loginWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[LoginWindow] Failed to load: ${validatedURL} (${errorCode}: ${errorDescription})`);
      mainWindow.webContents.send('system:log', `[ERROR] Login window failed to load: ${errorDescription}`);
    });

    loginWindow.loadURL(url);
    
    return new Promise((resolve) => {
      loginWindow.on('closed', () => {
        resolve({ success: true, message: 'Login window closed' });
      });
    });
  } catch (error) {
    console.error("LoginWindow Error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:clear-session', async (event, accountId, type = 'threads') => {
  try {
    const partition = `persist:${type}_account_${accountId}`;
    const ses = session.fromPartition(partition);
    if (!ses) throw new Error("Could not find session partition.");
    
    await ses.clearStorageData();
    await ses.clearCache();
    mainWindow.webContents.send('system:log', `Successfully cleared all session data for ${partition}`);
    return { success: true };
  } catch (error) {
    console.error("ClearSession Error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('browser:stop', async (event, accountId) => {
  try {
    const session = browserSessions.get(accountId);
    if (session) {
      await session.browser.close();
      browserSessions.delete(accountId);
      mainWindow.webContents.send('system:log', `Browser stopped for ${accountId}`);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('browser:action', async (event, accountId, actionType, payload) => {
  try {
    const session = browserSessions.get(accountId);
    if (!session) throw new Error("No active browser session found.");
    
    const { page } = session;
    mainWindow.webContents.send('system:log', `Executing ${actionType} for ${accountId}...`);
    
    if (actionType === 'login') {
      await page.goto('https://www.threads.net/login');
      // Later: implement actual login automation here using payload.username / payload.password
      return { success: true, message: 'Navigated to login' };
    }
    
    return { success: false, message: 'Unknown action' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- Puppeteer Post Actions ---
ipcMain.handle('browser:postToThreads', async (event, accountId, credentials, content, imagePath = null) => {
  try {
    const session = await ensureBrowserSession(accountId, 'threads', credentials);
    const { page } = session;
    
    mainWindow.webContents.send('system:log', `[${credentials.username}] Accessing Threads...`);
    await page.goto('https://www.threads.net/', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const currentUrl = page.url();
    const domain = currentUrl.includes('threads.com') ? 'threads.com' : 'threads.net';

    // Check if logged in using robust selectors
    const isLoggedIn = await page.evaluate(() => {
        const hasProfileLink = !!Array.from(document.querySelectorAll('nav a, div[role="navigation"] a')).find(a => {
            const href = a.getAttribute('href');
            return href && href.startsWith('/@') && !href.includes('/@threads');
        });
        const hasCreateIcon = !!document.querySelector('svg[aria-label="Create"], svg[aria-label="新規スレッド"], svg[aria-label="作成"]');
        return hasProfileLink || hasCreateIcon;
    });

    if (!isLoggedIn) {
      mainWindow.webContents.send('system:log', `[${credentials.username}] Not logged in. Attempting login...`);
      await page.goto(`https://www.${domain}/login`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('input[type="text"]', { timeout: 15000 });
      await page.type('input[type="text"]', credentials.username, { delay: 50 });
      await page.type('input[type="password"]', credentials.password, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      await page.goto(`https://www.${domain}/`, { waitUntil: 'networkidle2' });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    mainWindow.webContents.send('system:log', `[${credentials.username}] Locating compose button...`);
    const clickCompose = await page.evaluate(() => {
        const svgCreate = document.querySelector('svg[aria-label="Create"], svg[aria-label="新規スレッド"], svg[aria-label="作成"]');
        if (svgCreate) {
            const btn = svgCreate.closest('div[role="button"], a');
            if (btn) { btn.click(); return "svg-create"; }
        }
        
        // Text based fallback
        const allElements = Array.from(document.querySelectorAll('span, div[role="button"], p, button'));
        const composeTrigger = allElements.find(el => {
            const txt = el.textContent || "";
            return txt.includes('Start a thread') || txt.includes('スレッドを開始') || txt.includes('What\'s new?') || (txt.length === 1 && txt === '+');
        });
        if (composeTrigger) {
            composeTrigger.click();
            return "text-trigger";
        }
        return null;
    });

    if (!clickCompose) throw new Error("Could not find compose button");
    mainWindow.webContents.send('system:log', `[${credentials.username}] Opened compose modal via ${clickCompose}`);

    // Wait for the active text area to appear
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Handle Image Upload if provided
    if (imagePath && fs.existsSync(imagePath)) {
        mainWindow.webContents.send('system:log', `[${credentials.username}] Uploading image: ${imagePath}...`);
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            await fileInput.uploadFile(imagePath);
            mainWindow.webContents.send('system:log', `[${credentials.username}] Image selected.`);
            await new Promise(resolve => setTimeout(resolve, 4000)); // Wait for upload preview
        } else {
            mainWindow.webContents.send('system:log', `[${credentials.username}] Warning: File input not found. Skipping image.`);
        }
    }
    
    // Split content by '---' to handle threads
    const postParts = content.split('---').map(p => p.trim()).filter(p => p.length > 0);
    mainWindow.webContents.send('system:log', `[${credentials.username}] Content split into ${postParts.length} parts.`);

    for (let i = 0; i < postParts.length; i++) {
        const part = postParts[i];
        
        await page.waitForSelector('div[contenteditable="true"]', { timeout: 10000 });
        mainWindow.webContents.send('system:log', `[${credentials.username}] Typing part ${i + 1}...`);
        
        await page.evaluate((txt) => {
            const editors = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
            const editor = editors[editors.length - 1]; // Use the last one (most recent in thread)
            if (editor) {
                editor.focus();
                document.execCommand('insertText', false, txt);
            }
        }, part);

        if (i < postParts.length - 1) {
            mainWindow.webContents.send('system:log', `[${credentials.username}] Adding next part to thread...`);
            const addedNext = await page.evaluate(() => {
                const modal = document.querySelector('div[role="dialog"]');
                if (!modal) return false;
                
                const buttons = Array.from(modal.querySelectorAll('div[role="button"]'));
                const addBtn = buttons.find(b => {
                    const t = b.textContent || "";
                    return t.includes('Add to thread') || t.includes('スレッドに追加') || t.includes('Add another');
                });
                
                if (addBtn) { addBtn.click(); return true; }
                const plusSvg = modal.querySelector('svg[aria-label="Add to thread"], svg[aria-label="スレッドに追加"]');
                if (plusSvg) { plusSvg.closest('div[role="button"]').click(); return "svg-add"; }
                return false;
            });

            if (!addedNext) throw new Error(`Failed to add part ${i + 2} to thread.`);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }

    mainWindow.webContents.send('system:log', `[${credentials.username}] Clicking final Post button...`);
    const clickedPost = await page.evaluate(() => {
        const modal = document.querySelector('div[role="dialog"]');
        if (!modal) return false;
        
        const buttons = Array.from(modal.querySelectorAll('div[role="button"]'));
        const postBtn = buttons.find(b => {
           const t = b.textContent || "";
           return (t === 'Post' || t === '投稿' || t === 'Post all' || t === 'すべて投稿') && !b.hasAttribute('aria-disabled');
        });
        
        if (postBtn) { postBtn.click(); return true; }
        const lastBtn = buttons[buttons.length - 1];
        if (lastBtn && !lastBtn.hasAttribute('aria-disabled')) { lastBtn.click(); return "modal-last-btn"; }
        return false;
    });

    if (!clickedPost) throw new Error("Could not find the final 'Post' button.");
    mainWindow.webContents.send('system:log', `[${credentials.username}] Post clicked. Verifying...`);
    
    let modalGone = false;
    for (let attempt = 0; attempt < 20; attempt++) {
        const isModalPresent = await page.evaluate(() => !!document.querySelector('div[role="dialog"]'));
        if (!isModalPresent) { modalGone = true; break; }
        await new Promise(res => setTimeout(res, 1000));
    }

    if (!modalGone) throw new Error("Post button clicked, but modal didn't close.");
    mainWindow.webContents.send('system:log', `[${credentials.username}] Deployment successful.`);
    return { success: true };

  } catch (error) {
    mainWindow.webContents.send('system:log', `[Post Error] ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('browser:postToNote', async (event, accountId, credentials, title, content) => {
  try {
    const session = await ensureBrowserSession(accountId, 'note', { email: credentials.noteEmail, password: credentials.notePassword });
    const { page } = session;

    mainWindow.webContents.send('system:log', `[Note:${credentials.noteEmail}] Accessing Note Editor...`);
    
    // Check if on a page where we can see the "Write" button
    await page.goto('https://note.com/', { waitUntil: 'networkidle2' });
    
    // Try to find the "Create Note" button (Usually a pencil icon or "投稿")
    await page.waitForSelector('a[href="/edit"], button.p-navbar__postButton', { timeout: 15000 }).catch(() => {});
    await page.goto('https://note.com/edit', { waitUntil: 'networkidle2' });

    mainWindow.webContents.send('system:log', `[Note] Entering Title and Content...`);
    
    // Title
    await page.waitForSelector('textarea.p-articleEditor__title, .p-articleEditor__title textarea', { timeout: 15000 });
    await page.type('textarea.p-articleEditor__title, .p-articleEditor__title textarea', title, { delay: 20 });
    
    // Content (EditorJS or similar contenteditable)
    await page.click('.p-articleEditor__content, .ce-paragraph');
    await page.keyboard.type(content, { delay: 5 });

    mainWindow.webContents.send('system:log', `[Note] Content injected. Preparing to publish...`);
    await new Promise(r => setTimeout(r, 2000)); // Wait for auto-save/UI sync

    // Click Publish button (usually "公開設定" first)
    await page.click('button.p-articleEditor__publishButton, button:contains("公開設定")').catch(async () => {
        // Fallback for different selector
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const pBtn = btns.find(b => b.textContent.includes('公開設定'));
            if (pBtn) pBtn.click();
        });
    });

    await page.waitForSelector('button.p-articlePublishingSettings__publishButton', { timeout: 10000 }).catch(() => {});
    
    // Final Publish click
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const finalBtn = btns.find(b => b.textContent.includes('投稿する') || b.textContent.includes('Publish'));
        if (finalBtn) finalBtn.click();
    });

    mainWindow.webContents.send('system:log', `[Note] Successfully posted article: ${title}`);
    return { success: true };

  } catch (error) {
    mainWindow.webContents.send('system:log', `[Note Error] ${error.message}`);
    return { success: false, error: error.message };
  }
});

// --- High-Performance API Handlers ---

ipcMain.handle('api:generateImage', async (event, apiKey, prompt) => {
  try {
    mainWindow.webContents.send('system:log', `Generating image with DALL-E 3...`);
    const response = await axios.post('https://api.openai.com/v1/images/generations', {
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      response_format: "url"
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    const imageUrl = response.data.data[0].url;
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    
    // Save to temp file
    const tempPath = path.join(os.tmpdir(), `threads_image_${Date.now()}.png`);
    const buffer = Buffer.from(imageResponse.data);
    fs.writeFileSync(tempPath, buffer);
    const base64 = buffer.toString('base64');
    
    mainWindow.webContents.send('system:log', `Image generated and saved to ${tempPath}`);
    return { success: true, imagePath: tempPath, base64: `data:image/png;base64,${base64}` };
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    mainWindow.webContents.send('system:log', `[Image Error] ${msg}`);
    return { success: false, error: msg };
  }
});

ipcMain.handle('api:callExternalLLM', async (event, provider, apiKey, model, prompt) => {
  try {
    mainWindow.webContents.send('system:log', `Calling ${provider} (${model})...`);
    const finalModel = (model === 'auto' || !model) ? null : model;
    
    if (provider === 'openai') {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: finalModel || 'gpt-4o',
        messages: [{ role: "user", content: prompt }]
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const content = response.data.choices[0].message.content || "";
      return { success: true, content };
    } 
    
    if (provider === 'gemini') {
      const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro', 'gemini-pro', 'gemini-1.5-flash-latest'];
      const versions = ['v1beta', 'v1'];
      let lastErr = '';
      let lastStatus = 0;
      
      let prioritizedModels = finalModel ? [finalModel, ...models] : models;
      // Filter out 'auto' or empty values just in case
      prioritizedModels = [...new Set(prioritizedModels)].filter(m => m && m !== 'auto' && m !== 'auto ');
      
      for (const ver of versions) {
        for (const m of prioritizedModels) {
          try {
            const url = `https://generativelanguage.googleapis.com/${ver}/models/${m}:generateContent?key=${apiKey.trim()}`;
            const resp = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }] });
            const text = resp.data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) continue;
            return { success: true, content: text };
          } catch (error) {
            lastStatus = error.response?.status || 0;
            lastErr = error.response?.data?.error?.message || error.message;
            if (lastStatus === 404) continue;
            else break;
          }
        }
      }
      throw new Error(`Geminiエラー(${lastStatus}): ${lastErr}`);
    }

    if (provider === 'anthropic') {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: finalModel || 'claude-3-5-sonnet-20240620',
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      }, {
        headers: { 
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
      const content = response.data.content[0].text || "";
      return { success: true, content };
    }

    if (provider === 'manus') {
      const response = await axios.post('https://api.manus.im/v1/chat/completions', {
        model: finalModel || 'manus-1',
        messages: [{ role: "user", content: prompt }]
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const content = response.data.choices[0].message.content || "";
      return { success: true, content };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    mainWindow.webContents.send('system:log', `[LLM Error] ${msg}`);
    return { success: false, error: msg };
  }
});

// --- GitHub Sync Handlers ---

ipcMain.handle('github:push', async (event, { token, repo, path: filePath, content, message }) => {
  try {
    mainWindow.webContents.send('system:log', `GitHub: Pushing to ${repo}/${filePath}...`);
    const baseUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    };

    // 1. Check if file exists to get SHA
    let sha;
    try {
      const getRes = await axios.get(baseUrl, { headers });
      sha = getRes.data.sha;
    } catch (e) {
      // File doesn't exist yet, that's fine
    }

    // 2. Push content (base64 encoded)
    const putRes = await axios.put(baseUrl, {
      message: message || `Updated ${filePath} via AutoThreader`,
      content: Buffer.from(content).toString('base64'),
      sha
    }, { headers });

    mainWindow.webContents.send('system:log', `GitHub: Push successful (${repo}/${filePath})`);
    return { success: true, sha: putRes.data.content.sha };
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    mainWindow.webContents.send('system:log', `[GitHub Push Error] ${msg}`);
    return { success: false, error: msg };
  }
});

ipcMain.handle('github:pull', async (event, { token, repo, path: filePath }) => {
  try {
    mainWindow.webContents.send('system:log', `GitHub: Pulling from ${repo}/${filePath}...`);
    const baseUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    };

    const res = await axios.get(baseUrl, { headers });
    const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
    
    mainWindow.webContents.send('system:log', `GitHub: Pull successful (${repo}/${filePath})`);
    return { success: true, content, sha: res.data.sha };
  } catch (error) {
    if (error.response?.status === 404) {
      return { success: true, content: null, message: "File not found" };
    }
    const msg = error.response?.data?.message || error.message;
    mainWindow.webContents.send('system:log', `[GitHub Pull Error] ${msg}`);
    return { success: false, error: msg };
  }
});

ipcMain.handle('api:getTrends', async (event, query) => {
  try {
    mainWindow.webContents.send('system:log', `Fetching trends for: ${query || 'General Japanese News'}...`);
    // Google News RSS in Japanese
    const url = query 
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`
      : `https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja`;
    
    const response = await axios.get(url);
    const xml = response.data;
    
    // Simple regex to extract titles (RSS <title> items)
    const titles = [];
    const matches = xml.matchAll(/<title>(.*?)<\/title>/g);
    for (const match of matches) {
      if (match[1] && !match[1].includes("Google ニュース")) {
        titles.push(match[1]);
      }
    }
    
    return { success: true, trends: titles.slice(0, 10) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('browser:autoEngage', async (event, accountId, credentials, settings) => {
  const { keywords, actionType, count = 3, replyPrompt = "" } = settings;
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  
  try {
    const session = browserSessions.get(accountId);
    if (!session) throw new Error("Browser not started for this account.");
    
    const { page } = session;
    mainWindow.webContents.send('system:log', `[AutoEngage] Starting search for "${keyword}"...`);
    
    // 1. Search
    await page.goto(`https://www.threads.net/search?q=${encodeURIComponent(keyword)}`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    // 2. Select posts
    const posts = await page.$$('div[data-pressable-container="true"]');
    const targetCount = Math.min(posts.length, count);
    
    for (let i = 0; i < targetCount; i++) {
      try {
        mainWindow.webContents.send('system:log', `[AutoEngage] Processing post ${i+1}/${targetCount}...`);
        
        if (actionType === 'like' || actionType === 'both') {
          const likeBtn = await posts[i].$('div[role="button"][aria-label="いいね！"]');
          if (likeBtn) {
             await likeBtn.click();
             await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
          }
        }
        
        if (actionType === 'reply' || actionType === 'both') {
          const replyBtn = await posts[i].$('div[role="button"][aria-label="返信"]');
          if (replyBtn) {
            await replyBtn.click();
            await new Promise(r => setTimeout(r, 2000));
            
            // Generate reply if prompt exists
            if (replyPrompt) {
              // Note: Frontend will call LLM and pass the content if this was triggered from loop
              // but for now let's assume content is passed or just a simple placeholder
              const editor = await page.$('div[aria-label="スレッドへの返信..."]');
              if (editor) {
                await editor.type(replyPrompt);
                await new Promise(r => setTimeout(r, 1000));
                const postBtn = await page.$('div[role="button"][tabindex="0"]:not([aria-label])'); // Find post button in modal
                if (postBtn) await postBtn.click();
                await new Promise(r => setTimeout(r, 3000));
              }
            }
          }
        }
      } catch (e) {
        mainWindow.webContents.send('system:log', `[AutoEngage] Item failed: ${e.message}`);
      }
    }
    
    return { success: true };
  } catch (error) {
    mainWindow.webContents.send('system:log', `[AutoEngage Error] ${error.message}`);
    return { success: false, error: error.message };
  }
});

const DM_LOG_FILE = path.join(app.getPath('userData'), 'threads_dm_log.json');

function getDMLog() {
  if (fs.existsSync(DM_LOG_FILE)) {
    return JSON.parse(fs.readFileSync(DM_LOG_FILE, 'utf-8'));
  }
  return [];
}

function saveDMLog(log) {
  fs.writeFileSync(DM_LOG_FILE, JSON.stringify(log, null, 2));
}

ipcMain.handle('browser:checkRepliesAndDM', async (event, accountId, credentials, dmContent) => {
  try {
    const session = browserSessions.get(accountId);
    if (!session) throw new Error("Browser not started for this account.");
    
    const { page } = session;
    const processedIds = getDMLog();
    
    mainWindow.webContents.send('system:log', `[AutoDM] Checking for new replies...`);
    
    // 1. Navigate to Heart (Activity) page
    await page.goto('https://www.threads.net/notifications', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));
    
    // 2. Filter by "Replies" if possible, or just look for reply notifications
    // Note: Threads activity page usually has filters like "All", "Replies", "Mentions", "Verified"
    const filters = await page.$$('span');
    for (const f of filters) {
      const text = await page.evaluate(el => el.textContent, f);
      if (text.includes('返信') || text.includes('Replies')) {
        await f.click();
        await new Promise(r => setTimeout(r, 2000));
        break;
      }
    }

    // 3. Find notification items
    // This is heuristic-based as Threads selectors change
    const notifications = await page.$$('div[role="listitem"]');
    mainWindow.webContents.send('system:log', `[AutoDM] Found ${notifications.length} notifications.`);

    for (const item of notifications) {
      const itemData = await page.evaluate(el => {
        // Find the username and the specific reply link/id
        const userEl = el.querySelector('a[href^="/@"]');
        const username = userEl ? userEl.href.split('@')[1].split('/')[0] : null;
        // Generate a pseudo-unique ID based on text content and username
        const content = el.textContent || "";
        return { username, content, id: `${username}_${content.substring(0, 20)}` };
      }, item);

      if (itemData.username && !processedIds.includes(itemData.id)) {
        mainWindow.webContents.send('system:log', `[AutoDM] New reply from @${itemData.username}. Sending DM...`);
        
        // 4. Send DM
        // Threads DM is usually via /messages or profile
        await page.goto(`https://www.threads.net/@${itemData.username}`, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));
        
        const messageBtn = await page.evaluateHandle(() => {
          const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
          return btns.find(b => b.textContent.includes('メッセージ') || b.textContent.includes('Message'));
        });

        if (messageBtn.asElement()) {
          await messageBtn.asElement().click();
          await new Promise(r => setTimeout(r, 3000));
          
          // Type message
          await page.keyboard.type(dmContent, { delay: 50 });
          await new Promise(r => setTimeout(r, 1000));
          await page.keyboard.press('Enter');
          
          mainWindow.webContents.send('system:log', `[AutoDM] Sent to @${itemData.username}.`);
          processedIds.push(itemData.id);
          saveDMLog(processedIds);
          
          // Small delay between DMs to stay safe
          await new Promise(r => setTimeout(r, 5000));
          
          // Go back to notifications for next item
          await page.goto('https://www.threads.net/notifications', { waitUntil: 'networkidle2' });
          await f.click(); // Re-apply filter
          await new Promise(r => setTimeout(r, 2000));
        } else {
          mainWindow.webContents.send('system:log', `[AutoDM] Could not find Message button for @${itemData.username}.`);
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    mainWindow.webContents.send('system:log', `[AutoDM Error] ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('browser:autoLike', async (event, accountId, credentials, options = {}) => {
  try {
    const session = await ensureBrowserSession(accountId, 'threads', credentials);
    const { page } = session;
    
    if (!options.skipNavigation) {
      mainWindow.webContents.send('system:log', `[AutoLike] Navigating to home feed for @${credentials.username}...`);
      await page.goto('https://www.threads.net/', { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 4000));
    } else {
      mainWindow.webContents.send('system:log', `[AutoLike] Running Auto-Like on current page...`);
    }

    // Robust selector: handles Japanese, English, and variations in aria-label
    const selector = '[aria-label*="いいね"], [aria-label*="Like"], [aria-label*="좋아요"]';
    
    let likedCount = 0;
    const targetCount = 3 + Math.floor(Math.random() * 3); // Like 3-5 posts
    
    for (let i = 0; i < targetCount; i++) {
      try {
        // Re-discover buttons on every iteration
        const allButtons = await page.$$(selector);
        
        // Filter for visible/interactive buttons that haven't been liked yet (or just general visible ones)
        // We look for the n-th visible button in the list
        let visibleButtons = [];
        for (const btn of allButtons) {
          const isVisible = await btn.evaluate(el => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
          if (isVisible) visibleButtons.push(btn);
        }

        mainWindow.webContents.send('system:log', `[AutoLike Trace] Iteration ${i+1}: Found ${visibleButtons.length} visible buttons.`);

        if (visibleButtons.length <= likedCount) {
          mainWindow.webContents.send('system:log', `[AutoLike] No more clickable posts found.`);
          break;
        }

        const button = visibleButtons[likedCount];
        if (button) {
          await button.scrollIntoViewIfNeeded();
          await new Promise(r => setTimeout(r, 800)); // Wait for scroll/render
          
          await button.click();
          likedCount++;
          mainWindow.webContents.send('system:log', `[AutoLike] Success: Liked post ${likedCount}/${targetCount}`);
          
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
        }
      } catch (e) {
        mainWindow.webContents.send('system:log', `[AutoLike Warning] Skipping post: ${e.message}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return { success: true, count: likedCount };
  } catch (error) {
    mainWindow.webContents.send('system:log', `[AutoLike Error] ${error.message}`);
    return { success: false, error: error.message };
  }
});
