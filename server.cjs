console.log("Boot: providers", {
  hasOpenAI: !!process.env.OPENAI_API_KEY,
  hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
  hasGemini: !!process.env.GEMINI_API_KEY
});
