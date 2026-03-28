(function () {
  const config = window.REEL_MATE_CHAT || {};
  const provider = (config.provider || "").toLowerCase();
  const crispWebsiteId = (config.crispWebsiteId || "").trim();

  if (provider !== "crisp" || !crispWebsiteId) {
    return;
  }

  window.$crisp = [];
  window.CRISP_WEBSITE_ID = crispWebsiteId;
  document.documentElement.classList.add("chat-live");

  const script = document.createElement("script");
  script.src = "https://client.crisp.chat/l.js";
  script.async = true;
  document.head.appendChild(script);
})();
