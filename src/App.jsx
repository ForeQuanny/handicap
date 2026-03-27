import { useState, useMemo, useEffect, useRef } from "react";

const SUPABASE_URL = "https://euwqnyzzrxrmldmfspjr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1d3FueXp6cnhybWxkbWZzcGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MzAwODMsImV4cCI6MjA5MDEwNjA4M30.4PWVQFOIx3yX7oMWvpO06_dqdrGLk0PGE77DstmpJO0";

// Lightweight Supabase REST + Auth client (no npm dependency)
const supabase = (() => {
  let _session = null;

  const headers = (extra = {}) => ({
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${_session?.access_token || SUPABASE_ANON_KEY}`,
    ...extra,
  });

  const auth = {
    getSession: async () => {
      try {
        const raw = localStorage.getItem("sb-session");
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.expires_at && Date.now() / 1000 < s.expires_at) {
            _session = s;
            return { data: { session: s } };
          }
        }
      } catch {}
      return { data: { session: null } };
    },
    signUp: async ({ email, password }) => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.error || (!data.user && !data.id)) return { data: null, error: { message: data.error_description || data.msg || "Sign up failed" } };
      const user = data.user || data;
      _session = { access_token: data.access_token, user, expires_at: data.expires_at };
      localStorage.setItem("sb-session", JSON.stringify(_session));
      return { data: { user }, error: null };
    },
    signInWithPassword: async ({ email, password }) => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.error || !data.access_token) return { data: null, error: { message: data.error_description || "Invalid email or password" } };
      _session = { access_token: data.access_token, user: data.user, expires_at: data.expires_at };
      localStorage.setItem("sb-session", JSON.stringify(_session));
      return { data: { user: data.user, session: _session }, error: null };
    },
    signOut: async () => {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: headers() });
      _session = null;
      localStorage.removeItem("sb-session");
      return { error: null };
    },
    resetPasswordForEmail: async (email) => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.error) return { error: { message: data.error_description || "Reset failed" } };
      return { error: null };
    },
    onAuthStateChange: (cb) => ({ data: { subscription: { unsubscribe: () => {} } } }),
  };

  const from = (table) => ({
    select: (cols = "*") => ({
      eq: (col, val) => ({
        single: async () => {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${val}&select=${cols}`, { headers: { ...headers(), "Accept": "application/vnd.pgrst.object+json" } });
          const data = await res.json();
          return { data: res.ok ? data : null, error: res.ok ? null : data };
        },
        order: (orderCol, { ascending = true } = {}) => ({
          then: async (resolve) => {
            const dir = ascending ? "asc" : "desc";
            const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${val}&select=${cols}&order=${orderCol}.${dir}`, { headers: headers() });
            const data = await res.json();
            resolve({ data: res.ok ? data : [], error: res.ok ? null : data });
          }
        }),
      }),
      order: (orderCol, { ascending = true } = {}) => ({
        eq: (col, val) => new Promise(async (resolve) => {
          const dir = ascending ? "asc" : "desc";
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${val}&select=${cols}&order=${orderCol}.${dir}`, { headers: headers() });
          const data = await res.json();
          resolve({ data: res.ok ? data : [], error: res.ok ? null : data });
        }),
      }),
    }),
    insert: (row) => ({
      select: () => ({
        single: async () => {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: "POST",
            headers: { ...headers(), "Prefer": "return=representation" },
            body: JSON.stringify(row),
          });
          const data = await res.json();
          return { data: res.ok ? (Array.isArray(data) ? data[0] : data) : null, error: res.ok ? null : data };
        }
      }),
      then: async (resolve) => {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: "POST",
          headers: { ...headers(), "Prefer": "return=representation" },
          body: JSON.stringify(row),
        });
        const data = await res.json();
        resolve({ data: res.ok ? data : null, error: res.ok ? null : data });
      }
    }),
    delete: () => ({
      eq: (col, val) => ({
        eq: (col2, val2) => fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${val}&${col2}=eq.${val2}`, { method: "DELETE", headers: headers() }).then(() => ({ error: null })),
      }),
    }),
  });

  return { auth, from };
})();

// ─── Handicap Logic ────────────────────────────────────────────────────────────
function calcDifferential(score, rating, slope, currentHandicap) {
  slope = slope || 113;
  let flatWeight;
  if (currentHandicap === null || currentHandicap === undefined) {
    flatWeight = 0;
  } else if (currentHandicap <= 0) {
    flatWeight = 0.25;
  } else if (currentHandicap <= 9) {
    flatWeight = 0.20;
  } else if (currentHandicap <= 19) {
    flatWeight = 0.10;
  } else {
    flatWeight = 0;
  }
  const slopeWeight = 1 - flatWeight;
  const baseDiff = (score - rating) * (flatWeight + slopeWeight * (113 / slope));
  if (currentHandicap === null || currentHandicap === undefined) return Math.round(baseDiff * 10) / 10;
  const expected = rating + (currentHandicap * slope / 113);
  const performance = score - expected;
  const multiplier = Math.min(1.25, Math.max(0.75, 1 + 0.01 * performance));
  const adjusted = baseDiff * multiplier;
  return Math.round(adjusted * 10) / 10;
}

function calcHandicapAllTime(rounds) {
  if (rounds.length < 12) return null;
  const recent = rounds.slice(0, 12);
  const sorted = [...recent].sort((a, b) => a.differential - b.differential);
  const middle = sorted.slice(1, 11);
  const avg = middle.reduce((s, r) => s + r.differential, 0) / middle.length;
  return Math.trunc(avg);
}

function calcHandicapDecimalAllTime(rounds) {
  if (rounds.length < 12) return null;
  const recent = rounds.slice(0, 12);
  const sorted = [...recent].sort((a, b) => a.differential - b.differential);
  const middle = sorted.slice(1, 11);
  const avg = middle.reduce((s, r) => s + r.differential, 0) / middle.length;
  return Math.trunc(avg * 10) / 10;
}

function calcHandicap(rounds) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  const eligible = rounds.filter(r => new Date(r.date + 'T00:00:00') >= cutoff);
  if (eligible.length < 10) return null;
  const recent = eligible.slice(0, 12);
  if (recent.length < 12) {
    const avg = recent.reduce((s, r) => s + r.differential, 0) / recent.length;
    return Math.trunc(avg);
  }
  const sorted = [...recent].sort((a, b) => a.differential - b.differential);
  const middle = sorted.slice(1, 11);
  const avg = middle.reduce((s, r) => s + r.differential, 0) / middle.length;
  return Math.trunc(avg);
}

function calcHandicapDecimal(rounds) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  const eligible = rounds.filter(r => new Date(r.date + 'T00:00:00') >= cutoff);
  if (eligible.length < 10) return null;
  const recent = eligible.slice(0, 12);
  if (recent.length < 12) {
    const avg = recent.reduce((s, r) => s + r.differential, 0) / recent.length;
    return Math.trunc(avg * 10) / 10;
  }
  const sorted = [...recent].sort((a, b) => a.differential - b.differential);
  const middle = sorted.slice(1, 11);
  const avg = middle.reduce((s, r) => s + r.differential, 0) / middle.length;
  return Math.trunc(avg * 10) / 10;
}

function generateMemberNumber() {
  const a = String(Math.floor(1000 + Math.random() * 9000));
  const b = String(Math.floor(1000 + Math.random() * 9000));
  return `${a}-${b}`;
}

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Courses ───────────────────────────────────────────────────────────────────
const COURSES = [
  { name: "Pebble Beach Golf Links", location: "Pebble Beach, CA", tees: [{name:"Black",rating:75.5,slope:145},{name:"Blue",rating:73.8,slope:139},{name:"White",rating:71.5,slope:132},{name:"Gold",rating:69.2,slope:124},{name:"Red",rating:70.8,slope:128}] },
  { name: "Augusta National Golf Club", location: "Augusta, GA", tees: [{name:"Black",rating:76.2,slope:137},{name:"Blue",rating:74.5,slope:131},{name:"White",rating:72.1,slope:125},{name:"Gold",rating:69.8,slope:118},{name:"Red",rating:71.2,slope:122}] },
  { name: "Pinehurst No. 2", location: "Pinehurst, NC", tees: [{name:"Black",rating:76.1,slope:153},{name:"Blue",rating:74.2,slope:146},{name:"White",rating:71.8,slope:138},{name:"Gold",rating:69.5,slope:130},{name:"Red",rating:70.9,slope:134}] },
  { name: "Bethpage Black", location: "Farmingdale, NY", tees: [{name:"Black",rating:75.4,slope:148},{name:"Blue",rating:73.1,slope:140},{name:"White",rating:70.8,slope:132},{name:"Gold",rating:68.4,slope:124},{name:"Red",rating:69.7,slope:128}] },
  { name: "Torrey Pines South", location: "La Jolla, CA", tees: [{name:"Black",rating:75.9,slope:145},{name:"Blue",rating:73.6,slope:138},{name:"White",rating:71.2,slope:130},{name:"Gold",rating:68.9,slope:123},{name:"Red",rating:70.3,slope:127}] },
  { name: "Whistling Straits", location: "Haven, WI", tees: [{name:"Black",rating:76.6,slope:151},{name:"Blue",rating:74.3,slope:143},{name:"White",rating:72.0,slope:135},{name:"Gold",rating:69.6,slope:127},{name:"Red",rating:71.1,slope:131}] },
  { name: "Oakmont Country Club", location: "Oakmont, PA", tees: [{name:"Black",rating:77.0,slope:155},{name:"Blue",rating:74.8,slope:147},{name:"White",rating:72.3,slope:139},{name:"Gold",rating:70.0,slope:131},{name:"Red",rating:71.4,slope:135}] },
  { name: "Winged Foot West", location: "Mamaroneck, NY", tees: [{name:"Black",rating:75.8,slope:144},{name:"Blue",rating:73.5,slope:137},{name:"White",rating:71.1,slope:129},{name:"Gold",rating:68.8,slope:122},{name:"Red",rating:70.2,slope:126}] },
  { name: "Shinnecock Hills", location: "Southampton, NY", tees: [{name:"Black",rating:74.9,slope:140},{name:"Blue",rating:72.7,slope:133},{name:"White",rating:70.4,slope:126},{name:"Gold",rating:68.1,slope:119},{name:"Red",rating:69.5,slope:123}] },
  { name: "TPC Sawgrass (Stadium)", location: "Ponte Vedra Beach, FL", tees: [{name:"Black",rating:75.8,slope:145},{name:"Blue",rating:73.4,slope:137},{name:"White",rating:71.0,slope:129},{name:"Gold",rating:68.7,slope:122},{name:"Red",rating:70.1,slope:126}] },
  { name: "TPC Scottsdale Stadium Course", location: "Scottsdale, AZ", tees: [{name:"Black",rating:73.4,slope:136},{name:"Blue",rating:71.2,slope:129},{name:"White",rating:68.9,slope:122},{name:"Gold",rating:66.5,slope:115},{name:"Red",rating:67.8,slope:118}] },
  { name: "Troon North Monument", location: "Scottsdale, AZ", tees: [{name:"Black",rating:73.8,slope:140},{name:"Blue",rating:71.5,slope:133},{name:"White",rating:69.2,slope:126},{name:"Gold",rating:66.9,slope:119},{name:"Red",rating:68.1,slope:122}] },
  { name: "Desert Mountain Cochise", location: "Scottsdale, AZ", tees: [{name:"Black",rating:73.2,slope:135},{name:"Blue",rating:71.0,slope:128},{name:"White",rating:68.7,slope:121},{name:"Gold",rating:66.3,slope:114},{name:"Red",rating:67.6,slope:117}] },
  { name: "We-Ko-Pa Saguaro", location: "Fort McDowell, AZ", tees: [{name:"Black",rating:73.5,slope:138},{name:"Blue",rating:71.3,slope:131},{name:"White",rating:69.0,slope:124},{name:"Gold",rating:66.6,slope:117},{name:"Red",rating:67.9,slope:120}] },
  { name: "Grayhawk Raptor", location: "Scottsdale, AZ", tees: [{name:"Black",rating:73.9,slope:142},{name:"Blue",rating:71.6,slope:135},{name:"White",rating:69.3,slope:128},{name:"Gold",rating:67.0,slope:121},{name:"Red",rating:68.2,slope:124}] },
  { name: "Bay Hill Club & Lodge", location: "Orlando, FL", tees: [{name:"Black",rating:74.7,slope:142},{name:"Blue",rating:72.4,slope:135},{name:"White",rating:70.1,slope:128},{name:"Gold",rating:67.8,slope:121},{name:"Red",rating:69.1,slope:124}] },
  { name: "Seminole Golf Club", location: "Juno Beach, FL", tees: [{name:"Black",rating:73.2,slope:136},{name:"Blue",rating:71.0,slope:129},{name:"White",rating:68.7,slope:122},{name:"Gold",rating:66.4,slope:115},{name:"Red",rating:67.7,slope:118}] },
  { name: "Harbour Town Golf Links", location: "Hilton Head, SC", tees: [{name:"Black",rating:73.7,slope:136},{name:"Blue",rating:71.5,slope:129},{name:"White",rating:69.2,slope:122},{name:"Gold",rating:66.8,slope:115},{name:"Red",rating:68.0,slope:118}] },
  { name: "Muirfield Village Golf Club", location: "Dublin, OH", tees: [{name:"Black",rating:76.3,slope:148},{name:"Blue",rating:74.0,slope:141},{name:"White",rating:71.7,slope:134},{name:"Gold",rating:69.3,slope:127},{name:"Red",rating:70.7,slope:130}] },
  { name: "Quail Hollow Club", location: "Charlotte, NC", tees: [{name:"Black",rating:75.8,slope:145},{name:"Blue",rating:73.5,slope:138},{name:"White",rating:71.2,slope:131},{name:"Gold",rating:68.8,slope:124},{name:"Red",rating:70.2,slope:127}] },
  { name: "East Lake Golf Club", location: "Atlanta, GA", tees: [{name:"Black",rating:74.9,slope:140},{name:"Blue",rating:72.6,slope:133},{name:"White",rating:70.3,slope:126},{name:"Gold",rating:68.0,slope:119},{name:"Red",rating:69.3,slope:122}] },
  { name: "Bandon Dunes", location: "Bandon, OR", tees: [{name:"Black",rating:73.4,slope:130},{name:"Blue",rating:71.2,slope:124},{name:"White",rating:68.9,slope:117},{name:"Gold",rating:66.5,slope:111},{name:"Red",rating:67.8,slope:114}] },
  { name: "Pacific Dunes", location: "Bandon, OR", tees: [{name:"Black",rating:74.1,slope:135},{name:"Blue",rating:71.8,slope:128},{name:"White",rating:69.5,slope:122},{name:"Gold",rating:67.2,slope:115},{name:"Red",rating:68.4,slope:118}] },
  { name: "Shadow Creek", location: "North Las Vegas, NV", tees: [{name:"Black",rating:74.6,slope:140},{name:"Blue",rating:72.3,slope:133},{name:"White",rating:70.0,slope:126},{name:"Gold",rating:67.7,slope:119},{name:"Red",rating:69.0,slope:122}] },
  { name: "Streamsong Red", location: "Streamsong, FL", tees: [{name:"Black",rating:74.3,slope:138},{name:"Blue",rating:72.1,slope:131},{name:"White",rating:69.8,slope:124},{name:"Gold",rating:67.4,slope:117},{name:"Red",rating:68.7,slope:120}] },
  { name: "Valhalla Golf Club", location: "Louisville, KY", tees: [{name:"Black",rating:75.8,slope:146},{name:"Blue",rating:73.5,slope:139},{name:"White",rating:71.2,slope:132},{name:"Gold",rating:68.9,slope:125},{name:"Red",rating:70.2,slope:128}] },
  { name: "Kiawah Island Ocean Course", location: "Kiawah Island, SC", tees: [{name:"Black",rating:77.0,slope:152},{name:"Blue",rating:74.7,slope:145},{name:"White",rating:72.4,slope:138},{name:"Gold",rating:70.1,slope:131},{name:"Red",rating:71.4,slope:134}] },
  { name: "Medinah Country Club No. 3", location: "Medinah, IL", tees: [{name:"Black",rating:76.5,slope:149},{name:"Blue",rating:74.2,slope:142},{name:"White",rating:71.9,slope:135},{name:"Gold",rating:69.6,slope:128},{name:"Red",rating:70.9,slope:131}] },
  { name: "Baltusrol Golf Club Lower", location: "Springfield, NJ", tees: [{name:"Black",rating:75.8,slope:143},{name:"Blue",rating:73.5,slope:136},{name:"White",rating:71.2,slope:129},{name:"Gold",rating:68.9,slope:122},{name:"Red",rating:70.2,slope:125}] },
  { name: "Riviera Country Club", location: "Pacific Palisades, CA", tees: [{name:"Black",rating:75.7,slope:143},{name:"Blue",rating:73.4,slope:136},{name:"White",rating:71.1,slope:129},{name:"Gold",rating:68.8,slope:122},{name:"Red",rating:70.1,slope:125}] },
  { name: "Colonial Country Club", location: "Fort Worth, TX", tees: [{name:"Black",rating:73.9,slope:135},{name:"Blue",rating:71.7,slope:128},{name:"White",rating:69.4,slope:121},{name:"Gold",rating:67.0,slope:114},{name:"Red",rating:68.3,slope:117}] },
  { name: "Southern Hills Country Club", location: "Tulsa, OK", tees: [{name:"Black",rating:75.5,slope:145},{name:"Blue",rating:73.2,slope:138},{name:"White",rating:70.9,slope:131},{name:"Gold",rating:68.6,slope:124},{name:"Red",rating:69.9,slope:127}] },
  { name: "Hazeltine National Golf Club", location: "Chaska, MN", tees: [{name:"Black",rating:75.1,slope:143},{name:"Blue",rating:72.8,slope:136},{name:"White",rating:70.5,slope:129},{name:"Gold",rating:68.2,slope:122},{name:"Red",rating:69.5,slope:125}] },
  { name: "Caves Valley Golf Club", location: "Owings Mills, MD", tees: [{name:"Black",rating:75.6,slope:144},{name:"Blue",rating:73.3,slope:137},{name:"White",rating:71.0,slope:130},{name:"Gold",rating:68.7,slope:123},{name:"Red",rating:70.0,slope:126}] },
  { name: "Spyglass Hill Golf Course", location: "Pebble Beach, CA", tees: [{name:"Black",rating:75.3,slope:148},{name:"Blue",rating:73.0,slope:141},{name:"White",rating:70.7,slope:134},{name:"Gold",rating:68.4,slope:127},{name:"Red",rating:69.7,slope:130}] },
  { name: "Arcadia Bluffs South", location: "Arcadia, MI", tees: [{name:"Black",rating:74.8,slope:141},{name:"Blue",rating:72.5,slope:134},{name:"White",rating:70.2,slope:127},{name:"Gold",rating:67.9,slope:120},{name:"Red",rating:69.2,slope:123}] },
  { name: "Sand Hills Golf Club", location: "Mullen, NE", tees: [{name:"Black",rating:73.1,slope:138},{name:"Blue",rating:70.9,slope:131},{name:"White",rating:68.6,slope:124},{name:"Gold",rating:66.2,slope:117},{name:"Red",rating:67.5,slope:120}] },
  { name: "Prairie Dunes Country Club", location: "Hutchinson, KS", tees: [{name:"Black",rating:71.5,slope:130},{name:"Blue",rating:69.3,slope:124},{name:"White",rating:67.0,slope:117},{name:"Gold",rating:64.7,slope:110},{name:"Red",rating:65.9,slope:113}] },
];

// ─── Global Styles ─────────────────────────────────────────────────────────────
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800;900&display=swap');
  * { font-family: 'Geist','Inter',system-ui,sans-serif !important; box-sizing: border-box; }
  input::placeholder { color: rgba(245,240,232,0.2); }
  input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
  .auth-btn-primary:hover { filter: brightness(1.1); }
  .auth-btn-ghost:hover { border-color: rgba(201,168,76,0.6) !important; color: rgba(201,168,76,0.9) !important; }
  .auth-link:hover { color: #f5c842; }
  .confirm-post-btn:hover{filter:brightness(1.15);transform:scale(1.02);transition:all 0.15s ease;}
  .tab-btn:hover{color:rgba(245,240,232,0.75)!important;transition:all 0.15s ease;}
  .tab-btn-active:hover{color:#e8b84b!important;transition:none;}
  .confirm-cancel-btn:hover{background:rgba(201,168,76,0.1)!important;border-color:rgba(201,168,76,0.6)!important;color:rgba(201,168,76,0.9)!important;transition:all 0.15s ease;}
  .info-tooltip{position:relative;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid rgba(245,240,232,0.6);color:rgba(245,240,232,0.7);font-size:8px;cursor:pointer;font-style:italic;font-weight:700;flex-shrink:0;vertical-align:middle;}
  .info-tooltip .tooltip-text{visibility:hidden;opacity:0;position:absolute;top:20px;right:0;background:#0d1b2e;border:1px solid rgba(232,184,75,0.4);border-radius:4px;padding:8px 10px;font-size:9px;letter-spacing:1px;color:rgba(245,240,232,0.7);white-space:nowrap;z-index:999;transition:opacity 0.2s ease;pointer-events:none;}
  .info-tooltip:hover .tooltip-text,.info-tooltip.active .tooltip-text{visibility:visible;opacity:1;}
  .ttm-tooltip{position:relative;cursor:pointer;border-bottom:1px dotted rgba(201,168,76,0.4);}
  .ttm-tooltip .tooltip-text{visibility:hidden;opacity:0;position:absolute;top:18px;left:50%;transform:translateX(-50%);background:#0d1b2e;border:1px solid rgba(232,184,75,0.4);border-radius:4px;padding:6px 10px;font-size:9px;letter-spacing:1px;color:rgba(245,240,232,0.7);white-space:nowrap;z-index:999;transition:opacity 0.2s ease;pointer-events:none;}
  .ttm-tooltip:hover .tooltip-text{visibility:visible;opacity:1;}
  .avatar-btn:hover{border-color:rgba(232,184,75,0.7)!important;background:linear-gradient(135deg,#1e4570,#1a3a5c)!important;transition:all 0.15s ease;}
  .signout-btn:hover{filter:brightness(1.25);transition:filter 0.15s ease;}
  .avatar-wrap .avatar-tooltip{visibility:hidden;opacity:0;position:absolute;top:36px;right:0;background:#0d1b2e;border:1px solid rgba(232,184,75,0.4);border-radius:4px;padding:5px 9px;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:rgba(245,240,232,0.7);white-space:nowrap;transition:opacity 0.15s ease;pointer-events:none;font-family:'Geist',sans-serif;font-weight:600;}
  .avatar-wrap:hover .avatar-tooltip{visibility:visible;opacity:1;}
`;

// ─── Auth Screen ───────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('landing');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const S = {
    wrap: { maxWidth:430, margin:'0 auto', minHeight:'100vh', background:'#0d1b2e', color:'#f5f0e8', display:'flex', flexDirection:'column' },
    top: { background:'linear-gradient(180deg,#112240 0%,#0d1b2e 100%)', padding:'52px 20px 28px', textAlign:'center' },
    title: { fontSize:24, fontWeight:800, color:'#fff', textTransform:'uppercase', letterSpacing:3, marginBottom:4 },
    sub: { fontSize:9, fontWeight:500, letterSpacing:3, textTransform:'uppercase', color:'#e02247' },
    divider: { height:1, background:'rgba(201,168,76,0.25)', margin:'24px 0 0' },
    body: { padding:'32px 24px', flex:1 },
    label: { fontSize:9, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.75)', marginBottom:6, display:'block', paddingLeft:2 },
    input: { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'12px', color:'#f5f0e8', fontSize:15, outline:'none', width:'100%' },
    btnPrimary: { width:'100%', padding:14, background:'linear-gradient(135deg,#c41e3a,#9e1830)', border:'none', borderRadius:3, color:'#f5f0e8', fontSize:13, fontWeight:900, letterSpacing:4, textTransform:'uppercase', cursor:'pointer', marginTop:8 },
    btnGhost: { width:'100%', padding:14, background:'transparent', border:'1px solid rgba(201,168,76,0.3)', borderRadius:3, color:'rgba(201,168,76,0.7)', fontSize:13, fontWeight:700, letterSpacing:4, textTransform:'uppercase', cursor:'pointer', marginTop:8 },
    error: { fontSize:11, color:'#e02247', letterSpacing:1, marginTop:10, textAlign:'center' },
    success: { fontSize:11, color:'#84e040', letterSpacing:1, marginTop:10, textAlign:'center' },
    field: { marginBottom:16 },
    switchText: { textAlign:'center', fontSize:11, color:'rgba(245,240,232,0.4)', marginTop:22, letterSpacing:1 },
    back: { background:'none', border:'none', color:'rgba(201,168,76,0.5)', fontSize:11, letterSpacing:2, textTransform:'uppercase', cursor:'pointer', marginBottom:22, padding:0 },
  };

  const Header = () => (
    <div style={S.top}>
      <div style={S.title}>The Modern Index</div>
      <div style={S.sub}>A More Honest Golf Handicap</div>
      <div style={S.divider} />
    </div>
  );

  const anonHeaders = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY };

  const handleSignUp = async () => {
    setError(''); setMessage('');
    if (!name.trim()) return setError('Please enter your name.');
    if (!email.trim() || !email.includes('@')) return setError('Please enter a valid email.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST", headers: anonHeaders,
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.user) { setLoading(false); return setError(data.error_description || data.msg || "Sign up failed. Please try again."); }
      const session = { access_token: data.access_token, expires_at: data.expires_at, user: data.user };
      localStorage.setItem("sb-session", JSON.stringify(session));
      const memberNumber = generateMemberNumber();
      const authHeader = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${data.access_token}`, "Prefer": "return=representation" };
      const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST", headers: authHeader,
        body: JSON.stringify({ id: data.user.id, name: name.trim(), member_number: memberNumber }),
      });
      if (!profRes.ok) { const e = await profRes.json(); setLoading(false); return setError(e.message || "Failed to create profile."); }
      onAuth({ id: data.user.id, name: name.trim(), email: data.user.email, memberNumber, createdAt: new Date().toISOString() });
    } catch (e) { setError("Network error. Please try again."); }
    setLoading(false);
  };

  const handleLogin = async () => {
    setError(''); setMessage('');
    if (!email.trim() || !password) return setError('Please enter your email and password.');
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: anonHeaders,
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.access_token) { setLoading(false); return setError(data.error_description || "Invalid email or password."); }
      const session = { access_token: data.access_token, expires_at: data.expires_at, user: data.user };
      localStorage.setItem("sb-session", JSON.stringify(session));
      const authHeader = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${data.access_token}`, "Accept": "application/vnd.pgrst.object+json" };
      const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${data.user.id}&select=*`, { headers: authHeader });
      const profile = await profRes.json();
      if (!profRes.ok || !profile?.name) { setLoading(false); return setError("Could not load profile."); }
      onAuth({ id: data.user.id, name: profile.name, email: data.user.email, memberNumber: profile.member_number, createdAt: profile.created_at });
    } catch (e) { setError("Network error. Please try again."); }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setError(''); setMessage('');
    if (!resetEmail.trim() || !resetEmail.includes('@')) return setError('Please enter a valid email.');
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST", headers: anonHeaders,
        body: JSON.stringify({ email: resetEmail.trim().toLowerCase() }),
      });
      if (!res.ok) { const e = await res.json(); setLoading(false); return setError(e.error_description || "Reset failed."); }
      setMessage('Password reset email sent. Check your inbox.');
    } catch (e) { setError("Network error. Please try again."); }
    setLoading(false);
  };

  if (mode === 'landing') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <div style={S.body}>
        <div style={{textAlign:'center', marginBottom:40, marginTop:48}}>
          <div style={{fontSize:28, fontWeight:900, color:'#f5f0e8', letterSpacing:5, textTransform:'uppercase', lineHeight:1.1, marginBottom:14}}>The Modern Index</div>
          <div style={{fontSize:12, fontWeight:700, color:'#e02247', letterSpacing:3, textTransform:'uppercase'}}>A More Honest Golf Handicap</div>
        </div>
        <div style={{height:1, background:'rgba(201,168,76,0.25)', margin:'0 0 24px'}}/>
        <button className="auth-btn-primary" style={{...S.btnPrimary, background:'linear-gradient(135deg,#e8b84b,#c49a30)', color:'#0d1b2e'}} onClick={()=>setMode('login')}>Log In</button>
        <button className="auth-btn-ghost" style={S.btnGhost} onClick={()=>setMode('signup')}>Create Account</button>
      </div>
    </div>
  );

  if (mode === 'signup') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:24}}>
        <button style={{...S.back, marginBottom:22}} onClick={()=>{setMode('landing');setError('');}}>← Back</button>
        <div style={S.field}><label style={S.label}>Full Name</label><input style={S.input} placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} /></div>
        <div style={S.field}><label style={S.label}>Email</label><input style={S.input} placeholder="you@email.com" type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
        <div style={S.field}><label style={S.label}>Password</label><input style={S.input} placeholder="Min. 6 characters" type="password" value={password} onChange={e=>setPassword(e.target.value)} /></div>
        <div style={S.field}><label style={S.label}>Confirm Password</label><input style={S.input} placeholder="Re-enter password" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} /></div>
        {error && <div style={S.error}>{error}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleSignUp} disabled={loading}>{loading?'Creating Account...':'Create Account'}</button>
        <div style={S.switchText}>Already have an account? <span className="auth-link" style={{color:'#e8b84b',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{setMode('login');setError('');}}>Log in</span></div>
      </div>
    </div>
  );

  if (mode === 'login') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:24}}>
        <button style={{...S.back, marginBottom:22}} onClick={()=>{setMode('landing');setError('');}}>← Back</button>
        <div style={S.field}><label style={S.label}>Email</label><input style={S.input} placeholder="you@email.com" type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
        <div style={S.field}><label style={S.label}>Password</label><input style={S.input} placeholder="Your password" type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleLogin()} /></div>
        {error && <div style={S.error}>{error}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleLogin} disabled={loading}>{loading?'Logging In...':'Log In'}</button>
        <div style={{textAlign:'center',marginTop:14}}>
          <span className="auth-link" style={{fontSize:11,color:'#e8b84b',cursor:'pointer',letterSpacing:1,textDecoration:'underline'}} onClick={()=>{setMode('forgot');setError('');setMessage('');}}>Forgot password?</span>
        </div>
        <div style={{...S.switchText,marginTop:8}}>Don't have an account? <span className="auth-link" style={{color:'#e8b84b',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{setMode('signup');setError('');}}>Sign up</span></div>
      </div>
    </div>
  );

  if (mode === 'forgot') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:24}}>
        <button style={{...S.back, marginBottom:22}} onClick={()=>{setMode('login');setError('');setMessage('');}}>← Back</button>
        <div style={{fontSize:12,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:20,marginTop:16}}>Reset Password</div>
        <div style={S.field}><label style={S.label}>Email</label><input style={S.input} placeholder="you@email.com" type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} /></div>
        {error && <div style={S.error}>{error}</div>}
        {message && <div style={S.success}>{message}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleForgotPassword} disabled={loading}>{loading?'Sending...':'Send Reset Email'}</button>
      </div>
    </div>
  );
}

// ─── Profile Drawer ────────────────────────────────────────────────────────────
function ProfileDrawer({ user, roundCount, handicap, onClose, onSignOut }) {
  return (
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:200}} />
      <div style={{position:'fixed',top:0,right:0,bottom:0,width:272,background:'#0d1b2e',borderLeft:'1px solid rgba(201,168,76,0.18)',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#112240 0%,#0d1b2e 100%)',padding:'16px 20px 14px'}}>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
            <button onClick={onClose} style={{background:'none',border:'none',color:'rgba(245,240,232,0.35)',fontSize:18,cursor:'pointer',padding:0,lineHeight:1}}>✕</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
            <div style={{fontSize:9,fontWeight:600,letterSpacing:3,textTransform:'uppercase',color:'rgba(245,240,232,0.4)'}}>Welcome,</div>
            <div style={{fontSize:20,fontWeight:800,color:'#f5f0e8',textAlign:'center',letterSpacing:1}}>{user.name.split(' ')[0]}</div>
          </div>
          <div style={{marginTop:12,background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,padding:'10px',textAlign:'center',display:'flex',flexDirection:'column',minHeight:72}}>
            <div style={{fontSize:7,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(245,240,232,0.4)',marginBottom:3}}>Membership #:</div>
            <div style={{fontSize:13,fontWeight:700,color:'#e8b84b',letterSpacing:2}}>{user.memberNumber}</div>
            <div style={{fontSize:9,color:'rgba(245,240,232,0.35)',marginTop:'auto',paddingTop:10,letterSpacing:1}}>member since {new Date(user.createdAt).toLocaleDateString('en-US',{year:'numeric'})}</div>
          </div>
        </div>
        <div style={{height:1,background:'rgba(201,168,76,0.12)'}} />
        <div style={{padding:'12px 20px',display:'flex',flexDirection:'column',gap:8}}>
          <div style={{background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,padding:'10px',textAlign:'center'}}>
            <div style={{fontSize:7,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.7)',marginBottom:4}}>{roundCount>=10&&roundCount<12?'Provisional Handicap':'Current Handicap'}</div>
            <div style={{fontSize:28,fontWeight:900,color:'#e8b84b',letterSpacing:1}}>{handicap !== null ? (Math.trunc(handicap) < 0 ? `+${Math.abs(Math.trunc(handicap))}` : Math.trunc(handicap)) : '—'}</div>
          </div>
        </div>
        <div style={{height:1,background:'rgba(201,168,76,0.08)'}} />
        <div style={{padding:'12px 20px',display:'flex',flexDirection:'column',gap:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>My Playing Partners</span>
            <span style={{fontSize:14,color:'rgba(245,240,232,0.3)'}}>›</span>
          </div>
        </div>
        <div style={{height:1,background:'rgba(201,168,76,0.08)'}} />
        <div style={{padding:'10px 20px',display:'flex',flexDirection:'column',gap:6,flex:1,overflowY:'auto'}}>
          {['Account Information','Membership & Payment','Support'].map(label=>(
            <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
              onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>{label}</span>
              <span style={{fontSize:14,color:'rgba(245,240,232,0.3)'}}>›</span>
            </div>
          ))}
        </div>
        <div style={{padding:'12px 20px 28px',flexShrink:0}}>
          <button onClick={onSignOut} className="signout-btn" style={{width:'100%',padding:10,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}

// ─── App Content ───────────────────────────────────────────────────────────────
function AppContent({ user, onSignOut }) {
  const [tab, setTab] = useState("calculator");
  const [showProfile, setShowProfile] = useState(false);
  const [rounds, setRounds] = useState([]);
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [form, setForm] = useState({ course:"", score:"", rating:"", slope:"", tee:"", date:localDateStr() });
  const [added, setAdded] = useState(false);
  const [courseSearch, setCourseSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [showDropdown, setShowDropdown] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [saving, setSaving] = useState(false);

  const authHeaders = () => {
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      const token = s?.access_token || SUPABASE_ANON_KEY;
      return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` };
    } catch { return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }; }
  };

  // Load rounds from Supabase
  useEffect(() => {
    const fetchRounds = async () => {
      setLoadingRounds(true);
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rounds?user_id=eq.${user.id}&select=*&order=date.desc,id.desc`, { headers: authHeaders() });
        const data = await res.json();
        if (res.ok && Array.isArray(data)) setRounds(data);
      } catch (e) {}
      setLoadingRounds(false);
    };
    fetchRounds();
  }, [user.id]);

  const handicap = calcHandicap(rounds);

  const recent12 = rounds.slice(0, 12);
  const sortedByDiff = [...recent12].sort((a, b) => a.differential - b.differential || new Date(b.date) - new Date(a.date));
  const lowestExcludedId = rounds.length >= 12 ? sortedByDiff[0].id : null;
  const highestExcludedId = rounds.length >= 12 ? sortedByDiff[11].id : null;

  const handleAdd = async () => {
    const { course, score, rating, slope, tee, date } = form;
    if (!score || !rating) return;
    const s = parseFloat(score), r = parseFloat(rating), sl = parseFloat(slope) || 113;
    if (isNaN(s) || isNaN(r)) return;
    const todayStr = localDateStr();
    if (date && date > todayStr) return;
    setSaving(true);
    const currentHcp = calcHandicapDecimal(rounds);
    const differential = calcDifferential(s, r, sl, currentHcp);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rounds`, {
        method: "POST",
        headers: { ...authHeaders(), "Prefer": "return=representation" },
        body: JSON.stringify({ user_id: user.id, course: course.trim() || "Unknown Course", score: s, rating: r, slope: sl, tee: tee || null, date: date || todayStr, differential }),
      });
      const data = await res.json();
      const row = Array.isArray(data) ? data[0] : data;
      if (res.ok && row?.id) {
        setRounds(prev => [row, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id));
      }
    } catch (e) {}
    setForm({ course:"", score:"", rating:"", slope:"", tee:"", date:localDateStr() });
    setCourseSearch(""); setShowDropdown(false); setConfirmPost(false); setSelectedCourse(null);
    setSaving(false);
    setAdded(true); setTimeout(() => setAdded(false), 2000);
  };

  const handleDelete = async (id) => {
    await fetch(`${SUPABASE_URL}/rest/v1/rounds?id=eq.${id}&user_id=eq.${user.id}`, { method: "DELETE", headers: authHeaders() });
    setRounds(prev => prev.filter(r => r.id !== id));
    setPendingDelete(null);
  };

  const cancelPost = () => {
    setConfirmPost(false);
    setForm({ course:"", score:"", rating:"", tee:"", date:localDateStr() });
    setCourseSearch(""); setSelectedCourse(null);
  };

  const minScore = rounds.length ? Math.min(...rounds.map(r => r.score)) : null;
  const ytdRounds = rounds.filter(r => new Date(r.date).getFullYear() === new Date().getFullYear()).length;
  const lowestHandicap = useMemo(() => {
    if (rounds.length < 12) return null;
    let min = null;
    const ws = Math.min(12, rounds.length);
    for (let i = 0; i <= rounds.length - ws; i++) {
      const h = calcHandicapAllTime(rounds.slice(i, i + ws));
      if (h !== null && (min === null || h < min)) min = h;
    }
    return min;
  }, [rounds]);

  // Deletable = posted within 24 hours (using created_at from Supabase)
  const isDeletable = (round) => {
    if (!round.created_at) return false;
    return (Date.now() - new Date(round.created_at).getTime()) < 86400000;
  };

  const S = {
    app: { maxWidth:430, margin:'0 auto', minHeight:'100vh', background:'#0d1b2e', color:'#f5f0e8', position:'relative' },
    header: { background:'linear-gradient(180deg,#112240 0%,#0d1b2e 100%)', padding:'14px 20px 0', position:'relative' },
    headerMain: { fontSize:26, fontWeight:800, color:'#fff', textAlign:'center', textTransform:'uppercase', lineHeight:1.1, letterSpacing:4, marginBottom:2 },
    headerSub: { fontSize:9, fontWeight:500, letterSpacing:4, textTransform:'uppercase', color:'#e02247', textAlign:'center', marginTop:6, marginBottom:8 },
    tab: (a) => ({ flex:1, textAlign:'center', padding:'8px 4px', background:a?'rgba(245,240,232,0.08)':'transparent', borderRadius:4, border:a?'1px solid rgba(245,240,232,0.15)':'1px solid transparent', fontSize:11, fontWeight:600, letterSpacing:1, textTransform:'uppercase', color:a?'#e8b84b':'rgba(245,240,232,0.35)', cursor:'pointer', position:'relative', bottom:-3, whiteSpace:'nowrap' }),
    content: { padding:'12px 20px 20px' },
    hcap: { background:'linear-gradient(135deg,#0f1e35 0%,#112240 100%)', border:'2px solid #e8b84b', borderRadius:4, padding:'24px 20px', textAlign:'center', marginBottom:16 },
    hcapLabel: { fontSize:13, fontWeight:900, letterSpacing:6, textTransform:'uppercase', color:'#e8b84b', marginBottom:10 },
    hcapValue: { fontSize:80, fontWeight:800, color:'#e8b84b', lineHeight:1, letterSpacing:-3 },
    card: { background:'#112240', border:'1px solid rgba(201,168,76,0.25)', borderRadius:4, padding:'20px 10px 20px 20px', marginBottom:16 },
    cardTitle: { fontSize:9, fontWeight:700, letterSpacing:4, textTransform:'uppercase', color:'#f5f0e8', marginBottom:16 },
    label: { fontSize:9, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.75)', marginBottom:6, display:'block', paddingLeft:4 },
    input: { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'11px 12px 11px 6px', color:'#f5f0e8', fontSize:15, fontWeight:400, outline:'none', width:'100%' },
    btn: { width:'100%', padding:14, background:'linear-gradient(135deg,#c41e3a,#9e1830)', border:'none', borderRadius:3, color:'#f5f0e8', fontSize:13, fontWeight:900, letterSpacing:4, textTransform:'uppercase', cursor:'pointer', marginTop:4 },
    btnGhost: { padding:'7px 14px', background:'transparent', border:'1px solid rgba(201,168,76,0.3)', borderRadius:3, color:'rgba(201,168,76,0.6)', fontSize:9, fontWeight:600, letterSpacing:3, textTransform:'uppercase', cursor:'pointer' },
    roundItem: (f) => ({ display:'flex', alignItems:'center', padding:'12px 0', borderBottom:'1px solid rgba(201,168,76,0.08)', opacity:f?0.55:1 }),
    roundScore: { background:'#0d1b2e', border:'1px solid rgba(232,184,75,0.35)', borderRadius:2, padding:'5px 12px', fontSize:14, fontWeight:600, color:'#e8b84b', minWidth:42, textAlign:'center' },
    roundDetails: { flex:1, padding:'0 12px' },
    roundCourse: { fontSize:13, fontWeight:500, color:'#f5f0e8', marginBottom:3 },
    roundMeta: { fontSize:10, fontWeight:400, color:'rgba(201,168,76,0.7)' },
    roundDiff: { fontSize:18, fontWeight:500, color:'#e8b84b', minWidth:40, textAlign:'center' },
    statGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 },
    statBox: { background:'rgba(8,18,36,0.6)', border:'1px solid rgba(201,168,76,0.15)', borderRadius:3, padding:'16px 12px', textAlign:'center', display:'flex', flexDirection:'column', justifyContent:'space-between' },
    statLabel: { fontSize:8, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'#f5f0e8', marginBottom:8 },
    statVal: { fontSize:28, fontWeight:700, color:'#e8b84b', letterSpacing:-1 },
  };

  return (
    <div style={S.app}>
      <style>{globalStyles}</style>

      {showProfile && <ProfileDrawer user={user} roundCount={rounds.length} handicap={calcHandicapDecimal(rounds)} onClose={()=>setShowProfile(false)} onSignOut={onSignOut} />}

      {pendingDelete && (
        <div onClick={()=>setPendingDelete(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#112240',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'28px 24px',maxWidth:300,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:12,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:16}}>Delete Round</div>
            <div style={{fontSize:14,color:'rgba(245,240,232,0.7)',marginBottom:20,lineHeight:1.8}}>This round will be<br/>permanently removed</div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <button className="confirm-post-btn" style={{...S.btn,margin:0,padding:8,fontWeight:400,letterSpacing:1,background:'linear-gradient(135deg,#c41e3a,#9e1830)'}} onClick={()=>handleDelete(pendingDelete)}>Yes, Delete</button>
              <button className="confirm-cancel-btn" style={{...S.btnGhost,width:'100%',padding:8}} onClick={()=>setPendingDelete(null)}>No, Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmPost && (
        <div onClick={cancelPost} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#112240',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'28px 24px',maxWidth:300,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:12,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:10}}>Confirm Round</div>
            <div style={{fontSize:14,color:'rgba(245,240,232,0.7)',marginBottom:20,lineHeight:1.5}}>
              <div style={{marginBottom:10}}><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)'}}>Course</span><br/><span style={{color:'#f5f0e8',fontSize:15}}>{form.course||"Unknown Course"}</span></div>
              <div style={{display:'flex',gap:20,justifyContent:'center',marginBottom:10}}>
                {form.tee&&<div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Tee</span><span style={{color:'#f5f0e8'}}>{form.tee}</span></div>}
                <div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Rating</span><span style={{color:'#f5f0e8'}}>{form.rating}</span></div>
                {form.slope&&<div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Slope</span><span style={{color:'#f5f0e8'}}>{form.slope}</span></div>}
              </div>
              <div style={{display:'flex',gap:20,justifyContent:'center'}}>
                <div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Score</span><span style={{color:'#f5f0e8'}}>{form.score}</span></div>
                <div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Date</span><span style={{color:'#f5f0e8'}}>{new Date(form.date+'T00:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'2-digit'})}</span></div>
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <button className="confirm-post-btn" style={{...S.btn,margin:0,padding:8,fontWeight:400,letterSpacing:1,opacity:saving?0.5:1}} onClick={handleAdd} disabled={saving}>{saving?'Saving...':'Yes, Post Round'}</button>
              <button className="confirm-cancel-btn" style={{...S.btnGhost,width:'100%',padding:8}} onClick={cancelPost}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={S.header}>
        <div style={{position:'absolute',top:14,right:16,zIndex:10}} className="avatar-wrap">
          <button className="avatar-btn" onClick={()=>setShowProfile(true)} style={{width:30,height:30,borderRadius:'50%',background:'linear-gradient(135deg,#1a3a5c,#112240)',border:'1.5px solid rgba(232,184,75,0.32)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}>
            <svg width="16" height="18" viewBox="0 0 16 18" fill="none"><line x1="7" y1="1" x2="7" y2="17" stroke="#e8b84b" strokeWidth="1.8" strokeLinecap="round"/><polygon points="7,1 14,4 7,7" fill="#e8b84b"/></svg>
          </button>
          <div className="avatar-tooltip">Account</div>
        </div>
        <div style={S.headerMain}>THE MODERN INDEX</div>
        <div style={S.headerSub}>A More Honest Golf Handicap</div>
        <div style={{height:1,background:'rgba(201,168,76,0.25)',margin:'0 0 8px 0'}}/>
        <div style={{display:'flex',width:'100%',gap:4}}>
          <button className={`tab-btn${tab==='calculator'?' tab-btn-active':''}`} style={{...S.tab(tab==='calculator'),flex:1}} onClick={()=>setTab('calculator')}>Post A Round</button>
          <button className={`tab-btn${tab==='rounds'?' tab-btn-active':''}`} style={{...S.tab(tab==='rounds'),flex:1}} onClick={()=>setTab('rounds')}>Round History</button>
          <button className={`tab-btn${tab==='stats'?' tab-btn-active':''}`} style={{...S.tab(tab==='stats'),flex:1}} onClick={()=>setTab('stats')}>My Analytics</button>
        </div>
      </div>

      <div style={S.content}>
        {/* Handicap */}
        <div style={S.hcap}>
          <div style={{position:'relative',display:'inline-block'}}>
            <div style={S.hcapLabel}>{rounds.length>=10&&rounds.length<12?'Provisional Handicap':'Current Handicap'}</div>
            {(handicap===null||rounds.length<12)&&<span style={{position:'absolute',top:-4,right:-10,fontSize:14,color:'rgba(232,184,75,0.7)',lineHeight:1}}>*</span>}
          </div>
          {loadingRounds
            ? <div style={{fontSize:20,color:'rgba(232,184,75,0.4)',letterSpacing:2}}>—</div>
            : <div style={S.hcapValue}>{handicap!==null?(handicap<0?<span><span style={{fontSize:'0.6em',verticalAlign:'middle',position:'relative',top:'-0.15em',marginRight:'0.18em'}}>+</span>{Math.abs(handicap)}</span>:handicap):"—"}</div>
          }
          {!loadingRounds&&rounds.length<12&&<div style={{fontSize:11,color:'rgba(232,184,75,0.5)',marginTop:10,letterSpacing:1}}>* {12-rounds.length} {rounds.length>0?'more ':''}posted round{12-rounds.length===1?'':'s'} needed</div>}
        </div>

        {/* Post A Round */}
        {tab==="calculator"&&(
          <div style={S.card}>
            <div style={{position:'relative',marginBottom:12}}>
              <label style={S.label}>Golf Course</label>
              <input style={{...S.input,paddingLeft:7}} placeholder="Search..." value={form.course}
                onChange={e=>{setForm(p=>({...p,course:e.target.value,rating:'',tee:''}));setCourseSearch(e.target.value);setShowDropdown(true);setSelectedCourse(null);}}
                onFocus={()=>setShowDropdown(true)} onBlur={()=>setTimeout(()=>setShowDropdown(false),150)} autoComplete="off"/>
              {showDropdown&&courseSearch.length>=2&&(()=>{
                const matches=COURSES.filter(c=>c.name.toLowerCase().includes(courseSearch.toLowerCase())||c.location.toLowerCase().includes(courseSearch.toLowerCase())).slice(0,8);
                if(!matches.length)return null;
                return(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:100,background:'#112240',border:'1px solid rgba(232,184,75,0.4)',borderRadius:'0 0 4px 4px',maxHeight:220,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,0.4)'}}>
                    {matches.map(c=>(
                      <div key={c.name} onMouseDown={()=>{setForm(p=>({...p,course:c.name,rating:'',tee:''}));setCourseSearch(c.name);setShowDropdown(false);setSelectedCourse(c);}}
                        style={{padding:'10px 14px',cursor:'pointer',borderBottom:'1px solid rgba(232,184,75,0.1)'}}
                        onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <div style={{fontSize:14,color:'#f5f0e8'}}>{c.name}</div>
                        <div style={{fontSize:8,letterSpacing:1,color:'rgba(232,184,75,0.6)',marginTop:2}}>{c.location}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div style={{fontSize:9,letterSpacing:1,color:'rgba(232,184,75,0.4)',marginTop:-8,marginBottom:12,paddingLeft:4}}>Can't find your course? Enter all information manually instead</div>
            {selectedCourse&&(
              <div style={{marginBottom:12}}>
                <label style={{...S.label,paddingLeft:2}}>Tees</label>
                <select value={form.tee} onChange={e=>{const t=selectedCourse.tees.find(t=>t.name===e.target.value);setForm(p=>({...p,tee:e.target.value,rating:t?String(t.rating):'',slope:t?t.slope:null}));}} style={{...S.input,colorScheme:'dark',cursor:'pointer',paddingLeft:14}}>
                  <option value="">Select...</option>
                  {selectedCourse.tees.map(t=><option key={t.name} value={t.name}>{form.tee===t.name?t.name:`${t.name} — ${t.rating}, Slope ${t.slope||'—'}`}</option>)}
                </select>
              </div>
            )}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div><label style={{...S.label,opacity:selectedCourse?0.4:1}}>Course Rating</label><input style={{...S.input,opacity:selectedCourse?0.5:1,paddingLeft:10}} type="number" step="0.1" value={form.rating} onChange={e=>setForm(p=>({...p,rating:e.target.value}))} readOnly={!!selectedCourse}/></div>
              <div><label style={{...S.label,opacity:selectedCourse?0.4:1}}>Slope</label><input style={{...S.input,opacity:selectedCourse?0.5:1,paddingLeft:10}} type="number" value={form.slope||''} onChange={e=>setForm(p=>({...p,slope:e.target.value}))} readOnly={!!selectedCourse}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div><label style={S.label}>Score</label><input style={{...S.input,paddingLeft:10}} type="number" min="50" max="200" value={form.score} onChange={e=>setForm(p=>({...p,score:e.target.value}))}/></div>
              <div><label style={S.label}>Date of Round</label><input style={{...S.input,colorScheme:'dark',paddingLeft:7}} type="date" value={form.date} max={localDateStr()} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
            </div>
            <button style={{...S.btn,opacity:(!form.score||!form.rating)?0.4:1,background:added?'linear-gradient(135deg,#4caa18,#2d7a0e)':S.btn.background}} onClick={()=>setConfirmPost(true)} disabled={!form.score||!form.rating}>
              {added?"✓ Round Posted":"Post Round"}
            </button>
          </div>
        )}

        {/* Round History */}
        {tab==="rounds"&&(
          <div style={S.card}>
            {rounds.length>0&&(
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',marginBottom:12}}>
                <label style={{...S.label,paddingLeft:2,marginBottom:4}}>Filter by Course</label>
                <select value={courseFilter} onChange={e=>setCourseFilter(e.target.value)} style={{...S.input,colorScheme:'dark',cursor:'pointer',paddingLeft:8,fontSize:11,padding:'6px 8px',width:'auto',minWidth:0,maxWidth:160}}>
                  <option value="all">All Courses</option>
                  {[...new Set(rounds.map(r=>r.course))].sort().map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div style={{maxHeight:'65vh',overflowY:'auto'}}>
              {loadingRounds ? (
                <div style={{textAlign:'center',padding:'32px 20px',color:'rgba(245,240,232,0.4)',fontSize:13,letterSpacing:2}}>Loading...</div>
              ) : rounds.length===0 ? (
                <div style={{textAlign:'center',padding:0,opacity:0.7,minHeight:168,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                  <svg width="90" height="82" viewBox="0 8 90 82" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display:'block',margin:'0 auto 10px'}}>
                    <defs>
                      <radialGradient id="ballGrad2" cx="36%" cy="30%" r="65%"><stop offset="0%" stopColor="rgba(255,255,255,0)"/><stop offset="100%" stopColor="rgba(0,0,0,0.18)"/></radialGradient>
                      <radialGradient id="grassGrad" cx="50%" cy="60%" r="55%"><stop offset="0%" stopColor="rgba(56,142,60,0.4)"/><stop offset="100%" stopColor="rgba(27,94,32,0.0)"/></radialGradient>
                      <clipPath id="ballClip2"><circle cx="45" cy="38" r="12"/></clipPath>
                    </defs>
                    <ellipse cx="45" cy="79" rx="52" ry="4" fill="#2e7d32" opacity="0.85"/>
                    <ellipse cx="45" cy="79" rx="52" ry="4" fill="url(#grassGrad)" opacity="0.4"/>
                    <ellipse cx="45" cy="52" rx="5.5" ry="2" fill="#c41e3a"/>
                    <path d="M39.5 52 Q45 56 50.5 52" fill="#a01828"/>
                    <path d="M43 52 L44.4 78 L45 79.5 L45.6 78 L47 52 Z" fill="#c41e3a"/>
                    <path d="M45 52 L45.6 78 L47 52 Z" fill="#9e1830" opacity="0.65"/>
                    <ellipse cx="45" cy="79" rx="0.8" ry="0.5" fill="#9e1830"/>
                    <circle cx="45" cy="38" r="12" fill="#f5f0e8"/>
                    <circle cx="45" cy="38" r="12" fill="url(#ballGrad2)"/>
                    <g clipPath="url(#ballClip2)" fill="rgba(148,143,136,0.52)">
                      <circle cx="45" cy="27.5" r="1.1"/>
                      <circle cx="40.5" cy="29" r="1.05"/><circle cx="45" cy="28.5" r="1.05"/><circle cx="49.5" cy="29" r="1.05"/>
                      <circle cx="36.5" cy="32" r="1.05"/><circle cx="40.5" cy="31" r="1.1"/><circle cx="45" cy="30.5" r="1.1"/><circle cx="49.5" cy="31" r="1.1"/><circle cx="53.5" cy="32" r="1.05"/>
                      <circle cx="34.5" cy="35.5" r="1.05"/><circle cx="38.5" cy="34" r="1.1"/><circle cx="42.5" cy="33.5" r="1.1"/><circle cx="47.5" cy="33.5" r="1.1"/><circle cx="51.5" cy="34" r="1.1"/><circle cx="55.5" cy="35.5" r="1.05"/>
                      <circle cx="33.5" cy="39" r="1.05"/><circle cx="37" cy="37.5" r="1.1"/><circle cx="41" cy="37" r="1.1"/><circle cx="45" cy="36.5" r="1.1"/><circle cx="49" cy="37" r="1.1"/><circle cx="53" cy="37.5" r="1.1"/><circle cx="56.5" cy="39" r="1.05"/>
                      <circle cx="34.5" cy="42.5" r="1.05"/><circle cx="38.5" cy="41.5" r="1.1"/><circle cx="42.5" cy="41" r="1.1"/><circle cx="47.5" cy="41" r="1.1"/><circle cx="51.5" cy="41.5" r="1.1"/><circle cx="55.5" cy="42.5" r="1.05"/>
                      <circle cx="37" cy="45.5" r="1.05"/><circle cx="41" cy="44.5" r="1.1"/><circle cx="45" cy="44" r="1.1"/><circle cx="49" cy="44.5" r="1.1"/><circle cx="53" cy="45.5" r="1.05"/>
                      <circle cx="40.5" cy="47.5" r="1.05"/><circle cx="45" cy="47.5" r="1.05"/><circle cx="49.5" cy="47.5" r="1.05"/>
                    </g>
                    <ellipse cx="39.5" cy="31.5" rx="4" ry="2.5" fill="rgba(255,255,255,0.3)" transform="rotate(-25 39.5 31.5)"/>

                  </svg>
                  <div style={{fontStyle:'italic',fontSize:15,color:'rgba(245,240,232,0.6)'}}>No rounds posted yet</div>
                </div>
              ) : (()=>{
                const filtered=courseFilter==='all'?rounds:rounds.filter(r=>r.course===courseFilter);
                if(filtered.length===0) return <div style={{textAlign:'center',padding:'32px 20px',color:'rgba(245,240,232,0.4)',fontSize:13}}>No rounds found for this course.</div>;
                return filtered.map((r,i)=>(
                  <div key={r.id} style={S.roundItem(courseFilter==='all'&&i>=12)}>
                    <div style={S.roundScore}>{r.score}</div>
                    <div style={S.roundDetails}>
                      <div style={S.roundCourse}>{r.course}</div>
                      <div style={S.roundMeta}>{new Date(r.date+'T00:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'2-digit'})} · Rating {r.rating}{r.slope?` · Slope ${r.slope}`:''}</div>
                      {courseFilter==='all'&&i<12&&r.id===lowestExcludedId&&<span style={{fontSize:7,letterSpacing:1,padding:'2px 5px',borderRadius:2,background:'rgba(132,224,64,0.12)',border:'1px solid rgba(132,224,64,0.45)',color:'#84e040',marginTop:4,display:'inline-block'}}>LOWEST · EXCLUDED</span>}
                      {courseFilter==='all'&&i<12&&r.id===highestExcludedId&&<span style={{fontSize:7,letterSpacing:1,padding:'2px 5px',borderRadius:2,background:'rgba(196,30,58,0.12)',border:'1px solid rgba(196,30,58,0.45)',color:'#e02247',marginTop:4,display:'inline-block'}}>HIGHEST · EXCLUDED</span>}
                    </div>
                    <div style={{display:'flex',alignItems:'center',width:64,flexShrink:0}}>
                      <div style={{...S.roundDiff,minWidth:40,flex:1}}>{r.differential.toFixed(1)}</div>
                      <div style={{width:20,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        {isDeletable(r)&&(
                          <button onClick={()=>setPendingDelete(r.id)} style={{background:'none',border:'none',color:'rgba(224,34,71,0.6)',fontSize:12,cursor:'pointer',padding:0,lineHeight:1}}>✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* Analytics */}
        {tab==="stats"&&(()=>{
          const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const todayD=new Date();
          const months=Array.from({length:12},(_,i)=>{const d=new Date(todayD.getFullYear(),todayD.getMonth()-11+i,1);return{label:MONTHS[d.getMonth()],year:d.getFullYear(),month:d.getMonth()};});
          const data=months.map(({label,year,month})=>{
            const cutoff=new Date(year,month+1,1);
            const r2=rounds.filter(r=>new Date(r.date+'T00:00:00')<cutoff).sort((a,b)=>new Date(b.date)-new Date(a.date));
            return{label,value:calcHandicapDecimal(r2)};
          });
          const withVal=data.filter(m=>m.value!==null);
          const maxH=withVal.length?Math.max(...withVal.map(m=>m.value)):0;
          const minH=withVal.length?Math.min(...withVal.map(m=>m.value)):0;
          const maxIdx=data.map((m,i)=>m.value===maxH?i:-1).filter(i=>i!==-1).pop();
          const minIdx=data.map((m,i)=>m.value===minH?i:-1).filter(i=>i!==-1).pop();
          return(
            <>
              <div style={S.statGrid}>
                <div style={S.statBox}><div style={S.statLabel}>All-Time<br/>Rounds Posted</div><div style={S.statVal}>{rounds.length.toLocaleString()}</div></div>
                <div style={S.statBox}><div style={{...S.statLabel,marginTop:5}}>Rounds Posted YTD</div><div style={S.statVal}>{ytdRounds}</div></div>
                <div style={S.statBox}><div style={S.statLabel}>Lowest Score</div><div style={S.statVal}>{minScore??'—'}</div></div>
                <div style={S.statBox}><div style={S.statLabel}>Lowest Handicap</div><div style={S.statVal}>{lowestHandicap!==null&&lowestHandicap!==undefined?(lowestHandicap<0?`+${Math.abs(lowestHandicap)}`:lowestHandicap):'—'}</div></div>
                <div style={{...S.statBox,gridColumn:'span 2'}}>
                  <div style={{...S.statLabel,marginBottom:16}}>All-Time Scoring Average</div>
                  <div style={S.statVal}>{rounds.length>0?(rounds.reduce((s,r)=>s+r.score,0)/rounds.length).toFixed(1):'—'}</div>
                </div>
                {(()=>{
                  let eligible=0,beaten=0;
                  for(let i=0;i<rounds.length;i++){const pr=rounds.slice(i+1);if(pr.length<12)continue;const hcp=calcHandicapDecimalAllTime(pr);if(hcp===null)continue;eligible++;if(rounds[i].differential<hcp)beaten++;}
                  if(eligible===0)return(
                    <div style={{...S.statBox,gridColumn:'span 2'}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,marginBottom:16}}>
                        <div style={{...S.statLabel,marginBottom:0}}>Handicap Beat Rate</div>
                        <span className="info-tooltip" onClick={e=>e.currentTarget.classList.toggle('active')}>i<span className="tooltip-text" style={{right:'auto',left:'50%',transform:'translateX(-50%)'}}>% OF ROUNDS YOU'VE OUTPLAYED YOUR HANDICAP</span></span>
                      </div>
                      <div style={S.statVal}>—</div>
                      <div style={{fontSize:8,letterSpacing:1,color:'rgba(245,240,232,0.4)',marginTop:6}}>will display after 13 rounds are posted</div>
                    </div>
                  );
                  const rawPct=(beaten/eligible)*100;
                  const pct=rawPct===50?50:rawPct>50?Math.max(51,Math.ceil(rawPct)):Math.min(49,Math.floor(rawPct));
                  return(
                    <div style={{...S.statBox,gridColumn:'span 2'}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,marginBottom:16}}>
                        <div style={{...S.statLabel,marginBottom:0}}>Handicap Beat Rate</div>
                        <span className="info-tooltip" onClick={e=>e.currentTarget.classList.toggle('active')}>i<span className="tooltip-text" style={{right:'auto',left:'50%',transform:'translateX(-50%)'}}>% OF ROUNDS YOU'VE OUTPLAYED YOUR HANDICAP</span></span>
                      </div>
                      <div style={{...S.statVal,color:pct<50?'#e02247':pct===50?'#e8b84b':'#84e040'}}>{pct}%</div>
                    </div>
                  );
                })()}
              </div>
              {withVal.length===0&&(
                <div style={{...S.card,background:'#0d1b2e',textAlign:'center'}}>
                  <div style={{...S.cardTitle,textAlign:'center',marginBottom:12}}>Handicap Trend (<span className="ttm-tooltip">TTM<span className="tooltip-text" style={{fontSize:9,letterSpacing:1}}>TRAILING TWELVE MONTHS</span></span>)</div>
                  <div style={{padding:'20px 0 12px',display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
                    <svg width="48" height="32" viewBox="0 0 48 32" fill="none">
                      <polyline points="2,28 10,20 18,22 26,12 34,16 46,4" stroke="rgba(232,184,75,0.2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      {[2,10,18,26,34,46].map((x,i)=><circle key={i} cx={x} cy={[28,20,22,12,16,4][i]} r="2.5" fill="rgba(232,184,75,0.2)"/>)}
                    </svg>
                    <div style={{fontSize:10,letterSpacing:1,color:'rgba(245,240,232,0.3)',lineHeight:1.8,textAlign:'center'}}>Chart will populate once<br/>a handicap is established</div>
                  </div>
                </div>
              )}
              {withVal.length>0&&(()=>{
                const PAD_L=28,PAD_R=8,PAD_T=24,PAD_B=28,W=340,H=180;
                const chartW=W-PAD_L-PAD_R,chartH=H-PAD_T-PAD_B;
                const chartMin=Math.min(minH,-0.5),chartMax=Math.max(maxH,0.5),chartRange=chartMax-chartMin||1;
                const toY=v=>PAD_T+((chartMax-v)/chartRange)*chartH;
                const zeroY=toY(0);
                const pts=data.map((m,i)=>m.value!==null?{x:PAD_L+(i/(data.length-1||1))*chartW,y:toY(m.value),v:m.value,i}:null);
                const valid=pts.filter(Boolean);
                const segments=[];
                for(let k=0;k<valid.length-1;k++){
                  const a=valid[k],b=valid[k+1];
                  const isSegMax=withVal.length>=3&&(a.i===maxIdx||b.i===maxIdx);
                  const isSegMin=withVal.length>=3&&(a.i===minIdx||b.i===minIdx);
                  segments.push({x1:a.x,y1:a.y,x2:b.x,y2:b.y,color:isSegMax?'#e02247':isSegMin?'#84e040':'#e8b84b'});
                }
                return(
                  <div style={{...S.card,background:'#0d1b2e'}}>
                    <div style={{...S.cardTitle,textAlign:'center'}}>Handicap Trend (<span className="ttm-tooltip">TTM<span className="tooltip-text" style={{fontSize:9,letterSpacing:1}}>TRAILING TWELVE MONTHS</span></span>)</div>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',display:'block'}}>
                      <line x1={PAD_L} y1={zeroY} x2={W-PAD_R} y2={zeroY} stroke="rgba(245,240,232,0.12)" strokeWidth="1" strokeDasharray="3,3"/>
                      <text x={PAD_L-14} y={zeroY+3.5} textAnchor="middle" fill="rgba(245,240,232,0.85)" fontSize="7">0</text>
                      {[chartMin,chartMax].map((v,i)=>(
                        <text key={i} x={PAD_L-14} y={toY(v)+(i===0?-3:4)} textAnchor="middle" fill="rgba(245,240,232,0.85)" fontSize="7">{v<0?`+${Math.abs(v).toFixed(0)}`:v.toFixed(0)}</text>
                      ))}
                      {segments.map((s,i)=><line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth="2" strokeLinecap="round"/>)}
                      {valid.map((p,i)=>{
                        const isMax=withVal.length>=3&&p.i===maxIdx,isMin=withVal.length>=3&&p.i===minIdx;
                        const color=isMax?'#e02247':isMin?'#84e040':'#e8b84b';
                        return(
                          <g key={i}>
                            <circle cx={p.x} cy={p.y} r={isMax||isMin?3.5:2.5} fill={color}/>
                            <text x={p.x} y={p.y-(isMax||isMin?8:6)} textAnchor="middle" fill={color} fontSize="7" fontWeight={isMax||isMin?"700":"400"} opacity={isMax||isMin?1:0.7}>{p.v<0?`+${Math.abs(p.v).toFixed(1)}`:p.v.toFixed(1)}</text>
                          </g>
                        );
                      })}
                      {data.map((m,i)=><text key={i} x={PAD_L+(i/(data.length-1||1))*chartW} y={H-6} textAnchor="middle" fill="rgba(245,240,232,0.85)" fontSize="7">{m.label}</text>)}
                    </svg>
                  </div>
                );
              })()}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────────
export default function GolfHandicapApp() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const restHeaders = () => {
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      const token = s?.access_token || SUPABASE_ANON_KEY;
      return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` };
    } catch { return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }; }
  };

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const raw = localStorage.getItem("sb-session");
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.access_token && s?.expires_at && Date.now() / 1000 < s.expires_at) {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${s.user.id}&select=*`, {
              headers: { ...restHeaders(), "Accept": "application/vnd.pgrst.object+json" }
            });
            const profile = await res.json();
            if (res.ok && profile?.name) {
              setAuthUser({ id: s.user.id, name: profile.name, email: s.user.email, memberNumber: profile.member_number, createdAt: profile.created_at });
            }
          }
        }
      } catch {}
      setAuthLoading(false);
    };
    restoreSession();
  }, []);

  const handleSignOut = async () => {
    try {
      const raw = localStorage.getItem("sb-session");
      if (raw) {
        const s = JSON.parse(raw);
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: restHeaders() });
      }
    } catch {}
    localStorage.removeItem("sb-session");
    setAuthUser(null);
  };

  if (authLoading) return (
    <div style={{maxWidth:430,margin:'0 auto',minHeight:'100vh',background:'#0d1b2e',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <style>{globalStyles}</style>
      <div style={{fontSize:9,letterSpacing:4,textTransform:'uppercase',color:'rgba(232,184,75,0.3)'}}>Loading...</div>
    </div>
  );

  if (!authUser) return <AuthScreen onAuth={setAuthUser} />;
  return <AppContent user={authUser} onSignOut={handleSignOut} />;
}
