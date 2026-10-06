const SUPABASE_URL = 'https://euwqnyzzrxrmldmfspjr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1d3FueXp6cnhybWxkbWZzcGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MzAwODMsImV4cCI6MjA5MDEwNjA4M30.4PWVQFOIx3yX7oMWvpO06_dqdrGLk0PGE77DstmpJO0';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const vr = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ token_hash: token, type: 'recovery' }),
    });
    const vd = await vr.json();
    if (vr.ok && vd.access_token) {
      return res.status(200).json({ access_token: vd.access_token });
    }
    return res.status(400).json({ error: vd.msg || vd.error_description || 'Token invalid or expired' });
  } catch (e) {
    return res.status(500).json({ error: 'Verify request failed' });
  }
}
