module.exports = function security(req,res,next) {
  res.set({
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Content-Security-Policy':"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
  });
  if (/^\/(?:\.env(?:[./]|$)|\.git(?:\/|$)|server(?:\/|$)|data(?:\/|$))/i.test(req.path)) return res.status(404).end();
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      let expectedOrigin;
      try { expectedOrigin=new URL(process.env.GOOGLE_REDIRECT_URI).origin; }
      catch { expectedOrigin=req.protocol+'://'+req.get('host'); }
      const origin=req.get('origin');
      if ((origin && origin!==expectedOrigin) || req.get('sec-fetch-site')==='cross-site') return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ.'});
    }
  }
  next();
};
