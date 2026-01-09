const axios = require("axios");
const FormData = require("form-data");
const path = require("path");
let sharp = null;
try {
  sharp = require("sharp");
} catch (err) {
  sharp = null;
}
require("dotenv").config();

const graphUrl = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`;
const mediaUploadUrl = `https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/media`;
const defaultHeaders = {
  Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  "Content-Type": "application/json",
};
const MAX_WHATSAPP_TEXT_CHARS = 4096;
const MAX_WHATSAPP_IMAGE_BYTES = 5 * 1024 * 1024 - 20 * 1024; // keep buffer under hard 5 MB limit

const TOPIC_MENU_ROWS = [
  { id: "topic_ivf", title: "IVF", description: "In vitro fertilisation guidance" },
  { id: "topic_fertility", title: "Fertility", description: "Fertility checks and tips" },
  { id: "topic_parenthood", title: "Parenthood", description: "Support on becoming a parent" },
  { id: "topic_pregnancy", title: "Pregnancy", description: "Prenatal care and wellbeing" },
  { id: "topic_ovulation", title: "Ovulation", description: "Tracking and optimisation advice" },
  { id: "topic_infertility", title: "Infertility", description: "Causes, options, and support" },
];

const buildTopicMenuMessage = (bodyText, rows = TOPIC_MENU_ROWS) => {
  const options = (rows || [])
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || undefined,
    }))
    .filter((row) => row.id && row.title);

  if (!options.length) {
    throw new Error("Topic menu requires at least one option");
  }

  const headline =
    (typeof bodyText === "string" && bodyText.trim()) ||
    "Hello! How can I assist you today?";

  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: headline.slice(0, 1024) },
      footer: { text: "Pick a topic to continue." },
      action: {
        button: "Browse topics",
        sections: [{ title: "Support areas", rows: options }],
      },
    },
  };
};

const postWhatsAppMessage = async (payload) => {
  await axios.post(graphUrl, payload, { headers: defaultHeaders });
};

const buildOutboundPayload = (to, message) => {
  if (typeof message === "string") {
    return {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    };
  }

  if (!message || typeof message !== "object") {
    return null;
  }

  if (message.messaging_product === "whatsapp") {
    return { ...message, to: message.to || to };
  }

  if (message.type === "interactive" && message.interactive) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: message.interactive,
    };
  }

  // Template Messages (for cold marketing / outside 24h window)
  if (message.type === "template" || message.template_name) {
    const templateName = message.template_name || message.template?.name;
    const languageCode = message.language_code || message.template?.language?.code || "en_US";
    const components = message.components || message.template?.components || [];

    if (!templateName) {
      return null;
    }

    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: components.length ? components : undefined,
      },
    };
  }

  // Support explicit type flag (e.g., { type: "video", video: {...} })
  if (message.type === "video" || message.video || message.videoUrl || message.link) {
    const videoPayload = { ...(message.video || {}) };

    if (!videoPayload.link) {
      videoPayload.link = message.link || message.videoUrl;
    }

    if (message.caption && !videoPayload.caption) {
      videoPayload.caption = message.caption;
    }

    if (!videoPayload.link) {
      return null;
    }

    const playableLink = normalisePreviewLink(videoPayload.link);
    videoPayload.link = playableLink;

    if (shouldSendAsLinkPreview(playableLink)) {
      const textBody = buildLinkPreviewBody({
        caption: message.caption || videoPayload.caption,
        link: playableLink,
      });

      return {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: textBody,
      };
    }

    return {
      messaging_product: "whatsapp",
      to,
      type: "video",
      video: videoPayload,
    };
  }

  if (message.type === "image" || message.image || message.imageUrl || message.mediaUrl) {
    const imagePayload = { ...(message.image || {}) };

    if (!imagePayload.link && !imagePayload.id) {
      imagePayload.link = message.link || message.imageUrl || message.mediaUrl;
    }

    if (message.caption && !imagePayload.caption) {
      imagePayload.caption = message.caption;
    }

    if (!imagePayload.link && !imagePayload.id) {
      return null;
    }

    return {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: imagePayload,
    };
  }

  const textPayload = { ...(message.text || {}) };

  if (!textPayload.body && message.body) {
    textPayload.body = message.body;
  }

  if (message.preview_url !== undefined && textPayload.preview_url === undefined) {
    textPayload.preview_url = message.preview_url;
  }

  if (!textPayload.body) {
    return null;
  }

  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: textPayload,
  };
};

const shouldSendAsLinkPreview = (url) => {
  if (!url) {
    return false;
  }

  try {
    const { hostname, pathname } = new URL(url);
    const normalisedHost = hostname.replace(/^www\./i, "").toLowerCase();

    const previewHosts = ["youtube.com", "youtu.be", "instagram.com", "instagram.cdninstagram.com"];

    if (previewHosts.some((allowedHost) => normalisedHost.endsWith(allowedHost))) {
      return true;
    }

    // Handle Instagram CDN short domains like scontent.cdninstagram.com
    if (
      normalisedHost.includes("cdninstagram.com") ||
      normalisedHost.endsWith("fbcdn.net")
    ) {
      return true;
    }

    // Treat reels shortlinks (e.g., instagram.com/reel/...)
    if (
      normalisedHost.endsWith("instagram.com") &&
      /^\/(reel|reels|p|tv)\//i.test(pathname || "")
    ) {
      return true;
    }
  } catch (err) {
    return false;
  }

  return false;
};

const buildLinkPreviewBody = ({ caption, link }) => {
  const parts = [];

  if (caption) {
    parts.push(String(caption).trim());
  }

  parts.push(link);

  return {
    body: parts.join("\n\n"),
    preview_url: true,
  };
};

const normalisePreviewLink = (rawUrl) => {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be") {
      const videoId = url.pathname.replace(/^\/+/, "").split(/[/?#]/)[0];
      if (videoId) {
        const params = new URLSearchParams();
        const timeParam = url.searchParams.get("t") || url.searchParams.get("time_continue");
        if (timeParam) {
          params.set("t", timeParam.replace(/s$/, ""));
        }
        const canonical = new URL("https://www.youtube.com/watch");
        canonical.searchParams.set("v", videoId);
        canonical.searchParams.set("app", "desktop");
        for (const [key, value] of url.searchParams.entries()) {
          if (key !== "v" && key !== "t" && key !== "time_continue") {
            canonical.searchParams.set(key, value);
          }
        }
        for (const [key, value] of params.entries()) {
          canonical.searchParams.set(key, value);
        }
        return canonical.toString();
      }
      return `https://www.youtube.com/watch?v=${url.pathname.replace(/^\/+/, "")}&app=desktop`;
    }

    if (host.endsWith("youtube.com")) {
      const path = url.pathname || "";

      if (/^\/shorts\//i.test(path)) {
        const videoId = path.replace(/^\/shorts\//i, "").split(/[/?#]/)[0];
        if (videoId) {
          const canonical = new URL("https://www.youtube.com/watch");
          canonical.searchParams.set("v", videoId);
          canonical.searchParams.set("app", "desktop");
          for (const [key, value] of url.searchParams.entries()) {
            if (key !== "v") {
              canonical.searchParams.set(key, value);
            }
          }
          return canonical.toString();
        }
      }

      if (/^\/embed\//i.test(path)) {
        const videoId = path.replace(/^\/embed\//i, "").split(/[/?#]/)[0];
        if (videoId) {
          const canonical = new URL("https://www.youtube.com/watch");
          canonical.searchParams.set("v", videoId);
          canonical.searchParams.set("app", "desktop");
          for (const [key, value] of url.searchParams.entries()) {
            if (key !== "v") {
              canonical.searchParams.set(key, value);
            }
          }
          return canonical.toString();
        }
      }
    }

    if (host.endsWith("youtube.com") && url.pathname === "/watch") {
      if (!url.searchParams.has("app")) {
        url.searchParams.set("app", "desktop");
        return url.toString();
      }
    }
  } catch (error) {
    return rawUrl;
  }

  return rawUrl;
};

