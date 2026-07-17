const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // Verify token belongs to the user being deleted
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` }
    });
    const userData = await userRes.json();
    if (!userRes.ok || userData.id !== userId) return res.status(401).json({ error: 'Unauthorized' });

    const svcHeaders = { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

    // Get profile for Stripe customer ID
    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_customer_id`, {
      headers: { ...svcHeaders, 'Accept': 'application/vnd.pgrst.object+json' }
    });
    const profile = profRes.ok ? await profRes.json() : null;

    // Cancel any active Stripe subscriptions before deleting
    if (profile?.stripe_customer_id && STRIPE_SECRET_KEY) {
      try {
        const subRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${profile.stripe_customer_id}&status=active&limit=10`, {
          headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` }
        });
        const subData = await subRes.json();
        for (const sub of (subData.data || [])) {
          await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` }
          });
        }
      } catch {}
    }

    // Delete user data across all tables
    await fetch(`${SUPABASE_URL}/rest/v1/rounds?user_id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders });
    await fetch(`${SUPABASE_URL}/rest/v1/user_courses?user_id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders });
    await fetch(`${SUPABASE_URL}/rest/v1/partners?requester_id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders });
    await fetch(`${SUPABASE_URL}/rest/v1/partners?recipient_id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders });
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, { method: 'DELETE', headers: svcHeaders });

    // Delete the auth user
    const deleteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    if (!deleteRes.ok) {
      const err = await deleteRes.json().catch(() => ({}));
      return res.status(500).json({ error: 'Failed to delete auth account', detail: err });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('delete-account error:', e);
    return res.status(500).json({ error: 'Server error', message: e.message });
  }
}
