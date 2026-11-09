const { randomBytes, createHash } = require('node:crypto');
const express = require('express');

// Identity sessions are server-side; the Google subject is the stable owner ID.
function createGoogleAuth({ env = process.env, request = fetch, now = Date.now } = {}) {
  const router = express.Router();
  const flows = new Map();
  const sessions = new Map();
  const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/' };
  function config() {
    const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'].filter(key => !env[key]?.trim());
    let validRedirect = false;
    try {
      const url = new URL(env.GOOGLE_REDIRECT_URI);
      validRedirect = (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) && url.pathname === '/auth/google/callback' && !url.search && !url.hash && !url.username && !url.password;
    } catch {}
    return { configured: !missing.length && validRedirect, missing, validRedirect, secure: validRedirect && new URL(env.GOOGLE_REDIRECT_URI).protocol === 'https:' };
  }
  function cookies(req) {
    return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')));
  }
  function prune(map) {
    for (const [key, value] of map) if (value.expires <= now()) map.delete(key);
  }
  function options(maxAge) { return { ...cookieOptions, secure: config().secure, maxAge }; }
  router.use((req, _res, next) => {
    prune(sessions);
    req.user = sessions.get(cookies(req).quiz_session)?.user || null;
    next();
  });
  router.use(['/api/auth', '/auth/google'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/api/auth/status', (req, res) => {
    prune(sessions);
    const session = sessions.get(cookies(req).quiz_session);
    const { configured, missing, validRedirect } = config();
    res.json({ configured, missing, validRedirect, loginUrl: configured ? new URL('/auth/google', env.GOOGLE_REDIRECT_URI).href : null, user: session?.user || null, expiresAt: session ? new Date(session.expires).toISOString() : null, storage: 'private' });
  });
  router.get('/auth/google', (req, res) => {
    if (!config().configured) return res.status(503).json({ error: 'Google OAuth chưa cấu hình đầy đủ. Xem mục Cài đặt.' });
    // Start and finish on the same host so the OAuth state cookie survives the callback.
    const callbackUrl = new URL(env.GOOGLE_REDIRECT_URI);
    if (req.get('host') !== callbackUrl.host) return res.redirect(303, new URL('/auth/google', callbackUrl).href);
    prune(flows);
    if (flows.size >= 1000) return res.status(429).json({ error: 'Quá nhiều yêu cầu đăng nhập. Thử lại sau.' });
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    flows.set(state, { verifier, expires: now() + 5 * 60 * 1000 });
    res.cookie('quiz_oauth', state, options(5 * 60 * 1000));
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI, response_type: 'code', scope: 'openid email profile', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    res.redirect(url.href);
  });
  router.get('/auth/google/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const flow = flows.get(state);
    res.clearCookie('quiz_oauth', options(0));
    if (!config().configured || !flow || flow.expires <= now() || cookies(req).quiz_oauth !== state) return res.redirect('/?auth=invalid_state');
    flows.delete(state);
    if (req.query.error || typeof req.query.code !== 'string' || !req.query.code.trim()) return res.redirect('/?auth=cancelled');
    try {
      const tokenResponse = await request('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: req.query.code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: flow.verifier }) });
      if (!tokenResponse.ok) throw new Error('Token exchange failed');
      const token = await tokenResponse.json();
      if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('Missing token');
      const userResponse = await request('https://openidconnect.googleapis.com/v1/userinfo', { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!userResponse.ok) throw new Error('Profile unavailable');
      const profile = await userResponse.json();
      if (typeof profile.sub !== 'string' || !profile.sub || typeof profile.email !== 'string' || !profile.email.trim() || profile.email_verified !== true) throw new Error('Unverified identity');
      prune(sessions);
      if (sessions.size >= 1000) throw new Error('Session capacity');
      const sessionId = randomBytes(32).toString('base64url');
      const previous = cookies(req).quiz_session;
      if (previous) sessions.delete(previous);
      sessions.set(sessionId, { user: { id: profile.sub, name: String(profile.name || profile.email).slice(0, 150), email: profile.email.slice(0, 254) }, expires: now() + 8 * 60 * 60 * 1000 });
      res.cookie('quiz_session', sessionId, options(8 * 60 * 60 * 1000));
      res.redirect('/?auth=success');
    } catch { res.redirect('/?auth=failed'); }
  });
  router.post('/api/auth/logout', (req, res) => {
    const origin = req.get('origin');
    let expectedOrigin;
    try { expectedOrigin = new URL(env.GOOGLE_REDIRECT_URI).origin; } catch { expectedOrigin = req.protocol + '://' + req.get('host'); }
    if (origin && origin !== expectedOrigin) return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    sessions.delete(cookies(req).quiz_session);
    res.clearCookie('quiz_session', options(0));
    res.status(204).end();
  });
  return router;
}

module.exports = { createGoogleAuth };
