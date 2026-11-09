// Test-only Google provider: exercise the real OAuth routes and session cookies.
function loadAuthenticatedApp() {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({access_token:options.body.get('code')});
    if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') {
      const profile=JSON.parse(Buffer.from(options.headers.Authorization.slice(7),'base64url').toString());
      return Response.json({sub:profile.id,email:profile.email,name:profile.id,email_verified:true});
    }
    return original(url,options);
  };
  try { return require('../server/app'); } finally { global.fetch=original; }
}
async function signIn(base,id='test-user',email='test@example.com') {
  process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='test-secret';process.env.GOOGLE_REDIRECT_URI=base+'/auth/google/callback';
  const start=await fetch(base+'/auth/google',{redirect:'manual'});
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const cookie=start.headers.get('set-cookie').split(';')[0];
  const code=Buffer.from(JSON.stringify({id,email})).toString('base64url');
  const callback=await fetch(base+`/auth/google/callback?state=${state}&code=${code}`,{redirect:'manual',headers:{cookie}});
  if(callback.headers.get('location')!=='/?auth=success')throw new Error('Test OAuth login failed');
  return callback.headers.getSetCookie().find(value=>value.startsWith('quiz_session=')).split(';')[0];
}
async function authenticatedFetch(base,id,email) {
  const cookie=await signIn(base,id,email);
  return (url,options={}) => {
    const headers=new Headers(options.headers);
    if(String(url).startsWith(base+'/'))headers.set('Cookie',cookie);
    return global.fetch(url,{...options,headers});
  };
}
module.exports={loadAuthenticatedApp,signIn,authenticatedFetch};
