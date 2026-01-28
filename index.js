require("dotenv").config();
const express = require("express");
const { handleIncomingMessage } = require("./controllers/messageController");
const { sendMessage } = require("./config/whatsapp");

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

// ==========================================
// INTERNAL API FOR BACKEND
// ==========================================
app.post("/v1/send-message", async (req, res) => {
  const secret = req.headers["x-internal-secret"];
  const expectedSecret = process.env.INTERNAL_API_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    console.warn("Unauthorized attempt to send message", { secret });
    return res.sendStatus(401);
  }

  const { phone, message, media_url, template_name, language_code, components, body_parameters, body_parameters_named } = req.body;

  // Validate: Need phone + at least one of: message, media_url, or template_name
  if (!phone || (!message && !media_url && !template_name)) {
    return res.status(400).json({ error: "Missing phone or message/media_url/template_name" });
  }

  try {
    // Template Message (for cold marketing / outside 24h window)
    if (template_name) {
      const templatePayload = {
        type: "template",
        template_name,
        language_code: language_code || "en_IN",
        components: components || [],
        body_parameters: body_parameters || [],
        body_parameters_named: body_parameters_named || null, // For {{name}} style templates
      };
      await sendMessage(phone, templatePayload);
      return res.json({ status: "success", phone, type: "template" });
    }

    // Free-form Text Message (within 24h window)
    if (message) {
      await sendMessage(phone, message);
    }

    // Media Message
    if (media_url) {
      const mediaMessage = {
        type: "image",
        image: { link: media_url }
      };
      await sendMessage(phone, mediaMessage);
    }

    return res.json({ status: "success", phone, type: "freeform" });
  } catch (error) {
    console.error("Failed to send internal message:", error);
    return res.status(500).json({ error: "Failed to send message" });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp webhook listening on port ${PORT}`);
});
