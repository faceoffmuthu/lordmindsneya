import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../api';
import LordMindsLogo from '../components/LordMindsLogo.jsx';

export default function AuthPage({ mode, onDone, offline, demo, token }) {
  const setup = mode === 'setup';
  const inviteMode = mode === 'invite';
  const signupMode = mode === 'signup';
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [invite, setInvite] = useState(null);
  const [inviteCode, setInviteCode] = useState('');
  const [signupToken, setSignupToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(offline ? 'The server is not answering. Check that Lord Minds is running.' : '');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!inviteMode) return;
    api.get(`/auth/invites/${encodeURIComponent(token || '')}`).then((v) => { setInvite(v); setF(x => ({ ...x, email: v.email })); }).catch(e => setErr(e.message));
  }, [inviteMode, token]);

  async function continueSignup() {
    setErr(''); setBusy(true);
    try {
      let value = inviteCode.trim();
      try {
        const url = new URL(value);
        value = url.hash.match(/^#\/?invite\/([^/?]+)/)?.[1] || value;
      } catch {
        value = value.replace(/^#\/?invite\//, '').replace(/^invite\//, '').split(/[/?#]/)[0];
      }
      value = decodeURIComponent(value);
      if (!value) throw new Error('Paste the invitation link or code from your Lord Minds admin.');
      const details = await api.get(`/auth/invites/${encodeURIComponent(value)}`);
      setSignupToken(value);
      setInvite(details);
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api.post(setup ? '/auth/setup' : inviteMode || signupMode ? '/auth/invites/accept' : '/auth/login', inviteMode ? { token, name: f.name, password: f.password } : signupMode ? { token: signupToken, name: f.name, password: f.password } : f);
      if (inviteMode || signupMode) window.location.hash = '#/';
      onDone();
    }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="authwrap floor">
      <form className="card authcard fa-sheet-in" onSubmit={submit} data-testid={setup ? 'setup-form' : inviteMode ? 'invite-form' : signupMode ? 'signup-form' : 'login-form'}>
        <div style={{ width: 88, height: 88, margin: '0 auto 6px' }}><LordMindsLogo /></div>
        <h1 style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
          {setup ? 'Welcome to Lord Minds' : inviteMode || signupMode ? 'Create your Lord Minds account' : 'Sign in to Lord Minds'}
        </h1>
        <p className="sec" style={{ textAlign: 'center', margin: '0 0 20px', lineHeight: 1.5 }}>
          {setup ? 'Create the first account. It becomes the admin of this install — there is no default password.' : inviteMode ? (invite ? `Create your account for ${invite.email}.` : 'Checking your invitation…') : signupMode ? 'Sign up with an invitation from your Lord Minds admin.' : 'Your Lord Minds workspace for automations, messaging and daily work.'}
        </p>
        {!setup && !inviteMode && !signupMode && demo && (
          <div className="banner info" style={{ marginBottom: 16 }} data-testid="demo-login">
            <strong>Demo login</strong><br />
            Email: <span className="mono">{demo.email}</span><br />
            Password: <span className="mono">{demo.password}</span>
            <div style={{ marginTop: 8 }}><button type="button" className="btn sm" onClick={() => setF({ ...f, email: demo.email, password: demo.password })}>Fill in for me</button></div>
          </div>
        )}
        {signupMode && !invite && <div className="field">
          <label className="label" htmlFor="invite-code">Invitation link or code</label>
          <input id="invite-code" className="input" value={inviteCode} onChange={e => setInviteCode(e.target.value)} autoComplete="off" placeholder="Paste your invite from an admin" required />
          <button type="button" className="btn" style={{ marginTop: 10, width: '100%' }} disabled={busy || !inviteCode.trim()} onClick={continueSignup}>{busy ? <Loader2 size={16} className="spin" /> : 'Continue with invitation'}</button>
        </div>}
        {signupMode && invite && <div className="banner info" style={{ marginBottom: 14 }}>Invitation verified for <strong>{invite.email}</strong>.</div>}
        {(setup || inviteMode || (signupMode && invite)) && (
          <div className="field"><label className="label" htmlFor="name">Your name</label>
            <input id="name" className="input" value={f.name} onChange={set('name')} autoComplete="name" required /></div>
        )}
        {!inviteMode && !signupMode && <div className="field"><label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={f.email} onChange={set('email')} autoComplete="email" required /></div>}
        {(setup || inviteMode || (signupMode && invite) || (!signupMode && !inviteMode)) && <div className="field"><label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" value={f.password} onChange={set('password')} autoComplete={setup || inviteMode || signupMode ? 'new-password' : 'current-password'} minLength={setup || inviteMode || signupMode ? 8 : undefined} required />
          {(setup || inviteMode || signupMode) && <div className="hint">At least 8 characters.</div>}</div>}
        {err && <div className="banner err" style={{ marginBottom: 12 }}>{err}</div>}
        {(!signupMode || invite) && <button className="btn primary" style={{ width: '100%', padding: 12 }} disabled={busy || ((inviteMode || signupMode) && !invite)}>
          {busy && <Loader2 size={16} className="spin" />}{setup ? 'Create admin account' : inviteMode || signupMode ? 'Create account' : 'Sign in'}
        </button>}
        {!setup && !inviteMode && !signupMode && <p className="sec" style={{ textAlign: 'center', margin: '18px 0 0' }}>New to Lord Minds? <a href="#/signup">Sign up</a></p>}
        {signupMode && <p className="sec" style={{ textAlign: 'center', margin: '18px 0 0' }}>Already have an account? <a href="#/">Sign in</a></p>}
      </form>
    </div>
  );
}
