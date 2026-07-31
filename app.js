/**
 * app.js
 * ------------------------------------------------------------------
 * Application entry point. Wires up the UI: sidebar, theme, chat
 * messaging, conversation history/persistence, voice I/O, modals,
 * and toasts. Talks to Amazon Lex V2 through lex.js.
 * ------------------------------------------------------------------
 */

import { CONFIG, isConfigured } from "./config.js";
import {
  escapeHTML,
  renderMarkdown,
  generateId,
  formatTime,
  formatRelativeDate,
  truncate,
  storage,
  debounce,
  autoGrowTextarea,
  spawnRipple,
  copyToClipboard,
  downloadTextFile,
} from "./utils.js";
import { sendMessageToLex, testConnection, resetLexSession } from "./lex.js";

/* ================================================================
   STATE
   ================================================================ */

const state = {
  conversations: storage.get(CONFIG.storageKeys.conversations, []), // [{id, title, messages:[], updatedAt}]
  activeConversationId: storage.get(CONFIG.storageKeys.activeConversation, null),
  theme: storage.get(CONFIG.storageKeys.theme, "auto"),
  settings: storage.get(CONFIG.storageKeys.settings, { autoSpeak: false, sound: true }),
  isSending: false,
  isListening: false,
};

/* ================================================================
   DOM REFERENCES
   ================================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const dom = {
  root: document.documentElement,
  sidebar: $("#sidebar"),
  sidebarScrim: $("#sidebarScrim"),
  sidebarOpenBtn: $("#sidebarOpen"),
  sidebarCloseBtn: $("#sidebarClose"),
  newChatBtn: $("#newChatBtn"),
  historyList: $("#historyList"),
  historyEmpty: $("#historyEmpty"),
  themeToggleBtn: $("#themeToggleBtn"),
  themeQuickToggle: $("#themeQuickToggle"),
  themeCurrentLabel: $("#themeCurrentLabel"),
  settingsBtn: $("#settingsBtn"),
  aboutBtn: $("#aboutBtn"),

  connStatusDot: $("#connStatusDot"),
  connStatusText: $("#connStatusText"),
  exportBtn: $("#exportBtn"),
  clearChatBtn: $("#clearChatBtn"),

  welcomeScreen: $("#welcomeScreen"),
  suggestionGrid: $("#suggestionGrid"),
  chatArea: $("#chatArea"),
  messages: $("#messages"),

  composer: $("#composer"),
  composerInput: $("#composer-input"),
  sendBtn: $("#sendBtn"),
  micBtn: $("#micBtn"),
  attachBtn: $("#attachBtn"),

  toastStack: $("#toastStack"),

  settingsModalScrim: $("#settingsModalScrim"),
  settingsCloseBtn: $("#settingsCloseBtn"),
  autoSpeakToggle: $("#autoSpeakToggle"),
  soundToggle: $("#soundToggle"),
  connectionDetail: $("#connectionDetail"),
  segmentedBtns: $$(".segmented-btn"),

  aboutModalScrim: $("#aboutModalScrim"),
  aboutCloseBtn: $("#aboutCloseBtn"),
};

/* ================================================================
   THEME
   ================================================================ */

function applyTheme(theme) {
  state.theme = theme;
  dom.root.setAttribute("data-theme", theme);
  storage.set(CONFIG.storageKeys.theme, theme);

  const label = theme === "auto" ? "Auto" : theme === "dark" ? "Dark" : "Light";
  dom.themeCurrentLabel.textContent = label;

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effectiveDark = theme === "dark" || (theme === "auto" && prefersDark);
  dom.themeQuickToggle.innerHTML = effectiveDark
    ? '<i data-lucide="moon" aria-hidden="true"></i>'
    : '<i data-lucide="sun" aria-hidden="true"></i>';

  dom.segmentedBtns.forEach((btn) => {
    const checked = btn.dataset.themeChoice === theme;
    btn.setAttribute("aria-checked", String(checked));
  });

  refreshIcons();
}

function cycleQuickTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effectiveDark = state.theme === "dark" || (state.theme === "auto" && prefersDark);
  applyTheme(effectiveDark ? "light" : "dark");
  showToast(effectiveDark ? "Light mode enabled" : "Dark mode enabled", "info");
}

/* ================================================================
   ICONS (Lucide)
   ================================================================ */

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

/* ================================================================
   TOASTS
   ================================================================ */

