// notify-partners.js
// Called after a round is posted. Sends APNs push notifications to connected partners.
// Uses Node.js built-in crypto + http2 — no extra packages needed.

import crypto from 'node:crypto';
import http2 from 'node:http2';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APNS_KEY_ID = process.env.APNS_KEY_ID;       // 8K979C7WHL
const APNS_TEAM_ID = process.env.APNS_TEAM_ID;     // 3THVHL6Q77
const APNS_AUTH_KEY = process.env.APNS_AUTH_KEY;   // full .p8 file content
const BUNDLE_ID = 'com.dtmhandicap.app';

// ── APNs JWT — valid for 1 hour ───────────────────────────────────────────────
function createJWT() {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign('SHA256');
  sign.update(unsigned);
  const signature = sign.sign({ key: APNS_AUTH_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${signature}`;
}

// ── Send one APNs notification via HTTP/2 ────────────────────────────────────
function sendNotification(deviceToken, title, body, jwt) {
  return new Promise((resolve, reject) => {
    const client = http2.connect('https://api.push.apple.com');
    client.on('error', (err) => { client.destroy(); reject(err); });

    const reqHeaders = {
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${jwt}`,
      'apns-topic': BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    };

    const pushPayload = JSON.stringify({
      aps: {
        alert: { title, body },
        sound: 'default',
      },
    });

    const req = client.request(reqHeaders);
    req.write(pushPayload);
    req.end();

    let statusCode;
    let responseData = '';
    req.on('response', (headers) => { statusCode = headers[':status']; });
    req.on('data', (chunk) => { responseData += chunk; });
    req.on('end', () => {
      client.close();
      resolve({ statusCode, body: responseData, token: deviceToken });
    });
    req.on('error', (err) => { client.close(); reject(err); });
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, posterName } = req.body || {};
  if (!userId || !posterName) return res.status(400).json({ error: 'userId and posterName required' });

  try {
    // 1. Find accepted partners
    const partnersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/partners?or=(requester_id.eq.${userId},recipient_id.eq.${userId})&status=eq.accepted&select=requester_id,recipient_id`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const partners = await partnersRes.json();
    if (!Array.isArray(partners) || !partners.length) {
      return res.status(200).json({ sent: 0, reason: 'no partners' });
    }

    const partnerIds = partners.map(p =>
      p.requester_id === userId ? p.recipient_id : p.requester_id
    );

    // 2. Get push tokens for those partners
    const tokensRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=in.(${partnerIds.join(',')})&push_token=not.is.null&select=push_token`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const profiles = await tokensRes.json();
    const tokens = Array.isArray(profiles)
      ? profiles.map(p => p.push_token).filter(Boolean)
      : [];

    if (!tokens.length) {
      return res.status(200).json({ sent: 0, reason: 'no push tokens' });
    }

    // 3. Build notification copy
    const title = `${posterName} posted a round`;
    const body = `tap to see what they shot`;
    const jwt = createJWT();

    // 4. Fire notifications in parallel
    const results = await Promise.allSettled(
      tokens.map(token => sendNotification(token, title, body, jwt))
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value.statusCode === 200).length;
    const failed = results.length - sent;

    console.log(`notify-partners: sent=${sent} failed=${failed} total=${tokens.length}`);
    return res.status(200).json({ sent, failed, total: tokens.length });

  } catch (e) {
    console.error('notify-partners error:', e);
    return res.status(500).json({ error: 'Server error', message: e.message });
  }
}
