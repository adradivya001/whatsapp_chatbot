const axios = require("axios");
const { sendMessage, uploadExternalImageAsMedia } = require("../config/whatsapp");

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================
const SUPPORT_API_URL = process.env.SAKHI_API_URL || "http://72.61.228.9:8000/sakhi/chat";
const SUPPORT_API_TIMEOUT_MS = Number(process.env.SAKHI_API_TIMEOUT_MS || 20000);

const MAX_BODY_API_LIMIT = 1024;
const PREVIEW_CHAR_LIMIT = 250;
const PROCESSED_MESSAGE_TTL_MS = 5 * 60 * 1000;
const PROCESSED_MESSAGE_CACHE_LIMIT = 500;
const FOLLOW_UP_TITLE_EMOJIS = ["1️⃣", "2️⃣", "3️⃣"];
const MAX_FOLLOW_UP_DESCRIPTION_CHARS = 72;

const processedMessageIds = new Map();

// ==========================================
// WEBHOOK ENTRY POINT
// ==========================================
exports.handleIncomingMessage = async (req, res) => {
  console.log("Incoming webhook payload:", JSON.stringify(req.body, null, 2));

  if (!req.body || !req.body.object || !Array.isArray(req.body.entry)) {
    return res.sendStatus(404);
  }

  try {
    const messageInfo = extractMessageInfo(req.body);
    const statusInfo = extractStatusInfo(req.body);

    if (messageInfo?.text) {
      console.log(`Extracted message from ${messageInfo.from}: ${messageInfo.text}`);
      await handleChatAndReply(messageInfo);
    } else if (statusInfo) {
      console.log(`Status update for ${statusInfo.id}: ${statusInfo.status}`);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Failed to process webhook:", error);
    return res.sendStatus(200);
  }
};

// ==========================================
// INBOUND DATA EXTRACTION
// ==========================================
function extractMessageInfo(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const messages = value.messages;

      if (!Array.isArray(messages) || !messages.length) continue;

      const message = messages[0];
      let text = message.text?.body || null;

      // Button Reply
      const buttonReply = message.interactive?.button_reply;
      if (buttonReply && !text) {
        text = buttonReply.title || buttonReply.id || null;
      }

      // List Reply
      const listReply = message.interactive?.list_reply;
      if (listReply) {
        const listId = listReply.id || "";
        const selectedText = listReply.description || listReply.title || "";
        const isFollowUpSelection = typeof listId === "string" && listId.startsWith("followup_");
        
        const cleanedSelection = isFollowUpSelection
          ? normaliseFollowUpLabel(selectedText)
          : selectedText.trim();

        if (cleanedSelection) {
          text = cleanedSelection;
        } else if (!text) {
          text = selectedText || null;
        }
      }

      if (!text) {
        text = message.interactive?.list_reply?.title || message.interactive?.list_reply?.description || null;
      }

      return {
        from: message.from || value.metadata?.phone_number_id || null,
        text,
        id: message.id || null,
        raw: message,
      };
    }
  }
  return null;
}

function extractStatusInfo(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const statuses = value.statuses;
      if (!Array.isArray(statuses) || !statuses.length) continue;
      
      const status = statuses[0];
      return {
        id: status.id || null,
        status: status.status || null,
        timestamp: status.timestamp || null,
      };
    }
  }
  return null;
}

// ==========================================
// CORE LOGIC: CHAT & REPLY
// ==========================================
async function handleChatAndReply(messageInfo) {
  if (messageInfo?.id && hasProcessedMessage(messageInfo.id)) {
    console.log("Duplicate inbound message ignored", { id: messageInfo.id });
    return;
  }

  const phoneNumber = normalisePhoneNumberForApi(messageInfo.from);

  const payload = {
    user_id: null,
    phone_number: phoneNumber,
    message: messageInfo.text,
    language: "en",
  };

  console.log("Calling support API", { url: SUPPORT_API_URL });

  try {
    const response = await axios.post(SUPPORT_API_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: SUPPORT_API_TIMEOUT_MS,
      validateStatus: (status) => status >= 200 && status < 500,
    });

    if (response.status >= 400) {
      console.error("Support API returned error", { status: response.status, data: response.data });
      return;
    }

    // Onboarding
    if (response.data?.mode === "onboarding_complete") {
      const replyText = response.data?.reply;
      if (replyText) await sendMessage(messageInfo.from, replyText);

      const introImageUrl = "https://fxmahshkttkccevualan.supabase.co/storage/v1/object/public/sakhi_infographics/Sakhi_Intro-min.png";
      await sendMessage(messageInfo.from, { type: "image", image: { link: introImageUrl } });
      await sendMessage(messageInfo.from, buildOnboardingFooterMessage());
      return;
    }

    // Standard Reply
    const replyText = response.data?.reply;
    if (!replyText) {
      console.warn("Support API returned no reply field");
      return;
    }

    const { mainText, youtubeLink, followUps } = parseReply(
      replyText,
      response.data?.youtube_link
    );
    
    const infographicAttachment = await prepareInfographicAttachment(response.data?.infographic_url);
    
    const outboundMessages = buildResponseMessages(
      mainText,
      youtubeLink,
      followUps,
      infographicAttachment
    );

    const limitedMessages = selectUniqueMessages(outboundMessages, 3);

    if (!limitedMessages.length) {
      console.warn("Could not build WhatsApp message from API reply");
      return;
    }

    for (const outboundMessage of limitedMessages) {
      await sendMessage(messageInfo.from, outboundMessage);
    }
  } catch (error) {
    const details = error.response?.data || error.message;
    console.error("Failed calling support API:", details);
  }
}

