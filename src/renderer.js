(() => {
  const RENDERER_VERSION = "__RENDERER_VERSION__";
  if (window.__codexSelectionExplainerVersion === RENDERER_VERSION) {
    return;
  }

  // Replace an older renderer in the already-open window without requiring a
  // full application restart. Old anonymous event handlers are harmless once
  // this renderer's later-registered handlers remove their stale UI elements.
  document.querySelectorAll(
    "#codex-selection-explainer-action, .codex-selection-explainer-window",
  ).forEach((element) => element.remove());
  document.querySelectorAll("style").forEach((styleElement) => {
    const content = styleElement.textContent || "";
    if (
      styleElement.dataset.codexSelectionExplainer
      || content.includes(".codex-selection-explainer-window")
    ) {
      styleElement.remove();
    }
  });

  window.__codexSelectionExplainerInjected = true;
  window.__codexSelectionExplainerVersion = RENDERER_VERSION;

  const BUTTON_ID = "codex-selection-explainer-action";
  const WINDOW_CLASS = "codex-selection-explainer-window";
  const MAX_SELECTION_LENGTH = 12000;
  const MAX_CONTEXT_LENGTH = 9000;
  const MAX_NEARBY_LENGTH = 4000;
  const MAX_WINDOWS = 12;
  const REQUEST_TIMEOUT_MS = 90000;
  const MAX_FOLLOWUP_LENGTH = 2000;
  const APP_LANGUAGE = "__APP_LANGUAGE__";
  const KATEX_CSS = "__KATEX_CSS__";
  const katex = globalThis.katex;
  const UI_STRINGS = {
    zh: {
      action: "这是什么",
      title: "这是什么",
      loading: "解释中…",
      followupPlaceholder: "继续追问…",
      ask: "发送",
      asking: "回答中…",
      errorPrefix: "解释失败：",
      timeout: "解释请求超时",
      close: "关闭",
    },
    en: {
      action: "What is this?",
      title: "What is this?",
      loading: "Explaining...",
      followupPlaceholder: "Ask a follow-up...",
      ask: "Send",
      asking: "Answering...",
      errorPrefix: "Explain failed:",
      timeout: "Explain request timed out",
      close: "Close",
    },
    ja: {
      action: "これは何？",
      title: "これは何？",
      loading: "説明中...",
      followupPlaceholder: "続けて質問...",
      ask: "送信",
      asking: "回答中...",
      errorPrefix: "説明に失敗しました：",
      timeout: "説明リクエストがタイムアウトしました",
      close: "閉じる",
    },
    ko: {
      action: "이건 뭐예요?",
      title: "이건 뭐예요?",
      loading: "설명 중...",
      followupPlaceholder: "계속 질문하기...",
      ask: "보내기",
      asking: "답변 중...",
      errorPrefix: "설명에 실패했습니다:",
      timeout: "설명 요청 시간이 초과되었습니다",
      close: "닫기",
    },
    fr: {
      action: "Qu'est-ce que c'est ?",
      title: "Qu'est-ce que c'est ?",
      loading: "Explication...",
      followupPlaceholder: "Poser une question...",
      ask: "Envoyer",
      asking: "Réponse...",
      errorPrefix: "Échec de l'explication :",
      timeout: "La demande d'explication a expiré",
      close: "Fermer",
    },
    de: {
      action: "Was ist das?",
      title: "Was ist das?",
      loading: "Erklärung...",
      followupPlaceholder: "Rückfrage stellen...",
      ask: "Senden",
      asking: "Antwort wird erstellt...",
      errorPrefix: "Erklärung fehlgeschlagen:",
      timeout: "Zeitüberschreitung der Erklärungsanfrage",
      close: "Schließen",
    },
    es: {
      action: "¿Qué es esto?",
      title: "¿Qué es esto?",
      loading: "Explicando...",
      followupPlaceholder: "Haz una pregunta...",
      ask: "Enviar",
      asking: "Respondiendo...",
      errorPrefix: "Error al explicar:",
      timeout: "Se agotó el tiempo de la solicitud",
      close: "Cerrar",
    },
    ru: {
      action: "Что это?",
      title: "Что это?",
      loading: "Объясняем...",
      followupPlaceholder: "Задать уточняющий вопрос...",
      ask: "Отправить",
      asking: "Готовим ответ...",
      errorPrefix: "Не удалось объяснить:",
      timeout: "Время запроса истекло",
      close: "Закрыть",
    },
    pt: {
      action: "O que é isto?",
      title: "O que é isto?",
      loading: "Explicando...",
      followupPlaceholder: "Fazer outra pergunta...",
      ask: "Enviar",
      asking: "Respondendo...",
      errorPrefix: "Falha ao explicar:",
      timeout: "O tempo da solicitação expirou",
      close: "Fechar",
    },
    it: {
      action: "Cos'è questo?",
      title: "Cos'è questo?",
      loading: "Spiegazione...",
      followupPlaceholder: "Fai una domanda...",
      ask: "Invia",
      asking: "Risposta in corso...",
      errorPrefix: "Errore durante la spiegazione:",
      timeout: "Richiesta di spiegazione scaduta",
      close: "Chiudi",
    },
  };

  function detectAppLanguage() {
    if (APP_LANGUAGE && APP_LANGUAGE !== "__APP_LANGUAGE__") {
      return APP_LANGUAGE;
    }
    const htmlLanguage = document.documentElement?.getAttribute("lang")
      || document.documentElement?.lang;
    if (htmlLanguage) {
      return htmlLanguage;
    }
    const navigatorLanguage = navigator.language || navigator.languages?.[0];
    if (navigatorLanguage) {
      return navigatorLanguage;
    }
    for (const key of ["codex:locale", "localeOverride", "locale", "i18nextLng"]) {
      try {
        const value = localStorage.getItem(key);
        if (value) {
          return value;
        }
      } catch {
        // Ignore storage access errors.
      }
    }
    return "zh-CN";
  }

  function getUiStrings() {
    const baseLanguage = String(detectAppLanguage() || "zh-CN")
      .toLowerCase()
      .replace("_", "-")
      .split("-")[0];
    return UI_STRINGS[baseLanguage] || UI_STRINGS.en;
  }

  const bridge = {
    pending: [],
    callbacks: new Map(),
    nextId: 1,
    enqueue(request, onDelta) {
      return new Promise((resolve, reject) => {
        const id = this.nextId;
        this.nextId += 1;
        this.pending.push({ id, request });
        this.callbacks.set(id, {
          resolve,
          reject,
          onDelta: typeof onDelta === "function" ? onDelta : null,
        });
        setTimeout(() => {
          if (this.callbacks.delete(id)) {
            reject(new Error(getUiStrings().timeout));
          }
        }, REQUEST_TIMEOUT_MS);
      });
    },
    resolve(id, payload) {
      const callback = this.callbacks.get(id);
      if (!callback) {
        return;
      }
      this.callbacks.delete(id);
      if (payload?.ok) {
        callback.resolve(payload.text);
      } else {
        callback.reject(new Error(payload?.error || getUiStrings().errorPrefix));
      }
    },
    append(id, delta) {
      const callback = this.callbacks.get(id);
      if (callback?.onDelta) {
        callback.onDelta(delta);
      }
    },
  };
  window.__codexSelectionExplainerBridge = bridge;

  const hasBuiltInKatexStyles = Array.from(document.styleSheets).some((sheet) => {
    try {
      return Array.from(sheet.cssRules).some((rule) => (
        String(rule.cssText || "").includes(".katex")
      ));
    } catch {
      return false;
    }
  });

  const style = document.createElement("style");
  style.dataset.codexSelectionExplainer = RENDERER_VERSION;
  style.dataset.katexSource = hasBuiltInKatexStyles ? "app" : "bundled";
  style.textContent = `${hasBuiltInKatexStyles ? "" : KATEX_CSS}
    body, body * {
      -webkit-user-select: text !important;
      user-select: text !important;
    }
    #${BUTTON_ID} {
      position: fixed;
      z-index: 2147483600;
      box-sizing: border-box;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 999px;
      background: #0f766e;
      color: #fff;
      font: 600 13px/1.2 system-ui, "Noto Sans CJK SC", sans-serif;
      padding: 7px 12px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.28);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .${WINDOW_CLASS} {
      position: fixed;
      z-index: 2147483500;
      width: 380px;
      height: min(520px, 78vh);
      min-height: 220px;
      max-height: calc(100vh - 16px);
      max-width: min(92vw, 560px);
      box-sizing: border-box;
      border: 1px solid rgba(120,120,140,0.28);
      border-radius: 10px;
      background: #fbfbfd;
      color: #1f2430;
      box-shadow: 0 18px 50px rgba(0,0,0,0.32);
      font: 14px/1.55 system-ui, "Noto Sans CJK SC", sans-serif;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: both;
    }
    .${WINDOW_CLASS} header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 10px 9px 14px;
      border-bottom: 1px solid rgba(120,120,140,0.18);
      background: #eef1f4;
      cursor: move;
      -webkit-user-select: none !important;
      user-select: none !important;
    }
    .${WINDOW_CLASS} header strong {
      font-size: 13px;
      letter-spacing: 0;
    }
    .${WINDOW_CLASS} header button {
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #47505e;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }
    .${WINDOW_CLASS} header button:hover {
      background: rgba(0,0,0,0.08);
    }
    .${WINDOW_CLASS} .body {
      flex: 1 1 auto;
      min-height: 0;
      padding: 12px 14px 14px;
      overflow: auto;
      user-select: text;
    }
    .${WINDOW_CLASS} .quote {
      margin: 0 0 10px;
      padding: 9px 11px;
      border-left: 3px solid #0f766e;
      border-radius: 4px;
      background: #eefbf8;
      color: #334155;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .${WINDOW_CLASS} .output {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: #1f2430;
    }
    .${WINDOW_CLASS} .thread {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .${WINDOW_CLASS} .turn {
      min-width: 0;
    }
    .${WINDOW_CLASS} .turn-label {
      margin: 0 0 3px;
      color: #64748b;
      font-size: 11px;
      font-weight: 600;
    }
    .${WINDOW_CLASS} .turn-user {
      padding: 7px 9px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #334155;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .${WINDOW_CLASS} .follow-up {
      display: flex;
      gap: 8px;
      flex: 0 0 auto;
      padding: 9px 10px 10px;
      border-top: 1px solid rgba(120,120,140,0.18);
      background: #f7f8fa;
    }
    .${WINDOW_CLASS} .follow-up input {
      min-width: 0;
      flex: 1 1 auto;
      height: 32px;
      box-sizing: border-box;
      padding: 6px 9px;
      border: 1px solid rgba(100,116,139,0.35);
      border-radius: 6px;
      background: #fff;
      color: #1f2430;
      font: inherit;
      outline: none;
    }
    .${WINDOW_CLASS} .follow-up input:focus {
      border-color: #0f766e;
      box-shadow: 0 0 0 2px rgba(15,118,110,0.14);
    }
    .${WINDOW_CLASS} .follow-up input:disabled,
    .${WINDOW_CLASS} .follow-up button:disabled {
      cursor: wait;
      opacity: 0.62;
    }
    .${WINDOW_CLASS} .follow-up button {
      flex: 0 0 auto;
      height: 32px;
      padding: 0 11px;
      border: 0;
      border-radius: 6px;
      background: #0f766e;
      color: #fff;
      font: 600 13px/1 system-ui, "Noto Sans CJK SC", sans-serif;
      cursor: pointer;
    }
    .${WINDOW_CLASS} .follow-up button:hover:not(:disabled) {
      background: #0b625d;
    }
    .${WINDOW_CLASS} .error {
      color: #b42318;
    }
    .${WINDOW_CLASS} .loading {
      color: #6b7280;
    }
    .${WINDOW_CLASS} .formula-inline {
      display: inline;
    }
    .${WINDOW_CLASS} .formula-block {
      display: block;
      margin: 8px 0;
      overflow-x: auto;
      overflow-y: hidden;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  let actionButton = null;
  let actionSnapshot = null;
  const windows = [];

  document.addEventListener("mouseup", () => {
    setTimeout(handleSelectionChange, 20);
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      removeActionButton();
      return;
    }
    handleSelectionChange();
  });
  document.addEventListener("scroll", removeActionButton, true);
  window.addEventListener("resize", () => {
    windows.forEach(keepWindowInsideViewport);
  });

  function handleSelectionChange() {
    const snapshot = readSelectionSnapshot();
    if (!snapshot) {
      removeActionButton();
      return;
    }
    showActionButton(snapshot);
  }

  function readSelectionSnapshot() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    const text = selection.toString().trim();
    if (!text) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const rect = getRangeRect(range);
    if (!rect) {
      return null;
    }
    const container = range.commonAncestorContainer;
    const element = container.nodeType === Node.ELEMENT_NODE
      ? container
      : container.parentElement;
    return {
      selection: truncate(text, MAX_SELECTION_LENGTH),
      rect,
      context: collectSelectionContext(element, text),
    };
  }

  function collectSelectionContext(element, selectedText) {
    const conversationRoot = findConversationRoot(element);
    const nearbyRoot = findNearbyRoot(element);
    const conversation = compressText(
      collectVisibleText(conversationRoot),
      MAX_CONTEXT_LENGTH,
    );
    const nearby = compressText(
      collectVisibleText(nearbyRoot || element?.parentElement),
      MAX_NEARBY_LENGTH,
    );

    return {
      title: document.title || "",
      url: location.href || "",
      origin: location.origin || "",
      path: location.pathname || "",
      selectedElement: element ? element.tagName.toLowerCase() : "",
      selectedText: truncate(selectedText, 4000),
      conversation,
      nearby,
    };
  }

  function findConversationRoot(element) {
    const candidates = [];
    document.querySelectorAll(
      'main, .app-shell-main-content-viewport, .main-surface, [class*="thread-page"], [class*="thread"], [class*="conversation"]',
    ).forEach((node) => candidates.push(node));
    if (element) {
      const message = element.closest(
        '[class*="thread"], [class*="conversation"], [class*="message"], [class*="markdown"]',
      );
      if (message) {
        candidates.push(message);
      }
    }
    return candidates
      .filter(Boolean)
      .sort((a, b) => textLength(b) - textLength(a))[0] || document.body;
  }

  function findNearbyRoot(element) {
    if (!element) {
      return null;
    }
    return element.closest(
      '[class*="markdown"], [class*="message"], [class*="thread"], [data-testid*="message"], [data-testid*="thread"]',
    ) || element.parentElement;
  }

  function collectVisibleText(root) {
    if (!root) {
      return "";
    }
    const chunks = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || isNoiseElement(parent)) {
        continue;
      }
      const text = node.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      if (text) {
        chunks.push(text);
      }
    }
    return chunks.join("\n");
  }

  function isNoiseElement(element) {
    if (
      element.closest(`#${BUTTON_ID}, .${WINDOW_CLASS}`) ||
      element.closest("style, script, noscript, svg, nav, header")
    ) {
      return true;
    }
    if (element.closest("[hidden], [aria-hidden='true']")) {
      return true;
    }
    const style = getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden";
  }

  function compressText(text, maxLength) {
    const normalized = String(text || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    const head = Math.floor(maxLength * 0.7);
    const tail = Math.max(120, maxLength - head - 24);
    return `${normalized.slice(0, head).trimEnd()}\n...[上下文过长，已压缩]...\n${normalized.slice(-tail).trimStart()}`;
  }

  function textLength(element) {
    return element?.textContent?.length || 0;
  }

  function getRangeRect(range) {
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const rect = rects[0] || range.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return null;
    }
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }

  function truncate(text, maxLength) {
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 7)).trimEnd()}\n[已截断]`;
  }

  function showActionButton(snapshot) {
    removeActionButton();
    actionSnapshot = snapshot;
    actionButton = document.createElement("button");
    actionButton.id = BUTTON_ID;
    actionButton.type = "button";
    actionButton.textContent = getUiStrings().action;
    actionButton.addEventListener("mousedown", (event) => event.preventDefault());
    actionButton.addEventListener("click", () => {
      if (actionSnapshot) {
        openWindow(actionSnapshot);
      }
      removeActionButton();
    });
    document.documentElement.append(actionButton);
    positionActionButton(actionButton, snapshot.rect);
  }

  function positionActionButton(button, rect) {
    const width = button.offsetWidth || 80;
    const height = button.offsetHeight || 32;
    const left = clamp(rect.right + 8, 8, window.innerWidth - width - 8);
    const top = clamp(rect.bottom + 8, 8, window.innerHeight - height - 8);
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  }

  function removeActionButton() {
    document.querySelectorAll(`#${BUTTON_ID}`).forEach((button) => button.remove());
    actionButton = null;
    actionSnapshot = null;
  }

  function openWindow(snapshot) {
    if (windows.length >= MAX_WINDOWS) {
      return;
    }
    const strings = getUiStrings();
    const win = document.createElement("section");
    win.className = WINDOW_CLASS;
    win.innerHTML = `
      <header>
        <strong>${strings.title}</strong>
        <button type="button" title="${strings.close}" aria-label="${strings.close}">×</button>
      </header>
      <div class="body">
        <div class="quote"></div>
        <div class="thread">
          <div class="turn turn-assistant">
            <div class="turn-label">${strings.title}</div>
            <div class="output loading">${strings.loading}</div>
          </div>
        </div>
      </div>
      <form class="follow-up">
        <input
          type="text"
          maxlength="${MAX_FOLLOWUP_LENGTH}"
          placeholder="${strings.followupPlaceholder}"
          aria-label="${strings.followupPlaceholder}"
        />
        <button type="submit">${strings.ask}</button>
      </form>
    `;
    win.querySelector(".quote").textContent = snapshot.selection;
    const output = win.querySelector(".output");
    const close = win.querySelector("header button");
    const followUpForm = win.querySelector(".follow-up");
    const followUpInput = followUpForm.querySelector("input");
    const history = [];
    close.addEventListener("click", () => closeWindow(win));
    followUpInput.addEventListener("input", () => {
      updateFollowUpState(followUpForm);
    });
    followUpForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitFollowUp({
        win,
        snapshot,
        history,
        input: followUpInput,
      });
    });
    enableDrag(win, win.querySelector("header"));
    positionWindow(win, snapshot.rect);
    document.documentElement.append(win);
    windows.push(win);

    setWindowBusy(followUpForm, true);
    runWindowRequest({
      snapshot,
      history,
      question: strings.action,
      output,
      loadingText: strings.loading,
    }).then((text) => {
      if (text) {
        history.push({ question: strings.action, answer: text });
      }
    }).finally(() => {
      setWindowBusy(followUpForm, false);
      followUpInput.focus();
    });
  }

  async function submitFollowUp({ win, snapshot, history, input }) {
    const question = input.value.trim();
    if (!question || input.disabled) {
      return;
    }
    const strings = getUiStrings();
    const form = win.querySelector(".follow-up");
    const thread = win.querySelector(".thread");
    const turn = document.createElement("div");
    turn.className = "turn turn-follow-up";
    turn.innerHTML = `
      <div class="turn-label">${strings.ask}</div>
      <div class="turn-user"></div>
      <div class="output loading"></div>
    `;
    turn.querySelector(".turn-user").textContent = question;
    const output = turn.querySelector(".output");
    thread.append(turn);
    input.value = "";
    setWindowBusy(form, true);
    await runWindowRequest({
      snapshot,
      history,
      question,
      output,
      loadingText: strings.asking,
    }).then((text) => {
      if (text) {
        history.push({ question, answer: text });
      }
    }).finally(() => {
      setWindowBusy(form, false);
      input.focus();
    });
  }

  function setWindowBusy(form, busy) {
    const input = form.querySelector("input");
    input.disabled = busy;
    form.dataset.busy = String(busy);
    updateFollowUpState(form);
    form.setAttribute("aria-busy", String(busy));
  }

  function updateFollowUpState(form) {
    const input = form.querySelector("input");
    const button = form.querySelector("button");
    button.disabled = form.dataset.busy === "true" || !input.value.trim();
  }

  function runWindowRequest({ snapshot, history, question, output, loadingText }) {
    let expired = false;
    let streamedText = "";
    output.textContent = loadingText;
    output.classList.add("loading");
    output.classList.remove("error");
    const onDelta = (delta) => {
      if (expired) {
        return;
      }
      streamedText += delta;
      renderRichText(output, formatExplanation(streamedText));
      output.classList.remove("loading");
    };
    const watchdog = setTimeout(() => {
      expired = true;
      output.textContent = `${getUiStrings().errorPrefix}${getUiStrings().timeout}`;
      output.classList.remove("loading");
      output.classList.add("error");
    }, REQUEST_TIMEOUT_MS);

    return requestExplanation(snapshot, onDelta, question, history)
      .then((text) => {
        if (expired) {
          return "";
        }
        renderRichText(output, formatExplanation(text));
        output.classList.remove("loading");
        return text;
      })
      .catch((error) => {
        if (expired) {
          return "";
        }
        output.textContent = `${getUiStrings().errorPrefix}${error.message || String(error)}`;
        output.classList.remove("loading");
        output.classList.add("error");
        return "";
      })
      .finally(() => {
        clearTimeout(watchdog);
      });
  }

  function closeWindow(win) {
    const index = windows.indexOf(win);
    if (index >= 0) {
      windows.splice(index, 1);
    }
    win.remove();
  }

  function enableDrag(win, handle) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = win.offsetLeft;
      const startTop = win.offsetTop;
      const onMove = (moveEvent) => {
        win.style.left = `${clamp(startLeft + moveEvent.clientX - startX, 4, window.innerWidth - 80)}px`;
        win.style.top = `${clamp(startTop + moveEvent.clientY - startY, 4, window.innerHeight - 40)}px`;
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  function positionWindow(win, anchorRect) {
    const count = windows.length - 1;
    const left = anchorRect
      ? clamp(anchorRect.right + 12, 8, Math.max(8, window.innerWidth - 320))
      : clamp(64 + count * 26, 8, Math.max(8, window.innerWidth - 360));
    const top = anchorRect
      ? clamp(anchorRect.top, 8, Math.max(8, window.innerHeight - 200))
      : clamp(72 + count * 24, 8, Math.max(8, window.innerHeight - 220));
    win.style.left = `${left}px`;
    win.style.top = `${top}px`;
  }

  function keepWindowInsideViewport(win) {
    const left = clamp(win.offsetLeft, 4, Math.max(4, window.innerWidth - 120));
    const top = clamp(win.offsetTop, 4, Math.max(4, window.innerHeight - 80));
    win.style.left = `${left}px`;
    win.style.top = `${top}px`;
  }

  async function requestExplanation(snapshot, onDelta, question, history) {
    return bridge.enqueue(
      {
        selection: snapshot.selection,
        context: {
          ...snapshot.context,
          appLanguage: detectAppLanguage(),
        },
        question,
        history,
        outputLanguage: "input",
      },
      onDelta,
    );
  }

  function formatExplanation(text) {
    return String(text || "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "");
  }

  function renderRichText(container, text) {
    const value = String(text || "");
    const fragment = document.createDocumentFragment();
    for (const segment of splitFormulaSegments(value)) {
      if (!segment.math) {
        fragment.append(document.createTextNode(segment.value));
        continue;
      }
      const formula = document.createElement("span");
      formula.className = segment.display ? "formula-block" : "formula-inline";
      try {
        if (!katex?.renderToString) {
          throw new Error("KaTeX is unavailable");
        }
        formula.innerHTML = katex.renderToString(segment.value, {
          displayMode: segment.display,
          throwOnError: true,
          strict: "ignore",
          trust: false,
        });
      } catch {
        formula.textContent = segment.raw;
      }
      fragment.append(formula);
    }
    container.replaceChildren(fragment);
  }

  function splitFormulaSegments(text) {
    const segments = [];
    let plainStart = 0;
    let index = 0;
    while (index < text.length) {
      const match = readFormulaAt(text, index);
      if (!match) {
        index += 1;
        continue;
      }
      if (match.start > plainStart) {
        segments.push({
          math: false,
          value: text.slice(plainStart, match.start),
        });
      }
      segments.push({
        math: true,
        value: match.value,
        raw: match.raw,
        display: match.display,
      });
      index = match.end;
      plainStart = index;
    }
    if (plainStart < text.length) {
      segments.push({ math: false, value: text.slice(plainStart) });
    }
    return segments;
  }

  function readFormulaAt(text, index) {
    if (text.startsWith("$$", index)) {
      return readDelimitedFormula(text, index, "$$", "$$", true);
    }
    if (text.startsWith("\\[", index)) {
      return readDelimitedFormula(text, index, "\\[", "\\]", true);
    }
    if (text.startsWith("\\(", index)) {
      return readDelimitedFormula(text, index, "\\(", "\\)", false);
    }
    if (
      text[index] !== "$"
      || text[index + 1] === "$"
      || isEscaped(text, index)
    ) {
      return null;
    }
    const closing = findClosingDelimiter(text, index + 1, "$");
    if (closing < 0) {
      return null;
    }
    const value = text.slice(index + 1, closing);
    if (
      !value.trim()
      || /^\s|\s$/.test(value)
      || value.includes("\n")
      || /\d/.test(text[closing + 1] || "")
    ) {
      return null;
    }
    return {
      start: index,
      end: closing + 1,
      value,
      raw: text.slice(index, closing + 1),
      display: false,
    };
  }

  function readDelimitedFormula(text, start, opening, closing, display) {
    const contentStart = start + opening.length;
    const closingIndex = findClosingDelimiter(text, contentStart, closing);
    if (closingIndex < 0) {
      return null;
    }
    const value = text.slice(contentStart, closingIndex);
    if (!value.trim()) {
      return null;
    }
    return {
      start,
      end: closingIndex + closing.length,
      value,
      raw: text.slice(start, closingIndex + closing.length),
      display,
    };
  }

  function findClosingDelimiter(text, start, delimiter) {
    let index = text.indexOf(delimiter, start);
    while (index >= 0) {
      if (!isEscaped(text, index)) {
        return index;
      }
      index = text.indexOf(delimiter, index + delimiter.length);
    }
    return -1;
  }

  function isEscaped(text, index) {
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    return backslashes % 2 === 1;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
})();
