import { useEffect, useState, useCallback, useMemo } from 'react';
import { Sun, Moon, LogOut, Loader2, FlaskConical, ContactRound, Workflow, Zap, Send } from 'lucide-react';
import { api, setAdminContextToken } from './api';
import { useTheme } from './lib/util';
import { ApiContext } from './lib/apiContext';
import { demoApi, resetDemo } from './lib/demo';
import AuthPage from './pages/AuthPage.jsx';
import Office from './pages/Office.jsx';
import SettingsPage from './pages/Settings.jsx';
import CRM from './pages/CRM.jsx';
import Automations from './pages/Automations.jsx';
import Flows from './pages/Flows.jsx';
import Broadcasts from './pages/Broadcasts.jsx';
import LordMindsLogo from './components/LordMindsLogo.jsx';

const theme = useTheme();
const DEMO_KEY = 'openforge.demo';
const readDemo = () => { try { const v = localStorage.getItem(DEMO_KEY); return v == null ? null : v === '1'; } catch { return null; } };

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function Brand({ size = 30 }) {
  return (
    <span className="brand">
      <LordMindsLogo size={size} decorative />
      <span className="brand-name"><span className="lord">Lord</span> <span className="minds">Minds</span></span>
    </span>
  );
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [pref, setPref] = useState(theme.get());
  const [demo, setDemo] = useState(readDemo());
  const [adminUsers, setAdminUsers] = useState([]);
  const [workspaceUserId, setWorkspaceUserId] = useState('');
  const [contextBusy, setContextBusy] = useState(false);
  const hash = useHash();
  useEffect(() => { theme.apply(pref); }, [pref]);
  useEffect(() => {
    if (pref !== 'system' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => theme.apply('system');
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [pref]);

  const load = useCallback(() => api.get('/auth/status').then(setBoot).catch(() => setBoot({ needsSetup: false, user: null, offline: true })), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (boot?.user?.role !== 'admin') { setAdminUsers([]); setWorkspaceUserId(''); setAdminContextToken(null); return; }
    api.get('/auth/users').then(r => setAdminUsers(r.users || [])).catch(() => setAdminUsers([]));
  }, [boot?.user?.id, boot?.user?.role]);

  // First visit: show the demo until something real is connected. After that the
  // person's own choice (the Demo switch) is remembered in this browser.
  useEffect(() => {
    if (!boot?.user || demo !== null) return;
    api.get('/office/status').then(s => setDemo(!(s.model || s.google || s.whatsapp || s.telegram))).catch(() => setDemo(false));
  }, [boot, demo]);

  const ctx = useMemo(() => ({ api: demo ? demoApi : api, demo: !!demo }), [demo]);
  const toggleDemo = () => { const v = !demo; if (v) resetDemo(); setDemo(v); try { localStorage.setItem(DEMO_KEY, v ? '1' : '0'); } catch { /* */ } };
  const changeWorkspaceUser = async (id) => {
    setContextBusy(true);
    try {
      if (!id) { setAdminContextToken(null); setWorkspaceUserId(''); return; }
      const result = await api.post('/auth/admin-context', { targetId: Number(id) });
      setAdminContextToken(result.token);
      setWorkspaceUserId(String(result.user.id));
      setDemo(false);
    } catch (e) { window.alert(e.message); }
    finally { setContextBusy(false); }
  };

  if (!boot) return <div className="authwrap"><Loader2 className="spin" /></div>;
  const route = hash.replace(/^#\/?/, '').split('/');
  if (route[0] === 'invite') return <AuthPage mode="invite" token={route[1]} onDone={load} offline={boot.offline} demo={boot.demoLogin} />;
  if (route[0] === 'signup') return <AuthPage mode="signup" onDone={load} offline={boot.offline} demo={boot.demoLogin} />;
  if (!boot.user) return <AuthPage mode={boot.needsSetup ? 'setup' : 'login'} onDone={load} offline={boot.offline} demo={boot.demoLogin} />;

  const canUseCrm = boot.user.permissions?.crm !== false;
  const canUseN8n = boot.user.permissions?.n8n !== false;
  const canUseFlows = boot.user.permissions?.flows !== false;
  const canUseWhatsapp = boot.user.permissions?.whatsapp !== false;
  const canUseMessenger = boot.user.permissions?.messenger !== false;
  const canUseTelegram = boot.user.permissions?.telegram !== false;
  const canUseInstagram = boot.user.permissions?.instagram !== false;
  const canUseYoutube = boot.user.permissions?.youtube !== false && boot.user.permissions?.google !== false;
  const canUseMeta = canUseFlows && canUseInstagram && canUseWhatsapp && canUseMessenger;
  const page = route[0] === 'settings' ? 'settings' : (route[0] === 'crm' && canUseCrm) ? 'crm' : (route[0] === 'automations' && canUseN8n) ? 'automations' : (route[0] === 'flows' && (canUseFlows || canUseInstagram || canUseYoutube || canUseMessenger)) ? 'flows' : (route[0] === 'youtube' && canUseYoutube) ? 'flows' : (route[0] === 'broadcasts' && canUseFlows && canUseCrm) ? 'broadcasts' : (route[0] === 'instagram' && canUseInstagram) ? 'flows' : 'office';
  const isDark = document.documentElement.dataset.theme === 'dark';

  return (
    <ApiContext.Provider value={ctx}>
      <header className="topbar">
        <a href="#/" className="brand-link" aria-label="Lord Minds home"><Brand /></a>
        <nav className="navpills" aria-label="Main">
          <a href="#/" className={page === 'office' ? 'on' : ''}>Assistant</a>
          {canUseCrm && <a href="#/crm" className={page === 'crm' ? 'on' : ''}><ContactRound size={14} style={{ verticalAlign: -2, marginRight: 4 }} />CRM</a>}
          {canUseN8n && <a href="#/automations" className={page === 'automations' ? 'on' : ''}><Workflow size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Automations</a>}
          {(canUseFlows || canUseInstagram || canUseYoutube || canUseMessenger) && <a href="#/flows" className={page === 'flows' ? 'on' : ''}><Zap size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Flows</a>}
          {canUseFlows && canUseCrm && <a href="#/broadcasts" className={page === 'broadcasts' ? 'on' : ''}><Send size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Broadcasts</a>}
          <a href="#/settings" className={page === 'settings' ? 'on' : ''}>Settings</a>
        </nav>
        <div className="tright">
          <button className={`demo-switch ${demo ? 'on' : ''}`} onClick={toggleDemo} role="switch" aria-checked={!!demo} title="Show sample data so you can see every card working" data-testid="demo-switch">
            <FlaskConical size={15} /><span>Demo</span><span className="knob" />
          </button>
          <button className="tbtn" title={isDark ? 'Light theme' : 'Dark theme'} aria-label="Toggle theme" onClick={() => setPref(isDark ? 'light' : 'dark')}>
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <span className="tsep" />
          {boot.user.role === 'admin' && <label className="who" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="muted">View account</span><select className="select" aria-label="View account as administrator" value={workspaceUserId} disabled={contextBusy} onChange={e => changeWorkspaceUser(e.target.value)} style={{ maxWidth: 170, padding: '5px 8px', fontSize: 12 }}><option value="">My workspace</option>{adminUsers.filter(u => u.id !== boot.user.id).map(u => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</select></label>}
          <span className="who" title={boot.user.email}>{boot.user.name}</span>
          <button className="tbtn" title="Sign out" aria-label="Sign out" onClick={async () => { await api.post('/auth/logout'); load(); }}><LogOut size={17} /></button>
        </div>
      </header>
      {workspaceUserId && <div className="banner info" style={{ maxWidth: 1150, margin: '12px auto 0', padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8 }}><strong>Admin view:</strong><span className="grow">{adminUsers.find(u => String(u.id) === workspaceUserId)?.name} ({adminUsers.find(u => String(u.id) === workspaceUserId)?.email}). Your admin access includes this workspace's data and integrations; the user's access limits apply when they sign in.</span><button className="btn sm" onClick={() => changeWorkspaceUser('')}>Return to my workspace</button></div>}
      {page === 'settings'
        ? <SettingsPage key={workspaceUserId} user={boot.user} section={route[1] || 'model'} onUserChange={load} />
        : page === 'crm' ? <CRM key={workspaceUserId} /> : page === 'automations' ? <Automations key={workspaceUserId} /> : page === 'flows' ? <Flows key={workspaceUserId} canUseFlows={canUseFlows} canUseWhatsapp={canUseWhatsapp} canUseTelegram={canUseTelegram} canUseInstagram={canUseInstagram} canUseMessenger={canUseMessenger} canUseMeta={canUseMeta} canUseYoutube={canUseYoutube} /> : page === 'broadcasts' ? <Broadcasts key={workspaceUserId} /> : <Office key={workspaceUserId} user={boot.user} />}
    </ApiContext.Provider>
  );
}
