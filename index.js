exports.chat = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    secrets: [OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY],
  },
  async (req, res) => {
    allow(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');

    // Friendly GET
    if (req.method === 'GET') {
      return res.json({
        ok: true,
        expects: 'POST with JSON { message, specialty?, prefer? }',
        hasOpenAI: !!OPENAI_API_KEY.value(),
        hasAnthropic: !!ANTHROPIC_API_KEY.value(),
        hasGemini: !!GEMINI_API_KEY.value(),
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

      // ---------- intent detection ----------
      const looksSpanish = isSpanish(message);
      const m = message.toLowerCase();

      const translateIntent =
        /\btranslate\b|\btradu(?:ce|cción)\b|\bqué significa\b|\bque significa\b|\bwhat does .* mean\b|\bdefine\b|\bdefinir\b/.test(m);

      // ---------- language routing ----------
      let targetLang = prefer.lang === 'es' ? 'es' : 'en';
      if (prefer.lang !== 'es' && prefer.lang !== 'en') {
        // no explicit preference → if message looks Spanish, aim for Spanish mode in chat,
        // but for translate intent, flip target
        targetLang = looksSpanish ? 'es' : 'en';
      }
      // For TRANSLATE intent: flip to the *other* language unless prefer.lang forces target
      let translateTarget = targetLang;
      if (translateIntent) {
        if (prefer.lang === 'es') translateTarget = 'es';
        else if (prefer.lang === 'en') translateTarget = 'en';
        else translateTarget = looksSpanish ? 'en' : 'es'; // flip automatically
      }

      // ---------- system directive ----------
      const system = translateIntent
        ? (
          translateTarget === 'es'
            ? 'You are a precise bilingual medical translator. Translate the user text into **Spanish** only. Preserve meaning and medical nuance. Output ONLY the translation, no preface.'
            : 'You are a precise bilingual medical translator. Translate the user text into **English** only. Preserve meaning and medical nuance. Output ONLY the translation, no preface.'
        )
        : buildDirective(targetLang, specialty);

      // ---------- provider selection ----------
      const openaiKey = OPENAI_API_KEY.value();
      const claudeKey = ANTHROPIC_API_KEY.value();
      const geminiKey = GEMINI_API_KEY.value();

      const providerPref = (prefer.provider || 'auto').toLowerCase(); // 'auto'|'openai'|'anthropic'|'gemini'
      const autoOrder = [];
      if (openaiKey) autoOrder.push('openai');
      if (geminiKey) autoOrder.push('gemini');
      if (claudeKey) autoOrder.push('anthropic');
      if (!autoOrder.length) autoOrder.push('gemini','openai','anthropic');

      const tryOrder = providerPref === 'auto' ? autoOrder : [providerPref];

      let text = '';
      let used = null;
      let lastErr = null;

      for (const p of tryOrder) {
        try {
          if (p === 'openai') { if (!openaiKey) throw new Error('OPENAI_API_KEY missing');
            text = await callOpenAI(openaiKey, message, system); used = 'openai'; break; }
          if (p === 'anthropic') { if (!claudeKey) throw new Error('ANTHROPIC_API_KEY missing');
            text = await callClaude(claudeKey, message, system); used = 'anthropic'; break; }
          if (p === 'gemini') { if (!geminiKey) throw new Error('GEMINI_API_KEY missing');
            text = await callGemini(geminiKey, message, system); used = 'gemini'; break; }
        } catch (e) { lastErr = e; }
      }

      if (!used) {
        const msg = (targetLang === 'es')
          ? "No pude contactar a los servicios de IA en este momento. Intente de nuevo o toque 'Inicio' para ver contenido de referencia."
          : "I couldn’t reach any AI providers right now. Please try again or tap Home to view reference content.";
        return res.status(200).json({ text: msg, provider: 'fallback', error: String(lastErr || '') });
      }

      const ms = Date.now() - t0;
      return res.status(200).json({
        text,
        provider: used,
        ms,
        lang: translateIntent ? translateTarget : targetLang,
        mode: translateIntent ? 'translate' : 'chat'
      });

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
