const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// keep root alive for HEAD/GET
app.get("/", (_req, res) => res.type("text/plain").send("ok"));

// health endpoint for Render checks
app.get("/health", (_req, res) => {
  res.json({ status: "ok", expects: "POST /chat JSON { message, specialty?, prefer? }" });
});

// minimal chat echo (replace later with OpenAI/Claude/Gemini router)
app.post("/chat", (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "missing message" });
  res.json({ text: `Echo: ${message}`, provider: "local-test" });
});

// IMPORTANT: listen on Render's assigned PORT
const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log("listening on", port));