// ==========================================
// RESPONSE PARSING & BUILDING
// ==========================================
function parseReply(replyText, preferredYoutubeLink = null) {
  const safeText = typeof replyText === "string" ? replyText : "";
  const followUps = extractFollowUps(safeText);
  const textWithoutFollowUps = removeFollowUpsBlock(safeText);

  let youtubeLink = preferredYoutubeLink || null;
  let processedText = textWithoutFollowUps;

  if (!youtubeLink) {
    const urlMatch = processedText.match(/https?:\/\/\S+/);
    youtubeLink = urlMatch ? urlMatch[0] : null;
  }

  if (youtubeLink) {
    youtubeLink = youtubeLink.replace(/[.,;:!?]+$/, "");
  }

  const linkIndex = youtubeLink ? processedText.indexOf(youtubeLink) : -1;
  const beforeLink = linkIndex >= 0 ? processedText.slice(0, linkIndex).trim() : processedText.trim();

  return { mainText: beforeLink, youtubeLink, followUps };
}

function extractFollowUps(text) {
  if (!text) return [];
  const markerRegex = /follow[\s-]*ups?\s*:/i;
  const match = markerRegex.exec(text);
  if (!match) return [];
  
  const blockStart = match.index + match[0].length;
  const block = text.slice(blockStart).trim();
  
  return block.split(/\r?\n/).map(normaliseFollowUpLabel).filter(Boolean).slice(0, 10);
}

function removeFollowUpsBlock(text) {
  if (!text) return "";
  const markerRegex = /follow[\s-]*ups?\s*:/i;
  const match = markerRegex.exec(text);
  if (!match) return text.trim();
  return text.slice(0, match.index).trimEnd();
}

function buildResponseMessages(mainText, youtubeLink, followUps, infographicAttachment) {
  const messages = [];

  if (youtubeLink) {
    messages.push(youtubeLink.trim());
  }

  // 1. Clean and Truncate the text
  const replyBody = buildReplyBody(mainText);

  // 2. Try to bundle Text + Buttons into ONE message
  const combinedInteractive = buildFollowUpButtons(followUps, replyBody);

  if (combinedInteractive) {
    messages.push(combinedInteractive);
  } else if (replyBody) {
    // If no buttons, just send text
    messages.push(replyBody);
  }

  const infographicMessage = buildInfographicMessage(infographicAttachment);
  if (infographicMessage) {
    messages.push(infographicMessage);
  }

  return messages;
}

// ==========================================
// INTERACTIVE MESSAGE BUILDERS
// ==========================================
function buildFollowUpButtons(options, bodyText) {
  const rows = formatFollowUpRows(options);
  if (!rows.length) {
    return null;
  }

  // Fallback text if body is empty
  const cleanBody = bodyText || "Choose a follow-up option below:";

  return {
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: "",
      },
      body: {
        text: cleanBody, 
      },
      footer: {
        text: "Tap to select an item",
      },
      action: {
        button: "Follow-up Questions",
        sections: [
          {
            title: "Next steps",
            rows,
          },
        ],
      },
    },
  };
}

function formatFollowUpRows(options = []) {
  return (options || [])
    .slice(0, 3)
    .map((rawOption, index) => createFollowUpRow(rawOption, index))
    .filter(Boolean);
}

function createFollowUpRow(rawLabel, index) {
  const trimmedLabel = normaliseFollowUpLabel(rawLabel);
  if (!trimmedLabel) return null;

  const slugSource = summariseFollowUpTitle(trimmedLabel);
  const slug = slugSource
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || `option_${index + 1}`;

  const rawTitle = FOLLOW_UP_TITLE_EMOJIS[index] || `${index + 1}.`;

  return {
    id: `followup_${index + 1}_${slug}`.slice(0, 200),
    title: rawTitle.substring(0, 24),
    description: truncateFollowUpDescription(trimmedLabel),
  };
}

// ==========================================
// UTILITY HELPERS
// ==========================================

