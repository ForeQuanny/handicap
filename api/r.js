export default function handler(req, res) {
  const { t, u } = req.query;
  if (!u || !u.startsWith('https://euwqnyzzrxrmldmfspjr.supabase.co/')) {
    return res.status(400).end();
  }
  if (t === 'reset') {
    res.setHeader('Set-Cookie', 'dtm-link-type=reset; Path=/; Max-Age=1800; SameSite=Lax');
  }
  res.redirect(302, u);
}