const sendMessage = async (to, message) => {
  try {
    const payload = buildOutboundPayload(to, message);

    if (!payload) {
      throw new Error("Unsupported WhatsApp message payload");
    }

    const payloads = expandPayloadIfNeeded(payload);

    for (const outbound of payloads) {
      await postWhatsAppMessage(outbound);
    }
  } catch (error) {
    console.error("Error sending message:", error.response?.data || error.message);
  }
};

function expandPayloadIfNeeded(payload) {
  if (
    !payload ||
    payload.type !== "text" ||
    !payload.text ||
    typeof payload.text.body !== "string"
  ) {
    return [payload];
  }

  const body = payload.text.body;

  if (body.length <= MAX_WHATSAPP_TEXT_CHARS) {
    return [payload];
  }

  const chunks = splitTextIntoChunks(body, MAX_WHATSAPP_TEXT_CHARS);
  if (!chunks.length) {
    return [payload];
  }
  console.warn(
    `Splitting long WhatsApp reply into ${chunks.length} parts (length ${body.length})`
  );

  return chunks.map((chunk, index) => ({
    ...payload,
    text: {
      ...payload.text,
      body: chunk,
      preview_url:
        index === 0 && payload.text.preview_url !== undefined
          ? payload.text.preview_url
          : false,
    },
  }));
};

