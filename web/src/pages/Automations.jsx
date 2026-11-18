import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Workflow } from 'lucide-react';
import { useApi } from '../lib/apiContext';

export default function Automations() {
  const { api: client } = useApi();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try { setData(await client.get('/n8n/workflows')); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [client]);
  useEffect(() => { load(); }, [load]);
  return <main className="page" style={{ maxWidth: 1050, margin: '24px auto', padding: '0 20px 48px' }} data-testid="automations-page">
    <div className="row" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
      <div className="grow"><div className="row" style={{ gap: 9 }}><Workflow size={21} className="acc" /><h1 style={{ margin: 0, fontSize: 24 }}>Automations</h1></div><p className="sec" style={{ margin: '5px 0 0' }}>Browse workflows running in your Lord Minds automation editor.</p></div>
      <button className="btn" onClick={load} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} />Refresh</button>
    </div>
    {err && <div className="banner err" style={{ marginBottom: 12 }}>{err}{/Connect the Lord Minds automation editor/.test(err) && <> <a href="#/settings/n8n">Connect it in Settings</a>.</>}</div>}
    {busy && !data ? <div className="card empty"><Loader2 className="spin" /></div> : data && <>
      <div className="row" style={{ marginBottom: 12 }}><span className="muted grow">{data.workflows.length} workflows · {data.workflows.filter(w => w.active).length} active</span><a className="btn ghost" href={data.baseUrl}><ExternalLink size={14} />Open Lord Minds editor</a></div>
      {!data.workflows.length ? <div className="card empty" style={{ padding: 34 }}>No workflows were returned for this Lord Minds access key.</div> : <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {data.workflows.map(w => <div key={w.id} className="row" style={{ padding: '13px 16px', borderBottom: '1px solid var(--fc-surface-2)', gap: 12, flexWrap: 'wrap' }}>
          <div className="grow" style={{ minWidth: 180 }}><strong>{w.name}</strong><div className="muted" style={{ fontSize: 12 }}>Updated {w.updatedAt ? new Date(w.updatedAt).toLocaleString() : 'date unavailable'}</div></div>
          <span className={`pill ${w.active ? 'green' : ''}`}>{w.active ? 'Active' : 'Inactive'}</span>
          <a className="btn sm" href={`${data.baseUrl}/workflow/${encodeURIComponent(w.id)}`}><ExternalLink size={13} />View workflow</a>
        </div>)}
      </div>}
      <p className="hint" style={{ marginTop: 12 }}>Open a workflow in the Lord Minds editor to test it, activate its triggers, and review execution history. Scheduled workflows run locally.</p>
    </>}
  </main>;
}
