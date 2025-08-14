import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

function langInstruction(lang){
  return lang === "es"
    ? "Responde en español claro y conciso, con encabezados y viñetas cuando ayude la comprensión."
    : "Answer in clear, concise English with headings and bullets when helpful.";
}
function systemPreamble(lang, specialty){
  const disclaimers = lang === "es"
    ? "No des consejos médicos personalizados. Señala signos de alarma y anima a buscar atención presencial. Sé neutral y educativo."
    : "Do not give personalized medical advice. Flag red-flag symptoms and encourage in-person care. Be neutral and educational.";
  return `${langInstruction(lang)} You are an educational assistant for ${specialty || "General Medicine"}. ${disclaimers}`;
}

async function callOpenAI({content, lang}) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.3,
      messages: [{ role: "system", content: langInstruction(lang) }, { role: "user", content }] })
  });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return { text: j?.choices?.[0]?.message?.content || "", provider: "openai", model };
}

async function callAnthropic({content, lang}) {
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1200, temperature: 0.3,
      system: langInstruction(lang), messages: [{ role: "user", content }] })
  });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  const text = (j?.content || []).map(p => p.text).filter(Boolean).join("\n");
  return { text, provider: "anthropic", model };
}

async function callGemini({content, lang}) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: systemPreamble(lang) }, { text: content }] }], generationConfig: { temperature: 0.3 } })
  });
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text).join("\n");
  return { text, provider: "gemini", model };
}

app.get("/health", (req, res) => {
  res.json({ status: "ok",
    hasOpenAI: !!OPENAI_API_KEY, hasAnthropic: !!ANTHROPIC_API_KEY, hasGemini: !!GEMINI_API_KEY });
});

app.post("/chat", async (req, res) => {
  try {
    const { message, specialty = "General", prefer = {} } = req.body || {};
    if (!message) return res.status(400).json({ error: "missing message" });
    const lang = prefer.lang === "es" ? "es" : "en";
    const content = `${systemPreamble(lang, specialty)}\n\nUser: ${message}`;
    const order = (prefer.provider || "auto").toLowerCase();
    const tryOrder =
      order === "openai" ? ["openai","anthropic","gemini"] :
      order === "anthropic" ? ["anthropic","openai","gemini"] :
      order === "gemini" ? ["gemini","openai","anthropic"] :
      ["openai","anthropic","gemini"];
    let lastErr;
    for (const p of tryOrder) {
      try {
        if (p === "openai" && OPENAI_API_KEY) return res.json(await callOpenAI({content, lang}));
        if (p === "anthropic" && ANTHROPIC_API_KEY) return res.json(await callAnthropic({content, lang}));
        if (p === "gemini" && GEMINI_API_KEY) return res.json(await callGemini({content, lang}));
      } catch (e) { lastErr = e; continue; }
    }
    res.status(502).json({ error: "all_providers_failed", detail: String(lastErr || "no_keys") });
  } catch (e) {
    res.status(500).json({ error: "chat_failed", detail: String(e) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("listening on", port));
