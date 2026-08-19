import { useState, useMemo, useEffect, useRef } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Browser } from "@capacitor/browser";
import { App as CapApp } from "@capacitor/app";
import { Purchases } from '@revenuecat/purchases-capacitor';

const SUPABASE_URL = "https://euwqnyzzrxrmldmfspjr.supabase.co";
const API_BASE = "https://app.dtmhandicap.com";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1d3FueXp6cnhybWxkbWZzcGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MzAwODMsImV4cCI6MjA5MDEwNjA4M30.4PWVQFOIx3yX7oMWvpO06_dqdrGLk0PGE77DstmpJO0";
const RC_API_KEY = 'appl_CuzGSslMbEObJWALvLlNjJxPEnc';
const IAP_PRODUCT_ID = 'com.dtmhandicap.membership.annual';



// DTM Differential Formula
// ─── DTM Formula v1.0 ──────────────────────────────────────────────────────────
// Pure slope differential — no tier weights.
// Every round counts; outliers compressed via Gaussian weighting, never excluded.
// Recency decay: exponential half-life of 365 days.
// Historical SD: SD of all rounds ever posted by this player (grows over time).

function calcDifferential(score, rating, slope) {
  slope = slope || 113;
  const diff = (score - rating) * (113 / slope);
  return Math.round(diff * 10) / 10;
}

// Gaussian typicality weight: rounds near player's mean count most.
// z = (diff - windowMean) / sd  →  weight = e^(-0.5 * z^2)
function gaussianWeight(diff, windowMean, sd) {
  if (!sd || sd === 0) return 1;
  const z = (diff - windowMean) / sd;
  return Math.exp(-0.5 * z * z);
}

// Recency weight: exponential decay, half-life 365 days.
// A round from exactly one year ago counts 0.5x today's round.
function recencyWeight(datePlayed, referenceDate) {
  const ref = referenceDate || new Date();
  const msPerDay = 86400000;
  const daysAgo = Math.max(0, (ref - new Date(datePlayed + 'T00:00:00')) / msPerDay);
  return Math.pow(0.5, daysAgo / 365);
}

// Historical SD: stdev of all differentials ever posted by this player.
// Uses score/rating/slope to recompute pure-slope differentials from raw data.
// Falls back to window SD when fewer than 2 rounds available.
function historicalSD(allRounds) {
  if (!allRounds || allRounds.length < 2) return null;
  const diffs = allRounds.map(r => calcDifferential(r.score, r.rating, r.slope));
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const variance = diffs.reduce((s, d) => s + Math.pow(d - mean, 2), 0) / (diffs.length - 1);
  return Math.sqrt(variance);
}

// Window SD: stdev of differentials within the current window only.
// Used for historical/stats calculations where full history isn't available.
function windowSD(diffs) {
  if (!diffs || diffs.length < 2) return null;
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const variance = diffs.reduce((s, d) => s + Math.pow(d - mean, 2), 0) / (diffs.length - 1);
  return Math.sqrt(variance);
}

// Core DTM index calculation.
// allRounds: full posting history (for historical SD). Can equal window if not available.
// window: the 18 rounds used for this calculation (sorted newest first).
// referenceDate: snapshot date for recency decay (defaults to now).
function dtmIndexFromWindow(window, sd, referenceDate) {
  if (!window || window.length === 0) return null;
  const diffs = window.map(r => calcDifferential(r.score, r.rating, r.slope));
  const windowMean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const effectiveSD = sd || windowSD(diffs) || 1;
  let weightedSum = 0;
  let weightTotal = 0;
  window.forEach((r, i) => {
    const gw = gaussianWeight(diffs[i], windowMean, effectiveSD);
    const rw = recencyWeight(r.date, referenceDate);
    const w = gw * rw;
    weightedSum += diffs[i] * w;
    weightTotal += w;
  });
  if (weightTotal === 0) return null;
  return weightedSum / weightTotal;
}

// Main index — used for live displayed handicap.
// 18-round window within 18 months. Historical SD from all rounds.
// Returns null if fewer than 10 eligible rounds (no index shown).
// Returns decimal value; caller truncates for display.
function calcHandicapDecimal(rounds, referenceDate) {
  const ref = referenceDate || new Date();
  const cutoff = new Date(ref);
  cutoff.setMonth(cutoff.getMonth() - 18);
  const eligible = rounds
    .filter(r => r.score != null && r.rating != null && new Date(r.date + 'T00:00:00') >= cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);
  if (eligible.length < 10) return null;
  const window = eligible.slice(0, 18);
  const sd = historicalSD(rounds.filter(r => r.score != null && r.rating != null));
  return dtmIndexFromWindow(window, sd, ref);
}

// Whole-number version for display.
function calcHandicap(rounds, referenceDate) {
  const val = calcHandicapDecimal(rounds, referenceDate);
  return val === null ? null : Math.trunc(val);
}

// Stats/chart version — scans arbitrary round slices without date cutoff.
// Uses window SD (not historical SD) since we don't have full history context.
// Returns decimal.
function calcHandicapDecimalAllTime(rounds) {
  if (!rounds || rounds.length < 10) return null;
  const eligible = rounds.filter(r => r.score != null && r.rating != null);
  if (eligible.length < 10) return null;
  const window = eligible.slice(0, 18);
  const diffs = window.map(r => calcDifferential(r.score, r.rating, r.slope));
  const sd = windowSD(diffs);
  return dtmIndexFromWindow(window, sd, null);
}

// Whole-number version for stats display.
function calcHandicapAllTime(rounds) {
  const val = calcHandicapDecimalAllTime(rounds);
  return val === null ? null : Math.trunc(val);
}