const TOAST_ICONS = {
  success: "check-circle-2",
  error: "alert-circle",
  info: "info",
};

function showToast(message, type = "info", duration = 3200) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i data-lucide="${TOAST_ICONS[type] || "info"}" aria-hidden="true"></i><span>${escapeHTML(message)}</span>`;
  dom.toastStack.appendChild(toast);
  refreshIcons();

  setTimeout(() => {
    toast.classList.add("leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, duration);
}

/* ================================================================
   SOUND EFFECTS (lightweight WebAudio beeps — no external assets)
   ================================================================ */

let audioCtx = null;
function playTone(freq, duration = 0.08, type = "sine", volume = 0.05) {
  if (!state.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
  } catch {
    /* Audio not available — fail silently */
  }
}
const playSendSound = () => playTone(720, 0.07, "sine", 0.04);
const playReceiveSound = () => playTone(540, 0.09, "sine", 0.045);

/* ================================================================
   MODALS
   ================================================================ */

function openModal(scrimEl) {
  scrimEl.hidden = false;
  refreshIcons();
  const focusable = scrimEl.querySelector("button, [href], input, select, textarea");
  focusable && focusable.focus();
  document.addEventListener("keydown", onModalKeydown);
}
function closeModal(scrimEl) {
  scrimEl.hidden = true;
  document.removeEventListener("keydown", onModalKeydown);
}
function onModalKeydown(e) {
  if (e.key === "Escape") {
    closeModal(dom.settingsModalScrim);
    closeModal(dom.aboutModalScrim);
  }
}

/* ================================================================
   SIDEBAR (mobile open/close)
   ================================================================ */

function openSidebar() {
  dom.sidebar.classList.add("open");
  dom.sidebarScrim.hidden = false;
  dom.sidebarOpenBtn.setAttribute("aria-expanded", "true");
}
function closeSidebar() {
  dom.sidebar.classList.remove("open");
  dom.sidebarScrim.hidden = true;
  dom.sidebarOpenBtn.setAttribute("aria-expanded", "false");
}

/* ================================================================
   CONVERSATION PERSISTENCE
   ================================================================ */

function persistConversations() {
  storage.set(CONFIG.storageKeys.conversations, state.conversations);
  storage.set(CONFIG.storageKeys.activeConversation, state.activeConversationId);
}

function getActiveConversation() {
  return state.conversations.find((c) => c.id === state.activeConversationId) || null;
}

function createConversation() {
  const convo = {
    id: generateId("conv"),
    title: "New conversation",
    messages: [],
    updatedAt: Date.now(),
  };
  state.conversations.unshift(convo);
  state.activeConversationId = convo.id;
  persistConversations();
  return convo;
}

function deleteConversation(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.activeConversationId === id) {
    state.activeConversationId = null;
  }
  persistConversations();
  renderHistory();
  if (!state.activeConversationId) {
    showWelcomeScreen();
  }
}

function touchConversation(convo) {
  convo.updatedAt = Date.now();
  // Move to top of list
  state.conversations = [convo, ...state.conversations.filter((c) => c.id !== convo.id)];
  persistConversations();
}

/** Derives a short human title from the first user message. */
function deriveTitle(text) {
  return truncate(text.replace(/\s+/g, " ").trim(), 38) || "New conversation";
}

/* ================================================================
   HISTORY SIDEBAR RENDERING
   ================================================================ */

function renderHistory() {
  dom.historyList.innerHTML = "";

  if (!state.conversations.length) {
    dom.historyEmpty.hidden = false;
    dom.historyList.appendChild(dom.historyEmpty);
    return;
  }
  dom.historyEmpty.hidden = true;

  for (const convo of state.conversations) {
    const li = document.createElement("li");
    li.className = "history-item" + (convo.id === state.activeConversationId ? " active" : "");
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.dataset.id = convo.id;
    li.innerHTML = `
      <i data-lucide="message-square" aria-hidden="true"></i>
      <span class="h-title">${escapeHTML(convo.title)}</span>
      <button class="h-delete" aria-label="Delete conversation" data-delete-id="${convo.id}">
        <i data-lucide="x" aria-hidden="true"></i>
      </button>
    `;
    li.addEventListener("click", (e) => {
      if (e.target.closest("[data-delete-id]")) return;
      loadConversation(convo.id);
      closeSidebar();
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        loadConversation(convo.id);
        closeSidebar();
      }
    });
    dom.historyList.appendChild(li);
  }

  dom.historyList.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(btn.dataset.deleteId);
      showToast("Conversation deleted", "info");
    });
  });

  refreshIcons();
}

function loadConversation(id) {
  const convo = state.conversations.find((c) => c.id === id);
  if (!convo) return;
  state.activeConversationId = id;
  persistConversations();
  renderHistory();
  renderFullConversation(convo);
}

/* ================================================================
   CHAT VIEW SWITCHING
   ================================================================ */

function showWelcomeScreen() {
  dom.welcomeScreen.classList.remove("hidden");
  dom.chatArea.classList.remove("active");
  dom.messages.innerHTML = "";
}

function showChatView() {
  dom.welcomeScreen.classList.add("hidden");
  dom.chatArea.classList.add("active");
}

/** Fully re-renders all messages for a given conversation (used on load). */
function renderFullConversation(convo) {
  dom.messages.innerHTML = "";
  if (!convo.messages.length) {
    showWelcomeScreen();
    return;
  }
  showChatView();
  for (const msg of convo.messages) {
    appendMessageBubble(msg, { animate: false });
  }
  scrollToBottom(false);
}

/* ================================================================
   MESSAGE BUBBLE RENDERING
   ================================================================ */

/**
 * Appends a single message bubble to the DOM.
 * @param {{id:string, role:'user'|'bot', text:string, timestamp:number}} msg
 * @param {{animate?: boolean}} opts
 */
function appendMessageBubble(msg, opts = {}) {
  const { animate = true } = opts;
  const row = document.createElement("div");
  row.className = `msg-row ${msg.role}`;
  row.dataset.id = msg.id;
  if (!animate) row.style.animation = "none";

  const avatar = document.createElement("div");
  avatar.className = `avatar ${msg.role}`;
  avatar.innerHTML =
    msg.role === "bot"
      ? '<i data-lucide="graduation-cap" aria-hidden="true"></i>'
      : '<i data-lucide="user" aria-hidden="true"></i>';

  const col = document.createElement("div");
  col.className = "msg-col";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = renderMarkdown(msg.text);

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const timeLabel = document.createElement("span");
  timeLabel.textContent = formatTime(msg.timestamp);

  const actions = document.createElement("div");
  actions.className = "msg-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "msg-action-btn";
  copyBtn.setAttribute("aria-label", "Copy message");
  copyBtn.innerHTML = '<i data-lucide="copy" aria-hidden="true"></i>';
  copyBtn.addEventListener("click", async () => {
    const ok = await copyToClipboard(msg.text);
    if (ok) {
      copyBtn.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
      copyBtn.classList.add("copied");
      showToast("Copied to clipboard", "success", 1800);
      setTimeout(() => {
        copyBtn.innerHTML = '<i data-lucide="copy" aria-hidden="true"></i>';
        copyBtn.classList.remove("copied");
        refreshIcons();
      }, 1500);
    }
    refreshIcons();
  });
  actions.appendChild(copyBtn);

  if (msg.role === "bot") {
    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn";
    regenBtn.setAttribute("aria-label", "Regenerate response");
    regenBtn.title = "Regenerate";
    regenBtn.innerHTML = '<i data-lucide="refresh-cw" aria-hidden="true"></i>';
    regenBtn.addEventListener("click", () => regenerateResponse(msg.id));
    actions.appendChild(regenBtn);

    const speakBtn = document.createElement("button");
    speakBtn.className = "msg-action-btn";
    speakBtn.setAttribute("aria-label", "Read message aloud");
    speakBtn.title = "Read aloud";
    speakBtn.innerHTML = '<i data-lucide="volume-2" aria-hidden="true"></i>';
    speakBtn.addEventListener("click", () => speakText(msg.text));
    actions.appendChild(speakBtn);
  }

  meta.appendChild(timeLabel);
  meta.appendChild(actions);

  col.appendChild(bubble);
  col.appendChild(meta);
  row.appendChild(avatar);
  row.appendChild(col);
  dom.messages.appendChild(row);

  refreshIcons();
  return row;
}

/** Shows an animated "typing" bubble for the bot and returns a handle to remove it. */
function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "msg-row bot";
  row.id = "typingRow";
  row.innerHTML = `
    <div class="avatar bot"><i data-lucide="graduation-cap" aria-hidden="true"></i></div>
    <div class="msg-col">
      <div class="bubble">
        <div class="typing-indicator" aria-label="College Assistant AI is typing">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;
  dom.messages.appendChild(row);
  refreshIcons();
  scrollToBottom(true);
  return () => row.remove();
}

