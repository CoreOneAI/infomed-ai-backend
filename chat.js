// chat.js — frontend glue for InfoHealth AI
// Make sure this file is referenced by <script src="chat.js" defer></script> in index.html

// ====== CONFIG ======
const API_BASE = "https://infomed-ai-backend.onrender.com"; // <- your Render backend
const DEFAULT_LANG = localStorage.getItem("ih-lang") || "en";
let CURRENT_LANG = DEFAULT_LANG;

// ids that should exist in index.html
const IDS = {
  form:        "#chatForm",        // <form id="chatForm">
  input:       "#chatInput",       // <input id="chatInput">
  log:         "#chatLog",         // <div id="chatLog">
  providerSel: "#providerSelect",  // <select id="providerSelect"> (optional)
  esBtn:       "#btnEs",           // <button id="btnEs">ES</button> (optional)
  enBtn:       "#btnEn"            // <button id="btnEn">EN</button> (optional)
};

// ====== API ======
async function callChat(payload) {
  const r = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function callHealth() {
  const r = await fetch(`${API_BASE}/health`);
  return r.json();
}

// ====== UI helpers ======
function $(sel) { return document.querySelector(sel); }

function addBubble(text, who = "ai") {
  const log = $(IDS.log);
  const wrap = document.createElement("div");
  wrap.className = who === "user" ? "bubble user" : "bubble ai";
  wrap.innerHTML = (who === "ai")
    ? `<div class="ai-reply"></div>`
    : `<div class="user-msg"></div>`;
  const el = wrap.firstElementChild;
  log.appendChild(wrap);
  if (who === "ai") typewriter(el, text);
  else el.textContent = text;
  log.scrollTop = log.scrollHeight;
  return wrap;
}

// simple typewriter
function typewriter(el, text, speed = 12) {
  let i = 0;
  function step() {
    if (i <= text.length) {
      el.textContent = text.slice(0, i);
      i++;
      requestAnimationFrame(step);
    }
  }
  step();
}

// reset chat for each new question
function resetChat() {
  const log = $(IDS.log);
  if (log) log.innerHTML = "";
}

// blue home button after AI reply
function addHomeButton() {
  const log = $(IDS.log);
  const btn = document.createElement("button");
  btn.className = "btn-home";
  btn.textContent = "🏠 Home";
  btn.onclick = () => {
    // If your app has a goHome() implement it; otherwise fallback to reload
    if (typeof window.goHome === "function") window.goHome();
    else window.location.reload();
  };
  const holder = document.createElement("div");
  holder.style.textAlign = "center";
  holder.style.margin = "16px 0";
  holder.appendChild(btn);
  log.appendChild(holder);
}

// banner under each AI answer
function addDisclaimer() {
  const log = $(IDS.log);
  const p = document.createElement("div");
  p.className = "tiny-banner";
  p.innerHTML = `Educational only • Not medical advice • Sources on request.`;
  log.appendChild(p);
}

// ====== Language handling ======
function setLang(lang) {
  CURRENT_LANG = lang;
  localStorage.setItem("ih-lang", lang);
  document.documentElement.setAttribute("lang", lang);
}

function wireLangButtons() {
  const es = $(IDS.esBtn);
  const en = $(IDS.enBtn);
  if (es) es.addEventListener("click", () => setLang("es"));
  if (en) en.addEventListener("click", () => setLang("en"));
}

// optional: translate a few static labels if you provided ids/classes in HTML
function translateStaticUI() {
  // no-op placeholder; to fully localize static cards you’ll need a key map.
}

// ====== Boot ======
window.addEventListener("DOMContentLoaded", async () => {
  setLang(CURRENT_LANG);
  translateStaticUI();
  wireLangButtons();

  // probe backend
  try {
    const h = await callHealth();
    console.log("health:", h);
  } catch (e) {
    console.warn("health check failed", e);
  }

  const form  = $(IDS.form);
  const input = $(IDS.input);
  const log   = $(IDS.log);
  const providerSel = $(IDS.providerSel);

  if (!form || !input || !log) {
    console.warn("chat.js: missing required elements (#chatForm, #chatInput, #chatLog).");
    return;
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = (input.value || "").trim();
    if (!msg) return;

    // always start a fresh conversation per your request
    resetChat();

    // render user bubble
    addBubble(msg, "user");

    // build payload
    const prefer = { lang: CURRENT_LANG };
    const provider = providerSel?.value?.toLowerCase?.();
    if (provider && provider !== "auto") prefer.provider = provider;

    // read specialty from <meta name="app-specialty" content="...">
    const specialty = (document.querySelector('meta[name="app-specialty"]')?.content || "").trim();

    // send
    try {
      const t0 = performance.now();
      const resp = await callChat({ message: msg, specialty, prefer });
      const dt = Math.round(performance.now() - t0);
      const text = resp?.text || "(no text)";
      addBubble(text, "ai");
      addDisclaimer();
      addHomeButton();

      // debug footer (toggle with ?debug=1)
      if (new URLSearchParams(location.search).get("debug")) {
        const d = document.createElement("div");
        d.className = "debug-line";
        d.textContent = `provider=${resp?.provider || "n/a"} • ${dt}ms`;
        document.querySelector(IDS.log).appendChild(d);
      }
    } catch (err) {
      console.error("chat error:", err);
      addBubble(`Sorry, I couldn't reach the assistant.\n\n${String(err.message || err)}`, "ai");
      addHomeButton();
    } finally {
      input.value = "";
      input.focus();
    }
  });
});
