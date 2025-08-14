// functions/index.js — Firebase Functions v2 (Node.js 22)
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// ---- Secrets (already set via `firebase functions:secrets:set ...`) ----
const OPENAI_API_KEY    = defineSecret('OPENAI_API_KEY');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GEMINI_API_KEY    = defineSecret('GEMINI_API_KEY');

// ---- CORS helper ----
function allow(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
}

// ---- Language helpers ----
function isSpanish(s = '') {
  const hasAccent = /[áéíóúñü¿¡]/i.test(s);
  const common = /\b(el|la|los|las|un|una|de|del|al|que|y|para|por|con|sin|cómo|qué|cuándo|dónde|porque|tengo|dolor|neuropatía|diabética|síntomas)\b/i.test(
    s
  );
  return hasAccent || common;
}
function buildDirective(lang, specialty) {
  const base =
    'You are a careful medical information assistant. Educational only; not medical advice.';
  const es = 'Responde en español claro y profesional.';
  const en = 'Respond in concise, plain English.';
  return [base, lang === 'es' ? es : en, `Specialty context: ${specialty || 'General'}.`].join(
    ' '
  );
}

// ---- Provider calls (using global fetch on Node 22) ----
async function callOpenAI(apiKey, userMsg, system, model = 'gpt-4o-mini') {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content?.trim() || '';
}

async function callClaude(apiKey, userMsg, system, model = 'claude-3-5-sonnet-20240620') {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: userMsg }],
      temperature: 0.3,
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const block = j.content?.[0];
  if (!block) return '';
  if (block.type === 'text') return (block.text || '').trim();
  if (block.text) return (block.text || '').trim();
  return '';
}

async function callGemini(apiKey, userMsg, system, model = 'gemini-1.5-flash-latest') {
  const prompt = `${system}\n\n${userMsg}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text =
    j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
    j.candidates?.[0]?.content?.parts?.[0]?.text ||
    '';
  return (text || '').trim();
}

// ---- /health: quick liveness check ----
exports.health = onRequest({ region: 'us-central1' }, (req, res) => {
  allow(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  return res.json({ ok: true, ts: Date.now() });
});

// ---- /chat: main endpoint ----
exports.chat = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    secrets: [OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY],
  },
  async (req, res) => {
    allow(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    // Friendly GET so you can open in a browser without a 405
    if (req.method === 'GET') {
      return res.json({
        ok: true,
        usage: 'POST JSON: { "message": "...", "specialty": "General", "prefer": { "lang": "en|es", "provider": "auto|openai|anthropic|gemini" } }',
        example: {
          message: 'Neuropatía diabética: síntomas y manejo',
          specialty: 'General',
          prefer: { lang: 'es', provider: 'auto' },
        },
      });
    }

    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const t0 = Date.now();
    try {
      const body = req.body || {};
      const message = (body.message || '').toString();
      const specialty = (body.specialty || 'General').toString();
      const prefer = body.prefer || {};

      if (!message) return res.status(400).json({ error: 'message required' });

      // Language: honor client toggle; if English but looks Spanish, auto-switch
      let targetLang = prefer.lang === 'es' ? 'es' : 'en';
      if (targetLang === 'en' && isSpanish(message)) targetLang = 'es';

      const providerPref = (prefer.provider || 'auto').toLowerCase(); // auto|openai|anthropic|gemini
      const system = buildDirective(targetLang, specialty);

      // secrets
      const openaiKey = OPENAI_API_KEY.value();
      const claudeKey = ANTHROPIC_API_KEY.value();
      const geminiKey = GEMINI_API_KEY.value();

      // Choose order for 'auto' based on what keys exist
      const autoOrder = [];
      if (openaiKey) autoOrder.push('openai');
      if (geminiKey) autoOrder.push('gemini');
      if (claudeKey) autoOrder.push('anthropic');
      if (autoOrder.length === 0) autoOrder.push('gemini', 'openai', 'anthropic'); // last-resort order

      const tryOrder = providerPref === 'auto' ? autoOrder : [providerPref];

      let text = '';
      let used = null;
      let lastErr = null;

      for (const p of tryOrder) {
        try {
          if (p === 'openai') {
            if (!openaiKey) throw new Error('OPENAI_API_KEY missing');
            text = await callOpenAI(openaiKey, message, system);
            used = 'openai';
            break;
          }
          if (p === 'anthropic') {
            if (!claudeKey) throw new Error('ANTHROPIC_API_KEY missing');
            text = await callClaude(claudeKey, message, system);
            used = 'anthropic';
            break;
          }
          if (p === 'gemini') {
            if (!geminiKey) throw new Error('GEMINI_API_KEY missing');
            text = await callGemini(geminiKey, message, system);
            used = 'gemini';
            break;
          }
        } catch (e) {
          lastErr = e;
          // continue to next provider
        }
      }

      if (!used) {
        const msg =
          targetLang === 'es'
            ? "No pude contactar a los servicios de IA en este momento. Intente de nuevo o toque 'Inicio' para ver contenido de referencia."
            : 'I couldn’t reach any AI providers right now. Please try again or tap Home to view reference content.';
        return res
          .status(200)
          .json({ text: msg, provider: 'fallback', error: String(lastErr || '') });
      }

      const ms = Date.now() - t0;
      return res.status(200).json({ text, provider: used, ms, lang: targetLang });
    } catch (err) {
      const ms = Date.now() - t0;
      console.error('chat error:', err);
      return res.status(200).json({
        text: 'I hit an unexpected error. Please try again in a moment.',
        provider: 'error',
        ms,
        error: String(err),
      });
    }
  }
);
