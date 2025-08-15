const express = require("express");
const cors = require("cors");

const app = express();

/** ---------- CORS ---------- */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  allowedOrigins.push(
    "http://localhost:8080",
    "http://localhost:8081",
    "https://infomed-one.netlify.app",
    "https://infohealth-ai.netlify.app"
  );
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    cb(null, allowedOrigins.includes(origin));
  },
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "1mb" }));

/** ---------- Boot log (helps confirm env on Render) ---------- */
console.log("Boot: providers", {
  hasOpenAI: !!process.env.OPENAI_API_KEY,
  hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
  hasGemini: !!process.env.GEMINI_API_KEY
});

/** ---------- Health ---------- */
const CFG = {
  OPENAI_MODEL:     process.env.OPENAI_MODEL     || "gpt-4o-mini",
  ANTHROPIC_MODEL:  process.env.ANTHROPIC_MODEL  || "claude-3-haiku-20240307",
  GEMINI_MODEL:     process.env.GEMINI_MODEL     || "gemini-1.5-flash-latest",
  ANTHROPIC_VERSION:process.env.ANTHROPIC_VERSION|| "2023-06-01",
};

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    expects: "POST /chat with JSON { message, specialty?, prefer? }",
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
    hasGemini: !!process.env.GEMINI_API_KEY,
    models: {
      openai: CFG.OPENAI_MODEL,
      anthropic: CFG.ANTHROPIC_MODEL,
      gemini: CFG.GEMINI_MODEL
    }
  });
});

/** ---------- Friendly GET /chat (stops 404 noise) ---------- */
app.get("/chat", (_req, res) => {
  res.status(405).type("text/plain")
     .send("Use POST /chat with JSON { message, specialty?, prefer? }");
});

/** ---------- Chat ---------- */
app.post("/chat", async (req, res) => {
  try {
    const { message, specialty = "General", prefer = {} } = req.body || {};
    if (!message) return res.status(400).json({ error: "missing message" });

    const lang = (prefer.lang || "en").toLowerCase();
    const providerReq = (prefer.provider || "auto").toLowerCase();
    const system = buildSystemPrompt(lang, specialty);

    const out = await chooseProvider(providerReq, system, message);
    out.notice = "Educational only • Not medical advice";
    out.lang = lang; out.specialty = specialty;
    res.json(out);
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

function buildSystemPrompt(lang, specialty) {
  const langName = lang === "es" ? "español" : "English";
  return [
    `You are InfoHealth AI, a careful medical assistant for ${specialty}.`,
    `Respond only in ${langName}.`,
    `Be concise, structured, and actionable for laypeople.`,
    `Do not diagnose; encourage clinician follow-up appropriately.`,
    `Add brief safety caveats when clinically relevant.`
  ].join(" ");
}

async function chooseProvider(providerReq, system, user) {
  if (providerReq === "openai")    return callOpenAI(system, user);
  if (providerReq === "anthropic") return callAnthropic(system, user);
  if (providerReq === "gemini")    return callGemini(system, user);

  if (process.env.OPENAI_API_KEY)    return callOpenAI(system, user);
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic(system, user);
  if (process.env.GEMINI_API_KEY)    return callGemini(system, user);

  return { text: `Echo: ${user}`, provider: "render-test" };
}

// OpenAI
async function callOpenAI(system, user) {
  if (!process.env.OPENAI_API_KEY) return { text: `Echo: ${user}`, provider: "openai-missing-key" };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: CFG.OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text().catch(()=>"<no-body>")}`);
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content?.trim() || "";
  return { text, provider: "openai", model: CFG.OPENAI_MODEL };
}

// Anthropic
async function callAnthropic(system, user) {
  if (!process.env.ANTHROPIC_API_KEY) return { text: `Echo: ${user}`, provider: "anthropic-missing-key" };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": CFG.ANTHROPIC_VERSION,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: CFG.ANTHROPIC_MODEL,
      max_tokens: 800,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text().catch(()=>"<no-body>")}`);
  const j = await r.json();
  const text = (j?.content?.[0]?.text || "").trim();
  return { text, provider: "anthropic", model: CFG.ANTHROPIC_MODEL };
}

// Gemini
async function callGemini(system, user) {
  if (!process.env.GEMINI_API_KEY) return { text: `Echo: ${user}`, provider: "gemini-missing-key" };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CFG.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: { temperature: 0.2 }
    })
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text().catch(()=>"<no-body>")}`);
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  return { text, provider: "gemini", model: CFG.GEMINI_MODEL };
}

app.get("/", (_req, res) => res.type("text/plain").send("ok"));

const port = Number(process.env.PORT) || 8080;
if (!app.locals._listening) {
  app.locals._listening = true;
  app.listen(port, () => console.log("listening on", port));
}
