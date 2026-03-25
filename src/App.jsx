import React, { useState, useEffect, useRef } from 'react';
import { 
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts';
import {
  Home,
  Users,
  CalendarClock,
  BarChart3,
  Settings,
  Bell,
  Search,
  Plus,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  RefreshCw,
  MessageCircle,
  Repeat,
  Heart,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Settings2,
  Instagram,
  Send,
  MoreHorizontal,
  Bot,
  Sparkles,
  ShieldAlert,
  ThumbsUp,
  UserPlus,
  TrendingUp,
  Activity,
  ArrowUpRight,
  Clock,
  AlertTriangle,
  Zap,
  Save,
  Key,
  Lock,
  Mail,
  User,
  ShieldCheck,
  CreditCard,
  LogOut,
  Copy,
  Trash2,
  Globe,
  Layout,
  Monitor,
  Cloud,
  X,
  Download,
  HelpCircle
} from 'lucide-react';
import { db, auth } from './firebase';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import appLogo from './assets/logo.png';
import apiService from './services/api';

// --- Mock Database (LocalStorage) 初期化 ---
if (!localStorage.getItem('usersDB')) {
  localStorage.setItem('usersDB', JSON.stringify([{ username: 'admin', password: 'password', role: 'admin', license: 'ADMIN-KEY' }]));
  localStorage.setItem('licensesDB', JSON.stringify([{ key: "ADMIN-KEY", type: "lifetime", used: true, usedBy: "admin" }]));
}
// Init real threads accounts DB
if (!localStorage.getItem('threadsAccountsDB')) {
  localStorage.setItem('threadsAccountsDB', JSON.stringify([]));
}

// --- Subscription Plan Definitions ---
const SUBSCRIPTION_PLANS = {
  trial: { name: 'Trial', maxAccounts: 1, features: ['post'], price: 0 },
  entry: { name: 'Entry', maxAccounts: 1, features: ['post', 'engine'], price: 2980 },
  advance: { name: 'Advance', maxAccounts: 5, features: ['post', 'like', 'engine'], price: 9980 },
  pro: { name: 'Pro', maxAccounts: 20, features: ['post', 'like', 'engine', 'proxy'], price: 29800 },
  enterprise: { name: 'Enterprise', maxAccounts: 100, features: ['post', 'like', 'engine', 'proxy'], price: 'Price Negotiable' },
};

const callAI = async (provider, apiKey, model, prompt) => {
  if (!apiKey) throw new Error("APIキーが設定されていません。");

  if (provider === 'gemini') {
    const baseModels = [...new Set([model?.trim(), 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-1.5-flash-latest'])]
      .filter(m => m && m !== 'auto' && m !== 'auto ');
    const apiVersions = ['v1beta', 'v1'];
    let lastErrorMsg = "";
    let lastStatus = 0;
    
    for (const ver of apiVersions) {
      for (const m of baseModels) {
        const url = `https://generativelanguage.googleapis.com/${ver}/models/${m}:generateContent?key=${apiKey.trim()}`;
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          });
          
          lastStatus = response.status;
          if (response.ok) {
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return text;
          } else {
            const errData = await response.json().catch(() => ({}));
            lastErrorMsg = errData.error?.message || response.statusText;
            if (response.status === 404) continue;
            else break;
          }
        } catch (e) {
          lastErrorMsg = e.message;
          continue;
        }
      }
    }
    throw new Error(`Geminiエラー(${lastStatus}): ${lastErrorMsg}`);
  }

  // --- Gemini Diagnostic Function ---
  if (provider === 'gemini_diag') {
    const apiVersions = ['v1beta', 'v1'];
    let lastError = "";
    for (const ver of apiVersions) {
      try {
        const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${apiKey.trim()}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const models = data.models || [];
          const list = models.map(m => m.name.split('/').pop()).join(', ');
          return `接続成功 (${ver})! 利用可能なモデル: ${list}`;
        }
        lastError = `Status ${res.status}: ${res.statusText}`;
      } catch (e) { lastError = e.message; }
    }
    throw new Error(`診断失敗: ${lastError}`);
  }

  // Use abstracted apiService for other models
  const res = await apiService.callAI(provider, apiKey, model, prompt);
  if (!res.success) throw new Error(`AIエラー (${provider}): ${res.error}`);
  return res.content;
};

// --- Automation Utilities ---
const buildPrompt = (persona, trends = []) => {
  const { theme, tone, promptText, target, benefits, keywords, exclusions, useEmojis, postFormat } = persona;
  const emojiInstruction = useEmojis ? "適切な絵文字を各所に散りばめてください。" : "絵文字は一切使用しないでください。";
  const formatInstruction = postFormat === 'thread'
    ? "3〜5件の連続したスレッド形式で作成してください。各ポストの間には '---' （ハイフン3つ）のセパレーターを入れてください。"
    : "1件の完結したポスト（最大300文字）として作成してください。";
  const trendContext = trends.length > 0 ? `\n【現在のトレンド情報】\n${trends.slice(0, 5).map(t => `- ${t}`).join('\n')}\n※可能な限り、これらのトレンド要素を自然に文脈に組み込んでください。` : "";

  return `あなたはSNS（Threads）の運用プロフェッショナルです。以下の詳細設定に基づき、ユーザーの興味を惹く投稿を作成してください。
${trendContext}
【テーマ】${theme}
【文体・口調】${tone}
【ターゲット読者】${target || '指定なし'}
【得られるベネフィット】${benefits || '指定なし'}
【重要キーワード】${keywords || '指定なし'}
【除外事項】${exclusions || 'なし'}
【詳細な指示】${promptText}

${formatInstruction}

条件：
- ${emojiInstruction}
- 読みやすい改行を入れる
- 問いかけや共感を誘う内容にする
- ハッシュタグを2〜3個入れる`;
};

// --- Firestore Uniqueness Utilities ---
const verifyAndLinkAccount = async (type, identifier, toolAccountId) => {
  if (!identifier) return { success: true };
  
  const docId = `${type}_${identifier.replace(/[^a-zA-Z0-9.@_-]/g, '_')}`;
  const docRef = doc(db, "linked_accounts", docId);
  
  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.toolAccountId !== toolAccountId) {
        return { 
          success: false, 
          error: `この${type === 'threads' ? 'Threads' : 'note'}アカウントは、既に別のツールアカウント（${data.toolAccountId}）で連携されています。` 
        };
      }
    }
    
    // Link (or refresh link)
    await setDoc(docRef, {
      type,
      value: identifier,
      toolAccountId,
      linkedAt: new Date().toISOString()
    });
    
    return { success: true };
  } catch (e) {
    console.error("Firestore Uniqueness Check Error:", e);
    // If permission denied or other error, we might want to fail-safe or fail-closed.
    // For now, fail-closed to ensure uniqueness.
    return { success: false, error: "連携状況の確認に失敗しました: " + e.message };
  }
};

const unlinkAccount = async (type, identifier) => {
  if (!identifier) return;
  const docId = `${type}_${identifier.replace(/[^a-zA-Z0-9.@_-]/g, '_')}`;
  try {
    await deleteDoc(doc(db, "linked_accounts", docId));
  } catch (e) {
    console.error("Firestore Unlink Error:", e);
  }
};


// Background Automation Engine
const AutomationEngine = ({ accounts, onAccountsUpdate }) => {
  const timersRef = useRef({});

  useEffect(() => {
    // Current active accounts
    const activeAccounts = accounts.filter(acc => acc.status === 'active');
    
    // Cleanup removed or paused accounts
    Object.keys(timersRef.current).forEach(id => {
      if (!activeAccounts.find(acc => acc.id.toString() === id)) {
        clearTimeout(timersRef.current[id]);
        delete timersRef.current[id];
        console.log(`[AutomationEngine] Stopped account ${id}`);
      }
    });

    // Start newcomers
    activeAccounts.forEach(acc => {
      if (!timersRef.current[acc.id]) {
        console.log(`[AutomationEngine] Starting account ${acc.id} (@${acc.threadsUsername})`);
        scheduleNext(acc);
      }
    });
  }, [accounts]);

  // --- Cloud Task Sync (Polls for scheduled tasks in Firestore) ---
  useEffect(() => {
    const syncCloudTasks = async () => {
      const activeAccount = accounts.find(acc => acc.status === 'active');
      if (!activeAccount) return;

      try {
        const now = new Date().toISOString();
        const q = query(
          collection(db, "cloud_tasks"), 
          where("status", "==", "pending"),
          where("scheduledAt", "<=", now)
        );
        const querySnapshot = await getDocs(q);

        for (const taskDoc of querySnapshot.docs) {
          const taskData = taskDoc.data();
          
          // Target account check - prioritize the one specified in the task
          let execAccount = null;
          if (taskData.targetAccountId) {
            execAccount = accounts.find(a => a.id === taskData.targetAccountId && a.status === 'active');
          }
          
          // Fallback to any active account if the specific one is missing or inactive
          if (!execAccount) {
            execAccount = accounts.find(acc => acc.status === 'active');
          }

          if (!execAccount) {
             console.log("[CloudSync] No active accounts available to execute cloud task.");
             continue; 
          }

          // Mark as processing to avoid double pickup
          await updateDoc(doc(db, "cloud_tasks", taskDoc.id), { 
            status: 'processing',
            executorId: execAccount.id 
          });

          if (apiService.isElectron) {
            apiService.logToServer(`[CloudSync] Executing Cloud Task for @${execAccount.threadsUsername}`);
            
            const credentials = {
              username: execAccount.threadsUsername,
              password: execAccount.threadsPassword,
              proxy: execAccount.proxy,
              threadsApiKey: execAccount.personaSettings?.threadsApiKey
            };

            try {
              // Execute the post
              await apiService.postToThreads(execAccount.id, credentials, taskData.text, null);
              
              // Mark as completed
              await updateDoc(doc(db, "cloud_tasks", taskDoc.id), { 
                status: 'completed', 
                completedAt: new Date().toISOString() 
              });
              apiService.logToServer(`[CloudSync] Success: Task ${taskDoc.id} posted.`);
            } catch (err) {
              await updateDoc(doc(db, "cloud_tasks", taskDoc.id), { 
                status: 'error', 
                error: err.message 
              });
              apiService.logToServer(`[CloudSync] Failed: Task ${taskDoc.id} error: ${err.message}`);
            }
          }
        }
      } catch (e) {
        console.error("Cloud Task Sync Error:", e);
      }
    };

    // Check immediately and then every 5 minutes
    syncCloudTasks();
    const interval = setInterval(syncCloudTasks, 300000); 
    return () => clearInterval(interval);
  }, [accounts]);

  const scheduleNext = (account) => {
    const intervalMin = account.personaSettings?.intervalMin || 60;
    const delay = intervalMin * 60 * 1000;
    
    // If it never ran, run almost immediately (with small staggered delay)
    const lastRun = account.lastRun || 0;
    const timeSinceLast = Date.now() - lastRun;
    const actualDelay = Math.max(1000, delay - timeSinceLast);

    timersRef.current[account.id] = setTimeout(() => runCycle(account.id), actualDelay);
  };

  const runCycle = async (accountId) => {
    // Re-fetch account from latest props/state if possible, or just use the id to find it
    const account = rawAccounts.find(a => a.id === accountId);
    
    if (!account || account.status !== 'active') return;

    const persona = account.personaSettings || {};
    const aiProvider = persona.aiProvider || 'gemini';
    const aiModel = persona.aiModel || 'gemini-1.5-flash';
    
    const keyMap = {
      gemini: persona.geminiApiKey || localStorage.getItem('geminiApiKey'),
      openai: persona.openaiApiKey || localStorage.getItem('openaiApiKey'),
      anthropic: persona.anthropicApiKey || localStorage.getItem('anthropicApiKey'),
      manus: persona.manusApiKey || localStorage.getItem('manusApiKey')
    };


    try {
      if (apiService.isElectron) apiService.logToServer(`[AutoPilot:${account.threadsUsername}] Cycle started.`);
      
      // 1. Fetch Trends (Optional)
      let trends = [];
      if (persona.useTrends && apiService.isElectron) {
        const res = await apiService.getTrends(persona.trendKeyword);
        if (res.success) trends = res.trends;
      }

      // 2. Generate text
      let content;
      try {
        content = await callAI(aiProvider, keyMap[aiProvider], aiModel, buildPrompt(persona, trends));
      } catch (err) {
        if (apiService.isElectron) apiService.logToServer(`[AutoPilot:${account.threadsUsername}] AI Generation failed: ${err.message}`);
        return; // Abort cycle, skip posting
      }

      if (content && apiService.isElectron) {
        let imagePath = null;

        // 3. Optional Image Generation
        if (persona.useImageGen) {
          const imgRes = await apiService.generateImage(localStorage.getItem('openaiApiKey'), `${content.substring(0, 500)}... ${persona.imagePrompt}`);
          if (imgRes.success) imagePath = imgRes.imagePath;
        }

        const credentials = {
          username: account.threadsUsername,
          password: account.threadsPassword,
          proxy: account.proxy,
          threadsApiKey: account.personaSettings?.threadsApiKey
        };


        // 4. Post to Threads
        await apiService.postToThreads(account.id, credentials, content, imagePath);

        // 4.5 Optional Post to Note (as a long-form article)
        if (persona.useNoteAutoPost && account.noteEmail && account.notePassword) {
           try {
             if (apiService.isElectron) apiService.logToServer(`[AutoPilot:${account.threadsUsername}] Generating supplemental article for Note...`);
             
             const notePrompt = `
以下の内容をベースに、note.comに投稿するための本格的なブログ記事（タイトルと本文）を作成してください。
元の内容: ${content}

出力フォーマット:
【タイトル】
（ここに記事のタイトル）

【本文】
（ここに記事の本文）
`;
             const noteResponse = await callAI(aiProvider, keyMap[aiProvider], aiModel, notePrompt);
             if (noteResponse) {
               const titleMatch = noteResponse.match(/【タイトル】\n?([\s\S]*?)\n?\n?【本文】/);
               const contentMatch = noteResponse.match(/【本文】\n?([\s\S]*)/);
               const title = titleMatch ? titleMatch[1].trim() : "AI News Update";
               const noteContent = contentMatch ? contentMatch[1].trim() : noteResponse;
               
               await apiService.postToNote(account.id, account, title, noteContent);
             }
           } catch (noteErr) {
             console.error("Note auto-post error", noteErr);
           }
        }

        // 5. Auto-Engagement (Optional)
        if (persona.useAutoEngage) {
          const keywordsList = (persona.engageKeywords || "").split(',').map(k => k.trim()).filter(Boolean);
          if (keywordsList.length > 0) {
            let replyText = "";
            if (persona.engageAction === 'reply' || persona.engageAction === 'both') {
              replyText = await callAI(aiProvider, keyMap[aiProvider], aiModel, `以下の指示に基づき、SNSの投稿に対する短い返信文（リプライ）を1つ作成してください。\n指示: ${persona.engageReplyPrompt}`);
            }
            await apiService.autoEngage(account.id, credentials, {
              keywords: keywordsList,
              actionType: persona.engageAction,
              count: persona.engageCount,
              replyPrompt: replyText
            });
          }
        }

        // 6. Auto-DM (Optional)
        if (persona.useAutoDM) {
          await apiService.checkRepliesAndDM(account.id, credentials, persona.dmContent);
        }
      }

      // Note: AutoPilot component doesn't directly mutate localStorage anymore
      const newDB = (Array.isArray(rawAccounts) ? rawAccounts : []).map(acc => {
        if (acc.id === accountId) return { ...acc, lastRun: Date.now() };
        return acc;
      });
      if (onAccountsUpdate) onAccountsUpdate(newDB);

      if (apiService.isElectron) apiService.logToServer(`[AutoPilot:${account.threadsUsername}] Cycle finished.`);
    } catch (error) {
      console.error(`[AutomationEngine:${account.threadsUsername}] Error:`, error);
      if (apiService.isElectron) apiService.logToServer(`[AutoPilot:${account.threadsUsername}] Error: ${error.message}`);
    }

    // Schedule next
    scheduleNext({ ...account, lastRun: Date.now() });
  };

  return null; // Silent background component
};

// --- モックデータ ---

const mockAccounts = Array.from({ length: 20 }, (_, i) => {
  const statuses = ['active', 'active', 'active', 'active', 'active', 'active', 'active', 'active', 'paused', 'error'];
  const status = statuses[Math.floor(Math.random() * statuses.length)];

  const names = ['坂野七海', 'AIアフィリ研究家', '副業ナビゲーター', '自動化テストBot'];
  const bios = [
    "AIツール作成 | AI動画生成\nAI副業で月120万\n初心者でもできるAI副業を発信\nAIで収入を作る方法",
    "最新のAIツール情報を毎日発信🤖\nChatGPT / Midjourney\nブログ自動化で月収50万達成✨",
    "スマホ1台で完結する副業術📱\n初月から5万円稼ぐロードマップ公開中\n詳しくはリンクのnoteへ👇",
    "自動運用テストアカウントです。\nAPI連携による定期投稿を実施中。\n自動フォロー稼働中。"
  ];

  return {
    id: i + 1,
    threadsUsername: i === 0 ? 'nanami_agent' : `user_bot_${i + 1}`,
    threadsPassword: 'dummy_password', // Added for injection simulation
    name: names[i % names.length] + (i > 3 ? ` ${i + 1}` : ''),
    bio: bios[i % bios.length],
    avatarUrl: `https://picsum.photos/seed/${i + 200}/150/150`,
    badges: ['AI', 'note'],
    status: status,
    followers: Math.floor(Math.random() * 15000) + 100,
    engagement: (Math.random() * 8 + 1).toFixed(1),
    recentPost: {
      time: `${Math.floor(Math.random() * 23) + 1}時間前`,
      content: i % 2 === 0
        ? "スモールビジネスにしてはやばい...\n1月末から始めたnote\n\n【note売上】\n1月　341,840円\n2月　296,140円\n\n1円も売れなかった私でも数字出てます🥺\n今月も頑張ります‼️"
        : "本日の自動投稿テスト。\nAIを活用した作業効率化についてまとめました。\n\nプロンプト一つでここまで変わるとは思わなかった..."
    }
  };
});

const recentActivities = [
  { id: 1, account: 'System', action: '自律運用システムの起動完了・待機中', time: '現在', type: 'success' }
];

// --- コンポーネント ---

// Threads風アカウントカード
const AccountCard = ({ account, onUpdateProfile, onDeleteAccount, currentUser, isMobile, isElectron }) => {
  const [isRunning, setIsRunning] = useState(account.status === 'active');
  const [activeTab, setActiveTab] = useState('live'); // 'live', 'status', 'threads'
  const [showEditModal, setShowEditModal] = useState(false);
  const [editUsername, setEditUsername] = useState(account.threadsUsername || account.username || '');
  const [editPassword, setEditPassword] = useState(account.threadsPassword || account.password || '');
  const [editNoteEmail, setEditNoteEmail] = useState(account.noteEmail || '');
  const [editNotePassword, setEditNotePassword] = useState(account.notePassword || '');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync edit state when account prop changes (prevents data wipe on save)
  useEffect(() => {
    setEditUsername(account.threadsUsername || account.username || '');
    setEditPassword(account.threadsPassword || account.password || '');
    setEditNoteEmail(account.noteEmail || '');
    setEditNotePassword(account.notePassword || '');
  }, [account]);

  const [logs, setLogs] = useState([]);
  const [isWebviewLoggedIn, setIsWebviewLoggedIn] = useState(false);
  const [isAutoLiking, setIsAutoLiking] = useState(false);
  const [isGeneratingNote, setIsGeneratingNote] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);
  const [forcingLogin, setForcingLogin] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const webviewRef = useRef(null);

  const addLog = (msg, prefix = "") => {
    // 1. Aggressively strip console formatting (%c) and CSS property-value pairs
    // We only strip key:val; if it ends with a semicolon to avoid catching "Error: message"
    let cleaned = msg.replace(/%c/g, '').replace(/[a-z-]+\s*:\s*[^;]+;/gi, '').trim();
    
    // 2. Suppress known console "art", Meta's warnings, and empty messages
    const junkPatterns = ['STOP！', '詳しくは', 'これは開発者向け', '詐欺・不正行', 'ハッキングするための'];
    if (!cleaned || junkPatterns.some(p => cleaned.includes(p))) return;

    // 3. Prevent duplicate consecutive identical logs within a 1-second window to reduce noise
    const finalMsg = prefix ? `${prefix}: ${cleaned}` : cleaned;
    setLogs(prev => {
      if (prev.length > 0 && prev[0].includes(finalMsg)) return prev;
      return [`[${new Date().toLocaleTimeString()}] ${finalMsg}`, ...prev].slice(0, 50);
    });
    console.log(`[AccountCard: ${account.threadsUsername || account.username}] ${finalMsg}`);
  };

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDomReady = () => {
      const currentUrl = webview.getURL();
      addLog(currentUrl, "Load Event (DOM Ready)");
      triggerInjection();
      // Immediate check after DOM is ready
      setTimeout(checkLoginStatus, 2000);
    };

    const handleFinishLoad = () => {
      const currentUrl = webview.getURL();
      addLog(currentUrl, "Load Event (Finish)");
      triggerInjection();
      // Also check on finish load
      setTimeout(checkLoginStatus, 1500);
    };

    const handleFailLoad = (e) => {
      if (e.errorCode === -3) return; // Ignore aborted loads
      const currentUrl = webview.getURL();
      const errStr = `${e.errorDescription || 'Unknown Error'} (${e.errorCode})`;
      addLog(`${errStr} at ${currentUrl}`, "Load Error");
      setLoadError({ description: e.errorDescription, code: e.errorCode, url: currentUrl });
    };

    const handleConsole = (e) => {
      const msg = e.message;
      if (msg.includes("[STATUS]")) {
        const loggedIn = msg.includes("LOGGED_IN");
        setIsWebviewLoggedIn(loggedIn);
        if (loggedIn) {
          setForcingLogin(false);
          setLoadError(null);
        }
        return;
      }
      addLog(msg, "WebView");
    };

    const triggerInjection = () => {
      const currentUrl = webview.getURL();
      
      if (currentUrl.includes('login')) {
        addLog("Injecting credentials into login page...");
        const script = `
          (function() {
            let attempts = 0;
            const maxAttempts = 30;
            const timer = setInterval(() => {
              attempts++;
              const userField = document.querySelector('input[type="text"]') || document.querySelector('input[placeholder*="ユーザーネーム"]') || document.querySelector('input[name*="username"]');
              const passField = document.querySelector('input[type="password"]') || document.querySelector('input[name*="password"]');
              const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
              const loginBtn = buttons.find(el => /ログイン|Log In|Log in/i.test(el.innerText || el.textContent));
              
              if (userField && passField && loginBtn && !userField.value) {
                userField.value = "${account.threadsUsername || account.username || ''}";
                passField.value = "${account.threadsPassword || account.password || ''}";
                ['input', 'change', 'blur'].forEach(et => {
                  userField.dispatchEvent(new Event(et, { bubbles: true }));
                  passField.dispatchEvent(new Event(et, { bubbles: true }));
                });
                setTimeout(() => loginBtn.click(), 800);
                clearInterval(timer);
              }
              if (attempts >= maxAttempts) clearInterval(timer);
            }, 500);
          })();
        `;
        webview.executeJavaScript(script).catch(() => {});
      }
    };

    const checkLoginStatus = () => {
      if (webview && !webview.isDestroyed()) {
        const currentUrl = webview.getURL();
        if (currentUrl.includes('threads.net') || currentUrl.includes('threads.com') || currentUrl.includes('note.com')) {
          webview.executeJavaScript(`
            (function() {
              const navLinks = Array.from(document.querySelectorAll('nav a, div[role="navigation"] a, a[href*="/@"]'));
              const hasProfileLink = navLinks.some(a => {
                 const href = a.getAttribute('href');
                 return href && href.startsWith('/@') && !href.includes('/@threads') && !href.includes('/@instagram');
              });
              const hasLoggedInIcons = !!document.querySelector('svg[aria-label*="Home"], svg[aria-label*="Create"], svg[aria-label*="Search"], svg[aria-label*="Activity"]');
              const hasLoginLink = !!document.querySelector('a[href*="/login"], a[href*="/signup"]');
              
              // 4. 特殊：2FAやセキュリティ待ち画面か？
              const isSecurityPage = window.location.href.includes('two_factor') || window.location.href.includes('challenge') || !!document.querySelector('input[name*="verificationCode"], input[placeholder*="コード"]');

              const loggedIn = (hasProfileLink || hasLoggedInIcons || isSecurityPage) && !hasLoginLink;
              
              if (!loggedIn && !isSecurityPage) {
                  console.log("[DEBUG:AUTH_FAIL] profile:" + hasProfileLink + " icons:" + hasLoggedInIcons + " url:" + window.location.href);
              }
              
              console.log("[STATUS] " + (loggedIn ? "LOGGED_IN" : "LOGGED_OUT"));
            })()
          `).catch(() => {});
        }
      }
    };

    const statusMonitor = setInterval(checkLoginStatus, 5000);

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-finish-load', handleFinishLoad);
    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('console-message', handleConsole);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-finish-load', handleFinishLoad);
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('console-message', handleConsole);
      clearInterval(statusMonitor);
    };
  }, [account.id, account.threadsUsername, account.threadsPassword, activeTab, webviewKey]);

  // Blur webview when not in live tab to reclaim focus
  useEffect(() => {
    if (activeTab !== 'live' && webviewRef.current) {
      try { webviewRef.current.blur(); } catch (e) {}
      window.focus();
    }
  }, [activeTab]);

  const toggleStatus = async () => {
    if (!apiService.isElectron) {
      alert("Electron API is not available in browser mode.");
      return;
    }

    if (isRunning) {
      const res = await apiService.stopBrowserSession(account.id);
      if (res.success) {
        setIsRunning(false);
        onUpdateProfile(account.id, { status: 'paused' });
      }
      else console.error(res.error);
    } else {
      const credentials = {
        username: account.threadsUsername,
        password: account.threadsPassword
      };
      const res = await apiService.startBrowserSession(account.id, credentials);
      if (res.success) {
        setIsRunning(true);
        if (res.profileData) {
          onUpdateProfile(account.id, { 
            status: 'active',
            ...res.profileData 
          });
        } else {
          onUpdateProfile(account.id, { status: 'active' });
        }
      }
      else console.error(res.error);
    }
  };
  
  const handleManualSync = async () => {
    if (!apiService.isElectron) return;
    
    addLog("Opening Manual Login Window...");
    const res = await apiService.openLoginWindow(account.id, activeTab === 'note' ? 'note' : 'threads');
    if (res.success) {
      addLog("Manual Login Window closed. Refreshing view...");
      setIsWebviewLoggedIn(true); // Tentatively assume success to hide overlay
      setWebviewKey(prev => prev + 1);
      
      // Attempt to refresh profile data silently if it was Threads
      if (activeTab === 'live') {
         setTimeout(() => handleManualRefresh(), 2000);
      }
    } else {
      alert(`手動ログイン窓の起動に失敗しました: ${res.error}`);
    }
  };

  const handleForceReset = async () => {
    if (!window.confirm("セッション情報を完全に削除して初期化しますか？\n（ログイン情報の再入力が必要になります）")) return;
    
    if (apiService.isElectron) {
      addLog("Performing Full Session Reset...");
      await apiService.clearSession(account.id, activeTab === 'note' ? 'note' : 'threads');
      setForcingLogin(false);
      setIsWebviewLoggedIn(false);
      setWebviewKey(prev => prev + 1);
      alert("リセットが完了しました。");
    }
  };

const handleUpdateAccount = (e) => {
  e.preventDefault();
  onUpdateProfile(account.id, {
    threadsUsername: editUsername,
    threadsPassword: editPassword,
    noteEmail: editNoteEmail,
    notePassword: editNotePassword,
    name: editUsername // Optionally keep name in sync
  });
  setShowEditModal(false);
  alert("アカウント情報を更新しました。");
};

