const Stripe = require("stripe");

const SUPPORTED_COUNTRIES = [
  "US",
  "DE",
  "FR",
  "ES",
  "IT",
  "NL",
  "BE",
  "AT",
  "IE",
  "PT",
  "SE",
  "DK",
  "FI",
  "PL",
  "CZ",
  "HU",
  "RO",
  "GR",
  "HR",
  "SK",
  "SI",
  "LT",
  "LV",
  "EE",
  "LU",
  "BG"
];

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeOrigin(req) {
  const configured = trim(process.env.SITE_URL).replace(/[\r\n]+/g, "");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const host = trim(req.headers.host);
  if (!host) {
    throw new Error("SITE_URL is not configured.");
  }

  return `https://${host}`.replace(/\/+$/, "");
}

function required(fieldName, value) {
  if (!trim(value)) {
    throw new Error(`${fieldName} is required.`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Stripe is not configured yet. Add STRIPE_SECRET_KEY in Vercel project settings." });
  }

  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      country,
      countryLabel,
      currency,
      shippingAddress,
      city,
      postalCode,
      reelModel
    } = req.body || {};

    required("First name", firstName);
    required("Last name", lastName);
    required("Email", email);
    required("Shipping address", shippingAddress);
    required("City", city);
    required("Postal code", postalCode);
    required("Reel model", reelModel);

    const countryCode = trim(country).toUpperCase();
    if (!SUPPORTED_COUNTRIES.includes(countryCode)) {
      return res.status(400).json({ error: "This destination is not supported for online card checkout." });
    }

    const selectedCurrency = trim(currency).toLowerCase() || "usd";
    if (selectedCurrency !== "usd") {
      return res.status(400).json({ error: "Online checkout is currently available in USD only." });
    }

    const stripe = new Stripe(trim(process.env.STRIPE_SECRET_KEY));
    const origin = safeOrigin(req);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: SUPPORTED_COUNTRIES
      },
      customer_email: trim(email),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: 69900,
            product_data: {
              name: "Reel Mate Full Kit",
              description: "Battery, protective case, charger, cable set, and manual"
            }
          }
        }
      ],
      metadata: {
        first_name: trim(firstName).slice(0, 100),
        last_name: trim(lastName).slice(0, 100),
        phone: trim(phone).slice(0, 100),
        country: trim(countryLabel || countryCode).slice(0, 100),
        shipping_address: trim(shippingAddress).slice(0, 200),
        city: trim(city).slice(0, 100),
        postal_code: trim(postalCode).slice(0, 40),
        reel_model: trim(reelModel).slice(0, 200)
      },
      success_url: `${origin}/payment.html?status=success`,
      cancel_url: `${origin}/payment.html?status=cancelled`
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create checkout session." });
  }
};
