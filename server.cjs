const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.type("text/plain").send("ok"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.post("/chat", (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "missing message" });
  res.json({ text: `Echo: ${message}`, provider: "local-test" });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log("listening on", port));
