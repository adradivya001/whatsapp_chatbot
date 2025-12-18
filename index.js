require("dotenv").config();
const express = require("express");
const { handleIncomingMessage } = require("./controllers/messageController");

const app = express();
const PORT = 3000; // fixed port for local testing and ngrok tunnelling

// Parse JSON payloads sent by WhatsApp Cloud API
app.use(express.json());

// Simple health endpoint so you see something at "/"
app.get("/", (_req, res) => {
  res.send("WhatsApp webhook is running. Use /webhook for Meta verification and POST callbacks.");
});

// GET webhook verification
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    return res.status(200).send(challenge);
  }

  console.warn("Webhook verification failed", { mode, token, challenge });
  return res.sendStatus(403);
});

// POST webhook for inbound messages
app.post("/webhook", handleIncomingMessage);

app.listen(PORT, () => {
  console.log(`WhatsApp webhook listening on port ${PORT}`);
});
