const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = 'https://euwqnyzzrxrmldmfspjr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const rateLimitMap = new Map();
function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count > maxRequests;
}

const headerHtml = `
  <div style="text-align:center;margin-bottom:16px;">
    <h1 style="color:#f5f0e8;font-size:20px;font-weight:900;letter-spacing:3.75px;text-transform:uppercase;margin:0;font-family:Verdana,Geneva,sans-serif;">DOWN THE MIDDLE</h1>
    <p style="color:#e02247;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:4px 0 0;font-family:Verdana,Geneva,sans-serif;padding-right:4px;">A TRUER GOLF HANDICAP</p>
  </div>
  <div style="height:1px;background:#e8b84b;margin:0 auto 20px;max-width:330px;"></div>
`;

const wrapHtml = (content) => `<!DOCTYPE html>
<html lang="en" style="color-scheme:light;">
<head>
  <meta charset="UTF-8">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#0d1b2e;">
  <div style="background-color:#0d1b2e;padding:40px 20px;font-family:system-ui,-apple-system,Verdana,sans-serif;max-width:480px;margin:0 auto;border-radius:8px;">
    ${headerHtml}
    ${content}
  </div>
</body>
</html>`;

const loginLink = `<a href="https://app.dtmhandicap.com/open.html" style="color:#e8b84b;text-decoration:underline;font-weight:400;">here</a>`;
const loginText = `<p style="color:rgba(245,240,232,0.6);font-size:13px;text-align:center;margin:36px 0 0;">Log in ${loginLink}</p>`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip, 5, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many requests' });
  const { type, email, name, memberNumber, requesterName } = req.body;
  if (!type || !email) return res.status(400).json({ error: 'Missing required fields' });
  let subject, html;

  if (type === 'member_number') {
    subject = 'Reminder — Member #';
    html = wrapHtml(`
      <p style="color:#ffffff;font-size:14px;font-weight:400;line-height:1.8;margin:0 0 16px;text-align:center;">Your DTM Member # is:</p>
      <div style="text-align:center;margin:0 0 8px;">
        <div style="background:transparent;border:1px solid #e8b84b;border-radius:4px;padding:16px 32px;display:inline-block;">
          <span style="color:#e8b84b;font-size:24px;font-weight:900;letter-spacing:4px;text-decoration:none !important;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;">${memberNumber.replace('-', '-\u200B')}</span>
        </div>
      </div>
      <p style="color:rgba(245,240,232,0.6);font-size:13px;text-align:center;margin:36px 0 0;">Log in <a href="https://app.dtmhandicap.com/open.html?memberNumber=${encodeURIComponent(memberNumber)}" style="color:#e8b84b;text-decoration:underline;font-weight:400;">here</a></p>
    `);

  } else if (type === 'resend_verify') {
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ type: 'magiclink', email, options: { redirect_to: 'dtmhandicap://login' } }),
    });
    const linkData = await linkRes.json();
    const url = linkData.action_link || linkData.data?.action_link;
    if (!url) return res.status(200).json({ success: true }); // don't reveal if email not found
    subject = 'Complete Your New Membership';
    html = wrapHtml(`
      <p style="color:#ffffff;font-size:13px;font-weight:400;line-height:1.8;margin:0 0 24px;text-align:center;">Click the link below to continue where you left off.</p>
      <div style="text-align:center;margin:0 0 8px;">
        <a href="${url}" style="background:#e8b84b;color:#0d1b2e;font-size:12px;font-weight:900;letter-spacing:3px;text-transform:uppercase;padding:14px 32px;border-radius:4px;text-decoration:none;display:inline-block;font-family:Verdana,Geneva,sans-serif;">CONTINUE</a>
      </div>
    `);

  } else if (type === 'password_reset') {
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        type: 'recovery',
        email,
        options: { redirect_to: 'dtmhandicap://login?source=reset' },
      }),
    });
    const linkData = await linkRes.json();
    const url = linkData.action_link || linkData.data?.action_link;
    if (!url) return res.status(500).json({ error: 'Could not generate reset link', detail: linkData });
    subject = 'Password Reset Link';
    html = wrapHtml(`
      <p style="color:#ffffff;font-size:13px;font-weight:400;line-height:1.8;margin:0 0 24px;text-align:center;">Click the link below to reset your password.</p>
      <div style="text-align:center;margin:0 0 8px;">
        <a href="https://app.dtmhandicap.com/open.html?type=reset&u=${encodeURIComponent(url)}" style="background:#e8b84b;color:#0d1b2e;font-size:12px;font-weight:900;letter-spacing:3px;text-transform:uppercase;padding:14px 32px;border-radius:4px;text-decoration:none;display:inline-block;font-family:Verdana,Geneva,sans-serif;">RESET PASSWORD</a>
      </div>
    `);

  } else if (type === 'password_changed') {
    subject = 'Password Changed ✅';
    html = wrapHtml(`
      <p style="color:#ffffff;font-size:14px;font-weight:400;line-height:1.8;margin:0;text-align:center;">Your password has been changed successfully.</p>
      <p style="color:rgba(245,240,232,0.6);font-size:13px;text-align:center;margin:36px 0 0;">If you did not make this change, please contact <a href="mailto:support@dtmhandicap.com" style="color:#e8b84b;text-decoration:underline;">support@dtmhandicap.com</a></p>
    `);

  } else if (type === 'email_changed') {
    subject = 'Email Address Updated ✅';
    html = wrapHtml(`
      <p style="color:#ffffff;font-size:14px;font-weight:400;line-height:1.8;margin:0;text-align:center;">Your email has been updated successfully.</p>
      <p style="color:rgba(245,240,232,0.6);font-size:13px;text-align:center;margin:36px 0 0;">If you did not make this change, please contact <a href="mailto:support@dtmhandicap.com" style="color:#e8b84b;text-decoration:underline;">support@dtmhandicap.com</a></p>
    `);

  } else if (type === 'partner_request') {
    subject = 'New Playing Partner Request';
    html = wrapHtml(`
      <p style="color:#ffffff;font-size:13px;font-weight:400;line-height:1.8;margin:0 0 4px;text-align:center;word-break:break-word;">${requesterName} has requested</p>
      <p style="color:#ffffff;font-size:13px;font-weight:400;line-height:1.8;margin:0;text-align:center;word-break:break-word;">to add you as a Playing Partner.</p>
      <p style="color:rgba(245,240,232,0.6);font-size:13px;text-align:center;margin:28px 0 0;">Log in and accept <a href="https://app.dtmhandicap.com/open.html?screen=login" style="color:#e8b84b;text-decoration:underline;font-weight:400;">here</a></p>
    `);

  } else if (type === 'account_deleted') {
    subject = 'Account Deleted';
    html = wrapHtml(`
      <style>.m-br{display:none;}@media only screen and (max-width:480px){.m-br{display:block!important;}}</style>
      <p style="color:#ffffff;font-size:14px;font-weight:400;line-height:1.8;margin:0 0 12px;text-align:center;">Your Down The Middle account<br class="m-br"> has been permanently deleted.</p>
      <p style="color:#e8b84b;font-size:13px;font-weight:400;line-height:1.8;margin:0;text-align:center;">Thank you for your membership.</p>
    `);

  } else {
    return res.status(400).json({ error: 'Invalid type' });
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Down The Middle <noreply@dtmhandicap.com>', to: email, subject, html }),
  });
  const emailData = await emailRes.json();
  if (!emailRes.ok) return res.status(500).json({ error: 'Failed to send email', detail: emailData });
  return res.status(200).json({ success: true });
}
