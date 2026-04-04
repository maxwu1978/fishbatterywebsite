const Stripe = require("stripe");

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const stripeSecretKey = trim(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = trim(process.env.STRIPE_WEBHOOK_SECRET);

  if (!stripeSecretKey || !webhookSecret) {
    return res.status(500).json({ error: "Stripe webhook is not configured yet." });
  }

  try {
    const stripe = new Stripe(stripeSecretKey);
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({ error: "Missing Stripe signature header." });
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("stripe_checkout_completed", {
          sessionId: session.id,
          customerEmail: session.customer_details?.email || session.customer_email || "",
          paymentStatus: session.payment_status,
          amountTotal: session.amount_total,
          currency: session.currency,
          metadata: session.metadata || {}
        });
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object;
        console.log("stripe_checkout_expired", {
          sessionId: session.id,
          customerEmail: session.customer_details?.email || session.customer_email || "",
          metadata: session.metadata || {}
        });
        break;
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        console.log("stripe_payment_failed", {
          paymentIntentId: intent.id,
          lastPaymentError: intent.last_payment_error?.message || "",
          metadata: intent.metadata || {}
        });
        break;
      }
      default:
        console.log("stripe_event_received", { type: event.type });
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("stripe_webhook_error", error.message);
    return res.status(400).json({ error: error.message || "Unable to verify Stripe webhook." });
  }
};
