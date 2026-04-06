import { useState, useMemo, useEffect } from "react";

const SUPABASE_URL = "https://euwqnyzzrxrmldmfspjr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1d3FueXp6cnhybWxkbWZzcGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MzAwODMsImV4cCI6MjA5MDEwNjA4M30.4PWVQFOIx3yX7oMWvpO06_dqdrGLk0PGE77DstmpJO0";



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
  cutoff.setMonth(cutoff.getMonth() - 18);
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
  cutoff.setMonth(cutoff.getMonth() - 18);
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
const COURSES = []; // courses now loaded from Supabase

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

// ─── Member Number Input ───────────────────────────────────────────────────────
function MemberNumberInput({ value, onChange, inputStyle }) {
  const handleChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 8);
    const formatted = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
    onChange(formatted);
  };

  return (
    <input
      style={{...inputStyle, letterSpacing:4, fontSize:15}}
      placeholder=""
      value={value}
      onChange={handleChange}
      maxLength={9}
      inputMode="numeric"
    />
  );
}

// ─── Auth Screen ───────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('landing');
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingUser, setPendingUser] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

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

  const anonHeaders = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY };

  const Header = () => (
    <div style={S.top}>
      <div style={S.title}>Down The Middle</div>
      <div style={S.sub}>A More Honest Golf Handicap</div>
      <div style={S.divider} />
    </div>
  );

  const handleSignUp = async () => {
    setError(''); setMessage('');
    if (!name.trim()) return setError('Please enter your first name');
    if (!lastName.trim()) return setError('Please enter your last name');
    if (!email.trim() || !email.includes('@')) return setError('Please enter a valid email');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirmPassword) return setError('Passwords do not match');
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST", headers: anonHeaders,
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.user) { setLoading(false); return setError(data.error_description || data.msg || "Sign up failed — please try again"); }
      const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, user: data.user };
      localStorage.setItem("sb-session", JSON.stringify(session));
      const newMemberNumber = generateMemberNumber();
      const authHeader = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${data.access_token}`, "Prefer": "return=representation" };
      const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST", headers: authHeader,
        body: JSON.stringify({ id: data.user.id, name: name.trim(), last_name: lastName.trim(), member_number: newMemberNumber, email: email.trim().toLowerCase() }),
      });
      if (!profRes.ok) { const e = await profRes.json(); setLoading(false); return setError(e.message || "Failed to create profile"); }
      const newUser = { id: data.user.id, name: name.trim(), lastName: lastName.trim(), email: data.user.email, memberNumber: newMemberNumber, createdAt: new Date().toISOString() };
      setPendingUser(newUser);
      setMode('onboarding');
    } catch (e) { setError("Network error — please try again"); }
    setLoading(false);
  };

  const handleLogin = async () => {
    setError(''); setMessage('');
    if (!memberNumber.trim() || !password) return setError('Please enter your member # and password');
    setLoading(true);
    try {
      // Look up email by member number
      const lookupRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?member_number=eq.${memberNumber.trim()}&select=id,name,member_number,created_at`, {
        headers: { ...anonHeaders, "Accept": "application/vnd.pgrst.object+json" }
      });
      if (!lookupRes.ok) { setLoading(false); return setError('Member # not found'); }
      const profile = await lookupRes.json();
      if (!profile?.id) { setLoading(false); return setError('Member # not found'); }
      // Get email from auth.users via a profile lookup — we need to sign in differently
      // Use member_number to find the user's email stored in profiles
      const emailLookupRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?member_number=eq.${memberNumber.trim()}&select=id`, {
        headers: anonHeaders
      });
      const emailData = await emailLookupRes.json();
      if (!emailData?.length) { setLoading(false); return setError('Member # not found'); }
      const userId = emailData[0].id;
      // We need the email — store it in profiles table
      // For now use the stored email in profiles
      const fullProfileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
        headers: { ...anonHeaders, "Accept": "application/vnd.pgrst.object+json" }
      });
      const fullProfile = await fullProfileRes.json();
      if (!fullProfile?.email) { setLoading(false); return setError('Could not find account — please try again'); }
      // Now authenticate with email
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: anonHeaders,
        body: JSON.stringify({ email: fullProfile.email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.access_token) { setLoading(false); return setError('Incorrect password'); }
      const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, user: data.user };
      localStorage.setItem("sb-session", JSON.stringify(session));
      onAuth({ id: data.user.id, name: fullProfile.name, lastName: fullProfile.last_name || '', email: fullProfile.email, memberNumber: fullProfile.member_number, createdAt: fullProfile.created_at });
    } catch (e) { setError("Network error — please try again"); }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setError(''); setMessage('');
    if (!resetEmail.trim() || !resetEmail.includes('@')) return setError('Please enter a valid email');
    setLoading(true);
    try {
      const resetRes = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST", headers: anonHeaders,
        body: JSON.stringify({ email: resetEmail.trim().toLowerCase() }),
      });
      if (!resetRes.ok) { const e = await resetRes.json(); setLoading(false); return setError(e.error_description || "Reset failed"); }
      setMessage('Password reset email sent');
    } catch (e) { setError("Network error — please try again"); }
    setLoading(false);
  };

  const handleForgotMemberNumber = async () => {
    setError(''); setMessage('');
    if (!email.trim() || !email.includes('@')) return setError('Please enter a valid email');
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${email.trim().toLowerCase()}&select=member_number,name`, {
        headers: { ...anonHeaders, "Accept": "application/vnd.pgrst.object+json" }
      });
      const profile = await res.json();
      if (!res.ok || !profile?.member_number) { setLoading(false); return setError('No account found with that email'); }
      // Send member number via Resend edge function
      const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-contact-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({
          name: profile.name,
          email: email.trim().toLowerCase(),
          message: `Your Down The Middle member number is: ${profile.member_number}`,
        }),
      });
      setMessage('Your member # has been sent to that email address');
    } catch (e) { setError("Network error — please try again"); }
    setLoading(false);
  };

  if (mode === 'landing') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <div style={S.body}>
        <div style={{textAlign:'center', marginBottom:40, marginTop:48}}>
          <div style={{fontSize:28, fontWeight:900, color:'#f5f0e8', letterSpacing:5, textTransform:'uppercase', lineHeight:1.1, marginBottom:14}}>Down The Middle</div>
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
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
          <div><label style={S.label}>First Name</label><input style={S.input} placeholder="" value={name} onChange={e=>setName(e.target.value)} /></div>
          <div><label style={S.label}>Last Name</label><input style={S.input} placeholder="" value={lastName} onChange={e=>setLastName(e.target.value)} /></div>
        </div>
        <div style={S.field}><label style={S.label}>Email</label><input style={S.input} placeholder="" type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
        <div style={S.field}><label style={S.label}>Create Password</label><input style={S.input} placeholder="Min. 6 characters" type="password" value={password} onChange={e=>setPassword(e.target.value)} /></div>
        <div style={S.field}><label style={S.label}>Confirm Password</label><input style={S.input} placeholder="Re-enter password" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} /></div>
        {error && <div style={S.error}>{error}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleSignUp} disabled={loading}>{loading?'Creating Account...':'Create Account'}</button>
        <div style={S.switchText}>Already have an account? <span className="auth-link" style={{color:'#e8b84b',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{setMode('login');setError('');}}>Log In</span></div>
      </div>
    </div>
  );

  if (mode === 'login') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:24}}>
        <button style={{...S.back, marginBottom:22}} onClick={()=>{setMode('landing');setError('');}}>← Back</button>
        <div style={S.field}>
          <label style={S.label}>Member #</label>
          <MemberNumberInput value={memberNumber} onChange={setMemberNumber} inputStyle={S.input} />
        </div>
        <div style={S.field}><label style={S.label}>Password</label><input style={S.input} placeholder="" type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleLogin()} /></div>
        {error && <div style={S.error}>{error}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleLogin} disabled={loading}>{loading?'Logging In...':'Log In'}</button>
        <div style={{textAlign:'center',marginTop:14,display:'flex',justifyContent:'center',gap:16}}>
          <span className="auth-link" style={{fontSize:11,color:'#e8b84b',cursor:'pointer',letterSpacing:1,textDecoration:'underline'}} onClick={()=>{setMode('forgotMember');setError('');setMessage('');}}>Forgot Member #</span>
          <span style={{fontSize:11,color:'rgba(245,240,232,0.2)'}}>|</span>
          <span className="auth-link" style={{fontSize:11,color:'#e8b84b',cursor:'pointer',letterSpacing:1,textDecoration:'underline'}} onClick={()=>{setMode('forgot');setError('');setMessage('');}}>Forgot Password</span>
        </div>
        <div style={{...S.switchText,marginTop:8}}>Don't have an account? <span className="auth-link" style={{color:'#e8b84b',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{setMode('signup');setError('');}}>Create one</span></div>
      </div>
    </div>
  );

  if (mode === 'onboarding') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <div style={{flex:1, display:'flex', flexDirection:'column', justifyContent:'center', padding:'40px 28px'}}>
        <div style={{marginBottom:36, textAlign:'center'}}>
          <div style={{fontSize:24, fontWeight:800, color:'#fff', textTransform:'uppercase', letterSpacing:3, marginBottom:4}}>Down The Middle</div>
          <div style={{fontSize:9, fontWeight:500, letterSpacing:3, textTransform:'uppercase', color:'#e02247'}}>A More Honest Golf Handicap</div>
        </div>
        <div style={{height:1, background:'rgba(201,168,76,0.25)', marginBottom:36}}/>
        <div style={{display:'flex', flexDirection:'column', gap:22}}>
          <p style={{margin:0, fontSize:18, color:'#e8b84b', lineHeight:1.75, fontWeight:700, textAlign:'center'}}>WELCOME!</p>
          <p style={{margin:0, fontSize:15, color:'rgba(245,240,232,0.75)', lineHeight:1.75, fontWeight:400}}>
            Thank you for becoming a member. Below you will find your member # — please save it, as it will be used to log in to your account
          </p>
          <div style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:4,padding:'18px 16px',textAlign:'center'}}>
            <div style={{fontSize:28,fontWeight:900,color:'#e8b84b',letterSpacing:2}}>{pendingUser?.memberNumber}</div>
          </div>
          <p style={{margin:0, fontSize:15, color:'rgba(245,240,232,0.75)', lineHeight:1.75, fontWeight:400}}>
            <span style={{color:'#e8b84b', fontWeight:700}}>Note:</span> As a first time user, please feel free to input as many of your prior rounds as you'd like — up to 18 months back — in order to generate your new handicap as soon as possible
          </p>

        </div>
        <div style={{height:1, background:'rgba(201,168,76,0.25)', margin:'36px 0 28px'}}/>
        <button className="auth-btn-primary" style={{width:'100%', padding:16, background:'linear-gradient(135deg,#e8b84b,#c49a30)', border:'none', borderRadius:3, color:'#0d1b2e', fontSize:13, fontWeight:900, letterSpacing:4, textTransform:'uppercase', cursor:'pointer'}} onClick={()=>onAuth(pendingUser)}>
          Get Started
        </button>
      </div>
    </div>
  );

  if (mode === 'forgot') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:24}}>
        <button style={{...S.back, marginBottom:28}} onClick={()=>{setMode('login');setError('');setMessage('');}}>← Back</button>
        <div style={{fontSize:14,color:'rgba(245,240,232,0.5)',marginBottom:20,lineHeight:1.6}}>An email with a password reset link will be sent to the address submitted below:</div>
        <div style={S.field}><label style={S.label}>Email</label><input style={S.input} placeholder="" type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} /></div>
        {error && <div style={S.error}>{error}</div>}
        {message && <div style={S.success}>{message}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleForgotPassword} disabled={loading}>{loading?'Sending...':'Send Reset Link'}</button>
      </div>
    </div>
  );

  if (mode === 'forgotMember') return (
    <div style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:24}}>
        <button style={{...S.back, marginBottom:28}} onClick={()=>{setMode('login');setError('');setMessage('');}}>← Back</button>
        <div style={{fontSize:14,color:'rgba(245,240,232,0.5)',marginBottom:20,lineHeight:1.6}}>An email with your Member # will be sent to the address submitted below:</div>
        <div style={S.field}><label style={S.label}>Email</label><input style={S.input} placeholder="" type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
        {error && <div style={S.error}>{error}</div>}
        {message && <div style={S.success}>{message}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleForgotMemberNumber} disabled={loading}>{loading?'Sending...':'Send Member #'}</button>
      </div>
    </div>
  );
}

