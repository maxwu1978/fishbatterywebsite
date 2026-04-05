const { Resend } = require("resend");

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
    email: clamp(payload.email, 200),
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

function isJapaneseInquiry(entry) {
  return inferLanguage(entry.sourcePage) === "Japanese";
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

function chunkFields(fields, size = 10) {
  const chunks = [];
  for (let index = 0; index < fields.length; index += size) {
    chunks.push(fields.slice(index, index + size));
  }
  return chunks;
}

function buildConfirmationEmail(entry) {
  const japanese = isJapaneseInquiry(entry);

  if (japanese) {
    return {
      subject: "Reel Mate お問い合わせ受付のお知らせ",
      text:
        ` ${entry.name} 様\n\n` +
        "お問い合わせありがとうございます。内容を受け付けました。\n" +
        "24時間以内を目安に、配送・適合確認・支払い方法・充電器情報などについてご案内します。\n\n" +
        `お問い合わせ種別: ${entry.supportTopic || "一般相談"}\n` +
        `国・地域: ${entry.country || "未記入"}\n` +
        `リール情報: ${entry.reelDetails || "未記入"}\n\n` +
        "このメールは受付確認です。担当者からの返信をお待ちください。\n",
      html:
        `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#10233d;">` +
        `<h2 style="margin:0 0 16px;">Reel Mate お問い合わせ受付</h2>` +
        `<p>${entry.name || "お客様"} 様</p>` +
        `<p>お問い合わせありがとうございます。内容を受け付けました。</p>` +
        `<p>24時間以内を目安に、配送・適合確認・支払い方法・充電器情報などについてご案内します。</p>` +
        `<div style="background:#f5f8fc;border-radius:12px;padding:16px;margin:20px 0;">` +
        `<p><strong>お問い合わせ種別:</strong> ${entry.supportTopic || "一般相談"}</p>` +
        `<p><strong>国・地域:</strong> ${entry.country || "未記入"}</p>` +
        `<p><strong>リール情報:</strong> ${entry.reelDetails || "未記入"}</p>` +
        `</div>` +
        `<p>このメールは受付確認です。担当者からの返信をお待ちください。</p>` +
        `</div>`
    };
  }

  return {
    subject: "We received your Reel Mate inquiry",
    text:
      `Hi ${entry.name || "there"},\n\n` +
      "Thanks for contacting Reel Mate. We received your inquiry.\n" +
      "Our team targets a reply within 24 hours for compatibility, shipping, payment, and charger questions.\n\n" +
      `Topic: ${entry.supportTopic || "General support"}\n` +
      `Country/Region: ${entry.country || "Not provided"}\n` +
      `Reel details: ${entry.reelDetails || "Not provided"}\n\n` +
      "This email is only a confirmation that we received your message.\n",
    html:
      `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#10233d;">` +
      `<h2 style="margin:0 0 16px;">We received your Reel Mate inquiry</h2>` +
      `<p>Hi ${entry.name || "there"},</p>` +
      `<p>Thanks for contacting Reel Mate. We received your inquiry.</p>` +
      `<p>Our team targets a reply within 24 hours for compatibility, shipping, payment, and charger questions.</p>` +
      `<div style="background:#f5f8fc;border-radius:12px;padding:16px;margin:20px 0;">` +
      `<p><strong>Topic:</strong> ${entry.supportTopic || "General support"}</p>` +
      `<p><strong>Country/Region:</strong> ${entry.country || "Not provided"}</p>` +
      `<p><strong>Reel details:</strong> ${entry.reelDetails || "Not provided"}</p>` +
      `</div>` +
      `<p>This email is only a confirmation that we received your message.</p>` +
      `</div>`
  };
}

async function sendConfirmationEmail(entry) {
  const apiKey = trim(process.env.RESEND_API_KEY);
  const from = trim(
    process.env.SUPPORT_CONFIRM_FROM_EMAIL ||
      process.env.SUPPORT_CONFIRMATION_FROM_EMAIL ||
      process.env.CONFIRMATION_FROM_EMAIL
  );
  const replyTo = trim(process.env.SUPPORT_REPLY_TO_EMAIL);

  if (!apiKey) {
    return { sent: false, reason: "missing_resend_api_key" };
  }

  if (!from) {
    return { sent: false, reason: "missing_confirmation_from_email" };
  }

  const resend = new Resend(apiKey);
  const email = buildConfirmationEmail(entry);
  const payload = {
    from,
    to: entry.email,
    subject: email.subject,
    text: email.text,
    html: email.html
  };

  if (replyTo) {
    payload.replyTo = replyTo;
  }

  await resend.emails.send(payload);
  return { sent: true };
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
    slackField("Email", entry.email),
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

  const fieldSections = chunkFields(fields).map((group) => ({
    type: "section",
    fields: group
  }));

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
      ...fieldSections,
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

    if (!entry.name || !entry.email || !entry.message) {
      return res.status(400).json({ error: "name, email, and message are required." });
    }

    console.log("site_inquiry_received", entry);

    let notification = { sent: false, reason: "missing_webhook" };
    try {
      notification = await notifyWebhook(entry);
    } catch (error) {
      console.error("site_inquiry_notify_error", error.message);
      notification = { sent: false, reason: error.message };
    }

    let confirmationEmail = { sent: false, reason: "missing_resend_api_key" };
    try {
      confirmationEmail = await sendConfirmationEmail(entry);
    } catch (error) {
      console.error("site_inquiry_confirmation_email_error", error.message);
      confirmationEmail = { sent: false, reason: error.message };
    }

    return res.status(200).json({
      success: true,
      inquiryType: entry.inquiryType,
      notification,
      confirmationEmail
    });
  } catch (error) {
    return res.status(400).json({ error: "Invalid JSON payload." });
  }
};
