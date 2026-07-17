import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = 'https://euwqnyzzrxrmldmfspjr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const config = { api: { bodyParser: false } };

const supabaseUpdate = (customerId, data) =>
  fetch(`${SUPABASE_URL}/rest/v1/profiles?stripe_customer_id=eq.${customerId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify(data),
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;
  let rawBody = '';

  await new Promise((resolve, reject) => {
    req.on('data', chunk => { rawBody += chunk.toString(); });
    req.on('end', resolve);
    req.on('error', reject);
  });

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // New subscription via checkout
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata.userId;
    const customerId = session.customer;
    let renewsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const subscriptionId = session.subscription;
      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        renewsAt = new Date(sub.current_period_end * 1000).toISOString();
      }
    } catch (e) {
      console.error('Could not retrieve subscription period end:', e.message);
    }

    // Pull billing address from Stripe customer
    let locationData = {};
    try {
      const customer = await stripe.customers.retrieve(customerId);
      const addr = customer.address;
      if (addr) {
        locationData = {
          city: addr.city || null,
          region: addr.state || null,
          country: addr.country || null,
          zip: addr.postal_code || null,
        };
      }
    } catch (e) {
      console.error('Could not retrieve customer address:', e.message);
    }

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        subscribed: true,
        stripe_customer_id: customerId,
        subscription_renews_at: renewsAt,
        payment_provider: 'stripe',
        ...locationData,
      }),
    });
    console.log('Supabase update status (checkout):', updateRes.status);
  }

  // Subscription cancelled
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    const updateRes = await supabaseUpdate(customerId, {
      subscribed: false,
      subscription_renews_at: null,
    });
    console.log('Supabase update status (cancelled):', updateRes.status);
  }

  // Subscription renewed or reactivated
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    const isActive = subscription.status === 'active';
    const renewsAt = isActive
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;
    const updateRes = await supabaseUpdate(customerId, {
      subscribed: isActive,
      subscription_renews_at: renewsAt,
    });
    console.log('Supabase update status (updated):', updateRes.status);
  }

  res.status(200).json({ received: true });
}
