function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value, max) {
  return trim(value).slice(0, max);
}

function getJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function inferInquiryType(payload) {
  if (trim(payload["business-type"]) || trim(payload["request-type"]) || trim(payload.quantity)) {
    return "wholesale";
  }
  return "support";
}

function normalizeInquiry(payload) {
  const inquiryType = inferInquiryType(payload);

  return {
    inquiryType,
    name: clamp(payload.name, 200),
    company: clamp(payload.company, 200),
    country: clamp(payload.country || payload["country-region"], 120),
    message: clamp(payload.message, 3000),
    supportTopic: clamp(payload["support-topic"], 120),
    reelDetails: clamp(payload["reel-details"], 200),
    businessType: clamp(payload["business-type"], 120),
    quantity: clamp(payload.quantity, 120),
    requestType: clamp(payload["request-type"], 120),
    sourcePage: clamp(payload.sourcePage, 200),
    receivedAt: new Date().toISOString()
  };
}

function compactMessage(value, max = 280) {
  const text = trim(value).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function sourcePageUrl(sourcePage) {
  const page = trim(sourcePage).replace(/^\//, "");
  if (!page) return "";
  return `https://www.getreelmate.com/${page}`;
}

function inferLanguage(sourcePage) {
  return trim(sourcePage).toLowerCase().startsWith("ja-") ? "Japanese" : "English";
}

function sourceLabel(entry) {
  if (entry.sourcePage === "ja-contact.html") return "Japanese contact form";
  if (entry.sourcePage === "contact.html") return "English contact form";
  if (entry.sourcePage === "wholesale.html") return "Wholesale form";
  return entry.sourcePage || "Site form";
}

function searchableText(entry) {
  return [
    entry.supportTopic,
    entry.requestType,
    entry.businessType,
    entry.message,
    entry.reelDetails
  ]
    .map((value) => trim(value).toLowerCase())
    .join(" ");
}

function inferCategory(entry) {
  if (entry.inquiryType === "wholesale") return "Wholesale";

  const text = searchableText(entry);
  if (/(pay|payment|card|checkout|invoice|order|決済|支払|注文)/.test(text)) return "Payment";
  if (/(ship|shipping|delivery|refund|物流|配送|発送|返金)/.test(text)) return "Shipping";
  if (/(charger|charge|adapter|充電)/.test(text)) return "Charger";
  if (/(compatib|voltage|reel|model|connector|適合|互換|電圧|接続)/.test(text)) return "Compatibility";
  return "General Support";
}

function inferPriority(entry, category) {
  if (entry.inquiryType === "wholesale") return "High";
  if (category === "Payment") return "High";
  if (category === "Shipping" || category === "Compatibility") return "Medium";
  return "Normal";
}

function nextStepText(entry, category) {
  if (entry.inquiryType === "wholesale") {
    return "Reply with pricing, MOQ, lead time, and shipping scope.";
  }

  if (category === "Payment") {
    return "Reply within 24 hours and confirm payment path, pricing, and any order-review help needed.";
  }

  if (category === "Shipping") {
    return "Reply within 24 hours and confirm destination, shipping feasibility, and refund-before-shipment policy if needed.";
  }

  if (category === "Compatibility") {
    return "Reply within 24 hours and confirm reel model, voltage, and connector details before ordering.";
  }

  if (category === "Charger") {
    return "Reply within 24 hours and confirm included charger details, input range, and documentation availability if requested.";
  }

  return "Reply within 24 hours and confirm compatibility, charger, shipping, or payment help as needed.";
}

function slackField(title, value) {
  return {
    type: "mrkdwn",
    text: `*${title}*\n${value || "—"}`
  };
}

function buildWebhookPayload(entry) {
  const isWholesale = entry.inquiryType === "wholesale";
  const category = inferCategory(entry);
  const priority = inferPriority(entry, category);
  const title = isWholesale ? "New wholesale inquiry" : "New support inquiry";
  const sourceUrl = sourcePageUrl(entry.sourcePage);
  const sourceText = sourceUrl ? `<${sourceUrl}|${sourceLabel(entry)}>` : sourceLabel(entry);
  const fields = [
    slackField("Type", isWholesale ? "Wholesale" : "Support"),
    slackField("Category", category),
    slackField("Priority", priority),
    slackField("Name", entry.name),
    slackField("Country", entry.country),
    slackField("Language", inferLanguage(entry.sourcePage)),
    slackField("Source", sourceText)
  ];

  if (entry.company) fields.push(slackField("Company", entry.company));
  if (entry.supportTopic) fields.push(slackField("Topic", entry.supportTopic));
  if (entry.reelDetails) fields.push(slackField("Reel", entry.reelDetails));
  if (entry.requestType) fields.push(slackField("Request", entry.requestType));
  if (entry.quantity) fields.push(slackField("Quantity", entry.quantity));
  if (entry.businessType) fields.push(slackField("Business", entry.businessType));

  return {
    text: `[Reel Mate ${entry.inquiryType}] ${entry.name || "Unknown"} / ${entry.country || "No country"}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: title
        }
      },
      {
        type: "section",
        fields
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Message*\n${compactMessage(entry.message, 1200) || "—"}`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Next step*\n${nextStepText(entry, category)}`
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Received: ${entry.receivedAt}`
          }
        ]
      }
    ],
    inquiry: entry
  };
}

async function notifyWebhook(entry) {
  const webhookUrl = trim(process.env.INQUIRY_WEBHOOK_URL);
  if (!webhookUrl) {
    return { sent: false, reason: "missing_webhook" };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildWebhookPayload(entry))
  });

  if (!response.ok) {
    throw new Error(`Webhook notify failed with status ${response.status}.`);
  }

  return { sent: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const payload = await getJsonBody(req);
    const entry = normalizeInquiry(payload);

    if (!entry.name || !entry.message) {
      return res.status(400).json({ error: "name and message are required." });
    }

    console.log("site_inquiry_received", entry);

    let notification = { sent: false, reason: "missing_webhook" };
    try {
      notification = await notifyWebhook(entry);
    } catch (error) {
      console.error("site_inquiry_notify_error", error.message);
      notification = { sent: false, reason: error.message };
    }

    return res.status(200).json({
      success: true,
      inquiryType: entry.inquiryType,
      notification
    });
  } catch (error) {
    return res.status(400).json({ error: "Invalid JSON payload." });
  }
};