function displayName(name, lastN) {
  if (!lastN) return name;
  return `${name} ${lastN.trim()[0].toUpperCase()}`;
}

function PartnerRow({ p, prof, otherId, handicaps, onRemove, rowStyle }) {
  const [hovered, setHovered] = useState(false);
  const hcp = handicaps[otherId];
  const hcpDisplay = hcp===undefined||hcp===null ? '—' : hcp<0 ? `+${Math.abs(hcp)}` : String(hcp);

  return (
    <div
      style={{...rowStyle, position:'relative', alignItems:'center', padding:'14px'}}
      onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}>
      {hovered&&(
        <button onClick={e=>{e.stopPropagation();onRemove();}} style={{position:'absolute',top:-7,right:-7,width:16,height:16,borderRadius:'50%',background:'#e02247',border:'2px solid #0d1b2e',color:'#fff',fontSize:10,cursor:'pointer',lineHeight:1,padding:0,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',zIndex:10}}>✕</button>
      )}
      <div style={{flex:1}}>
        <div style={{fontSize:13,color:'#f5f0e8',fontWeight:600}}>{prof ? displayName(prof.name, prof.last_name) : '...'}</div>
        <div style={{fontSize:9,color:'rgba(201,168,76,0.6)',letterSpacing:1,marginTop:2}}>{prof?.member_number||''}</div>
      </div>
      <div style={{textAlign:'center',minWidth:56}}>
        <div style={{fontSize:7,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.5)',marginBottom:3}}>Current Handicap</div>
        <div style={{fontSize:28,fontWeight:800,color:'#e8b84b',lineHeight:1,letterSpacing:-1}}>{hcpDisplay}</div>
      </div>
    </div>
  );
}

function EntryRow({ entry }) {
  const color = entry.trend === 'hot' ? '#84e040' : '#e02247';
  const streak = entry.streak || 3;
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,marginBottom:6}}>
      <div style={{fontSize:13,color:'#f5f0e8',fontWeight:500}}>
        {displayName(entry.name, entry.lastName)}
        {entry.isUser && <span style={{fontSize:9,color:'rgba(201,168,76,0.5)',letterSpacing:1,marginLeft:6}}>YOU</span>}
      </div>
      <div style={{fontSize:22,fontWeight:800,color,lineHeight:1}}>{streak}</div>
    </div>
  );
}