function splitTextIntoChunks(text, limit) {
  const safeText = typeof text === "string" ? text : String(text || "");
  if (!safeText.trim().length) {
    return [];
  }

  const chunks = [];
  let remaining = safeText;

  while (remaining.length) {
    if (remaining.length <= limit) {
      chunks.push(remaining.trim());
      break;
    }

    let splitIndex = findChunkBreakIndex(remaining, limit);
    if (splitIndex <= 0) {
      splitIndex = limit;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length) {
      chunks.push(chunk);
    }

    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

function findChunkBreakIndex(text, limit) {
  const preferredSeparators = ["\n\n", "\n", ". ", " "];

  for (const separator of preferredSeparators) {
    const maxIndex = Math.max(limit - separator.length, 0);
    const idx = text.lastIndexOf(separator, maxIndex);
    if (idx >= 0 && idx >= Math.floor(limit * 0.4)) {
      const splitIndex = idx + separator.length;
      return splitIndex > limit ? limit : splitIndex;
    }
  }

  return limit;
}

async function normaliseImageForWhatsApp(buffer, mimeType = "image/png") {
  if (!Buffer.isBuffer(buffer)) {
    return { buffer, contentType: mimeType };
  }

  if (buffer.length <= MAX_WHATSAPP_IMAGE_BYTES) {
    return { buffer, contentType: mimeType };
  }

  if (!sharp) {
    console.warn(
      "Infographic exceeds WhatsApp image limit but compression library is unavailable",
      { bytes: buffer.length }
    );
    return { buffer, contentType: mimeType };
  }

  console.warn("Optimising infographic to satisfy WhatsApp image limits", {
    originalBytes: buffer.length,
  });

  const attempts = [
    { resize: null, quality: 85 },
    { resize: 1600, quality: 80 },
    { resize: 1280, quality: 74 },
    { resize: 1080, quality: 70 },
    { resize: 960, quality: 65 },
  ];

  let workingBuffer = buffer;
  const targetType = "image/jpeg";

  for (const attempt of attempts) {
    try {
      let pipeline = sharp(workingBuffer).rotate();
      if (attempt.resize) {
        pipeline = pipeline.resize({
          width: attempt.resize,
          height: attempt.resize,
          fit: "inside",
          withoutEnlargement: true,
        });
      }

      workingBuffer = await pipeline.jpeg({
        quality: attempt.quality,
        mozjpeg: true,
      }).toBuffer();

      if (workingBuffer.length <= MAX_WHATSAPP_IMAGE_BYTES) {
        return { buffer: workingBuffer, contentType: targetType };
      }
    } catch (error) {
      console.warn("Failed to optimise infographic image", error.message);
      break;
    }
  }

  return { buffer: workingBuffer, contentType: targetType };
}

const uploadExternalImageAsMedia = async (fileUrl) => {
  const trimmedUrl = typeof fileUrl === "string" ? fileUrl.trim() : fileUrl;
  if (!trimmedUrl) {
    return null;
  }

  try {
    const downloadResponse = await axios.get(trimmedUrl, {
      responseType: "arraybuffer",
    });

    let contentType = downloadResponse.headers["content-type"] || "application/octet-stream";
    if (!/^image\//i.test(contentType)) {
      console.warn("Infographic URL did not return an image", {
        contentType,
        url: trimmedUrl,
      });
      return null;
    }

    let buffer = Buffer.from(downloadResponse.data);
    const optimised = await normaliseImageForWhatsApp(buffer, contentType);
    buffer = optimised.buffer;
    contentType = optimised.contentType;

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", contentType.toLowerCase());

    const filename = inferFilenameFromUrl(trimmedUrl, contentType);
    form.append("file", buffer, {
      filename,
      contentType,
    });

    const uploadResponse = await axios.post(mediaUploadUrl, form, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
    });

    return uploadResponse.data?.id || null;
  } catch (error) {
    console.error("Failed to upload infographic to WhatsApp media API:", error.response?.data || error.message);
    return null;
  }
};

function inferFilenameFromUrl(fileUrl, contentType = "") {
  try {
    const parsed = new URL(fileUrl);
    const base = path.basename(parsed.pathname);
    if (base && base !== "/") {
      return base;
    }
  } catch (err) {
    // ignore URL parsing errors
  }

  if (/image\/png/i.test(contentType)) {
    return "infographic.png";
  }
  if (/image\/jpe?g/i.test(contentType)) {
    return "infographic.jpg";
  }
  if (/image\/gif/i.test(contentType)) {
    return "infographic.gif";
  }

  return "infographic-image";
}

module.exports = {
  sendMessage,
  postWhatsAppMessage,
  buildTopicMenuMessage,
  TOPIC_MENU_ROWS,
  shouldSendAsLinkPreview,
  normalisePreviewLink,
  uploadExternalImageAsMedia,
};
