const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, newEmail } = req.body;
    if (!userId || !newEmail) return res.status(400).json({ error: 'Missing required fields' });

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // Verify token belongs to userId
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` }
    });
    const userData = await userRes.json();
    if (!userRes.ok || userData.id !== userId) return res.status(401).json({ error: 'Unauthorized' });

    const oldEmail = userData.email;

    // Check new email not already in use
    const dupCheck = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(newEmail)}&select=id`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const dupData = await dupCheck.json();
    if (Array.isArray(dupData) && dupData.length > 0) {
      return res.status(400).json({ error: 'That email address is not available' });
    }

    // Update Supabase auth email via admin API (no confirmation email)
    const authUpdateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ email: newEmail, email_confirm: true })
    });
    if (!authUpdateRes.ok) {
      const err = await authUpdateRes.json().catch(() => ({}));
      return res.status(500).json({ error: err.message || 'Failed to update email' });
    }

    const svcHeaders = { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

    // Update profiles table email
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: svcHeaders,
      body: JSON.stringify({ email: newEmail })
    });

    // Get profile for Stripe info
    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_customer_id,payment_provider`, {
      headers: { ...svcHeaders, 'Accept': 'application/vnd.pgrst.object+json' }
    });
    const profile = profRes.ok ? await profRes.json() : null;

    // Update Stripe customer email if applicable
    if (profile?.stripe_customer_id && profile?.payment_provider === 'stripe' && STRIPE_SECRET_KEY) {
      try {
        await fetch(`https://api.stripe.com/v1/customers/${profile.stripe_customer_id}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `email=${encodeURIComponent(newEmail)}`
        });
      } catch {}
    }

    // Send confirmation email to old address
    try {
      await fetch(`https://app.dtmhandicap.com/api/send-auth-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email_changed', email: newEmail })
      });
    } catch {}

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('change-email error:', e);
    return res.status(500).json({ error: 'Server error', message: e.message });
  }
}
