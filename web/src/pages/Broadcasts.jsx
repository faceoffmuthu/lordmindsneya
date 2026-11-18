import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, RefreshCw, Users, ShieldCheck, X } from 'lucide-react';
import { useApi } from '../lib/apiContext';

export default function Broadcasts() {
  const { api: client } = useApi();
  const [data, setData] = useState({ contacts: [], campaigns: [], whatsappConnected: false });
  const [selected, setSelected] = useState([]);
  const [form, setForm] = useState({ name: '', templateName: '', language: 'en_US', parameters: '' });
  const [write, setWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(null);
  const reload = useCallback(async () => {
    try { setData(await client.get('/broadcasts')); }
    catch (e) { setError(e.message); }
  }, [client]);
  useEffect(() => { reload(); client.get('/office/status').then(x => setWrite(!!x.write)).catch(() => {}); }, [reload, client]);
  useEffect(() => {
    if (!data.campaigns.some(c => ['queued', 'running'].includes(c.status))) return undefined;
    const timer = setInterval(reload, 2500);
    return () => clearInterval(timer);
  }, [data.campaigns, reload]);
  const toggle = id => setSelected(value => value.includes(id) ? value.filter(x => x !== id) : value.length < 25 ? [...value, id] : value);
  async function create(e) {
    e.preventDefault(); setBusy(true); setError('');
    const params = form.parameters.split('\n').map(x => x.trim()).filter(Boolean);
    if (!window.confirm(`Send the approved template “${form.templateName}” to ${selected.length} opted-in WhatsApp contacts now?`)) { setBusy(false); return; }
    try {
      await client.post('/broadcasts', { ...form, parameters: params, contactIds: selected });
      setSelected([]); setForm({ name: '', templateName: '', language: 'en_US', parameters: '' }); await reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function showDetails(id) {
    try { setDetails(await client.get(`/broadcasts/${id}`)); }
    catch (e) { setError(e.message); }
  }
  return <main className="page" style={{ maxWidth: 1050, margin: '24px auto', padding: '0 20px 48px' }} data-testid="broadcasts-page">
    <div className="row" style={{ marginBottom: 18, flexWrap: 'wrap' }}><div className="grow"><div className="row" style={{ gap: 9 }}><Send size={21} className="acc" /><h1 style={{ margin: 0, fontSize: 24 }}>WhatsApp broadcasts</h1></div><p className="sec" style={{ margin: '5px 0 0' }}>Send approved template messages to contacts who opted in.</p></div><button className="btn" onClick={reload}><RefreshCw size={14} />Refresh</button></div>
    <div className="banner info" style={{ marginBottom: 14 }}><ShieldCheck size={15} style={{ verticalAlign: -3, marginRight: 6 }} />Only contacts with an explicit WhatsApp opt-in are eligible. Choose a template already approved in Meta Business Manager. Each send is queued and individually recorded; this page sends one batch to at most 25 recipients.</div>
    {!write && <div className="banner info">This account has read-only access. Ask an admin to enable changes.</div>}
    {!data.whatsappConnected && <div className="banner info" style={{ marginBottom: 14 }}>Connect WhatsApp under <a href="#/settings/whatsapp">Settings → WhatsApp</a> before sending.</div>}
    {error && <div className="banner err" style={{ marginBottom: 12 }}>{error}</div>}
    <div className="card" style={{ padding: 16, marginBottom: 20 }}>
      <h2 style={{ fontSize: 17, marginTop: 0 }}>Create a broadcast</h2>
      <form onSubmit={create}>
        <div className="grid2">
          <div className="field"><label className="label">Campaign name</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={100} placeholder="November offer" /></div>
          <div className="field"><label className="label">Approved template name</label><input className="input" value={form.templateName} onChange={e => setForm({ ...form, templateName: e.target.value })} pattern="[a-z0-9_]{1,512}" required placeholder="welcome_offer" /></div>
          <div className="field"><label className="label">Template language</label><input className="input" value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} pattern="[a-z]{2,3}(_[A-Z]{2,4})?" required placeholder="en_US" /></div>
          <div className="field"><label className="label">Body parameters, one per line</label><textarea className="textarea" rows={3} value={form.parameters} onChange={e => setForm({ ...form, parameters: e.target.value })} placeholder="Asha\n20%" /></div>
        </div>
        <div className="row" style={{ marginBottom: 8 }}><strong className="grow"><Users size={15} style={{ verticalAlign: -3, marginRight: 5 }} />Opted-in contacts</strong><span className="muted">{selected.length}/25 selected</span><button type="button" className="btn sm ghost" onClick={() => setSelected([])} disabled={!selected.length}><X size={13} />Clear</button></div>
        {!data.contacts.length ? <div className="empty" style={{ padding: 12 }}>No contacts are marked as opted in. Update a contact in CRM after confirming consent.</div> : <div className="card" style={{ padding: 0, maxHeight: 240, overflow: 'auto' }}>{data.contacts.map(c => <label key={c.id} className="row" style={{ gap: 9, padding: '9px 12px', borderBottom: '1px solid var(--fc-surface-2)' }}><input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} disabled={!selected.includes(c.id) && selected.length >= 25} /><span className="grow">{c.name}</span><span className="muted">{c.phone}</span></label>)}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 13 }}><button className="btn primary" disabled={!write || !data.whatsappConnected || !selected.length || !form.templateName.trim() || busy}>{busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}Queue broadcast</button></div>
      </form>
    </div>
    <h2 style={{ fontSize: 17 }}>Recent broadcasts</h2>
    {!data.campaigns.length ? <div className="card empty" style={{ padding: 24 }}>No broadcasts yet.</div> : <div className="card" style={{ padding: 0, overflow: 'hidden' }}>{data.campaigns.map(c => <div key={c.id} className="row" style={{ padding: 12, borderBottom: '1px solid var(--fc-surface-2)', flexWrap: 'wrap' }}><div className="grow"><strong>{c.name}</strong><div className="muted" style={{ fontSize: 12 }}>{c.template_name} · {new Date(c.created_at).toLocaleString()}</div></div><span className={`pill ${c.status === 'complete' ? 'green' : c.status === 'failed' || c.status === 'partial' ? 'amber' : ''}`}>{c.status}</span><span className="muted" style={{ fontSize: 12 }}>{c.counts.sent}/{c.counts.total} sent · {c.counts.failed} failed</span><button className="btn sm" onClick={() => showDetails(c.id)}>Recipient status</button></div>)}</div>}
    {details && <div className="card" style={{ padding: 16, marginTop: 14 }}><div className="row"><h3 className="grow" style={{ margin: 0 }}>{details.campaign.name} — recipients</h3><button className="btn ghost icon" aria-label="Close recipient status" onClick={() => setDetails(null)}><X size={15} /></button></div><div style={{ marginTop: 10 }}>{details.recipients.map((r,i) => <div key={`${r.phone}-${i}`} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--fc-surface-2)', flexWrap: 'wrap' }}><strong className="grow">{r.name}</strong><span className="muted">{r.phone}</span><span className={`pill ${r.status === 'sent' ? 'green' : r.status === 'failed' ? 'amber' : ''}`}>{r.status}</span>{r.error && <span className="muted" style={{ flexBasis: '100%' }}>{r.error}</span>}</div>)}</div></div>}
  </main>;
}