function AppHeader() {
  return (
    <div style={{background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)',padding:'36px 20px 20px',textAlign:'center'}}>
      <div style={{fontSize:27,fontWeight:900,color:'#f5f0e8',textTransform:'uppercase',letterSpacing:5.5,lineHeight:1.1,marginBottom:0,whiteSpace:'nowrap',fontFamily:'Verdana,sans-serif'}}>Down The Middle</div>
      <div style={{fontSize:15,fontWeight:700,letterSpacing:3.75,textTransform:'uppercase',color:'#e02247',marginTop:5.5,marginLeft:-5,fontFamily:'Verdana,sans-serif'}}>A Truer Golf Handicap</div>
      <div style={{height:2,background:'rgba(201,168,76,0.45)',margin:'16px 0 0'}}/>
    </div>
  );
}

// ─── Checkout Redirect ─────────────────────────────────────────────────────────
function CheckoutRedirect({ session, handleSignOut, user, onReactivated, onNativePurchaseSuccess }) {
  const [reactivating, setReactivating] = useState(false);
  const [iapError, setIapError] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const isNative = window.Capacitor?.isNativePlatform?.();
  const isLapsed = user && user.memberNumber && (user.stripeCustomerId || user.paymentProvider === 'apple');

  // ── Native IAP purchase ──────────────────────────────────────────────────────
  const handleIAPPurchaseInternal = async (silent = false) => {
    if (reactivating) return;
    setReactivating(true);
    setIapError('');
    try {
      const offerings = await Purchases.getOfferings();
      const currentOffering = offerings?.current;
      const pkg = currentOffering?.annual;
      if (!pkg) { if (!silent) setIapError('Unable to load membership — please try again.'); setReactivating(false); return; }
      const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
      const renewsAt = customerInfo.latestExpirationDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const savedSession = JSON.parse(localStorage.getItem('sb-session') || 'null');
      let updatedUser = { ...user, subscribed: true, paymentProvider: 'apple', subscriptionRenewsAt: renewsAt };
      if (savedSession?.access_token) {
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}` },
          body: JSON.stringify({ subscribed: true, payment_provider: 'apple', subscription_renews_at: renewsAt }),
        });
        try {
          const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=*`, {
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
          });
          if (profRes.ok) {
            const profile = await profRes.json();
            updatedUser = { id: user.id, name: profile.name || user.name, lastName: profile.last_name || user.lastName, email: profile.email || user.email, memberNumber: profile.member_number || user.memberNumber, createdAt: profile.created_at || user.createdAt, subscribed: true, subscriptionRenewsAt: renewsAt, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: 'apple' };
          }
        } catch {}
      }
      if (onNativePurchaseSuccess && !isLapsed) {
        onNativePurchaseSuccess(updatedUser);
      } else {
        onReactivated?.(updatedUser);
      }
    } catch (e) {
      const cancelled = e?.code === 'PURCHASE_CANCELLED' || e?.code === 2 || e?.userCancelled === true || String(e?.message || '').toLowerCase().includes('cancel');
      if (!cancelled && !silent) {
        const detail = [e?.readableErrorCode, e?.code != null ? `(${e.code})` : '', e?.message || e?.underlyingErrorMessage].filter(Boolean).join(' ');
        setIapError(detail || 'Purchase failed — please try again.');
      }
      setReactivating(false);
    }
  };
  const handleIAPPurchase = () => handleIAPPurchaseInternal(false);

  // ── Native: on mount, silently sync if already subscribed in RevenueCat ────────
  useEffect(() => {
    if (!isNative) return;
    (async () => {
      try {
        const { customerInfo } = await Purchases.getCustomerInfo();
        const hasActiveSub = (customerInfo.activeSubscriptions?.length ?? 0) > 0;
        if (!hasActiveSub) return;
        const renewsAt = customerInfo.latestExpirationDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        const savedSession = JSON.parse(localStorage.getItem('sb-session') || 'null');
        let syncedUser = { ...user, subscribed: true, paymentProvider: 'apple', subscriptionRenewsAt: renewsAt };
        if (savedSession?.access_token) {
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}` },
            body: JSON.stringify({ subscribed: true, payment_provider: 'apple', subscription_renews_at: renewsAt }),
          });
          try {
            const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=*`, {
              headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
            });
            if (profRes.ok) {
              const profile = await profRes.json();
              syncedUser = { id: user.id, name: profile.name || user.name, lastName: profile.last_name || user.lastName, email: profile.email || user.email, memberNumber: profile.member_number || user.memberNumber, createdAt: profile.created_at || user.createdAt, subscribed: true, subscriptionRenewsAt: renewsAt, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: 'apple' };
            }
          } catch {}
        }
        onReactivated?.(syncedUser);
      } catch {}
    })();
  }, []);

  // ── Web: poll Supabase on return from Stripe ─────────────────────────────────
  useEffect(() => {
    if (isNative || !isLapsed) return;
    const checkOnReturn = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const savedSession = JSON.parse(localStorage.getItem('sb-session') || 'null');
        if (!savedSession?.access_token) return;
        const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${savedSession.user.id}&select=*`, {
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
        });
        const profile = await profRes.json();
        if (profRes.ok && profile?.subscribed) {
          onReactivated?.({ id: savedSession.user.id, name: profile.name, lastName: profile.last_name || '', email: profile.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: true, subscriptionRenewsAt: profile.subscription_renews_at || null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null });
        }
      } catch {}
    };
    document.addEventListener('visibilitychange', checkOnReturn);
    return () => document.removeEventListener('visibilitychange', checkOnReturn);
  }, [isNative, isLapsed]);


  // ── Native: lapsed Stripe user — poll after portal browser closes ────────────
  useEffect(() => {
    if (!isNative || !isLapsed || user?.paymentProvider !== 'stripe') return;
    let listenerHandle;
    (async () => {
      listenerHandle = await Browser.addListener('browserFinished', async () => {
        const savedSession = JSON.parse(localStorage.getItem('sb-session') || 'null');
        if (!savedSession?.access_token) return;
        try {
          const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=*`, {
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
          });
          const profile = await profRes.json();
          if (profRes.ok && profile?.subscribed) {
            onReactivated?.({ id: user.id, name: profile.name || user.name, lastName: profile.last_name || user.lastName, email: profile.email || user.email, memberNumber: profile.member_number || user.memberNumber, createdAt: profile.created_at || user.createdAt, subscribed: true, subscriptionRenewsAt: profile.subscription_renews_at || null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || 'stripe' });
          }
        } catch {}
      });
    })();
    return () => { listenerHandle?.remove(); };
  }, []);

  // ── Native: subscription page (Apple IAP — not for lapsed Stripe users) ───────
  if (isNative && !(isLapsed && user?.paymentProvider === 'stripe')) return (
    <div className="dtm-app-frame" style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',color:'#f5f0e8',display:'flex',flexDirection:'column'}}>
      <style>{globalStyles}</style>
      <AppHeader />
      <div style={{padding:'4px 24px',flex:1,display:'flex',flexDirection:'column',gap:20}}>
        {isLapsed && <div style={{fontSize:14,color:'#e8b84b',letterSpacing:0.3,textAlign:'center',marginBottom:8,whiteSpace:'nowrap'}}>Your membership has lapsed and is currently inactive.</div>}
        <div style={{display:'flex',flexDirection:'column',gap:18,paddingLeft:40}}>
          {['Annual Membership','Handicap tracking','Unlimited rounds','Scoring analytics','Social','$49.99/year · Auto-renewing'].map(f => (
            <div key={f} style={{display:'flex',alignItems:'center',gap:14,fontSize:16,color:'#f5f0e8'}}>
              <span style={{color:'#e8b84b',fontSize:16,fontWeight:700,flexShrink:0,lineHeight:1}}>✓</span>
              {f}
            </div>
          ))}
        </div>
        {iapError ? <div style={{fontSize:11,color:'#e02247',letterSpacing:0.5,textAlign:'center'}}>{iapError}</div> : null}
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <button onClick={handleIAPPurchase} disabled={reactivating} style={{width:'100%',padding:'15px 0',background:reactivating?'rgba(201,168,76,0.4)':'linear-gradient(135deg,#e8b84b,#c49a30)',border:'none',borderRadius:4,color:'#0d1b2e',fontSize:13,fontWeight:900,letterSpacing:3,textTransform:'uppercase',cursor:reactivating?'default':'pointer'}}>
            {reactivating ? 'Processing...' : (isLapsed ? 'Reactivate Membership' : 'Start Membership')}
          </button>
          <div style={{fontSize:10,color:'rgba(245,240,232,0.3)',textAlign:'center',lineHeight:1.7,width:'100%'}}>
            Payment will be charged to your Apple ID. Your membership will renew automatically unless cancelled at least 24 hours before the end of the period.
            <div style={{marginTop:10,display:'flex',justifyContent:'center',gap:20}}>
              <span onClick={()=>Browser.open({url:'https://dtmhandicap.com/privacy'})} style={{textDecoration:'underline',cursor:'pointer'}}>Privacy Policy</span>
              <span onClick={()=>Browser.open({url:'https://dtmhandicap.com/terms'})} style={{textDecoration:'underline',cursor:'pointer'}}>Terms of Use</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{padding:'24px 20px 44px',textAlign:'center'}}>
        <div onClick={handleSignOut} role="button" style={{display:'inline-block',color:'rgba(201,168,76,0.45)',fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',cursor:'pointer'}}>{isLapsed ? 'Log Out' : 'Exit'}</div>
      </div>
    </div>
  );

  // ── Web: lapsed Apple IAP user — cannot reactivate via browser ──────────────
  if (!isNative && isLapsed && user?.paymentProvider === 'apple') return (
    <div className="dtm-app-frame" style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',color:'#f5f0e8',display:'flex',flexDirection:'column'}}>
      <style>{globalStyles}</style>
      <AppHeader />
      <div style={{padding:'4px 24px',flex:1,display:'flex',flexDirection:'column',gap:16}}>
        <div style={{fontSize:14,color:'#e8b84b',letterSpacing:0.3,textAlign:'center',marginBottom:4}}>Your membership has lapsed and is currently inactive.</div>
        <div style={{fontSize:14,color:'#f5f0e8',lineHeight:1.75,textAlign:'center'}}>To reactivate your membership, please visit<br/>the App Store on your Apple device.</div>
      </div>
      <div style={{padding:'24px 20px 44px',textAlign:'center'}}>
        <div onClick={handleSignOut} role="button" style={{display:'inline-block',color:'rgba(201,168,76,0.45)',fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',cursor:'pointer'}}>Log Out</div>
      </div>
    </div>
  );

  // ── Web: lapsed user waits while Stripe portal opens ────────────────────────
  if (isLapsed) return (
    <div className="dtm-app-frame" style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',color:'#f5f0e8',display:'flex',flexDirection:'column'}}>
      <style>{globalStyles}</style>
      <AppHeader />
      <div style={{padding:'28px 24px',flex:1,display:'flex',flexDirection:'column'}}>
        <div style={{textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
          <div style={{fontSize:13,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#e8b84b'}}>Welcome Back, {user.name}</div>
          <div style={{fontSize:13,color:'#f5f0e8',lineHeight:1.7}}>Your membership is currently inactive.</div>
          <div style={{fontSize:13,color:'#f5f0e8',lineHeight:1.7}}>Please reactivate it now to access Down The Middle.</div>
          <button onClick={async () => {
            setReactivating(true);
            try {
              const res = await fetch(`${API_BASE}/api/create-checkout-session-2`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.email, userId: user.id, reactivation: true }),
              });
              const data = await res.json();
              if (data.url) {
                if (isNative) {
                  await Browser.open({ url: data.url });
                } else {
                  window.location.href = data.url;
                }
              }
            } catch {}
            setReactivating(false);
          }} disabled={reactivating} className="auth-btn-primary" style={{marginTop:4,width:'100%',padding:'13px 0',background:'linear-gradient(135deg,#e8b84b,#c49a30)',border:'none',borderRadius:3,color:'#0d1b2e',fontSize:11,fontWeight:900,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',opacity:reactivating?0.6:1}}>
            {reactivating ? 'Redirecting...' : 'Reactivate Membership'}
          </button>
        </div>
      </div>
      <div style={{padding:'24px 20px 44px',textAlign:'center'}}>
        <div onClick={handleSignOut} role="button" style={{display:'inline-block',color:'rgba(201,168,76,0.45)',fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',cursor:'pointer'}}>Log Out</div>
      </div>
    </div>
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/create-checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: session?.user?.email, userId: session?.user?.id }),
        });
        const data = await res.json();
        if (data.url) window.location.href = data.url;
      } catch {}
    })();
  }, []);

  return (
    <div style={{minHeight:'100dvh',background:'#0d1b2e',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <style>{globalStyles}</style>
      <div style={{color:'#e8b84b',fontSize:14,fontWeight:700,letterSpacing:2,textTransform:'uppercase'}}>Redirecting to checkout...</div>
    </div>
  );
}



function ResendVerifyScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const inputStyle = { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'9px 10px', color:'#f5f0e8', fontSize:13, outline:'none', width:'100%', WebkitTextFillColor:'#f5f0e8' };

  const handleResend = async () => {
    if (!email || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/send-auth-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'resend_verify', email })
      });
      if (res.ok) { setSent(true); } else { const d = await res.json().catch(()=>({})); setError(d.error || 'Failed to send. Please try again.'); }
    } catch { setError('Failed to send. Please try again.'); }
    setLoading(false);
  };

  return (
    <div className="dtm-app-frame" style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',color:'#f5f0e8',display:'flex',flexDirection:'column'}}>
      <style>{globalStyles}</style>
      <AppHeader />
      <div style={{padding:'4px 24px 0'}}>
        {sent ? (
          <p style={{color:'#e8b84b',fontSize:15,fontWeight:700,lineHeight:1.75,textAlign:'center',margin:0}}>Please check your email.</p>
        ) : (
          <>
            <p style={{color:'#e8b84b',fontSize:15,fontWeight:700,lineHeight:1.75,textAlign:'center',margin:'0 0 4px'}}>Your verification link has expired.</p>
            <p style={{color:'#e8b84b',fontSize:15,fontWeight:700,lineHeight:1.75,textAlign:'center',margin:'0 0 20px'}}>Enter your email to receive a new one.</p>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" style={inputStyle} />
            {error && <div style={{fontSize:11,color:'#e02247',marginTop:8,textAlign:'center'}}>{error}</div>}
            <button onClick={handleResend} disabled={!email||loading} onMouseEnter={e=>{if(email&&!loading)e.currentTarget.style.filter='brightness(1.2)'}} onMouseLeave={e=>e.currentTarget.style.filter='none'} style={{marginTop:12,width:'100%',padding:'13px 0',background:email&&!loading?'linear-gradient(135deg,#c41e3a,#9e1830)':'rgba(196,30,58,0.3)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:900,letterSpacing:3,textTransform:'uppercase',cursor:email&&!loading?'pointer':'default',transition:'filter 0.15s ease'}}>
              {loading ? 'Sending...' : 'Send New Link'}
            </button>
          </>
        )}
      </div>
    </div>
  );
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

// ─── Global Styles ─────────────────────────────────────────────────────────────
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800;900&display=swap');
  * { font-family: 'Geist','Inter',system-ui,sans-serif !important; box-sizing: border-box; -webkit-tap-highlight-color: rgba(0,0,0,0) !important; }
  button, a, div { -webkit-tap-highlight-color: rgba(0,0,0,0) !important; }
  *:focus { outline: none !important; }
  input:focus { box-shadow: none !important; }
  * { -webkit-tap-highlight-color: rgba(0,0,0,0) !important; }
  input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus { -webkit-box-shadow: 0 0 0px 1000px rgba(8,18,36,1) inset !important; -webkit-text-fill-color: #f5f0e8 !important; background-color: rgba(8,18,36,1) !important; }
  html, body { background: #0d1b2e; margin: 0; padding: 0; }
  .dtm-app-frame { padding-top: env(safe-area-inset-top); }
  @keyframes dtm-spin { to { transform: rotate(360deg); } }
  .dtm-row-btn:hover { background: rgba(232,184,75,0.06) !important; }
  .font-verdana { font-family: Verdana, Geneva, sans-serif !important; }
  input::placeholder { color: rgba(245,240,232,0.2); }
  input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
  .auth-btn-primary:hover { filter: brightness(1.1); }
  .auth-btn-ghost:hover { border-color: rgba(201,168,76,0.8) !important; color: rgba(201,168,76,1) !important; box-shadow: 0 0 18px rgba(232,184,75,0.35) !important; }
  .auth-link:hover { color: #f5c842; }
  .confirm-post-btn:hover{filter:brightness(1.15);transform:scale(1.02);transition:all 0.15s ease;}
  .tab-btn:hover{color:rgba(245,240,232,0.75)!important;transition:all 0.15s ease;}
  .tab-btn-active:hover{color:#e8b84b!important;transition:none;}
  .confirm-cancel-btn:hover{background:rgba(201,168,76,0.1)!important;border-color:rgba(201,168,76,0.6)!important;color:rgba(201,168,76,0.9)!important;transition:all 0.15s ease;}
  .info-tooltip{position:relative;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;cursor:pointer;flex-shrink:0;vertical-align:middle;opacity:0.65;}
  .info-tooltip .tooltip-text{visibility:hidden;opacity:0;position:absolute;top:50%;left:20px;transform:translateY(-50%);background:#0d1b2e;border:2px solid rgba(201,168,76,0.5);border-radius:4px;padding:8px 10px;font-size:10px;letter-spacing:0.3px;font-weight:600;color:rgba(245,240,232,0.9);white-space:normal;width:200px;text-align:left;z-index:999;transition:opacity 0.2s ease;pointer-events:none;}
  .info-tooltip:hover .tooltip-text,.info-tooltip.active .tooltip-text{visibility:visible;opacity:1;}
  .ttm-tooltip{position:relative;cursor:pointer;border-bottom:1px dotted rgba(201,168,76,0.4);}
  .ttm-tooltip .tooltip-text{visibility:hidden;opacity:0;position:absolute;bottom:20px;top:auto;left:50%;transform:translateX(-50%);background:#0d1b2e;border:2px solid rgba(201,168,76,0.5);border-radius:4px;padding:8px 10px;font-size:10px;letter-spacing:0.3px;font-weight:600;color:rgba(180,175,170,0.8);white-space:nowrap;z-index:999;transition:opacity 0.2s ease;pointer-events:none;textTransform:none;}
  .ttm-tooltip:hover .tooltip-text{visibility:visible;opacity:1;}
  @media (hover: hover) {.avatar-btn:hover{border-color:rgba(232,184,75,0.7)!important;background:linear-gradient(135deg,#1e4570,#1a3a5c)!important;transition:all 0.15s ease;}}
  .signout-btn:hover{filter:brightness(1.25);transition:filter 0.15s ease;}
  button[style*="#c41e3a"]:hover{filter:brightness(1.2);transition:filter 0.15s ease;}
  button[style*="#9e1830"]:hover{filter:brightness(1.2);transition:filter 0.15s ease;}
  button[style*="#e8b84b"]:hover{filter:brightness(1.1);transition:filter 0.15s ease;}
  button[style*="#c49a30"]:hover{filter:brightness(1.1);transition:filter 0.15s ease;}
  .avatar-wrap .avatar-tooltip{visibility:hidden;opacity:0;position:absolute;top:36px;right:0;background:#0d1b2e;border:1px solid rgba(201,168,76,0.3);border-radius:4px;padding:8px 10px;font-size:10px;letter-spacing:0.3px;text-transform:none;color:rgba(180,175,170,0.8);white-space:nowrap;transition:opacity 0.15s ease;pointer-events:none;font-family:'Geist',sans-serif;font-weight:400;}
  .avatar-wrap:hover .avatar-tooltip{visibility:visible;opacity:1;}
  @media(min-width:431px){.dtm-app-frame{border-left:1px solid rgba(232,184,75,0.2)!important;border-right:1px solid rgba(232,184,75,0.2)!important;}}
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
function AuthScreen({ onAuth, verifiedEmail, verifiedUser, resetToken, forceLogin, onForceLoginClear, forceSignup, onForceSignupClear, onResetComplete, fromEmailLink, onEmailLinkClear, onShowAppBanner, reactivationReturn, onReactivationDismiss, preFillMemberNumber, preFillNonce }) {
  const [mode, setMode] = useState(() => {
    if (resetToken) return 'resetPassword';
    if (forceSignup) return 'signup';
    if (forceLogin) return 'login';
    const p = new URLSearchParams(window.location.search);
    if (p.get('screen') === 'login') { window.history.replaceState(null, '', window.location.pathname); return 'login'; }
    if (p.get('screen') === 'signup') { window.history.replaceState(null, '', window.location.pathname); return 'signup'; }
    return verifiedEmail ? 'login' : 'landing';
  });
  useEffect(() => { if (forceSignup) { setMode('signup'); onForceSignupClear?.(); } }, [forceSignup]);
  useEffect(() => { if (forceLogin) { setMode('login'); onForceLoginClear && onForceLoginClear(); } }, [forceLogin]);
  useEffect(() => { if (resetToken) setMode('resetPassword'); }, [resetToken]);
  const showOpenInApp = fromEmailLink && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const [verifySuccess] = useState(!!verifiedEmail);
  useEffect(() => { if (verifiedUser) { setPendingUser(verifiedUser); setMode('onboarding'); } }, [verifiedUser]);
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [memberNumber, setMemberNumber] = useState(preFillMemberNumber || '');
  useEffect(() => { if (preFillMemberNumber) { setMemberNumber(preFillMemberNumber); setMode('login'); } }, [preFillNonce]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingUser, setPendingUser] = useState(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resetSuccess, setResetSuccess] = useState(''); // 'password' | 'member' | ''
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  const clearFields = () => { setName(''); setLastName(''); setEmail(''); setMemberNumber(''); setPassword(''); setConfirmPassword(''); setResetEmail(''); setError(''); setMessage(''); };

  const S = {
    wrap: { maxWidth:430, margin:'0 auto', minHeight:'100dvh', background:'#0d1b2e', color:'#f5f0e8', display:'flex', flexDirection:'column' },
    top: { background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)', padding:'36px 20px 20px', textAlign:'center' },
    title: { fontSize:27, fontWeight:900, color:'#f5f0e8', textTransform:'uppercase', letterSpacing:5.5, lineHeight:1.1, marginBottom:0, whiteSpace:'nowrap', fontFamily:'Verdana,sans-serif' },
    sub: { fontSize:15, fontWeight:700, letterSpacing:3.75, textTransform:'uppercase', color:'#e02247', marginTop:5.5, marginLeft:-5, fontFamily:'Verdana,sans-serif' },
    divider: { height:2, background:'rgba(201,168,76,0.45)', margin:'28px 0 0' },
    body: { padding:'28px 24px', flex:1 },
    label: { fontSize:9, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.75)', marginBottom:6, display:'block', paddingLeft:2 },
    input: { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'12px', color:'#f5f0e8', fontSize:15, outline:'none', width:'100%' },
    btnPrimary: { width:'100%', padding:14, background:'linear-gradient(135deg,#c41e3a,#9e1830)', border:'none', borderRadius:3, color:'#f5f0e8', fontSize:13, fontWeight:900, letterSpacing:4, textTransform:'uppercase', cursor:'pointer', marginTop:8 },
    btnGhost: { width:'100%', padding:14, background:'transparent', border:'1px solid #e8b84b', borderRadius:3, color:'#e8b84b', fontSize:13, fontWeight:700, letterSpacing:4, textTransform:'uppercase', cursor:'pointer', marginTop:16 },
    error: { fontSize:11, color:'#e02247', letterSpacing:1, marginTop:10, textAlign:'center' },
    success: { fontSize:11, color:'#84e040', letterSpacing:1, marginTop:10, textAlign:'center' },
    field: { marginBottom:16 },
    switchText: { textAlign:'center', fontSize:11, color:'rgba(245,240,232,0.4)', marginTop:38, letterSpacing:1 },
    back: { background:'none', border:'none', color:'rgba(201,168,76,0.5)', fontSize:11, letterSpacing:2, textTransform:'uppercase', cursor:'pointer', marginBottom:26, padding:0 },
  };

  const anonHeaders = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY };

  const Header = () => <AppHeader />;

  const handleSignUp = async () => {
    setError(''); setMessage('');
    if (!name.trim()) return setError('Please enter your first name');
    if (!lastName.trim()) return setError('Please enter your last name');
    if (!email.trim() || !email.includes('@')) return setError('Please enter a valid email');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirmPassword) return setError('Passwords do not match');
    setLoading(true);
    try {
      // Pre-check for duplicate email
      const dupCheck = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${email.trim().toLowerCase()}&select=id`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
      });
      const dupData = await dupCheck.json();
      if (Array.isArray(dupData) && dupData.length > 0) { setLoading(false); return setError('An account already exists with that email'); }

      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST", headers: anonHeaders,
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, data: { name: name.trim(), last_name: lastName.trim() } }),
      });
      const data = await res.json();
      if (!res.ok) { setLoading(false); const errMsg = data.error_description || data.msg || ''; return setError(errMsg.toLowerCase().includes('already') || errMsg.toLowerCase().includes('registered') ? 'An account already exists with that email' : 'Sign up failed — please try again'); }
      // When email confirmation is on, data.user exists but data.access_token may be null
      const userId = data.user?.id || data.id;
      const userEmail = data.user?.email || email.trim().toLowerCase();
      if (!userId) { setLoading(false); return setError("Sign up failed — please try again"); }
      // Generate a unique member number with collision check
      let newMemberNumber;
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateMemberNumber();
        const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?member_number=eq.${candidate}&select=id`, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
        const checkData = await checkRes.json();
        if (Array.isArray(checkData) && checkData.length === 0) { newMemberNumber = candidate; break; }
      }
      if (!newMemberNumber) { setLoading(false); return setError("Sign up failed — please try again"); }
      // Use service key or anon key — profile must be created even without session
      const authHeader = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${data.access_token || SUPABASE_ANON_KEY}`, "Prefer": "return=representation" };
      const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST", headers: authHeader,
        body: JSON.stringify({ id: userId, name: name.trim(), last_name: lastName.trim(), member_number: newMemberNumber, email: email.trim().toLowerCase() }),
      });
      // Store session if available
      if (data.access_token) {
        const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, user: data.user };
        localStorage.setItem("sb-session", JSON.stringify(session));
      }
      const newUser = { id: userId, name: name.trim(), lastName: lastName.trim(), email: userEmail, memberNumber: newMemberNumber, createdAt: new Date().toISOString() };
      setPendingUser(newUser);
      setPendingEmail(email.trim().toLowerCase());
      // Supabase sends confirmation email natively via SMTP (Resend)
      setMode('confirm');
    } catch (e) { setError("Network error — please try again"); }
    setLoading(false);
  };

  const handleLogin = async () => {
    setError(''); setMessage('');
    if (!memberNumber.trim() || !password) return setError('Please enter your member # and password');
    setLoading(true);
    try {
      // Single lookup: member number → full profile (includes email)
      const lookupRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?member_number=eq.${memberNumber.trim()}&select=*`, {
        headers: { ...anonHeaders, "Accept": "application/vnd.pgrst.object+json" }
      });
      const fullProfile = await lookupRes.json();
      if (!lookupRes.ok || !fullProfile?.id) { setLoading(false); return setError('Member # not found'); }
      if (!fullProfile?.email) { setLoading(false); return setError('Could not find account — please try again'); }
      // Authenticate with email
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: anonHeaders,
        body: JSON.stringify({ email: fullProfile.email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.access_token) { setLoading(false); return setError('Incorrect password'); }
      const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, user: data.user };
      localStorage.setItem("sb-session", JSON.stringify(session));
      let authProfile = fullProfile;
      try {
        const authProfRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${data.user.id}&select=*`, {
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${data.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
        });
        if (authProfRes.ok) authProfile = await authProfRes.json();
      } catch {}
      onAuth({ id: data.user.id, name: authProfile.name, lastName: authProfile.last_name || '', email: authProfile.email, memberNumber: authProfile.member_number, createdAt: authProfile.created_at, subscribed: authProfile.subscribed || false, subscriptionRenewsAt: authProfile.subscription_renews_at || null, stripeCustomerId: authProfile.stripe_customer_id || null, paymentProvider: authProfile.payment_provider || null });
    } catch (e) { setError("Network error — please try again"); }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setError(''); setMessage('');
    if (!resetEmail.trim() || !resetEmail.includes('@')) return setError('Please enter a valid email');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/send-auth-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'password_reset', email: resetEmail.trim().toLowerCase() }),
      });
      if (!res.ok) { setLoading(false); return setError('No account found with that email'); }
      setResetEmail('');
      setLoading(false);
      clearFields();
      setMode('login');
      return;
    } catch (e) { setError('Network error — please try again'); }
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
      const sendRes = await fetch(`${API_BASE}/api/send-auth-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'member_number', email: email.trim().toLowerCase(), name: profile.name, memberNumber: profile.member_number }),
      });
      if (!sendRes.ok) { setLoading(false); return setError('Failed to send email — please try again'); }
      setEmail('');
      setLoading(false);
      clearFields();
      setMode('login');
      return;
    } catch (e) { setError('Network error — please try again'); }
    setLoading(false);
  };

  if (mode === 'landing') return (
    <div className="dtm-app-frame" style={{...S.wrap, paddingTop:0}}>
      <style>{globalStyles}</style>
      <div style={{...S.body, display:'flex', flexDirection:'column', justifyContent:'center', paddingBottom:96}}>
        <div style={{textAlign:'center', marginBottom:20, marginTop:0}}>
          <svg viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg" style={{width:'329px', height:'auto', filter:'drop-shadow(0 12px 40px rgba(0,0,0,0.6))', borderRadius:'22px', boxShadow:'0 0 0 1.5px rgba(232,184,75,0.45)'}}>
            <defs>
              <clipPath id="lp-cardHero"><rect x="0" y="0" width="300" height="400" rx="22"/></clipPath>
              <clipPath id="lp-ballClip"><circle cx="150" cy="158" r="8"/></clipPath>
              <radialGradient id="lp-ballShade" cx="38%" cy="33%" r="70%" fx="38%" fy="33%">
                <stop offset="0%" stopColor="#ffffff"/>
                <stop offset="52%" stopColor="#f0efe8"/>
                <stop offset="100%" stopColor="#c2c1ba"/>
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="300" height="400" rx="22" fill="#0d1b2e"/>
            <rect x="0" y="0" width="300" height="316" fill="#1a420a" clipPath="url(#lp-cardHero)"/>
            <rect x="85" y="0" width="130" height="316" fill="#2e8010" clipPath="url(#lp-cardHero)"/>
            <rect x="0" y="0" width="10" height="316" fill="#0d1b2e" clipPath="url(#lp-cardHero)"/>
            <rect x="290" y="0" width="10" height="316" fill="#0d1b2e" clipPath="url(#lp-cardHero)"/>
            <rect x="0" y="0" width="300" height="10" fill="#0d1b2e" clipPath="url(#lp-cardHero)"/>
            <ellipse cx="151" cy="166.8" rx="5.5" ry="1.4" fill="rgba(0,0,0,0.28)"/>
            <circle cx="150" cy="158" r="8" fill="url(#lp-ballShade)"/>
            <circle cx="150" cy="158" r="0.65" fill="rgba(88,86,78,0.30)" clipPath="url(#lp-ballClip)"/>
            <circle cx="150.0" cy="155.8" r="0.62" fill="rgba(88,86,78,0.27)" clipPath="url(#lp-ballClip)"/>
            <circle cx="151.9" cy="156.9" r="0.62" fill="rgba(88,86,78,0.27)" clipPath="url(#lp-ballClip)"/>
            <circle cx="151.9" cy="159.1" r="0.62" fill="rgba(88,86,78,0.27)" clipPath="url(#lp-ballClip)"/>
            <circle cx="150.0" cy="160.2" r="0.62" fill="rgba(88,86,78,0.27)" clipPath="url(#lp-ballClip)"/>
            <circle cx="148.1" cy="159.1" r="0.62" fill="rgba(88,86,78,0.27)" clipPath="url(#lp-ballClip)"/>
            <circle cx="148.1" cy="156.9" r="0.62" fill="rgba(88,86,78,0.27)" clipPath="url(#lp-ballClip)"/>
            <circle cx="151.0" cy="154.1" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="152.8" cy="155.2" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="153.9" cy="157.0" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="153.9" cy="159.0" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="152.8" cy="160.8" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="151.0" cy="161.9" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="149.0" cy="161.9" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="147.2" cy="160.8" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="146.1" cy="159.0" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="146.1" cy="157.0" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="147.2" cy="155.2" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="149.0" cy="154.1" r="0.58" fill="rgba(88,86,78,0.24)" clipPath="url(#lp-ballClip)"/>
            <circle cx="151.2" cy="152.1" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="153.3" cy="153.0" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="155.0" cy="154.7" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="155.9" cy="156.8" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="155.9" cy="159.2" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="155.0" cy="161.3" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="153.3" cy="163.0" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="151.2" cy="163.9" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="148.8" cy="163.9" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="146.7" cy="163.0" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="145.0" cy="161.3" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="144.1" cy="159.2" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="144.1" cy="156.8" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="145.0" cy="154.7" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="146.7" cy="153.0" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="148.8" cy="152.1" r="0.53" fill="rgba(88,86,78,0.20)" clipPath="url(#lp-ballClip)"/>
            <circle cx="151.1" cy="150.9" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="153.3" cy="151.6" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="155.1" cy="152.9" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="156.4" cy="154.7" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="157.1" cy="156.9" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="157.1" cy="159.1" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="156.4" cy="161.3" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="155.1" cy="163.1" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="153.3" cy="164.4" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="151.1" cy="165.1" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="148.9" cy="165.1" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="146.7" cy="164.4" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="144.9" cy="163.1" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="143.6" cy="161.3" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="142.9" cy="159.1" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="142.9" cy="156.9" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="143.6" cy="154.7" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="144.9" cy="152.9" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="146.7" cy="151.6" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="148.9" cy="150.9" r="0.48" fill="rgba(88,86,78,0.16)" clipPath="url(#lp-ballClip)"/>
            <circle cx="146.8" cy="155.0" r="1.9" fill="rgba(255,255,255,0.62)" clipPath="url(#lp-ballClip)"/>
            <rect x="0" y="316" width="300" height="6" fill="#e8b84b" clipPath="url(#lp-cardHero)"/>
            <rect x="0" y="322" width="300" height="78" fill="#0d1b2e" clipPath="url(#lp-cardHero)"/>
            <text x="151.75" y="358" fontFamily="Verdana,sans-serif" fontSize="18" fontWeight="900" fill="#ffffff" textAnchor="middle" letterSpacing="3.5">DOWN THE MIDDLE</text>
            <text x="151.25" y="377" fontFamily="Verdana,sans-serif" fontSize="10" fill="#c41e3a" fontWeight="700" textAnchor="middle" letterSpacing="2.5">A TRUER GOLF HANDICAP</text>
            <rect x="0" y="0" width="300" height="400" rx="22" fill="none" stroke="rgba(232,184,75,0.45)" strokeWidth="2"/>
          </svg>
        </div>
        <button className="auth-btn-primary" style={{...S.btnPrimary, background:'linear-gradient(135deg,#e8b84b,#c49a30)', color:'#0d1b2e'}} onClick={()=>{clearFields();setMode('login');}}>Log In</button>
        <button className="auth-btn-ghost" style={S.btnGhost} onClick={()=>{ if(window.Capacitor?.isNativePlatform?.()) { clearFields(); setMode('signup'); } else window.location.href='https://app.dtmhandicap.com/?screen=signup'; }}>Become a Member</button>
      </div>
      {reactivationReturn && /iPhone|iPad|iPod/.test(navigator.userAgent) && (
        <div style={{position:'fixed',inset:0,zIndex:100,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
          <div style={{position:'absolute',inset:0,background:'rgba(5,12,25,0.72)'}} onClick={onReactivationDismiss} />
          <div style={{position:'relative',background:'#0d1b2e',borderTop:'1px solid rgba(232,184,75,0.25)',borderRadius:'16px 16px 0 0',padding:'28px 24px calc(36px + env(safe-area-inset-bottom))'}}>
            <div style={{width:36,height:3,background:'rgba(245,240,232,0.15)',borderRadius:2,margin:'0 auto 24px'}} />
            <div style={{fontSize:9,letterSpacing:3,textTransform:'uppercase',color:'rgba(245,240,232,0.35)',textAlign:'center',marginBottom:10}}>Down The Middle</div>
            <div style={{fontSize:16,fontWeight:700,color:'#f5f0e8',textAlign:'center',marginBottom:20,letterSpacing:0.5}}>Your membership is now active</div>
            <button onClick={()=>{ window.location.href='dtmhandicap://payment/reactivated'; }} style={{width:'100%',padding:14,background:'linear-gradient(135deg,#e8b84b,#c49a30)',border:'none',borderRadius:4,color:'#0d1b2e',fontSize:12,fontWeight:900,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>Open the App</button>
            <div style={{display:'flex',alignItems:'center',gap:12,margin:'16px 0'}}>
              <div style={{flex:1,height:1,background:'rgba(245,240,232,0.1)'}} />
              <span style={{fontSize:11,color:'rgba(245,240,232,0.3)',letterSpacing:1}}>or</span>
              <div style={{flex:1,height:1,background:'rgba(245,240,232,0.1)'}} />
            </div>
            <button onClick={()=>{ setMode('login'); onReactivationDismiss(); }} style={{width:'100%',padding:14,background:'none',border:'1px solid rgba(245,240,232,0.12)',borderRadius:4,color:'rgba(245,240,232,0.45)',fontSize:12,fontWeight:700,letterSpacing:2,textTransform:'uppercase',cursor:'pointer'}}>Continue in Browser</button>
          </div>
        </div>
      )}
    </div>
  );

  if (mode === 'signup') return (
    <div className="dtm-app-frame" style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:8}}>
        <button style={S.back} onClick={()=>{clearFields();setMode('landing');}}>← Back</button>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
          <div><label style={S.label}>First Name</label><input style={S.input} placeholder="" value={name} onChange={e=>setName(e.target.value)} /></div>
          <div><label style={S.label}>Last Name</label><input style={S.input} placeholder="" value={lastName} onChange={e=>setLastName(e.target.value)} /></div>
        </div>
        <div style={S.field}><label style={S.label}>Email</label><input style={S.input} placeholder="" type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
        <div style={S.field}><label style={S.label}>Create Password</label><input style={S.input} placeholder="" type="password" value={password} onChange={e=>{setPassword(e.target.value);setError('');}} />{password.length > 0 && password.length < 8 && <div style={{fontSize:11,color:'#e02247',marginTop:5,letterSpacing:0.5}}>Minimum 8 characters required</div>}</div>
        <div style={S.field}><label style={S.label}>Confirm Password</label><input style={S.input} placeholder="" type="password" value={confirmPassword} onChange={e=>{setConfirmPassword(e.target.value);setError('');}} /></div>
        {error && <div style={S.error}>{error}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.7:1}} onClick={handleSignUp} disabled={loading}>{loading?'Creating Account...':'Become a Member'}</button>
        <div style={{...S.switchText,marginTop:30}}>Already a member? <span className="auth-link" style={{color:'#e8b84b',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{clearFields();setMode('login');}}>Log in</span></div>
      </div>
    </div>
  );

  if (mode === 'login') return (
    <div className="dtm-app-frame" style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      {showOpenInApp && (
        <div style={{position:'fixed',inset:0,zIndex:100,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
          <div style={{position:'absolute',inset:0,background:'rgba(5,12,25,0.72)'}} onClick={()=>{ onEmailLinkClear?.(); }} />
          <div style={{position:'relative',background:'#0d1b2e',borderTop:'1px solid rgba(232,184,75,0.25)',borderRadius:'16px 16px 0 0',padding:'28px 24px calc(36px + env(safe-area-inset-bottom))'}}>
            <div style={{width:36,height:3,background:'rgba(245,240,232,0.15)',borderRadius:2,margin:'0 auto 24px'}} />
            <div className="font-verdana" style={{fontSize:9,letterSpacing:3,textTransform:'uppercase',color:'rgba(245,240,232,0.35)',textAlign:'center',marginBottom:10}}>Down The Middle</div>
            <div className="font-verdana" style={{fontSize:16,fontWeight:700,color:'#f5f0e8',textAlign:'center',marginBottom:20,letterSpacing:0.5}}>For the best experience</div>
            <button onClick={()=>{ onEmailLinkClear?.(); window.location.href = 'dtmhandicap://'; }} style={{width:'100%',padding:14,background:'linear-gradient(135deg,#e8b84b,#c49a30)',border:'none',borderRadius:4,color:'#0d1b2e',fontSize:12,fontWeight:900,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>Open in the App</button>
            <div style={{display:'flex',alignItems:'center',gap:12,margin:'16px 0'}}>
              <div style={{flex:1,height:1,background:'rgba(245,240,232,0.1)'}} />
              <span style={{fontSize:11,color:'rgba(245,240,232,0.3)',letterSpacing:1}}>or</span>
              <div style={{flex:1,height:1,background:'rgba(245,240,232,0.1)'}} />
            </div>
            <button onClick={()=>{ onEmailLinkClear?.(); }} style={{width:'100%',padding:14,background:'none',border:'1px solid rgba(245,240,232,0.12)',borderRadius:4,color:'rgba(245,240,232,0.45)',fontSize:12,fontWeight:700,letterSpacing:2,textTransform:'uppercase',cursor:'pointer'}}>Continue in Browser</button>
          </div>
        </div>
      )}
      <div style={{...S.body, paddingTop:8}}>
        <button style={S.back} onClick={()=>{clearFields();setMode('landing');}}>← Back</button>
        <div style={S.field}>
          <label style={S.label}>Member #</label>
          <MemberNumberInput value={memberNumber} onChange={setMemberNumber} inputStyle={S.input} />
        </div>
        <div style={S.field}><label style={S.label}>Password</label><input style={{...S.input,colorScheme:'dark'}} placeholder="" type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleLogin()} /></div>
        {verifySuccess&&<div style={{...S.success,marginBottom:4}}>Email verified — please log in</div>}
        {error && <div style={S.error}>{error}</div>}
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleLogin} disabled={loading}>{loading?'Logging In...':'Log In'}</button>
        <div style={{textAlign:'center',marginTop:30,display:'flex',justifyContent:'center',gap:16}}>
          <span className="auth-link" style={{fontSize:11,color:'#e8b84b',cursor:'pointer',letterSpacing:1,textDecoration:'underline'}} onClick={()=>{clearFields();setMode('forgotMember');}}>Forgot Member #</span>
          <span style={{fontSize:11,color:'rgba(245,240,232,0.2)'}}>|</span>
          <span className="auth-link" style={{fontSize:11,color:'#e8b84b',cursor:'pointer',letterSpacing:1,textDecoration:'underline'}} onClick={()=>{clearFields();setMode('forgot');}}>Forgot Password</span>
        </div>
        <div style={{...S.switchText,marginTop:20,marginLeft:-12}}>Not a member? <span className="auth-link" style={{color:'#e8b84b',cursor:'pointer',textDecoration:'underline'}} onClick={()=>{ if(window.Capacitor?.isNativePlatform?.()) { clearFields(); setMode('signup'); } else window.location.href='https://app.dtmhandicap.com/?screen=signup'; }}>Become one</span></div>
      </div>
    </div>
  );

  if (mode === 'confirm') return (
    <div className="dtm-app-frame" style={S.wrap}>
      <style>{globalStyles}</style>
      <Header/>
      <div style={S.body}>
        <div style={{textAlign:'center',padding:'7px 0 28px'}}>
          <div style={{fontSize:14,fontWeight:700,color:'#e8b84b',letterSpacing:3,textTransform:'uppercase',marginBottom:20}}>Check Your Email</div>
          <div style={{fontSize:14,color:'rgba(245,240,232,0.55)',lineHeight:1.9,marginBottom:24}}>
            A verification link was sent to:<br/>
            <span style={{color:'#f5f0e8',fontWeight:600}}>{pendingEmail}</span>
          </div>
          <div style={{marginBottom:24}} />
          <div style={{fontSize:10,color:'rgba(245,240,232,0.3)',letterSpacing:1}}>If you did not receive this email, please check your spam folder</div>
        </div>
      </div>
    </div>
  );

  if (mode === 'onboarding') return (
    <div className="dtm-app-frame" style={S.wrap}>
      <style>{globalStyles}</style>
      <AppHeader />
      <div style={{flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-start', padding:'20px 28px 40px'}}>
        <div style={{display:'flex', flexDirection:'column', gap:22}}>
          <p style={{margin:0, fontSize:18, color:'#e8b84b', lineHeight:1.75, fontWeight:700, textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>Welcome, {pendingUser?.name}!</p>
          <p style={{margin:0, fontSize:14.5, color:'rgba(245,240,232,0.9)', lineHeight:1.75, fontWeight:400}}>
            Thank you for becoming a member. Below you will find your member # — please save it. It will be used to log in to your account.
          </p>
          <div style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:4,padding:'18px 16px',textAlign:'center'}}>
            <div style={{fontSize:28,fontWeight:900,color:'#e8b84b',letterSpacing:2}}>{pendingUser?.memberNumber}</div>
          </div>
          <p style={{margin:0, marginTop:3, fontSize:14.5, color:'rgba(245,240,232,0.9)', lineHeight:1.75, fontWeight:400}}>
            <span style={{color:'#e8b84b', fontWeight:700}}>Note:</span> As a first time user, you're encouraged to post as many of your prior rounds as you'd like, up to 18 months back. Doing so will provide our model with as much data as possible — enabling us to deliver you an accurate handicap as soon as possible.
          </p>
          <button className="auth-btn-primary" style={{width:'100%', padding:16, background:'linear-gradient(135deg,#e8b84b,#c49a30)', border:'none', borderRadius:3, color:'#0d1b2e', fontSize:13, fontWeight:900, letterSpacing:4, textTransform:'uppercase', cursor:'pointer', marginTop:13}} onClick={()=>{clearFields();setMemberNumber(pendingUser?.memberNumber||'');setMode('login');}}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  );

  if (mode === 'forgot') return (
    <div className="dtm-app-frame" style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:8}}>
        <button style={{...S.back, marginBottom:20}} onClick={()=>{clearFields();setMode('login');}}>← Back</button>
        <div style={{fontSize:14,color:'rgba(245,240,232,0.5)',marginBottom:20,lineHeight:1.6}}>An email with a link to reset your password will be sent to the address below:</div>
        <div style={S.field}><label style={S.label}>Email</label><input style={{...S.input,colorScheme:'dark'}} placeholder="" type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} /></div>
        {error && <div style={S.error}>{error}</div>}
        
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleForgotPassword} disabled={loading}>{loading?'Sending...':'Send Reset Link'}</button>
      </div>
    </div>
  );

  if (mode === 'forgotMember') return (
    <div className="dtm-app-frame" style={S.wrap}>
      <style>{globalStyles}</style>
      <Header />
      <div style={{...S.body, paddingTop:8}}>
        <button style={{...S.back, marginBottom:20}} onClick={()=>{clearFields();setMode('login');}}>← Back</button>
        <div style={{fontSize:14,color:'rgba(245,240,232,0.5)',marginBottom:20,lineHeight:1.6}}>An email with your Member # will be sent to the<br/>address below:</div>
        <div style={S.field}><label style={S.label}>Email</label><input style={{...S.input,colorScheme:'dark'}} placeholder="" type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
        {error && <div style={S.error}>{error}</div>}
        
        <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleForgotMemberNumber} disabled={loading}>{loading?'Sending...':'Send Member #'}</button>
      </div>
    </div>
  );

  if (mode === 'resetPassword') {
    const handleResetPassword = async () => {
      if (!password || !confirmPassword) return setError('Please fill in both fields');
      if (password.length < 8) return setError('Password must be at least 8 characters');
      if (password !== confirmPassword) return setError('Passwords do not match');
      setLoading(true); setError('');
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${resetToken}` },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) { setLoading(false); const errText = String(data.message || data.msg || data.error_description || '').toLowerCase(); const isSamePw = data.code === 'same_password' || data.error_code === 'same_password' || errText.includes('different') || errText.includes('same'); return setError(isSamePw ? 'Please choose a different password' : (data.message || data.msg || 'Failed to reset password')); }
        // Send confirmation email
        try {
          const userEmail = data.email || data.user_metadata?.email;
          if (userEmail) {
            await fetch(`${API_BASE}/api/send-auth-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'password_changed', email: userEmail }),
            });
          }
        } catch {}
        onResetComplete();
        clearFields();
        setMode('login');
      } catch { setError('Something went wrong'); }
      setLoading(false);
    };
    return (
      <div className="dtm-app-frame" style={S.wrap}>
        <style>{globalStyles}</style>
        <Header />
        <div style={{...S.body, paddingTop:8}}>
          <div style={{fontSize:14,color:'rgba(245,240,232,0.5)',marginBottom:20,lineHeight:1.6}}>Create your new password:</div>
          <div style={S.field}><label style={S.label}>New Password</label><input style={{...S.input,colorScheme:'dark'}} placeholder="" type="password" value={password} onChange={e=>{setPassword(e.target.value);setError('');}} />{password.length > 0 && password.length < 8 && <div style={{fontSize:11,color:'#e02247',marginTop:5,letterSpacing:0.5}}>Minimum 8 characters required</div>}</div>
          <div style={S.field}><label style={S.label}>Confirm Password</label><input style={{...S.input,colorScheme:'dark'}} placeholder="" type="password" value={confirmPassword} onChange={e=>{setConfirmPassword(e.target.value);setError('');}} /></div>
          {error && <div style={S.error}>{error}</div>}
          <button className="auth-btn-primary" style={{...S.btnPrimary, opacity:loading?0.5:1}} onClick={handleResetPassword} disabled={loading}>{loading?'Saving...':'Set New Password'}</button>
        </div>
      </div>
    );
  }
}

