// server.js — InfoHealth AI backend (Render)
// Env on Render: OPENAI_API_KEY (required for OpenAI)
// Optional: ANTHROPIC_API_KEY, GEMINI_API_KEY, ALLOWED_ORIGINS (comma-separated)

try { require("dotenv").config(); } catch {} // ok if dotenv not installed

const express = require("express");
const cors = require("cors");

const app  = express();
const PORT = process.env.PORT || 10000;

// ---- CORS ----
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);      // curl/Postman/same-origin
    if (allowed.length === 0) return cb(null, true); // allow all if unset
    return allowed.includes(origin)
      ? cb(null, true)
      : cb(new Error("Not allowed by CORS"));
  }
}));

app.use(express.json({ limit: "1mb" }));

// ---- Provider flags ----
const hasOpenAI    = !!process.env.OPENAI_API_KEY;
const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasGemini    = !!process.env.GEMINI_API_KEY;

// ---- Health ----
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    expects: "POST /chat with JSON { message, specialty?, prefer? }",
    hasOpenAI, hasAnthropic, hasGemini
  });
});

// Make GET /chat self-explanatory
app.get("/chat", (req, res) => {
  res.status(405).json({
    error: "Use POST /chat with JSON { message, specialty?, prefer? }",
    example: { message: "Neuropatía diabética: síntomas y manejo", prefer: { provider: "openai", lang: "es" } }
  });
});

// Silence favicon noise
app.get("/favicon.ico", (_req, res) => res.sendStatus(204));

// ---- Core chat ----
app.post("/chat", async (req, res) => {
  try {
    const { message, specialty = "", prefer = {} } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: 'Missing "message"' });
    }

    let provider = (prefer.provider || "auto").toLowerCase();
    const lang   = prefer.lang || "en";

    if (provider === "auto") {
      if (hasOpenAI) provider = "openai";
      else if (hasAnthropic) provider = "anthropic";
      else if (hasGemini) provider = "gemini";
      else return res.json({ text: `Echo: ${message}`, provider: "render-test" });
    }

    let text;
    if (provider === "openai")        text = await callOpenAI(message, lang, specialty);
    else if (provider === "anthropic") text = await callAnthropic(message, lang, specialty);
    else if (provider === "gemini")    text = await callGemini(message, lang, specialty);
    else throw new Error(`Unknown provider: ${provider}`);

    res.json({ text, provider });
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({ error: "Upstream error", details: String(err?.message || err) });
  }
});

// ---- Provider helpers (no SDKs; uses global fetch) ----
async function callOpenAI(userMessage, lang, specialty) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const sys = `You are a careful clinical assistant. Respond in ${lang}. If unsure, say so. Educational only, not medical advice. Specialty: ${specialty || "General"}.`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMessage }
      ]
    })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function callAnthropic(userMessage, lang, specialty) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const model = process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";
  const sys = `You are a careful clinical assistant. Respond in ${lang}. If unsure, say so. Educational only, not medical advice. Specialty: ${specialty || "General"}.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      temperature: 0.3,
      system: sys,
      messages: [{ role: "user", content: userMessage }]
    })
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const parts = data.content?.map(p => p.text).join("\n") || "";
  return parts.trim();
}

async function callGemini(userMessage, lang, specialty) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const sys = `You are a careful clinical assistant. Respond in ${lang}. If unsure, say so. Educational only, not medical advice. Specialty: ${specialty || "General"}.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${sys}\n\nUser: ${userMessage}` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 800 }
    })
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
  return text.trim();
}

// ---- Boot ----
app.listen(PORT, () => {
  console.log("Boot: providers", { hasOpenAI, hasAnthropic, hasGemini });
  console.log(`listening on ${PORT}`);
});
