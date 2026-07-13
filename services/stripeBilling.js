// services/stripeBilling.js
// Handles subscription checkout + webhook events for tenant billing status
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// --- Create a Checkout session for a new tenant signup ---
async function createCheckoutSession({ tenantId, ownerEmail }) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: ownerEmail,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID, // single MVP tier
        quantity: 1,
      },
    ],
    metadata: { tenant_id: tenantId },
    success_url: `${process.env.APP_URL}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL}/onboarding/canceled`,
    subscription_data: {
      trial_period_days: 14,
    },
  });
  return session.url;
}

// --- Webhook handler: keep tenants.subscription_status in sync ---
// Mount this route with express.raw({ type: 'application/json' }), NOT express.json()
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      await pool.query(
        `UPDATE tenants
         SET stripe_customer_id = $1, stripe_subscription_id = $2, subscription_status = 'trialing'
         WHERE id = $3`,
        [session.customer, session.subscription, session.metadata.tenant_id]
      );
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      await pool.query(`UPDATE tenants SET subscription_status = $1 WHERE stripe_subscription_id = $2`, [
        sub.status,
        sub.id,
      ]);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await pool.query(`UPDATE tenants SET subscription_status = 'canceled' WHERE stripe_subscription_id = $1`, [
        sub.id,
      ]);
      // Consider also: deactivate tracking_numbers and unpublish landing_pages here
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      await pool.query(`UPDATE tenants SET subscription_status = 'past_due' WHERE stripe_customer_id = $1`, [
        invoice.customer,
      ]);
      // Trigger a notification email to the tenant owner here
      break;
    }
  }

  res.json({ received: true });
}

module.exports = { createCheckoutSession, handleStripeWebhook };

// --- Express wiring (app.js) ---
// app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
// app.post('/api/stripe/checkout', express.json(), async (req, res) => {
//   const url = await createCheckoutSession(req.body);
//   res.json({ url });
// });