// ─── Hot / Not Section ────────────────────────────────────────────────────────
function calcStreak(rounds) {
  // Returns { trend: 'hot'|'not'|'neutral', streak: number }
  if (!rounds || rounds.length < 13) return { trend: 'neutral', streak: 0 };
  const getHcp = (subset) => {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 18);
    const eligible = subset.filter(r => new Date(r.date + 'T00:00:00') >= cutoff);
    if (eligible.length < 10) return null;
    const r12 = eligible.slice(0, 12);
    const sorted = [...r12].sort((a,b) => a.differential - b.differential);
    const middle = r12.length >= 12 ? sorted.slice(1,11) : sorted;
    return Math.round((middle.reduce((s,r) => s + r.differential, 0) / middle.length) * 10) / 10;
  };
  // Build snapshots going back as far as possible
  const snapshots = [];
  for (let i = 0; i < rounds.length; i++) {
    const h = getHcp(rounds.slice(i));
    if (h !== null) snapshots.push(h); else break;
  }
  if (snapshots.length < 3) return { trend: 'neutral', streak: 0 };
  // Count consecutive improvements from most recent
  let hotStreak = 0, notStreak = 0;
  for (let i = 0; i < snapshots.length - 1; i++) {
    if (snapshots[i] < snapshots[i+1] - 0.09) hotStreak++;
    else break;
  }
  for (let i = 0; i < snapshots.length - 1; i++) {
    if (snapshots[i] > snapshots[i+1] + 0.09) notStreak++;
    else break;
  }
  if (hotStreak >= 3) return { trend: 'hot', streak: hotStreak };
  if (notStreak >= 3) return { trend: 'not', streak: notStreak };
  return { trend: 'neutral', streak: 0 };
}

function HotNotSection({ user, partners, profiles, trends, handicaps, userRounds, streaks }) {
  const userResult = calcStreak(userRounds || []);

  const allEntries = [
    { id: user.id, name: user.name, lastName: user.lastName, trend: userResult.trend, streak: userResult.streak, isUser: true },
    ...partners.map(p => {
      const otherId = p.requester_id === user.id ? p.recipient_id : p.requester_id;
      const prof = profiles[otherId];
      const s = streaks?.[otherId] || { trend: trends[otherId] || 'neutral', streak: 3 };
      return { id: otherId, name: prof?.name || '...', lastName: prof?.last_name || '', trend: s.trend, streak: s.streak, isUser: false };
    })
  ];

  const hot = allEntries.filter(e => e.trend === 'hot');
  const not = allEntries.filter(e => e.trend === 'not');

  const InfoIcon = ({ text }) => (
    <span className="info-tooltip" onClick={e=>e.currentTarget.classList.toggle('active')} style={{marginLeft:4}}>
      i<span className="tooltip-text" style={{right:'auto',left:'50%',transform:'translateX(-50%)',fontSize:9,letterSpacing:1,whiteSpace:'normal',width:160,textAlign:'center'}}>{text}</span>
    </span>
  );

  return (
    <div style={{marginTop:20}}>
      <div style={{height:1,background:'rgba(201,168,76,0.12)',marginBottom:16}}/>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10,paddingLeft:4}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#84e040'}}>Who's Hot</div>
          <span style={{fontSize:14,lineHeight:1}}>🔥</span>
          <InfoIcon text="Consecutive rounds of handicap improvement (min. 3)" />
        </div>
        {hot.length === 0
          ? <div style={{fontSize:11,color:'rgba(245,240,232,0.2)',fontStyle:'italic',paddingLeft:4}}>Where is everybody?</div>
          : hot.map(e => <EntryRow key={e.id} entry={e} />)
        }
      </div>
      <div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10,paddingLeft:4}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#e02247'}}>Who's Not</div>
          <span style={{fontSize:14,lineHeight:1}}>❄️</span>
          <InfoIcon text="Consecutive rounds handicap has increased (min. 3)" />
        </div>
        {not.length === 0
          ? <div style={{fontSize:11,color:'rgba(245,240,232,0.2)',fontStyle:'italic',paddingLeft:4}}>Nothing to see here...</div>
          : not.map(e => <EntryRow key={e.id} entry={e} />)
        }
      </div>
    </div>
  );
}