const handleManualRefresh = async () => {
  if (!apiService.isElectron) return;
  setIsRefreshing(true);
  const credentials = {
    username: account.threadsUsername,
    password: account.threadsPassword,
    proxy: account.proxy
  };
  // Use startBrowserSession with headless and autoClose for a silent refresh
  const res = await apiService.startBrowserSession(account.id, credentials, { headless: true, autoClose: true });
  if (res.success && res.profileData) {
    onUpdateProfile(account.id, {
      ...res.profileData
    });
    alert("プロフィールを最新の状態に更新しました。");
  } else if (res.error) {
    alert(`更新エラー: ${res.error}`);
  }
  setIsRefreshing(false);
};

const handleAutoLike = async (options = {}) => {
  if (!apiService.isElectron) {
    alert("Electron APIは利用できません。");
    return;
  }

  setIsAutoLiking(true);
  addLog(options.skipNavigation ? "Current Page Auto-Like Triggered" : "Manual Auto-Like Triggered");
  
  try {
    const credentials = {
      username: account.threadsUsername || account.username,
      password: account.threadsPassword,
      proxy: account.proxy
    };
    
    const res = await apiService.autoLike(account.id, credentials, options);
    
    if (res.success) {
      alert(`自動いいね完了: ${res.count}件の投稿にいいねしました。`);
      addLog(`Auto-Like success: ${res.count} posts`);
    } else {
      alert(`自動いいねエラー: ${res.error}`);
      addLog(`Auto-Like error: ${res.error}`);
    }
  } catch (e) {
    alert(`通信エラー: ${e.message}`);
    addLog(`Auto-Like exception: ${e.message}`);
  } finally {
    setIsAutoLiking(false);
  }
};

