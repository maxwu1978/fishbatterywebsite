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

function slackField(title, value) {
  return {
    type: "mrkdwn",
    text: `*${title}*\n${value || "—"}`
  };
}

function buildWebhookPayload(entry) {
  const title = entry.inquiryType === "wholesale" ? "New wholesale inquiry" : "New support inquiry";
  const fields = [
    slackField("Type", entry.inquiryType),
    slackField("Name", entry.name),
    slackField("Country", entry.country),
    slackField("Source", entry.sourcePage)
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