function displayName(name, lastN) {
  if (!lastN) return name;
  const formatPart = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const formatted = lastN.trim().split(' ').map(word =>
    word.split('-').map(formatPart).join('-')
  ).join(' ');
  return `${name} ${formatted}`;
}

function PartnerRow({ p, prof, otherId, handicaps, partnerRoundCounts, onRemove, onCancelRemove, rowStyle }) {
  const [active, setActive] = useState(false);
  const hcp = handicaps[otherId];
  const hcpDisplay = hcp===undefined||hcp===null ? '—' : hcp<0 ? `+${Math.abs(hcp)}` : String(hcp);
  const pRounds = partnerRoundCounts?.[otherId] ?? null;
  const showAsterisk = pRounds !== null && pRounds >= 10 && pRounds < 18;

  useEffect(()=>{ setActive(false); },[onCancelRemove]);

  return (
    <div
      style={{...rowStyle, position:'relative', alignItems:'center', padding:'14px'}}
      onClick={()=>setActive(v=>!v)}>
      {active&&(
        <button onClick={e=>{e.stopPropagation();onRemove();}} style={{position:'absolute',top:-7,right:-7,width:16,height:16,borderRadius:'50%',background:'#e02247',border:'2px solid #0d1b2e',color:'#fff',fontSize:10,cursor:'pointer',lineHeight:1,padding:0,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',zIndex:10}}>✕</button>
      )}
      <div style={{flex:1}}>
        <div style={{fontSize:13,color:'#f5f0e8',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{prof ? displayName(prof.name, prof.last_name) : '...'}</div>
        <div style={{fontSize:9,color:'rgba(201,168,76,0.6)',letterSpacing:1,marginTop:2}}>{prof?.member_number||''}</div>
      </div>
      <div style={{width:64,textAlign:'center',flexShrink:0}}>
        <div style={{position:'relative',display:'inline-block'}}>
          <div style={{fontSize:28,fontWeight:800,color:'#e8b84b',lineHeight:1,letterSpacing:-1}}>{hcpDisplay}</div>
          {showAsterisk&&<span style={{position:'absolute',top:0,right:-10,fontSize:16,color:'#e8b84b',lineHeight:1,fontWeight:700}}>*</span>}
        </div>
        <div style={{fontSize:7,fontWeight:400,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.5)',marginTop:3}}>Handicap</div>
      </div>
    </div>
  );
}

function EntryRow({ entry }) {
  const color = entry.trend === 'hot' ? '#84e040' : '#e02247';
  const streak = entry.streak || 3;
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,marginBottom:6}}>
      <div style={{fontSize:13,color:'#f5f0e8',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:160}}>
        {displayName(entry.name, entry.lastName)}
        {entry.isUser && <span style={{fontSize:9,color:'rgba(201,168,76,0.5)',letterSpacing:1,marginLeft:6}}>YOU</span>}
      </div>
      <div style={{width:64,textAlign:'center',flexShrink:0}}>
          <div style={{fontSize:7,fontWeight:400,letterSpacing:2,textTransform:'uppercase',color:'rgba(232,184,75,0.6)',marginBottom:3}}>Streak</div>
          <div style={{fontSize:22,fontWeight:800,color,lineHeight:1}}>{streak}</div>
        </div>
    </div>
  );
}

// ─── Hot / Not Section ────────────────────────────────────────────────────────
function calcStreak(rounds) {
  // Returns { trend: 'hot'|'not'|'neutral', streak: number }
  if (!rounds || rounds.length < 11) return { trend: 'neutral', streak: 0 };
  const getHcp = (subset) => {
    return calcHandicapDecimalAllTime(subset);
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

  const hot = allEntries.filter(e => e.trend === 'hot').sort((a,b) => b.streak - a.streak);
  const not = allEntries.filter(e => e.trend === 'not').sort((a,b) => b.streak - a.streak);

  const InfoIcon = ({ text }) => (
    <span className="info-tooltip" onClick={e=>{e.stopPropagation();e.currentTarget.classList.toggle('active');}} style={{marginLeft:4}}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="rgba(245,240,232,0.7)" strokeWidth="1.5"/><line x1="12" y1="11" x2="12" y2="17" stroke="rgba(245,240,232,0.7)" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="7" r="1" fill="rgba(245,240,232,0.7)"/></svg>
      <span className="tooltip-text">{text}</span>
    </span>
  );

  const hasPartners = partners.length > 0;
  const hasPersonalStreak = userResult.trend === 'hot' || userResult.trend === 'not';
  if (!hasPartners && !hasPersonalStreak) return null;

  return (
    <div style={{marginTop:20}}>
      <div style={{height:1,background:'rgba(201,168,76,0.2)',marginBottom:16}}/>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10,paddingLeft:4}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#84e040'}}>Who's Hot</div>
          <span style={{fontSize:14,lineHeight:1}}>🔥</span>
          <InfoIcon text={<>Consecutive rounds handicap<br/>has decreased (min. 3)</>} />
        </div>
        {hot.length === 0
          ? hasPartners && <div style={{fontSize:11,color:'rgba(245,240,232,0.2)',fontStyle:'italic',paddingLeft:4}}>Somebody needs to get it going!</div>
          : hot.map(e => <EntryRow key={e.id} entry={e} />)
        }
      </div>
      <div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10,paddingLeft:4}}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#e02247'}}>Who's Not</div>
          <span style={{fontSize:14,lineHeight:1}}>❄️</span>
          <InfoIcon text={<>Consecutive rounds handicap<br/>has increased (min. 3)</>} />
        </div>
        {not.length === 0
          ? hasPartners && <div style={{fontSize:11,color:'rgba(245,240,232,0.2)',fontStyle:'italic',paddingLeft:4}}>Keep up the low scoring!</div>
          : not.map(e => <EntryRow key={e.id} entry={e} />)
        }
      </div>
    </div>
  );
}