function scrollToBottom(smooth = true) {
  dom.chatArea.scrollTo({
    top: dom.chatArea.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
}

/* ================================================================
   SENDING MESSAGES / LEX ROUND-TRIP
   ================================================================ */

async function handleSend(rawText) {
  const text = (rawText ?? dom.composerInput.value).trim();
  if (!text || state.isSending) return;

  let convo = getActiveConversation();
  if (!convo) convo = createConversation();

  showChatView();

  // 1. Render user's message immediately (optimistic UI)
  const userMsg = { id: generateId("msg"), role: "user", text, timestamp: Date.now() };
  convo.messages.push(userMsg);
  appendMessageBubble(userMsg);
  scrollToBottom();
  playSendSound();

  // Update conversation title on first message
  if (convo.messages.length === 1) {
    convo.title = deriveTitle(text);
  }
  touchConversation(convo);
  renderHistory();

  // Reset composer
  dom.composerInput.value = "";
  autoGrowTextarea(dom.composerInput);
  updateSendButtonState();

  // 2. Show typing indicator + call Lex
  state.isSending = true;
  updateSendButtonState();
  const removeTyping = showTypingIndicator();

  try {
    const result = await sendMessageToLex(text);
    removeTyping();

    for (const messageText of result.messages) {
      const botMsg = { id: generateId("msg"), role: "bot", text: messageText, timestamp: Date.now() };
      convo.messages.push(botMsg);
      appendMessageBubble(botMsg);
      scrollToBottom();
    }
    playReceiveSound();
    touchConversation(convo);
    renderHistory();

    if (state.settings.autoSpeak && result.messages.length) {
      speakText(result.messages.join(" "));
    }

    setConnectionStatus("online");
  } catch (err) {
    removeTyping();
    console.error("[app] Lex request failed:", err);

    const fallback = isConfigured()
      ? "I'm having trouble reaching the College Assistant AI service right now. Please try again in a moment."
      : "College Assistant AI isn't fully configured yet. Add your AWS Cognito and Lex details to config.js to enable live responses.";

    const errMsg = { id: generateId("msg"), role: "bot", text: fallback, timestamp: Date.now() };
    convo.messages.push(errMsg);
    appendMessageBubble(errMsg);
    scrollToBottom();
    touchConversation(convo);
    renderHistory();

    setConnectionStatus("offline");
    showToast("Couldn't reach College Assistant AI", "error");
  } finally {
    state.isSending = false;
    updateSendButtonState();
  }
}

/** Regenerates the bot's response for the message preceding the given bot message id. */
async function regenerateResponse(botMsgId) {
  const convo = getActiveConversation();
  if (!convo || state.isSending) return;

  const idx = convo.messages.findIndex((m) => m.id === botMsgId);
  if (idx < 1) return;

  // Find the preceding user message to resend
  let userIdx = idx - 1;
  while (userIdx >= 0 && convo.messages[userIdx].role !== "user") userIdx--;
  if (userIdx < 0) return;
  const userText = convo.messages[userIdx].text;

  // Remove the old bot message from state + DOM
  convo.messages.splice(idx, 1);
  const row = dom.messages.querySelector(`[data-id="${botMsgId}"]`);
  row && row.remove();

  state.isSending = true;
  updateSendButtonState();
  const removeTyping = showTypingIndicator();

  try {
    const result = await sendMessageToLex(userText);
    removeTyping();
    for (const messageText of result.messages) {
      const botMsg = { id: generateId("msg"), role: "bot", text: messageText, timestamp: Date.now() };
      convo.messages.push(botMsg);
      appendMessageBubble(botMsg);
    }
    scrollToBottom();
    playReceiveSound();
    touchConversation(convo);
    renderHistory();
  } catch (err) {
    removeTyping();
    showToast("Couldn't regenerate response", "error");
  } finally {
    state.isSending = false;
    updateSendButtonState();
  }
}

function updateSendButtonState() {
  const hasText = dom.composerInput.value.trim().length > 0;
  dom.sendBtn.disabled = !hasText || state.isSending;
}

/* ================================================================
   CONNECTION STATUS
   ================================================================ */

function setConnectionStatus(status) {
  dom.connStatusDot.classList.remove("online", "offline");
  if (status === "online") {
    dom.connStatusDot.classList.add("online");
    dom.connStatusText.textContent = "Online";
  } else if (status === "offline") {
    dom.connStatusDot.classList.add("offline");
    dom.connStatusText.textContent = "Connection issue";
  } else {
    dom.connStatusText.textContent = "Connecting…";
  }
}

async function initConnection() {
  if (!isConfigured()) {
    setConnectionStatus("offline");
    dom.connectionDetail.textContent =
      "Not configured yet.\n\nOpen config.js and set:\n  • identityPoolId\n  • lex.botId\n  • lex.botAliasId\n\nSee README.md for full AWS setup steps.";
    return;
  }
  dom.connectionDetail.textContent = `Region: ${CONFIG.region}\nBot ID: ${CONFIG.lex.botId}\nAlias: ${CONFIG.lex.botAliasId}\nLocale: ${CONFIG.lex.localeId}\n\nTesting connection…`;

  const result = await testConnection();
  if (result.ok) {
    setConnectionStatus("online");
    dom.connectionDetail.textContent = `Region: ${CONFIG.region}\nBot ID: ${CONFIG.lex.botId}\nAlias: ${CONFIG.lex.botAliasId}\nLocale: ${CONFIG.lex.localeId}\n\n✓ Connected via Amazon Cognito`;
  } else {
    setConnectionStatus("offline");
    dom.connectionDetail.textContent = `Region: ${CONFIG.region}\nBot ID: ${CONFIG.lex.botId}\nAlias: ${CONFIG.lex.botAliasId}\nLocale: ${CONFIG.lex.localeId}\n\n✗ Could not connect. Check your Identity Pool permissions and bot alias status.`;
  }
}

/* ================================================================
   VOICE — SPEECH TO TEXT (Web Speech API)
   ================================================================ */

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;

function initSpeechRecognition() {
  if (!SpeechRecognitionCtor) {
    dom.micBtn.disabled = true;
    dom.micBtn.title = "Voice input isn't supported in this browser";
    return;
  }
  recognizer = new SpeechRecognitionCtor();
  recognizer.continuous = false;
  recognizer.interimResults = true;
  recognizer.lang = "en-US";

  recognizer.onstart = () => {
    state.isListening = true;
    dom.micBtn.classList.add("listening");
    dom.micBtn.innerHTML = '<i data-lucide="square" aria-hidden="true"></i><span class="mic-pulse" aria-hidden="true"></span>';
    refreshIcons();
  };

  recognizer.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    dom.composerInput.value = transcript;
    autoGrowTextarea(dom.composerInput);
    updateSendButtonState();
  };

  recognizer.onerror = (event) => {
    console.warn("[voice] Recognition error:", event.error);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showToast("Microphone access was denied", "error");
    } else if (event.error !== "no-speech") {
      showToast("Voice input error — please try again", "error");
    }
  };

  recognizer.onend = () => {
    state.isListening = false;
    dom.micBtn.classList.remove("listening");
    dom.micBtn.innerHTML = '<i data-lucide="mic" aria-hidden="true"></i><span class="mic-pulse" aria-hidden="true"></span>';
    refreshIcons();
    // Auto-send if we captured something meaningful
    if (dom.composerInput.value.trim()) {
      handleSend();
    }
  };
}

