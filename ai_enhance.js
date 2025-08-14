// netlify/functions/ai_enhance.mjs
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
    const { base, topic, lang } = JSON.parse(event.body || "{}");
    if (!base || !topic) return json(400, { error: "Missing base/topic" });

    const safe = ["hypertension","cholesterol","asthma","diabetes"].includes(String(topic).toLowerCase());
    if (!safe) return json(200, { enhanced: base });

    const baseClamped = String(base).slice(0, 6000);
    const langHint = (lang === "es") ? "es" : "en";
    const prompt = `You are a medical education assistant. Expand and clarify the following patient-facing educational guidance for the topic "${topic}".
Rules:
- Educational only. Do NOT diagnose, prescribe, or provide individualized medical instructions.
- Use clear, plain language suitable for adults with average health literacy.
- Include practical self-care tips that are generally safe and widely accepted.
- Encourage patients to follow their clinician's plan and to seek care for red flags.
- Keep it concise (170-220 words).
- Language: ${langHint === "es" ? "Provide the answer in Spanish." : "Provide the answer in English."}

Base guidance to enrich:
${baseClamped}`;

    let enhanced = null;

    // 1) OpenAI
    try {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You write safe, non-diagnostic patient education." },
              { role: "user", content: prompt }
            ],
            temperature: 0.4, max_tokens: 400
          })
        });
        if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
        const j = await r.json();
        enhanced = j?.choices?.[0]?.message?.content;
      }
    } catch (e) { /* fall through */ }

    // 2) Claude
    if (!enhanced) {
      try {
        const claudeKey = process.env.CLAUDE_API_KEY;
        if (claudeKey) {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": claudeKey,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: "claude-3-5-sonnet-20240620",
              max_tokens: 400, temperature: 0.4,
              system: "You write safe, non-diagnostic patient education.",
              messages: [{ role: "user", content: prompt }]
            })
          });
          if (!r.ok) throw new Error(`Claude HTTP ${r.status}`);
          const j = await r.json();
          if (Array.isArray(j?.content)) enhanced = j.content.map(x => x.text || "").join("\n").trim();
          else if (typeof j?.content === "string") enhanced = j.content;
        }
      } catch (e) { /* fall through */ }
    }

    // 3) Gemini (as last fallback)
    if (!enhanced) {
      try {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (geminiKey) {
          const r = await fetch("https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=" + geminiKey, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 400 }
            })
          });
          if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
          const j = await r.json();
          enhanced = j?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\n").trim();
        }
      } catch (e) { /* fall through */ }
    }

    if (!enhanced) enhanced = baseClamped;
    return json(200, { enhanced });
  } catch (e) {
    return json(500, { error: e.message || "Server error" });
  }
}
function json(status, obj){ return { statusCode: status, body: JSON.stringify(obj), headers: { "Content-Type": "application/json" } }; }