// This function manages the "Read more" logic without gaps
function buildReplyBody(mainText) {
  const trimmedMain = stripTrailingYoutubeLabel(mainText?.trim());
  if (!trimmedMain) {
    return null;
  }

  // If text is short, return it as is
  if (trimmedMain.length <= PREVIEW_CHAR_LIMIT) {
    return trimmedMain;
  }

  // 1. Split into Preview and Remainder
  const preview = trimmedMain.slice(0, PREVIEW_CHAR_LIMIT);
  const remainder = trimmedMain.slice(PREVIEW_CHAR_LIMIT);
  const readMoreLabel = "";

  // 2. Calculate available space for invisible padding
  // We want to fill the message up to the 1024 limit with invisible characters
  // This "weight" forces WhatsApp to collapse the message cleanly.
  const usedChars = preview.length + readMoreLabel.length + remainder.length;
  const availableSpace = MAX_BODY_API_LIMIT - usedChars;
  
  // 3. Create invisible separator (Zero Width Space: \u200B)
  // We don't use newlines (\n) to avoid the "Gap" issue.
  let separator = "";
  if (availableSpace > 0) {
    // Fill remaining space with invisible chars (safely capped at 600 to be sure)
    const fillCount = Math.min(availableSpace, 600); 
    separator = "\u200B".repeat(fillCount);
  }

  // 4. Construct Final Body
  let fullBody = `${preview}${readMoreLabel}${separator}${remainder}`;

  // 5. Final Safety: Ensure we NEVER exceed 1024 (WhatsApp API hard limit)
  if (fullBody.length > MAX_BODY_API_LIMIT) {
    // If we are over the limit, we must cut the remainder.
    // We prioritize keeping the preview and the "Read more" label.
    fullBody = fullBody.slice(0, MAX_BODY_API_LIMIT - 3) + "...";
  }

  return fullBody;
}

function normaliseFollowUpLabel(value) {
  if (typeof value !== "string") return "";
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^follow[\s-]*ups?\s*:?\s*/i, "");
  cleaned = cleaned.replace(/^[-*\u2022]+/, "").trimStart();
  cleaned = cleaned.replace(/^\(?\s*(\d{1,2}|[a-z])\)?[.)-]?\s+/i, "");
  return cleaned.trim();
}

function summariseFollowUpTitle(text) {
  const sentenceMatch = text.match(/^[^.!?\n\r]{5,80}/);
  if (sentenceMatch) return sentenceMatch[0].trim();
  return text.split(/\s+/).slice(0, 5).join(" ").trim() || "Follow-up";
}

function truncateFollowUpDescription(text) {
  const safe = typeof text === "string" ? text.trim() : "";
  if (!safe) return "";
  if (safe.length <= MAX_FOLLOW_UP_DESCRIPTION_CHARS) {
    return safe;
  }
  return `${safe.slice(0, MAX_FOLLOW_UP_DESCRIPTION_CHARS - 3).trimEnd()}...`;
}

function normalisePhoneNumberForApi(raw) {
  if (!raw) return null;
  return raw.startsWith("+") ? raw : `+${raw}`;
}

function stripTrailingYoutubeLabel(text) {
  if (!text) return text;
  return text.replace(/(?:\r?\n)*\s*youtube\s*:?\s*$/i, "").trimEnd();
}

function buildInfographicMessage(attachment) {
  if (!attachment) return null;
  if (attachment.mediaId) {
    return { type: "image", image: { id: attachment.mediaId } };
  }
  const trimmedUrl = typeof attachment.link === "string" ? attachment.link.trim() : null;
  if (!trimmedUrl) return null;
  return { type: "image", image: { link: trimmedUrl } };
}

async function prepareInfographicAttachment(url) {
  const trimmedUrl = typeof url === "string" ? url.trim() : "";
  if (!trimmedUrl) return null;
  try {
    const mediaId = await uploadExternalImageAsMedia(trimmedUrl);
    if (mediaId) return { mediaId };
  } catch (error) {
    console.error("Unable to upload infographic image:", error.message || error);
  }
  return { link: trimmedUrl };
}

function selectUniqueMessages(messages, limit = 3) {
  if (!Array.isArray(messages) || !messages.length || limit <= 0) {
    return [];
  }

  const unique = [];
  const seen = new Set();

  for (const message of messages) {
    if (unique.length >= limit) break;

    const key =
      typeof message === "string" || typeof message === "number"
        ? `text:${message}`
        : `json:${JSON.stringify(message)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(message);
  }

  return unique;
}

function hasProcessedMessage(messageId) {
  if (!messageId) {
    return false;
  }

  const now = Date.now();
  pruneProcessedMessages(now);

  if (processedMessageIds.has(messageId)) {
    return true;
  }

  processedMessageIds.set(messageId, now);
  return false;
}

function pruneProcessedMessages(currentTime = Date.now()) {
  if (!processedMessageIds.size) {
    return;
  }

  for (const [id, timestamp] of processedMessageIds) {
    if (currentTime - timestamp > PROCESSED_MESSAGE_TTL_MS) {
      processedMessageIds.delete(id);
    }
  }

  while (processedMessageIds.size > PROCESSED_MESSAGE_CACHE_LIMIT) {
    const oldestKey = processedMessageIds.keys().next().value;
    if (!oldestKey) {
      break;
    }
    processedMessageIds.delete(oldestKey);
  }
}
