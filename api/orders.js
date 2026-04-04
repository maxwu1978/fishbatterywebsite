const Stripe = require("stripe");

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isAuthorized(req) {
  const expected = trim(process.env.ORDER_RECORDS_TOKEN);
  if (!expected) {
    return { ok: false, reason: "Order records are not configured yet. Add ORDER_RECORDS_TOKEN in Vercel." };
  }

  const authHeader = trim(req.headers["x-order-token"]);
  const authQuery = trim((req.query && req.query.token) || "");
  if (authHeader === expected || authQuery === expected) {
    return { ok: true };
  }

  return { ok: false, reason: "Unauthorized." };
}

function normalizeSession(session) {
  return {
    id: session.id,
    created: session.created,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentStatus: session.payment_status,
    status: session.status,
    livemode: session.livemode,
    customerEmail: session.customer_details?.email || session.customer_email || "",
    customerName: session.customer_details?.name || "",
    country: session.customer_details?.address?.country || session.metadata?.country || "",
    city: session.customer_details?.address?.city || session.metadata?.city || "",
    postalCode: session.customer_details?.address?.postal_code || session.metadata?.postal_code || "",
    shippingAddress: session.customer_details?.address?.line1 || session.metadata?.shipping_address || "",
    reelModel: session.metadata?.reel_model || "",
    firstName: session.metadata?.first_name || "",
    lastName: session.metadata?.last_name || "",
    phone: session.metadata?.phone || ""
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const auth = isAuthorized(req);
  if (!auth.ok) {
    return res.status(auth.reason === "Unauthorized." ? 401 : 500).json({ error: auth.reason });
  }

  const stripeSecretKey = trim(process.env.STRIPE_SECRET_KEY);
  if (!stripeSecretKey) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  try {
    const stripe = new Stripe(stripeSecretKey);
    const limit = Math.min(Number(req.query?.limit || 20) || 20, 100);

    const sessions = await stripe.checkout.sessions.list({
      limit
    });

    const records = (sessions.data || [])
      .filter((session) => session.mode === "payment")
      .map(normalizeSession);

    return res.status(200).json({
      count: records.length,
      records
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load order records." });
  }
};