function toggleVoiceInput() {
  if (!recognizer) return;
  if (state.isListening) {
    recognizer.stop();
  } else {
    try {
      recognizer.start();
    } catch (err) {
      console.warn("[voice] Failed to start recognition:", err);
    }
  }
}

/* ================================================================
   VOICE — TEXT TO SPEECH
   ================================================================ */

function speakText(text) {
  if (!window.speechSynthesis) {
    showToast("Speech playback isn't supported in this browser", "error");
    return;
  }
  window.speechSynthesis.cancel(); // stop any current utterance
  const plain = text.replace(/[*_`#]/g, ""); // strip markdown symbols for cleaner speech
  const utterance = new SpeechSynthesisUtterance(plain);
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

/* ================================================================
   EXPORT / CLEAR CHAT
   ================================================================ */

function exportConversation() {
  const convo = getActiveConversation();
  if (!convo || !convo.messages.length) {
    showToast("Nothing to export yet", "info");
    return;
  }
  const lines = convo.messages.map((m) => {
    const who = m.role === "user" ? "You" : "College Assistant AI";
    return `[${formatTime(m.timestamp)}] ${who}: ${m.text}`;
  });
  const content = `${convo.title}\n${"=".repeat(convo.title.length)}\n\n${lines.join("\n\n")}`;
  downloadTextFile(`${convo.title.replace(/[^\w\- ]/g, "").slice(0, 40) || "conversation"}.txt`, content);
  showToast("Conversation exported", "success");
}

function clearActiveChat() {
  const convo = getActiveConversation();
  if (!convo) {
    showToast("No active conversation to clear", "info");
    return;
  }
  const confirmed = window.confirm("Clear all messages in this conversation? This can't be undone.");
  if (!confirmed) return;

  convo.messages = [];
  convo.title = "New conversation";
  persistConversations();
  renderHistory();
  showWelcomeScreen();
  showToast("Chat cleared", "success");
}

/* ================================================================
   EVENT WIRING
   ================================================================ */

function bindEvents() {
  // Sidebar
  dom.sidebarOpenBtn.addEventListener("click", openSidebar);
  dom.sidebarCloseBtn.addEventListener("click", closeSidebar);
  dom.sidebarScrim.addEventListener("click", closeSidebar);
  dom.newChatBtn.addEventListener("click", (e) => {
    spawnRipple(e, dom.newChatBtn);
    createConversation();
    renderHistory();
    showWelcomeScreen();
    closeSidebar();
    dom.composerInput.focus();
  });

  // Theme
  dom.themeToggleBtn.addEventListener("click", () => {
    const order = ["auto", "light", "dark"];
    const next = order[(order.indexOf(state.theme) + 1) % order.length];
    applyTheme(next);
  });
  dom.themeQuickToggle.addEventListener("click", cycleQuickTheme);
  dom.segmentedBtns.forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeChoice));
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "auto") applyTheme("auto");
  });

  // Modals
  dom.settingsBtn.addEventListener("click", () => openModal(dom.settingsModalScrim));
  dom.settingsCloseBtn.addEventListener("click", () => closeModal(dom.settingsModalScrim));
  dom.settingsModalScrim.addEventListener("click", (e) => {
    if (e.target === dom.settingsModalScrim) closeModal(dom.settingsModalScrim);
  });
  dom.aboutBtn.addEventListener("click", () => openModal(dom.aboutModalScrim));
  dom.aboutCloseBtn.addEventListener("click", () => closeModal(dom.aboutModalScrim));
  dom.aboutModalScrim.addEventListener("click", (e) => {
    if (e.target === dom.aboutModalScrim) closeModal(dom.aboutModalScrim);
  });

  // Settings toggles
  dom.autoSpeakToggle.checked = state.settings.autoSpeak;
  dom.soundToggle.checked = state.settings.sound;
  dom.autoSpeakToggle.addEventListener("change", () => {
    state.settings.autoSpeak = dom.autoSpeakToggle.checked;
    storage.set(CONFIG.storageKeys.settings, state.settings);
    if (!state.settings.autoSpeak) stopSpeaking();
  });
  dom.soundToggle.addEventListener("change", () => {
    state.settings.sound = dom.soundToggle.checked;
    storage.set(CONFIG.storageKeys.settings, state.settings);
  });

  // Composer
  dom.composerInput.addEventListener("input", () => {
    autoGrowTextarea(dom.composerInput);
    updateSendButtonState();
  });
  dom.composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  dom.sendBtn.addEventListener("click", (e) => {
    spawnRipple(e, dom.sendBtn);
    handleSend();
  });
  dom.micBtn.addEventListener("click", toggleVoiceInput);

  // Suggestion cards
  dom.suggestionGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".suggestion-card");
    if (!card) return;
    handleSend(card.dataset.prompt);
  });

  // Topbar actions
  dom.exportBtn.addEventListener("click", exportConversation);
  dom.clearChatBtn.addEventListener("click", clearActiveChat);

  // Global escape key closes sidebar on mobile
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dom.sidebar.classList.contains("open")) closeSidebar();
  });
}

/* ================================================================
   INIT
   ================================================================ */

function init() {
  applyTheme(state.theme);
  bindEvents();
  initSpeechRecognition();
  renderHistory();
  updateSendButtonState();

  const activeConvo = getActiveConversation();
  if (activeConvo && activeConvo.messages.length) {
    renderFullConversation(activeConvo);
  } else {
    showWelcomeScreen();
  }

  refreshIcons();
  initConnection();
}

document.addEventListener("DOMContentLoaded", init);