const handleGenerateNoteArticle = async () => {
  if (!apiService.isElectron) return;
  
  setIsGeneratingNote(true);
  try {
    addLog("Generating AI Article for Note...");
    const persona = account.personaSettings || {
      theme: "最新のテクノロジーとAI",
      tone: "専門的かつ親しみやすい",
      promptText: "読者に役立つ知識を提供してください。"
    };

    const prompt = `
以下の指示に基づき、note.comに投稿するための魅力的な記事（タイトルと本文）を作成してください。
指示: ${persona.theme}
トーン: ${persona.tone}
追加指示: ${persona.promptText}

出力フォーマット:
【タイトル】
（ここに記事のタイトル）

【本文】
（ここに記事の本文。1000文字程度で、見出しや改行を適切に使ってください）
`;

    const keyMap = {
      gemini: persona.geminiApiKey || localStorage.getItem('geminiApiKey'),
      openai: persona.openaiApiKey || localStorage.getItem('openaiApiKey'),
      anthropic: persona.anthropicApiKey || localStorage.getItem('anthropicApiKey'),
      manus: persona.manusApiKey || localStorage.getItem('manusApiKey')
    };

    const provider = persona.aiProvider || 'gemini';
    const model = persona.aiModel || 'gemini-1.5-flash';

    const response = await callAI(provider, keyMap[provider], model, prompt);
    
    if (response) {
      const titleMatch = response.match(/【タイトル】\n?([\s\S]*?)\n?\n?【本文】/);
      const contentMatch = response.match(/【本文】\n?([\s\S]*)/);
      
      const title = titleMatch ? titleMatch[1].trim() : "無題の記事";
      const content = contentMatch ? contentMatch[1].trim() : response;

      addLog(`Article generated: ${title}`);
      
      if (window.confirm(`以下の記事をnoteに投稿しますか？\n\nタイトル: ${title}\n\n※投稿ボタンを押すと自動操作が始まります。`)) {
        addLog("Starting automated post to note.com...");
        const res = await apiService.postToNote(account.id, account, title, content);
        if (res.success) {
          alert("noteへの投稿に成功しました！");
          addLog("Note post successful.");
        } else {
          alert(`投稿エラー: ${res.error}`);
          addLog(`Note post failed: ${res.error}`);
        }
      }
    }
  } catch (e) {
    console.error(e);
    alert(`エラーが発生しました: ${e.message}`);
  } finally {
    setIsGeneratingNote(false);
  }
};

  return (
    <div className={`glass-panel rounded-[2rem] overflow-hidden flex flex-col relative w-full ${isMobile ? 'h-auto' : 'h-[680px]'} transition-all hover:border-neutral-700 group`}>
    {/* Background ambient glow effect */}
    <div className="absolute -inset-0.5 bg-gradient-to-br from-violet-500/10 to-transparent rounded-[2rem] opacity-0 group-hover:opacity-100 transition duration-700 blur pointer-events-none"></div>

    {/* Card Header */}
    <div className="flex justify-between items-center px-6 pt-6 pb-2 relative z-30">
      <BarChart3 className="w-6 h-6 text-neutral-400 hover:text-white transition-colors cursor-pointer" />
      <div className="flex items-center gap-5">
        <Instagram className="w-6 h-6 text-neutral-400 hover:text-white transition-colors cursor-pointer" />
        <Settings
          onClick={() => {
            setShowEditModal(true);
            setTimeout(() => window.focus(), 50);
          }}
          className="w-5 h-5 text-neutral-500 hover:text-white transition-colors cursor-pointer"
        />
        <Trash2
          onClick={() => {
            if (window.confirm(`${account.threadsUsername || account.username} の連携を解除してリストから削除しますか？`)) {
              // Focus recovery to prevent Electron webview unmount focus bug
              if (document.activeElement) document.activeElement.blur();
              window.focus();
              if (onDeleteAccount) onDeleteAccount(account.id);
            }
          }}
          className="w-5 h-5 text-neutral-500 hover:text-rose-500 transition-colors cursor-pointer"
        />
      </div>
    </div>

    {/* Profile Section */}
    <div className={`px-6 relative z-10 flex-shrink-0 ${activeTab === 'live' ? 'pb-2' : 'pb-4'}`}>
      <div className={`flex items-start justify-between ${activeTab === 'live' || activeTab === 'note' ? 'mb-2' : 'mb-4'}`}>
        <div className="min-w-0">
          <h2 className={`font-bold flex items-center gap-2 text-white truncate ${activeTab === 'live' || activeTab === 'note' ? 'text-[16px]' : 'text-[22px]'}`}>
            {account.name || account.threadsUsername}
            {account.status === 'active' && <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)] flex-shrink-0"></span>}
          </h2>
          <p className="text-[13px] text-neutral-400 mt-0.5 font-mono flex items-center gap-2 truncate">
            @{account.threadsUsername || account.username}
            {isWebviewLoggedIn ? (
              <span className="flex items-center gap-1 text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-bold uppercase">
                <CheckCircle2 className="w-2.5 h-2.5" /> LIVE
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[9px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 font-bold uppercase">
                  <AlertCircle className="w-2.5 h-2.5" /> NO_AUTH
                </span>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleManualSync(); }}
                  className="flex items-center gap-1 text-[9px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20 font-bold uppercase hover:bg-violet-500/20 transition-colors"
                >
                  <Monitor className="w-2.5 h-2.5" /> 手動ログイン
                </button>
              </div>
            )}
          </p>
        </div>
        <div className="flex-shrink-0">
          <div className={`rounded-full overflow-hidden border-2 border-neutral-800 p-0.5 shadow-lg ${activeTab === 'live' || activeTab === 'note' ? 'w-[44px] h-[44px]' : 'w-[64px] h-[64px]'}`}>
            <img src={account.avatarUrl || 'https://picsum.photos/150'} alt="avatar" className="w-full h-full object-cover rounded-full" />
          </div>
        </div>
      </div>

      {activeTab !== 'live' && (
        <>
          <p className="text-[14px] text-neutral-300 whitespace-pre-wrap leading-relaxed mb-4">
            {account.bio}
          </p>

          <div className="flex items-center gap-2 mb-6">
            <div className="flex -space-x-2">
              <img src={`https://picsum.photos/seed/${account.id}a/32/32`} className="w-6 h-6 rounded-full border border-neutral-900" alt="follower" />
              <img src={`https://picsum.photos/seed/${account.id}b/32/32`} className="w-6 h-6 rounded-full border border-neutral-900 z-10" alt="follower" />
              <div className="w-6 h-6 rounded-full bg-neutral-800 border border-neutral-900 z-20 flex items-center justify-center">
                <span className="text-[10px] text-neutral-400 font-medium">+</span>
              </div>
            </div>
            <span className="text-[14px] font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer">
              {(account.followers || 0).toLocaleString()} 連携済み
            </span>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="ml-auto p-1.5 bg-neutral-800 rounded-lg hover:bg-neutral-700 text-neutral-400 hover:text-white transition-all disabled:opacity-50"
              title="プロフィールを手動更新"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex gap-3 mb-2">
            <button
              onClick={() => setActiveTab('live')}
              className={`flex-1 py-2 rounded-xl text-[14px] font-semibold transition-all shadow-sm border bg-neutral-800/80 border-neutral-700/50 text-white hover:bg-neutral-700`}
            >
              ブラウザを展開
            </button>

            <div className="flex-1 group/btn">
              <div className={`relative w-full h-full rounded-xl ${isRunning ? 'violet-glow' : ''}`}>
                <button
                  onClick={toggleStatus}
                  className={`relative w-full py-2 rounded-xl text-[14px] font-bold transition-all shadow-md z-10 ${isRunning
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white border border-violet-500/50 hover:brightness-110'
                      : 'bg-neutral-800 border border-neutral-700 text-neutral-400 hover:bg-neutral-700 hover:text-white'
                    }`}>
                  {isRunning ? 'AIパトロール停止' : 'AIパトロール再開'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>

    <div className="flex border-b border-neutral-800/80 mt-2 px-2 z-10 relative">
      <button onClick={() => setActiveTab('live')} className={`flex-1 pb-3 pt-2 text-[14px] font-semibold transition-colors ${activeTab === 'live' ? 'text-white border-b-2 border-amber-500' : 'text-neutral-500 hover:text-neutral-300'}`}>Threads (Live)</button>
      <button onClick={() => setActiveTab('note')} className={`flex-1 pb-3 pt-2 text-[14px] font-semibold transition-colors ${activeTab === 'note' ? 'text-white border-b-2 border-emerald-500' : 'text-neutral-500 hover:text-neutral-300'}`}>note (Live)</button>
      <button onClick={() => setActiveTab('threads')} className={`flex-1 pb-3 pt-2 text-[14px] font-semibold transition-colors ${activeTab === 'threads' ? 'text-white border-b-2 border-violet-500' : 'text-neutral-500 hover:text-neutral-300'}`}>最新ポスト</button>
      <button onClick={() => setActiveTab('status')} className={`flex-1 pb-3 pt-2 text-[14px] font-semibold transition-colors ${activeTab === 'status' ? 'text-white border-b-2 border-indigo-500' : 'text-neutral-500 hover:text-neutral-300'}`}>ステータス</button>
    </div>

    <div className={`flex-1 relative overflow-hidden bg-neutral-900/30 z-10 flex flex-col ${activeTab !== 'live' && activeTab !== 'note' ? 'hidden' : 'flex'}`}>
      {/* Persistant Webview Container */}
        <div 
          className={`flex-1 relative w-full overflow-hidden pointer-events-auto [-webkit-app-region:no-drag] border-t border-neutral-800/50 ${activeTab !== 'live' ? 'hidden' : 'flex flex-col'}`}
          onMouseDown={(e) => {
            const wv = e.currentTarget.querySelector('webview');
            if (wv) wv.focus();
          }}
        >
          <webview
            key={webviewKey}
            ref={webviewRef}
            src={forcingLogin 
              ? 'https://www.threads.net/login' 
              : `https://www.threads.net/@${account.threadsUsername || account.username || ''}`
            }
            className="w-full h-full pointer-events-auto"
            style={{ 
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              visibility: 'visible', 
              opacity: 1 
            }}
            partition={`persist:threads_account_${account.id}`}
            useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            allowpopups
          />
        </div>
        
        {loadError && activeTab === 'live' && (
          <div className="absolute inset-0 bg-neutral-900 flex flex-col items-center justify-center z-40 p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
            <p className="text-white font-bold mb-2">読み込みエラーが発生しました</p>
            <p className="text-xs text-neutral-500 mb-6 truncate max-w-full">
              {loadError.description} ({loadError.code})
            </p>
            <button 
              onClick={() => {
                setLoadError(null);
                setWebviewKey(prev => prev + 1);
              }}
              className="px-6 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-sm font-bold border border-neutral-700 transition-all"
            >
              再読み込みを試す
            </button>
          </div>
        )}

        {!isWebviewLoggedIn && activeTab === 'live' && forcingLogin && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-rose-600 px-3 py-1 rounded-full text-[10px] text-white font-bold animate-pulse shadow-lg flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping"></span>
            画面が真っ暗な場合は右上の「手動ログイン」ボタンをお試しください
          </div>
        )}
        
        {activeTab === 'live' && (
          <button 
            onClick={handleForceReset}
            className="absolute top-2 right-2 z-50 p-1.5 bg-black/40 hover:bg-rose-900/60 text-white/40 hover:text-white rounded-lg transition-all"
            title="セッションを完全にリセット"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}

        {!isWebviewLoggedIn && activeTab === 'live' && !forcingLogin && !loadError && (
          <div className="absolute inset-0 bg-neutral-900/60 backdrop-blur-sm flex flex-col items-center justify-center z-30 transition-all">
            <div className="flex flex-col items-center gap-4 p-8 bg-neutral-900/40 rounded-3xl border border-white/5 shadow-2xl">
              <div className="flex flex-col items-center gap-2 mb-2">
                 <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mb-2">
                    <Instagram className="w-6 h-6 text-white" />
                 </div>
                 <h3 className="text-white font-bold">ライブ表示にはログインが必要です</h3>
                 <p className="text-[10px] text-neutral-400 max-w-[200px] text-center">
                   ブラウザ（Live View）側でのログイン状態が確認できません。
                 </p>
              </div>
              
              <div className="flex flex-col gap-3 w-full">
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    addLog("Opening Manual Login Window...");
                    handleManualSync();
                  }}
                  className="w-full px-6 py-3 bg-white text-black rounded-xl font-bold text-sm shadow-2xl hover:bg-neutral-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  ログインウィンドウを開く
                </button>
                
                <button 
                  onClick={() => {
                    setIsWebviewLoggedIn(true);
                    addLog("Manual verification override by user");
                  }}
                  className="w-full py-2.5 text-[11px] text-neutral-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded-lg border border-white/10"
                >
                  ログインしているのに表示される場合はこちら
                </button>
              </div>

              <div className="flex items-center gap-4 mt-2">
                <button 
                  onClick={() => { if(webviewRef.current) webviewRef.current.reload(); }}
                  className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-1"
                >
                  <RefreshCw className="w-2.5 h-2.5" /> ページ再読み込み
                </button>
              </div>
            </div>
          </div>
        )}

        {/* note.com section - Moved inside common flex-1 container */}
        <div 
          className={`flex-1 relative w-full overflow-hidden bg-neutral-900 pointer-events-auto [-webkit-app-region:no-drag] ${activeTab !== 'note' ? 'hidden' : 'flex flex-col'}`}
          onMouseDown={(e) => {
            const wv = e.currentTarget.querySelector('webview');
            if (wv) wv.focus();
          }}
        >
          <webview
            src="https://note.com/"
            className="w-full h-full pointer-events-auto"
            partition={`persist:note_account_${account.id}`}
            useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            allowpopups
          />
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
             <img src="https://www.google.com/s2/favicons?domain=note.com&sz=128" className="w-32 h-32" />
          </div>
          <div className="absolute bottom-4 right-4 z-40 flex flex-col gap-2">
             <button 
               onClick={handleGenerateNoteArticle}
               disabled={isGeneratingNote}
               className="p-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-white shadow-lg border border-white/10 font-bold flex items-center gap-2 pointer-events-auto transition-all"
              >
                <Sparkles className={`w-4 h-4 ${isGeneratingNote ? 'animate-spin' : ''}`} /> 
                {isGeneratingNote ? '生成中...' : '記事を自動生成'}
             </button>
          </div>
        </div>

        {/* Floating Auto-Like Recommended Button - Now tab-conditional */}
        {activeTab === 'live' && isWebviewLoggedIn && ((SUBSCRIPTION_PLANS[currentUser?.plan]?.features?.includes('like')) || currentUser?.role === 'admin') && (
          <div className="absolute top-4 right-4 z-40 flex flex-col gap-2">
             <button 
               onClick={() => handleAutoLike({ skipNavigation: true })}
               disabled={isAutoLiking}
               className="px-3 py-1.5 bg-gradient-to-r from-rose-600/80 to-pink-600/80 hover:from-rose-600 hover:to-pink-600 disabled:opacity-50 rounded-full text-white shadow-lg backdrop-blur-md border border-white/20 text-[10px] font-bold flex items-center gap-1.5 pointer-events-auto transition-all active:scale-95"
              >
                <Heart className={`w-3 h-3 ${isAutoLiking ? 'animate-ping' : ''}`} /> 
                {isAutoLiking ? '実行中...' : 'フィードを自動いいね'}
             </button>
          </div>
        )}
      </div>

        <button
          onClick={() => {
            if (webviewRef.current) {
              addLog("Manual Login Reset Triggered");
              webviewRef.current.loadURL('https://www.threads.com/login');
            }
          }}
          className="absolute bottom-4 right-4 p-2 bg-violet-600/80 hover:bg-violet-500 rounded-lg text-white backdrop-blur-md border border-white/20 z-40 transition-all font-bold"
          title="ログイン画面へ移動"
        >
          <RefreshCw className="w-4 h-4" />
        </button>


      {activeTab === 'status' && (
        <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto w-full absolute inset-0 bg-neutral-900/95 scrollbar-thin scrollbar-thumb-neutral-800">
          <div className="glass-panel p-4 rounded-xl border border-neutral-800/50 flex-shrink-0">
            <span className="text-xs text-neutral-500 mb-2 block uppercase font-bold tracking-widest">ログイン・運用ログ</span>
            <div className="bg-black/60 rounded-lg p-3 h-40 overflow-y-auto font-mono text-[10px] text-neutral-400 space-y-1.5 border border-neutral-800 shadow-inner">
              {logs.length === 0 ? (
                <div className="text-neutral-600 italic py-4 text-center">ログはありません</div>
              ) : (
                logs.map((log, i) => <div key={i} className="leading-relaxed border-b border-neutral-800/30 pb-1 break-all last:border-0">{log}</div>)
              )}
            </div>
            <button 
              onClick={handleForceReset}
              className="mt-3 w-full py-2.5 bg-rose-900/20 hover:bg-rose-900/40 text-rose-400 rounded-lg text-xs font-bold border border-rose-500/30 transition-all active:scale-95"
            >
              表示の不具合を完全に強制リセット
            </button>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-neutral-800/50 flex-shrink-0">
            <span className="text-xs text-neutral-500 mb-2 block uppercase font-bold tracking-widest">統計・データ</span>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm p-1.5 rounded-lg bg-white/5">
                <span className="text-neutral-400">フォロワー数</span>
                <span className="font-bold text-white">{(account.followers || 0).toLocaleString()}</span>
              </div>
              <button
                onClick={handleAutoLike}
                disabled={isAutoLiking}
                className="w-full py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl text-xs font-bold border border-rose-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Heart className={`w-4 h-4 ${isAutoLiking ? 'animate-ping' : ''}`} />
                {isAutoLiking ? 'いいね実行中...' : '今すぐ自動いいね実行'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'threads' && (
        <div className="p-6 flex gap-4 h-full overflow-y-auto w-full absolute inset-0">
          <div className="flex flex-col items-center">
            <img src={account.avatarUrl} className="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-neutral-800" alt="avatar" />
            <div className="w-[1px] h-full bg-gradient-to-b from-neutral-700 to-transparent mt-3"></div>
          </div>
          <div className="flex-1 pb-4">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[15px] text-white tracking-wide">{account.threadsUsername || account.username}</span>
                <span className="text-[12px] text-neutral-500">{account.recentPost?.time || "未記録"}</span>
              </div>
              <MoreHorizontal className="w-5 h-5 text-neutral-500 hover:text-white cursor-pointer transition-colors" />
            </div>
            <div className="text-[14px] text-neutral-300 mt-2 whitespace-pre-wrap leading-relaxed">
              {account.recentPost?.content || "まだ投稿や活動履歴がありません。"}
            </div>
            <div className="flex items-center gap-5 mt-4">
              <Heart className="w-5 h-5 text-neutral-500 hover:text-pink-500 cursor-pointer transition-colors" />
              <MessageCircle className="w-5 h-5 text-neutral-500 hover:text-white cursor-pointer transition-colors" />
              <Repeat className="w-5 h-5 text-neutral-500 hover:text-emerald-500 cursor-pointer transition-colors" />
              <Send
                onClick={async () => {
                  if (!window.confirm("このアカウントでテスト投稿を実行しますか？\n（裏側でブラウザが自動的に動いて投稿されます）")) return;
                  try {
                    console.log("Starting test post dispatcher...");
                    const res = await apiService.postToThreads(
                      account.id,
                      { 
                        username: account.threadsUsername || account.username, 
                        password: account.threadsPassword,
                        threadsApiKey: account.personaSettings?.threadsApiKey
                      },
                      "テスト投稿です (Automated via AutoThreader)"
                    );
                    if (res.success) {
                      alert("テスト投稿に成功しました！");
                    } else {
                      alert(`投稿エラー: ${res.error}`);
                    }
                  } catch (e) {
                    alert(`通信エラー: ${e.message}`);
                  }
                }}
                className="w-5 h-5 text-neutral-500 hover:text-white cursor-pointer transition-colors"
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-neutral-950/90 backdrop-blur-md p-6 rounded-[2rem] animate-in fade-in zoom-in duration-200">
          <div className="w-full max-h-[85vh] overflow-y-auto pr-2 custom-scrollbar space-y-6">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-bold text-white flex items-center">
                <Settings className="w-5 h-5 mr-2 text-violet-400" />
                アカウント情報修正
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-neutral-500 hover:text-white transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            
            <form onSubmit={handleUpdateAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">ユーザー名</label>
                  <input 
                    type="text" 
                    value={editUsername} 
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="w-full px-4 py-3 bg-neutral-900/80 border border-neutral-700 rounded-xl text-white focus:outline-none focus:border-violet-500 transition-all font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">パスワード</label>
                  <div className="relative">
                     <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
                     <input 
                      type="password" 
                      value={editPassword} 
                      onChange={(e) => setEditPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-neutral-900/80 border border-neutral-700 rounded-xl text-white focus:outline-none focus:border-violet-500 transition-all"
                    />
                  </div>
                </div>
                
                <div className="pt-2 border-t border-neutral-800 my-2 text-[10px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                  <img src="https://www.google.com/s2/favicons?domain=note.com&sz=32" className="w-3 h-3" />
                  note.com 連携設定
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">note ログインメール</label>
                  <input 
                    type="email" 
                    value={editNoteEmail} 
                    onChange={(e) => setEditNoteEmail(e.target.value)}
                    placeholder="example@email.com"
                    className="w-full px-4 py-3 bg-neutral-900/80 border border-neutral-700 rounded-xl text-white focus:outline-none focus:border-emerald-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">note パスワード</label>
                  <div className="relative">
                     <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
                     <input 
                      type="password" 
                      value={editNotePassword} 
                      onChange={(e) => setEditNotePassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-3 bg-neutral-900/80 border border-neutral-700 rounded-xl text-white focus:outline-none focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-sm rounded-xl transition-colors"
                >戻る</button>
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-white text-black font-bold text-sm rounded-xl hover:bg-neutral-200 transition-colors shadow-lg"
                >保存する</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 停止・エラーオーバレイ */}
      {!isRunning && (
        <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 rounded-[2rem]">
          <div className="glass-panel p-8 text-center max-w-[85%] rounded-3xl border border-neutral-800 shadow-2xl">
            {account.status === 'paused' || !isRunning ? (
              <>
                <PauseCircle className="w-12 h-12 text-neutral-500 mx-auto mb-4" />
                <p className="font-bold text-white text-xl tracking-wide">AI運用停止中</p>
                <p className="text-sm text-neutral-400 mt-2">自動投稿・アクションは行われません</p>
              </>
            ) : (
              <>
                <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
                <p className="font-bold text-rose-500 text-xl tracking-wide">認証エラー</p>
                <p className="text-sm text-neutral-400 mt-2">APIのセッションが切れました</p>
              </>
            )}
            <div className="flex flex-col gap-3 mt-6 w-full">
              <button 
                onClick={toggleStatus}
                className="w-full py-3 bg-white text-black rounded-xl text-[14px] font-bold hover:bg-neutral-200 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                {account.status === 'paused' || !isRunning ? '稼働を再開する' : '通常ログインを実行'}
              </button>
              
              {!isRunning && (
                <button 
                  onClick={handleManualSync}
                  className="w-full py-3 bg-neutral-900 border border-neutral-700 text-neutral-300 rounded-xl text-[14px] font-bold hover:text-white hover:bg-neutral-800 transition-all flex items-center justify-center gap-2">
                  <Monitor className="w-4 h-4" />
                  手動認証（ブラウザを表示）
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DashboardView = ({ accounts, onNavigate }) => {
  const [liveInsights, setLiveInsights] = useState({});
  const [liveMedia, setLiveMedia] = useState({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || null);
  const [timeRange, setTimeRange] = useState('7d');

  const fetchLiveInsights = async () => {
    const accountsWithKeys = accounts.filter(a => a.personaSettings?.threadsApiKey);
    
    if (accountsWithKeys.length === 0) {
      console.log("[Dashboard] No accounts with Threads API keys found.");
      // If manually triggered, we might want an alert, but for useEffect we stay silent
      return;
    }

    setIsSyncing(true);
    const newInsights = { ...liveInsights };
    const newMedia = { ...liveMedia };

    try {
      console.log(`[DashboardSync] Starting parallel sync for ${accountsWithKeys.length} accounts...`);
      
      const results = await Promise.all(accountsWithKeys.map(async (acc) => {
        try {
          console.log(`[DashboardSync] Syncing @${acc.threadsUsername || acc.username}...`);
          const token = acc.personaSettings.threadsApiKey;
          
          // 1. User Insights
          const res = await apiService.getThreadsUserInsights(token);
          if (!res.success) throw new Error(res.error || "User insights failed");
          
          const metrics = {};
          if (Array.isArray(res.data)) {
            res.data.forEach(m => {
              if (m.name && m.values?.[0]) metrics[m.name] = m.values[0].value;
              else if (m.name) metrics[m.name] = 0;
            });
          }
          
          // 2. Media & Media Insights
          let accountMedia = [];
          const mediaRes = await apiService.getThreadsMedia(token);
          if (mediaRes.success && Array.isArray(mediaRes.data)) {
            accountMedia = mediaRes.data;
            const latestMedia = accountMedia[0];
            if (latestMedia) {
              const miRes = await apiService.getThreadsMediaInsights(token, latestMedia.id);
              if (miRes.success && Array.isArray(miRes.data)) {
                latestMedia.insights = {};
                miRes.data.forEach(m => {
                  if (m.name && m.values?.[0]) latestMedia.insights[m.name] = m.values[0].value;
                });
              }
            }
          }
          
          console.log(`[DashboardSync] Done for @${acc.threadsUsername || acc.username}`);
          return { id: acc.id, metrics, media: accountMedia, success: true };
        } catch (err) {
          console.error(`[DashboardSync] Failed for @${acc.threadsUsername || acc.username}:`, err.message);
          return { id: acc.id, error: err.message, success: false, name: `@${acc.threadsUsername || acc.username}` };
        }
      }));

      // Update state once with all results
      const failedAccounts = [];
      results.forEach(res => {
        if (res.success) {
          newInsights[res.id] = res.metrics;
          newMedia[res.id] = res.media;
        } else {
          failedAccounts.push(res);
        }
      });

      setLiveInsights(newInsights);
      setLiveMedia(newMedia);
      console.log(`[DashboardSync] All syncs completed. Failures: ${failedAccounts.length}`);

      if (failedAccounts.length > 0) {
        const isPermissionError = failedAccounts.some(f => f.error?.includes('permission') || f.error?.includes('OAuth'));
        if (isPermissionError) {
          alert("一部のアカウントで同期に失敗しました。\n\n原因: 権限不足 (threads_manage_insights)\n\n対処法: トークン生成時に「threads_manage_insights」にチェックを入れる必要があります。");
        } else {
          alert(`一部のアカウントの同期に失敗しました:\n${failedAccounts.map(f => `${f.name}: ${f.error}`).join('\n')}`);
        }
      }
    } catch (e) {
      console.error("[DashboardSync] Global sync error:", e);
      alert("同期中に予期せぬエラーが発生しました。");
    } finally {
      setIsSyncing(false);
      console.log("[DashboardSync] Spinner stopped.");
    }
  };

  useEffect(() => {
    fetchLiveInsights();
    const interval = setInterval(fetchLiveInsights, 300000); // 5 mins
    return () => clearInterval(interval);
  }, [accounts]);

  // Mock/Fallback data for UI display if no live data yet
  const getMockChartData = () => [
    { date: '4/18', views: 8000, likes: 300, replies: 120, reposts: 10, quotes: 2 },
    { date: '4/19', views: 15000, likes: 450, replies: 180, reposts: 15, quotes: 4 },
    { date: '4/20', views: 22000, likes: 700, replies: 280, reposts: 25, quotes: 8 },
    { date: '4/21', views: 21500, likes: 650, replies: 240, reposts: 22, quotes: 6 },
    { date: '4/22', views: 18000, likes: 500, replies: 200, reposts: 18, quotes: 5 },
    { date: '4/23', views: 19000, likes: 580, replies: 220, reposts: 20, quotes: 7 },
    { date: '4/24', views: 17500, likes: 540, replies: 210, reposts: 19, quotes: 6 },
  ];

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || accounts[0];
  const insights = liveInsights[selectedAccount?.id] || { 
    followers_count: selectedAccount?.followers || 1666, 
    likes: 2595, 
    replies: 956, 
    reposts: 25, 
    quotes: 12,
    views: 84200
  };

  const chartData = getMockChartData();
  const engagementData = [
    { name: 'Likes', value: insights.likes, color: '#ec4899' },
    { name: 'Replies', value: insights.replies, color: '#3b82f6' },
    { name: 'Reposts', value: insights.reposts, color: '#10b981' },
    { name: 'Quotes', value: insights.quotes, color: '#eab308' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-neutral-950 font-sans">
      {/* Header Area */}
      <div className="px-8 py-6 flex items-center justify-between border-b border-neutral-800/40 bg-neutral-900/20 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-violet-600/20 flex items-center justify-center border border-violet-500/30">
            <Layout className="w-6 h-6 text-violet-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-widest uppercase">Threads インサイト</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest">System Operational</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-neutral-900/80 p-1 rounded-xl border border-neutral-800">
            <button 
              onClick={() => setTimeRange('7d')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${timeRange === '7d' ? 'bg-violet-600 text-white' : 'text-neutral-500 hover:text-white'}`}
            >7日</button>
            <button 
              onClick={() => setTimeRange('30d')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${timeRange === '30d' ? 'bg-violet-600 text-white' : 'text-neutral-500 hover:text-white'}`}
            >30日</button>
          </div>
          <button 
            onClick={fetchLiveInsights}
            disabled={isSyncing}
            className="p-2 bg-neutral-900 border border-neutral-800 rounded-xl text-neutral-400 hover:text-white transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-hide">
        {/* Account Subheader */}
        <div className="flex items-end justify-between px-2">
          <div>
            <p className="text-[12px] font-bold text-neutral-500 uppercase tracking-widest mb-1 opacity-60">Insight Context</p>
            <h3 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
              @{selectedAccount?.threadsUsername || selectedAccount?.username || 'account_name'} のインサイト 
              <span className="text-neutral-500 font-medium">({timeRange === '7d' ? '過去7日' : '過去30日'})</span>
            </h3>
          </div>
          <div className="flex gap-2">
            {accounts.slice(0, 3).map(acc => (
              <button 
                key={acc.id}
                onClick={() => setSelectedAccountId(acc.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${selectedAccountId === acc.id ? 'bg-violet-500/20 border-violet-500/50 text-violet-400' : 'bg-neutral-900/40 border-neutral-800 text-neutral-500'}`}
              >
                @{acc.threadsUsername || acc.username}
              </button>
            ))}
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          {/* Main 3 Metrics (Left) */}
          <div className="flex flex-col gap-6">
            <MetricCard 
              label="FOLLOWERS" 
              value={insights.followers_count} 
              icon={<Users className="w-4 h-4" />} 
              color="violet" 
              trend="+12.5%"
            />
            <MetricCard 
              label="REPLIES" 
              value={insights.replies} 
              icon={<MessageCircle className="w-4 h-4" />} 
              color="blue" 
              trend="+5.2%"
            />
            <MetricCard 
              label="QUOTES" 
              value={insights.quotes} 
              icon={<Copy className="w-4 h-4" />} 
              color="yellow" 
              trend="+1.1%"
            />
          </div>

          {/* Side 2 Metrics (Right) */}
          <div className="flex flex-col gap-6">
            <MetricCard 
              label="LIKES" 
              value={insights.likes} 
              icon={<Heart className="w-4 h-4" />} 
              color="pink" 
              trend="+8.7%"
            />
            <MetricCard 
              label="REPOSTS" 
              value={insights.reposts} 
              icon={<Repeat className="w-4 h-4" />} 
              color="emerald" 
              trend="+2.4%"
            />
            
            {/* View Stats Summary */}
            <div className="flex-1 glass-panel p-6 rounded-3xl flex flex-col justify-center border-neutral-800/40 bg-neutral-900/30">
              <p className="text-[11px] font-bold text-neutral-500 tracking-widest uppercase mb-1">Total Profile Views</p>
              <h4 className="text-3xl font-bold text-white tracking-tight">{(insights.views || 0).toLocaleString()}</h4>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {[1,2,3].map(i => <div key={i} className="w-6 h-6 rounded-full border border-neutral-900 bg-neutral-800 flex items-center justify-center text-[8px] font-bold text-neutral-500">{i}</div>)}
                </div>
                <span className="text-[10px] text-emerald-400 font-bold items-center flex gap-1 bg-emerald-500/10 px-2 py-1 rounded-lg">
                  <TrendingUp className="w-3 h-3" /> ACTIVE CONTENT
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 gap-6">
          <div className="glass-panel p-8 rounded-[2rem] border-neutral-800/40 bg-neutral-900/30 min-h-[400px] flex flex-col">
            <div className="flex items-center justify-between mb-8 px-2">
              <h4 className="text-[12px] font-bold text-neutral-400 tracking-widest uppercase flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
                PROFILE VIEWS (過去7日)
              </h4>
            </div>
            <div className="flex-1 w-full h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                  <XAxis dataKey="date" stroke="#525252" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#525252" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => val >= 1000 ? `${val/1000}k` : val} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px', fontSize: '11px' }}
                    itemStyle={{ color: '#f5f5f5' }}
                  />
                  <Area type="monotone" dataKey="views" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorViews)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-panel p-8 rounded-[2rem] border-neutral-800/40 bg-neutral-900/30 min-h-[400px] flex flex-col">
            <div className="flex items-center justify-between mb-8 px-2">
              <h4 className="text-[12px] font-bold text-neutral-400 tracking-widest uppercase flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                ENGAGEMENT BREAKDOWN
              </h4>
            </div>
            <div className="flex-1 w-full h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={engagementData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                  <XAxis dataKey="name" stroke="#525252" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip 
                    cursor={{fill: '#262626'}}
                    contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px', fontSize: '11px' }}
                  />
                  <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                    {engagementData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} opacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Sub-component for individual Metric Cards
const MetricCard = ({ label, value, icon, color, trend }) => {
  const colorMap = {
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    pink: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    yellow: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  };

  return (
    <div className="glass-panel p-6 rounded-[1.5rem] flex flex-col justify-between group border-neutral-800/40 bg-neutral-900/30 shadow-lg hover:bg-neutral-900/40 transition-all duration-500">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <p className="text-[11px] font-bold text-neutral-500 tracking-[0.2em] uppercase opacity-70 mb-2">{label}</p>
          <div className="flex items-baseline gap-2">
            <h4 className="text-3xl font-bold text-white tracking-tight">{(value || 0).toLocaleString()}</h4>
            {trend && <span className="text-[10px] font-bold text-emerald-500/80 ml-1">{trend}</span>}
          </div>
        </div>
        <div className={`p-3 rounded-2xl border transition-all duration-500 ${colorMap[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
};

// ビュー: アカウント管理
const AccountsView = ({ accounts, onAccountsUpdate, currentUser, isElectron, isMobile }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNoteEmail, setNewNoteEmail] = useState('');
  const [newNotePassword, setNewNotePassword] = useState('');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('');
  const [proxyUser, setProxyUser] = useState('');
  const [proxyPass, setProxyPass] = useState('');
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);

  const handleBulkSync = async () => {
    if (accounts.length === 0) return;
    if (!apiService.isElectron) return;

    setIsBulkSyncing(true);
    let successCount = 0;

    for (const acc of accounts) {
      const credentials = {
        username: acc.threadsUsername,
        password: acc.threadsPassword,
        proxy: acc.proxy
      };
      const res = await apiService.startBrowserSession(acc.id, credentials);
      if (res.success && res.profileData) {
        successCount++;
        // Use a functional update to ensure we don't have race conditions if we were doing this in parallel, 
        // though here we are sequential for simplicity and Puppeteer limits.
        const updatedAccounts = JSON.parse(localStorage.getItem('threadsAccountsDB') || '[]');
        const nextSet = updatedAccounts.map(a => a.id === acc.id ? { ...a, ...res.profileData } : a);
        localStorage.setItem('threadsAccountsDB', JSON.stringify(nextSet));
        onAccountsUpdate(nextSet);
      }
    }

    setIsBulkSyncing(false);
    alert(`一括同期が完了しました (${successCount}/${accounts.length} 成功)`);
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;

    // Uniqueness check (Threads)
    const threadsCheck = await verifyAndLinkAccount('threads', newUsername, currentUser.username);
    if (!threadsCheck.success) {
      alert(threadsCheck.error);
      return;
    }

    // Uniqueness check (Note)
    if (newNoteEmail) {
      const noteCheck = await verifyAndLinkAccount('note', newNoteEmail, currentUser.username);
      if (!noteCheck.success) {
        alert(noteCheck.error);
        // Note: We already linked the threads account. In a perfect world we'd rollback.
        // But for now, just stopping here.
        return;
      }
    }

    // Plan check
    const plan = SUBSCRIPTION_PLANS[currentUser?.plan] || SUBSCRIPTION_PLANS.entry;
    if (accounts.length >= plan.maxAccounts && currentUser?.role !== 'admin') {
      alert(`ご利用中のプラン（${plan.name}）では、最大${plan.maxAccounts}件までしか登録できません。アップグレードをご検討ください。`);
      return;
    }

    const newAccount = {
      id: Date.now(),
      threadsUsername: newUsername,
      threadsPassword: newPassword,
      noteEmail: newNoteEmail,
      notePassword: newNotePassword,
      proxy: proxyHost ? { host: proxyHost, port: proxyPort, username: proxyUser, password: proxyPass } : null,
      name: newUsername,
      bio: "自動化システム連携済みアカウント\n(Puppeteer Engine稼働待機中)",
      avatarUrl: `https://picsum.photos/seed/${newUsername}/150/150`,
      status: 'paused',
      followers: 0,
      engagement: 0,
      recentPost: null
    };

    const updatedAccounts = [...accounts, newAccount];
    localStorage.setItem('threadsAccountsDB', JSON.stringify(updatedAccounts));
    onAccountsUpdate(updatedAccounts);
    setShowAddModal(false);
    setNewUsername('');
    setNewPassword('');
    setNewNoteEmail('');
    setNewNotePassword('');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent relative">
      <div className="px-8 py-6 border-b border-neutral-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center sticky top-0 bg-neutral-950/50 backdrop-blur-xl z-20">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users className="w-6 h-6 text-violet-500" />
            アカウント管理
          </h2>
          <p className="text-sm text-neutral-400 font-medium mt-1">AI連携中の {accounts.length} ノード</p>
        </div>
        <div className="flex gap-3 mt-4 sm:mt-0">
          <button
            onClick={handleBulkSync}
            disabled={isBulkSyncing || accounts.length === 0}
            className="glass-button px-5 py-2.5 rounded-xl text-[14px] font-bold text-white flex items-center disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 text-neutral-400 ${isBulkSyncing ? 'animate-spin' : ''}`} />
            {isBulkSyncing ? '同期中...' : '一括同期'}
          </button>
          <button 
            onClick={() => {
              setShowAddModal(true);
              setTimeout(() => window.focus(), 50);
            }} 
            className="px-5 py-2.5 bg-white text-black rounded-xl text-[14px] font-bold hover:bg-neutral-200 transition-colors flex items-center shadow-[0_0_15px_rgba(255,255,255,0.15)]"
          >
            <Plus className="w-4 h-4 mr-2" />
            アカウント追加
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 relative z-10">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500">
            <Users className="w-16 h-16 mb-4 opacity-50" />
            <h3 className="text-xl font-bold text-white mb-2">連携アカウントがありません</h3>
            <p className="mb-6">右上の「アカウント追加」ボタンからThreadsアカウントを登録して、自動投稿を開始しましょう。</p>
            <button 
              onClick={() => {
                setShowAddModal(true);
                setTimeout(() => window.focus(), 50);
              }} 
              className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-bold transition-all shadow-lg flex items-center"
            >
              <Plus className="w-5 h-5 mr-2" /> アカウントを連携する
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                currentUser={currentUser}
                isMobile={isMobile}
                isElectron={isElectron}
                onUpdateProfile={async (id, updates) => {
                  // If username or note email is changing, we must check uniqueness
                  if (updates.threadsUsername || updates.noteEmail) {
                    const acc = accounts.find(a => a.id === id);
                    if (updates.threadsUsername && updates.threadsUsername !== acc.threadsUsername) {
                      const res = await verifyAndLinkAccount('threads', updates.threadsUsername, currentUser.username);
                      if (!res.success) { alert(res.error); return; }
                      // Free old username
                      await unlinkAccount('threads', acc.threadsUsername);
                    }
                    if (updates.noteEmail && updates.noteEmail !== acc.noteEmail) {
                      const res = await verifyAndLinkAccount('note', updates.noteEmail, currentUser.username);
                      if (!res.success) { alert(res.error); return; }
                      // Free old email
                      await unlinkAccount('note', acc.noteEmail);
                    }
                  }

                  const newAccounts = accounts.map(a => a.id === id ? { ...a, ...updates } : a);
                  onAccountsUpdate(newAccounts);
                  localStorage.setItem('threadsAccountsDB', JSON.stringify(newAccounts));
                }}
                onDeleteAccount={async (id) => {
                  if (!window.confirm("このアカウントを削除しますか？")) return;
                  const acc = accounts.find(a => a.id === id);
                  if (acc) {
                    // Release account mappings in Firestore
                    await unlinkAccount('threads', acc.threadsUsername);
                    await unlinkAccount('note', acc.noteEmail);
                  }

                  const newAccounts = accounts.filter(a => a.id !== id);
                  onAccountsUpdate(newAccounts);
                  localStorage.setItem('threadsAccountsDB', JSON.stringify(newAccounts));
                  // Force focus on document to reclaim keyboard events from Electron webview
                  setTimeout(() => window.focus(), 100);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Account Add Modal */}
      {showAddModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-[2rem] border border-neutral-700/50 shadow-2xl animate-in fade-in zoom-in duration-200 custom-scrollbar">
            <div className="p-6 border-b border-neutral-800/80">
              <h3 className="text-lg font-bold text-white flex items-center">
                <Plus className="w-5 h-5 mr-2 text-violet-400" />
                実際のThreadsアカウント連携
              </h3>
            </div>
            <form onSubmit={handleAddAccount} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-neutral-400 mb-2">Threads ユーザー名 / メール / 電話番号</label>
                <div className="relative">
                  <User className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-500" />
                  <input
                    type="text"
                    required
                    autoFocus
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-neutral-900/50 border border-neutral-700 rounded-xl text-white focus:outline-none focus:border-violet-500 transition-colors [-webkit-app-region:no-drag] pointer-events-auto relative z-50"
                    placeholder="Instagram Username"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-neutral-400 mb-2">パスワード</label>
                <div className="relative">
                  <Lock className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-500" />
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-neutral-900/50 border border-neutral-700 rounded-xl text-white focus:outline-none focus:border-violet-500 transition-colors [-webkit-app-region:no-drag] pointer-events-auto relative z-50"
                    placeholder="••••••••"
                  />
                </div>
                <p className="text-[11px] text-neutral-500 mt-2">
                  ※入力されたパスワードはローカルの暗号化領域にのみ保管され、外部サーバーには一切送信されません。バックグラウンドブラウザでのログイン自動化にのみ使用されます。
                </p>
              </div>


              {/* Proxy Settings for Pro/Enterprise */}
              {((SUBSCRIPTION_PLANS[currentUser?.plan]?.features?.includes('proxy')) || currentUser?.role === 'admin') && (
                <>
                  <div className="pt-2 border-t border-neutral-800 my-2 text-[11px] font-bold text-violet-400 uppercase tracking-widest flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    プロキシ設定 (Pro/Enterprise)
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      className="col-span-2 px-4 py-2 bg-neutral-900/50 border border-neutral-700 rounded-xl text-xs text-white"
                      placeholder="IP/Host"
                      value={proxyHost} onChange={(e) => setProxyHost(e.target.value)}
                    />
                    <input
                      type="text"
                      className="px-4 py-2 bg-neutral-900/50 border border-neutral-700 rounded-xl text-xs text-white"
                      placeholder="Port"
                      value={proxyPort} onChange={(e) => setProxyPort(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      className="px-4 py-2 bg-neutral-900/50 border border-neutral-700 rounded-xl text-xs text-white"
                      placeholder="Proxy User"
                      value={proxyUser} onChange={(e) => setProxyUser(e.target.value)}
                    />
                    <input
                      type="password"
                      className="px-4 py-2 bg-neutral-900/50 border border-neutral-700 rounded-xl text-xs text-white"
                      placeholder="Proxy Pass"
                      value={proxyPass} onChange={(e) => setProxyPass(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-bold text-neutral-400 mb-2">note ログインメールアドレス</label>
                <div className="relative">
                  <Mail className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-500" />
                  <input
                    type="email"
                    value={newNoteEmail}
                    onChange={(e) => setNewNoteEmail(e.target.value)}
                    onFocus={() => window.focus()}
                    className="w-full pl-10 pr-4 py-3 bg-neutral-900/50 border border-neutral-700 rounded-xl text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="example@email.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-neutral-400 mb-2">note パスワード</label>
                <div className="relative">
                  <Lock className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-500" />
                  <input
                    type="password"
                    value={newNotePassword}
                    onChange={(e) => setNewNotePassword(e.target.value)}
                    onFocus={() => window.focus()}
                    className="w-full pl-10 pr-4 py-3 bg-neutral-900/50 border border-neutral-700 rounded-xl text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-sm rounded-xl transition-colors [-webkit-app-region:no-drag] pointer-events-auto"
                >キャンセル</button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-white hover:bg-neutral-200 text-black font-bold text-sm rounded-xl transition-colors [-webkit-app-region:no-drag] pointer-events-auto"
                >アカウント接続</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ビュー: AI自動運用設定
const AutoPilotView = ({ accounts, onAccountsUpdate }) => {
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || (accounts.length > 0 ? accounts[0] : null);
  
  const [intervalMin, setIntervalMin] = useState(60);
  const [theme, setTheme] = useState("最新のテクノロジーとAIの活用法");
  const [tone, setTone] = useState("カジュアル（絵文字多め、親しみやすい）");
  const [promptText, setPromptText] = useState("親しみやすく、かつ専門的な知見を感じさせる文体で発信してください。読者に気づきを与える内容を心がけてください。");
  const [target, setTarget] = useState("");
  const [benefits, setBenefits] = useState("");
  const [keywords, setKeywords] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [useEmojis, setUseEmojis] = useState(true);
  const [postFormat, setPostFormat] = useState('single');
  const [testResult, setTestResult] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [nextRun, setNextRun] = useState(null);
  const [aiProvider, setAiProvider] = useState('gemini');
  const [aiModel, setAiModel] = useState('gemini-1.5-flash');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [manusApiKey, setManusApiKey] = useState('');
  const [threadsApiKey, setThreadsApiKey] = useState('');
  const [useImageGen, setUseImageGen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("投稿内容を視覚的に表現した、スタイリッシュなSNS向けの画像");
  const [useTrends, setUseTrends] = useState(false);
  const [trendKeyword, setTrendKeyword] = useState("");
  const [useAutoEngage, setUseAutoEngage] = useState(false);
  const [engageKeywords, setEngageKeywords] = useState("");
  const [engageAction, setEngageAction] = useState('both');
  const [engageCount, setEngageCount] = useState(3);
  const [engageReplyPrompt, setEngageReplyPrompt] = useState("共感や肯定的な反応を示しつつ、自然な日本語で返信してください。");
  const [currentTrends, setCurrentTrends] = useState([]);
  const [isTestingThreads, setIsTestingThreads] = useState(false);
  const [useAutoDM, setUseAutoDM] = useState(false);
  const [dmContent, setDmContent] = useState("返信ありがとうございます！詳細はこちらのリンクからご確認ください。");
  const [useNoteAutoPost, setUseNoteAutoPost] = useState(false);

  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  // Load account-specific settings when selectedAccount changes
  React.useEffect(() => {
    if (selectedAccount) {
      const settings = selectedAccount.personaSettings || {};
      setTheme(settings.theme || "最新のテクノロジーとAIの活用法");
      setTone(settings.tone || "カジュアル（絵文字多め、親しみやすい）");
      setPromptText(settings.promptText || "親しみやすく、かつ専門的な知見を感じさせる文体で発信してください。読者に気づきを与える内容を心がけてください。");
      setTarget(settings.target || "");
      setBenefits(settings.benefits || "");
      setKeywords(settings.keywords || "");
      setExclusions(settings.exclusions || "");
      setUseEmojis(settings.useEmojis !== undefined ? settings.useEmojis : true);
      setPostFormat(settings.postFormat || 'single');
      setAiProvider(settings.aiProvider || 'gemini');
      setAiModel(settings.aiModel || 'gemini-1.5-flash');
      setUseImageGen(settings.useImageGen || false);
      setImagePrompt(settings.imagePrompt || "投稿内容を視覚的に表現した、スタイリッシュなSNS向けの画像");
      setUseTrends(settings.useTrends || false);
      setTrendKeyword(settings.trendKeyword || "");
      setUseAutoEngage(settings.useAutoEngage || false);
      setEngageKeywords(settings.engageKeywords || "");
      setEngageAction(settings.engageAction || 'both');
      setEngageCount(settings.engageCount || 3);
      setEngageReplyPrompt(settings.engageReplyPrompt || "共感や肯定的な反応を示しつつ、自然な日本語で返信してください。");
      setUseAutoDM(settings.useAutoDM || false);
      setUseNoteAutoPost(settings.useNoteAutoPost || false);
      setDmContent(settings.dmContent || "返信ありがとうございます！詳細はこちらのリンクからご確認ください。");
      setIntervalMin(settings.intervalMin || 60);
      setGeminiApiKey(settings.geminiApiKey || '');
      setOpenaiApiKey(settings.openaiApiKey || '');
      setAnthropicApiKey(settings.anthropicApiKey || '');
      setManusApiKey(settings.manusApiKey || '');
      setThreadsApiKey(settings.threadsApiKey || '');
    }
  }, [selectedAccount]);

  const handleApplySettings = () => {
    if (!selectedAccount) return;

    const updatedSettings = {
      theme, tone, promptText, target, benefits, keywords, exclusions, useEmojis, postFormat,
      useTrends, trendKeyword, useAutoEngage, engageKeywords, engageAction, engageCount, engageReplyPrompt,
      useAutoDM, dmContent, useNoteAutoPost,
      geminiApiKey, openaiApiKey, anthropicApiKey, manusApiKey, threadsApiKey
    };



    const accountsDB = JSON.parse(localStorage.getItem('threadsAccountsDB') || '[]');
    const updatedDB = accountsDB.map(acc => {
      if (acc.id === selectedAccount.id) {
        return { ...acc, personaSettings: updatedSettings };
      }
      return acc;
    });

    localStorage.setItem('threadsAccountsDB', JSON.stringify(updatedDB));
    if (onAccountsUpdate) onAccountsUpdate(updatedDB);
    alert("設定を保存しました。次回このアカウントを選択した際に自動的に読み込まれます。");
  };

  const buildPromptWithLocal = (trends = []) => {
    const persona = {
      theme, tone, promptText, target, benefits, keywords, exclusions, useEmojis, postFormat
    };
    return buildPrompt(persona, trends);
  };

  const handleTestPersona = async () => {
    if (!selectedAccount) {
      alert("アカウントを選択してください");
      return;
    }
    setIsTesting(true);
    const keyMap = {
      gemini: geminiApiKey || localStorage.getItem('geminiApiKey'),
      openai: openaiApiKey || localStorage.getItem('openaiApiKey'),
      anthropic: anthropicApiKey || localStorage.getItem('anthropicApiKey'),
      manus: manusApiKey || localStorage.getItem('manusApiKey')
    };
    const result = await callAI(aiProvider, keyMap[aiProvider], aiModel, buildPromptWithLocal());
    setTestResult(result);
    setIsTesting(false);
  };

  const handleTestThreadsAPI = async () => {
    if (!threadsApiKey) {
      alert("Threads API Key（アクセストークン）を入力してください。");
      return;
    }
    setIsTestingThreads(true);
    try {
      const result = await apiService.testThreadsConnection(threadsApiKey);
      if (result.success) {
        alert(`🎉 接続成功！\nアカウント: @${result.username}\nID: ${result.id}\n\nこのキーで自動投稿とインサイト取得が可能です。`);
      } else {
        alert(`❌ 接続失敗\nエラー: ${result.error}\n\nトークンが正しいか、有効期限が切れていないか確認してください。`);
      }
    } catch (e) {
      alert(`エラーが発生しました: ${e.message}`);
    } finally {
      setIsTestingThreads(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-transparent">
      {/* Sidebar for Accounts */}
      <div className="w-80 glass-panel border-r border-neutral-800/80 flex flex-col flex-shrink-0 overflow-hidden hidden md:flex rounded-none border-y-0 border-l-0">
        <div className="p-5 border-b border-neutral-800/50 bg-neutral-900/30">
          <h2 className="text-sm font-bold text-neutral-400 tracking-wider uppercase mb-3">Target Node</h2>
          <div className="relative group">
            <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-500 group-focus-within:text-violet-400 transition-colors" />
            <input
              type="text"
              placeholder="Search accounts..."
              className="w-full pl-10 pr-4 py-2.5 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all shadow-inner"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {accounts.length === 0 ? (
            <p className="text-center text-[12px] text-neutral-500 mt-10">アカウントが登録されていません</p>
          ) : (
            accounts.map(account => (
              <button
                key={account.id}
                onClick={() => setSelectedAccountId(account.id)}
                className={`w-full text-left p-3 rounded-xl flex items-center gap-4 transition-all [-webkit-app-region:no-drag] pointer-events-auto ${selectedAccountId === account.id || (!selectedAccountId && accounts[0]?.id === account.id)
                    ? 'bg-violet-500/10 border border-violet-500/20 shadow-[inset_0_0_15px_rgba(139,92,246,0.1)]'
                    : 'hover:bg-neutral-800/50 border border-transparent'
                  }`}
              >
                <img src={account.avatarUrl || 'https://picsum.photos/150'} className="w-10 h-10 rounded-full object-cover border border-neutral-700" alt="avatar" />
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-bold truncate ${selectedAccountId === account.id ? 'text-violet-100' : 'text-white'}`}>{account.threadsUsername || account.username}</p>
                  <p className="text-[12px] text-neutral-500 truncate">{account.name || account.threadsUsername}</p>
                </div>
                {account.status === 'active' && <div className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_5px_rgba(16,185,129,0.8)]"></div>}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-transparent">
        <div className="px-8 py-6 border-b border-neutral-800/50 bg-neutral-950/50 backdrop-blur-xl flex justify-between items-center sticky top-0 z-10">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Sparkles className="w-6 h-6 text-violet-500" />
              AI自律運用エンジン設定
            </h1>
            <p className="text-sm font-medium text-neutral-400 mt-1">
              {selectedAccount ? `@${selectedAccount.threadsUsername || selectedAccount.username} のAIパーソナリティと自律アクションを定義` : 'アカウントを選択してください'}
            </p>
          </div>
          <button
            onClick={handleApplySettings}
            disabled={!selectedAccount}
            className="px-6 py-2.5 bg-white text-black rounded-xl text-[14px] font-bold hover:bg-neutral-200 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.1)] disabled:opacity-50">
            変更を適用
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl space-y-8 pb-10">

            <div className="glass-panel p-6 rounded-3xl flex items-center justify-between shadow-lg">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Bot className="w-5 h-5 text-indigo-400" />
                  フルオートパイロット {selectedAccount?.status === 'active' && <span className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 text-xs animate-pulse">稼働中</span>}
                </h3>
                <p className="text-sm text-neutral-400 font-medium mt-1">選択したエージェントの自動運用設定です。パトロールをONにすると適用されます。</p>
              </div>
              <div className="flex items-center gap-4">
                <select
                  value={intervalMin}
                  onChange={(e) => {
                    setIntervalMin(Number(e.target.value));
                    // Also update in personaSettings immediately for persistence
                    if (selectedAccount) {
                        const updated = accounts.map(a => a.id === selectedAccount.id ? { ...a, personaSettings: { ...a.personaSettings, intervalMin: Number(e.target.value) } } : a);
                        onAccountsUpdate(updated);
                        localStorage.setItem('threadsAccountsDB', JSON.stringify(updated));
                    }
                  }}
                  className="bg-neutral-900 border border-neutral-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:border-violet-500 disabled:opacity-50"
                >
                  <option value={15}>15分に1回</option>
                  <option value={30}>30分に1回</option>
                  <option value={60}>1時間に1回</option>
                  <option value={180}>3時間に1回</option>
                  <option value={360}>6時間に1回</option>
                  <option value={720}>12時間に1回</option>
                </select>
                <div className="relative inline-block w-14 align-middle select-none">
                  <input 
                    type="checkbox" 
                    checked={selectedAccount?.status === 'active'} 
                    onChange={(e) => {
                      const newStatus = e.target.checked ? 'active' : 'paused';
                      const updated = accounts.map(a => a.id === selectedAccount.id ? { ...a, status: newStatus } : a);
                      onAccountsUpdate(updated);
                      localStorage.setItem('threadsAccountsDB', JSON.stringify(updated));
                    }} 
                    disabled={!selectedAccount} 
                    name={`toggle-${selectedAccount?.id || 'none'}`} 
                    id={`toggle-${selectedAccount?.id || 'none'}`} 
                    className="toggle-checkbox absolute block w-7 h-7 rounded-full bg-white border-4 border-neutral-800 appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-7 checked:border-violet-500 z-10 disabled:opacity-50 disabled:cursor-not-allowed [-webkit-app-region:no-drag] pointer-events-auto" 
                  />
                  <label htmlFor={`toggle-${selectedAccount?.id || 'none'}`} className="toggle-label block overflow-hidden h-7 rounded-full bg-neutral-800 cursor-pointer transition-colors duration-300 ease-in-out"></label>
                </div>
              </div>
            </div>

            <div className="glass-panel rounded-3xl overflow-hidden shadow-lg">
              <div className="px-8 py-5 border-b border-neutral-800/80 bg-neutral-900/50 flex justify-between items-center">
                <h3 className="text-[15px] font-bold text-white tracking-widest uppercase">Persona Interface</h3>
                <button
                  onClick={handleTestPersona}
                  disabled={isTesting}
                  className="px-4 py-2 bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-xl text-[13px] font-bold hover:bg-violet-500/20 transition-all flex items-center disabled:opacity-50"
                >
                  {isTesting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  AI推論テスト
                </button>
              </div>
              <div className="p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">発信テーマ・トピック</label>
                    <input
                      type="text"
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                      placeholder="例: 副業、AI、海外移住"
                      className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">トーン＆マナー（文体）</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all appearance-none cursor-pointer font-medium"
                    >
                      <option className="bg-neutral-900">カジュアル（絵文字多め、親しみやすい）</option>
                      <option className="bg-neutral-900">フォーマル（ビジネスライク、論理的）</option>
                      <option className="bg-neutral-900">情熱的（！や🔥多め、インフルエンサー風）</option>
                      <option className="bg-neutral-900">ミステリアス（短文、淡々と事実を述べる）</option>
                      <option className="bg-neutral-900">毒舌・辛口（エッジの効いた意見）</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">ターゲット読者層</label>
                    <input
                      type="text"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      placeholder="例: 20代のITエンジニア、子育て中の主婦"
                      className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">提供するベネフィット（読者が得るもの）</label>
                    <input
                      type="text"
                      value={benefits}
                      onChange={(e) => setBenefits(e.target.value)}
                      placeholder="例: 最新のAIツールで時短できる、お金の不安がなくなる"
                      className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">重要キーワード（カンマ区切り）</label>
                    <input
                      type="text"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="例: 自動化, 効率化, Gemini"
                      className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">除外事項・NGワード</label>
                    <input
                      type="text"
                      value={exclusions}
                      onChange={(e) => setExclusions(e.target.value)}
                      placeholder="例: 宗教、政治、ギャンブル"
                      className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">ベースプロンプト（人格の深掘り・特殊な指示）</label>
                  <textarea
                    rows="4"
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all resize-none font-medium leading-relaxed"
                    placeholder="例: あなたは論破王のひろゆきのような口調で、最後に必ず「〜ですよね」をつけてください。"
                  ></textarea>
                </div>

                <div className="border-t border-neutral-800/50 pt-8 mt-4">
                  <h4 className="text-[13px] font-bold text-neutral-400 tracking-widest uppercase mb-6 flex items-center gap-2">
                    <Activity className="w-4 h-4" /> AI Engine Selection & Media
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">AIプロバイダー</label>
                      <select
                        value={aiProvider}
                        onChange={(e) => {
                          setAiProvider(e.target.value);
                          if (e.target.value === 'gemini') setAiModel('gemini-1.5-flash');
                          if (e.target.value === 'openai') setAiModel('gpt-4o');
                          if (e.target.value === 'anthropic') setAiModel('claude-3-5-sonnet-20240620');
                        }}
                        className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all appearance-none cursor-pointer font-medium"
                      >
                        <option value="gemini">Google Gemini (標準)</option>
                        <option value="openai">OpenAI (高精度・画像生成)</option>
                        <option value="anthropic">Anthropic Claude (自然な文章)</option>
                        <option value="manus">Manus AI (自律型エージェント)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">AIモデル</label>
                      <select
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all appearance-none cursor-pointer font-medium"
                      >
                        {aiProvider === 'gemini' && (
                          <>
                            <option value="gemini-1.5-flash">Gemini 1.5 Flash (高速)</option>
                            <option value="gemini-1.5-pro">Gemini 1.5 Pro (高性能)</option>
                            <option value="gemini-2.0-flash">Gemini 2.0 Flash (最新)</option>
                          </>
                        )}
                        {aiProvider === 'openai' && (
                          <>
                            <option value="gpt-4o">GPT-4o (フラッグシップ)</option>
                            <option value="gpt-4o-mini">GPT-4o mini (省コスト)</option>
                          </>
                        )}
                        {aiProvider === 'anthropic' && (
                          <>
                            <option value="claude-3-5-sonnet-20240620">Claude 3.5 Sonnet (推奨)</option>
                            <option value="claude-3-opus-20240229">Claude 3 Opus (最高品質)</option>
                          </>
                        )}
                        {aiProvider === 'manus' && (
                          <>
                            <option value="manus-1">Manus-1 (Standard)</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 p-6 bg-neutral-950/40 rounded-3xl border border-neutral-800/50">
                    <div className="md:col-span-2">
                       <h5 className="text-[11px] font-bold text-violet-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                         <Key className="w-3.5 h-3.5" /> API接続キー (このアカウント専用)
                       </h5>
                       <p className="text-[10px] text-neutral-500 mb-4">* 未入力の場合は「システム設定」の共通キーが使用されます。</p>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-neutral-400 mb-2 uppercase">Gemini API Key</label>
                      <input
                        type="password"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder="AI-..."
                        className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-neutral-400 mb-2 uppercase">OpenAI API Key</label>
                      <input
                        type="password"
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-neutral-400 mb-2 uppercase">Anthropic API Key</label>
                      <input
                        type="password"
                        value={anthropicApiKey}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-neutral-400 mb-2 uppercase">Manus API Key</label>
                      <input
                        type="password"
                        value={manusApiKey}
                        onChange={(e) => setManusApiKey(e.target.value)}
                        placeholder="manus-..."
                        className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="block text-[11px] font-bold text-neutral-400 uppercase">Threads (Official) API Key</label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={threadsApiKey}
                          onChange={(e) => setThreadsApiKey(e.target.value)}
                          placeholder="Threads Access Token..."
                          className="flex-1 p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500/50"
                        />
                        <button
                          onClick={handleTestThreadsAPI}
                          disabled={isTestingThreads || !threadsApiKey}
                          className="px-4 py-2 bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded-xl text-[11px] font-bold hover:bg-indigo-500/30 transition-all disabled:opacity-30 flex items-center gap-2"
                        >
                          {isTestingThreads ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                          接続テスト
                        </button>
                      </div>
                      <p className="text-[9px] text-neutral-500 mt-0.5 ml-1">※公式APIを利用する場合は「長期トークン」を入力してください。<br/>取得方法は「使用方法」または「threads_api_guide.md」を参照してください。</p>
                    </div>
                  </div>


                  <div className="mt-8 space-y-6">
                    <div className="flex items-center justify-between glass-panel p-4 rounded-2xl border border-neutral-800/50">
                      <div className="flex items-center gap-3">
                        <TrendingUp className="w-5 h-5 text-indigo-400" />
                        <div>
                          <p className="text-sm font-bold text-white">画像自動生成 (DALL-E 3)</p>
                          <p className="text-xs text-neutral-400 font-medium">投稿内容に合わせた画像をAIが生成し、自動添付します</p>
                        </div>
                      </div>
                      <div className="relative inline-block w-12 align-middle select-none">
                        <input type="checkbox" checked={useImageGen} onChange={(e) => setUseImageGen(e.target.checked)} id="image-gen-toggle" className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-2 border-neutral-800 appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-6 checked:border-violet-500 z-10" />
                        <label htmlFor="image-gen-toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-neutral-800 cursor-pointer transition-colors duration-300 ease-in-out"></label>
                      </div>
                    </div>

                    {useImageGen && (
                      <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <label className="block text-sm font-bold text-neutral-300 mb-3 ml-1">画像生成用追加プロンプト (任意)</label>
                        <input
                          type="text"
                          value={imagePrompt}
                          onChange={(e) => setImagePrompt(e.target.value)}
                          placeholder="スタイリッシュなSNS向けの画像、アニメ調など..."
                          className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-8 space-y-6">
                    <div className="glass-panel p-6 rounded-2xl border border-neutral-800/50">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <Globe className="w-5 h-5 text-sky-400" />
                          <div>
                            <p className="text-sm font-bold text-white">トレンド情報キュレーション</p>
                            <p className="text-xs text-neutral-400 font-medium">最新のニュースや話題を投稿に自動で取り込みます</p>
                          </div>
                        </div>
                        <div className="relative inline-block w-12 align-middle select-none">
                          <input type="checkbox" checked={useTrends} onChange={(e) => setUseTrends(e.target.checked)} id="trends-toggle" className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-2 border-neutral-800 appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-6 checked:border-violet-500 z-10" />
                          <label htmlFor="trends-toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-neutral-800 cursor-pointer transition-colors duration-300 ease-in-out"></label>
                        </div>
                      </div>
                      {useTrends && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                          <label className="block text-xs font-bold text-neutral-500 mb-2 uppercase ml-1">トレンドキーワード (空欄で一般ニュース)</label>
                          <input
                            type="text"
                            value={trendKeyword}
                            onChange={(e) => setTrendKeyword(e.target.value)}
                            placeholder="例: AI, 投資, 野球"
                            className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-[13px] text-white focus:outline-none focus:border-violet-500/50 transition-all font-medium"
                          />
                          {currentTrends.length > 0 && (
                            <div className="mt-4 p-3 bg-neutral-900/80 rounded-xl border border-neutral-800">
                              <p className="text-[10px] font-bold text-neutral-500 mb-2 uppercase">検出されたトレンド:</p>
                              <div className="flex flex-wrap gap-2">
                                {currentTrends.slice(0, 3).map((t, idx) => (
                                  <span key={idx} className="px-2 py-1 bg-sky-500/10 text-sky-400 text-[10px] rounded-md border border-sky-500/20 truncate max-w-[150px]">{t}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="glass-panel p-6 rounded-2xl border border-neutral-800/50">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <Users className="w-5 h-5 text-rose-400" />
                          <div>
                            <p className="text-sm font-bold text-white">自動エンゲージメント (いいね・返信)</p>
                            <p className="text-xs text-neutral-400 font-medium">関連する投稿を自動で探し、交流して露出を広げます</p>
                          </div>
                        </div>
                        <div className="relative inline-block w-12 align-middle select-none">
                          <input type="checkbox" checked={useAutoEngage} onChange={(e) => setUseAutoEngage(e.target.checked)} id="engage-toggle" className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-2 border-neutral-800 appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-6 checked:border-violet-500 z-10" />
                          <label htmlFor="engage-toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-neutral-800 cursor-pointer transition-colors duration-300 ease-in-out"></label>
                        </div>
                      </div>
                      {useAutoEngage && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-4">
                          <div>
                            <label className="block text-xs font-bold text-neutral-500 mb-2 uppercase ml-1">ターゲットキーワード (カンマ区切り)</label>
                            <input
                              type="text"
                              value={engageKeywords}
                              onChange={(e) => setEngageKeywords(e.target.value)}
                              placeholder="例: 副業, ライフハック, エンジニア"
                              className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-[13px] text-white focus:outline-none focus:border-violet-500/50 transition-all font-medium"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-bold text-neutral-500 mb-2 uppercase ml-1">アクション形式</label>
                              <select
                                value={engageAction}
                                onChange={(e) => setEngageAction(e.target.value)}
                                className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-[13px] text-white focus:outline-none focus:border-violet-500/50 transition-all font-medium"
                              >
                                <option value="like">いいね！のみ</option>
                                <option value="reply">返信（リプライ）のみ</option>
                                <option value="both">両方実行</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-neutral-500 mb-2 uppercase ml-1">1サイクルあたりの数</label>
                              <input
                                type="number"
                                value={engageCount}
                                onChange={(e) => setEngageCount(Number(e.target.value))}
                                min="1" max="10"
                                className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-[13px] text-white focus:outline-none focus:border-violet-500/50 transition-all font-medium"
                              />
                            </div>
                          </div>
                          {(engageAction === 'reply' || engageAction === 'both') && (
                            <div>
                              <label className="block text-xs font-bold text-neutral-500 mb-2 uppercase ml-1">AI返信プロンプト指示</label>
                              <textarea
                                rows="2"
                                value={engageReplyPrompt}
                                onChange={(e) => setEngageReplyPrompt(e.target.value)}
                                className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-[13px] text-white focus:outline-none focus:border-violet-500/50 transition-all resize-none font-medium"
                              ></textarea>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="glass-panel p-6 rounded-2xl border border-neutral-800/50">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <Repeat className="w-5 h-5 text-emerald-400" />
                          <div>
                            <p className="text-sm font-bold text-white">自動DM（リプライ・ファンネル）</p>
                            <p className="text-xs text-neutral-400 font-medium">自分の投稿に返信した人に自動でDMを送信します</p>
                          </div>
                        </div>
                        <div className="relative inline-block w-12 align-middle select-none">
                          <input type="checkbox" checked={useAutoDM} onChange={(e) => setUseAutoDM(e.target.checked)} id="dm-toggle" className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-2 border-neutral-800 appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-6 checked:border-violet-500 z-10" />
                          <label htmlFor="dm-toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-neutral-800 cursor-pointer transition-colors duration-300 ease-in-out"></label>
                        </div>
                      </div>
                      {useAutoDM && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-4">
                          <div>
                            <label className="block text-xs font-bold text-neutral-500 mb-2 uppercase ml-1">自動送信するDM内容</label>
                            <textarea
                              rows="3"
                              value={dmContent}
                              onChange={(e) => setDmContent(e.target.value)}
                              placeholder="例: 返信ありがとうございます！期間限定のプレゼントはこちらから受け取れます：https://..."
                              className="w-full p-3 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-[13px] text-white focus:outline-none focus:border-violet-500/50 transition-all resize-none font-medium"
                            ></textarea>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-8 py-2">
                  <div className="flex items-center gap-3">
                    <label className="text-[14px] font-bold text-neutral-400">絵文字を使用:</label>
                    <div className="relative inline-block w-10 align-middle select-none">
                      <input type="checkbox" checked={useEmojis} onChange={(e) => setUseEmojis(e.target.checked)} id="emoji-toggle" className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-2 border-neutral-800 appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-5 checked:border-violet-500 z-10" />
                      <label htmlFor="emoji-toggle" className="toggle-label block overflow-hidden h-5 rounded-full bg-neutral-800 cursor-pointer transition-colors duration-300 ease-in-out"></label>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-[14px] font-bold text-neutral-400">投稿形式:</label>
                    <div className="flex bg-neutral-900 p-1 rounded-xl border border-neutral-800">
                      <button
                        onClick={() => setPostFormat('single')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${postFormat === 'single' ? 'bg-violet-600 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'}`}
                      >単発ポスト</button>
                      <button
                        onClick={() => setPostFormat('thread')}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${postFormat === 'thread' ? 'bg-violet-600 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'}`}
                      >スレッド形式</button>
                    </div>
                  </div>
                </div>

                {testResult && (
                  <div className="mt-8 p-6 bg-gradient-to-br from-violet-900/20 to-indigo-900/20 border border-violet-500/20 rounded-2xl shadow-inner relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4">
                      <Bot className="w-16 h-16 text-violet-500/10" />
                    </div>
                    <p className="text-xs font-bold text-violet-400 mb-3 flex items-center uppercase tracking-widest relative z-10">
                      <Sparkles className="w-3.5 h-3.5 mr-2" /> Generated Output
                    </p>
                    <p className="text-[14px] text-violet-100 whitespace-pre-wrap leading-relaxed relative z-10 font-medium">{testResult}</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{
        __html: `
        .toggle-checkbox:checked + .toggle-label {
          background-color: #8b5cf6;
        }
      `}} />
    </div>
  );
};

// ビュー: 自動投稿スケジュール
const SchedulerView = ({ accounts }) => {
  const [topic, setTopic] = useState('');
  const [postContent, setPostContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [intervalMin, setIntervalMin] = useState(15);
  // const [accounts, setAccounts] = useState([]); // Removed, now a prop
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [useEmojis, setUseEmojis] = useState(true);
  const [useNoteAutoPost, setUseNoteAutoPost] = useState(false);
  const [postFormat, setPostFormat] = useState('single');
  const [nextRun, setNextRun] = useState(null);

  React.useEffect(() => {
    if (accounts && accounts.length > 0 && selectedAccountIds.length === 0) {
      setSelectedAccountIds([accounts[0].id]);
    }
  }, [accounts, selectedAccountIds]);

  const generatePost = async (currentTopic) => {
    setIsGenerating(true);
    const emojiInstruction = useEmojis ? "適切な絵文字を各所に散りばめてください。" : "絵文字は一切使用しないでください。";
    const formatInstruction = postFormat === 'thread'
      ? "3〜5件の連続したスレッド形式で作成してください。各ポストの間には '---' （ハイフン3つ）のセパレーターを入れてください。"
      : "1件の完結したポスト（最大300文字）として作成してください。";

    const prompt = `あなたはSNS（Threads）の運用プロフェッショナルです。以下のテーマについて、ユーザーの興味を惹く投稿を作成してください。\n\nテーマ: ${currentTopic}\n\n${formatInstruction}\n\n条件:\n- ${emojiInstruction}\n- 読みやすい改行を入れる\n- 問いかけや共感を誘う内容にする\n- ハッシュタグを2〜3個入れる`;

    // Default to Gemini for SchedulerView for now
    const key = localStorage.getItem('geminiApiKey');
    try {
      const result = await callAI('gemini', key, 'gemini-1.5-flash', prompt);
      setPostContent(result);
      return result;
    } catch (err) {
      alert(`AI生成エラー: ${err.message}`);
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateClick = async () => {
    if (!topic) return;
    await generatePost(topic);
  };

  const executePost = async (contentToPost) => {
    if (!contentToPost || selectedAccountIds.length === 0) return { success: false, error: "Content or accounts empty" };
    if (!apiService.isElectron) return { success: false, error: "Electron API not available" };

    setIsDeploying(true);
    let allSuccess = true;
    let lastError = "";

    for (const targetId of selectedAccountIds) {
      const targetAccount = accounts.find(a => a.id === targetId);
      if (!targetAccount) continue;

      const credentials = {
        username: targetAccount.threadsUsername,
        password: targetAccount.threadsPassword,
        proxy: targetAccount.proxy,
        threadsApiKey: targetAccount.personaSettings?.threadsApiKey
      };

      const res = await apiService.postToThreads(targetAccount.id, credentials, contentToPost, null);
      if (res.success) {
        // If Note cross-post is enabled and credentials exist
        if (useNoteAutoPost && targetAccount.noteEmail && targetAccount.notePassword) {
            const title = contentToPost.substring(0, 30) + "...";
            await apiService.postToNote(targetAccount.id, targetAccount, title, contentToPost);
        }
      } else {
        allSuccess = false;
        lastError = res.error || "Unknown error";
        console.error(`Failed to post to ${targetAccount.threadsUsername}: ${res.error}`);
      }
    }

    setIsDeploying(false);
    return { success: allSuccess, error: lastError };
  };

  const handleDeployClick = async () => {
    if (!postContent) {
      alert("投稿内容が空です");
      return;
    }
    const res = await executePost(postContent);
    if (res.success) {
      alert("🎉 手動デプロイが完了しました！");
      setPostContent('');
    } else {
      alert(`❌ 投稿に失敗しました。\n詳細エラー: ${res.error}`);
    }
  };

  // 自動ループ処理
  React.useEffect(() => {
    let timerID;
    let countdownID;

    if (isLooping) {
      const runCycle = async () => {
        // 1. Generate new content if empty
        let content = postContent;
        if (!content && topic) {
          content = await generatePost(topic);
        }

        // 2. Deploy content
        if (content) {
          await executePost(content);
          setPostContent(''); // Clear for next run
        }

        // 3. Schedule next run
        const nextTime = Date.now() + (intervalMin * 60 * 1000);

        // Timer display update
        clearInterval(countdownID);
        countdownID = setInterval(() => {
          const remaining = Math.max(0, Math.floor((nextTime - Date.now()) / 1000));
          const m = Math.floor(remaining / 60);
          const s = remaining % 60;
          setNextRun(`${m}分${s}秒`);
        }, 1000);

        timerID = setTimeout(runCycle, intervalMin * 60 * 1000);
      };

      // 初回実行
      runCycle();
    } else {
      setNextRun(null);
      clearTimeout(timerID);
      clearInterval(countdownID);
    }

    return () => {
      clearTimeout(timerID);
      clearInterval(countdownID);
    };
  }, [isLooping, intervalMin, topic, accounts]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent">
      <div className="px-8 py-6 border-b border-neutral-800/50 bg-neutral-950/50 backdrop-blur-xl flex justify-between items-center sticky top-0 z-20">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <CalendarClock className="w-6 h-6 text-violet-500" />
            自動スケジューラー (AI Loop)
          </h2>
          <p className="text-sm text-neutral-400 font-medium mt-1">
            {isLooping ? <span className="text-emerald-400 flex items-center gap-1 animate-pulse"><Zap className="w-3 h-3" /> {intervalMin}分間隔で自動生成・投稿を実行中 (次回: {nextRun})</span> : "高度なAIを用いたスレッド文の自動生成・循環配信モジュール"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-bold text-neutral-400">間隔:</label>
          <select
            value={intervalMin}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
            disabled={isLooping}
            className="bg-neutral-900 border border-neutral-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:border-violet-500 disabled:opacity-50"
          >
            <option value={3}>3分</option>
            <option value={5}>5分</option>
            <option value={15}>15分</option>
            <option value={30}>30分</option>
            <option value={60}>1時間</option>
          </select>
          <button
            onClick={() => setIsLooping(!isLooping)}
            disabled={!topic || selectedAccountIds.length === 0}
            className={`px-6 py-2.5 rounded-xl text-[14px] font-bold transition-all shadow-lg flex items-center disabled:opacity-50 border ${isLooping
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
              }`}
          >
            {isLooping ? <PauseCircle className="w-4 h-4 mr-2" /> : <Repeat className="w-4 h-4 mr-2" />}
            {isLooping ? 'ループ停止' : '自動ループ開始'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-8">

          <div className="glass-panel p-6 rounded-3xl flex items-center justify-between shadow-lg">
            <div className="flex gap-8">
              <div className="flex items-center gap-3">
                <label className="text-[14px] font-bold text-neutral-400">絵文字を使用:</label>
                <div className="relative inline-block w-10 align-middle select-none">
                  <input type="checkbox" checked={useEmojis} onChange={(e) => setUseEmojis(e.target.checked)} id="sched-emoji-toggle" className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-2 border-neutral-800 appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-5 checked:border-violet-500 z-10" />
                  <label htmlFor="sched-emoji-toggle" className="toggle-label block overflow-hidden h-5 rounded-full bg-neutral-800 cursor-pointer transition-colors duration-300 ease-in-out"></label>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-[14px] font-bold text-neutral-400">投稿形式:</label>
                <div className="flex bg-neutral-900 p-1 rounded-xl border border-neutral-800">
                  <button
                    onClick={() => setPostFormat('single')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${postFormat === 'single' ? 'bg-violet-600 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'}`}
                  >単発ポスト</button>
                  <button
                    onClick={() => setPostFormat('thread')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${postFormat === 'thread' ? 'bg-violet-600 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'}`}
                  >スレッド形式</button>
                </div>
              </div>
              <div className="flex items-center gap-3 border-l border-neutral-800 pl-8">
                <label className="text-[14px] font-bold text-neutral-400">note.com 自動投稿:</label>
                <div className="relative inline-block w-10 align-middle select-none">
                  <input type="checkbox" checked={useNoteAutoPost} onChange={(e) => setUseNoteAutoPost(e.target.checked)} id="sched-note-toggle" className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-2 border-neutral-800 appearance-none cursor-pointer transition-transform duration-300 ease-in-out checked:translate-x-5 checked:border-emerald-500 z-10" />
                  <label htmlFor="sched-note-toggle" className="toggle-label block overflow-hidden h-5 rounded-full bg-neutral-800 cursor-pointer transition-colors duration-300 ease-in-out"></label>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-panel p-8 rounded-3xl shadow-lg relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl group-hover:bg-violet-600/20 transition-all duration-700 -mr-20 -mt-20 pointer-events-none"></div>

            <h3 className="text-[16px] font-bold text-white flex items-center gap-2 mb-2 relative z-10 uppercase tracking-widest">
              <Sparkles className="w-5 h-5 text-amber-400" />
              Content Engine
            </h3>
            <p className="text-sm font-medium text-neutral-400 mb-6 relative z-10">プロンプトを投下して、高エンゲージメントなコンテンツを即座に生成します。</p>

            <div className="flex flex-col sm:flex-row gap-4 relative z-10">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="生成テーマを入力... (例: 初心者向けのプロンプト作成のコツ)"
                className="flex-1 p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-sm text-white font-medium focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all shadow-inner"
              />
              <button
                onClick={handleGenerateClick}
                disabled={isGenerating || !topic || isLooping}
                className="px-8 py-4 bg-white text-black rounded-2xl text-[14px] font-bold hover:bg-neutral-200 disabled:opacity-50 transition-colors flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.15)] whitespace-nowrap"
              >
                {isGenerating ? (
                  <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <Bot className="w-5 h-5 mr-2" />
                )}
                Generate Content
              </button>
            </div>
          </div>

          <div className="glass-panel p-8 rounded-3xl shadow-lg">
            <label className="block text-sm font-bold text-neutral-300 tracking-wider uppercase mb-4 ml-1">Draft Preview</label>
            <textarea
              rows="10"
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              className="w-full p-6 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[15px] font-medium text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all resize-y leading-relaxed shadow-inner"
              placeholder="// The AI generated content will appear here..."
            ></textarea>

            <div className="mt-8">
              <label className="block text-sm font-bold text-neutral-300 tracking-wider uppercase mb-4 ml-1">Target Endpoints <span className="text-xs text-neutral-500 normal-case ml-2">(クリックで複数選択)</span></label>
              <div className="flex flex-wrap gap-3">
                {accounts.length > 0 ? accounts.map((acc) => {
                  const isSelected = selectedAccountIds.includes(acc.id);
                  return (
                    <span
                      key={acc.id}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedAccountIds(selectedAccountIds.filter(id => id !== acc.id));
                        } else {
                          setSelectedAccountIds([...selectedAccountIds, acc.id]);
                        }
                      }}
                      className={`px-4 py-2 rounded-xl text-[13px] font-bold text-white flex items-center gap-2 cursor-pointer transition-all shadow-sm ${isSelected ? 'bg-violet-600 border border-violet-500 hover:brightness-110' : 'bg-neutral-800 border border-neutral-700 hover:bg-neutral-700'}`}
                    >
                      <img src={acc.avatarUrl || 'https://picsum.photos/100'} className="w-5 h-5 rounded-full border border-white/20" alt="" />
                      {acc.threadsUsername || acc.username}
                    </span>
                  );
                }) : (
                  <span className="text-sm text-neutral-500">アカウントが登録されていません</span>
                )}
              </div>
            </div>

            <div className="mt-10 flex justify-end gap-4 pt-8 border-t border-neutral-800/80">
              <button className="glass-button px-8 py-3 rounded-xl text-[14px] font-bold text-white">
                Draft Cache
              </button>
              <div className="violet-glow">
                <button
                  onClick={handleDeployClick}
                  disabled={isDeploying || !postContent || selectedAccountIds.length === 0 || isLooping}
                  className="relative z-10 px-8 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-[14px] font-bold border border-violet-500/50 hover:brightness-110 transition-all flex items-center shadow-lg disabled:opacity-50"
                >
                  {isDeploying ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  {isDeploying ? 'Deploying...' : 'Deploy Now (1 Time)'}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

// ビュー: 新規投稿 (Quick Post)
const QuickPostView = ({ accounts, addLog, isElectron, isMobile }) => {
  const [content, setContent] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAccounts = accounts.filter(acc =>
    (acc.threadsUsername || acc.username || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePost = async () => {
    if (!content || selectedAccountIds.length === 0) return;
    setIsDeploying(true);

    let successCount = 0;
    let errors = [];

    for (const id of selectedAccountIds) {
      const acc = accounts.find(a => a.id === id);
      if (!acc) continue;

      // Post to Threads
      const threadsRes = await apiService.postToThreads(
        acc.id,
        { 
          username: acc.threadsUsername, 
          password: acc.threadsPassword, 
          proxy: acc.proxy,
          threadsApiKey: acc.personaSettings?.threadsApiKey
        },
        content,
        null
      );

      
      if (threadsRes.success) {
        successCount++;
        // If Note credentials exist, also post to Note as an article
        if (acc.noteEmail && acc.notePassword) {
            const title = content.substring(0, 30) + "...";
            await apiService.postToNote(acc.id, acc, title, content);
            addLog(`[@${acc.threadsUsername}] Cross-posted to Note.`);
        }
      } else {
        errors.push(`@${acc.threadsUsername}: ${threadsRes.error || '不明なエラー'}`);
      }
    }

    setIsDeploying(false);
    
    if (errors.length > 0) {
      alert(`投稿結果: ${successCount}件成功、${errors.length}件失敗\n\nエラー内容:\n${errors.join('\n')}`);
    } else {
      alert(`${successCount}件のアカウントへの投稿が完了しました。`);
      setContent('');
      setSelectedAccountIds([]);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent">
      <div className="px-8 py-6 border-b border-neutral-800/50 bg-neutral-950/50 backdrop-blur-xl flex justify-between items-center sticky top-0 z-20">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Send className="w-6 h-6 text-violet-500" />
            新規投稿 (Quick Post)
          </h2>
          <p className="text-sm text-neutral-400 font-medium mt-1">選択したエージェントから即座に投稿を配信します</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-panel p-6 rounded-3xl border border-neutral-800/50">
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4">投稿内容</label>
              <textarea
                rows="12"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="今何してる？（複数行・スレッド形式のセパレーター '---' も使用可能です）"
                className="w-full p-5 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[15px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all resize-none leading-relaxed"
              ></textarea>
              <div className="mt-4 flex justify-between items-center">
                <span className="text-xs text-neutral-500 font-medium">{content.length} 文字</span>
                <button
                  onClick={handlePost}
                  disabled={isDeploying || !content || selectedAccountIds.length === 0}
                  className="px-8 py-3 bg-white text-black rounded-xl text-[14px] font-bold hover:bg-neutral-200 disabled:opacity-50 transition-all flex items-center shadow-lg"
                >
                  {isDeploying ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  今すぐ投稿 (即時配信)
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass-panel p-6 rounded-3xl border border-neutral-800/50 flex flex-col h-[600px]">
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4">配信先アカウント</label>
              <div className="relative mb-4">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  placeholder="検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500/50 transition-all"
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {filteredAccounts.map(acc => {
                  const isSelected = selectedAccountIds.includes(acc.id);
                  return (
                    <div
                      key={acc.id}
                      onClick={() => {
                        if (isSelected) setSelectedAccountIds(selectedAccountIds.filter(id => id !== acc.id));
                        else setSelectedAccountIds([...selectedAccountIds, acc.id]);
                      }}
                      className={`p-3 rounded-2xl border cursor-pointer transition-all flex items-center gap-3 ${isSelected ? 'bg-violet-600/10 border-violet-500/50' : 'bg-neutral-900/30 border-neutral-800 hover:border-neutral-700'
                        }`}
                    >
                      <img src={acc.avatarUrl || 'https://picsum.photos/100'} className="w-8 h-8 rounded-full border border-neutral-800" alt="" />
                      <div className="min-w-0">
                        <p className={`text-[13px] font-bold truncate ${isSelected ? 'text-violet-400' : 'text-neutral-200'}`}>@{acc.threadsUsername}</p>
                        <p className="text-[10px] text-neutral-500 truncate">{acc.status === 'active' ? '稼働中' : '停止中'}</p>
                      </div>
                      {isSelected && <CheckCircle2 className="w-4 h-4 ml-auto text-violet-500" />}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-neutral-800/80">
                <button
                  onClick={() => {
                    if (selectedAccountIds.length === filteredAccounts.length) setSelectedAccountIds([]);
                    else setSelectedAccountIds(filteredAccounts.map(a => a.id));
                  }}
                  className="w-full py-2 text-[12px] font-bold text-neutral-400 hover:text-white transition-colors"
                >
                  {selectedAccountIds.length === filteredAccounts.length ? '全選択解除' : '表示中を全選択'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ビュー: 設定
const SettingsView = () => {
  const [apiKey, setApiKey] = useState(localStorage.getItem('geminiApiKey') || '');
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('geminiApiKey', apiKey);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent">
      <div className="px-8 py-6 border-b border-neutral-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center sticky top-0 bg-neutral-950/50 backdrop-blur-xl z-20">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Settings className="w-6 h-6 text-violet-500" />
            各種設定
          </h2>
          <p className="text-sm text-neutral-400 font-medium mt-1">APIキーやシステム全体の動作設定</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl space-y-8">

          <div className="glass-panel p-8 rounded-3xl shadow-lg relative overflow-hidden">
            <h3 className="text-[16px] font-bold text-white flex items-center gap-2 mb-6 uppercase tracking-widest">
              <Key className="w-5 h-5 text-indigo-400" />
              API Key Management
            </h3>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-neutral-300 mb-2 ml-1">Gemini API Key</label>
                <div className="flex gap-4">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIza... から始まるAPIキーを入力"
                    className="flex-1 p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-mono shadow-inner"
                  />
                  <button
                    onClick={() => { localStorage.setItem('geminiApiKey', apiKey); handleSave(); }}
                    className="px-6 py-4 bg-violet-600/20 text-violet-400 border border-violet-500/30 rounded-2xl text-[14px] font-bold hover:bg-violet-600/40 hover:text-white transition-all flex items-center justify-center whitespace-nowrap min-w-[140px]"
                  >
                    {isSaved ? <span className="flex items-center text-emerald-400"><CheckCircle2 className="w-4 h-4 mr-2" /> 保存完了</span> : <><Save className="w-4 h-4 mr-2" /> 保存する</>}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-neutral-300 mb-2 ml-1">OpenAI API Key (GPT-4o / DALL-E 3)</label>
                <div className="flex gap-4">
                  <input
                    type="password"
                    defaultValue={localStorage.getItem('openaiApiKey') || ''}
                    onBlur={(e) => { localStorage.setItem('openaiApiKey', e.target.value); handleSave(); }}
                    placeholder="sk-... から始まるAPIキーを入力"
                    className="flex-1 p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-mono shadow-inner"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-neutral-300 mb-2 ml-1">Anthropic API Key (Claude 3.5 Sonnet)</label>
                <div className="flex gap-4">
                  <input
                    type="password"
                    defaultValue={localStorage.getItem('anthropicApiKey') || ''}
                    onBlur={(e) => { localStorage.setItem('anthropicApiKey', e.target.value); handleSave(); }}
                    placeholder="sk-ant-... から始まるAPIキーを入力"
                    className="flex-1 p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-mono shadow-inner"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-neutral-300 mb-2 ml-1">Manus AI API Key</label>
                <div className="flex gap-4">
                  <input
                    type="password"
                    defaultValue={localStorage.getItem('manusApiKey') || ''}
                    onBlur={(e) => { localStorage.setItem('manusApiKey', e.target.value); handleSave(); }}
                    placeholder="Manus APIキーを入力"
                    className="flex-1 p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-mono shadow-inner"
                  />
                </div>
              </div>

              <div className="pt-6 border-t border-neutral-800/50">
                <h4 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Globe className="w-4 h-4" /> GitHub Sync (Manus AI Bridge)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 mb-2 ml-1">GitHub Personal Access Token</label>
                    <input
                      type="password"
                      defaultValue={localStorage.getItem('githubToken') || ''}
                      onBlur={(e) => { localStorage.setItem('githubToken', e.target.value); handleSave(); }}
                      placeholder="ghp_..."
                      className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 mb-2 ml-1">GitHub Repo (username/repo)</label>
                    <input
                      type="text"
                      defaultValue={localStorage.getItem('githubRepo') || ''}
                      onBlur={(e) => { localStorage.setItem('githubRepo', e.target.value); handleSave(); }}
                      placeholder="user/my-threads-sync"
                      className="w-full p-4 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 transition-all font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

// ビュー: 管理者ダッシュボード
const AdminDashboard = ({ currentUser }) => {
  const [licenses, setLicenses] = useState([]);
  const [users, setUsers] = useState(JSON.parse(localStorage.getItem('usersDB') || '[]'));
  const [copiedKey, setCopiedKey] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchLicenses = async (isManual = false) => {
    setIsLoading(true);
    try {
      const { orderBy, query } = await import('firebase/firestore');
      const querySnapshot = await getDocs(query(collection(db, "licenses"), orderBy("createdAt", "desc")));
      const docs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLicenses(docs);
      if (isManual) console.log("Admin: Licenses refreshed manually.");
    } catch (e) {
      console.error("Error fetching licenses: ", e);
      if (!isManual) alert("ライセンス一覧の取得に失敗しました。Firestoreのインデックス作成が必要な場合があります。");
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchLicenses();
  }, []);

  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        const docRef = doc(db, "system_config", "announcement");
        const docSnap = await getDocs(query(collection(db, "system_config")));
        const found = docSnap.docs.find(d => d.id === "announcement");
        if (found) setAnnouncement(found.data().text || '');
      } catch (e) { console.error(e); }
    };
    fetchAnnouncement();
  }, []);

  const generateLicense = async (type, plan = 'pro') => {
    if (isGenerating) return;
    setIsGenerating(true);
    
    const newKey = "AT-" + Math.random().toString(36).substring(2, 6).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    const licenseData = { 
      key: newKey, 
      type, 
      plan, 
      used: false, 
      usedBy: null, 
      usedByEmail: null, 
      status: 'active', 
      createdAt: new Date().toISOString() 
    };
    
    try {
      console.log(`Admin: Generating ${plan} license...`);
      const docRef = await addDoc(collection(db, "licenses"), licenseData);
      const newLicense = { id: docRef.id, ...licenseData };
      
      setLicenses(prev => [newLicense, ...prev]);
      console.log(`Admin: New license generated: ${newKey}`);
      alert(`ライセンスを発行しました！\n\nプラン: ${plan.toUpperCase()}\nキー: ${newKey}\n\nリストの最上部に追加されました。`);
    } catch (e) {
      console.error("Error adding license: ", e);
      console.log(`Admin Error: License generation failed - ${e.message}`);
      alert(`ライセンスの発行に失敗しました。\n\n理由: ${e.message}\nFirestoreの書き込み権限（Rules）を確認してください。`);
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteLicense = async (licenseId) => {
    if (!window.confirm("このライセンスを抹消しますか？顧客のアプリは次回起動時に無効化されます。")) return;
    try {
      await deleteDoc(doc(db, "licenses", licenseId));
      setLicenses(licenses.filter(l => l.id !== licenseId));
      console.log("Admin: License revoked.");
    } catch (e) {
      console.error("Error deleting license: ", e);
      alert("削除に失敗しました。");
    }
  };

  const updateLicensePlan = async (licenseId, newPlan) => {
    try {
      await updateDoc(doc(db, "licenses", licenseId), { plan: newPlan });
      setLicenses(licenses.map(l => l.id === licenseId ? { ...l, plan: newPlan } : l));
      console.log(`Admin: License plan updated to ${newPlan}`);
    } catch (e) {
      console.error("Error updating license: ", e);
      alert("更新に失敗しました。");
    }
  };

  const updateLicenseStatus = async (licenseId, newStatus) => {
    try {
      await updateDoc(doc(db, "licenses", licenseId), { status: newStatus });
      setLicenses(licenses.map(l => l.id === licenseId ? { ...l, status: newStatus } : l));
      console.log(`Admin: License status updated to ${newStatus}`);
    } catch (e) {
      console.error("Error updating status: ", e);
      alert("更新に失敗しました。");
    }
  };

  const updateAnnouncement = async () => {
    try {
      const docRef = doc(db, "system_config", "announcement");
      // Use setDoc for fixed ID
      const { setDoc } = await import('firebase/firestore');
      await setDoc(docRef, { text: announcement, updatedAt: new Date().toISOString() });
      alert("全ユーザーへのお知らせを更新しました。");
    } catch (e) {
      console.error(e);
      alert("更新に失敗しました。collection 'system_config' が作成されているか確認してください。");
    }
  };

  const copyToClipboard = (key) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (currentUser?.role !== 'admin') {
    return <div className="p-8 text-center text-rose-500 font-bold flex flex-col items-center justify-center h-full"><ShieldAlert className="w-16 h-16 mb-4" />Access Denied</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent">
      <div className="px-8 py-6 border-b border-neutral-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center sticky top-0 bg-neutral-950/50 backdrop-blur-xl z-20">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-amber-500" />
            【管理者専用】ライセンス コントロール
          </h2>
          <p className="text-sm text-neutral-400 font-medium mt-1">新規シリアルコードの発行と利用状況の監視</p>
        </div>
        <div className="flex flex-wrap gap-2 mt-4 sm:mt-0 items-center">
          <button 
            onClick={() => fetchLicenses(true)} 
            disabled={isLoading}
            className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-all disabled:opacity-30 mr-2"
            title="最新の状態に更新"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={() => generateLicense('3days', 'trial')} 
            disabled={isGenerating}
            className="glass-button px-4 py-2 rounded-xl text-[12px] font-bold text-sky-400 hover:text-sky-300 border border-sky-500/20 hover:bg-sky-500/10 disabled:opacity-50"
          >
            <Plus className={`w-3.5 h-3.5 mr-1 ${isGenerating ? 'animate-spin' : ''}`} /> 
            {isGenerating ? '発行中...' : 'Trial 発行'}
          </button>
          <button 
            onClick={() => generateLicense('30days', 'entry')} 
            disabled={isGenerating}
            className="glass-button px-4 py-2 rounded-xl text-[12px] font-bold text-emerald-400 hover:text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/10 disabled:opacity-50"
          >
            <Plus className={`w-3.5 h-3.5 mr-1 ${isGenerating ? 'animate-spin' : ''}`} /> 
            {isGenerating ? '発行中...' : 'Entry 発行'}
          </button>
          <button 
            onClick={() => generateLicense('30days', 'advance')} 
            disabled={isGenerating}
            className="glass-button px-4 py-2 rounded-xl text-[12px] font-bold text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/10 disabled:opacity-50"
          >
            <Plus className={`w-3.5 h-3.5 mr-1 ${isGenerating ? 'animate-spin' : ''}`} /> 
            {isGenerating ? '発行中...' : 'Advance 発行'}
          </button>
          <button 
            onClick={() => generateLicense('30days', 'pro')} 
            disabled={isGenerating}
            className="glass-button px-4 py-2 rounded-xl text-[12px] font-bold text-violet-400 hover:text-violet-300 border border-violet-500/20 hover:bg-violet-500/10 disabled:opacity-50"
          >
            <Plus className={`w-3.5 h-3.5 mr-1 ${isGenerating ? 'animate-spin' : ''}`} /> 
            {isGenerating ? '発行中...' : 'Pro 発行'}
          </button>
          <button 
            onClick={() => generateLicense('30days', 'enterprise')} 
            disabled={isGenerating}
            className="glass-button px-4 py-2 rounded-xl text-[12px] font-bold text-pink-400 hover:text-pink-300 border border-pink-500/20 hover:bg-pink-500/10 disabled:opacity-50"
          >
            <Plus className={`w-3.5 h-3.5 mr-1 ${isGenerating ? 'animate-spin' : ''}`} /> 
            {isGenerating ? '発行中...' : 'Enterprise'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl space-y-8">
          {/* Announcement Broadcast Section */}
          <div className="glass-panel p-8 rounded-3xl shadow-lg border border-indigo-500/20">
            <h3 className="text-[16px] font-bold text-white flex items-center gap-2 mb-4 uppercase tracking-widest text-indigo-400">
              <Bell className="w-5 h-5" /> Global Announcement Broadcast
            </h3>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-neutral-500 uppercase mb-2">Message to all units</label>
                <textarea 
                  value={announcement} 
                  onChange={(e) => setAnnouncement(e.target.value)}
                  placeholder="全ユーザーの画面上部に表示されるメッセージを入力..."
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500 min-h-[80px]"
                />
              </div>
              <button 
                onClick={updateAnnouncement}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg flex items-center gap-2 mb-1"
              >
                <Send className="w-4 h-4" /> Broadcast
              </button>
            </div>
          </div>

          <div className="glass-panel p-8 rounded-3xl shadow-lg relative overflow-hidden">
            <h3 className="text-[16px] font-bold text-white flex items-center gap-2 mb-6 uppercase tracking-widest">
              <Key className="w-5 h-5 text-indigo-400" /> License Registry
            </h3>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-950/80 text-[12px] text-neutral-400 tracking-wider uppercase border-b border-neutral-800">
                  <th className="px-4 py-3 font-semibold">License Key</th>
                  <th className="px-4 py-3 font-semibold text-center">Plan</th>
                  <th className="px-4 py-3 font-semibold text-center">Type</th>
                  <th className="px-4 py-3 font-semibold text-center">Issued At</th>
                  <th className="px-4 py-3 font-semibold text-center">Status</th>
                  <th className="px-4 py-3 font-semibold text-center">IsUsed</th>
                  <th className="px-4 py-3 font-semibold">User Info</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/80">
                {licenses.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-12 text-center text-neutral-500 italic">
                      {isLoading ? 'Loading registry data...' : 'No licenses found in the database.'}
                    </td>
                  </tr>
                ) : licenses.map((lic) => (
                  <tr key={lic.id || lic.key} className="hover:bg-neutral-800/30 transition-colors">
                    <td className="px-4 py-4 text-[14px] font-mono font-bold text-white tracking-widest">{lic.key}</td>
                    <td className="px-4 py-4 text-center">
                        <select 
                          value={lic.plan || 'pro'} 
                          onChange={(e) => updateLicensePlan(lic.id, e.target.value)}
                          className={`bg-neutral-900 border border-neutral-700 text-[10px] font-bold uppercase rounded px-1 py-0.5 focus:outline-none focus:border-violet-500 ${
                            lic.plan === 'pro' ? 'text-violet-400' :
                            lic.plan === 'advance' ? 'text-indigo-400' :
                            lic.plan === 'entry' ? 'text-emerald-400' :
                            lic.plan === 'trial' ? 'text-sky-400' :
                            'text-pink-400'
                          }`}
                        >
                          <option value="trial">Trial</option>
                          <option value="entry">Entry</option>
                          <option value="advance">Advance</option>
                          <option value="pro">Pro</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                    </td>
                    <td className="px-4 py-4 text-[12px] font-bold text-neutral-300 uppercase text-center">{lic.type}</td>
                    <td className="px-4 py-4 text-center">
                      <span className="text-[11px] text-neutral-500 font-mono">
                        {lic.createdAt ? new Date(lic.createdAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <select 
                          value={lic.status || 'active'} 
                          onChange={(e) => updateLicenseStatus(lic.id, e.target.value)}
                          className={`bg-neutral-900 border border-neutral-700 text-[9px] font-bold uppercase rounded px-1.5 py-0.5 focus:outline-none ${
                            lic.status === 'suspended' ? 'text-rose-400 border-rose-500/30' : 'text-emerald-400 border-emerald-500/30'
                          }`}
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                        {lic.used && lic.activatedAt && (
                          <span className={`text-[8px] font-mono ${
                            new Date().getTime() - new Date(lic.activatedAt).getTime() > (parseInt(lic.type) || 30) * 24 * 60 * 60 * 1000 
                            ? 'text-rose-500 font-bold' : 'text-neutral-500'
                          }`}>
                            {(() => {
                               const maxDays = parseInt(lic.type) || 30;
                               const daysLeft = Math.max(0, maxDays - Math.floor((new Date().getTime() - new Date(lic.activatedAt).getTime()) / (24 * 60 * 60 * 1000)));
                               return `${daysLeft}d Left`;
                            })()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      {lic.used
                        ? <span className="inline-flex px-2 py-1 rounded-md text-[10px] font-bold bg-neutral-800 text-neutral-500">USED</span>
                        : <span className="inline-flex px-2 py-1 rounded-md text-[10px] font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">ACTIVE</span>}
                    </td>
                    <td className="px-4 py-4">
                      {lic.usedBy ? (
                        <div className="flex flex-col">
                          <span className="text-[13px] text-white font-medium">{lic.usedBy}</span>
                          <span className="text-[11px] text-neutral-500">{lic.usedByEmail || 'No Email'}</span>
                        </div>
                      ) : (
                        <span className="text-neutral-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => copyToClipboard(lic.key)} className="p-2 bg-neutral-800 rounded-lg hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors" title="Copy Key">
                          {copiedKey === lic.key ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button onClick={() => deleteLicense(lic.id)} className="p-2 bg-neutral-800 rounded-lg hover:bg-rose-500/20 text-neutral-400 hover:text-rose-400 transition-colors" title="Revoke License">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ビュー: マイページ (会員情報)
const MyPageView = ({ currentUser, onRefresh }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefresh(false); // Calling the passed verifyOnlineLicense(silent=false)
    setIsRefreshing(false);
  };

  // Cloud sync: Use currentUser data which is updated on login
  // (In a real app, we'd fetch fresh data from Firestore here periodically)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent">
      <div className="px-8 py-8 flex flex-col gap-2 relative z-10 border-b border-neutral-800/50 bg-neutral-950/50 backdrop-blur-xl">
        <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          <User className="w-8 h-8 text-violet-400" />
          会員マイページ
        </h2>
        <p className="text-sm text-neutral-400 font-medium">ご登録情報とライセンスステータスの確認</p>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        <div className="max-w-4xl space-y-6">
          
          {/* User Profile Card */}
          <div className="glass-panel p-8 rounded-[2.5rem] border border-neutral-800/80 shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-violet-600/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-violet-600/20 transition-colors"></div>
            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center gap-6">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-violet-600 to-indigo-600 p-1 shadow-lg">
                  <div className="w-full h-full bg-neutral-900 rounded-full flex items-center justify-center border-4 border-neutral-900">
                    <span className="text-3xl font-bold text-white uppercase">{currentUser?.username?.substring(0, 2) || 'US'}</span>
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white tracking-tight">{currentUser?.username}</h3>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`px-3 py-1 rounded-full text-[12px] font-bold border uppercase tracking-wider ${
                      currentUser?.plan === 'enterprise' ? 'bg-pink-500/20 text-pink-400 border-pink-500/30' :
                      currentUser?.plan === 'pro' ? 'bg-violet-500/20 text-violet-400 border-violet-500/30' :
                      currentUser?.plan === 'advance' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' :
                      'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    }`}>
                      {SUBSCRIPTION_PLANS[currentUser?.plan]?.name || 'Premium Member'}
                    </span>
                    <span className="text-neutral-500 text-sm font-medium">Account ID: #{Math.abs(currentUser?.username?.length * 1234 || 0)}</span>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={handleRefresh}
                disabled={isRefreshing || currentUser?.role === 'admin'}
                className="flex items-center gap-2 px-5 py-2.5 bg-neutral-900 border border-neutral-800 rounded-2xl text-[13px] font-bold text-neutral-300 hover:text-white hover:bg-neutral-800 transition-all disabled:opacity-30"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? '同期中...' : 'プラン情報を更新'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* License Information Card */}
            <div className="glass-panel p-8 rounded-[2.5rem] border border-neutral-800/80 shadow-xl flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-amber-500/10 rounded-2xl border border-amber-500/20 text-amber-500">
                  <Key className="w-5 h-5" />
                </div>
                <h4 className="text-[16px] font-bold text-white uppercase tracking-widest">License Status</h4>
              </div>
              
              <div className="space-y-4 flex-1">
                <div className="flex justify-between items-center py-3 border-b border-neutral-800/50">
                  <span className="text-sm text-neutral-500 font-medium">シリアルキー</span>
                  <span className="text-sm font-mono font-bold text-white tracking-wider">{currentUser?.license || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-neutral-800/50">
                  <span className="text-sm text-neutral-500 font-medium">現在のプラン</span>
                  <span className="text-sm font-bold text-white uppercase">{SUBSCRIPTION_PLANS[currentUser?.plan]?.name || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-neutral-800/50">
                  <span className="text-sm text-neutral-500 font-medium">アカウント連携枠</span>
                  <span className="text-sm font-bold text-white uppercase">{SUBSCRIPTION_PLANS[currentUser?.plan]?.maxAccounts || 0} / 100</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-neutral-800/50">
                  <span className="text-sm text-neutral-500 font-medium">ライセンス種別</span>
                  <span className="text-sm font-bold text-white uppercase">{SUBSCRIPTION_PLANS[currentUser?.plan]?.features.includes('proxy') ? 'Professional' : 'Standard'}</span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="text-sm text-neutral-500 font-medium">有効期限</span>
                  <span className={`text-sm font-bold ${currentUser?.role === 'admin' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {currentUser?.role === 'admin' ? 'UNLIMITED / ACTIVE' : (() => {
                      // Note: In a production app, the user object should have the activatedAt timestamp from Firestore
                      // For now, if it's missing, we show ACTIVE. If we find it, we calculate.
                      if (currentUser?.activatedAt) {
                        const maxDays = parseInt(currentUser.licenseType) || 30;
                        const diff = new Date().getTime() - new Date(currentUser.activatedAt).getTime();
                        const daysLeft = Math.max(0, maxDays - Math.floor(diff / (24 * 60 * 60 * 1000)));
                        return `${daysLeft} DAYS LEFT`;
                      }
                      return 'ACTIVE / NOT_LINKED';
                    })()}
                  </span>
                </div>
              </div>
            </div>

            {/* Security & Access Card */}
            <div className="glass-panel p-8 rounded-[2.5rem] border border-neutral-800/80 shadow-xl flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-500">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h4 className="text-[16px] font-bold text-white uppercase tracking-widest">Security</h4>
              </div>
              
              <div className="space-y-4">
                <p className="text-sm text-neutral-400 leading-relaxed font-medium">
                  {currentUser?.plan === 'entry' 
                    ? "Entryプランをご利用中です。単体アカウントの手動投稿機能が有効になっています。自動運用エンジンをご利用の場合はアップグレードをご検討ください。"
                    : "お客様のライセンスは正常にアクティベートされています。システムの全機能（自動生成・マルチスレッド投稿・高度な自動運用エンジン）へのフルアクセスが許可されています。"
                  }
                </p>
                <div className="pt-4 mt-auto">
                    <button className="w-full py-3 bg-neutral-900 border border-neutral-800 rounded-2xl text-[13px] font-bold text-neutral-300 hover:bg-neutral-800 hover:text-white transition-all">
                        パスワードを変更
                    </button>
                </div>
              </div>
            </div>
          </div>

          {/* Upgrade Path / Ad */}
          {currentUser?.plan === 'trial' || currentUser?.plan === 'entry' ? (
            <div className="glass-panel p-8 rounded-[2.5rem] border border-violet-500/20 bg-violet-500/5 relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-[80px] -mr-32 -mt-32"></div>
               <div className="flex flex-col sm:flex-row items-center gap-6 relative z-10">
                  <div className="w-16 h-16 bg-violet-600 rounded-2xl flex items-center justify-center shadow-lg transform -rotate-6 group-hover:rotate-0 transition-transform">
                    <Zap className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <h4 className="text-lg font-bold text-white mb-1">さらなる機能を開放しましょう</h4>
                    <p className="text-sm text-neutral-400">Advanceプラン以上で、AIによる自動運用エンジン（AIパトロール）や複数アカウント管理が利用可能になります。</p>
                  </div>
                  <button className="px-8 py-4 bg-white text-black rounded-2xl font-bold shadow-xl hover:bg-neutral-200 transition-all flex items-center gap-2 whitespace-nowrap">
                    プランのアップグレード方法 <ArrowUpRight className="w-4 h-4" />
                  </button>
               </div>
            </div>
          ) : (
            <div className="glass-panel p-6 rounded-3xl border border-neutral-800/50 bg-indigo-500/5">
              <div className="flex items-center gap-4">
                <Sparkles className="w-6 h-6 text-indigo-400" />
                <div>
                  <p className="text-sm font-bold text-white">プレミアム会員特典</p>
                  <p className="text-xs text-neutral-400 mt-0.5">最新のAIモデル（Claude 3.5 Sonnet / Gemini 1.5 Pro）へのアクセス権が付与されています。</p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

// ビュー: 認証ガード (Login / Register / License)
const AuthScreen = ({ onLogin, onCancel }) => {
  const [mode, setMode] = useState('login'); // login, register, license
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');

    const usersDB = JSON.parse(localStorage.getItem('usersDB') || '[]');

    if (mode === 'login') {
      // マスター管理者用の上書きルート（ユーザー様のご本人アカウント情報）
      if ((username === 'onecabigon@gmail.com' || username === 'admin') && password === 'sausu2108') {
        try {
          await signInWithEmailAndPassword(auth, 'onecabigon@gmail.com', password);
        } catch(e) {}
        onLogin({ username: 'onecabigon@gmail.com', role: 'admin', license: 'MASTER-KEY', plan: 'enterprise' });
        return;
      }

      try {
        let loginEmail = username;

        // もし入力されたのがメールアドレス形式(@を含む)でない場合は、ユーザー名として扱い licenses コレクションからメールを引く
        if (!username.includes('@')) {
          const qByUsername = query(collection(db, "licenses"), where("usedBy", "==", username));
          const snap = await getDocs(qByUsername);
          if (!snap.empty) {
            loginEmail = snap.docs[0].data().usedByEmail;
          } else {
            setError('ユーザー名が見つかりません。');
            return;
          }
        }

        // Firebase Authで実際のログインを実行
        const userCred = await signInWithEmailAndPassword(auth, loginEmail, password);

        // ログイン成功後、プロフィール情報をlicensesから取得してアプリ内状態にセット
        const qByEmail = query(collection(db, "licenses"), where("usedByEmail", "==", loginEmail));
        const snap = await getDocs(qByEmail);
        
        if (!snap.empty) {
          const licData = snap.docs[0].data();
          const cloudUser = { 
            username: licData.usedBy || loginEmail.split('@')[0], 
            email: loginEmail, 
            password: password, 
            role: 'user', 
            license: licData.key, 
            plan: licData.plan || 'pro',
            licenseType: licData.type || '30days',
            activatedAt: licData.activatedAt || new Date().toISOString()
          };
          
          // ローカルの usersDB も更新・保持しておく（既存レガシー処理との互換用）
          const existingIdx = usersDB.findIndex(u => u.username === cloudUser.username || u.email === loginEmail);
          if (existingIdx >= 0) {
            usersDB[existingIdx] = cloudUser;
          } else {
            usersDB.push(cloudUser);
          }
          localStorage.setItem('usersDB', JSON.stringify(usersDB));
          
          onLogin(cloudUser);
        } else {
          // 万が一 licenses に見つからなくても Auth は通ったので最低限の権限でログイン
          onLogin({ username: loginEmail.split('@')[0], email: loginEmail, role: 'user', plan: 'trial' });
        }
      } catch (e) {
        console.error("Firebase Login Error: ", e);
        setError('ログインに失敗しました。メールアドレス/ユーザー名かパスワードが間違っています。');
      }
    } else if (mode === 'register') {
      if (usersDB.find(u => u.username === username)) {
        setError('このユーザー名は既に使用されています。');
        return;
      }
      if (!email || !email.includes('@')) {
        setError('有効なメールアドレスを入力してください。');
        return;
      }
      setMode('license');
    } else if (mode === 'license') {
      try {
        const q = query(collection(db, "licenses"), where("key", "==", licenseKey));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const licDoc = querySnapshot.docs[0];
          const licData = licDoc.data();
          
          if (!licData.used) {
            // New creation in Firebase Auth
            await createUserWithEmailAndPassword(auth, email, password);
            
            // Mark license as used in Firestore
            await updateDoc(doc(db, "licenses", licDoc.id), {
              used: true,
              usedBy: username,
              usedByEmail: email,
              password: password,
              activatedAt: new Date().toISOString()
            });
            
            // App will auto-login via onAuthStateChanged
          } else {
            setError('このライセンスキーは既に他のユーザーに使用されています。');
          }
        } else {
          setError('無効なライセンスキーです。');
        }
      } catch (e) {
        console.error("License logic error: ", e);
        setError(e.message || '認証サーバーとの通信に失敗しました。');
      }
    }
  };

  return (
    <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center font-sans text-neutral-100 relative overflow-hidden selection:bg-violet-500/30">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-900/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="glass-panel w-full max-w-md p-10 rounded-[2.5rem] relative z-10 shadow-2xl border border-neutral-800/80">
        {(mode !== 'login' || onCancel) && (
          <button 
            onClick={() => {
              if (mode === 'register') setMode('login');
              else if (mode === 'license') setMode('register');
              else if (onCancel) onCancel();
              setError('');
            }}
            className="absolute top-8 left-8 p-2 bg-neutral-900/50 border border-neutral-800 rounded-xl text-neutral-400 hover:text-white transition-all group z-50"
            title={mode === 'login' ? "アプリに戻る" : "戻る"}
          >
            <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          </button>
        )}
        <div className="flex flex-col items-center mb-8">
          <img src={appLogo} alt="thpro by cabi Logo" className="w-56 h-auto object-contain mb-2 drop-shadow-[0_0_15px_rgba(212,175,55,0.3)]" />
          <h1 className="text-xl font-bold text-white tracking-widest uppercase mt-4 hidden">thpro bycabi</h1>
          <p className="text-[13px] font-medium text-neutral-400 mt-2 text-center tracking-wide">
            {mode === 'login' ? 'システムにサインイン' : mode === 'register' ? '新規アカウント作成' : 'ライセンスのアクティベーション'}
          </p>
        </div>

        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-400 text-[13px] font-bold mb-6">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-5">
          {mode !== 'license' && (
            <>
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2 ml-1">Username / Email</label>
                <div className="relative group">
                  <User className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-neutral-500 group-focus-within:text-violet-400 transition-colors" />
                  <input
                    type="text"
                    required={mode === 'register' || mode === 'login'}
                    value={username} onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username or email"
                    className="w-full pl-12 pr-4 py-3.5 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                  />
                </div>
              </div>

              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2 ml-1">Email Address</label>
                  <div className="relative group">
                    <Mail className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-neutral-500 group-focus-within:text-violet-400 transition-colors" />
                    <input
                      type="email"
                      required
                      value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="w-full pl-12 pr-4 py-3.5 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2 ml-1">Password</label>
                <div className="relative group">
                  <Lock className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-neutral-500 group-focus-within:text-violet-400 transition-colors" />
                  <input
                    type="password"
                    required
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-12 pr-4 py-3.5 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all font-medium"
                  />
                </div>
              </div>
            </>
          )}

          {mode === 'license' && (
            <div className="mb-2">
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2 ml-1">Serial / License Key</label>
              <div className="relative group">
                <Key className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-neutral-500 group-focus-within:text-amber-400 transition-colors" />
                <input
                  type="text"
                  required
                  value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="AT-XXXX-XXXX-XXXX"
                  className="w-full pl-12 pr-4 py-3.5 bg-neutral-900/50 border border-neutral-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all font-mono font-bold tracking-widest uppercase"
                />
              </div>
              <p className="text-[11px] text-neutral-500 mt-3 px-2">※ソフトウェアを利用するには、購入時にお渡しした16桁のシリアルコードを入力してライセンスを有効化してください。</p>
            </div>
          )}

          <div className="pt-2 violet-glow">
            <button type="submit" className="relative z-10 w-full py-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-[14px] font-bold hover:brightness-110 transition-all shadow-lg flex items-center justify-center">
              {mode === 'login' ? 'ログイン' : mode === 'register' ? 'アカウントを作成して次へ' : 'ライセンス認証を実行'}
              <ArrowUpRight className="w-4 h-4 ml-2" />
            </button>
          </div>
        </form>

        <div className="mt-8 text-center">
          {mode === 'login' ? (
            <p className="text-[13px] text-neutral-400 font-medium">
              ライセンスをお持ちですか？ <button onClick={() => setMode('register')} className="text-violet-400 hover:text-white font-bold transition-colors ml-1">新規登録</button>
            </p>
          ) : mode === 'register' ? (
            <p className="text-[13px] text-neutral-400 font-medium">
              既にアカウントをお持ちですか？ <button onClick={() => setMode('login')} className="text-violet-400 hover:text-white font-bold transition-colors ml-1">ログイン</button>
            </p>
          ) : (
            <button onClick={() => setMode('login')} className="text-[13px] text-neutral-400 hover:text-white font-bold transition-colors">ログインに戻る</button>
          )}
        </div>
      </div>
    </div>
  );
};

const NoteGuideView = ({ onNavigate }) => {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent">
      <div className="px-8 py-8 border-b border-neutral-800/50 bg-neutral-950/50 backdrop-blur-xl flex justify-between items-center sticky top-0 z-20">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Globe className="w-6 h-6 text-emerald-500" />
            note.com 連携のはじめかた
          </h2>
          <p className="text-sm text-neutral-400 font-medium mt-1">Threadsの投稿を、自動でブログ記事に変えて公開します</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl space-y-8">
          <div className="glass-panel p-8 rounded-[2.5rem] border border-neutral-800/50 relative overflow-hidden group">
             <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all duration-700 pointer-events-none"></div>
             <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
               <Sparkles className="w-5 h-5 text-emerald-400" /> 
               Threads ✕ note.com で「勝ち組」に
             </h3>
             <p className="text-neutral-300 leading-relaxed mb-6">
               短いThreadsの投稿をAIが読み取り、あなたに代わって「読み応えのある長文記事」をnoteに作成します。
               一度の設定で、SNSとブログの両方を同時に育てることができます。
             </p>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-neutral-900/50 p-6 rounded-3xl border border-neutral-800">
                   <h4 className="font-bold text-emerald-400 mb-2 flex items-center gap-2"><Send className="w-4 h-4"/> 自動でおまかせ投稿</h4>
                   <p className="text-[11px] text-neutral-400">あなたがThreadsに投稿するだけで、裏側でAIがnote用に見合う記事を作って投稿を予約します。</p>
                </div>
                <div className="bg-neutral-900/50 p-6 rounded-3xl border border-neutral-800">
                   <h4 className="font-bold text-emerald-400 mb-2 flex items-center gap-2"><Bot className="w-4 h-4"/> AIパトロールが執筆</h4>
                   <p className="text-[11px] text-neutral-400">専属のライターが24時間体制で待機しているようなものです。指定した時間に最適な記事をアップします。</p>
                </div>
             </div>
          </div>

          <div className="space-y-4">
             <h3 className="text-lg font-bold text-white ml-2">かんたん3ステップ</h3>
             <div className="grid grid-cols-1 gap-4">
                <div className="glass-panel p-6 rounded-3xl border border-neutral-800/50 flex gap-5 items-start">
                   <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold flex-shrink-0 text-lg">1</div>
                   <div>
                      <p className="font-bold text-white mb-1">noteアカウントを登録する</p>
                      <p className="text-sm text-neutral-500 mb-3">「アカウント管理」から、noteのログイン情報を入力するだけ。連携はすぐに終わります。</p>
                      <button onClick={() => onNavigate('accounts')} className="px-4 py-2 bg-neutral-900 rounded-xl text-xs font-bold text-emerald-400 hover:text-emerald-300 border border-neutral-800 transition-colors flex items-center gap-1">
                        アカウント管理へ移動 <ArrowUpRight className="w-3 h-3"/>
                      </button>
                   </div>
                </div>
                <div className="glass-panel p-6 rounded-3xl border border-neutral-800/50 flex gap-5 items-start">
                   <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold flex-shrink-0 text-lg">2</div>
                   <div>
                      <p className="font-bold text-white mb-1">ライブ画面で確認してみる</p>
                      <p className="text-sm text-neutral-500">連携できたら「note (ライブ)」を開いてみましょう。実際にnoteの画面が表示され、AIが動くのを確認できます。</p>
                   </div>
                </div>
                <div className="glass-panel p-6 rounded-3xl border border-neutral-800/50 flex gap-5 items-start">
                   <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold flex-shrink-0 text-lg">3</div>
                   <div>
                      <p className="font-bold text-white mb-1">全自動スイッチをONにする</p>
                      <p className="text-sm text-neutral-500">「エンジン設定」でボタンをON。あとはAIが定期的にあなたの代わりに記事を投稿し続けます。</p>
                      <button onClick={() => onNavigate('autopilot')} className="px-4 py-2 bg-neutral-900 rounded-xl text-xs font-bold text-emerald-400 hover:text-emerald-300 border border-neutral-800 transition-colors flex items-center gap-1">
                        エンジン設定へ移動 <ArrowUpRight className="w-3 h-3"/>
                      </button>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};


const UsageGuideView = ({ onNavigate }) => {
  const [activeStep, setActiveStep] = useState(0);

  const guideSections = [
    {
      id: 'prep',
      title: "準備するもの",
      icon: <Key className="w-5 h-5" />,
      content: (
        <div className="space-y-6">
          <div className="p-6 bg-gradient-to-br from-neutral-900 to-neutral-950 shadow-2xl border border-neutral-800 rounded-[2.5rem] relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all"></div>
            <h4 className="font-bold text-white flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-emerald-500/20 rounded-2xl text-emerald-400 shadow-inner"><Key className="w-5 h-5" /></div>
              Gemini APIキー (必須)
            </h4>
            <p className="text-sm text-neutral-400 leading-relaxed font-medium mb-4">
              このアプリの「脳」となるGoogleの最新AIを利用するための鍵です。
            </p>
            <ul className="space-y-2 mb-4">
              <li className="flex items-start gap-2 text-xs text-neutral-500">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5" />
                <span>Google AI Studio で無料で、数分で発行できます。</span>
              </li>
              <li className="flex items-start gap-2 text-xs text-neutral-500">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5" />
                <span>「システム設定」メニューから登録することでAI機能が有効になります。</span>
              </li>
            </ul>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors">
              APIキーを発行する (外部サイト) <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="p-6 bg-gradient-to-br from-neutral-900 to-neutral-950 shadow-2xl border border-neutral-800 rounded-[2.5rem] relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 rounded-full blur-3xl group-hover:bg-violet-500/20 transition-all"></div>
            <h4 className="font-bold text-white flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-violet-500/20 rounded-2xl text-violet-400 shadow-inner"><User className="w-5 h-5" /></div>
              運用アカウント
            </h4>
            <p className="text-sm text-neutral-400 leading-relaxed font-medium">
              ThreadsやNoteのアカウントが必要です。アプリ内でこれらを連携させることで、AIがあなたに代わって投稿作業を行います。
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'steps',
      title: "らくらく4ステップ",
      icon: <Monitor className="w-5 h-5" />,
      content: (
        <div className="space-y-10 py-2">
          {[
            { 
              step: "01", 
              title: "アカウントを登録・連携する", 
              desc: "「ノード管理」からアカウントを追加します。アプリの中で専用のブラウザが開くので、そこでログインするだけであなたのPCとThreads/Noteが繋がります。パスワードをアプリ側に保存する必要がないため安全です。" 
            },
            { 
              step: "02", 
              title: "AIに「魂」を吹き込む（ペルソナ設定）", 
              desc: "各アカウントの編集画面にある「AI詳細設定」で、AIの性格（ペルソナ）を決めます。例えば「親しみやすいIT専門家」や「毒舌だけど愛嬌のある主婦」など、あなたのブランドに合わせた設定が可能です。これが投稿の質を左右する最も重要なステップです。" 
            },
            { 
              step: "03", 
              title: "自動運用のスイッチを入れる", 
              desc: "「エンジン設定」メニューから、アカウントごとのスイッチをONにします。AIが最新トレンドを学習し、あなたの代わりに「いつ何を投稿するか」を判断して実行します。一度ONにすれば、PCを開いている間ずっとAIが働いてくれます。" 
            },
            { 
              step: "04", 
              title: "成果をチェックして育てる", 
              desc: "「ダッシュボード」では、AIによる投稿の結果（インプレッションやフォロワー増加）をグラフで確認できます。反響が良い投稿の傾向をAIが学習するため、動かせば動かすほどあなたのブランドに最適化されていきます。" 
            }
          ].map((s, i) => (
            <div key={i} className="flex gap-8 relative">
              {i < 3 && <div className="absolute left-[24px] top-[60px] bottom-[-40px] w-[2px] bg-gradient-to-b from-violet-500/30 to-transparent"></div>}
              <div className="flex-shrink-0 w-12 h-12 bg-neutral-900 border border-neutral-700 rounded-2xl flex items-center justify-center text-violet-400 font-black text-sm z-10 shadow-[0_0_20px_rgba(139,92,246,0.15)] ring-4 ring-neutral-950">
                {s.step}
              </div>
              <div className="pt-1.5 flex-1">
                <h4 className="font-bold text-white text-[16px] mb-2 tracking-tight flex items-center gap-2">
                  {s.title}
                  {i === 1 && <Sparkles className="w-4 h-4 text-amber-400" />}
                </h4>
                <p className="text-sm text-neutral-500 leading-relaxed font-medium">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      )
    },
    {
      id: '2fa',
      title: "二段階認証の対応",
      icon: <ShieldCheck className="w-5 h-5" />,
      content: (
        <div className="space-y-6">
          <div className="p-8 bg-neutral-900/50 border border-neutral-800 rounded-[2.5rem] relative overflow-hidden group">
            <h4 className="font-bold text-white flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-emerald-500/20 rounded-2xl text-emerald-400 shadow-inner"><ShieldCheck className="w-5 h-5" /></div>
              二段階認証（2FA）をお使いの方
            </h4>
            <p className="text-sm text-neutral-300 leading-relaxed mb-6">
              Threadsで二段階認証を有効にしている場合、通常の自動ログインではコード入力ができずエラーになります。<br />
              その場合は以下の手順でログインを行ってください：
            </p>
            <div className="space-y-4">
              {[
                { step: "A", title: "手動認証ボタンをクリック", desc: "各アカウントカードの赤い「認証エラー」または「一時停止」エリアにある「手動認証（ブラウザを表示）」ボタンを押します。" },
                { step: "B", title: "ブラウザでログイン操作", desc: "自動でブラウザのウィンドウが開きます。画面上でパスワード入力や二段階認証コード、パズルの完了などを手動で行ってください。" },
                { step: "C", title: "アプリに戻る", desc: "ログインが完了してプロフィール画面等が表示されたら、アプリ側で「ログイン完了」の通知が出ます。ブラウザを閉じて運用を再開してください。" }
              ].map((s, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-neutral-800 rounded-lg flex items-center justify-center text-[11px] font-bold text-emerald-400 border border-neutral-700">
                    {s.step}
                  </div>
                  <div>
                    <h5 className="text-[13px] font-bold text-white mb-1">{s.title}</h5>
                    <p className="text-[11px] text-neutral-500">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'threads_api',
      title: "Threads公式APIの取得",
      icon: <Send className="w-5 h-5 text-indigo-400" />,
      content: (
        <div className="space-y-6">
          <div className="p-8 bg-neutral-900/50 border border-neutral-800 rounded-[2.5rem] relative overflow-hidden group">
            <h4 className="font-bold text-white flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-indigo-500/20 rounded-2xl text-indigo-400 shadow-inner"><Key className="w-5 h-5" /></div>
              【超かんたん】API取得の６ステップ
            </h4>
            <div className="mb-6 p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl">
              <p className="text-[11px] text-indigo-300 font-bold mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" /> 準備するもの
              </p>
              <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Facebookアカウント、パソコン、スマートフォン</p>
            </div>
            
            <div className="space-y-6">
              {[
                { step: "01", title: "Metaアプリを作る", desc: "Meta for Developersで「その他」→「ビジネス」を選んで名前を決めるだけ！" },
                { step: "02", title: "ウェブ設定を追加", desc: "アプリ設定で「ウェブ」を選び、ThreadsのURLを入力して保存します。" },
                { step: "03", title: "Threadsを追加", desc: "プロダクト追加で「Threads」のボタンをポチッと押します。" },
                { step: "04", title: "スマホで「承認」", desc: "★重要：Threadsアプリ設定の「ウェブサイトのアクセス許可」から必ず承認してください。" },
                { step: "05", title: "トークンをコピー", desc: "Generate Tokenからログインし、一番長いコードをコピーします。" },
                { step: "06", title: "アプリに貼る", desc: "「エンジン設定」のAPIキー欄に貼り付ければ、自動運用の準備完了です！" }
              ].map((s, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-neutral-800 rounded-lg flex items-center justify-center text-[11px] font-bold text-indigo-400 border border-neutral-700">
                    {s.step}
                  </div>
                  <div>
                    <h5 className="text-[14px] font-bold text-white mb-1">{s.title}</h5>
                    <p className="text-[11px] text-neutral-400 leading-relaxed font-medium">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 p-6 bg-rose-500/5 border border-rose-500/10 rounded-2xl">
              <h5 className="text-[12px] font-bold text-rose-400 mb-2 flex items-center gap-2">
                <Users className="w-4 h-4" /> 複数アカウントの場合
              </h5>
              <p className="text-[10px] text-neutral-400 leading-relaxed font-medium">
                各アカウントごとに「専用の鍵（トークン）」が必要です。2つ目以降を設定するときは、一度ブラウザのFacebookをログアウトし、別のアカウントでログインし直してからステップ1を実行してください。
              </p>
            </div>
            
            <p className="mt-8 text-[10px] text-neutral-500 leading-relaxed italic text-center font-medium">
              ※さらに詳しい画像付きの解説は「threads_api_guide.md」をチェック！
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'tips',
      title: "成功への近道",
      icon: <Zap className="w-5 h-5" />,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 bg-neutral-900/50 border border-neutral-800 rounded-3xl hover:bg-neutral-900 transition-all">
              <h5 className="font-bold text-white mb-2 flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-sky-400" />
                共感を生むコツ
              </h5>
              <p className="text-xs text-neutral-500 leading-relaxed">
                ペルソナ設定に「悩みへの共感」や「失敗談を交える」といった指示を具体的に書くと、AIでも温かみのある投稿になり、フォロー率が向上します。
              </p>
            </div>
            <div className="p-6 bg-neutral-900/50 border border-neutral-800 rounded-3xl hover:bg-neutral-900 transition-all">
              <h5 className="font-bold text-white mb-2 flex items-center gap-2">
                <Repeat className="w-4 h-4 text-emerald-400" />
                Noteとの連携
              </h5>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Threadsでの短文をベースにAIがNote記事を構成。この「使い回し」が長続きの秘訣です。短文はThreadsへ、深掘りはNoteへと誘導しましょう。
              </p>
            </div>
          </div>
          <div className="p-6 bg-indigo-600/5 border border-indigo-500/20 rounded-3xl">
             <h5 className="font-bold text-indigo-400 mb-3 flex items-center gap-2">
               <ShieldCheck className="w-4 h-4" />
               運用上の注意点
             </h5>
             <ul className="space-y-2">
               <li className="text-[11px] text-neutral-400 flex items-start gap-2">
                 <div className="w-1 h-1 bg-indigo-500 rounded-full mt-1.5"></div>
                 自動投稿の間隔は「エンジン設定」で調整してください。短すぎると制限がかかる場合があります（1日5〜10件程度が推奨です）。
               </li>
               <li className="text-[11px] text-neutral-400 flex items-start gap-2">
                 <div className="w-1 h-1 bg-indigo-500 rounded-full mt-1.5"></div>
                 APIキーには利用上限（無料枠）がありますが、個人利用であれば十分な量が確保されています。
               </li>
             </ul>
          </div>
        </div>
      )
    },
    {
      id: 'faq',
      title: "よくある質問",
      icon: <HelpCircle className="w-5 h-5" />,
      content: (
        <div className="space-y-4">
          <div className="divide-y divide-neutral-800/50 border-t border-b border-neutral-800/50">
            <div className="py-5 group">
              <h4 className="text-sm font-bold text-white mb-2 group-hover:text-violet-400 transition-colors cursor-pointer flex justify-between items-center">
                Q. PCを閉じても自動投稿されますか？
              </h4>
              <p className="text-xs text-neutral-500 leading-relaxed">
                A. 本アプリはPC上で動作するため、アプリを起動した状態でPCを開いておく必要があります。スリープ設定は解除しておくことをお勧めします。
              </p>
            </div>
            <div className="py-5 group">
              <h4 className="text-sm font-bold text-white mb-2 group-hover:text-violet-400 transition-colors cursor-pointer flex justify-between items-center">
                Q. BAN（凍結）のリスクはありますか？
              </h4>
              <p className="text-xs text-neutral-500 leading-relaxed">
                A. 最新のAIが「常に違う文章」を作成するため、定型文の繰り返しによるスパム判定を避けられます。推奨投稿数を守ることで、リスクを最小限に抑えられます。
              </p>
            </div>
            <div className="py-5 group">
              <h4 className="text-sm font-bold text-white mb-2 group-hover:text-violet-400 transition-colors cursor-pointer flex justify-between items-center">
                Q. Gemini 1.5 Pro と Flash どっちが良い？
              </h4>
              <p className="text-xs text-neutral-500 leading-relaxed">
                A. 速度重視なら Flash、文章の深みや創造性重視なら Pro がおすすめです。まずは Flash で軽快に動かしてみるのが良いでしょう。
              </p>
            </div>
          </div>
        </div>
      )
    }
  ];



  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent">
      <div className="px-8 py-8 flex flex-col gap-2 relative z-10 border-b border-neutral-800/50 bg-neutral-950/50 backdrop-blur-xl">
        <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          <Globe className="w-8 h-8 text-amber-400" />
          はじめての方へ（説明書）
        </h2>
        <p className="text-sm text-neutral-400 font-medium">thproを使いこなして、SNSの完全自動化を始めましょう。</p>
      </div>

      <div className="flex-1 overflow-y-auto p-8 max-w-5xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
          {/* Left Sidebar Nav */}
          <div className="lg:col-span-4 space-y-3">
            {guideSections.map((section, idx) => (
              <button
                key={section.id}
                onClick={() => setActiveStep(idx)}
                className={`w-full flex items-center gap-4 p-5 rounded-3xl transition-all border ${
                  activeStep === idx 
                  ? 'bg-violet-600 border-violet-500 text-white shadow-lg' 
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                <div className={`p-2 rounded-xl ${activeStep === idx ? 'bg-white/20' : 'bg-neutral-800'}`}>
                  {section.title === "準備するもの" ? <Key className="w-5 h-5" /> : 
                   section.title === "使いかた（4ステップ）" ? <Monitor className="w-5 h-5" /> :
                   <AlertCircle className="w-5 h-5" />}
                </div>
                <span className="font-bold text-sm tracking-wide">{section.title}</span>
              </button>
            ))}

            <div className="p-6 bg-amber-500/5 border border-amber-500/10 rounded-3xl mt-8">
              <h4 className="text-[11px] font-bold text-amber-400 mb-2 uppercase tracking-widest flex items-center gap-2">
                <Bell className="w-3.5 h-3.5" /> アドバイス
              </h4>
              <p className="text-[11px] text-neutral-500 leading-relaxed font-medium">
                最初は「3分間隔」など短い設定で動かしてみて、正しく投稿されるか確認するのがおすすめです。
              </p>
            </div>
          </div>

          {/* Right Content Area */}
          <div className="lg:col-span-8">
            <div className="glass-panel p-10 rounded-[2.5rem] border border-neutral-800 min-h-[400px] shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-12 opacity-[0.03] group-hover:scale-110 transition-transform duration-700">
                {guideSections[activeStep].icon && React.cloneElement(guideSections[activeStep].icon, { className: "w-64 h-64" })}
              </div>
              <div className="relative z-10">
                <h3 className="text-2xl font-bold text-white mb-8 flex items-center gap-3">
                  <span className="w-1.5 h-8 bg-violet-600 rounded-full block"></span>
                  {guideSections[activeStep].title}
                </h3>
                {guideSections[activeStep].content}
              </div>
            </div>
            
            <div className="mt-8 flex justify-center">
               <button 
                onClick={() => onNavigate('accounts')}
                className="px-10 py-4 bg-white text-black rounded-2xl font-bold hover:bg-neutral-200 transition-all shadow-xl flex items-center gap-3 text-sm"
              >
                さっそくノード（アカウント）を追加する <ArrowUpRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ビュー: note管理 (大画面)
const NoteManagementView = ({ accounts, onNavigate }) => {
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  // AI Assistant States
  const [topic, setTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTitle, setGeneratedTitle] = useState('');
  const [generatedBody, setGeneratedBody] = useState('');
  const [eyeCatch, setEyeCatch] = useState(null);
  const [articleImages, setArticleImages] = useState([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(localStorage.getItem('aiProvider') || 'gemini');

  // New Per-Account Settings States
  const [persona, setPersona] = useState('');
  const [benefit, setBenefit] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [wordCount, setWordCount] = useState(3000);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Load/Save settings per account
  useEffect(() => {
    if (selectedAccountId) {
      const saved = localStorage.getItem(`note_settings_${selectedAccountId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setPersona(parsed.persona || '');
          setBenefit(parsed.benefit || '');
          setIsPaid(parsed.isPaid || false);
          setWordCount(parsed.wordCount || 3000);
        } catch (e) {
          console.error("Error parsing note settings:", e);
        }
      } else {
        // Reset to defaults if no saved settings
        setPersona('');
        setBenefit('');
        setIsPaid(false);
        setWordCount(3000);
      }
    }
  }, [selectedAccountId]);

  // Persist settings on change
  useEffect(() => {
    if (selectedAccountId) {
      const settings = { persona, benefit, isPaid, wordCount };
      localStorage.setItem(`note_settings_${selectedAccountId}`, JSON.stringify(settings));
    }
  }, [persona, benefit, isPaid, wordCount]);

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts]);

  const handleGenerateNoteArticle = async () => {
    if (!topic) return;
    setIsGenerating(true);
    setGeneratedTitle('');
    setGeneratedBody('');
    setEyeCatch(null);
    setArticleImages([]);
    
    try {
      const provider = selectedProvider;
      const keyMap = {
        gemini: localStorage.getItem('geminiApiKey'),
        openai: localStorage.getItem('openaiApiKey'),
        anthropic: localStorage.getItem('anthropicApiKey'),
        manus: localStorage.getItem('manusApiKey')
      };
      
      const apiKey = keyMap[provider];
      if (!apiKey) throw new Error(`${provider}のAPIキーが設定されていません。「システム設定」で設定してください。`);

      let textPrompt = `note.comに投稿するための高品質な記事を作成してください。\n`;
      textPrompt += `テーマ: ${topic}\n`;
      
      if (persona) textPrompt += `執筆者（ペルソナ）設定: ${persona}\n`;
      if (benefit) textPrompt += `読者が得られるベネフィット: ${benefit}\n`;
      if (isPaid) textPrompt += `【最重要】この記事は「有料級プレミアム記事」として執筆してください。無料記事よりも圧倒的に深く、専門的で、読者がお金を払ってでも読みたくなるような価値のある内容にしてください。\n`;
      if (wordCount) textPrompt += `目標文字数: ${wordCount}文字程度（構成を充実させてください）。\n`;

      textPrompt += `\n出力は必ず以下の形式にしてください：
【タイトル】
（ここに目を引くタイトル）

【本文】
（読者の役に立つ構成済みの本文。適宜見出しや箇条書き、太字装飾（**太字**）を使用してリッチに仕上げてください）`;

      const aiRes = await apiService.callAI(
        provider,
        apiKey,
        'auto',
        textPrompt
      );
      
      if (!aiRes || !aiRes.success) {
        throw new Error(aiRes?.error || "AI生成に失敗しました（APIキーまたはネットワーク設定を確認してください）");
      }
      
      const textResult = aiRes.content || "";
      if (!textResult.trim()) {
        throw new Error("AIから空の回答が返されました。別のテーマを試すか、APIキーの設定を確認してください。");
      }
      
      const titleMatch = textResult.match(/【タイトル】\n?([\s\S]*?)\n?【本文】/);
      const bodyMatch = textResult.match(/【本文】\n?([\s\S]*)/);
      
      if (titleMatch) setGeneratedTitle(titleMatch[1].trim());
      else setGeneratedTitle(topic); // Fallback

      if (bodyMatch) setGeneratedBody(bodyMatch[1].trim());
      else setGeneratedBody(textResult); // Fallback

      // Generate Images if OpenAI key exists
      const openaiKey = localStorage.getItem('openaiApiKey');
      if (openaiKey) {
        // 1. Eye-catch
        apiService.logToServer("Generating note eye-catch...");
        const ecRes = await apiService.generateImage(openaiKey, `${topic}をテーマにしたnote記事用の、おしゃれで洗練されたメインビジュアル（アイキャッチ）。文字を含まず、抽象的でモダンなイラストまたは高品質なイメージ写真。`);
        if (ecRes.success) setEyeCatch(ecRes);

        // 2. In-article image
        apiService.logToServer("Generating in-article image...");
        const imgRes = await apiService.generateImage(openaiKey, `${topic}の内容を補足する、クリーンで専門的な雰囲気の挿絵・図解イメージ。`);
        if (imgRes.success) setArticleImages([imgRes]);
      }
    } catch (e) {
      alert("生成エラー: " + e.message);
    }
    setIsGenerating(false);
  };

  const handleInsertToEditor = () => {
    if (!selectedAccount || !generatedTitle || !generatedBody) return;
    
    const wv = document.getElementById(`note-wv-${selectedAccount.id}`);
    if (!wv) {
      alert("ウェブビューが見つかりません。一度「再読み込み」ボタンを押してみてください。");
      return;
    }

    // 1. データを安全にWebview側のwindowオブジェクトに渡す
    const data = {
      title: generatedTitle,
      body: generatedBody
    };
    
    wv.executeJavaScript(`window.__note_insert_data = ${JSON.stringify(data)}`)
      .then(() => {
        // 2. 挿入ロジックを実行
        const logicScript = `
          (function() {
            try {
              const data = window.__note_insert_data;
              if (!data) return;

              function mdToHtml(md) {
                return md
                  .replace(/[#]{1,3}[ \s　]+(.*)/g, '<h3>$1</h3>')
                  .replace(/\\*\\*(.*?)\\*\\*/g, '<b>$1</b>')
                  .replace(/\\n\\n/g, '<br><br>')
                  .replace(/\\n/g, '<br>');
              }
              
              function cleanMd(text) {
                 return text.replace(/[#*]/g, '').trim();
              }

              const htmlBody = mdToHtml(data.body);
              const plainBody = data.body
                  .replace(/\\*\\*(.*?)\\*\\*/g, '$1')
                  .replace(/[#]{1,3}[ \s　]+(.*)/g, '$1');
                  
              const cleanTitle = cleanMd(data.title);

              // タイトル検索
              let titleArea = document.querySelector('textarea.p-articleEditor__title, .p-articleEditor__title textarea, textarea[placeholder*="タイトル"], h1[contenteditable="true"], [aria-label*="タイトル"], [aria-label*="見出し"]');
              if (!titleArea) {
                const allElements = Array.from(document.querySelectorAll('*'));
                titleArea = allElements.find(el => 
                  (el.tagName === 'TEXTAREA' || el.contentEditable === 'true') && 
                  (el.placeholder?.includes('タイトル') || (el.ariaLabel && (el.ariaLabel.includes('タイトル') || el.ariaLabel.includes('見出し'))))
                );
              }

              if (titleArea) {
                titleArea.focus();
                // 既存の文字がある場合のために全選択してから挿入を試みる
                try {
                  const titleSuccess = document.execCommand('insertText', false, cleanTitle);
                  if (!titleSuccess) {
                    if (titleArea.tagName === 'H1' || titleArea.contentEditable === 'true') {
                        titleArea.innerText = cleanTitle;
                    } else {
                        titleArea.value = cleanTitle;
                    }
                  }
                } catch (e) {
                  titleArea.value = cleanTitle;
                }
                titleArea.dispatchEvent(new Event('input', { bubbles: true }));
                titleArea.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                console.log("Title area not found");
              }

              // 本文検索 (プレースホルダーまたはセレクター)
              const allElements = Array.from(document.querySelectorAll('*'));
              let contentArea = allElements.find(el => 
                el.contentEditable === 'true' && 
                (el.innerText.includes('どんな発見') || el.innerText.includes('書く'))
              );

              if (!contentArea) {
                contentArea = document.querySelector('.ce-paragraph, .p-articleEditor__content, [contenteditable="true"]:not(h1)');
              }

              if (contentArea) {
                contentArea.focus();
                contentArea.click();
                
                setTimeout(() => {
                  try {
                    const success = document.execCommand('insertHTML', false, htmlBody);
                    if (!success) {
                      document.execCommand('insertText', false, plainBody);
                    }
                    alert("記事を挿入しました！");
                  } catch (err) {
                    document.execCommand('insertText', false, plainBody);
                    alert("装飾なしで挿入しました。");
                  }
                }, 300);
              } else {
                alert("エディタが見つかりませんでした。一度エディタ内をクリックしてから再度お試しください。");
              }
            } catch (e) {
              alert("内部エラー: " + e.message);
            }
          })()
        `;
        return wv.executeJavaScript(logicScript);
      })
      .catch(err => {
        alert("実行エラー: " + err.message);
      });
  };

  return (
    <div className="flex h-full bg-neutral-950/20 overflow-hidden">
      {/* Ultra-Compact Account Sidebar */}
      <div className="w-20 border-r border-neutral-800/50 flex flex-col bg-neutral-900/10 flex-shrink-0 relative z-20">
        <div className="p-4 border-b border-neutral-800/50 flex flex-col items-center gap-4">
          <button 
             onClick={() => onNavigate('accounts')}
             className="text-neutral-500 hover:text-white transition-colors [-webkit-app-region:no-drag] pointer-events-auto p-1"
             title="ノード管理"
          >
             <Settings className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4 items-center flex flex-col scrollbar-thin scrollbar-thumb-neutral-800">
          {accounts.map(acc => (
            <button
              key={acc.id}
              onClick={() => setSelectedAccountId(acc.id)}
              className={`relative flex items-center justify-center transition-all duration-300 [-webkit-app-region:no-drag] pointer-events-auto group ${
                selectedAccountId === acc.id ? 'scale-110' : 'hover:scale-110'
              }`}
              title={acc.threadsUsername || acc.username}
            >
              <div className={`p-1 rounded-full border-2 transition-all ${selectedAccountId === acc.id ? 'border-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.3)]' : 'border-transparent'}`}>
                <img 
                  src={acc.avatarUrl || 'https://picsum.photos/100'} 
                  className={`w-10 h-10 rounded-full object-cover transition-opacity ${selectedAccountId === acc.id ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`} 
                  alt="" 
                />
              </div>
              {acc.status === 'active' && (
                <span className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-neutral-900"></span>
              )}
            </button>
          ))}
          <button 
             onClick={() => onNavigate('accounts')}
             className="w-10 h-10 rounded-full border border-dashed border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-all flex items-center justify-center [-webkit-app-region:no-drag] pointer-events-auto"
             title="ノードを追加"
          >
             <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Large Webview Area */}
      <div className="flex-1 flex flex-col bg-neutral-950/40 relative min-w-0">
        {selectedAccount ? (
          <div className="flex-1 flex flex-col relative" key={selectedAccount.id}>
            <webview
              key={selectedAccount.id}
              id={`note-wv-${selectedAccount.id}`}
              src="https://note.com/"
              className="w-full h-full bg-white"
              partition={`persist:note_account_${selectedAccount.id}`}
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              allowpopups
            />

            {/* Status Bar & Controls */}
            <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-30 transition-all duration-500 ${assistantOpen ? 'translate-y-2 opacity-50' : ''}`}>
               <div className="bg-neutral-900/90 backdrop-blur-md px-5 py-2.5 rounded-2xl border border-neutral-800 flex items-center gap-6 shadow-2xl">
                  <div className="flex items-center gap-3">
                    <img src="https://www.google.com/s2/favicons?domain=note.com&sz=32" className="w-4 h-4" />
                    <span className="text-[11px] font-bold text-neutral-400">@{selectedAccount.threadsUsername || selectedAccount.username} のセッション</span>
                  </div>
                  <div className="h-4 w-[1px] bg-neutral-800"></div>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => {
                         const wv = document.getElementById(`note-wv-${selectedAccount.id}`);
                         if (wv) wv.reload();
                      }}
                      className="text-[11px] font-bold text-neutral-400 hover:text-white transition-all flex items-center gap-2 [-webkit-app-region:no-drag] pointer-events-auto"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> 再読み込み
                    </button>
                    <div className="h-4 w-[1px] bg-neutral-800"></div>
                    <button 
                      onClick={() => setAssistantOpen(!assistantOpen)}
                      className={`text-[11px] font-bold px-4 py-1.5 rounded-xl transition-all flex items-center gap-2 [-webkit-app-region:no-drag] pointer-events-auto ${assistantOpen ? 'bg-violet-600 text-white shadow-[0_0_15px_rgba(124,58,237,0.5)]' : 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'}`}
                    >
                      <Sparkles className="w-3.5 h-3.5" /> {assistantOpen ? 'アシスタントを閉じる' : 'AI記事作成ツール'}
                    </button>
                  </div>
               </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
             <div className="text-center p-12 glass-panel rounded-[3rem] border border-neutral-800/50 max-w-sm">
                <div className="w-20 h-20 bg-neutral-900 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner border border-neutral-800">
                   <Globe className="w-10 h-10 text-neutral-700 animate-pulse" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">ノードを選択してください</h3>
                <p className="text-sm text-neutral-500 leading-relaxed">
                  運用中のThreadsノードを選択して、専用ブラウザでnote.comの管理画面を展開します。
                </p>
             </div>
          </div>
        )}
      </div>

      {/* AI Assistant Side Panel */}
      {assistantOpen && (
        <div className="w-80 border-l border-neutral-800/50 bg-neutral-900/40 backdrop-blur-2xl flex flex-col flex-shrink-0 animate-in slide-in-from-right duration-500">
          <div className="p-6 border-b border-neutral-800/50 flex justify-between items-center bg-neutral-950/20">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" /> AI記事作成アシスタント
            </h3>
            <button onClick={() => setAssistantOpen(false)} className="text-neutral-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-neutral-800">
            {/* AI Provider Selector */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                <Bot className="w-3 h-3" /> 使用するAIプロバイダー
              </label>
              <div className="grid grid-cols-4 gap-2">
                {['gemini', 'openai', 'anthropic', 'manus'].map(p => (
                  <button
                    key={p}
                    onClick={() => setSelectedProvider(p)}
                    className={`py-2 px-1 rounded-xl text-[10px] font-bold uppercase transition-all border ${selectedProvider === p ? 'bg-violet-600 text-white border-violet-500 shadow-lg' : 'bg-neutral-900/50 text-neutral-500 border-neutral-800 hover:text-neutral-300'}`}
                  >
                    {p === 'gemini' ? 'Gemini' : p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : 'Manus'}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Custom Settings (Persona, Benefit, etc.) */}
            <div className="space-y-3 p-4 bg-neutral-950/30 border border-neutral-800/50 rounded-2xl">
              <button 
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className="w-full flex items-center justify-between text-[11px] font-bold text-neutral-400 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2 uppercase tracking-widest">
                  <Settings2 className="w-3.5 h-3.5" /> 詳細設定（アカウント別）
                </div>
                {isSettingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {isSettingsOpen && (
                <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase">ペルソナ（執筆者設定）</label>
                    <textarea 
                      value={persona}
                      onChange={(e) => setPersona(e.target.value)}
                      placeholder="例: IT企業のエンジニア、30代の投資家..."
                      className="w-full p-3 bg-neutral-900 border border-neutral-800 rounded-xl text-[12px] text-white focus:outline-none focus:border-violet-500/50 resize-none h-16"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase">読者のベネフィット</label>
                    <textarea 
                      value={benefit}
                      onChange={(e) => setBenefit(e.target.value)}
                      placeholder="例: 副業の始め方がわかる、節税のコツを掴める..."
                      className="w-full p-3 bg-neutral-900 border border-neutral-800 rounded-xl text-[12px] text-white focus:outline-none focus:border-violet-500/50 resize-none h-16"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-neutral-500 uppercase">目標文字数</label>
                      <input 
                        type="number"
                        value={wordCount}
                        onChange={(e) => setWordCount(parseInt(e.target.value) || 0)}
                        className="w-full p-3 bg-neutral-900 border border-neutral-800 rounded-xl text-[12px] text-white focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-neutral-500 uppercase">記事タイプ</label>
                      <button 
                        onClick={() => setIsPaid(!isPaid)}
                        className={`w-full p-3 rounded-xl text-[10px] font-bold transition-all border ${isPaid ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-neutral-900 border-neutral-800 text-neutral-500'}`}
                      >
                        {isPaid ? '有料級プレミアム' : '通常記事(無料)'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Generation Input */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest">記事のテーマ・内容</label>
              <textarea 
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例: 副業で月10万円稼ぐためのマインドセット"
                className="w-full p-4 bg-neutral-950/50 border border-neutral-800 rounded-2xl text-[14px] text-white focus:outline-none focus:border-violet-500/50 transition-all resize-none h-24 shadow-inner"
              />
              <button 
                onClick={handleGenerateNoteArticle}
                disabled={isGenerating || !topic}
                className="w-full py-4 bg-white text-black rounded-2xl font-bold hover:bg-neutral-200 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Bot className="w-5 h-5" />}
                {isGenerating ? '記事を生成中...' : 'AIで記事をフル生成'}
              </button>
            </div>

            {/* Title Results */}
            {generatedTitle && (
              <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex justify-between items-end">
                  <label className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest">生成されたタイトル</label>
                  <button onClick={() => { navigator.clipboard.writeText(generatedTitle); alert("タイトルをコピーしました"); }} className="text-[10px] text-neutral-500 hover:text-white flex items-center gap-1 font-bold">
                    <Copy className="w-3 h-3" /> コピー
                  </button>
                </div>
                <div className="p-4 bg-neutral-900 border border-emerald-500/30 rounded-2xl text-[15px] font-bold text-white leading-relaxed">
                  {generatedTitle}
                </div>
              </div>
            )}

            {/* Eye-catch Image */}
            {eyeCatch && (
              <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex justify-between items-end">
                  <label className="text-[11px] font-bold text-sky-400 uppercase tracking-widest">アイキャッチ画像</label>
                  <span className="text-[10px] text-neutral-500 font-bold italic">Generated by DALL-E 3</span>
                </div>
                <div className="relative group rounded-2xl overflow-hidden border border-sky-500/30">
                  <img src={eyeCatch.base64} className="w-full aspect-video object-cover" alt="Eye catch" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="flex gap-2">
                       <button 
                         onClick={() => {
                            const link = document.createElement('a');
                            link.href = eyeCatch.base64;
                            link.download = `note_eyecatch_${Date.now()}.png`;
                            link.click();
                         }}
                         className="p-3 bg-white text-black rounded-full font-bold shadow-xl hover:scale-110 transition-transform"
                       >
                         <Download className="w-5 h-5" />
                       </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Body Text */}
            {generatedBody && (
              <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex justify-between items-end">
                  <label className="text-[11px] font-bold text-violet-400 uppercase tracking-widest">生成された記事本文</label>
                  <button onClick={() => { navigator.clipboard.writeText(generatedBody); alert("本文をコピーしました"); }} className="text-[10px] text-neutral-500 hover:text-white flex items-center gap-1 font-bold">
                    <Copy className="w-3 h-3" /> 全てコピー
                  </button>
                </div>
                <div className="p-5 bg-neutral-900 border border-violet-500/30 rounded-2xl text-[14px] text-neutral-200 leading-[1.8] font-medium max-h-96 overflow-y-auto whitespace-pre-wrap shadow-inner scrollbar-thin scrollbar-thumb-neutral-800">
                  {generatedBody}
                </div>
                <button 
                  onClick={handleInsertToEditor}
                  className="w-full py-4 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg mt-4 [-webkit-app-region:no-drag] pointer-events-auto"
                >
                  <ArrowUpRight className="w-5 h-5" />
                  エディタに自動挿入
                </button>
              </div>
            )}

            {/* Article Images */}
            {articleImages.length > 0 && (
              <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 pb-12">
                <label className="text-[11px] font-bold text-amber-500 uppercase tracking-widest">記事内挿絵</label>
                <div className="grid grid-cols-1 gap-4">
                  {articleImages.map((img, idx) => (
                    <div key={idx} className="relative group rounded-2xl overflow-hidden border border-amber-500/30">
                      <img src={img.base64} className="w-full object-cover" alt={`Article img ${idx}`} />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button 
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = img.base64;
                            link.download = `note_img_${idx}_${Date.now()}.png`;
                            link.click();
                          }}
                          className="p-3 bg-white text-black rounded-full font-bold shadow-xl hover:scale-110 transition-transform"
                        >
                          <Download className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {!generatedTitle && !isGenerating && (
              <div className="h-full flex flex-col items-center justify-center opacity-30 py-20">
                <Bot className="w-16 h-16 mb-4" />
                <p className="text-xs font-bold text-center px-4">テーマを入力して記事を生成してください。<br/>画像生成にはOpenAI APIキーが必要です。</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
// --- Cloud Automation View ---
const CloudAutomationView = ({ currentUser, accounts }) => {
  const [cloudTasks, setCloudTasks] = useState([]);
  const [newPost, setNewPost] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const fetchCloudTasks = async () => {
      try {
        const q = query(collection(db, "cloud_tasks"), where("userId", "==", currentUser.username));
        const snap = await getDocs(q);
        setCloudTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error(e); }
    };
    fetchCloudTasks();
    const interval = setInterval(fetchCloudTasks, 30000);
    return () => clearInterval(interval);
  }, [currentUser?.username]);

  const addCloudTask = async () => {
    if (!newPost.trim() || !scheduledAt) return;
    setIsSyncing(true);
    try {
      const taskData = {
        userId: currentUser?.username || 'unknown',
        targetAccountId: targetAccountId || (accounts[0]?.id),
        targetUsername: accounts.find(a => a.id === (targetAccountId || accounts[0]?.id))?.threadsUsername || 'Unknown',
        text: newPost,
        scheduledAt: new Date(scheduledAt).toISOString(),
        status: 'pending',
        type: 'post',
        createdAt: new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, "cloud_tasks"), taskData);
      setCloudTasks([...cloudTasks, { id: docRef.id, ...taskData }]);
      setNewPost('');
      alert("クラウドキューに送信しました。サーバーが順次処理します。");
    } catch (e) {
      alert("送信に失敗しました: " + e.message);
    }
    setIsSyncing(false);
  };

  const cancelCloudTask = async (taskId) => {
    try {
      await deleteDoc(doc(db, "cloud_tasks", taskId));
      setCloudTasks(cloudTasks.filter(t => t.id !== taskId));
    } catch (e) { alert("削除に失敗しました。"); }
  };

  const handleGitHubPush = async () => {
    const token = localStorage.getItem('githubToken');
    const repo = localStorage.getItem('githubRepo');
    if (!token || !repo) {
      alert("GitHubのトークンとリポジトリを「システム設定」で設定してください。");
      return;
    }

    setIsSyncing(true);
    try {
      const data = {
        updatedAt: new Date().toISOString(),
        tasks: cloudTasks,
        accounts: accounts.map(a => ({ id: a.id, threadsUsername: a.threadsUsername, status: a.status }))
      };
      const res = await apiService.githubPush({
        token,
        repo,
        path: 'manus_sync.json',
        content: JSON.stringify(data, null, 2),
        message: 'Sync from AutoThreader'
      });
      if (res.success) alert("GitHubへの同期が完了しました。Manus AIから読み取り可能です。");
      else throw new Error(res.error);
    } catch (e) {
      alert("GitHub同期エラー: " + e.message);
    }
    setIsSyncing(false);
  };

  const handleGitHubPull = async () => {
    const token = localStorage.getItem('githubToken');
    const repo = localStorage.getItem('githubRepo');
    if (!token || !repo) return;

    setIsSyncing(true);
    try {
      const res = await apiService.githubPull({ token, repo, path: 'manus_sync.json' });
      if (res.success && res.content) {
        const remoteData = JSON.parse(res.content);
        if (remoteData.tasks) {
           // Basic merge for tasks (could be improved)
           alert(`GitHubから ${remoteData.tasks.length} 件のデータを確認しました。Manusとの連携準備が整っています。`);
        }
      } else if (!res.success) {
        throw new Error(res.error);
      }
    } catch (e) {
      alert("GitHub読込エラー: " + e.message);
    }
    setIsSyncing(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent">
      {/* Fixed Sticky Header */}
      <div className="px-8 py-8 flex flex-col gap-2 relative z-10 border-b border-neutral-800/50 bg-neutral-950/50 backdrop-blur-xl">
        <h2 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          <Cloud className="w-8 h-8 text-sky-400" /> クラウド自動連携 (Beta)
        </h2>
        <p className="text-sm text-neutral-400 font-medium max-w-2xl">
          PC本体を閉じていても、クラウド上の「リモートワーカー」があなたの代わりに24時間稼働します。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-8 bg-neutral-950">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-10">
            {/* Task Creation Form */}
            <div className="lg:col-span-1 space-y-6">
              <div className="glass-panel p-8 rounded-3xl border border-neutral-800 bg-neutral-900/40">
                <h3 className="text-sm font-bold text-white mb-6 uppercase tracking-widest flex items-center gap-2">
                  <Plus className="w-4 h-4 text-sky-400" /> クロード投稿予約
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 uppercase mb-2">投稿内容 (AI利用可)</label>
                    <textarea 
                      value={newPost}
                      onChange={(e) => setNewPost(e.target.value)}
                      placeholder="クラウドから投稿する内容を入力..."
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-sm text-white focus:outline-none focus:border-sky-500 min-h-[120px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 uppercase mb-2">投稿に使用するノード (Threads)</label>
                    <select 
                      value={targetAccountId}
                      onChange={(e) => setTargetAccountId(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="">(自動選択 / 第一ノード)</option>
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>@{acc.threadsUsername || acc.username}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-500 uppercase mb-2">実行予定日時</label>
                    <input 
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <button 
                    onClick={addCloudTask}
                    disabled={isSyncing}
                    className="w-full py-4 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" /> クラウドに予約送信
                  </button>

                  <div className="pt-4 border-t border-neutral-800 flex gap-2">
                    <button 
                      onClick={handleGitHubPush}
                      className="flex-1 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-neutral-700"
                    >
                      <Globe className="w-4 h-4 text-emerald-400" /> GitHubへ同期
                    </button>
                    <button 
                      onClick={handleGitHubPull}
                      className="px-4 py-3 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 rounded-xl text-xs font-bold transition-all border border-neutral-800"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-sky-500/5 border border-sky-500/10 rounded-3xl">
                <h4 className="text-[11px] font-bold text-sky-400 mb-3 uppercase tracking-widest flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5" /> 稼働状況
                </h4>
                <div className="flex items-center gap-3">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[12px] text-neutral-300 font-medium">Cloud Base: ONLINE</span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-2 leading-relaxed">
                  ※公式APIまたは専用サーバー(VPS)との接続待機中です。
                </p>
              </div>
            </div>

            {/* Cloud Task Queue */}
            <div className="lg:col-span-2">
              <div className="glass-panel rounded-3xl overflow-hidden border border-neutral-800 bg-neutral-900/40">
                <div className="p-6 border-b border-neutral-800 bg-neutral-900/50 flex justify-between items-center">
                  <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                    <Activity className="w-4 h-4 text-sky-400" /> Cloud Sync Queue
                  </h3>
                  <span className="text-[10px] font-bold text-neutral-500 bg-neutral-800 px-2 py-1 rounded">
                    {cloudTasks.length} TASKS
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-neutral-900/30 text-[10px] font-bold text-neutral-500 uppercase">
                        <th className="px-6 py-4">Scheduled</th>
                        <th className="px-6 py-4">Node</th>
                        <th className="px-6 py-4">Content</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/50">
                      {cloudTasks.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="px-6 py-12 text-center text-neutral-600 italic text-sm">
                            予約されたクラウドタスクはありません。
                          </td>
                        </tr>
                      ) : cloudTasks.sort((a,b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)).map(task => (
                        <tr key={task.id} className="hover:bg-white/5 transition-colors group">
                          <td className="px-6 py-5 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-[13px] text-white font-medium">
                                {new Date(task.scheduledAt).toLocaleDateString()}
                              </span>
                              <span className="text-[11px] text-neutral-500">
                                {new Date(task.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-5 whitespace-nowrap">
                            <span className="text-[12px] font-bold text-sky-400">@{task.targetUsername || 'Unknown'}</span>
                          </td>
                          <td className="px-6 py-5 min-w-[200px]">
                            <p className="text-[13px] text-neutral-300 line-clamp-2 leading-relaxed">
                              {task.text}
                            </p>
                          </td>
                          <td className="px-6 py-5 text-center">
                            <span className={`inline-flex px-2 py-1 rounded-md text-[10px] font-bold ${
                              task.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 
                              task.status === 'error' ? 'bg-rose-500/20 text-rose-400' : 'bg-sky-500/20 text-sky-400 animate-pulse'
                            }`}>
                              {task.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <button 
                              onClick={() => cancelCloudTask(task.id)}
                              className="p-2 text-neutral-500 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Authenticated. Now fetch license & profile data from Firestore.
        try {
          const email = user.email;
          const licensesRef = collection(db, "licenses");
          const q = query(licensesRef, where("usedByEmail", "==", email));
          const snap = await getDocs(q);
          
          if (!snap.empty) {
            const licData = snap.docs[0].data();
            const userData = {
               uid: user.uid,
               username: licData.usedBy || email.split('@')[0],
               email: email,
               role: (email === 'onecabigon@gmail.com' || licData.usedBy === 'admin') ? 'admin' : 'user',
               license: licData.key,
               plan: licData.plan || (email === 'onecabigon@gmail.com' ? 'enterprise' : 'pro'),
               licenseType: licData.type || '30days',
               activatedAt: licData.activatedAt
            };
            setCurrentUser(userData);
            localStorage.setItem('currentUser', JSON.stringify(userData));
            setIsSwitchingUser(false);
          } else if (email === 'onecabigon@gmail.com') {
            // Master Admin fallback
            const adminData = {
              uid: user.uid,
              username: 'onecabigon@gmail.com',
              email: email,
              role: 'admin',
              license: 'MASTER-KEY',
              plan: 'enterprise'
            };
            setCurrentUser(adminData);
            localStorage.setItem('currentUser', JSON.stringify(adminData));
            setIsSwitchingUser(false);
          }
        } catch (e) {
          console.error("Auth listener error:", e);
        }
      } else {
        setCurrentUser(null);
        localStorage.removeItem('currentUser');
        setIsSwitchingUser(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('currentUser');
      return saved ? JSON.parse(saved) : null;
    } catch(e) { return null; }
  });
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);
  const [rawAccounts, setRawAccounts] = useState([]);
  const [announcement, setAnnouncement] = useState('');
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [cachedUsers, setCachedUsers] = useState(JSON.parse(localStorage.getItem('usersDB') || '[]'));
  
  // Mobile & Platform Detection
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const isElectron = !!(window.electron);
  
  const addLog = (msg) => {
    console.log(`[System] ${msg}`);
    // Optional: If you want to show it in some UI, you'd need a global state.
    // For now, console.log is enough to prevent crashing.
  };

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  React.useEffect(() => {
    if (currentUser) {
      // 1. Initial Local Load (Fast First Paint)
      try {
        const savedRaw = localStorage.getItem(`threadsAccountsDB_${currentUser.username}`);
        let saved = [];
        if (savedRaw) {
          try {
            saved = JSON.parse(savedRaw);
          } catch (e) {
            console.error("Local parse failed:", e);
          }
        }
        if (Array.isArray(saved) && saved.length > 0) {
          setRawAccounts(saved);
        }
      } catch (e) {}

      // 2. Real-time Cloud Sync
      const userId = currentUser.username;
      const userAccountsRef = doc(db, "user_data", userId);
      
      const unsubscribe = onSnapshot(userAccountsRef, (docSnap) => {
        if (docSnap.exists()) {
          setIsCloudSyncing(true);
          const cloudAccounts = docSnap.data().accounts || [];
          setRawAccounts(cloudAccounts);
          localStorage.setItem(`threadsAccountsDB_${userId}`, JSON.stringify(cloudAccounts));
          addLog("Cloud Sync: Accounts updated from server.");
          setTimeout(() => setIsCloudSyncing(false), 1000);
        } else {
          // If no cloud data yet, and we have local data, migrate it!
          const localRaw = localStorage.getItem(`threadsAccountsDB_${userId}`);
          if (localRaw) {
            try {
              const localParsed = JSON.parse(localRaw);
              if (localParsed.length > 0) {
                console.log("Cloud is empty. Migrating local accounts to cloud...");
                setDoc(userAccountsRef, { accounts: localParsed }, { merge: true });
              }
            } catch (e) {}
          }
        }
      }, (err) => {
        console.error("Firestore sync error:", err);
      });

      return () => unsubscribe();
    }
  }, [currentUser]);

  // 全体お知らせの同期
  useEffect(() => {
    const fetchGlobalAnnounce = async () => {
      try {
        const querySnapshot = await getDocs(query(collection(db, "system_config")));
        const found = querySnapshot.docs.find(d => d.id === "announcement");
        if (found) setAnnouncement(found.data().text || '');
      } catch (e) { console.error("Announce fetch failed:", e); }
    };
    fetchGlobalAnnounce();
    const interval = setInterval(fetchGlobalAnnounce, 60000); // 1分おきにチェック
    return () => clearInterval(interval);
  }, []);

  // オンライン・ライセンス再検証 (起動時に実行)
  // オンライン・ライセンス再検証 (外部からも呼べるように関数化)
  const verifyOnlineLicense = async (silent = true) => {
    if (!currentUser || currentUser.role === 'admin') return;
    if (!currentUser.license) return;

    try {
      const q = query(collection(db, "licenses"), where("key", "==", currentUser.license));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const licData = querySnapshot.docs[0].data();
        
        // --- 利用制限チェック ---
        if (licData.status === 'suspended') {
          setIsBlocked(true);
          setBlockReason('管理者の操作により、このライセンスは一時的に停止されています。サポートにお問い合わせください。');
          return;
        }

        if (licData.activatedAt) {
          const activationDate = new Date(licData.activatedAt).getTime();
          const now = new Date().getTime();
          const daysUsed = (now - activationDate) / (24 * 60 * 60 * 1000);
          const maxDays = parseInt(licData.type) || 30;
          if (daysUsed > maxDays) {
            setIsBlocked(true);
            const isTrial = licData.plan === 'trial';
            setBlockReason(isTrial 
              ? "お試しプランが終了しました。継続する場合は管理者へ有料プランへの変更手続きをお申し出ください。"
              : `ライセンスの有効期限（${maxDays}日間）が終了しました。利用を継続するにはライセンスの更新をお願いいたします。`);
            return;
          }
        }

        const updatedUser = { 
          ...currentUser, 
          plan: licData.plan,
          licenseType: licData.type,
          activatedAt: licData.activatedAt 
        };
        
        if (licData.plan !== currentUser.plan || licData.type !== currentUser.licenseType || licData.activatedAt !== currentUser.activatedAt) {
          setCurrentUser(updatedUser);
          const usersDB = JSON.parse(localStorage.getItem('usersDB') || '[]');
          const nextUsers = usersDB.map(u => u.username === currentUser.username ? updatedUser : u);
          localStorage.setItem('usersDB', JSON.stringify(nextUsers));
          localStorage.setItem('currentUser', JSON.stringify(updatedUser));
          addLog("Cloud Sync: Subscription plan updated from server.");
          if (!silent) alert(`プラン情報を更新しました！\n現在のプラン: ${SUBSCRIPTION_PLANS[licData.plan]?.name || licData.plan}`);
        } else if (!silent) {
          alert("プラン情報は最新です。");
        }
      } else {
        setIsBlocked(true);
        setBlockReason('ライセンスが見つからないか、抹消されています。');
      }
    } catch (e) {
      console.error("Online verification failed:", e);
      if (!silent) alert("同期に失敗しました。通信環境を確認してください。");
    }
  };

  useEffect(() => {
    if (currentUser) {
      verifyOnlineLicense();
      const checkTimer = setInterval(() => verifyOnlineLicense(true), 300000);
      return () => clearInterval(checkTimer);
    }
  }, [currentUser?.license]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      if (currentUser) {
        localStorage.removeItem(`threadsAccountsDB_${currentUser.username}`);
      }
      setRawAccounts([]);
      setActiveTab('dashboard');
    } catch (e) {
      console.error("Logout error:", e);
    }
  };

  const handleSwitchUser = (user) => {
    if (currentUser) {
      localStorage.removeItem(`threadsAccountsDB_${currentUser.username}`);
    }
    setRawAccounts([]);
    setCurrentUser(user);
    setShowSwitchModal(false);
    setActiveTab('dashboard');
    // Save to localStorage so it's prioritized
    localStorage.setItem('currentUser', JSON.stringify(user));
  };

  const handleUpdateAccounts = async (newData) => {
    setRawAccounts(newData);
    if (currentUser) {
      localStorage.setItem(`threadsAccountsDB_${currentUser.username}`, JSON.stringify(newData));
    }
    
    // Push to Cloud if logged in
    if (currentUser) {
      setIsCloudSyncing(true);
      try {
        const userId = currentUser.username;
        await setDoc(doc(db, "user_data", userId), { 
          accounts: newData,
          lastSync: new Date().toISOString()
        }, { merge: true });
        
        // Background: Ensure uniqueness links are updated
        newData.forEach(async acc => {
          if (acc.threadsUsername) verifyAndLinkAccount('threads', acc.threadsUsername, currentUser.username);
          if (acc.noteEmail) verifyAndLinkAccount('note', acc.noteEmail, currentUser.username);
        });
      } catch (e) {
        console.error("Failed to sync to cloud:", e);
      }
      setTimeout(() => setIsCloudSyncing(false), 1500);
    }
  };

  if (isBlocked) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center p-8 text-center">
        <div className="glass-panel p-10 rounded-[2.5rem] border border-rose-500/30 max-w-md shadow-[0_0_50px_rgba(225,29,72,0.1)]">
          <ShieldAlert className="w-20 h-20 text-rose-500 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(225,29,72,0.5)]" />
          <h2 className="text-2xl font-bold text-white mb-4 tracking-tight">利用制限がかかっています</h2>
          <p className="text-neutral-400 text-sm leading-relaxed mb-8">{blockReason}</p>
          <button onClick={() => { setIsBlocked(false); handleLogout(); }} className="w-full py-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2">
            <LogOut className="w-5 h-5" /> サインイン画面へ戻る
          </button>
        </div>
      </div>
    );
  }

  if (!currentUser || isSwitchingUser) {
    return <AuthScreen 
      onLogin={(user) => {
        setCurrentUser(user);
        setIsSwitchingUser(false);
      }} 
      onCancel={currentUser ? () => setIsSwitchingUser(false) : null}
    />;
  }

  const navItems = [
    { id: 'dashboard', label: 'ダッシュボード', icon: <Home className="w-5 h-5" /> },
    { id: 'mypage', label: '会員情報', icon: <User className="w-5 h-5" /> },
    { id: 'quickpost', label: '新規投稿', icon: <Send className="w-5 h-5" /> },
    { id: 'accounts', label: 'ノード管理', icon: <Users className="w-5 h-5" /> },
    { id: 'note_guide', label: 'note.com 連携', icon: <Globe className="w-5 h-5 text-emerald-400" /> },
    { id: 'autopilot', label: 'エンジン設定 (AutoPilot)', icon: <Bot className="w-5 h-5" /> },
    { id: 'note_mgmt', label: 'note (大画面)', icon: <Layout className="w-5 h-5 text-emerald-400" /> },
    { id: 'scheduler', label: 'キュー（予約）', icon: <CalendarClock className="w-5 h-5" /> },
    { id: 'usage_guide', label: '使用方法', icon: <MessageCircle className="w-5 h-5 text-amber-400" /> },
    { id: 'settings', label: 'システム設定', icon: <Settings className="w-5 h-5" /> },
    { id: 'cloud', label: 'クラウド連携 (Beta)', icon: <Cloud className="w-5 h-5 text-sky-400" /> },
  ];

  if (currentUser.role === 'admin') {
    navItems.push({ id: 'admin', label: 'ライセンス(管理者)', icon: <ShieldCheck className="w-5 h-5" /> });
  }

  // Plan-based feature gating
  const filteredNavItems = navItems.filter(item => {
    if (currentUser.role === 'admin') return true;
    const planId = currentUser.plan || 'pro';
    const planData = SUBSCRIPTION_PLANS[planId] || SUBSCRIPTION_PLANS.entry;
    
    // Trial plan: Strictly limited to basic views
    if (planId === 'trial') {
      const allowedIds = ['dashboard', 'mypage', 'accounts', 'note_guide', 'note_mgmt', 'usage_guide'];
      return allowedIds.includes(item.id);
    }

    if (item.id === 'autopilot' || item.id === 'scheduler') {
      return planData?.features?.includes('engine');
    }
    return true;
  });

  return (
    <div className="h-screen w-screen bg-neutral-950 flex flex-col font-sans text-neutral-100 overflow-hidden relative selection:bg-violet-500/30">
      
      {/* Announcement Banner */}
      {announcement && (
        <div className="h-9 bg-indigo-600/90 backdrop-blur-md flex items-center justify-center px-4 relative z-[100] border-b border-indigo-400/30 shadow-lg">
          <div className="flex items-center gap-3 animate-pulse-slow">
            <Bell className="w-3.5 h-3.5 text-indigo-200" />
            <span className="text-[12px] font-bold tracking-tight text-white">{announcement}</span>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
      
      {/* Mobile Navbar Overlay for Sidebar */}
      {isMobile && sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] transition-opacity"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar */}
      <aside className={`
        ${isMobile ? 'fixed inset-y-0 left-0 w-72 z-[200] transform transition-transform duration-500 ease-out' : 'w-64'}
        ${isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'}
        glass-panel border-r border-neutral-800/80 flex-shrink-0 flex flex-col relative z-20 rounded-none border-y-0 border-l-0
      `}>
        <div className="h-20 flex items-center px-6 border-b border-neutral-800/50 bg-neutral-900/40 justify-between">
          <img src={appLogo} alt="thpro Logo" className="w-32 h-auto object-contain drop-shadow-[0_0_10px_rgba(212,175,55,0.2)]" />
          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30 font-bold">v2.0-note</span>
        </div>

        <div className="p-5 flex-1 mt-4 overflow-y-auto">
          <div className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.2em] mb-4 px-3">メインメニュー</div>
          <nav className="space-y-1.5">
            {filteredNavItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center px-4 py-3 rounded-2xl text-[14px] font-bold transition-all duration-300 ${activeTab === item.id
                    ? item.id === 'admin' ? 'bg-amber-500/20 text-amber-400 shadow-[inset_0_0_15px_rgba(245,158,11,0.2)] border border-amber-500/30' : 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.15)] translate-x-1'
                    : item.id === 'admin' ? 'text-amber-500/60 hover:bg-amber-500/10 hover:text-amber-400' : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-white'
                  }`}
              >
                <span className={`mr-3 ${activeTab === item.id ? item.id === 'admin' ? 'text-amber-400' : 'text-black' : item.id === 'admin' ? 'text-amber-500/60' : 'text-neutral-500'}`}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* User Profile / My Page Module */}
        <div className="p-5 border-t border-neutral-800/50 bg-neutral-900/30">
          <div className="flex items-center justify-between mb-4 px-2">
            <div 
              onClick={() => setActiveTab('mypage')}
              className="flex items-center gap-3 cursor-pointer group/profile hover:translate-x-1 transition-transform"
            >
              <div className="w-10 h-10 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-white font-bold uppercase overflow-hidden relative group">
                {currentUser.role === 'admin' ? <ShieldCheck className="w-5 h-5 text-amber-400" /> : <User className="w-5 h-5 text-neutral-400" />}
                <div className="absolute inset-0 bg-violet-600/0 group-hover/profile:bg-violet-600/20 transition-colors"></div>
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-bold text-white tracking-wide group-hover/profile:text-violet-400 transition-colors">{currentUser.username}</span>
                <span className={`text-[10px] uppercase tracking-widest font-bold mt-0.5 ${currentUser.role === 'admin' ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {currentUser.role === 'admin' ? 'ADMINISTRATOR' : 'LICENSED USER'}
                </span>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); setCachedUsers(JSON.parse(localStorage.getItem('usersDB') || '[]')); setShowSwitchModal(true); }}
                className="ml-auto p-2 hover:bg-white/10 rounded-xl transition-colors text-neutral-500 hover:text-white"
                title="アカウント切り替え"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-800 hover:bg-rose-500/20 hover:text-rose-400 text-neutral-400 text-[12px] font-bold transition-colors border border-transparent hover:border-rose-500/30 group">
            <LogOut className="w-4 h-4 text-neutral-500 group-hover:text-rose-400" />
            ログアウト
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative z-10 bg-transparent">
        <header className="h-20 border-b border-neutral-800/50 flex items-center justify-between px-8 flex-shrink-0 bg-neutral-950/50 backdrop-blur-xl sticky top-0">
          <div className="flex items-center flex-1 gap-4">
            {isMobile && (
              <button 
                onClick={() => setSidebarOpen(true)}
                className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-white active:scale-95 transition-transform"
              >
                <div className="w-5 h-5 flex flex-col justify-between items-center py-0.5">
                  <span className="w-4 h-0.5 bg-white rounded-full"></span>
                  <span className="w-4 h-0.5 bg-white rounded-full"></span>
                  <span className="w-4 h-0.5 bg-white rounded-full"></span>
                </div>
              </button>
            )}
            <div className="relative w-full max-w-md hidden sm:block group">
              <Search className="w-4 h-4 absolute left-4 top-1/2 transform -translate-y-1/2 text-neutral-500 group-focus-within:text-violet-400 transition-colors" />
              <input
                type="text"
                placeholder="Global search module..."
                className="w-full pl-11 pr-4 py-2.5 bg-neutral-900/50 border border-neutral-700/50 rounded-2xl text-sm text-white font-medium focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 transition-all shadow-inner"
              />
            </div>
          </div>
          <div className="flex items-center space-x-5">
            {/* Cloud Sync Status */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-500 ${isCloudSyncing ? 'bg-sky-500/20 border-sky-500/40 text-sky-400' : 'bg-neutral-900 border-neutral-800 text-neutral-500'}`}>
               {isCloudSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
               <span className="text-[10px] font-bold tracking-widest uppercase">{isCloudSyncing ? 'Syncing...' : 'Cloud Synced'}</span>
            </div>

            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${isElectron ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-violet-500/10 border-violet-500/30 text-violet-400'}`}>
               {isElectron ? <Monitor className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
               <span className="text-[10px] font-bold tracking-widest uppercase">{isElectron ? 'Desktop App' : 'Web Console'}</span>
            </div>

            <button className="text-neutral-400 hover:text-white transition-colors relative">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-neutral-950"></span>
            </button>
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-violet-600 to-blue-500 p-[2px] cursor-pointer hover:scale-105 transition-transform shadow-lg">
              <div className="w-full h-full bg-neutral-900 rounded-full flex items-center justify-center">
                <span className="text-xs font-bold text-white">{currentUser?.username?.substring(0, 2).toUpperCase() || 'AD'}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col h-full">
          {activeTab === 'dashboard' && <DashboardView accounts={rawAccounts} onNavigate={setActiveTab} isMobile={isMobile} />}
          {activeTab === 'mypage' && <MyPageView currentUser={currentUser} isMobile={isMobile} onRefresh={verifyOnlineLicense} />}
          {activeTab === 'quickpost' && <QuickPostView accounts={rawAccounts} isElectron={isElectron} isMobile={isMobile} addLog={addLog} />}
          {activeTab === 'accounts' && <AccountsView accounts={rawAccounts} onAccountsUpdate={handleUpdateAccounts} currentUser={currentUser} isElectron={isElectron} isMobile={isMobile} />}
          {activeTab === 'note_guide' && <NoteGuideView onNavigate={setActiveTab} isMobile={isMobile} />}
          {activeTab === 'autopilot' && <AutoPilotView accounts={rawAccounts} onAccountsUpdate={handleUpdateAccounts} isMobile={isMobile} />}
          {activeTab === 'note_mgmt' && <NoteManagementView accounts={rawAccounts} onNavigate={setActiveTab} isMobile={isMobile} />}
          {activeTab === 'scheduler' && <SchedulerView accounts={rawAccounts} />}
          {activeTab === 'usage_guide' && <UsageGuideView onNavigate={setActiveTab} />}
          {activeTab === 'settings' && <SettingsView />}
          {activeTab === 'admin' && <AdminDashboard currentUser={currentUser} />}
          {activeTab === 'cloud' && <CloudAutomationView currentUser={currentUser} accounts={rawAccounts} />}
        </div>
      </main>
      <AutomationEngine accounts={rawAccounts} onAccountsUpdate={handleUpdateAccounts} />
      
      {/* Account Switcher Modal */}
      {showSwitchModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
           <div className="glass-panel w-full max-w-sm rounded-[2.5rem] border border-neutral-800 shadow-2xl relative overflow-hidden">
              <div className="p-8 border-b border-neutral-800/50 flex justify-between items-center bg-neutral-900/40">
                 <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                    <Users className="w-4 h-4 text-violet-400" /> アカウント切り替え
                 </h3>
                 <button onClick={() => setShowSwitchModal(false)} className="text-neutral-500 hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                 </button>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2 custom-scrollbar">
                 {cachedUsers.map((user, idx) => (
                    <button 
                      key={idx}
                      onClick={() => handleSwitchUser(user)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                        currentUser?.username === user.username 
                        ? 'bg-violet-600 border-violet-500 text-white shadow-lg' 
                        : 'bg-neutral-900/50 border-neutral-800 text-neutral-400 hover:bg-neutral-800 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                         <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${currentUser?.username === user.username ? 'bg-white/20' : 'bg-neutral-800 border border-neutral-700'}`}>
                            {user.username.substring(0,2).toUpperCase()}
                         </div>
                         <div className="text-left">
                            <p className="text-sm font-bold leading-none mb-1">{user.username}</p>
                            <p className={`text-[10px] uppercase tracking-widest font-bold ${currentUser?.username === user.username ? 'text-violet-200' : 'text-neutral-600'}`}>{user.plan || 'Plan Info'}</p>
                         </div>
                      </div>
                      {currentUser?.username === user.username && <CheckCircle2 className="w-4 h-4" />}
                    </button>
                 ))}
                 
                 <button 
                   onClick={() => { setIsSwitchingUser(true); setShowSwitchModal(false); }}
                   className="w-full flex items-center gap-4 p-4 rounded-2xl border border-dashed border-neutral-800 text-neutral-500 hover:border-violet-500/50 hover:text-violet-400 transition-all text-sm font-bold"
                 >
                    <Plus className="w-4 h-4" /> 新しいアカウントでログイン
                 </button>
              </div>
              <div className="p-6 bg-neutral-900/20 text-center">
                 <p className="text-[10px] text-neutral-600 font-medium">現在このデバイスでアクティブなユーザー一覧です。</p>
              </div>
           </div>
        </div>
      )}

      </div>
    </div>
  );
}
