import { useEffect, useState } from 'react';
import { Loader2, Plus, Search, Trash2, X, Save, Users, Pencil, ChevronLeft, ChevronRight, LayoutGrid, List, CalendarDays, TrendingUp } from 'lucide-react';
import { useApi } from '../lib/apiContext';
import { Modal } from '../components/ui.jsx';

const STAGES = [
  ['new', 'New'], ['contacted', 'Contacted'], ['qualified', 'Qualified'], ['won', 'Won'], ['lost', 'Lost'],
];
const empty = { name: '', email: '', phone: '', company: '', source: '', stage: 'new', tags: '', notes: '', followUpAt: '', whatsappOptIn: false };
const toLocalInput = value => {
  if (!value) return '';
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const localDay = value => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function CRM() {
  const { api: client } = useApi();
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('all');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [write, setWrite] = useState(false);
  const [view, setView] = useState('pipeline');
  const [period, setPeriod] = useState(30);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(localDay(new Date()));
  const reload = () => client.get(`/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then(r => setContacts(r.contacts || [])).catch(e => setErr(e.message));
  useEffect(() => { reload(); client.get('/office/status').then(s => setWrite(!!s.write)).catch(() => {}); }, [q, client]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = contacts.filter(c => stage === 'all' || c.stage === stage);
  const cutoff = Date.now() - period * 86400000;
  const recent = contacts.filter(c => new Date(c.created_at).getTime() >= cutoff);
  const month = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const calendarStart = new Date(monthStart); calendarStart.setDate(1 - ((monthStart.getDay() + 6) % 7));
  const calendarDays = Array.from({ length: 42 }, (_, i) => { const d = new Date(calendarStart); d.setDate(calendarStart.getDate() + i); return d; });
  const followUps = contacts.filter(c => c.follow_up_at).sort((a, b) => new Date(a.follow_up_at) - new Date(b.follow_up_at));
  const selectedFollowUps = followUps.filter(c => localDay(c.follow_up_at) === selectedDay);
  function open(contact = null) {
    setErr(''); setModal(contact || {});
    setForm(contact ? { ...contact, followUpAt: toLocalInput(contact.follow_up_at), whatsappOptIn: !!contact.whatsapp_opt_in, tags: (contact.tags || []).join(', ') } : { ...empty });
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    const body = { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), followUpAt: form.followUpAt ? new Date(form.followUpAt).toISOString() : null };
    try {
      if (modal?.id) await client.patch(`/contacts/${modal.id}`, body);
      else await client.post('/contacts', body);
      setModal(null); await reload();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function changeStage(contact, next) {
    try { await client.patch(`/contacts/${contact.id}`, { stage: next }); await reload(); } catch (x) { setErr(x.message); }
  }
  async function remove(contact) {
    if (!window.confirm(`Remove ${contact.name} from contacts?`)) return;
    try { await client.del(`/contacts/${contact.id}`); await reload(); } catch (x) { setErr(x.message); }
  }
  return (
    <main className="page" style={{ maxWidth: 1150, margin: '24px auto', padding: '0 20px 48px' }} data-testid="crm-page">
      <div className="row" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        <div className="grow"><div className="row" style={{ gap: 9 }}><Users size={21} className="acc" /><h1 style={{ margin: 0, fontSize: 24 }}>Contacts</h1></div><p className="sec" style={{ margin: '5px 0 0' }}>Your private sales pipeline and follow-up list.</p></div>
        {write && <button className="btn primary" onClick={() => open()}><Plus size={15} />New contact</button>}
      </div>
      {!write && <div className="banner info" style={{ marginBottom: 14 }}>This account has read-only access. Ask an admin to enable changes.</div>}
      {err && <div className="banner err" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
        <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>Leads added · {period} days</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{recent.length}</div></div>
        <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>Open pipeline</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{contacts.filter(c => !['won', 'lost'].includes(c.stage)).length}</div></div>
        <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>Won · {period} days</div><div className="row" style={{ gap: 7, marginTop: 4 }}><TrendingUp size={17} className="acc" /><strong style={{ fontSize: 24 }}>{recent.filter(c => c.stage === 'won').length}</strong></div></div>
        <div className="card" style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>Follow-ups due</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{followUps.filter(c => new Date(c.follow_up_at) <= new Date()).length}</div></div>
      </div>
      <div className="row" role="tablist" aria-label="CRM views" style={{ gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
        {[['pipeline', LayoutGrid, 'Pipeline'], ['contacts', List, 'Contacts'], ['follow-ups', CalendarDays, 'Follow-ups']].map(([key, Icon, label]) => <button key={key} role="tab" aria-selected={view === key} className={`btn ${view === key ? 'primary' : 'ghost'}`} onClick={() => setView(key)}><Icon size={14} />{label}</button>)}
        <span className="grow" />
        <select className="select" aria-label="Metrics period" value={period} onChange={e => setPeriod(Number(e.target.value))} style={{ width: 150 }}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
      </div>
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="row grow" style={{ minWidth: 210, gap: 8 }}><Search size={15} className="muted" /><input className="input grow" value={q} onChange={e => setQ(e.target.value)} placeholder="Search people, companies, tags…" aria-label="Search contacts" /></div>
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            <button className={stage === 'all' ? 'on' : ''} onClick={() => setStage('all')}>All</button>
            {STAGES.map(([key, label]) => <button key={key} className={stage === key ? 'on' : ''} onClick={() => setStage(key)}>{label} <span className="muted">{contacts.filter(c => c.stage === key).length}</span></button>)}
          </div>
        </div>
      </div>
      {!contacts.length ? <div className="card empty" style={{ padding: 36 }}>{q ? 'No matching contacts.' : 'No contacts yet. Add your first contact to start tracking follow-ups.'}</div>
        : view === 'pipeline' ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap: 10, alignItems: 'start' }}>
          {STAGES.map(([key, label]) => {
            const items = visible.filter(c => c.stage === key);
            return <section key={key} className="card" aria-label={`${label} stage`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = Number(e.dataTransfer.getData('text/plain')); const contact = contacts.find(c => c.id === id); if (contact && contact.stage !== key) changeStage(contact, key); }} style={{ padding: 10, minHeight: 150, background: 'var(--fc-surface)' }}>
              <div className="row" style={{ padding: '2px 2px 9px', borderBottom: '1px solid var(--fc-surface-2)' }}><strong className="grow" style={{ fontSize: 13 }}>{label}</strong><span className="pill">{items.length}</span></div>
              <div style={{ display: 'grid', gap: 8, paddingTop: 8 }}>{items.map(c => <article key={c.id} className="card" draggable={write} onDragStart={e => e.dataTransfer.setData('text/plain', String(c.id))} style={{ padding: 10, cursor: write ? 'grab' : 'default' }}>
                <div className="row"><strong className="grow" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{c.name}</strong>{write && <button className="btn ghost icon" aria-label={`Edit ${c.name}`} onClick={() => open(c)}><Pencil size={13} /></button>}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{[c.company, c.source].filter(Boolean).join(' · ') || 'No company or source'}</div>
                {c.follow_up_at && <div className="hint" style={{ marginTop: 7, fontSize: 11 }}>Follow up {new Date(c.follow_up_at).toLocaleDateString()}</div>}
              </article>)}</div>
            </section>;
          })}
        </div>
        : view === 'follow-ups' ? <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ marginBottom: 14 }}><button className="btn ghost icon" aria-label="Previous month" onClick={() => setMonthOffset(n => n - 1)}><ChevronLeft size={16} /></button><h2 className="grow" style={{ textAlign: 'center', margin: 0, fontSize: 17 }}>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><button className="btn ghost icon" aria-label="Next month" onClick={() => setMonthOffset(n => n + 1)}><ChevronRight size={16} /></button></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 4, textAlign: 'center' }}>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div className="label" key={d} style={{ padding: 5 }}>{d}</div>)}{calendarDays.map(day => { const key = localDay(day); const count = followUps.filter(c => localDay(c.follow_up_at) === key).length; return <button key={key} className={`btn ${selectedDay === key ? 'primary' : 'ghost'}`} onClick={() => setSelectedDay(key)} style={{ minWidth: 0, minHeight: 42, padding: 3, opacity: day.getMonth() === month.getMonth() ? 1 : .45, display: 'flex', flexDirection: 'column', gap: 0 }}>{day.getDate()}<small style={{ minHeight: 12, color: selectedDay === key ? 'inherit' : 'var(--fc-primary)' }}>{count ? `· ${count}` : ''}</small></button>; })}</div>
          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          {!selectedFollowUps.length ? <div className="muted" style={{ padding: '14px 0' }}>No follow-ups scheduled for this day.</div> : <div style={{ display: 'grid', gap: 8 }}>{selectedFollowUps.map(c => <div key={c.id} className="row card" style={{ padding: 10 }}><div className="grow"><strong>{c.name}</strong><div className="muted" style={{ fontSize: 12 }}>{[c.company, c.stage].filter(Boolean).join(' · ')} · {new Date(c.follow_up_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div>{write && <button className="btn ghost icon" aria-label={`Edit ${c.name}`} onClick={() => open(c)}><Pencil size={14} /></button>}</div>)}</div>}
        </div>
        : <>
        {view === 'contacts' && (!visible.length ? <div className="card empty" style={{ padding: 36 }}>No contacts in this stage.</div>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
            {visible.map(c => <article key={c.id} className="card" style={{ padding: 15 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}><h3 style={{ margin: '0 0 4px', overflowWrap: 'anywhere' }}>{c.name}</h3><div className="muted" style={{ fontSize: 13 }}>{[c.company, c.source].filter(Boolean).join(' · ') || 'No company or source'}</div></div>
                {write && <><button className="btn ghost icon" aria-label={`Edit ${c.name}`} onClick={() => open(c)}><Pencil size={14} /></button><button className="btn ghost icon" aria-label={`Remove ${c.name}`} onClick={() => remove(c)}><Trash2 size={14} /></button></>}
              </div>
              {(c.email || c.phone) && <div className="sec" style={{ marginTop: 10, fontSize: 13 }}>{c.email && <div>{c.email}</div>}{c.phone && <div>{c.phone}</div>}</div>}
              {c.whatsapp_opt_in && <span className="pill green" style={{ marginTop: 8 }}>WhatsApp opted in</span>}
              {c.notes && <p className="sec" style={{ fontSize: 13, margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>{c.notes}</p>}
              {c.follow_up_at && <div className="hint" style={{ marginTop: 9 }}>Follow up {new Date(c.follow_up_at).toLocaleString()}</div>}
              {!!c.tags?.length && <div className="row" style={{ gap: 5, flexWrap: 'wrap', marginTop: 10 }}>{c.tags.map(t => <span className="pill" key={t}>{t}</span>)}</div>}
              <div className="row" style={{ marginTop: 13, borderTop: '1px solid var(--fc-surface-2)', paddingTop: 10 }}>
                <span className="muted grow" style={{ fontSize: 12 }}>Updated {new Date(c.updated_at).toLocaleDateString()}</span>
                {write ? <select className="select" style={{ width: 138, padding: '6px 8px', fontSize: 12 }} value={c.stage} aria-label={`${c.name} stage`} onChange={e => changeStage(c, e.target.value)}>{STAGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : <span className="pill">{STAGES.find(([key]) => key === c.stage)?.[1] || c.stage}</span>}
              </div>
            </article>)}
          </div>)}
        </>}
      {modal !== null && <Modal title={modal?.id ? 'Edit contact' : 'New contact'} onClose={() => setModal(null)}>
        <form onSubmit={save}>
          <div className="grid2">
            <div className="field"><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={160} autoFocus /></div>
            <div className="field"><label className="label">Company</label><input className="input" value={form.company || ''} onChange={e => setForm({ ...form, company: e.target.value })} maxLength={160} /></div>
            <div className="field"><label className="label">Email</label><input className="input" type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} maxLength={254} /></div>
            <div className="field"><label className="label">Phone</label><input className="input" value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} maxLength={40} /></div>
            <div className="field"><label className="label">Source</label><input className="input" value={form.source || ''} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="WhatsApp, referral…" maxLength={100} /></div>
            <div className="field"><label className="label">Stage</label><select className="select" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}>{STAGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
          </div>
          <div className="field"><label className="label">Tags (comma separated)</label><input className="input" value={form.tags || ''} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="VIP, follow-up" /></div>
          <div className="field"><label className="label">Next follow-up</label><input className="input" type="datetime-local" value={form.followUpAt || ''} onChange={e => setForm({ ...form, followUpAt: e.target.value })} /></div>
          <label className="row" style={{ gap: 8, marginBottom: 14 }}><input type="checkbox" checked={!!form.whatsappOptIn} onChange={e => setForm({ ...form, whatsappOptIn: e.target.checked })} />This contact agreed to receive WhatsApp messages</label>
          <div className="field"><label className="label">Notes</label><textarea className="textarea" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} maxLength={4000} /></div>
          {err && <div className="banner err" style={{ marginBottom: 10 }}>{err}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={() => setModal(null)}><X size={14} />Cancel</button><button className="btn primary" disabled={busy || !form.name.trim()}>{busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}Save contact</button></div>
        </form>
      </Modal>}
    </main>
  );
}