// ─── Partners Panel ────────────────────────────────────────────────────────────
function PartnersPanel({ user, partners, partnerRequests, sentRequests, trends, streaks, userRounds, partnerSearch, setPartnerSearch, searchResults, searchUsers, searchLoading, partnerLoading, sendRequest, respondToRequest, removePartner, fetchPartners, onBack, drawerAuthHeaders, SUPABASE_URL }) {
  const [profiles, setProfiles] = useState({});
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [handicaps, setHandicaps] = useState({});

  useEffect(() => {
    const loadProfiles = async () => {
      const ids = [
        ...partners.map(p => p.requester_id === user.id ? p.recipient_id : p.requester_id),
        ...partnerRequests.map(p => p.requester_id),
        ...(sentRequests||[]).map(p => p.recipient_id),
      ].filter((id, i, a) => a.indexOf(id) === i && !profiles[id]);
      for (const id of ids) {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}&select=id,name,last_name,member_number`, { headers: { ...drawerAuthHeaders(), "Accept": "application/vnd.pgrst.object+json" } });
          if (res.ok) { const p = await res.json(); setProfiles(prev => ({ ...prev, [id]: p })); }
        } catch {}
      }
      // Load handicaps and trends for accepted partners
      const partnerIds = partners.map(p => p.requester_id === user.id ? p.recipient_id : p.requester_id);
      for (const id of partnerIds) {
        try {
          const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 18);
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rounds?user_id=eq.${id}&date=gte.${cutoff.toISOString().split('T')[0]}&select=differential,date&order=date.desc`, { headers: drawerAuthHeaders() });
          if (res.ok) {
            const rounds = await res.json();
            if (Array.isArray(rounds) && rounds.length >= 10) {
              const recent = rounds.slice(0, 12);
              const sorted = [...recent].sort((a,b) => a.differential - b.differential);
              const middle = recent.length >= 12 ? sorted.slice(1,11) : sorted;
              const avg = middle.reduce((s,r) => s + r.differential, 0) / middle.length;
              setHandicaps(prev => ({ ...prev, [id]: Math.trunc(avg) }));
              // Calculate trend using calcStreak
              const result = calcStreak(rounds);
              setTrends(prev => ({ ...prev, [id]: result.trend }));
              setStreaks(prev => ({ ...prev, [id]: result }));
            } else {
              setHandicaps(prev => ({ ...prev, [id]: null }));
            }
          }
        } catch {}
      }
    };
    loadProfiles();
  }, [partners, partnerRequests]);

  const rowStyle = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 14px', background:'rgba(8,18,36,0.6)', border:'1px solid rgba(201,168,76,0.13)', borderRadius:4, marginBottom:8 };
  const labelStyle = { fontSize:7, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.6)', marginBottom:3, display:'block', paddingLeft:4 };
  const inputStyle = { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'9px 10px 9px 10px', color:'#f5f0e8', fontSize:13, outline:'none', width:'100%' };
  const btnSm = (color) => ({ padding:'5px 10px', background:color==='red'?'linear-gradient(135deg,#c41e3a,#9e1830)':color==='green'?'linear-gradient(135deg,#4caa18,#2d7a0e)':'transparent', border:color==='ghost'?'1px solid rgba(201,168,76,0.3)':'none', borderRadius:3, color:'#f5f0e8', fontSize:9, fontWeight:700, letterSpacing:2, textTransform:'uppercase', cursor:'pointer' });

  const alreadyPartner = (id) => partners.some(p => p.requester_id === id || p.recipient_id === id) || (sentRequests||[]).some(p => p.recipient_id === id);
  const alreadyRequested = (id) => searchResults.some(() => false); // checked server side

  return (
    <>
      <div onClick={onBack} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:200}} />
      <div style={{position:'fixed',top:0,right:0,bottom:0,width:272,background:'#0d1b2e',borderLeft:'1px solid rgba(201,168,76,0.18)',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#112240 0%,#0d1b2e 100%)',padding:'16px 20px 14px',flexShrink:0}}>
          <div style={{marginBottom:4}}>
            <button onClick={onBack} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0}}>← Back</button>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:8,paddingLeft:4}}>My Playing Partners</div>
        </div>
        <div style={{height:1,background:'rgba(201,168,76,0.12)',flexShrink:0}} />
        <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>

          {/* Search by member number */}
          <div style={{marginBottom:20}}>
            <label style={labelStyle}>Add a Partner</label>
            <input style={inputStyle} placeholder="Enter Member #" value={partnerSearch}
              onChange={e=>{
                const raw = e.target.value.replace(/[^0-9]/g,'').slice(0,8);
                const formatted = raw.length > 4 ? raw.slice(0,4) + '-' + raw.slice(4) : raw;
                setPartnerSearch(formatted);
                searchUsers(formatted);
              }} autoComplete="off" inputMode="numeric" maxLength={9}/>
            {searchLoading&&<div style={{fontSize:10,color:'rgba(245,240,232,0.3)',letterSpacing:1,marginTop:6}}>Looking up member...</div>}
            {!searchLoading&&partnerSearch.length>=4&&searchResults.length===0&&<div style={{fontSize:10,color:'rgba(245,240,232,0.3)',letterSpacing:1,marginTop:6}}>No member found with that number</div>}
            {searchResults.length>0&&(
              <div style={{marginTop:8,border:'1px solid rgba(201,168,76,0.25)',borderRadius:4,overflow:'hidden'}}>
                {searchResults.map(r=>{
                  const isPartner=alreadyPartner(r.id);
                  return(
                    <div key={r.id} onClick={()=>!isPartner&&!partnerLoading&&sendRequest(r.id)}
                      style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',background:'rgba(8,18,36,0.6)',cursor:isPartner?'default':'pointer'}}
                      onMouseEnter={e=>{if(!isPartner)e.currentTarget.style.background='rgba(232,184,75,0.08)'}}
                      onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
                      <div>
                        <div style={{fontSize:14,color:'#f5f0e8',fontWeight:600}}>{r.last_name ? `${r.name} ${r.last_name.trim()[0].toUpperCase()}` : r.name}</div>
                        <div style={{fontSize:9,color:'rgba(201,168,76,0.6)',letterSpacing:1,marginTop:2}}>{r.member_number}</div>
                      </div>
                      {isPartner
                        ? <span style={{fontSize:9,color:'rgba(245,240,232,0.3)',letterSpacing:1,textTransform:'uppercase'}}>Already Added</span>
                        : <span style={{fontSize:9,color:'#84e040',letterSpacing:1,textTransform:'uppercase',fontWeight:700}}>{partnerLoading?'Sending...':'+ Send Request'}</span>
                      }
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pending requests */}
          {partnerRequests.length>0&&(
            <div style={{marginBottom:20}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#e02247',marginBottom:10,display:'flex',alignItems:'center',gap:6,paddingLeft:4}}>
                Pending Requests
                <span style={{width:16,height:16,borderRadius:'50%',background:'#e02247',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:400,color:'#fff',lineHeight:1,fontFamily:'Georgia,serif',fontStyle:'normal'}}>!</span>
              </div>
              {partnerRequests.map(req=>{
                const p=profiles[req.requester_id];
                return(
                  <div key={req.id} style={{...rowStyle,flexDirection:'column',alignItems:'flex-start',gap:10}}>
                    <div>
                      <div style={{fontSize:13,color:'#f5f0e8',fontWeight:500}}>{p ? displayName(p.name, p.last_name) : '...'}</div>
                      <div style={{fontSize:9,color:'rgba(201,168,76,0.6)',letterSpacing:1}}>{p?.member_number||''}</div>
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <button onClick={()=>respondToRequest(req.id,true)} style={btnSm('green')}>Accept</button>
                      <button onClick={()=>respondToRequest(req.id,false)} style={btnSm('red')}>Decline</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sent requests */}
          {(sentRequests||[]).length>0&&(
            <div style={{marginBottom:20}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',marginBottom:10,paddingLeft:4}}>Awaiting Response</div>
              {sentRequests.map(req=>{
                const p=profiles[req.recipient_id];
                return(
                  <div key={req.id} style={{...rowStyle,alignItems:'center'}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:'rgba(245,240,232,0.6)',fontWeight:500}}>{p ? displayName(p.name, p.last_name) : '...'}</div>
                      <div style={{fontSize:9,color:'rgba(201,168,76,0.4)',letterSpacing:1}}>{p?.member_number||''}</div>
                    </div>
                    <span style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'rgba(196,30,58,0.5)'}}>Pending</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Partners list */}
          <div>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:10,paddingLeft:4}}>Partners ({partners.length})</div>
            {partners.length===0
              ? <div style={{fontSize:12,color:'rgba(245,240,232,0.3)',fontStyle:'italic',textAlign:'left',padding:'8px 0',paddingLeft:4}}>No partners yet</div>
              : partners.map(p=>{
                  const otherId=p.requester_id===user.id?p.recipient_id:p.requester_id;
                  const prof=profiles[otherId];
                  return(
                    <PartnerRow key={p.id} p={p} prof={prof} otherId={otherId} handicaps={handicaps} onRemove={()=>setConfirmRemove(p.id)} rowStyle={rowStyle} />
                  );
                })
            }
          </div>

          {/* Who's Hot / Who's Not */}
          <HotNotSection user={user} partners={partners} profiles={profiles} trends={trends} streaks={streaks} handicaps={handicaps} userRounds={userRounds} />
        </div>

        {/* Confirm remove modal */}
        {confirmRemove&&(
          <div onClick={()=>setConfirmRemove(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#112240',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'24px 20px',maxWidth:260,width:'90%',textAlign:'center'}}>
              <div style={{fontSize:11,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:12}}>Remove Partner</div>
              <div style={{fontSize:13,color:'rgba(245,240,232,0.7)',marginBottom:20,lineHeight:1.6}}>Are you sure you want to remove this partner?</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <button onClick={()=>{removePartner(confirmRemove);setConfirmRemove(null);}} style={{...btnSm('red'),width:'100%',padding:10,fontSize:11,transition:'filter 0.15s ease'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.2)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>Yes, Remove</button>
                <button onClick={()=>setConfirmRemove(null)} style={{...btnSm('ghost'),width:'100%',padding:10,fontSize:11,transition:'all 0.15s ease'}} onMouseEnter={e=>{e.currentTarget.style.background='rgba(201,168,76,0.1)';e.currentTarget.style.borderColor='rgba(201,168,76,0.6)';e.currentTarget.style.color='rgba(201,168,76,0.9)';}} onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.borderColor='rgba(201,168,76,0.3)';e.currentTarget.style.color='rgba(201,168,76,0.6)';}}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Support Panel ─────────────────────────────────────────────────────────────
function SupportPanel({ user, onBack }) {
  const [form, setForm] = useState({ name: user.name + (user.lastName ? ' ' + user.lastName : ''), email: user.email, message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!form.message.trim()) return setError('Please enter a message');
    setSending(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-contact-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ name: form.name, email: form.email, message: `Member #: ${user.memberNumber}\n\n${form.message}` }),
      });
      if (res.ok) {
        setSent(true);
        setForm(p => ({ ...p, message: '' }));
      } else {
        setError('Something went wrong — please try again');
      }
    } catch {
      setError('Network error — please try again');
    }
    setSending(false);
  };

  const labelStyle = { fontSize:7, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.6)', marginBottom:4, display:'block' };
  const inputStyle = { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'9px 10px', color:'#f5f0e8', fontSize:13, outline:'none', width:'100%' };

  return (
    <>
      <div onClick={onBack} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:200}} />
      <div style={{position:'fixed',top:0,right:0,bottom:0,width:272,background:'#0d1b2e',borderLeft:'1px solid rgba(201,168,76,0.18)',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#112240 0%,#0d1b2e 100%)',padding:'16px 20px 14px',flexShrink:0}}>
          <div style={{marginBottom:4}}>
            <button onClick={onBack} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0}}>← Back</button>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:8}}>Support</div>
        </div>
        <div style={{height:1,background:'rgba(201,168,76,0.12)',flexShrink:0}} />
        <div style={{flex:1,overflowY:'auto',padding:'20px'}}>
          {sent ? (
            <div style={{textAlign:'center',padding:'32px 0',display:'flex',flexDirection:'column',alignItems:'center',gap:16}}>
              <div style={{fontSize:28,color:'#84e040'}}>✓</div>
              <div style={{fontSize:13,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#84e040'}}>Message Sent</div>
              <div style={{fontSize:12,color:'rgba(245,240,232,0.5)',lineHeight:1.7,textAlign:'center'}}>We'll get back to you at {form.email} as soon as possible</div>
              <button onClick={()=>setSent(false)} style={{marginTop:8,background:'none',border:'1px solid rgba(201,168,76,0.3)',borderRadius:3,padding:'8px 16px',color:'rgba(201,168,76,0.6)',fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>Send Another</button>
            </div>
          ) : (
            <>
              <div style={{fontSize:11,color:'rgba(245,240,232,0.5)',lineHeight:1.7,marginBottom:20,whiteSpace:'nowrap'}}>
                <div>Have an issue or a question?</div>
                <div>Send a message in the box provided below</div>
                <div>and you will receive a reply as soon as possible</div>
              </div>
              <div style={{marginBottom:12}}>
                <label style={labelStyle}>Name</label>
                <input style={{...inputStyle,opacity:0.6}} value={form.name} readOnly />
              </div>
              <div style={{marginBottom:12}}>
                <label style={labelStyle}>Member #</label>
                <input style={{...inputStyle,opacity:0.6}} value={user.memberNumber} readOnly />
              </div>
              <div style={{marginBottom:12}}>
                <label style={labelStyle}>Email</label>
                <input style={inputStyle} value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} type="email" />
              </div>
              <div style={{marginBottom:14}}>
                <label style={labelStyle}>Message</label>
                <textarea style={{...inputStyle,minHeight:120,resize:'vertical',lineHeight:1.6}} placeholder="" value={form.message} onChange={e=>setForm(p=>({...p,message:e.target.value}))} />
              </div>
              {error && <div style={{fontSize:11,color:'#e02247',letterSpacing:1,marginBottom:10}}>{error}</div>}
              <button onClick={handleSubmit} disabled={sending} style={{width:'100%',padding:12,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',opacity:sending?0.5:1}}>
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Profile Drawer ────────────────────────────────────────────────────────────
function ProfileDrawer({ user, roundCount, handicap, userRounds, onClose, onSignOut, onPartnerUpdate }) {
  const [subPanel, setSubPanel] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [partners, setPartners] = useState([]);
  const [partnerRequests, setPartnerRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [trends, setTrends] = useState({});
  const [streaks, setStreaks] = useState({});
  const [partnerSearch, setPartnerSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [partnerLoading, setPartnerLoading] = useState(false);
  const [partnerProfiles, setPartnerProfiles] = useState({});

  useEffect(() => {
    if (subPanel === 'partners') fetchPartners();
  }, [subPanel]);

  // Fetch pending count on drawer open
  useEffect(() => {
    fetchPartners();
  }, []);
  const [pwForm, setPwForm] = useState({ current:'', next:'', confirm:'' });
  const [showPwForm, setShowPwForm] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const anonHeaders = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY };
  const authHeaders = () => {
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${s?.access_token || SUPABASE_ANON_KEY}` };
    } catch { return anonHeaders; }
  };

  const handlePasswordChange = async () => {
    setPwError(''); setPwSuccess('');
    if (!pwForm.current) return setPwError('Please enter your current password.');
    if (pwForm.next.length < 6) return setPwError('New password must be at least 6 characters.');
    if (pwForm.next !== pwForm.confirm) return setPwError('New passwords do not match.');
    setPwLoading(true);
    // Re-authenticate to verify current password
    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: anonHeaders,
      body: JSON.stringify({ email: user.email, password: pwForm.current }),
    });
    if (!verifyRes.ok) { setPwLoading(false); return setPwError('Current password is incorrect.'); }
    const { access_token } = await verifyRes.json();
    // Update password
    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${access_token}` },
      body: JSON.stringify({ password: pwForm.next }),
    });
    if (!updateRes.ok) { setPwLoading(false); return setPwError('Failed to update password. Please try again.'); }
    setPwSuccess('Password updated successfully')
    setPwForm({ current:'', next:'', confirm:'' });
    setPwLoading(false);
  };

  const rowStyle = { background:'rgba(8,18,36,0.6)', border:'1px solid rgba(201,168,76,0.13)', borderRadius:4, padding:'12px 14px', marginBottom:8 };
  const labelStyle = { fontSize:7, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.6)', marginBottom:4, display:'block' };
  const valueStyle = { fontSize:13, fontWeight:600, color:'rgba(245,240,232,0.65)', letterSpacing:0.5 };
  const inputStyle = { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'9px 10px', color:'#f5f0e8', fontSize:13, outline:'none', width:'100%' };

  const drawerAuthHeaders = () => {
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${s?.access_token || SUPABASE_ANON_KEY}` };
    } catch { return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }; }
  };

  // Fetch partners and pending requests
  const fetchPartners = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/partners?or=(requester_id.eq.${user.id},recipient_id.eq.${user.id})&select=*`, { headers: drawerAuthHeaders() });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        const accepted = data.filter(p => p.status === 'accepted');
        const pendingReceived = data.filter(p => p.status === 'pending' && p.recipient_id === user.id);
        const pendingSent = data.filter(p => p.status === 'pending' && p.requester_id === user.id);
        setPartners(accepted);
        setPartnerRequests(pendingReceived);
        setSentRequests(pendingSent);
        setPendingCount(pendingReceived.length);
        if (onPartnerUpdate) onPartnerUpdate();
      }
    } catch {}
  };

  // Fetch partner profile details
  const getProfile = async (id) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}&select=id,name,last_name,member_number`, { headers: { ...drawerAuthHeaders(), "Accept": "application/vnd.pgrst.object+json" } });
      if (res.ok) return await res.json();
    } catch {}
    return null;
  };

  const searchUsers = async (query) => {
    if (query.length < 4) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?member_number=ilike.${encodeURIComponent(query)}*&select=id,name,last_name,member_number&limit=5`, { headers: drawerAuthHeaders() });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setSearchResults(data.filter(p => p.id !== user.id));
      }
    } catch {}
    setSearchLoading(false);
  };

  const sendRequest = async (recipientId) => {
    setPartnerLoading(true);
    await fetch(`${SUPABASE_URL}/rest/v1/partners`, {
      method: 'POST',
      headers: { ...drawerAuthHeaders(), "Prefer": "return=representation" },
      body: JSON.stringify({ requester_id: user.id, recipient_id: recipientId, status: 'pending' }),
    });
    setPartnerSearch(''); setSearchResults([]);
    await fetchPartners();
    setPartnerLoading(false);
  };

  const respondToRequest = async (partnerId, accept) => {
    if (accept) {
      await fetch(`${SUPABASE_URL}/rest/v1/partners?id=eq.${partnerId}`, {
        method: 'PATCH',
        headers: { ...drawerAuthHeaders(), "Prefer": "return=representation" },
        body: JSON.stringify({ status: 'accepted' }),
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/partners?id=eq.${partnerId}`, { method: 'DELETE', headers: drawerAuthHeaders() });
    }
    await fetchPartners();
  };

  const removePartner = async (partnerId) => {
    await fetch(`${SUPABASE_URL}/rest/v1/partners?id=eq.${partnerId}`, { method: 'DELETE', headers: drawerAuthHeaders() });
    await fetchPartners();
  };

  if (subPanel === 'partners') return (
    <PartnersPanel
      user={user}
      partners={partners}
      partnerRequests={partnerRequests}
      sentRequests={sentRequests}
      trends={trends}
      streaks={streaks}
      userRounds={userRounds}
      partnerSearch={partnerSearch}
      setPartnerSearch={setPartnerSearch}
      searchResults={searchResults}
      searchUsers={searchUsers}
      searchLoading={searchLoading}
      partnerLoading={partnerLoading}
      sendRequest={sendRequest}
      respondToRequest={respondToRequest}
      removePartner={removePartner}
      fetchPartners={fetchPartners}
      onBack={()=>setSubPanel(null)}
      drawerAuthHeaders={drawerAuthHeaders}
      SUPABASE_URL={SUPABASE_URL}
    />
  );

  if (subPanel === 'support') return (
    <SupportPanel user={user} onBack={()=>setSubPanel(null)} />
  );

  if (subPanel === 'account') return (
    <>
      <div onClick={()=>setSubPanel(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:200}} />
      <div style={{position:'fixed',top:0,right:0,bottom:0,width:272,background:'#0d1b2e',borderLeft:'1px solid rgba(201,168,76,0.18)',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#112240 0%,#0d1b2e 100%)',padding:'16px 20px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
            <button onClick={()=>setSubPanel(null)} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0}}>← Back</button>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:18}}>Account Information</div>
        </div>
        <div style={{height:1,background:'rgba(201,168,76,0.12)'}} />
        <div style={{padding:'16px 20px',flex:1,overflowY:'auto'}}>
          <div style={rowStyle}><span style={labelStyle}>Full Name</span><span style={valueStyle}>{user.name}{user.lastName ? ' ' + user.lastName : ''}</span></div>
          <div style={rowStyle}><span style={labelStyle}>Email</span><span style={valueStyle}>{user.email}</span></div>
          <div style={rowStyle}><span style={labelStyle}>Member #</span><span style={valueStyle}>{user.memberNumber}</span></div>
          <div style={rowStyle}><span style={labelStyle}>Member Since</span><span style={valueStyle}>{new Date(user.createdAt).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span></div>

          <div style={{height:1,background:'rgba(201,168,76,0.12)',margin:'16px 0'}} />
          <div onClick={()=>{setShowPwForm(p=>!p);setPwError('');setPwSuccess('');setPwForm({current:'',next:'',confirm:''}); }} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Change Password</span>
            <span style={{fontSize:14,color:'rgba(245,240,232,0.3)',transform:showPwForm?'rotate(90deg)':'none',transition:'transform 0.2s ease'}}>›</span>
          </div>
          {showPwForm&&(
            <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:10}}>
              <div><label style={labelStyle}>Current Password</label><input style={inputStyle} type="password" placeholder="Current password" value={pwForm.current} onChange={e=>setPwForm(p=>({...p,current:e.target.value}))}/></div>
              <div><label style={labelStyle}>New Password</label><input style={inputStyle} type="password" placeholder="Min. 6 characters" value={pwForm.next} onChange={e=>setPwForm(p=>({...p,next:e.target.value}))}/></div>
              <div><label style={labelStyle}>Confirm New Password</label><input style={inputStyle} type="password" placeholder="Re-enter new password" value={pwForm.confirm} onChange={e=>setPwForm(p=>({...p,confirm:e.target.value}))}/></div>
              {pwError && <div style={{fontSize:11,color:'#e02247',letterSpacing:1}}>{pwError}</div>}
              {pwSuccess && <div style={{fontSize:11,color:'#84e040',letterSpacing:1}}>{pwSuccess}</div>}
              <button onClick={handlePasswordChange} disabled={pwLoading} style={{width:'100%',padding:11,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',opacity:pwLoading?0.5:1}}>
                {pwLoading ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

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
            <div style={{fontSize:20,fontWeight:800,color:'#f5f0e8',textAlign:'center',letterSpacing:1}}>{user.name}</div>
          </div>
          <div style={{marginTop:12,background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,padding:'10px',textAlign:'center',display:'flex',flexDirection:'column',minHeight:72}}>
            <div style={{fontSize:7,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(245,240,232,0.4)',marginBottom:3}}>Member #:</div>
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
          <div onClick={()=>setSubPanel('partners')} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>My Playing Partners</span>
              {pendingCount>0&&<span style={{width:16,height:16,borderRadius:'50%',background:'#e02247',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:400,color:'#fff',lineHeight:1,flexShrink:0,fontFamily:'Georgia,serif',fontStyle:'normal'}}>!</span>}
            </div>
            <span style={{fontSize:14,color:'rgba(245,240,232,0.3)'}}>›</span>
          </div>
        </div>
        <div style={{height:1,background:'rgba(201,168,76,0.08)'}} />
        <div style={{padding:'10px 20px',display:'flex',flexDirection:'column',gap:6,flex:1,overflowY:'auto'}}>
          <div onClick={()=>setSubPanel('account')} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Account Information</span>
            <span style={{fontSize:14,color:'rgba(245,240,232,0.3)'}}>›</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Membership & Payment</span>
            <span style={{fontSize:14,color:'rgba(245,240,232,0.3)'}}>›</span>
          </div>
          <div onClick={()=>setSubPanel('support')} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Support</span>
            <span style={{fontSize:14,color:'rgba(245,240,232,0.3)'}}>›</span>
          </div>
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
  const [pendingPartnerCount, setPendingPartnerCount] = useState(0);
  const [courses, setCourses] = useState([]);

  const authHeaders = () => {
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      const token = s?.access_token || SUPABASE_ANON_KEY;
      return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` };
    } catch { return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }; }
  };

  const getValidToken = async () => {
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      if (!s?.access_token) return SUPABASE_ANON_KEY;
      if (s.expires_at && Date.now() / 1000 > s.expires_at - 60) {
        if (s.refresh_token) {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
            body: JSON.stringify({ refresh_token: s.refresh_token }),
          });
          const data = await res.json();
          if (res.ok && data.access_token) {
            localStorage.setItem("sb-session", JSON.stringify({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, user: data.user }));
            return data.access_token;
          }
        }
      }
      return s.access_token;
    } catch { return SUPABASE_ANON_KEY; }
  };

  const authHeadersAsync = async () => {
    const token = await getValidToken();
    return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` };
  };

  // Load courses from Supabase
  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/courses?select=id,name,location,tees(id,name,rating,slope)&order=name.asc`, {
          headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data)) setCourses(data);
      } catch {}
    };
    fetchCourses();
  }, []);

  // Load pending partner requests count
  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/partners?recipient_id=eq.${user.id}&status=eq.pending&select=id`, { headers: authHeaders() });
        const data = await res.json();
        if (res.ok && Array.isArray(data)) setPendingPartnerCount(data.length);
      } catch {}
    };
    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 30000);
    return () => clearInterval(interval);
  }, [user.id]);

  // Load rounds from Supabase
  useEffect(() => {
    const fetchRounds = async () => {
      setLoadingRounds(true);
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rounds?user_id=eq.${user.id}&select=*&order=date.desc,id.desc`, { headers: await authHeadersAsync() });
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
        headers: { ...(await authHeadersAsync()), "Prefer": "return=representation" },
        body: JSON.stringify({ user_id: user.id, course: course.trim() || "Unknown Course", score: s, rating: r, slope: sl, tee: tee || null, date: date || todayStr, differential }),
      });
      const data = await res.json();
      const row = Array.isArray(data) ? data[0] : data;
      if (res.ok && row?.id) {
        setRounds(prev => [row, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id));
        setForm({ course:"", score:"", rating:"", slope:"", tee:"", date:localDateStr() });
        setCourseSearch(""); setShowDropdown(false); setConfirmPost(false); setSelectedCourse(null);
        setSaving(false);
        setAdded(true); setTimeout(() => setAdded(false), 2000);
      } else {
        console.error("Round post failed:", data);
        setSaving(false);
        alert("Failed to post round: " + (data?.message || data?.error || "Unknown error — check console"));
      }
    } catch (e) {
      console.error("Round post error:", e);
      setSaving(false);
      alert("Network error posting round");
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${SUPABASE_URL}/rest/v1/rounds?id=eq.${id}&user_id=eq.${user.id}`, { method: "DELETE", headers: await authHeadersAsync() });
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

      {showProfile && <ProfileDrawer user={user} roundCount={rounds.length} handicap={calcHandicapDecimal(rounds)} userRounds={rounds} onClose={()=>{setShowProfile(false);}} onSignOut={onSignOut} onPartnerUpdate={()=>{const fetchCount=async()=>{try{const res=await fetch(`${SUPABASE_URL}/rest/v1/partners?recipient_id=eq.${user.id}&status=eq.pending&select=id`,{headers:authHeaders()});const d=await res.json();if(res.ok&&Array.isArray(d))setPendingPartnerCount(d.length);}catch{}};fetchCount();}} />}

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
          <button className="avatar-btn" onClick={()=>setShowProfile(true)} style={{width:30,height:30,borderRadius:'50%',background:'linear-gradient(135deg,#1a3a5c,#112240)',border:'1.5px solid rgba(232,184,75,0.32)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0,position:'relative'}}>
            <svg width="16" height="18" viewBox="0 0 16 18" fill="none"><line x1="7" y1="1" x2="7" y2="17" stroke="#e8b84b" strokeWidth="1.8" strokeLinecap="round"/><polygon points="7,1 14,4 7,7" fill="#e8b84b"/></svg>
            {pendingPartnerCount>0&&<span style={{position:'absolute',top:-4,right:-4,width:16,height:16,borderRadius:'50%',background:'#e02247',border:'2px solid #0d1b2e',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:400,color:'#fff',lineHeight:1,fontFamily:'Georgia,serif',fontStyle:'normal'}}>!</span>}
          </button>
          <div className="avatar-tooltip">Account</div>
        </div>
        <div style={S.headerMain}>DOWN THE MIDDLE</div>
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
                const matches=courses.filter(c=>c.name.toLowerCase().includes(courseSearch.toLowerCase())||c.location.toLowerCase().includes(courseSearch.toLowerCase())).slice(0,8);
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
            <div style={{fontSize:10,letterSpacing:1,color:'rgba(232,184,75,0.55)',marginTop:-8,marginBottom:12,paddingLeft:4}}>Can't find your course? Enter all information manually instead</div>
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
                if(filtered.length===0) return <div style={{textAlign:'center',padding:'32px 20px',color:'rgba(245,240,232,0.4)',fontSize:13}}>No rounds found for this course</div>;
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
              setAuthUser({ id: s.user.id, name: profile.name, lastName: profile.last_name || '', email: profile.email || s.user.email, memberNumber: profile.member_number, createdAt: profile.created_at });
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
