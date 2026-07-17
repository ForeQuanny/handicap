const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RC_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET;

const svcHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
};

const updateProfile = (userId, data) =>
  fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: svcHeaders,
    body: JSON.stringify(data),
  });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== RC_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const event = req.body;
    const { type, app_user_id, expiration_at_ms } = event?.event || {};

    if (!app_user_id) return res.status(400).json({ error: 'Missing app_user_id' });

    const renewsAt = expiration_at_ms ? new Date(expiration_at_ms).toISOString() : null;

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'REACTIVATION':
        await updateProfile(app_user_id, {
          subscribed: true,
          payment_provider: 'apple',
          subscription_renews_at: renewsAt,
        });
        break;

      case 'CANCELLATION':
      case 'EXPIRATION':
      case 'REFUND':
        await updateProfile(app_user_id, {
          subscribed: false,
          subscription_renews_at: null,
        });
        break;

      case 'BILLING_ISSUE':
        // Subscription still technically active during grace period — leave subscribed alone
        // RevenueCat will send EXPIRATION if it's not resolved
        break;

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('revenuecat-webhook error:', e);
    return res.status(500).json({ error: 'Server error', message: e.message });
  }
}
