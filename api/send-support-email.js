const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL;

const rateLimitMap = new Map();
function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count > maxRequests;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip, 3, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many requests' });

  const { name, email, memberNumber, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Missing required fields' });

  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="font-size:16px;font-weight:700;margin:0 0 16px;">DTM Support Request</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#888;width:120px;">Name</td><td style="padding:8px 0;">${name}</td></tr>
        <tr><td style="padding:8px 0;color:#888;">Email</td><td style="padding:8px 0;">${email}</td></tr>
        <tr><td style="padding:8px 0;color:#888;">Member #</td><td style="padding:8px 0;">${memberNumber || '—'}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
      <div style="font-size:14px;line-height:1.7;white-space:pre-wrap;">${message}</div>
    </div>
  `;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Down The Middle <noreply@dtmhandicap.com>',
      to: SUPPORT_EMAIL,
      reply_to: email,
      subject: `DTM Support — ${name} (${memberNumber || 'no member #'})`,
      html,
    }),
  });

  const emailData = await emailRes.json();
  if (!emailRes.ok) return res.status(500).json({ error: 'Failed to send', detail: emailData });
  return res.status(200).json({ success: true });
}
