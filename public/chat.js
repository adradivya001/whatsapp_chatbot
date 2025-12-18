const chatHistory = document.getElementById("chat-history");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-message");
const messageTemplate = document.getElementById("message-template");
const videoTemplate = document.getElementById("video-template");

const floatingPlayer = document.getElementById("floating-player");
const floatingTitle = document.getElementById("floating-title");
const floatingIframe = document.getElementById("floating-iframe");
const closeBtn = document.getElementById("close-btn");
const minimiseBtn = document.getElementById("minimise-btn");
const pipBtn = document.getElementById("pip-btn");

let currentVideoMeta = null;
let typingIndicatorNode = null;

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parseYouTubeMeta(url) {
  if (!url) return null;

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([\w-]{11})/i,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([\w-]{11})/i,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([\w-]{11})/i,
  ];

  for (const regex of patterns) {
    const match = url.match(regex);
    if (match?.[1]) {
      const videoId = match[1];
      return {
        id: videoId,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1`,
        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    }
  }

  return null;
}

function createMessageNode(message) {
  const isVideo = message.type === "video" || message.videoUrl;
  if (isVideo) {
    const videoMeta = parseYouTubeMeta(message.videoUrl);
    if (!videoMeta) {
      return null;
    }

    const node = videoTemplate.content.firstElementChild.cloneNode(true);
    if (message.sender === "user") {
      node.classList.remove("message--bot");
      node.classList.add("message--user");
    }

    const button = node.querySelector(".video-card");
    const thumbnail = node.querySelector(".video-card__thumb");
    const title = node.querySelector(".video-card__title");
    const caption = node.querySelector(".video-card__caption");
    const time = node.querySelector(".message__time");

    thumbnail.src = videoMeta.thumbnail;
    thumbnail.alt = message.title || "Video thumbnail";
    title.textContent = message.title || "YouTube video";
    caption.textContent =
      message.caption || "Watch this without leaving the chat.";
    time.textContent = formatTime();

    button.dataset.embedUrl = videoMeta.embedUrl;
    button.dataset.watchUrl = videoMeta.watchUrl;
    button.dataset.title = message.title || "YouTube video";
    button.addEventListener("click", () => openFloatingPlayer(button.dataset));

    return node;
  }

  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  if (message.sender === "user") {
    node.classList.remove("message--bot");
    node.classList.add("message--user");
  }

  node.querySelector(".message__text").textContent = message.text;
  node.querySelector(".message__time").textContent = formatTime();
  return node;
}

function appendMessage(message) {
  const node = createMessageNode(message);
  if (!node) return;

  chatHistory.appendChild(node);
  chatHistory.scrollTo({
    top: chatHistory.scrollHeight,
    behavior: "smooth",
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  appendMessage({ sender: "user", text });
  chatInput.value = "";

  const youtubeMeta = parseYouTubeMeta(text);
  if (youtubeMeta) {
    appendMessage({
      sender: "user",
      type: "video",
      videoUrl: youtubeMeta.watchUrl,
      title: "Shared video",
      caption: "Tap to keep it in mini player.",
    });
  }

  showTypingIndicator();

  try {
    const replies = await sendMessageToBackend(text);
    removeTypingIndicator();

    if (!replies.length) {
      appendMessage({
        sender: "bot",
        text: "I'm still thinking—please try again in a moment.",
      });
      return;
    }

    for (const reply of replies) {
      const displayMessage = normaliseBackendMessage(reply);
      if (displayMessage) {
        appendMessage(displayMessage);
      }
    }
  } catch (error) {
    console.error("Failed to fetch reply:", error);
    removeTypingIndicator();
    appendMessage({
      sender: "bot",
      text: "I couldn't reach the server. Please try again shortly.",
    });
  }
}

function openFloatingPlayer({ embedUrl, title }) {
  if (!embedUrl) return;

  currentVideoMeta = { embedUrl, title };
  floatingTitle.textContent = title || "Now playing";
  floatingIframe.src = embedUrl;

  floatingPlayer.classList.remove("floating-player--mini");
  floatingPlayer.classList.add("floating-player--visible");
  floatingPlayer.setAttribute("aria-hidden", "false");
}

function closeFloatingPlayer() {
  floatingPlayer.classList.remove("floating-player--visible");
  floatingPlayer.classList.remove("floating-player--mini");
  floatingPlayer.setAttribute("aria-hidden", "true");
  floatingIframe.src = "about:blank";
  currentVideoMeta = null;
}

function minimiseFloatingPlayer() {
  floatingPlayer.classList.toggle("floating-player--mini");
}

async function togglePictureInPicture() {
  // Browsers currently restrict PiP to <video> elements.
  // We provide an inline mini-player fallback when PiP is unavailable.
  if ("documentPictureInPicture" in window) {
    try {
      const pipWindow = await documentPictureInPicture.requestWindow({
        width: 320,
        height: 180,
      });

      const iframeClone = floatingIframe.cloneNode(true);
      iframeClone.src = currentVideoMeta?.embedUrl || floatingIframe.src;
      pipWindow.document.body.style.margin = "0";
      pipWindow.document.body.appendChild(iframeClone);

      const onClose = () => {
        pipWindow.removeEventListener("pagehide", onClose);
        floatingPlayer.classList.remove("floating-player--mini");
      };

      pipWindow.addEventListener("pagehide", onClose);
      floatingPlayer.classList.add("floating-player--mini");
      return;
    } catch (error) {
      console.warn("Document PiP unavailable, using inline mini-player.", error);
    }
  }

  minimiseFloatingPlayer();
}

closeBtn.addEventListener("click", closeFloatingPlayer);
minimiseBtn.addEventListener("click", minimiseFloatingPlayer);
pipBtn.addEventListener("click", togglePictureInPicture);

chatForm.addEventListener("submit", handleSubmit);

function showTypingIndicator() {
  if (typingIndicatorNode) {
    return;
  }

  typingIndicatorNode = createMessageNode({ sender: "bot", text: "..." });
  if (typingIndicatorNode) {
    typingIndicatorNode.classList.add("message--typing");
    const timeEl = typingIndicatorNode.querySelector(".message__time");
    if (timeEl) {
      timeEl.textContent = "";
    }
    chatHistory.appendChild(typingIndicatorNode);
    chatHistory.scrollTo({
      top: chatHistory.scrollHeight,
      behavior: "smooth",
    });
  }
}

function removeTypingIndicator() {
  if (typingIndicatorNode && typingIndicatorNode.parentElement === chatHistory) {
    chatHistory.removeChild(typingIndicatorNode);
  }
  typingIndicatorNode = null;
}

async function sendMessageToBackend(text) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  if (response.status === 204) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.replies) ? data.replies : [];
}

function normaliseBackendMessage(reply) {
  if (!reply) return null;

  if (typeof reply === "string") {
    return { sender: "bot", text: reply };
  }

  if (typeof reply === "object") {
    if (reply.type === "video") {
      const link =
        reply.video?.link || reply.videoUrl || reply.link || reply.url;
      if (!link) {
        return null;
      }

      return {
        sender: "bot",
        type: "video",
        videoUrl: link,
        title: reply.title || reply.video?.title,
        caption: reply.caption || reply.video?.caption,
      };
    }

    if (reply.body || reply.text?.body) {
      const text = reply.body || reply.text?.body;
      return { sender: "bot", text };
    }

    if (typeof reply.text === "string") {
      return { sender: "bot", text: reply.text };
    }

    if (typeof reply.message === "string") {
      return { sender: "bot", text: reply.message };
    }

    if (typeof reply.answer === "string") {
      return { sender: "bot", text: reply.answer };
    }

    if (typeof reply.content === "string") {
      return { sender: "bot", text: reply.content };
    }

    if (typeof reply.result === "string") {
      return { sender: "bot", text: reply.result };
    }

    if (typeof reply.output === "string") {
      return { sender: "bot", text: reply.output };
    }

    if (Array.isArray(reply.messages)) {
      const first = normaliseBackendMessage(reply.messages[0]);
      if (first) {
        return first;
      }
    }

    if (Array.isArray(reply.replies)) {
      const first = normaliseBackendMessage(reply.replies[0]);
      if (first) {
        return first;
      }
    }

    if (Array.isArray(reply.reply)) {
      const first = normaliseBackendMessage(reply.reply[0]);
      if (first) {
        return first;
      }
    }

    if (reply.data) {
      return normaliseBackendMessage(reply.data);
    }

    if (reply.payload) {
      return normaliseBackendMessage(reply.payload);
    }

    if (reply.whatsapp) {
      return normaliseBackendMessage(reply.whatsapp);
    }

    const firstString = Object.values(reply).find(
      (value) => typeof value === "string" && value.trim().length
    );
    if (firstString) {
      return { sender: "bot", text: firstString };
    }
  }

  if (Array.isArray(reply)) {
    const first = normaliseBackendMessage(reply[0]);
    if (first) {
      return first;
    }
  }

  return null;
}