// ─── Partners Panel ────────────────────────────────────────────────────────────
function PartnersPanel({ user, partners, partnerRequests, sentRequests, trends, streaks, setTrends, setStreaks, handicaps, setHandicaps, partnerRoundCounts, setPartnerRoundCounts, userRounds, partnerSearch, setPartnerSearch, searchResults, searchUsers, searchLoading, partnerLoading, sendRequest, respondToRequest, removePartner, fetchPartners, onBack, drawerAuthHeaders, SUPABASE_URL, inline }) {
  const [profiles, setProfiles] = useState({});
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [cancelToken, setCancelToken] = useState(0);
  const [confirmDeleteRequest, setConfirmDeleteRequest] = useState(null);
  const [tappedRequest, setTappedRequest] = useState(null);
  const [partnersCollapsed, setPartnersCollapsed] = useState(true);
  const [sortedPartners, setSortedPartners] = useState([]);


  useEffect(() => {
    const loadProfiles = async () => {
      const ids = [
        ...partners.map(p => p.requester_id === user.id ? p.recipient_id : p.requester_id),
        ...partnerRequests.map(p => p.requester_id),
        ...(sentRequests||[]).map(p => p.recipient_id),
      ].filter((id, i, a) => a.indexOf(id) === i);
      if (ids.length > 0) {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,name,last_name,member_number`, { headers: await drawerAuthHeaders() });
          if (res.ok) {
            const profs = await res.json();
            if (Array.isArray(profs)) {
              const map = {};
              profs.forEach(p => { map[p.id] = p; });
              setProfiles(map);
              // Sort partners now that we have all profiles
              const sorted = [...partners].sort((a,b) => {
                const pa = map[a.requester_id === user.id ? a.recipient_id : a.requester_id];
                const pb = map[b.requester_id === user.id ? b.recipient_id : b.requester_id];
                const la = (pa?.last_name || pa?.name || '').toLowerCase();
                const lb = (pb?.last_name || pb?.name || '').toLowerCase();
                if (la !== lb) return la < lb ? -1 : 1;
                const na = (pa?.name || '').toLowerCase();
                const nb = (pb?.name || '').toLowerCase();
                return na < nb ? -1 : na > nb ? 1 : 0;
              });
              setSortedPartners(sorted);
            }
          }
        } catch {}
      }
      // Load handicaps and trends for accepted partners
      const partnerIds = partners.map(p => p.requester_id === user.id ? p.recipient_id : p.requester_id);
      for (const id of partnerIds) {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rounds?user_id=eq.${id}&select=differential,score,rating,slope,date&order=date.desc`, { headers: await drawerAuthHeaders() });
          if (res.ok) {
            const rounds = await res.json();
            if (Array.isArray(rounds)) {
              const hcp = calcHandicap(rounds);
              setHandicaps(prev => ({ ...prev, [id]: hcp }));
              setPartnerRoundCounts(prev => ({ ...prev, [id]: rounds.length }));
              // Calculate trend using calcStreak
              const result = calcStreak(rounds);
              setTrends(prev => ({ ...prev, [id]: result.trend }));
              setStreaks(prev => ({ ...prev, [id]: result }));
            }
          }
        } catch {}
      }
    };
    loadProfiles();
  }, [partners]);

  const rowStyle = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 14px', background:'rgba(8,18,36,0.6)', border:'1px solid rgba(201,168,76,0.13)', borderRadius:4, marginBottom:8 };
  const labelStyle = { fontSize:7, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.6)', marginBottom:3, display:'block', paddingLeft:4 };
  const inputStyle = { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'9px 10px 9px 10px', color:'#f5f0e8', fontSize:13, outline:'none', width:'100%' };
  const btnSm = (color) => ({ padding:'5px 10px', background:color==='red'?'linear-gradient(135deg,#c41e3a,#9e1830)':color==='green'?'linear-gradient(135deg,#4caa18,#2d7a0e)':'transparent', border:color==='ghost'?'1px solid rgba(201,168,76,0.3)':'none', borderRadius:3, color:'#f5f0e8', fontSize:9, fontWeight:700, letterSpacing:2, textTransform:'uppercase', cursor:'pointer' });

  const alreadyPartner = (id) => partners.some(p => p.requester_id === id || p.recipient_id === id) || (sentRequests||[]).some(p => p.recipient_id === id);

  if (inline) return (
    <div style={{padding:'16px 20px'}}>

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
                      style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',background:'rgba(8,18,36,0.6)',cursor:isPartner?'default':'pointer'}}>
                      <div>
                        <div style={{fontSize:14,color:'#f5f0e8',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.last_name ? displayName(r.name, r.last_name) : r.name}</div>
                        <div style={{fontSize:9,color:'rgba(201,168,76,0.6)',letterSpacing:1,marginTop:2}}>{r.member_number}</div>
                      </div>
                      {isPartner
                        ? <span style={{fontSize:9,color:'rgba(245,240,232,0.3)',letterSpacing:1,textTransform:'uppercase'}}>Already Added</span>
                        : <span style={{fontSize:9,color:'#84e040',letterSpacing:1,textTransform:'uppercase',fontWeight:700}}>{partnerLoading===r.id?'Sending...':'+ Send Request'}</span>
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
                <span style={{width:16,height:16,borderRadius:'50%',background:'#e02247',border:'2px solid #0d1b2e',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff',lineHeight:1,flexShrink:0,fontFamily:'system-ui,sans-serif',letterSpacing:0,textIndent:0}}>!</span>
              </div>
              {partnerRequests.map(req=>{
                const p=profiles[req.requester_id];
                return(
                  <div key={req.id} style={{...rowStyle,flexDirection:'column',alignItems:'flex-start',gap:10}}>
                    <div>
                      <div style={{fontSize:13,color:'#f5f0e8',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p ? displayName(p.name, p.last_name) : '...'}</div>
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
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',marginBottom:10,paddingLeft:4}}>Pending Partners{sentRequests.length >= 2 ? ` (${sentRequests.length})` : ''}</div>
              {sentRequests.map(req=>{
                const p=profiles[req.recipient_id];
                return(
                  <div key={req.id} onClick={()=>setTappedRequest(tappedRequest===req.id?null:req.id)} style={{...rowStyle,alignItems:'center',position:'relative',cursor:'pointer'}}>
                    {tappedRequest===req.id&&(
                      <button onClick={e=>{e.stopPropagation();setTappedRequest(null);setConfirmDeleteRequest(req.id);}} style={{position:'absolute',top:-7,right:-7,width:16,height:16,borderRadius:'50%',background:'#e02247',border:'2px solid #0d1b2e',color:'#fff',fontSize:10,cursor:'pointer',lineHeight:1,padding:0,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',zIndex:10}}>✕</button>
                    )}
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:'rgba(245,240,232,0.9)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p ? displayName(p.name, p.last_name) : '...'}</div>
                      <div style={{fontSize:9,color:'rgba(201,168,76,0.4)',letterSpacing:1}}>{p?.member_number||''}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Partners list */}
          <div style={{height:1,background:'rgba(201,168,76,0.2)',margin:'4px 0 16px'}}/>
          <div>
            <div onClick={()=>partners.length>=4&&setPartnersCollapsed(c=>!c)} style={{display:'flex',alignItems:'center',marginBottom:partnersCollapsed&&partners.length>=4?0:10,paddingLeft:4,cursor:partners.length>=4?'pointer':'default',gap:10}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.75)'}}>Partners ({partners.length})</div>
              {partners.length>=4&&(
                <span style={{fontSize:14,color:'rgba(201,168,76,0.75)',transform:partnersCollapsed?'none':'rotate(90deg)',transition:'transform 0.2s ease',lineHeight:1}}>›</span>
              )}
            </div>
            {(partners.length<4||!partnersCollapsed)&&(
              partners.length===0
                ? null
                : (sortedPartners.length > 0 ? sortedPartners : partners).map(p=>{
                    const otherId=p.requester_id===user.id?p.recipient_id:p.requester_id;
                    const prof=profiles[otherId];
                    return(
                      <PartnerRow key={p.id} p={p} prof={prof} otherId={otherId} handicaps={handicaps} partnerRoundCounts={partnerRoundCounts} onRemove={()=>setConfirmRemove(p.id)} onCancelRemove={cancelToken} rowStyle={rowStyle} />
                    );
                  })
            )}
          </div>

          {/* Who's Hot / Who's Not */}
          <HotNotSection user={user} partners={partners} profiles={profiles} trends={trends} streaks={streaks} handicaps={handicaps} userRounds={userRounds} />
          {confirmRemove&&(
          <div onClick={()=>{setConfirmRemove(null);setCancelToken(t=>t+1);}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'28px 24px',maxWidth:320,width:'90%',textAlign:'center'}}>
              <div style={{fontSize:12,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:16}}>Remove Partner</div>
              <div style={{fontSize:14,color:'rgba(245,240,232,0.7)',marginBottom:20,lineHeight:1.8}}>Are you sure you want<br/>to remove this partner?</div>
              <div style={{display:'flex',flexDirection:'column',gap:11}}>
                <button onClick={()=>{removePartner(confirmRemove);setConfirmRemove(null);}} style={{...btnSm('red'),width:'100%',padding:10,fontSize:11,fontWeight:700,transition:'filter 0.15s ease'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.2)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>Yes, Remove</button>
                <button onClick={()=>{setConfirmRemove(null);setCancelToken(t=>t+1);}} style={{width:'100%',padding:10,background:'transparent',border:'1px solid rgba(201,168,76,0.3)',borderRadius:3,color:'#e8b84b',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>Cancel</button>
              </div>
            </div>
          </div>
          )}
          {confirmDeleteRequest&&(
          <div onClick={()=>{setConfirmDeleteRequest(null);setTappedRequest(null);}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'28px 24px',maxWidth:320,width:'90%',textAlign:'center'}}>
              <div style={{fontSize:12,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:16}}>Delete Request</div>
              <div style={{fontSize:14,color:'rgba(245,240,232,0.7)',marginBottom:20,lineHeight:1.8}}>Are you sure you want<br/>to delete this request?</div>
              <div style={{display:'flex',flexDirection:'column',gap:11}}>
                <button onClick={()=>{removePartner(confirmDeleteRequest);setConfirmDeleteRequest(null);}} style={{...btnSm('red'),width:'100%',padding:10,fontSize:11,fontWeight:700,transition:'filter 0.15s ease'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.2)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>Yes, Delete</button>
                <button onClick={()=>{setConfirmDeleteRequest(null);setTappedRequest(null);}} style={{width:'100%',padding:10,background:'transparent',border:'1px solid rgba(201,168,76,0.3)',borderRadius:3,color:'#e8b84b',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>Cancel</button>
              </div>
            </div>
          </div>
          )}
    </div>
  );
}

// ─── Support Panel ─────────────────────────────────────────────────────────────
function SupportPanel({ user, onBack, onHome }) {
  const [form, setForm] = useState({ name: user.name + (user.lastName ? ' ' + user.lastName : ''), message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!form.message.trim()) return setError('Please enter a message');
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/send-support-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, email: user.email, memberNumber: user.memberNumber, message: form.message }),
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
  const inputStyle = { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'9px 10px', color:'#f5f0e8', fontSize:13, outline:'none', width:'100%', WebkitTextFillColor:'#f5f0e8' };

  return (
    <>
      <div onClick={onBack} style={{position:'fixed',inset:0,background:'#0d1b2e',zIndex:200}} />
      <div className="dtm-app-frame" style={{position:'fixed',top:0,bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'#0d1b2e',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)',padding:'16px 20px 14px',flexShrink:0}}>
          <div style={{marginBottom:4}}>
            <button onClick={onBack} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0}}>← Back</button>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:18}}>Support</div>
        </div>
        <div style={{height:2,background:'rgba(201,168,76,0.45)',flexShrink:0}} />
        <div style={{flex:1,overflowY:'auto',padding:'20px'}}>
          {sent ? (
            <div style={{textAlign:'center',padding:'16px 0',display:'flex',flexDirection:'column',alignItems:'center',gap:16}}>
              <div style={{display:'flex',alignItems:'center',gap:7}}>
                <div style={{fontSize:13,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#f5f0e8'}}>Message Sent</div>
                <div style={{fontSize:22,color:'#84e040',lineHeight:1,position:'relative',top:'-3px'}}>✓</div>
              </div>
              <div style={{fontSize:13,color:'rgba(245,240,232,0.5)',lineHeight:1.7,textAlign:'center',marginTop:0}}>Thank you for your message.<br/>You will receive a reply as soon as possible!</div>
              <button onClick={()=>{window.scrollTo(0,0);onHome();}} style={{marginTop:14,background:'linear-gradient(135deg,#e8b84b,#c49a30)',border:'none',borderRadius:3,padding:'12px 32px',color:'#0d1b2e',fontSize:11,fontWeight:900,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>Home</button>
            </div>
          ) : (
            <>
              <div style={{fontSize:13,color:'#f5f0e8',fontWeight:400,lineHeight:1.7,marginBottom:20}}>
                <div>Have an issue or a question?</div>
                <div>Send us a message in the form provided below:</div>
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
                <label style={{...labelStyle,marginBottom:6,display:'block'}}>Email</label>
                <input style={{...inputStyle,opacity:0.6}} value={user.email} readOnly />
              </div>
              <div style={{marginBottom:15}}>
                <label style={labelStyle}>Message</label>
                <textarea style={{...inputStyle,minHeight:120,resize:'vertical',lineHeight:1.6}} placeholder="" value={form.message} onChange={e=>setForm(p=>({...p,message:e.target.value}))} />
                {error && <div style={{fontSize:11,color:'#e02247',letterSpacing:1,marginTop:6}}>{error}</div>}
              </div>
              <button onClick={handleSubmit} disabled={sending} className="signout-btn" style={{width:'100%',padding:12,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',opacity:sending?0.5:1}}>
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
function ProfileDrawer({ user, roundCount, handicap, userRounds, authHeadersAsync, onClose, onSignOut, onAccountDeleted, onPartnerUpdate, onHome, onUserUpdate }) {
  const [subPanel, setSubPanel] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [portalLoading, setPortalLoading] = useState(false);
  const [showIAPMessage, setShowIAPMessage] = useState(false);

  const [emailForm, setEmailForm] = useState({ next:'', confirm:'' });
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  const [pwForm, setPwForm] = useState({ current:'', next:'', confirm:'' });
  const [showPwForm, setShowPwForm] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const scrollContainerRef = useRef(null);
  const scrollInputIntoView = (e) => {
    const input = e.target;
    const attempt = () => {
      const container = scrollContainerRef.current;
      if (!container || !input) return;
      const inputRect = input.getBoundingClientRect();
      const visibleHeight = window.visualViewport?.height || (window.innerHeight - 300);
      const visibleBottom = visibleHeight - 24;
      if (inputRect.bottom > visibleBottom) {
        container.scrollTop += (inputRect.bottom - visibleBottom + 24);
      }
    };
    setTimeout(attempt, 350);
    setTimeout(attempt, 650);
  };

  useEffect(() => {
    if (!showPwForm) return;
    const attempt = () => {
      const container = scrollContainerRef.current;
      const el = pwFormRef.current;
      if (!container || !el) return;
      const cTop = container.getBoundingClientRect().top;
      const eTop = el.getBoundingClientRect().top;
      const delta = (eTop - cTop) - 8;
      if (delta > 0) container.scrollTop += delta;
    };
    const t1 = setTimeout(attempt, 150);
    const t2 = setTimeout(attempt, 450);
    const t3 = setTimeout(attempt, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [showPwForm]);

const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const anonHeaders = { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY };
  const authHeaders = () => {
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${s?.access_token || SUPABASE_ANON_KEY}` };
    } catch { return anonHeaders; }
  };

  const handlePasswordChange = async () => {
    setPwError(''); setPwSuccess('');
    if (!pwForm.current) return setPwError('Please enter your current password');
    if (pwForm.next.length < 8) return setPwError('New password must be at least 8 characters');
    if (pwForm.next !== pwForm.confirm) return setPwError('New passwords do not match');
    setPwLoading(true);
    // Re-authenticate to verify current password
    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: anonHeaders,
      body: JSON.stringify({ email: user.email, password: pwForm.current }),
    });
    if (!verifyRes.ok) { setPwLoading(false); return setPwError('Current password is incorrect.'); }
    const verifyData = await verifyRes.json();
    const { access_token, refresh_token, expires_at, user: verifyUser } = verifyData;
    // Update password
    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${access_token}` },
      body: JSON.stringify({ password: pwForm.next }),
    });
    if (!updateRes.ok) { const d = await updateRes.json().catch(()=>({})); const errText = String(d.message||d.msg||d.error_description||'').toLowerCase(); const isSame = d.code==='same_password'||d.error_code==='same_password'||errText.includes('different')||errText.includes('same'); setPwLoading(false); return setPwError(isSame ? 'Please choose a different password' : 'Failed to update password. Please try again.'); }
    // Save the refreshed session so the old token doesn't expire the user out
    try {
      const existing = JSON.parse(localStorage.getItem('sb-session') || '{}');
      localStorage.setItem('sb-session', JSON.stringify({ ...existing, access_token, refresh_token, expires_at, user: verifyUser || existing.user }));
    } catch {}
    setPwSuccess('Password changed');
    setPwForm({ current:'', next:'', confirm:'' });
    setPwLoading(false);
    setTimeout(() => { setPwSuccess(''); setShowPwForm(false); }, 1500);
    try {
      await fetch(`${API_BASE}/api/send-auth-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'password_changed', email: user.email }),
      });
    } catch {}
  };

  const handleEmailChange = async () => {
    setEmailError(''); setEmailSuccess('');
    if (!emailForm.next.trim()) return setEmailError('Please enter a new email address');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailForm.next.trim())) return setEmailError('Please enter a valid email address');
    if (emailForm.next.trim().toLowerCase() === user.email.toLowerCase()) return setEmailError('New email must be different from your current email');
    if (emailForm.next.trim() !== emailForm.confirm.trim()) return setEmailError('Email addresses do not match');
    setEmailLoading(true);
    try {
      const s = JSON.parse(localStorage.getItem('sb-session') || 'null');
      if (!s?.access_token) { setEmailError('Session expired — please log in again.'); setEmailLoading(false); return; }
      const res = await fetch(`${API_BASE}/api/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${s.access_token}` },
        body: JSON.stringify({ userId: user.id, newEmail: emailForm.next.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) { setEmailError(data.error || 'Failed to update email. Please try again.'); setEmailLoading(false); return; }
      const newEmail = emailForm.next.trim().toLowerCase();
      setEmailSuccess('Email updated');
      setEmailForm({ next:'', confirm:'' });
      setEmailLoading(false);
      onUserUpdate?.({ ...user, email: newEmail });
      setTimeout(() => { setEmailSuccess(''); setShowEmailForm(false); }, 1500);
    } catch {
      setEmailError('Something went wrong — please try again.');
      setEmailLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE' || deleteLoading) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const s = JSON.parse(localStorage.getItem('sb-session') || 'null');
      if (!s?.access_token) { setDeleteError('Session expired — please log in again.'); setDeleteLoading(false); return; }
      const res = await fetch(`${API_BASE}/api/delete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.access_token}` },
        body: JSON.stringify({ userId: s.user.id }),
      });
      const data = await res.json();
      if (!res.ok) { setDeleteError(data.error || 'Deletion failed — please try again.'); setDeleteLoading(false); return; }
      localStorage.removeItem('sb-session');
      sessionStorage.removeItem('dtm-reset-token');
      onAccountDeleted();
    } catch {
      setDeleteError('Something went wrong — please try again.');
      setDeleteLoading(false);
    }
  };

  const rowStyle = { background:'transparent', borderBottom:'1px solid rgba(201,168,76,0.12)', padding:'12px 4px', marginBottom:0, WebkitTapHighlightColor:'rgba(0,0,0,0)', userSelect:'none' };
  const labelStyle = { fontSize:7, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.6)', marginBottom:4, display:'block' };
  const valueStyle = { fontSize:13, fontWeight:600, color:'#f5f0e8', letterSpacing:0.5 };
  const inputStyle = { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'9px 10px', color:'#f5f0e8', fontSize:13, outline:'none', width:'100%', WebkitTextFillColor:'#f5f0e8' };

  const drawerAuthHeaders = async () => {
    if (authHeadersAsync) return await authHeadersAsync();
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${s?.access_token || SUPABASE_ANON_KEY}` };
    } catch { return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }; }
  };





  if (subPanel === 'membership') return (
    <>
      <div onClick={()=>{setSubPanel(null);setShowPwForm(false);setPwForm({current:'',next:'',confirm:''});setPwError('');setPwSuccess('');}} style={{position:'fixed',inset:0,background:'#0d1b2e',zIndex:200}} />
      <div className="dtm-app-frame" style={{position:'fixed',top:0,bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'#0d1b2e',zIndex:201,display:'flex',flexDirection:'column',overflowY:'auto'}}>
        <div style={{background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)',padding:'16px 20px 14px'}}>
          <button onClick={()=>{setSubPanel(null);}} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0,marginBottom:4}}>← Back</button>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:18}}>Membership & Payment</div>
        </div>
        <div style={{height:2,background:'rgba(201,168,76,0.45)',margin:'0 20px'}} />
        <div style={{padding:'16px 20px',flex:1}}>
          <div style={{background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,padding:'16px 14px',marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)'}}>Status</div>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#84e040',background:'rgba(132,224,64,0.1)',border:'1px solid rgba(132,224,64,0.3)',borderRadius:2,padding:'3px 8px'}}>Active</div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)'}}>Plan</div>
              <div style={{fontSize:12,fontWeight:600,color:'#f5f0e8'}}>Annual — $49.99/yr</div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)'}}>Renews</div>
              <div style={{fontSize:12,fontWeight:600,color:'#f5f0e8'}}>{user.subscriptionRenewsAt ? new Date(user.subscriptionRenewsAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '—'}</div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)'}}>Payment Method</div>
              <div style={{fontSize:12,fontWeight:600,color:'#f5f0e8'}}>{user.paymentProvider === 'apple' ? 'Apple In-App Purchase' : 'Stripe'}</div>
            </div>
          </div>
          <div style={{height:1,background:'rgba(201,168,76,0.08)',marginBottom:16}}/>
          {user.paymentProvider === 'apple' ? (
            <>
              {showIAPMessage && (
                <div onClick={()=>setShowIAPMessage(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
                  <div onClick={e=>e.stopPropagation()} style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'28px 24px',maxWidth:320,width:'90%',textAlign:'center'}}>
                    <div style={{fontSize:12,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:16}}>Manage Membership</div>
                    <div style={{fontSize:14,color:'#f5f0e8',marginBottom:8,lineHeight:1.8}}>App Store subscriptions must be managed through your Apple device.</div>
                    <div style={{fontSize:13,color:'rgba(245,240,232,0.5)',marginBottom:20,lineHeight:1.8}}>Settings → [Your Name] → Subscriptions</div>
                    <button onClick={()=>setShowIAPMessage(false)} onMouseEnter={e=>e.currentTarget.style.background='rgba(201,168,76,0.1)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'} style={{width:'100%',padding:10,background:'transparent',border:'1px solid rgba(201,168,76,0.3)',borderRadius:3,color:'#e8b84b',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>Dismiss</button>
                  </div>
                </div>
              )}
              <button
                onClick={async () => {
                  if (window.Capacitor?.isNativePlatform?.()) {
                    await Browser.open({ url: 'https://apps.apple.com/account/subscriptions' });
                  } else {
                    setShowIAPMessage(true);
                  }
                }}
                className="signout-btn" style={{width:'100%',padding:11,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',marginBottom:12}}
              >
                Manage Membership & Payment
              </button>
            </>
          ) : (
            <>
              <button
                onClick={async () => {
                  if (portalLoading) return;
                  if (!user.stripeCustomerId) return;
                  setPortalLoading(true);
                  try {
                    const res = await fetch(`${API_BASE}/api/create-portal-session`, {
                      method: 'POST',
                      headers: { ...(await authHeadersAsync()), 'Content-Type': 'application/json' },
                      body: JSON.stringify({ customerId: user.stripeCustomerId, returnUrl: 'https://app.dtmhandicap.com' }),
                    });
                    const data = await res.json();
                    if (data.url) {
                      if (window.Capacitor?.isNativePlatform?.()) {
                        await Browser.open({ url: data.url });
                      } else {
                        window.location.href = data.url;
                      }
                    }
                  } catch {}
                  setPortalLoading(false);
                }}
                className="signout-btn" style={{width:'100%',padding:11,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',marginBottom:12}}
              >
                {portalLoading ? 'Loading...' : 'Manage Membership & Payment'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );

  if (subPanel === 'support') return (
    <SupportPanel user={user} onBack={()=>setSubPanel(null)} onHome={()=>{setSubPanel(null);onClose();onHome();}} />
  );

  if (subPanel === 'account' && showEmailForm) return (
    <>
      <div onClick={()=>{setShowEmailForm(false);setEmailError('');setEmailSuccess('');setEmailForm({next:'',confirm:''});}} style={{position:'fixed',inset:0,background:'#0d1b2e',zIndex:200}} />
      <div className="dtm-app-frame" style={{position:'fixed',top:0,bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'#0d1b2e',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)',padding:'16px 20px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
            <button onClick={()=>{setShowEmailForm(false);setEmailError('');setEmailSuccess('');setEmailForm({next:'',confirm:''});}} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0}}>← Back</button>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:18}}>Edit Account Information</div>
        </div>
        <div style={{height:2,background:'rgba(201,168,76,0.45)',margin:'0 20px'}} />
        <div style={{padding:'28px 20px',flex:1,overflowY:'auto'}}>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div><label style={labelStyle}>New Email Address</label><input style={inputStyle} type="email" autoCapitalize="off" autoCorrect="off" value={emailForm.next} onChange={e=>{setEmailForm(p=>({...p,next:e.target.value}));setEmailError('');}} /></div>
            <div><label style={labelStyle}>Confirm New Email Address</label><input style={inputStyle} type="email" autoCapitalize="off" autoCorrect="off" value={emailForm.confirm} onChange={e=>{setEmailForm(p=>({...p,confirm:e.target.value}));setEmailError('');}} /></div>
            {emailError && <div style={{fontSize:11,color:'#e02247',letterSpacing:0.5}}>{emailError}</div>}
            {emailSuccess && <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,letterSpacing:0.5}}><span style={{color:'#84e040'}}>{emailSuccess}</span><span style={{fontSize:16,color:'#84e040',lineHeight:1,position:'relative',top:'-1px'}}>✓</span></div>}
            <button onClick={handleEmailChange} disabled={emailLoading} className="signout-btn" style={{width:'100%',padding:11,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',opacity:emailLoading?0.5:1,marginTop:10}}>
              {emailLoading ? 'Updating...' : 'Change Email Address'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

if (subPanel === 'account' && showDeleteForm) return (
    <>
      <div onClick={()=>{if(!deleteLoading){setShowDeleteForm(false);setDeleteConfirmText('');setDeleteError('');setShowDeleteModal(false);}}} style={{position:'fixed',inset:0,background:'#0d1b2e',zIndex:200}} />
      <div className="dtm-app-frame" style={{position:'fixed',top:0,bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'#0d1b2e',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)',padding:'16px 20px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
            <button onClick={()=>{if(!deleteLoading){setShowDeleteForm(false);setDeleteConfirmText('');setDeleteError('');setShowDeleteModal(false);}}} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0}}>← Back</button>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:18}}>Delete Account</div>
        </div>
        <div style={{height:2,background:'rgba(201,168,76,0.45)',margin:'0 20px'}} />
        <div style={{padding:'28px 20px',flex:1,overflowY:'auto'}}>
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div style={{fontSize:13,color:'rgba(245,240,232,0.7)',lineHeight:1.8,letterSpacing:0.3}}>
              {user?.paymentProvider==='apple'?<>This action is permanent and cannot be undone.<br/>Deleting your account does not automatically cancel<br/>your membership, you must do so in the App Store.</>:<>This action is permanent and cannot be undone.<br/>It will also cancel any active membership that you have.</>}
            </div>
            <button onClick={()=>{setShowDeleteModal(true);setDeleteConfirmText('');setDeleteError('');}} className="signout-btn" style={{width:'100%',padding:11,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>
              Delete Account
            </button>
          </div>
        </div>
      </div>
      {showDeleteModal && (
        <div onClick={()=>{if(!deleteLoading){setShowDeleteModal(false);setDeleteConfirmText('');setDeleteError('');}}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:400,padding:'180px 20px 0'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#0d1b2e',border:'1px solid rgba(201,168,76,0.3)',borderRadius:6,padding:'24px 20px',width:'100%',maxWidth:360,display:'flex',flexDirection:'column',gap:14}}>
            <div style={{fontSize:12,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',textAlign:'center'}}>Delete Account</div>
            <div style={{height:1,background:'rgba(201,168,76,0.2)'}} />
            <div>
              <label style={{fontSize:7,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',marginBottom:6,display:'block'}}>Type DELETE to confirm</label>
              <input style={{...inputStyle,border:'1px solid rgba(201,168,76,0.35)'}} placeholder="" value={deleteConfirmText} onChange={e=>setDeleteConfirmText(e.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </div>
            {deleteError && <div style={{fontSize:11,color:'#e02247',letterSpacing:0.5}}>{deleteError}</div>}
            <button onClick={handleDeleteAccount} disabled={deleteConfirmText!=='DELETE'||deleteLoading} style={{width:'100%',padding:11,background:deleteConfirmText==='DELETE'?'linear-gradient(135deg,#c41e3a,#9e1830)':'rgba(100,20,30,0.4)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:deleteConfirmText==='DELETE'?'pointer':'default',opacity:deleteLoading?0.5:1,transition:'background 0.2s ease'}}>
              {deleteLoading ? 'Deleting...' : 'Delete Account'}
            </button>
            <button onClick={()=>{setShowDeleteModal(false);setDeleteConfirmText('');setDeleteError('');}} disabled={deleteLoading} className="confirm-cancel-btn dtm-label" style={{width:'100%',padding:9,background:'transparent',border:'1px solid rgba(201,168,76,0.3)',borderRadius:3,color:'#e8b84b',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (subPanel === 'account' && showPwForm) return (
    <>
      <div onClick={()=>{setShowPwForm(false);setPwForm({current:'',next:'',confirm:''});setPwError('');setPwSuccess('');}} style={{position:'fixed',inset:0,background:'#0d1b2e',zIndex:200}} />
      <div className="dtm-app-frame" style={{position:'fixed',top:0,bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'#0d1b2e',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)',padding:'16px 20px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
            <button onClick={()=>{setShowPwForm(false);setPwForm({current:'',next:'',confirm:''});setPwError('');setPwSuccess('');}} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0}}>← Back</button>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:18}}>Change Password</div>
        </div>
        <div style={{height:2,background:'rgba(201,168,76,0.45)',margin:'0 20px'}} />
        <div ref={scrollContainerRef} style={{padding:'28px 20px',flex:1,overflowY:'auto'}}>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div><label style={labelStyle}>Current Password</label><input style={inputStyle} type="password" placeholder="" value={pwForm.current} onChange={e=>setPwForm(p=>({...p,current:e.target.value}))} onFocus={scrollInputIntoView}/></div>
            <div><label style={labelStyle}>New Password</label><input style={inputStyle} type="password" placeholder="" value={pwForm.next} onChange={e=>{setPwForm(p=>({...p,next:e.target.value}));setPwError('');}} onFocus={scrollInputIntoView}/>{pwForm.next.length>0&&pwForm.next.length<8&&<div style={{fontSize:11,color:'#e02247',marginTop:5,letterSpacing:0.5}}>Minimum 8 characters required</div>}</div>
            <div style={{marginTop:10}}><label style={labelStyle}>Confirm New Password</label><input style={inputStyle} type="password" placeholder="" value={pwForm.confirm} onChange={e=>{setPwForm(p=>({...p,confirm:e.target.value}));setPwError('');}} onFocus={scrollInputIntoView}/></div>
            {pwError && <div style={{fontSize:11,color:'#e02247',letterSpacing:1}}>{pwError}</div>}
            {pwSuccess && <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,letterSpacing:0.5}}><span style={{color:'#84e040'}}>{pwSuccess}</span><span style={{fontSize:16,color:'#84e040',lineHeight:1,position:'relative',top:'-1px'}}>✓</span></div>}
            <button onClick={handlePasswordChange} disabled={pwLoading} className="signout-btn" style={{width:'100%',padding:11,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',opacity:pwLoading?0.5:1,marginTop:10}}>
              {pwLoading ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  if (subPanel === 'account') return (
    <>
      <div onClick={()=>setSubPanel(null)} style={{position:'fixed',inset:0,background:'#0d1b2e',zIndex:200}} />
      <div className="dtm-app-frame" style={{position:'fixed',top:0,bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'#0d1b2e',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)',padding:'16px 20px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
            <button onClick={()=>{setSubPanel(null);setShowPwForm(false);setPwForm({current:'',next:'',confirm:''});setPwError('');setPwSuccess('');setShowDeleteForm(false);setDeleteConfirmText('');setDeleteError('');}} style={{background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:11,letterSpacing:2,textTransform:'uppercase',cursor:'pointer',padding:0}}>← Back</button>
          </div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:'#e8b84b',marginTop:18}}>Account Information</div>
        </div>
        <div style={{height:2,background:'rgba(201,168,76,0.45)',margin:'0 20px'}} />
        <div ref={scrollContainerRef} style={{padding:'16px 20px',flex:1,overflowY:'auto'}}>

          <div style={{background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,padding:'16px 14px 25px',marginBottom:28}}>
            <div style={{marginBottom:14}}>
              <div style={{display:'inline-block',fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',marginBottom:4,borderBottom:'1px solid rgba(201,168,76,0.6)'}}>Member Name</div>
              <div style={{fontSize:12,fontWeight:600,color:'#f5f0e8'}}>{user.name}{user.lastName ? ' ' + user.lastName : ''}</div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{display:'inline-block',fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',marginBottom:4,borderBottom:'1px solid rgba(201,168,76,0.6)'}}>Email</div>
              <div style={{fontSize:12,fontWeight:600,color:'#f5f0e8'}}>{user.email}</div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{display:'inline-block',fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',marginBottom:4,borderBottom:'1px solid rgba(201,168,76,0.6)'}}>Member #</div>
              <div style={{fontSize:12,fontWeight:600,color:'#f5f0e8'}}>{user.memberNumber}</div>
            </div>
            <div>
              <div style={{display:'inline-block',fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',marginBottom:4,borderBottom:'1px solid rgba(201,168,76,0.6)'}}>Member Since</div>
              <div style={{fontSize:12,fontWeight:600,color:'#f5f0e8'}}>{new Date(user.createdAt).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</div>
            </div>
          </div>

          <div style={{height:1,background:'rgba(201,168,76,0.08)',marginBottom:28}} />

          <div style={{display:'flex',flexDirection:'column',gap:28}}>
            <div role="button" onClick={()=>{setShowEmailForm(true);setEmailError('');setEmailSuccess('');setEmailForm({next:'',confirm:''});}} onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.35)',borderRadius:4,cursor:'pointer',WebkitTapHighlightColor:'rgba(0,0,0,0)',userSelect:'none'}}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Edit Account Information</span>
              <span style={{fontSize:14,color:'#f5f0e8'}}>›</span>
            </div>
            <div role="button" onClick={()=>{setShowPwForm(true);setPwError('');setPwSuccess('');setPwForm({current:'',next:'',confirm:''});}} onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.35)',borderRadius:4,cursor:'pointer',WebkitTapHighlightColor:'rgba(0,0,0,0)',userSelect:'none'}}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Change Password</span>
              <span style={{fontSize:14,color:'#f5f0e8'}}>›</span>
            </div>
            <div role="button" onClick={()=>{setShowDeleteForm(true);}} onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.35)',borderRadius:4,cursor:'pointer',WebkitTapHighlightColor:'rgba(0,0,0,0)',userSelect:'none'}}>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Delete Account</span>
              <span style={{fontSize:14,color:'#f5f0e8'}}>›</span>
            </div>
          </div>

        </div>
      </div>
    </>
  );

  return (
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'#0d1b2e',zIndex:200}} />
      <div className="dtm-app-frame" style={{position:'fixed',top:0,bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'#0d1b2e',zIndex:201,display:'flex',flexDirection:'column'}}>
        <div style={{background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)',padding:'16px 20px 10px'}}>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
            <button onClick={()=>{setShowPwForm(false);setPwForm({current:'',next:'',confirm:''});setPwError('');setPwSuccess('');onClose();}} style={{background:'none',border:'none',color:'rgba(245,240,232,0.35)',fontSize:20,cursor:'pointer',padding:0,lineHeight:1}}>✕</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
            <div style={{fontSize:9,fontWeight:600,letterSpacing:3,textTransform:'uppercase',color:'rgba(245,240,232,0.4)'}}>Hello,</div>
            <div style={{fontSize:20,fontWeight:800,color:'#f5f0e8',textAlign:'center',letterSpacing:1}}>{user.name}</div>
          </div>
        </div>
        <div style={{height:2,background:'rgba(201,168,76,0.45)',margin:'0 20px'}} />
        <div style={{padding:'28px 20px 0',display:'flex',justifyContent:'center'}}>
          <div style={{background:'transparent',border:'2px solid #e8b84b',borderRadius:4,padding:'10px 14px',textAlign:'center',width:180,display:'flex',flexDirection:'column',alignItems:'center'}}>
            <div style={{position:'relative',display:'inline-block'}}>
              <div style={{fontSize:33,fontWeight:800,color:'#e8b84b',lineHeight:1,letterSpacing:3}}>{handicap !== null ? (Math.trunc(handicap) < 0 ? `+${Math.abs(Math.trunc(handicap))}` : Math.trunc(handicap)) : '—'}</div>
              {roundCount>=10&&roundCount<18&&<span style={{position:'absolute',top:0,right:-5,fontSize:16,color:'#e8b84b',lineHeight:1,fontWeight:700}}>*</span>}
            </div>
            <div style={{fontSize:7,fontWeight:900,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginTop:6,paddingLeft:3}}>Handicap</div>
          </div>
        </div>
        <div style={{padding:'35px 20px 0',display:'flex',flexDirection:'column',gap:35,flex:1,overflow:'hidden'}}>
          <div onClick={()=>setSubPanel('account')} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'15px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.35)',borderRadius:4,cursor:'pointer',WebkitTapHighlightColor:'rgba(0,0,0,0)'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Account Information</span>
            <span style={{fontSize:14,color:'#f5f0e8'}}>›</span>
          </div>
          <div onClick={()=>setSubPanel('membership')} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'15px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.35)',borderRadius:4,cursor:'pointer',WebkitTapHighlightColor:'rgba(0,0,0,0)'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Membership & Payment</span>
            <span style={{fontSize:14,color:'#f5f0e8'}}>›</span>
          </div>
          <div onClick={()=>setSubPanel('support')} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'15px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.35)',borderRadius:4,cursor:'pointer',WebkitTapHighlightColor:'rgba(0,0,0,0)'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.06)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(8,18,36,0.6)'}>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'#f5f0e8'}}>Support</span>
            <span style={{fontSize:14,color:'#f5f0e8'}}>›</span>
          </div>
        </div>
        <div style={{padding:`4px 20px calc(${window.Capacitor?.isNativePlatform?.() ? 50 : 8}px + env(safe-area-inset-bottom))`,flexShrink:0}}>
          <button onClick={async()=>{setLoggingOut(true);await onSignOut();}} className="signout-btn" style={{width:'100%',padding:10,background:'linear-gradient(135deg,#c41e3a,#9e1830)',border:'none',borderRadius:3,color:'#f5f0e8',fontSize:11,fontWeight:700,letterSpacing:3,textTransform:'uppercase',cursor:'pointer',opacity:loggingOut?0.6:1}}>
            {loggingOut ? 'Logging Out...' : 'Log Out'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Course Detail Row (smart wrap) ───────────────────────────────────────────
// ─── App Content ───────────────────────────────────────────────────────────────
function AppContent({ user, onSignOut, onAccountDeleted, onUserUpdate }) {
  const [tab, setTab] = useState("home");
  const [showProfile, setShowProfile] = useState(false);
  const accountBtnRef = useRef(null);
  useEffect(() => {
    document.body.style.overflow = showProfile ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showProfile]);
  const [rounds, setRounds] = useState([]);
  const [postError, setPostError] = useState('');
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [form, setForm] = useState({ course:"", score:"", rating:"", slope:"", tee:"", date:localDateStr() });
  const [added, setAdded] = useState(false);
  const [editRating, setEditRating] = useState(false);
  const [editSlope, setEditSlope] = useState(false);
  const [courseSearch, setCourseSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [showCourseInfo, setShowCourseInfo] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [sameDayModal, setSameDayModal] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [manualCourseEntered, setManualCourseEntered] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedRound, setSelectedRound] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingPartnerCount, setPendingPartnerCount] = useState(0);
  const [courses, setCourses] = useState([]);
  const [userCourses, setUserCourses] = useState([]);
  const [homeFeed, setHomeFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [partners, setPartners] = useState([]);
  const [partnerRequests, setPartnerRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [trends, setTrends] = useState({});
  const [streaks, setStreaks] = useState({});
  const [handicaps, setHandicaps] = useState({});
  const [partnerRoundCounts, setPartnerRoundCounts] = useState({});
  const [partnerSearch, setPartnerSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [partnerLoading, setPartnerLoading] = useState(false);
  const [golfApiResults, setGolfApiResults] = useState([]);
  const [golfApiLoading, setGolfApiLoading] = useState(false);
  const [golfApiFetchLoading, setGolfApiFetchLoading] = useState(false);
  const [golfApiClub, setGolfApiClub] = useState(null);
  const [selectedGolfCourse, setSelectedGolfCourse] = useState('');
  const golfSearchTimer = useRef(null);
  const partnerSearchTimer = useRef(null);

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

  // Partner functions
  const fetchPartners = async () => {
    setTrends({}); setStreaks({}); setHandicaps({}); setPartnerRoundCounts({});
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/partners?or=(requester_id.eq.${user.id},recipient_id.eq.${user.id})&select=*`, { headers: await authHeadersAsync() });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setPartners(data.filter(p => p.status === 'accepted'));
        setPartnerRequests(data.filter(p => p.status === 'pending' && p.recipient_id === user.id));
        setSentRequests(data.filter(p => p.status === 'pending' && p.requester_id === user.id));
        setPendingPartnerCount(data.filter(p => p.status === 'pending' && p.recipient_id === user.id).length);
      }
    } catch {}
  };

  const fetchHomeFeed = async () => {
    setFeedLoading(true);
    try {
      const headers = await authHeadersAsync();
      const partnerRes = await fetch(`${SUPABASE_URL}/rest/v1/partners?or=(requester_id.eq.${user.id},recipient_id.eq.${user.id})&status=eq.accepted&select=requester_id,recipient_id`, { headers });
      const partnerData = await partnerRes.json();
      if (!partnerRes.ok || !Array.isArray(partnerData)) { setFeedLoading(false); return; }
      const partnerIds = partnerData.map(p => p.requester_id === user.id ? p.recipient_id : p.requester_id);
      if (!partnerIds.length) { setHomeFeed([]); setFeedLoading(false); return; }

      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      const feed = [];

      for (const pid of partnerIds) {
        // Fetch partner profile
        const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${pid}&select=name,last_name,created_at`, { headers: { ...headers, 'Accept': 'application/vnd.pgrst.object+json' } });
        const prof = profRes.ok ? await profRes.json() : null;
        const name = prof ? displayName(prof.name, prof.last_name) : 'Partner';
        const accountCreatedAt = prof?.created_at ? new Date(prof.created_at) : new Date(0);
        const accountCreatedDate = accountCreatedAt.toISOString().split('T')[0];
        const gracePeriodOver = (roundDate) => roundDate >= accountCreatedDate;

        // Fetch recent rounds
        const roundRes = await fetch(`${SUPABASE_URL}/rest/v1/rounds?user_id=eq.${pid}&date=gte.${cutoffStr}&select=*&order=date.desc,created_at.desc`, { headers });
        const rounds = roundRes.ok ? await roundRes.json() : [];

        // All rounds for streak/handicap calc
        const allRes = await fetch(`${SUPABASE_URL}/rest/v1/rounds?user_id=eq.${pid}&select=differential,score,rating,slope,date,created_at,id&order=date.desc,id.desc`, { headers });
        const allRounds = allRes.ok ? await allRes.json() : [];

        // Round posted events
        for (const r of rounds) {
          feed.push({ type: 'round', name, course: r.course, score: r.score, date: r.date, created_at: r.created_at, id: `round-${pid}-${r.id}` });
        }

        // Handicap integer change events
        if (allRounds.length >= 10) {
          const recentIdx = allRounds.findIndex(r => r.date < cutoffStr);
          const recentRounds = recentIdx === -1 ? allRounds : allRounds.slice(0, recentIdx);
          for (let i = 0; i < recentRounds.length - 1; i++) {
            const newer = allRounds.slice(i);
            const older = allRounds.slice(i + 1);
            if (newer.length < 10 || older.length < 10) continue;
            const newHcp = calcHandicap(newer);
            const oldHcp = calcHandicap(older);
            if (newHcp !== null && oldHcp !== null && newHcp !== oldHcp) {
              feed.push({ type: 'handicap', name, from: oldHcp, to: newHcp, date: recentRounds[i].date, created_at: recentRounds[i].date + 'T12:00:00', id: `hcp-${pid}-${i}` });
            }
          }
        }

        // Hot/Cold streak events — check streak state at each round within the window
        if (allRounds.length >= 13) {
          const recentIdxS = allRounds.findIndex(r => r.date < cutoffStr);
          const recentRoundsS = recentIdxS === -1 ? allRounds : allRounds.slice(0, recentIdxS);
          const seenStreakIds = new Set();
          for (let i = 0; i < recentRoundsS.length; i++) {
            // Calculate streak as of this round (allRounds starting at index i)
            const roundsAtPoint = allRounds.slice(i);
            if (roundsAtPoint.length < 13) continue;
            const streakAtPoint = calcStreak(roundsAtPoint);
            if (streakAtPoint.streak >= 3) {
              const streakKey = `${pid}-${streakAtPoint.trend}-${allRounds[i].id}`;
              if (!seenStreakIds.has(streakKey)) {
                seenStreakIds.add(streakKey);
                feed.push({
                  type: 'streak', name, trend: streakAtPoint.trend,
                  streak: streakAtPoint.streak,
                  date: allRounds[i].date,
                  created_at: allRounds[i].date + 'T11:00:00',
                  id: `streak-${pid}-${allRounds[i].id}`
                });
              }
            }
          }
        }
        // All-time low score events
        for (const r of rounds) {
          if (!gracePeriodOver(r.date)) continue;
          const rIdx = allRounds.findIndex(pr => pr.created_at === r.created_at);
          if (rIdx === -1 || rIdx >= allRounds.length - 1) continue;
          const priorRounds = allRounds.slice(rIdx + 1);
          if (priorRounds.length === 0) continue;
          if (!r.score) continue;
          const validPriorScores = priorRounds.map(pr => pr.score).filter(s => s != null && s > 0);
          if (validPriorScores.length === 0) continue;
          const prevLow = Math.min(...validPriorScores);
          if (r.score < prevLow) {
            const lowScoreTs = new Date(new Date(r.created_at).getTime() + 1000).toISOString(); feed.push({ type: 'lowScore', name, score: r.score, prev: prevLow, date: r.date, created_at: lowScoreTs, id: `lowscore-${pid}-${r.id}` });
          }
        }

        // All-time low handicap events (must drop by at least 1 full point)
        if (allRounds.length >= 10) {
          for (let i = 0; i < rounds.length; i++) {
            const r = rounds[i];
            if (!gracePeriodOver(r.date)) continue;
            const roundIdx = allRounds.findIndex(pr => pr.created_at === r.created_at);
            if (roundIdx === -1 || roundIdx >= allRounds.length - 1) continue;
            const newHcp = calcHandicapDecimal(allRounds.slice(roundIdx));
            const oldHcp = calcHandicapDecimal(allRounds.slice(roundIdx + 1));
            if (newHcp === null || oldHcp === null) continue;
            // Check if this is an all-time low (lower than all rounds before this point)
            const priorHcps = [];
            for (let j = roundIdx + 1; j < allRounds.length - 1; j++) {
              const h = calcHandicapDecimal(allRounds.slice(j));
              if (h !== null) priorHcps.push(h);
            }
            const allTimeLow = priorHcps.length === 0 ? oldHcp : Math.min(...priorHcps);
            if (newHcp < allTimeLow) {
              feed.push({ type: 'lowHandicap', name, newHcp, prev: allTimeLow, date: r.date, created_at: r.created_at, id: `lowhcp-${pid}-${r.id}` });
            }
          }
        }
      }
      feed.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setHomeFeed(feed.slice(0, 50));
    } catch {}
    setFeedLoading(false);
  };

  const searchUsers = (query) => {
    if (query.length < 4) { setSearchResults([]); return; }
    clearTimeout(partnerSearchTimer.current);
    partnerSearchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?member_number=ilike.${encodeURIComponent(query)}*&select=id,name,last_name,member_number&limit=5`, { headers: await authHeadersAsync() });
        const data = await res.json();
        if (res.ok && Array.isArray(data)) setSearchResults(data.filter(p => p.id !== user.id));
      } catch {}
      setSearchLoading(false);
    }, 300);
  };

  const sendRequest = async (recipientId) => {
    setPartnerLoading(recipientId);
    await fetch(`${SUPABASE_URL}/rest/v1/partners`, {
      method: 'POST',
      headers: { ...(await authHeadersAsync()), "Prefer": "return=representation" },
      body: JSON.stringify({ requester_id: user.id, recipient_id: recipientId, status: 'pending' }),
    });
    // Send partner request email notification
    try {
      const headers = await authHeadersAsync();
      const recipRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${recipientId}&select=name,last_name,email`, { headers: { ...headers, 'Accept': 'application/vnd.pgrst.object+json' } });
      if (recipRes.ok) {
        const recip = await recipRes.json();
        if (recip?.email) {
          await fetch(`${API_BASE}/api/send-auth-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'partner_request',
              email: recip.email,
              name: displayName(recip.name, recip.last_name),
              requesterName: user.lastName ? `${user.name} ${user.lastName}` : user.name,
            }),
          });
        }
      }
    } catch {}
    setPartnerSearch(''); setSearchResults([]);
    await fetchPartners();
    setPartnerLoading(false);
  };

  const respondToRequest = async (partnerId, accept) => {
    if (accept) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/partners?id=eq.${partnerId}&recipient_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { ...(await authHeadersAsync()), "Prefer": "return=representation" },
        body: JSON.stringify({ status: 'accepted' }),
      });
      if (!res.ok) return;
    } else {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/partners?id=eq.${partnerId}&recipient_id=eq.${user.id}`, { method: 'DELETE', headers: await authHeadersAsync() });
      if (!res.ok) return;
    }
    await fetchPartners();
    if (accept) fetchHomeFeed();
  };

  const removePartner = async (partnerId) => {
    await fetch(`${SUPABASE_URL}/rest/v1/partners?id=eq.${partnerId}`, { method: 'DELETE', headers: await authHeadersAsync() });
    await fetchPartners();
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
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/user_courses?user_id=eq.${user.id}&select=*&order=name.asc`, {
          headers: await authHeadersAsync()
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data)) setUserCourses(data);
      } catch {}
    };
    fetchCourses();
  }, []);

  // Load partners and home feed on mount
  useEffect(() => { fetchPartners(); setTimeout(() => fetchHomeFeed(), 500); }, []);

  useEffect(() => {
    const dismiss = () => {
      document.querySelectorAll('.info-tooltip.active').forEach(el => el.classList.remove('active'));
    };
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
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



  const handleAdd = async () => {
    const { course, score, rating, slope, tee, date } = form;
    if (!score || !rating) return;
    const s = parseFloat(score), r = parseFloat(rating), sl = parseFloat(slope) || 113;
    if (isNaN(s) || isNaN(r)) return;
    const todayStr = localDateStr();
    if (date && date > todayStr) return;
    setSaving(true);
    const differential = calcDifferential(s, r, sl);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rounds`, {
        method: "POST",
        headers: { ...(await authHeadersAsync()), "Prefer": "return=representation" },
        body: JSON.stringify({ user_id: user.id, course: course.trim() || "Unknown Course", score: s, rating: r, slope: sl, tee: tee || null, date: date || todayStr, differential, course_played: (golfApiClub && selectedGolfCourse) ? (golfApiClub.courses.find(c=>c.courseID===selectedGolfCourse)?.courseName || null) : null }),
      });
      const data = await res.json();
      const row = Array.isArray(data) ? data[0] : data;
      if (res.ok && row?.id) {
        setRounds(prev => [row, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id));
        // Save manual course to user's personal list if not from main DB
        if (!selectedCourse && course.trim()) {
          try {
            const existing = userCourses.find(c => c.name.toLowerCase() === course.trim().toLowerCase());
            if (!existing) {
              const ucRes = await fetch(`${SUPABASE_URL}/rest/v1/user_courses`, {
                method: "POST",
                headers: { ...(await authHeadersAsync()), "Prefer": "return=representation" },
                body: JSON.stringify({ user_id: user.id, name: course.trim(), rating: r, slope: sl, tee: tee || null }),
              });
              if (ucRes.ok) {
                const ucData = await ucRes.json();
                const newCourse = Array.isArray(ucData) ? ucData[0] : ucData;
                if (newCourse) setUserCourses(prev => [...prev, newCourse].sort((a,b) => a.name.localeCompare(b.name)));
              }
            }
          } catch {}
        }
        setForm({ course:"", score:"", rating:"", slope:"", tee:"", date:localDateStr() });
        setCourseSearch(""); setShowDropdown(false); setConfirmPost(false); setSelectedCourse(null);
        setGolfApiClub(null); setSelectedGolfCourse(''); setGolfApiResults([]);
        setSaving(false); setManualCourseEntered(false);
        setAdded(true); setTimeout(() => setAdded(false), 2000);
      } else {
        console.error("Round post failed:", data);
        setSaving(false);
        setPostError(data?.message || data?.error || "Failed to post round — please try again");
      }
    } catch (e) {
      console.error("Round post error:", e);
      setSaving(false);
      setPostError("Network error — please try again");
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${SUPABASE_URL}/rest/v1/rounds?id=eq.${id}&user_id=eq.${user.id}`, { method: "DELETE", headers: await authHeadersAsync() });
    setRounds(prev => prev.filter(r => r.id !== id));
    setPendingDelete(null);
  };

  const cancelPost = () => {
    setConfirmPost(false);
    setForm({ course:"", score:"", rating:"", slope:"", tee:"", date:localDateStr() });
    setCourseSearch(""); setSelectedCourse(null);
    setGolfApiClub(null); setSelectedGolfCourse(''); setGolfApiResults([]); setGolfClubName('');
    setManualCourseEntered(false);
  };

  const minScore = rounds.length ? Math.min(...rounds.map(r => r.score)) : null;
  const minScoreRound = useMemo(() => {
    if (!rounds.length) return null;
    return rounds.reduce((best, r) => r.score < (best?.score ?? Infinity) ? r : best, null);
  }, [rounds]);
  const ytdRounds = rounds.filter(r => new Date(r.date).getFullYear() === new Date().getFullYear()).length;
  const lowestHandicap = useMemo(() => {
    if (rounds.length < 10) return null;
    const sorted = [...rounds].filter(r => r.score != null && r.rating != null).sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);
    let min = null;
    for (let i = 0; i < sorted.length; i++) {
      const subset = sorted.slice(i);
      if (subset.length < 10) break;
      const h = calcHandicapDecimal(subset);
      if (h !== null && (min === null || h < min)) min = h;
    }
    return min;
  }, [rounds]);
  const lowestHandicapDate = useMemo(() => {
    if (rounds.length < 10) return null;
    const sorted = [...rounds].filter(r => r.score != null && r.rating != null).sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);
    let min = null, minDate = null;
    for (let i = 0; i < sorted.length; i++) {
      const subset = sorted.slice(i);
      if (subset.length < 10) break;
      const h = calcHandicapDecimal(subset);
      if (h !== null && (min === null || h < min)) { min = h; minDate = sorted[i].date; }
    }
    return minDate;
  }, [rounds]);
  const [expandedStat, setExpandedStat] = useState(null);

  // Deletable = posted within 24 hours (using created_at from Supabase)
  const isDeletable = (round) => {
    if (!round.created_at) return false;
    return (Date.now() - new Date(round.created_at).getTime()) < 86400000;
  };

  const S = {
    app: { maxWidth:430, margin:'0 auto', minHeight:'100dvh', background:'#0d1b2e', color:'#f5f0e8', position:'relative' },
    header: { background:'linear-gradient(180deg,#0d1b2e 0%,#0d1b2e 100%)', padding:'0 16px 0', position:'relative' },
    headerMain: { fontSize:18, fontWeight:900, color:'#fff', textAlign:'center', textTransform:'uppercase', lineHeight:1, letterSpacing:4, fontFamily:'Verdana,sans-serif' },
    headerSub: { fontSize:10, fontWeight:700, letterSpacing:2.75, textTransform:'uppercase', color:'#e02247', textAlign:'center', marginTop:3, marginBottom:0, marginLeft:-4, whiteSpace:'nowrap', fontFamily:'Verdana,sans-serif' },
    tab: (a) => ({ flex:1, textAlign:'center', padding:'8px 2px', background:a?'rgba(245,240,232,0.08)':'transparent', borderRadius:4, border:a?'1px solid rgba(245,240,232,0.15)':'1px solid transparent', fontSize:11, fontWeight:700, letterSpacing:0.3, textTransform:'uppercase', color:a?'#e8b84b':'rgba(245,240,232,0.35)', cursor:'pointer', position:'relative', bottom:-3, whiteSpace:'normal', lineHeight:1.4, WebkitTapHighlightColor:'rgba(0,0,0,0)' }),
    content: { padding:'12px 20px 20px' },
    hcap: { background:'linear-gradient(135deg,#0f1e35 0%,#0d1b2e 100%)', border:'2px solid #e8b84b', borderRadius:4, padding:'24px 28px', textAlign:'center', marginBottom:16, display:'flex', flexDirection:'column', alignItems:'center' },
    hcapLabel: { fontSize:15, fontWeight:900, letterSpacing:8, textTransform:'uppercase', color:'#e8b84b', marginTop:14, paddingLeft:8 },
    hcapValue: { fontSize:100, fontWeight:800, color:'#e8b84b', lineHeight:1, letterSpacing:-2 },
    card: { background:'rgba(8,18,36,0.6)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:4, padding:'20px 10px 20px 20px', marginBottom:16 },
    cardTitle: { fontSize:9, fontWeight:700, letterSpacing:4, textTransform:'uppercase', color:'#f5f0e8', marginBottom:16 },
    label: { fontSize:9, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'rgba(201,168,76,0.75)', marginBottom:6, display:'block', paddingLeft:4 },
    input: { background:'rgba(8,18,36,0.8)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:3, padding:'11px 12px 11px 6px', color:'#f5f0e8', fontSize:15, fontWeight:400, outline:'none', width:'100%' },
    btn: { width:'100%', padding:14, background:'linear-gradient(135deg,#c41e3a,#9e1830)', border:'none', borderRadius:3, color:'#f5f0e8', fontSize:13, fontWeight:900, letterSpacing:4, textTransform:'uppercase', cursor:'pointer', marginTop:4 },
    btnGhost: { padding:'7px 14px', background:'transparent', border:'1px solid rgba(201,168,76,0.3)', borderRadius:3, color:'#e8b84b', fontSize:11, fontWeight:700, letterSpacing:3, textTransform:'uppercase', cursor:'pointer' },
    roundItem: (f) => ({ display:'flex', alignItems:'center', padding:'12px 0', borderBottom:'1px solid rgba(201,168,76,0.18)', opacity:f?0.55:1 }),
    roundScore: { background:'#0d1b2e', border:'1px solid rgba(232,184,75,0.35)', borderRadius:2, padding:'5px 12px', fontSize:14, fontWeight:600, color:'#e8b84b', minWidth:42, textAlign:'center' },
    roundDetails: { flex:1, padding:'0 12px', minWidth:0, overflow:'hidden' },
    roundCourse: { fontSize:13, fontWeight:500, color:'#f5f0e8', marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
    roundMeta: { fontSize:10, fontWeight:400, color:'rgba(180,175,170,0.7)' },
    roundDiff: { fontSize:18, fontWeight:500, color:'#e8b84b', minWidth:40, textAlign:'center' },
    statGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 },
    statBox: { background:'rgba(8,18,36,0.6)', border:'1px solid rgba(201,168,76,0.15)', borderRadius:3, padding:'16px 12px', textAlign:'center', display:'flex', flexDirection:'column', justifyContent:'space-between' },
    statLabel: { fontSize:8, fontWeight:700, letterSpacing:3, textTransform:'uppercase', color:'#f5f0e8', marginBottom:8 },
    statVal: { fontSize:28, fontWeight:700, color:'#e8b84b', letterSpacing:-1 },
  };

  return (
    <div style={S.app} className="dtm-app-frame">
      <style>{globalStyles}</style>

      {showProfile && <ProfileDrawer user={user} roundCount={rounds.length} handicap={calcHandicapDecimal(rounds)} userRounds={rounds} authHeadersAsync={authHeadersAsync} onClose={()=>setShowProfile(false)}onSignOut={onSignOut} onAccountDeleted={onAccountDeleted} onUserUpdate={onUserUpdate} onHome={()=>{setShowProfile(false);setTab('home');}} onPartnerUpdate={()=>{const fetchCount=async()=>{try{const res=await fetch(`${SUPABASE_URL}/rest/v1/partners?recipient_id=eq.${user.id}&status=eq.pending&select=id`,{headers:authHeaders()});const d=await res.json();if(res.ok&&Array.isArray(d))setPendingPartnerCount(d.length);}catch{}};fetchCount();}} />}

      {pendingDelete && (
        <div onClick={()=>setPendingDelete(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'28px 24px',maxWidth:320,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:12,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:16}}>Delete Round</div>
            <div style={{fontSize:14,color:'rgba(245,240,232,0.7)',marginBottom:20,lineHeight:1.8}}>This round will be<br/>permanently removed</div>
            <div style={{display:'flex',flexDirection:'column',gap:11}}>
              <button className="confirm-post-btn" style={{...S.btn,margin:0,padding:8,fontWeight:700,letterSpacing:1,background:'linear-gradient(135deg,#c41e3a,#9e1830)'}} onClick={()=>handleDelete(pendingDelete)}>Yes, Delete</button>
              <button className="confirm-cancel-btn dtm-label" style={{...S.btnGhost,width:'100%',padding:8}} onClick={()=>setPendingDelete(null)}>No, Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Round Detail Sheet */}
      {selectedRound && (
        <div onClick={()=>setSelectedRound(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'flex-end',justifyContent:'center',zIndex:999}}>
          <div onClick={e=>e.stopPropagation()} style={{position:'relative',background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.3)',borderBottom:'none',borderRadius:'10px 10px 0 0',padding:'28px 24px 80px',width:'100%',maxWidth:480,minHeight:'85vh',maxHeight:'85vh',overflowY:'auto'}}>

            {/* Title */}
            <div style={{fontSize:16,fontWeight:800,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',textAlign:'center',marginBottom:16}}>Round Detail</div>
            <div style={{height:1,background:'rgba(232,184,75,0.2)',marginBottom:20}} />

            {/* List rows */}
            {[
              { label:'Date', value: new Date(selectedRound.date+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}), color:'#f5f0e8' },
              { label:'Course', value: selectedRound.course, color:'#f5f0e8' },
              ...(selectedRound.course_played ? [{ label:'Course Played', value: selectedRound.course_played, color:'#f5f0e8' }] : []),
              { label:'Tees', value: selectedRound.tee || '—', color:'#f5f0e8' },
              { label:'Rating', value: selectedRound.rating, color:'#f5f0e8' },
              { label:'Slope', value: selectedRound.slope || '—', color:'#f5f0e8' },
              { label:'Score', value: selectedRound.score, color:'#e8b84b' },
              { label:'Differential', value: selectedRound.differential.toFixed(1), color:'#e8b84b' },
            ].map(({label, value, color}) => (
              <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',paddingTop:13,paddingBottom:13,borderBottom:'1px solid rgba(201,168,76,0.1)'}}>
                <span style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',flexShrink:0,marginRight:16}}>{label}</span>
                <span style={{fontSize:14,fontWeight:600,color,textAlign:'right',lineHeight:1.4}}>{value}</span>
              </div>
            ))}

            <button onClick={()=>setSelectedRound(null)} style={{position:'absolute',bottom:20,left:24,right:24,padding:'12px 0',background:'transparent',border:'1px solid rgba(201,168,76,0.4)',borderRadius:4,color:'#e8b84b',fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',cursor:'pointer'}}>Close</button>
          </div>
        </div>
      )}

      {sameDayModal && (
        <div onClick={()=>setSameDayModal(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'28px 24px',maxWidth:320,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:12,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:16}}>Same Day Round?</div>
            <div style={{fontSize:13,color:'rgba(245,240,232,0.7)',lineHeight:1.7,marginBottom:8}}>
              You already have a round posted on<br/>
              <span style={{color:'#f5f0e8',fontWeight:600,display:'block',textAlign:'center',marginTop:4}}>{new Date(form.date+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</span>
            </div>
            <div style={{fontSize:13,color:'rgba(245,240,232,0.7)',lineHeight:1.7,marginBottom:20}}>
              Is this round also from that date?<br/>Please make sure the date of your round is correct — it directly affects your handicap calculation.
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:11}}>
              <button className="confirm-post-btn" style={{...S.btn,margin:0,padding:10,fontWeight:700,letterSpacing:1}} onClick={()=>{setSameDayModal(false);setConfirmPost(true);}}>Yes, Same Day</button>
              <button className="confirm-cancel-btn dtm-label" style={{...S.btnGhost,width:'100%',padding:10,color:'#e8b84b'}} onClick={()=>setSameDayModal(false)}>No, Change Date</button>
            </div>
          </div>
        </div>
      )}

      {confirmPost && (
        <div onClick={cancelPost} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:6,padding:'28px 24px',maxWidth:320,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:12,letterSpacing:3,textTransform:'uppercase',color:'#e8b84b',marginBottom:10}}>Confirm Round</div>
            <div style={{fontSize:14,color:'rgba(245,240,232,0.7)',marginBottom:20,lineHeight:1.5}}>
              <div style={{marginBottom:10}}><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)'}}>Course</span><br/><span style={{color:'#f5f0e8',fontSize:15,display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{form.course||"Unknown Course"}</span></div>
              {golfApiClub&&selectedGolfCourse&&(()=>{const cn=golfApiClub.courses.find(c=>c.courseID===selectedGolfCourse)?.courseName;return cn?<div style={{marginBottom:10}}><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Course Played</span><span style={{color:'#f5f0e8',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cn}</span></div>:null;})()}
              {form.tee&&<div style={{marginBottom:10}}><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Tee</span><span style={{color:'#f5f0e8',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{form.tee}</span></div>}
              <div style={{display:'flex',gap:20,justifyContent:'center',marginBottom:10}}>
                <div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Rating</span><span style={{color:'#f5f0e8'}}>{form.rating}</span></div>
                {form.slope&&<div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Slope</span><span style={{color:'#f5f0e8'}}>{form.slope}</span></div>}
              </div>
              <div style={{display:'flex',gap:20,justifyContent:'center'}}>
                <div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Score</span><span style={{color:'#f5f0e8'}}>{form.score}</span></div>
                <div><span style={{fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'rgba(201,168,76,0.6)',display:'block'}}>Date</span><span style={{color:'#f5f0e8'}}>{new Date(form.date+'T00:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'2-digit'})}</span></div>
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:11}}>
              {postError&&<div style={{fontSize:11,color:'#e02247',textAlign:'center',marginBottom:6,letterSpacing:1}}>{postError}</div>}
        <button className="confirm-post-btn" style={{...S.btn,margin:0,padding:8,fontWeight:700,letterSpacing:1,opacity:saving?0.5:1}} onClick={()=>{setPostError('');handleAdd();}} disabled={saving}>{saving?'Posting...':'Yes, Post Round'}</button>
              <button className="confirm-cancel-btn dtm-label" style={{...S.btnGhost,width:'100%',padding:8,color:'#e8b84b'}} onClick={cancelPost}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={S.header}>
        {/* Compact nav bar */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0px 10px'}}>
          <div className="avatar-wrap">
            <button onClick={()=>{setTab('home');setForm({course:'',score:'',rating:'',slope:'',tee:'',date:localDateStr()});setSelectedCourse(null);setCourseSearch('');setEditRating(false);setEditSlope(false);setAdded(false);setGolfApiClub(null);setSelectedGolfCourse('');setGolfApiResults([]);setManualCourseEntered(false);}} className="avatar-btn" style={{width:30,height:30,borderRadius:'50%',background:'linear-gradient(135deg,#1a3a5c,#0d1b2e)',border:'1.5px solid rgba(232,184,75,0.45)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0,WebkitTapHighlightColor:'rgba(0,0,0,0)'}}>
              <svg width="17" height="17" viewBox="2.5 2 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 10.5L12 2L21.5 10.5V21C21.5 21.6 21 22 20.5 22H15.5V16.5C15.5 16 15 15.5 14.5 15.5H9.5C9 15.5 8.5 16 8.5 16.5V22H3.5C3 22 2.5 21.6 2.5 21V10.5Z" fill="rgba(232,184,75,0.75)" stroke="rgba(232,184,75,0.75)" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

          </div>
          <div style={{textAlign:'center',flex:1,padding:'0 8px'}}>
            <div style={S.headerMain}>DOWN THE MIDDLE</div>
            <div style={S.headerSub}>A Truer Golf Handicap</div>
          </div>
          <div className="avatar-wrap" style={{position:'relative'}}>
            <button ref={accountBtnRef} onClick={()=>{setShowProfile(true);setForm({course:'',score:'',rating:'',slope:'',tee:'',date:localDateStr()});setSelectedCourse(null);setCourseSearch('');setEditRating(false);setEditSlope(false);setAdded(false);setGolfApiClub(null);setSelectedGolfCourse('');setGolfApiResults([]);setManualCourseEntered(false);}} className="avatar-btn" style={{width:30,height:30,borderRadius:'50%',background:showProfile?'linear-gradient(135deg,#1e4570,#1a3a5c)':'linear-gradient(135deg,#1a3a5c,#0d1b2e)',border:showProfile?'1.5px solid rgba(232,184,75,0.7)':'1.5px solid rgba(232,184,75,0.45)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0,WebkitTapHighlightColor:'rgba(0,0,0,0)'}}>
              <svg width="17" height="17" viewBox="4 3 18 19" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="9" r="4" fill="rgba(232,184,75,0.75)"/><path d="M4.5 20.5C4.5 17 8 14 12 14C16 14 19.5 17 19.5 20.5" fill="rgba(232,184,75,0.75)"/></svg>
            </button>
            

          </div>
        </div>
        <div style={{height:2,background:'rgba(201,168,76,0.45)',margin:'0 0 6px'}}/>
        <div style={{display:'flex',width:'100%',gap:4}}>
          <button className={`tab-btn${tab==='calculator'?' tab-btn-active':''}`} style={{...S.tab(tab==='calculator'),flex:1}} onClick={()=>{setTab('calculator');setPartnerSearch('');setShowProfile(false);}}><span>Post</span><br/><span>A Round</span></button>
          <button className={`tab-btn${tab==='rounds'?' tab-btn-active':''}`} style={{...S.tab(tab==='rounds'),flex:1}} onClick={()=>{setTab('rounds');setPartnerSearch('');setShowProfile(false);setForm({course:'',score:'',rating:'',slope:'',tee:'',date:localDateStr()});setSelectedCourse(null);setCourseSearch('');setEditRating(false);setEditSlope(false);setAdded(false);setGolfApiClub(null);setSelectedGolfCourse('');setGolfApiResults([]);setManualCourseEntered(false);}}><span>Round</span><br/><span>History</span></button>
          <button className={`tab-btn${tab==='stats'?' tab-btn-active':''}`} style={{...S.tab(tab==='stats'),flex:1}} onClick={()=>{setTab('stats');setPartnerSearch('');setShowProfile(false);setForm({course:'',score:'',rating:'',slope:'',tee:'',date:localDateStr()});setSelectedCourse(null);setCourseSearch('');setEditRating(false);setEditSlope(false);setAdded(false);setGolfApiClub(null);setSelectedGolfCourse('');setGolfApiResults([]);setManualCourseEntered(false);}}><span>My</span><br/><span>Analytics</span></button>
          <button className={`tab-btn${tab==='partners'?' tab-btn-active':''}`} style={{...S.tab(tab==='partners'),flex:1,position:'relative'}} onClick={()=>{setTab('partners');setShowProfile(false);fetchPartners();setForm({course:'',score:'',rating:'',slope:'',tee:'',date:localDateStr()});setSelectedCourse(null);setCourseSearch('');setEditRating(false);setEditSlope(false);setAdded(false);setGolfApiClub(null);setSelectedGolfCourse('');setGolfApiResults([]);setManualCourseEntered(false);}}>{pendingPartnerCount>0&&<span style={{position:'absolute',top:-6,right:-6,width:16,height:16,borderRadius:'50%',background:'#e02247',border:'2px solid #0d1b2e',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff',lineHeight:1,zIndex:10}}>!</span>}My Playing Partners</button>
        </div>
      </div>

      <div style={S.content}>
        {/* Handicap */}
        <div style={S.hcap}>
          {loadingRounds
            ? <div style={{fontSize:20,color:'rgba(232,184,75,0.4)',letterSpacing:2}}>—</div>
            : <div style={{position:'relative',display:'inline-block'}}>
                <div style={S.hcapValue}>{handicap!==null?(handicap<0?<span><span style={{fontSize:'0.6em',verticalAlign:'middle',position:'relative',top:'-0.15em',marginRight:'0.18em'}}>+</span>{Math.abs(handicap)}</span>:handicap):"—"}</div>
                {rounds.length<10&&(
                  <span className="ttm-tooltip" style={{position:'absolute',top:0,right:-16,fontSize:16,color:'#e8b84b',lineHeight:1,cursor:'pointer',fontWeight:700}}>*
                    <span className="tooltip-text" style={{width:120,textAlign:'center',left:'50%',transform:'translateX(-50%)'}}>10 rounds needed</span>
                  </span>
                )}
                {rounds.length>=10&&rounds.length<18&&(
                  <span className="ttm-tooltip" style={{position:'absolute',top:0,right:-16,fontSize:16,color:'#e8b84b',lineHeight:1,cursor:'pointer',fontWeight:700}}>*
                    <span className="tooltip-text" style={{whiteSpace:'nowrap',textAlign:'center',left:'50%',transform:'translateX(-50%)'}}>Provisional Handicap — 18 rounds needed</span>
                  </span>
                )}
              </div>
          }
          <div style={{position:'relative'}}>
            <div style={S.hcapLabel}>Handicap</div>
          </div>
        </div>
        {/* Home Screen */}
        {tab==="home"&&(
          <div>
            {/* Last 4 rounds */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.7)',marginBottom:10,paddingLeft:2}}>Recent Rounds</div>
              {loadingRounds
                ? <div style={{fontSize:11,color:'rgba(245,240,232,0.3)',fontStyle:'italic',paddingLeft:2}}>Loading...</div>
                : rounds.length === 0
                  ? <div style={{fontSize:12,color:'rgba(245,240,232,0.3)',fontStyle:'italic',paddingLeft:2}}>No recent activity.</div>
                  : rounds.slice(0,4).map((r,i) => (
                    <div key={r.id} style={{display:'flex',alignItems:'center',padding:'10px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,marginBottom:6}}>
                      <div style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.35)',borderRadius:2,padding:'4px 10px',fontSize:13,fontWeight:600,color:'#e8b84b',minWidth:38,textAlign:'center',marginRight:12}}>{r.score}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,color:'#f5f0e8',fontWeight:500}}>{r.course}</div>
                        <div style={{fontSize:9,color:'rgba(180,175,170,0.7)',letterSpacing:1,marginTop:2}}>{new Date(r.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
                      </div>

                    </div>
                  ))
              }
            </div>

            {/* Partner Activity Feed */}
            <div style={{height:1,background:'rgba(201,168,76,0.2)',marginBottom:16}}/>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:3,textTransform:'uppercase',color:'rgba(201,168,76,0.7)',marginBottom:10,paddingLeft:2}}>News Feed</div>
            {feedLoading
              ? <div style={{fontSize:11,color:'rgba(245,240,232,0.3)',fontStyle:'italic',paddingLeft:2}}>Loading...</div>
              : homeFeed.length === 0
                ? <div style={{fontSize:12,color:'rgba(245,240,232,0.3)',fontStyle:'italic',paddingLeft:2,lineHeight:1.7}}>No news to share.{partners.length > 0 && ' Somebody make a tee time!'}</div>
                : homeFeed.map(item => {
                    const timeAgo = (dateStr) => {
                      const diff = Math.max(0, Math.floor((Date.now() - new Date(dateStr)) / 86400000));
                      if (diff === 0) return 'Today';
                      if (diff === 1) return 'Yesterday';
                      return `${diff} days ago`;
                    };
                    return (
                      <div key={item.id} style={{padding:'11px 14px',background:'rgba(8,18,36,0.6)',border:'1px solid rgba(201,168,76,0.13)',borderRadius:4,marginBottom:6,display:'flex',gap:8,alignItems:'flex-start'}}>
                        <div style={{flexShrink:0,fontSize:12,lineHeight:1.6,marginTop:1}}>{
                          item.type==='round'?'⛳':
                          item.type==='handicap'?(item.to>item.from?'📈':'📉'):
                          item.type==='streak'?(item.trend==='hot'?'🔥':'❄️'):
                          '🏆'
                        }</div>
                        <div style={{flex:1}}>
                        {item.type === 'round' && (
                          <>
                            <div style={{fontSize:12,color:'#f5f0e8',fontWeight:500,lineHeight:1.6}}>
                              <span style={{color:'#f5f0e8'}}>{item.name}</span> posted a <span style={{color:'#f5f0e8'}}>{item.score}</span> at <span style={{color:'#f5f0e8'}}>{item.course}</span>
                            </div>
                            <div style={{fontSize:9,color:'rgba(245,240,232,0.35)',letterSpacing:1,marginTop:4}}>{timeAgo(item.created_at)}</div>
                          </>
                        )}
                        {item.type === 'handicap' && (
                          <>
                            <div style={{fontSize:12,color:'#f5f0e8',fontWeight:500,lineHeight:1.6}}>
                              <span style={{color:'#f5f0e8'}}>{item.name}'s</span> handicap moved from <span style={{color:'#f5f0e8'}}>{item.from<0?`+${Math.abs(item.from)}`:item.from}</span> to <span style={{color:'#f5f0e8'}}>{item.to<0?`+${Math.abs(item.to)}`:item.to}</span>
                            </div>
                            <div style={{fontSize:9,color:'rgba(245,240,232,0.35)',letterSpacing:1,marginTop:4}}>{timeAgo(item.created_at)}</div>
                          </>
                        )}
                        {item.type === 'streak' && (
                          <>
                            <div style={{fontSize:12,color:'#f5f0e8',fontWeight:500,lineHeight:1.6}}>
                              <span style={{color:'#f5f0e8'}}>{item.name}</span> {item.isFirst ? `is on a ${item.trend === 'hot' ? 'hot' : 'cold'} streak` : `has extended their ${item.trend === 'hot' ? 'hot' : 'cold'} streak`}
                            </div>
                            <div style={{fontSize:9,color:'rgba(245,240,232,0.35)',letterSpacing:1,marginTop:4}}>{timeAgo(item.created_at)}</div>
                          </>
                        )}
                        {item.type === 'lowScore' && (
                          <>
                            <div style={{fontSize:12,color:'#f5f0e8',fontWeight:500,lineHeight:1.6}}>
                              <span style={{color:'#f5f0e8'}}>{item.name}</span> posted a new all-time low score on DTM
                            </div>
                            <div style={{fontSize:9,color:'rgba(245,240,232,0.35)',letterSpacing:1,marginTop:4}}>{timeAgo(item.created_at)}</div>
                          </>
                        )}
                        {item.type === 'lowHandicap' && (
                          <>
                            <div style={{fontSize:12,color:'#f5f0e8',fontWeight:500,lineHeight:1.6}}>
                              <span style={{color:'#f5f0e8'}}>{item.name}</span> achieved a new all-time low handicap on DTM
                            </div>
                            <div style={{fontSize:9,color:'rgba(245,240,232,0.35)',letterSpacing:1,marginTop:4}}>{timeAgo(item.created_at)}</div>
                          </>
                        )}
                        </div>
                      </div>
                    );
                  })
            }
          </div>
        )}

        {/* Post A Round */}
        {tab==="calculator"&&(
          <div style={{...S.card,position:'relative'}}>
            {(selectedCourse||golfApiClub||manualCourseEntered) && <button onClick={()=>{setForm({course:"",score:"",rating:"",slope:"",tee:"",date:localDateStr()});setSelectedCourse(null);setCourseSearch('');setEditRating(false);setEditSlope(false);setAdded(false);setGolfApiClub(null);setSelectedGolfCourse('');setGolfApiResults([]);setGolfClubName('');setManualCourseEntered(false);}} style={{position:'absolute',top:12,right:12,background:'none',border:'none',color:'rgba(201,168,76,0.5)',fontSize:9,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',cursor:'pointer',padding:0,zIndex:10}}>Clear</button>}
            <div style={{position:'relative',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <label style={{...S.label,marginBottom:0}}>Golf Course</label>
                <div style={{position:'relative'}}>
                  <div onClick={()=>setShowCourseInfo(p=>!p)} style={{width:14,height:14,borderRadius:'50%',background:'transparent',border:'1px solid rgba(201,168,76,0.5)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontSize:9,fontWeight:700,color:'rgba(201,168,76,0.7)',lineHeight:1}}>i</div>
                  {showCourseInfo&&(
                    <div onClick={()=>setShowCourseInfo(false)} style={{position:'absolute',top:-60,left:20,background:'rgba(8,18,36,0.97)',border:'2px solid rgba(201,168,76,0.5)',borderRadius:4,padding:'8px 10px',width:200,fontSize:10,color:'rgba(180,175,170,0.8)',lineHeight:1.5,zIndex:50,letterSpacing:0.3,fontWeight:600}}>
                      Can't find where you played?<br/>Enter the course name and all other information from your round manually instead
                    </div>
                  )}
                </div>
              </div>
              <input style={{...S.input,paddingLeft:7}} placeholder="Search..." value={form.course}
                onChange={e=>{
                  const val=e.target.value;
                  setForm(p=>({...p,course:val,rating:'',tee:''}));setCourseSearch(val);setShowDropdown(true);setSelectedCourse(null);setGolfApiResults([]);setGolfApiClub(null);setSelectedGolfCourse('');
                  if(golfSearchTimer.current)clearTimeout(golfSearchTimer.current);
                  if(val.length>=2){golfSearchTimer.current=setTimeout(async()=>{setGolfApiLoading(true);try{const res=await fetch(`${API_BASE}/api/golf-search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'search',query:val})});const data=await res.json();if(res.ok&&data.results)setGolfApiResults(data.results);}catch{}setGolfApiLoading(false);},400);}
                }}
                onFocus={()=>setShowDropdown(true)} onBlur={()=>{setTimeout(()=>setShowDropdown(false),200);if(form.course.trim()&&!selectedCourse&&!golfApiClub)setManualCourseEntered(true);}} autoComplete="off"/>
              {showDropdown&&courseSearch.length>=2&&(()=>{
                const myMatches=userCourses.filter(c=>c.name.toLowerCase().includes(courseSearch.toLowerCase())).slice(0,3);
                const cachedMatches=courses.filter(c=>c.name.toLowerCase().includes(courseSearch.toLowerCase())||c.location?.toLowerCase().includes(courseSearch.toLowerCase())).slice(0,5);
                const apiMatches=golfApiResults.filter(r=>!cachedMatches.some(c=>c.golfapi_id&&c.golfapi_id===String(r.golfapi_club_id)));
                if(!myMatches.length&&!cachedMatches.length&&!apiMatches.length&&!golfApiLoading)return null;
                return(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:100,background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:'0 0 4px 4px',maxHeight:260,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,0.4)'}}>
                    {myMatches.map(c=>(
                      <div key={'u-'+c.id} onMouseDown={()=>{setForm(p=>({...p,course:c.name,rating:String(c.rating),slope:c.slope,tee:c.tee||''}));setCourseSearch(c.name);setShowDropdown(false);setSelectedCourse(null);setGolfApiResults([]);setGolfApiClub(null);setSelectedGolfCourse('');}}
                        style={{padding:'10px 14px',cursor:'pointer',borderBottom:'1px solid rgba(232,184,75,0.1)',display:'flex',justifyContent:'space-between',alignItems:'center'}}
                        onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <div style={{fontSize:14,color:'#f5f0e8'}}>{c.name}</div>
                        <div style={{fontSize:9,letterSpacing:1,color:'rgba(201,168,76,0.5)',textTransform:'uppercase'}}>My Course</div>
                      </div>
                    ))}
                    {cachedMatches.map(c=>(
                      <div key={'db-'+c.id} onMouseDown={()=>{setForm(p=>({...p,course:c.name,rating:'',tee:''}));setCourseSearch(c.name);setShowDropdown(false);setSelectedCourse(c);setGolfApiResults([]);setGolfApiClub(null);setSelectedGolfCourse('');}}
                        style={{padding:'10px 14px',cursor:'pointer',borderBottom:'1px solid rgba(232,184,75,0.1)'}}
                        onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <div style={{fontSize:14,color:'#f5f0e8'}}>{c.name}</div>
                        <div style={{fontSize:8,letterSpacing:1,color:'rgba(232,184,75,0.6)',marginTop:2}}>{c.location}</div>
                      </div>
                    ))}
                    {golfApiLoading&&<div style={{padding:'10px 14px',fontSize:11,color:'rgba(245,240,232,0.3)',letterSpacing:1}}>Searching courses...</div>}
                    {!golfApiLoading&&apiMatches.map(c=>(
                      <div key={'api-'+c.golfapi_club_id} onMouseDown={async()=>{
                        setShowDropdown(false);setGolfApiResults([]);
                        setForm(p=>({...p,course:c.name,rating:'',tee:''}));setCourseSearch(c.name);setGolfClubName(c.name);
                        setGolfApiFetchLoading(true);
                        if(c.courses&&c.courses.length===1){
                          try{const res=await fetch(`${API_BASE}/api/golf-search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'fetchCourse',courseId:c.courses[0].courseID,clubId:c.golfapi_club_id,location:c.location,clubName:c.name})});const data=await res.json();if(res.ok&&data.course){setSelectedCourse(data.course);setCourses(prev=>{if(prev.some(p=>p.id===data.course.id))return prev;return[...prev,data.course].sort((a,b)=>a.name.localeCompare(b.name));});}}catch{}
                        } else if(c.courses&&c.courses.length>1){
                          setGolfApiClub({clubId:c.golfapi_club_id,clubName:c.name,location:c.location,courses:c.courses});
                          setSelectedGolfCourse('');
                        } else {
                          try{const res=await fetch(`${API_BASE}/api/golf-search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'fetchClub',clubId:c.golfapi_club_id})});const data=await res.json();if(res.ok){if(data.courses&&data.courses.length===1){const r2=await fetch(`${API_BASE}/api/golf-search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'fetchCourse',courseId:data.courses[0].courseID,clubId:c.golfapi_club_id,location:data.location,clubName:data.clubName})});const d2=await r2.json();if(r2.ok&&d2.course){setSelectedCourse(d2.course);setCourses(prev=>{if(prev.some(p=>p.id===d2.course.id))return prev;return[...prev,d2.course].sort((a,b)=>a.name.localeCompare(b.name));});}}else if(data.courses&&data.courses.length>1){setGolfApiClub({clubId:c.golfapi_club_id,clubName:c.name,location:c.location,courses:data.courses});setSelectedGolfCourse('');}}}catch{}
                        }
                        setGolfApiFetchLoading(false);
                      }}
                        style={{padding:'10px 14px',cursor:'pointer',borderBottom:'1px solid rgba(232,184,75,0.1)',display:'flex',justifyContent:'space-between',alignItems:'center'}}
                        onMouseEnter={e=>e.currentTarget.style.background='rgba(232,184,75,0.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <div>
                          <div style={{fontSize:14,color:'#f5f0e8'}}>{c.name}</div>
                          <div style={{fontSize:8,letterSpacing:1,color:'rgba(232,184,75,0.6)',marginTop:2}}>{c.location}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {golfApiFetchLoading&&<div style={{fontSize:10,color:'rgba(245,240,232,0.3)',letterSpacing:1,marginTop:6,paddingLeft:4}}>Loading course details...</div>}
            </div>

            {/* Multi-course picker */}
            {golfApiClub&&(
              <div style={{marginBottom:12}}>
                <label style={{...S.label,paddingLeft:2}}>Select Course Played</label>
                <select value={selectedGolfCourse} onChange={async e=>{
                  const cId=e.target.value;
                  setSelectedGolfCourse(cId);
                  if(!cId)return;
                  setGolfApiFetchLoading(true);
                  try{const res=await fetch(`${API_BASE}/api/golf-search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'fetchCourse',courseId:cId,clubId:golfApiClub.clubId,location:golfApiClub.location,clubName:golfApiClub.clubName})});const data=await res.json();if(res.ok&&data.course){setSelectedCourse(data.course);setCourses(prev=>{if(prev.some(p=>p.id===data.course.id))return prev;return[...prev,data.course].sort((a,b)=>a.name.localeCompare(b.name));});}}catch{}
                  setGolfApiFetchLoading(false);
                }} style={{...S.input,colorScheme:'dark',cursor:'pointer',paddingLeft:7}}>
                  <option value="">Select...</option>
                  {golfApiClub.courses.map(c=><option key={c.courseID} value={c.courseID}>{c.courseName}</option>)}
                </select>
                {golfApiFetchLoading&&<div style={{fontSize:10,color:'rgba(245,240,232,0.3)',letterSpacing:1,marginTop:6,paddingLeft:4}}>Loading course details...</div>}
              </div>
            )}

            {selectedCourse&&(
              <div style={{marginBottom:12}}>
                <label style={{...S.label,paddingLeft:2}}>Tees</label>
                <select value={form.tee} onChange={e=>{const t=selectedCourse.tees.find(t=>t.name===e.target.value);setForm(p=>({...p,tee:e.target.value,rating:t?String(t.rating):'',slope:t?t.slope:null}));setEditRating(false);setEditSlope(false);}} style={{...S.input,colorScheme:'dark',cursor:'pointer',paddingLeft:7}}>
                  <option value="">Select...</option>
                  {selectedCourse.tees.map(t=><option key={t.name} value={t.name}>{form.tee===t.name?t.name:`${t.name} — ${t.rating}, Slope ${t.slope||'—'}`}</option>)}
                </select>
              </div>
            )}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div>
                <label style={{...S.label,opacity:form.tee&&!editRating?0.4:1}}>Course Rating</label>
                <div style={{position:'relative'}}>
                  <input style={{...S.input,opacity:form.tee&&!editRating?0.5:1,paddingLeft:10,paddingRight:36,height:48,boxSizing:'border-box'}} type="number" step="0.1" value={form.rating} onChange={e=>setForm(p=>({...p,rating:e.target.value}))} readOnly={!!form.tee&&!editRating}/>
                  {form.tee && <button onClick={()=>setEditRating(p=>!p)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',padding:0,lineHeight:1,fontSize:16,color:'#e8b84b'}}>
                    {editRating ? '✓' : <span style={{fontSize:9,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:'rgba(201,168,76,0.6)'}}>Edit</span>}
                  </button>}
                </div>
              </div>
              <div>
                <label style={{...S.label,opacity:form.tee&&!editSlope?0.4:1}}>Slope</label>
                <div style={{position:'relative'}}>
                  <input style={{...S.input,opacity:form.tee&&!editSlope?0.5:1,paddingLeft:10,paddingRight:36,height:48,boxSizing:'border-box'}} type="number" value={form.slope||''} onChange={e=>setForm(p=>({...p,slope:e.target.value}))} readOnly={!!form.tee&&!editSlope}/>
                  {form.tee && <button onClick={()=>setEditSlope(p=>!p)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',padding:0,lineHeight:1,fontSize:16,color:'#e8b84b'}}>
                    {editSlope ? '✓' : <span style={{fontSize:9,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:'rgba(201,168,76,0.6)'}}>Edit</span>}
                  </button>}
                </div>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div><label style={S.label}>Score</label><input style={{...S.input,paddingLeft:10,height:48,boxSizing:'border-box'}} type="number" min="50" max="200" value={form.score} onChange={e=>setForm(p=>({...p,score:e.target.value}))}/></div>
              <div style={{position:'relative'}}>
                <label style={S.label}>Date of Round</label>
                <div style={{...S.input,height:48,boxSizing:'border-box',display:'flex',alignItems:'center',justifyContent:'space-between',paddingLeft:10,paddingRight:10,cursor:'pointer',position:'relative'}}>
                  <span style={{color:form.date?'#f5f0e8':'rgba(245,240,232,0.2)',fontSize:14}}>{form.date ? new Date(form.date+'T00:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'numeric'}) : '—'}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="3" width="14" height="12" rx="2" stroke="rgba(232,184,75,0.6)" strokeWidth="1.2" fill="none"/>
                    <line x1="1" y1="6.5" x2="15" y2="6.5" stroke="rgba(232,184,75,0.6)" strokeWidth="1.2"/>
                    <line x1="5" y1="1" x2="5" y2="5" stroke="rgba(232,184,75,0.6)" strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="11" y1="1" x2="11" y2="5" stroke="rgba(232,184,75,0.6)" strokeWidth="1.2" strokeLinecap="round"/>
                    <rect x="3.5" y="8.5" width="2" height="2" rx="0.3" fill="rgba(232,184,75,0.6)"/>
                    <rect x="7" y="8.5" width="2" height="2" rx="0.3" fill="rgba(232,184,75,0.6)"/>
                    <rect x="10.5" y="8.5" width="2" height="2" rx="0.3" fill="rgba(232,184,75,0.6)"/>
                    <rect x="3.5" y="11.5" width="2" height="2" rx="0.3" fill="rgba(232,184,75,0.6)"/>
                    <rect x="7" y="11.5" width="2" height="2" rx="0.3" fill="rgba(232,184,75,0.6)"/>
                  </svg>
                  <input type="date" value={form.date} max={localDateStr()} onChange={e=>setForm(p=>({...p,date:e.target.value}))} style={{position:'absolute',inset:0,opacity:0,width:'100%',height:'100%',cursor:'pointer'}} />
                </div>
              </div>
            </div>
            <button style={{...S.btn,opacity:(!form.score||!form.rating)?0.4:1,background:added?'linear-gradient(135deg,#4caa18,#2d7a0e)':S.btn.background}} onClick={()=>{if(!form.score||!form.rating)return;const hasSameDay=rounds.some(r=>r.date===form.date);if(hasSameDay){setSameDayModal(true);}else{setConfirmPost(true);}}} disabled={!form.score||!form.rating}>
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
                <select value={courseFilter} onChange={e=>setCourseFilter(e.target.value)} style={{...S.input,background:'#0d1b2e',colorScheme:'dark',cursor:'pointer',paddingLeft:8,fontSize:11,padding:'6px 8px',width:'auto',minWidth:0,maxWidth:160}}>
                  <option value="all">All Courses</option>
                  {[...new Set(rounds.map(r=>r.course))].sort().map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div style={{maxHeight:'65vh',overflowY:'auto'}}>
              {loadingRounds ? (
                <div style={{textAlign:'center',padding:'32px 20px',color:'rgba(245,240,232,0.4)',fontSize:13,letterSpacing:2}}>Loading...</div>
              ) : rounds.length===0 ? (
                <div style={{textAlign:'center',padding:0,minHeight:168,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <div style={{fontStyle:'italic',fontSize:15,color:'rgba(201,168,76,0.6)'}}>No rounds posted yet.</div>
                </div>
              ) : (()=>{
                const filtered=courseFilter==='all'?rounds:rounds.filter(r=>r.course===courseFilter);
                if(filtered.length===0) return <div style={{textAlign:'center',padding:'32px 20px',color:'rgba(245,240,232,0.4)',fontSize:13}}>No rounds found for this course</div>;
                return filtered.map((r,i)=>(
                  <div key={r.id} style={{...S.roundItem(courseFilter==='all'&&i>=18), cursor:'default'}}>
                    <div style={S.roundScore}>{r.score}</div>
                    <div style={S.roundDetails}>
                      <div style={S.roundCourse}>{r.course}</div>
                      <div style={S.roundMeta}>{new Date(r.date+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',flexShrink:0,paddingRight:8}}>
                      <div style={{position:'relative',display:'inline-flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer'}} onClick={()=>setSelectedRound(r)}>
                        <svg width="22" height="26" viewBox="0 0 22 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2 1H14L20 7V25H2V1Z" fill="rgba(8,18,36,0.8)" stroke="#e8b84b" strokeWidth="1.2" strokeLinejoin="round"/>
                          <path d="M14 1V7H20" fill="none" stroke="#e8b84b" strokeWidth="1.2" strokeLinejoin="round"/>
                          <line x1="6" y1="12" x2="16" y2="12" stroke="#ffffff" strokeWidth="1" strokeLinecap="round"/>
                          <line x1="6" y1="16" x2="16" y2="16" stroke="#ffffff" strokeWidth="1" strokeLinecap="round"/>
                          <line x1="6" y1="20" x2="12" y2="20" stroke="#ffffff" strokeWidth="1" strokeLinecap="round"/>
                        </svg>
                        {isDeletable(r)&&(
                          <button onClick={e=>{e.stopPropagation();setPendingDelete(r.id);}} style={{position:'absolute',top:-11,right:-5,background:'none',border:'none',color:'rgba(224,34,71,0.7)',fontSize:14,cursor:'pointer',padding:0,lineHeight:1,fontWeight:900}}>✕</button>
                        )}
                        <div style={{fontSize:6,fontWeight:600,letterSpacing:1,textTransform:'uppercase',color:'#e8b84b',textAlign:'center',lineHeight:1.3}}>Round<br/>Detail</div>
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
            const isCurrentMonth = year===todayD.getFullYear() && month===todayD.getMonth();
            const snapshotDate = new Date(year,month+1,1);
            const r2 = isCurrentMonth 
              ? rounds.filter(r=>r.score!=null&&r.rating!=null).sort((a,b)=>new Date(b.date)-new Date(a.date))
              : rounds.filter(r=>new Date(r.date+'T00:00:00')<snapshotDate).sort((a,b)=>new Date(b.date)-new Date(a.date));
            return{label,value: isCurrentMonth ? calcHandicapDecimal(r2, null) : calcHandicapDecimal(r2, snapshotDate)};
          });
          const withVal=data.filter(m=>m.value!==null);
          const maxH=withVal.length?Math.max(...withVal.map(m=>m.value)):0;
          const minH=withVal.length?Math.min(...withVal.map(m=>m.value)):0;
          const maxHr=parseFloat(maxH.toFixed(1)),minHr=parseFloat(minH.toFixed(1));
          const maxIdx=data.map((m,i)=>m.value!==null&&parseFloat(m.value.toFixed(1))===maxHr?i:-1).filter(i=>i!==-1).pop();
          const minIdx=data.map((m,i)=>m.value!==null&&parseFloat(m.value.toFixed(1))===minHr?i:-1).filter(i=>i!==-1).pop();
          return(
            <>
              <div style={S.statGrid}>
                <div style={S.statBox}><div style={S.statLabel}>All-Time<br/>Rounds Posted</div><div style={S.statVal}>{rounds.length.toLocaleString()}</div></div>
                <div style={S.statBox}><div style={{...S.statLabel,marginTop:5}}>Rounds Posted YTD</div><div style={S.statVal}>{ytdRounds}</div></div>
                <div onClick={()=>setExpandedStat(p=>p==='score'?null:'score')} style={{...S.statBox,position:'relative',cursor:'pointer',border:expandedStat==='score'?'1px solid rgba(232,184,75,0.55)':'1px solid rgba(201,168,76,0.15)',transition:'border-color 0.2s',overflow:'hidden'}}>
                  <div style={S.statLabel}>Lowest Score</div>
                  <div style={S.statVal}>{minScore??'—'}</div>
                  <div style={{maxHeight:expandedStat==='score'&&minScoreRound?48:0,opacity:expandedStat==='score'&&minScoreRound?1:0,transition:'max-height 0.25s ease, opacity 0.2s ease',overflow:'hidden'}}>
                    <div style={{fontSize:10,color:'rgba(180,175,170,0.7)',marginTop:8,lineHeight:1.6}}>
                      <div>{minScoreRound?new Date(minScoreRound.date+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):''}</div>
                      <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{minScoreRound?minScoreRound.course:''}</div>
                    </div>
                  </div>
                  <span style={{position:'absolute',bottom:8,right:10,fontSize:14,color:'#e8b84b',transform:expandedStat==='score'?'rotate(90deg)':'none',transition:'transform 0.2s ease',lineHeight:1}}>›</span>
                </div>
                <div onClick={()=>setExpandedStat(p=>p==='hcp'?null:'hcp')} style={{...S.statBox,position:'relative',cursor:'pointer',border:expandedStat==='hcp'?'1px solid rgba(232,184,75,0.55)':'1px solid rgba(201,168,76,0.15)',transition:'border-color 0.2s',overflow:'hidden'}}>
                  <div style={S.statLabel}>Lowest Handicap</div>
                  <div style={S.statVal}>{lowestHandicap!==null&&lowestHandicap!==undefined?(lowestHandicap<0?('+'+(Math.floor(Math.abs(lowestHandicap)*10)/10).toFixed(1)):(Math.floor(lowestHandicap*10)/10).toFixed(1)):'—'}</div>
                  <div style={{maxHeight:expandedStat==='hcp'&&lowestHandicapDate?28:0,opacity:expandedStat==='hcp'&&lowestHandicapDate?1:0,transition:'max-height 0.25s ease, opacity 0.2s ease',overflow:'hidden'}}>
                    <div style={{fontSize:10,color:'rgba(180,175,170,0.7)',marginTop:8}}>{lowestHandicapDate?new Date(lowestHandicapDate+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):''}</div>
                  </div>
                  <span style={{position:'absolute',bottom:8,right:10,fontSize:14,color:'#e8b84b',transform:expandedStat==='hcp'?'rotate(90deg)':'none',transition:'transform 0.2s ease',lineHeight:1}}>›</span>
                </div>
                <div style={{...S.statBox,gridColumn:'span 2',justifyContent:'center',gap:8}}>
                  <div style={{...S.statLabel,marginBottom:0}}>All-Time Scoring Average</div>
                  <div style={S.statVal}>{rounds.length>0?(rounds.reduce((s,r)=>s+r.score,0)/rounds.length).toFixed(1):'—'}</div>
                </div>
                {(()=>{
                  let eligible=0,beaten=0;
                  for(let i=0;i<rounds.length;i++){const pr=rounds.slice(i+1);if(pr.length<10)continue;const hcp=calcHandicapDecimal(pr);if(hcp===null)continue;eligible++;const d=calcDifferential(rounds[i].score,rounds[i].rating,rounds[i].slope);if(d<hcp)beaten++;}
                  if(eligible===0)return(
                    <div style={{...S.statBox,gridColumn:'span 2',justifyContent:'center',gap:8}}>
                      <div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:5}}>
                        <div style={{...S.statLabel,marginBottom:0}}>Handicap Beat Rate</div>
                        <span className="info-tooltip" onClick={e=>{e.stopPropagation();e.currentTarget.classList.toggle('active');}} style={{transform:'translateY(2px)'}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="rgba(245,240,232,0.7)" strokeWidth="1.5"/><line x1="12" y1="11" x2="12" y2="17" stroke="rgba(245,240,232,0.7)" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="7" r="1" fill="rgba(245,240,232,0.7)"/></svg><span className="tooltip-text" style={{bottom:'20px',top:'auto',left:'-35px',transform:'none',right:'auto',width:155,textAlign:'left',lineHeight:'1.5',padding:'6px 8px',whiteSpace:'normal'}}>% of rounds you've<br/>outplayed your handicap</span></span>
                      </div>
                      <div style={S.statVal}>—</div>
                      <div style={{fontSize:8,letterSpacing:1,color:'rgba(245,240,232,0.4)',marginTop:6}}>will display after 11 rounds are posted</div>
                    </div>
                  );
                  const rawPct=(beaten/eligible)*100;
                  const pct=rawPct===50?50:rawPct>50?Math.max(51,Math.ceil(rawPct)):Math.min(49,Math.floor(rawPct));
                  return(
                    <div style={{...S.statBox,gridColumn:'span 2',justifyContent:'center',gap:8}}>
                      <div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:5}}>
                        <div style={{...S.statLabel,marginBottom:0}}>Handicap Beat Rate</div>
                        <span className="info-tooltip" onClick={e=>{e.stopPropagation();e.currentTarget.classList.toggle('active');}} style={{transform:'translateY(2px)'}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="rgba(245,240,232,0.7)" strokeWidth="1.5"/><line x1="12" y1="11" x2="12" y2="17" stroke="rgba(245,240,232,0.7)" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="7" r="1" fill="rgba(245,240,232,0.7)"/></svg><span className="tooltip-text" style={{bottom:'20px',top:'auto',left:'-35px',transform:'none',right:'auto',width:155,textAlign:'left',lineHeight:'1.5',padding:'6px 8px',whiteSpace:'normal'}}>% of rounds you've<br/>outplayed your handicap</span></span>
                      </div>
                      <div style={{...S.statVal,color:pct<50?'#e02247':pct===50?'#e8b84b':'#84e040'}}>{pct}%</div>
                    </div>
                  );
                })()}
              </div>
              {withVal.length===0&&(
                <div style={{...S.card,background:'rgba(8,18,36,0.6)',textAlign:'center',position:'relative'}}><span className="info-tooltip" onClick={e=>{e.stopPropagation();e.currentTarget.classList.toggle('active');}} style={{position:'absolute',top:5,right:7}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="rgba(245,240,232,0.7)" strokeWidth="1.5"/><line x1="12" y1="11" x2="12" y2="17" stroke="rgba(245,240,232,0.7)" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="7" r="1" fill="rgba(245,240,232,0.7)"/></svg><span className="tooltip-text" style={{bottom:'3px',top:'auto',left:'auto',right:'-8px',transform:'none',width:168,textAlign:'center',lineHeight:'1.5',padding:'6px 10px',whiteSpace:'normal',textTransform:'none',letterSpacing:'0.3px'}}>Chart values are based on<br/>end of month handicap</span></span>
                  <div style={{...S.cardTitle,textAlign:'center',marginBottom:12}}>Handicap Trend (<span className="ttm-tooltip">TTM<span className="tooltip-text" style={{textTransform:"none"}}>Trailing Twelve Months</span></span>)</div>
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
                const PAD_L=38,PAD_R=8,PAD_T=24,PAD_B=28,W=340,H=180,AXIS_X=20;
                const chartW=W-PAD_L-PAD_R,chartH=H-PAD_T-PAD_B;
                const pad=Math.max((maxH-minH)*0.15,0.3);const chartMin=minH-pad,chartMax=maxH+pad,chartRange=chartMax-chartMin||1;
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
                  <div style={{...S.card,background:'rgba(8,18,36,0.6)',position:'relative'}}><span className="info-tooltip" onClick={e=>{e.stopPropagation();e.currentTarget.classList.toggle('active');}} style={{position:'absolute',top:5,right:7}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="rgba(245,240,232,0.7)" strokeWidth="1.5"/><line x1="12" y1="11" x2="12" y2="17" stroke="rgba(245,240,232,0.7)" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="7" r="1" fill="rgba(245,240,232,0.7)"/></svg><span className="tooltip-text" style={{bottom:'3px',top:'auto',left:'auto',right:'-8px',transform:'none',width:168,textAlign:'center',lineHeight:'1.5',padding:'6px 10px',whiteSpace:'normal',textTransform:'none',letterSpacing:'0.3px'}}>Chart values are based on<br/>end of month handicap</span></span>
                    <div style={{...S.cardTitle,textAlign:'center'}}>Handicap Trend (<span className="ttm-tooltip">TTM<span className="tooltip-text" style={{textTransform:"none"}}>Trailing Twelve Months</span></span>)</div>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',display:'block'}}>
                      <line x1={AXIS_X} y1={H-PAD_B} x2={W} y2={H-PAD_B} stroke="rgba(245,240,232,0.15)" strokeWidth="1" strokeDasharray="3,3"/>
                      <line x1={AXIS_X} y1={PAD_T} x2={AXIS_X} y2={H-PAD_B} stroke="rgba(245,240,232,0.15)" strokeWidth="1" strokeDasharray="3,3"/>
                      {chartMin<=0&&chartMax>=0&&<text x={AXIS_X-7} y={toY(0)+3.5} textAnchor="end" fill="rgba(245,240,232,0.5)" fontSize="7">0</text>}
                      <text x={AXIS_X-7} y={toY(maxH)-4} textAnchor="end" fill="rgba(245,240,232,0.85)" fontSize="7">{maxH<0?`+${(Math.floor(Math.abs(maxH)*10)/10).toFixed(1)}`:(Math.floor(maxH*10)/10).toFixed(1)}</text>
                      <text x={AXIS_X-7} y={toY(minH)+8} textAnchor="end" fill="rgba(245,240,232,0.85)" fontSize="7">{minH<0?`+${(Math.floor(Math.abs(minH)*10)/10).toFixed(1)}`:(Math.floor(minH*10)/10).toFixed(1)}</text>
                      {segments.map((s,i)=><line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth="2" strokeLinecap="round"/>)}
                      {valid.map((p,i)=>{
                        const isMax=withVal.length>=3&&p.i===maxIdx,isMin=withVal.length>=3&&p.i===minIdx;
                        const color=isMax?'#e02247':isMin?'#84e040':'#e8b84b';
                        return(
                          <g key={i}>
                            <circle cx={p.x} cy={p.y} r={isMax||isMin?3.5:2.5} fill={color}/>
                            <text x={p.x} y={p.y-(isMax||isMin?8:6)} textAnchor="middle" fill={color} fontSize="7" fontWeight={isMax||isMin?"700":"400"} opacity={isMax||isMin?1:0.7}>{p.v<0?`+${(Math.floor(Math.abs(p.v)*10)/10).toFixed(1)}`:(Math.floor(p.v*10)/10).toFixed(1)}</text>
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
        {tab==="partners"&&(
          <PartnersPanel
            user={user}
            partners={partners}
            partnerRequests={partnerRequests}
            sentRequests={sentRequests}
            trends={trends}
            streaks={streaks}
            setTrends={setTrends}
            setStreaks={setStreaks}
            handicaps={handicaps}
            setHandicaps={setHandicaps}
            partnerRoundCounts={partnerRoundCounts}
            setPartnerRoundCounts={setPartnerRoundCounts}
            userRounds={rounds}
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
            onBack={()=>setTab('calculator')}
            drawerAuthHeaders={authHeadersAsync}
            SUPABASE_URL={SUPABASE_URL}
            inline={true}
          />
        )}
      </div>
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────────
export default function GolfHandicapApp() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [welcomeUser, setWelcomeUser] = useState(null);
  const skipSessionRestore = useRef(false);
  const launchUrlResolved = useRef(!window.Capacitor?.isNativePlatform?.());

  const restHeaders = () => {
    try {
      const s = JSON.parse(localStorage.getItem("sb-session") || "{}");
      const token = s?.access_token || SUPABASE_ANON_KEY;
      return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` };
    } catch { return { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }; }
  };

  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [verifiedUser, setVerifiedUser] = useState(null);
  const [forceLogin, setForceLogin] = useState(false);
  const [forceSignup, setForceSignup] = useState(false);
  const [preFillMemberNumber, setPreFillMemberNumber] = useState('');
  const [preFillNonce, setPreFillNonce] = useState(0);
  const [fromEmailLink, setFromEmailLink] = useState(false);
  const [reactivationReturn, setReactivationReturn] = useState(false);
  const [resetToken, setResetToken] = useState(() => window.Capacitor?.isNativePlatform?.() ? null : (sessionStorage.getItem('dtm-reset-token') || null));
  const [exchangeError, setExchangeError] = useState(null);
  const [linkError, setLinkError] = useState(false);
  const [resendVerify, setResendVerify] = useState(false);
  const universalCodePending = useRef(false);

  useEffect(() => {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    try { Purchases.configure({ apiKey: RC_API_KEY }); } catch {}
    let listener;
    const handleVerifiedUrl = async (url) => {
      try {
        const params = new URLSearchParams(url.split('?')[1] || '');
        const token = decodeURIComponent(params.get('token') || '');
        const userId = decodeURIComponent(params.get('userId') || '');
        if (!token || !userId) return;
        localStorage.setItem('sb-session', JSON.stringify({ access_token: token, user: { id: userId } }));
        let profile = null;
        try {
          const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.pgrst.object+json' }
          });
          if (profRes.ok) profile = await profRes.json();
        } catch {}
        await Purchases.logIn({ appUserID: userId }).catch(() => {});
        setForceLogin(false);
        setAuthUser({ id: userId, name: profile?.name || '', lastName: profile?.last_name || '', email: profile?.email || '', memberNumber: profile?.member_number || null, createdAt: profile?.created_at || null, subscribed: profile?.subscribed || false, subscriptionRenewsAt: profile?.subscription_renews_at || null, stripeCustomerId: profile?.stripe_customer_id || null, paymentProvider: profile?.payment_provider || null });
        setAuthLoading(false);
      } catch {}
    };
    const handleReactivationUrl = async () => {
      try {
        const savedSession = JSON.parse(localStorage.getItem('sb-session') || 'null');
        if (!savedSession?.access_token) return;
        const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${savedSession.user.id}&select=*`, {
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
        });
        const profile = await profRes.json();
        if (profRes.ok && profile?.name) {
          setAuthUser({ id: savedSession.user.id, name: profile.name, lastName: profile.last_name || '', email: profile.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: true, subscriptionRenewsAt: profile.subscription_renews_at || null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null });
          setAuthLoading(false);
        }
      } catch {}
    };
    const handleResetUrl = (url) => {
      const token = decodeURIComponent(new URLSearchParams(url.split('?')[1] || '').get('token') || '');
      if (!token) return;
      setResetToken(token);
      setAuthLoading(false);
    };
    const handleMagicLinkUrl = async (url) => {
      const hash = url.split('#')[1] || '';
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (!accessToken) return;
      setResendVerify(false);
      setAuthLoading(true);
      try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}` }
        });
        const userData = await userRes.json();
        if (!userRes.ok || !userData?.id) { setAuthLoading(false); return; }
        let profile = null;
        for (let i = 0; i < 3; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 1000));
          const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=*`, {
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.pgrst.object+json' }
          });
          if (pr.ok) { profile = await pr.json(); break; }
        }
        const session = { access_token: accessToken, refresh_token: refreshToken || null, user: userData };
        localStorage.setItem('sb-session', JSON.stringify(session));
        await Purchases.logIn({ appUserID: userData.id }).catch(() => {});
        setAuthUser({ id: userData.id, name: profile?.name || '', lastName: profile?.last_name || '', email: profile?.email || userData.email, memberNumber: profile?.member_number || null, createdAt: profile?.created_at || null, subscribed: profile?.subscribed || false, subscriptionRenewsAt: profile?.subscription_renews_at || null, stripeCustomerId: profile?.stripe_customer_id || null, paymentProvider: profile?.payment_provider || null });
      } catch {}
      setAuthLoading(false);
    };
    const handleUniversalVerifyCode = async (url) => {
      if (universalCodePending.current) return;
      universalCodePending.current = true;
      try {
        const code = new URLSearchParams(url.split('?')[1] || '').get('code');
        const hash = url.split('#')[1] || '';
        const hashParams = new URLSearchParams(hash);
        const hashToken = hashParams.get('access_token');
        const hashType = hashParams.get('type');
        let accessToken = null;
        let userData = null;
        if (code) {
          const exchangeRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify({ auth_code: code, code_verifier: localStorage.getItem('pkce_verifier') || '' })
          });
          const exchangeData = await exchangeRes.json();
          if (!exchangeRes.ok || !exchangeData?.access_token) {
            setExchangeError(`Exchange failed (${exchangeRes.status}): ${JSON.stringify(exchangeData)}`);
            universalCodePending.current = false;
            setAuthLoading(false);
            return;
          }
          accessToken = exchangeData.access_token;
          userData = exchangeData.user;
          const session = { access_token: accessToken, refresh_token: exchangeData.refresh_token || null, expires_at: exchangeData.expires_in ? Math.floor(Date.now()/1000) + exchangeData.expires_in : null, user: userData };
          localStorage.setItem('sb-session', JSON.stringify(session));
        } else if (hashToken) {
          accessToken = hashToken;
          if (hashType === 'recovery') {
            setAuthUser(null);
            setWelcomeUser(null);
            setResetToken(accessToken);
            universalCodePending.current = false;
            setAuthLoading(false);
            return;
          }
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}` }
          });
          if (!userRes.ok) {
            setExchangeError(`User fetch failed (${userRes.status})`);
            universalCodePending.current = false;
            setAuthLoading(false);
            return;
          }
          userData = await userRes.json();
          localStorage.setItem('sb-session', JSON.stringify({ access_token: accessToken, user: userData }));
        } else {
          setExchangeError(`No code or token found in URL: ${url.substring(0,120)}`);
          universalCodePending.current = false;
          setAuthLoading(false);
          return;
        }
        let profile = null;
        try {
          const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=*`, {
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.pgrst.object+json' }
          });
          if (profRes.ok) profile = await profRes.json();
        } catch {}
        if (profile?.subscribed) {
          setAuthUser(null);
          setWelcomeUser(null);
          setResetToken(accessToken);
        } else {
          await Purchases.logIn({ appUserID: userData.id }).catch(() => {});
          setForceLogin(false);
          setAuthUser({ id: userData.id, name: profile?.name || userData.raw_user_meta_data?.name || '', lastName: profile?.last_name || userData.raw_user_meta_data?.last_name || '', email: profile?.email || userData.email, memberNumber: profile?.member_number || null, createdAt: profile?.created_at || null, subscribed: false, subscriptionRenewsAt: null, stripeCustomerId: profile?.stripe_customer_id || null, paymentProvider: profile?.payment_provider || null });
        }
      } catch (e) {
        setExchangeError(`Error: ${e?.message || String(e)}`);
      }
      universalCodePending.current = false;
      setAuthLoading(false);
    };
    const dispatchUniversalUrl = (url) => {
      if (!url) return false;
      const hasCode = new URLSearchParams(url.split('?')[1] || '').get('code');
      const hasHashToken = url.includes('#access_token=');
      if (hasCode || hasHashToken) { skipSessionRestore.current = true; handleUniversalVerifyCode(url); return true; }
      return false;
    };
    CapApp.getLaunchUrl().then(result => {
      if (!result?.url) { launchUrlResolved.current = true; return; }
      if (result.url.includes('payment/reactivated')) { launchUrlResolved.current = true; handleReactivationUrl(); }
      else if (result.url.includes('verified')) { launchUrlResolved.current = true; handleVerifiedUrl(result.url); }
      else if (result.url.includes('reset?token')) { launchUrlResolved.current = true; handleResetUrl(result.url); }
      else if (result.url.includes('access_token=')) { skipSessionRestore.current = true; launchUrlResolved.current = true; handleMagicLinkUrl(result.url); }
      else if (result.url.includes('error=')) { launchUrlResolved.current = true; skipSessionRestore.current = true; if (result.url.includes('ltype=reset')) { setLinkError(true); } else { setResendVerify(true); } setAuthLoading(false); }
      else {
        if (dispatchUniversalUrl(result.url)) { launchUrlResolved.current = true; return; }
        const params = new URLSearchParams(result.url.split('?')[1] || '');
        const mn = params.get('memberNumber');
        if (mn) { setPreFillMemberNumber(mn); setPreFillNonce(n => n + 1); skipSessionRestore.current = true; }
        skipSessionRestore.current = true;
        launchUrlResolved.current = true;
        if (params.get('screen') === 'signup') { setForceSignup(true); } else { setForceLogin(true); }
        setAuthLoading(false);
      }
    }).catch(() => { launchUrlResolved.current = true; });
    CapApp.addListener('appUrlOpen', async (data) => {
      try { await Browser.close(); } catch {}
      if (data.url?.includes('payment/reactivated')) handleReactivationUrl();
      else if (data.url?.includes('verified')) handleVerifiedUrl(data.url);
      else if (data.url?.includes('reset?token')) handleResetUrl(data.url);
      else if (data.url?.includes('access_token=')) { handleMagicLinkUrl(data.url); }
      else if (data.url?.includes('error=')) { if (data.url.includes('ltype=reset')) { setLinkError(true); } else { setResendVerify(true); } setAuthLoading(false); }
      else {
        if (dispatchUniversalUrl(data.url)) return;
        const params = new URLSearchParams(data.url?.split('?')[1] || '');
        const mn = params.get('memberNumber');
        if (mn) { setPreFillMemberNumber(mn); setPreFillNonce(n => n + 1); setAuthUser(null); setWelcomeUser(null); }
        if (params.get('screen') === 'signup') { setAuthUser(null); setWelcomeUser(null); setForceSignup(true); } else { setForceLogin(true); }
      }
    }).then(l => { listener = l; }).catch(() => {});
    return () => { listener?.remove(); };
  }, []);

  useEffect(() => {
    const restoreSession = async () => {
      if (window.Capacitor?.isNativePlatform?.()) {
        const start = Date.now();
        while (!launchUrlResolved.current && Date.now() - start < 2000) {
          await new Promise(r => setTimeout(r, 20));
        }
      }
      if (skipSessionRestore.current) { return; }
      try {
        // Check for PKCE code flow (new Supabase default)
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        if (urlParams.get('error') || hashParams.get('error')) {
          window.history.replaceState(null, '', '/');
          if (urlParams.get('ltype') === 'reset') { setLinkError(true); } else { setResendVerify(true); }
          setAuthLoading(false);
          return;
        }
        const screenParam = urlParams.get('screen');
        if ((screenParam === 'login' || window.location.pathname === '/login') && !urlParams.get('code') && !window.location.hash.includes('type=recovery')) {
          const mn = urlParams.get('memberNumber');
          if (mn) setPreFillMemberNumber(mn);
          window.history.replaceState(null, '', '/');
          setAuthLoading(false);
          setForceLogin(true);
          return;
        }
        if (screenParam === 'signup' && !urlParams.get('code') && !window.location.hash.includes('type=recovery')) {
          setAuthLoading(false);
          return;
        }
        const mnParam = urlParams.get('memberNumber');
        if (mnParam && !window.Capacitor?.isNativePlatform?.()) {
          setPreFillMemberNumber(mnParam);
          window.history.replaceState(null, '', '/');
          setAuthLoading(false);
          setForceLogin(true);
          return;
        }
        const paymentStatus = urlParams.get('payment');
        if (paymentStatus === 'cancelled') {
          window.history.replaceState(null, '', window.location.pathname);
          const savedSession = JSON.parse(localStorage.getItem('sb-session') || 'null');
          if (savedSession?.access_token) {
            try {
              const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${savedSession.user.id}&select=*`, {
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
              });
              const profile = await profRes.json();
              if (profRes.ok && profile?.name && !profile.subscribed) {
                const isLapsed = !!profile.stripe_customer_id;
                const endpoint = isLapsed ? `${API_BASE}/api/create-checkout-session-2` : `${API_BASE}/api/create-checkout-session`;
                const body = isLapsed
                  ? { email: profile.email || savedSession.user.email, userId: savedSession.user.id, reactivation: true }
                  : { email: profile.email || savedSession.user.email, userId: savedSession.user.id };
                const res = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const data = await res.json();
                if (data.url) { window.location.href = data.url; return; }
              }
            } catch {}
          }
          setAuthLoading(false);
          return;
        }
        if (paymentStatus === 'reactivated') {
          window.history.replaceState(null, '', window.location.pathname);
          const savedSession = JSON.parse(localStorage.getItem('sb-session') || 'null');
          if (savedSession?.access_token) {
            const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${savedSession.user.id}&select=*`, {
              headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
            });
            const profile = await profRes.json();
            if (profRes.ok && profile?.name) {
              const newUser = { id: savedSession.user.id, name: profile.name, lastName: profile.last_name || '', email: profile.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: true, subscriptionRenewsAt: profile.subscription_renews_at || null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null };
              setAuthUser(newUser);
              if (!window.Capacitor?.isNativePlatform?.() && /iPhone|iPad|iPod/.test(navigator.userAgent)) setReactivationReturn(true);
              setAuthLoading(false);
              return;
            }
          }
          if (!window.Capacitor?.isNativePlatform?.()) setReactivationReturn(true);
          setAuthLoading(false);
          return;
        }
        if (paymentStatus === 'success') {
          window.history.replaceState(null, '', window.location.pathname);
          // Payment complete — load user and show welcome screen with member number
          const savedSession = JSON.parse(localStorage.getItem('sb-session') || 'null');
          if (savedSession?.access_token) {
            const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${savedSession.user.id}&select=*`, {
              headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${savedSession.access_token}`, 'Accept': 'application/vnd.pgrst.object+json' }
            });
            const profile = await profRes.json();
            if (profRes.ok && profile?.name) {
              const newUser = { id: savedSession.user.id, name: profile.name, lastName: profile.last_name || '', email: profile.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: true, subscriptionRenewsAt: profile.subscription_renews_at || null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null };
              setWelcomeUser(newUser);
              setAuthLoading(false);
              return;
            }
          }
          setAuthLoading(false);
          return;
        }
        if (paymentStatus === 'pending') {
          // Email confirmed — extract session from URL hash (magic link puts it there)
          window.history.replaceState(null, '', window.location.pathname);
          const hash = window.location.hash;
          let session = JSON.parse(localStorage.getItem('sb-session') || 'null');
          if (hash && hash.includes('access_token')) {
            const hashParams = new URLSearchParams(hash.substring(1));
            const accessToken = hashParams.get('access_token');
            const refreshToken = hashParams.get('refresh_token');
            if (accessToken) {
              // Fetch user from token
              const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}` }
              });
              const userData = await userRes.json();
              if (userRes.ok && userData?.id) {
                session = { access_token: accessToken, refresh_token: refreshToken, user: userData };
                localStorage.setItem('sb-session', JSON.stringify(session));
              }
            }
          }
          if (session?.user) {
            try {
              const res = await fetch(`${API_BASE}/api/create-checkout-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: session.user.email, userId: session.user.id }),
              });
              const data = await res.json();
              if (data.url) window.location.href = data.url;
            } catch (e) {
              console.error('Checkout error:', e);
            }
          }
          setAuthLoading(false);
          return;
        }
        const code = urlParams.get('code');
        if (code) {
          // Exchange code for session
          const exchangeRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify({ auth_code: code, code_verifier: localStorage.getItem('pkce_verifier') || '' })
          });
          const exchangeData = await exchangeRes.json();
          if (exchangeRes.ok && exchangeData?.access_token) {
            const accessToken = exchangeData.access_token;
            const userData = exchangeData.user;
            const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=*`, {
              headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.pgrst.object+json' }
            });
            const profile = await profRes.json();
            window.history.replaceState(null, '', window.location.pathname);
            // Save session with refresh_token so retries work past the 1-hour access token expiry
            const session = { access_token: accessToken, refresh_token: exchangeData.refresh_token || null, expires_at: exchangeData.expires_in ? Math.floor(Date.now()/1000) + exchangeData.expires_in : null, user: userData };
            localStorage.setItem('sb-session', JSON.stringify(session));
            if (profRes.ok && profile?.name && profile.subscribed) {
              // Already paid — go straight to app
              const pendingUser = { id: userData.id, name: profile.name || userData.raw_user_meta_data?.name || '', lastName: profile.last_name || userData.raw_user_meta_data?.last_name || '', email: profile.email || userData.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: profile.subscribed || false, subscriptionRenewsAt: profile.subscription_renews_at || null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null };
              setAuthLoading(false);
              setVerifiedUser(pendingUser);
              return;
            }
            setAuthUser({ id: userData.id, name: profile.name || userData.raw_user_meta_data?.name || '', lastName: profile.last_name || userData.raw_user_meta_data?.last_name || '', email: profile.email || userData.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: false, subscriptionRenewsAt: null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null });
            setAuthLoading(false);
            return;
          }
          window.history.replaceState(null, '', window.location.pathname);
        }

        // Check if this is a redirect from email verification (legacy hash flow)
        const hash = window.location.hash;
        if (hash && hash.includes('access_token')) {
          const params = new URLSearchParams(hash.substring(1));
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          const type = params.get('type');
          if (accessToken && type === 'recovery') {
            window.history.replaceState(null, '', window.location.pathname);
            sessionStorage.setItem('dtm-reset-token', accessToken);
            setAuthLoading(false);
            setResetToken(accessToken);
            return;
          }
          if (accessToken && (type === 'signup' || type === 'email' || type === 'magiclink')) {
            // Fetch user info and profile with this token
            const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
              headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${accessToken}` }
            });
            const userData = await userRes.json();
            if (userRes.ok && userData?.id) {
              // Save session so they're logged in
              // Fetch their profile to get member number and name — retry up to 3 times
              let profile = null;
              let profRes = null;
              for (let attempt = 0; attempt < 3; attempt++) {
                if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
                profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=*`, {
                  headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${accessToken}`, "Accept": "application/vnd.pgrst.object+json" }
                });
                if (profRes.ok) { profile = await profRes.json(); break; }
              }
              if (profile) {
                const session = { access_token: accessToken, user: userData };
                localStorage.setItem('sb-session', JSON.stringify(session));
                window.history.replaceState(null, '', window.location.pathname);
                if (!profile.subscribed) {
                  setAuthUser({ id: userData.id, name: profile.name || userData.raw_user_meta_data?.name || '', lastName: profile.last_name || userData.raw_user_meta_data?.last_name || '', email: profile.email || userData.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: false, subscriptionRenewsAt: null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null });
                  setAuthLoading(false);
                  return;
                }
                const pendingUser = { id: userData.id, name: profile.name || userData.raw_user_meta_data?.name || '', lastName: profile.last_name || userData.raw_user_meta_data?.last_name || '', email: profile.email || userData.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: profile.subscribed || false, subscriptionRenewsAt: profile.subscription_renews_at || null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null };
                setAuthLoading(false);
                setVerifiedUser(pendingUser);
                return;
              }
            }
            window.history.replaceState(null, '', window.location.pathname);
            setAuthLoading(false);
            return;
          }
        }

        const raw = localStorage.getItem("sb-session");
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.access_token) {
            let token = s.access_token;
            // Refresh if expired and we have a refresh_token — no time limit on retries
            const isExpired = s.expires_at && Date.now()/1000 >= s.expires_at;
            if (isExpired && s.refresh_token) {
              try {
                const rr = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
                  body: JSON.stringify({ refresh_token: s.refresh_token })
                });
                if (rr.ok) {
                  const rd = await rr.json();
                  token = rd.access_token;
                  localStorage.setItem('sb-session', JSON.stringify({ access_token: rd.access_token, refresh_token: rd.refresh_token || s.refresh_token, expires_at: rd.expires_in ? Math.floor(Date.now()/1000) + rd.expires_in : null, user: s.user }));
                }
              } catch {}
            }
            if (!isExpired || token !== s.access_token) {
              const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${s.user.id}&select=*`, {
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.pgrst.object+json' }
              });
              const profile = await res.json();
              if (res.ok && profile?.id) {
                let subscribedStatus = profile.subscribed || false;
                if (subscribedStatus && profile.payment_provider === 'apple' && window.Capacitor?.isNativePlatform?.()) {
                  try {
                    const { customerInfo } = await Purchases.getCustomerInfo();
                    if (!(customerInfo?.activeSubscriptions?.length > 0)) {
                      subscribedStatus = false;
                      fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${s.user.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ subscribed: false })
                      }).catch(() => {});
                    }
                  } catch {}
                }
                setAuthUser({ id: s.user.id, name: profile.name || '', lastName: profile.last_name || '', email: profile.email || s.user.email, memberNumber: profile.member_number, createdAt: profile.created_at, subscribed: subscribedStatus, subscriptionRenewsAt: profile.subscription_renews_at || null, stripeCustomerId: profile.stripe_customer_id || null, paymentProvider: profile.payment_provider || null });
              }
            }
          }
        }
      } catch {}
      if (!universalCodePending.current) setAuthLoading(false);
    };
    restoreSession();
  }, []);

  const handleSignOut = async () => {
    try {
      const raw = localStorage.getItem("sb-session");
      if (raw) {
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: restHeaders() });
      }
    } catch {}
    if (window.Capacitor?.isNativePlatform?.()) { try { await Purchases.logOut(); } catch {} }
    localStorage.removeItem("sb-session");
    setVerifiedEmail(null);
    setVerifiedUser(null);
    setPreFillMemberNumber('');
    setForceLogin(true);
    setAuthUser(null);
  };
  const handleAccountDeleted = () => {
    if (window.Capacitor?.isNativePlatform?.()) { try { Purchases.logOut(); } catch {} }
    localStorage.removeItem("sb-session");
    setVerifiedEmail(null);
    setVerifiedUser(null);
    setPreFillMemberNumber('');
    setForceLogin(false);
    setAuthUser(null);
  };

  useEffect(() => {
    if (!authUser?.id || !window.Capacitor?.isNativePlatform?.()) return;
    Purchases.logIn({ appUserID: authUser.id }).catch(() => {});
  }, [authUser?.id]);

  if (authLoading) return (
    <div style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <style>{globalStyles}</style>
      <div style={{width:36,height:36,border:'3px solid rgba(232,184,75,0.2)',borderTopColor:'#e8b84b',borderRadius:'50%',animation:'dtm-spin 0.8s linear infinite'}} />
    </div>
  );
  if (exchangeError) return (
    <div style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'24px'}}>
      <style>{globalStyles}</style>
      <div style={{color:'#e02247',fontSize:12,fontWeight:700,letterSpacing:2,textTransform:'uppercase',marginBottom:12}}>Verification Error</div>
      <div style={{color:'rgba(245,240,232,0.75)',fontSize:13,lineHeight:1.6,textAlign:'center',marginBottom:24,wordBreak:'break-all'}}>{exchangeError}</div>
      <button onClick={()=>setExchangeError(null)} style={{background:'none',border:'1px solid rgba(245,240,232,0.2)',borderRadius:4,color:'rgba(245,240,232,0.5)',fontSize:12,letterSpacing:2,textTransform:'uppercase',padding:'12px 24px',cursor:'pointer'}}>Dismiss</button>
    </div>
  );
  if (resendVerify) return <ResendVerifyScreen />;
  if (linkError) return (
    <div className="dtm-app-frame" style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',color:'#f5f0e8',display:'flex',flexDirection:'column'}}>
      <style>{globalStyles}</style>
      <AppHeader />
      <div style={{padding:'4px 24px 0',textAlign:'center'}}>
        <p style={{color:'#e8b84b',fontSize:15,fontWeight:700,lineHeight:1.75,textAlign:'center',margin:0}}>This reset link has already been used.<br/>Please request a new one.</p>
      </div>
    </div>
  );

  if (welcomeUser) return (
    <div className="dtm-app-frame" style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',color:'#f5f0e8',display:'flex',flexDirection:'column'}}>
      <style>{globalStyles}</style>
      <AppHeader />
      <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'flex-start',padding:'4px 28px 40px'}}>
        <div style={{display:'flex',flexDirection:'column',gap:22}}>
          <p style={{margin:0,fontSize:18,color:'#e8b84b',lineHeight:1.75,fontWeight:700,textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Welcome, {welcomeUser.name}!</p>
          <p style={{margin:0,fontSize:14.5,color:'rgba(245,240,232,0.9)',lineHeight:1.75,fontWeight:400}}>
            Thank you for becoming a member. Below you will find your member # — please save it. It will be used to log in to your account.
          </p>
          <div style={{background:'#0d1b2e',border:'1px solid rgba(232,184,75,0.4)',borderRadius:4,padding:'18px 16px',textAlign:'center'}}>
            <div style={{fontSize:28,fontWeight:900,color:'#e8b84b',letterSpacing:2}}>{welcomeUser.memberNumber}</div>
          </div>
          <p style={{margin:0,marginTop:3,fontSize:14.5,color:'rgba(245,240,232,0.9)',lineHeight:1.75,fontWeight:400}}>
            <span style={{color:'#e8b84b',fontWeight:700}}>Note:</span> As a first time user, you're encouraged to post as many of your prior rounds as you'd like, up to 18 months back. Doing so will provide our model with as much data as possible — enabling us to deliver you an accurate handicap as soon as possible.
          </p>
          <button className="auth-btn-primary" style={{width:'100%',padding:16,background:'linear-gradient(135deg,#e8b84b,#c49a30)',border:'none',borderRadius:3,color:'#0d1b2e',fontSize:13,fontWeight:900,letterSpacing:4,textTransform:'uppercase',cursor:'pointer',marginTop:13}} onClick={()=>{
            setPreFillMemberNumber(welcomeUser.memberNumber);
            setWelcomeUser(null);
            setAuthUser(null);
            setForceLogin(true);
          }}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
  if (!authUser) return <AuthScreen onAuth={setAuthUser} verifiedEmail={verifiedEmail} verifiedUser={verifiedUser} resetToken={resetToken} forceLogin={forceLogin} onForceLoginClear={() => setForceLogin(false)} forceSignup={forceSignup} onForceSignupClear={() => setForceSignup(false)} onResetComplete={() => { sessionStorage.removeItem('dtm-reset-token'); setResetToken(null); }} fromEmailLink={fromEmailLink} onEmailLinkClear={() => setFromEmailLink(false)} onShowAppBanner={() => setFromEmailLink(true)} reactivationReturn={reactivationReturn} onReactivationDismiss={() => setReactivationReturn(false)} preFillMemberNumber={preFillMemberNumber} preFillNonce={preFillNonce} />;
  // SUBSCRIPTION GATE — re-enabled for live payments.
  if (!authUser.subscribed) return (
    <div style={{maxWidth:430,margin:'0 auto',minHeight:'100dvh',background:'#0d1b2e',color:'#f5f0e8',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <style>{globalStyles}</style>
      <CheckoutRedirect session={JSON.parse(localStorage.getItem('sb-session')||'null')} handleSignOut={handleSignOut} user={authUser} onReactivated={setAuthUser} onNativePurchaseSuccess={(u) => { localStorage.removeItem('sb-session'); setWelcomeUser(u); }} />
    </div>
  );
  return (
    <>
      <AppContent user={authUser} onSignOut={handleSignOut} onAccountDeleted={handleAccountDeleted} onUserUpdate={u => setAuthUser(u)} />
      <Analytics />
      {reactivationReturn && (
        <div style={{position:'fixed',inset:0,zIndex:999,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
          <div style={{position:'absolute',inset:0,background:'rgba(5,12,25,0.72)'}} onClick={()=>setReactivationReturn(false)} />
          <div style={{position:'relative',background:'#0d1b2e',borderTop:'1px solid rgba(232,184,75,0.25)',borderRadius:'16px 16px 0 0',padding:'28px 24px calc(36px + env(safe-area-inset-bottom))'}}>
            <div style={{width:36,height:3,background:'rgba(245,240,232,0.15)',borderRadius:2,margin:'0 auto 24px'}} />
            <div style={{fontSize:9,letterSpacing:3,textTransform:'uppercase',color:'rgba(245,240,232,0.35)',textAlign:'center',marginBottom:10}}>Down The Middle</div>
            <div style={{fontSize:16,fontWeight:700,color:'#f5f0e8',textAlign:'center',marginBottom:20,letterSpacing:0.5}}>Your membership is now active</div>
            <button onClick={()=>{ window.location.href='dtmhandicap://payment/reactivated'; }} style={{width:'100%',padding:14,background:'linear-gradient(135deg,#e8b84b,#c49a30)',border:'none',borderRadius:4,color:'#0d1b2e',fontSize:12,fontWeight:900,letterSpacing:3,textTransform:'uppercase',cursor:'pointer'}}>Open the App</button>
            <div style={{display:'flex',alignItems:'center',gap:12,margin:'16px 0'}}>
              <div style={{flex:1,height:1,background:'rgba(245,240,232,0.1)'}} />
              <span style={{fontSize:11,color:'rgba(245,240,232,0.3)',letterSpacing:1}}>or</span>
              <div style={{flex:1,height:1,background:'rgba(245,240,232,0.1)'}} />
            </div>
            <button onClick={()=>setReactivationReturn(false)} style={{width:'100%',padding:14,background:'none',border:'1px solid rgba(245,240,232,0.12)',borderRadius:4,color:'rgba(245,240,232,0.45)',fontSize:12,fontWeight:700,letterSpacing:2,textTransform:'uppercase',cursor:'pointer'}}>Continue in Browser</button>
          </div>
        </div>
      )}
    </>
  );
}
