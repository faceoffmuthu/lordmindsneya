import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Zap, Pencil, Trash2, X, CheckCircle2, CircleOff } from 'lucide-react';
import { useApi } from '../lib/apiContext';
import { Modal } from '../components/ui.jsx';
import SocialUpload from './SocialUpload.jsx';
import YouTube from './YouTube.jsx';

const blank = { name: '', channel: 'whatsapp', keywords: '', replyText: '', active: false };
const CHANNELS = [['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'], ['all', 'WhatsApp + Telegram'], ['meta', 'Meta (WhatsApp + Instagram + Messenger)'], ['instagram', 'Instagram comments'], ['youtube', 'YouTube comments']];
const endpoint = flow => flow.channel === 'meta' ? '/meta/flows' : flow.channel === 'instagram' ? '/instagram/flows' : flow.channel === 'youtube' ? '/youtube/flows' : '/flows';
const stateLabel = flow => flow.active ? 'Live' : 'Paused';

export default function Flows({ canUseFlows = true, canUseWhatsapp = true, canUseTelegram = true, canUseInstagram = true, canUseMessenger = true, canUseMeta = true, canUseYoutube = true }) {
  const { api: client } = useApi();
  const [data, setData] = useState({ flows: [], runs: [] });
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [write, setWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState([]);
  const [assetsBusy, setAssetsBusy] = useState(false);
  const [error, setError] = useState('');
  const [section, setSection] = useState(() => window.location.hash.endsWith('/upload') ? 'upload' : 'automation');
  const reload = useCallback(async () => {
    try {
      const [messaging, instagram, meta, youtube] = await Promise.all([
        canUseFlows ? client.get('/flows') : Promise.resolve({ flows: [], runs: [] }),
        canUseInstagram ? client.get('/instagram/flows') : Promise.resolve({ flows: [], runs: [] }),
        canUseMeta ? client.get('/meta/flows') : Promise.resolve({ flows: [], runs: [] }),
        canUseYoutube ? client.get('/youtube/flows') : Promise.resolve({ flows: [], runs: [] }),
      ]);
      const instagramFlows = instagram.flows.map(flow => ({ ...flow, channel: 'instagram' }));
      const instagramRuns = instagram.runs.map(run => ({ ...run, channel: 'instagram', chat_name: run.username ? `@${run.username}` : 'Instagram comment' }));
      const channels = [...messaging.flows, ...instagramFlows, ...meta.flows, ...youtube.flows];
      setData({
        flows: channels.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))),
        runs: [...messaging.runs, ...instagramRuns, ...meta.runs, ...youtube.runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100),
      });
    }
    catch (e) { setError(e.message); }
  }, [client, canUseFlows, canUseInstagram, canUseMeta, canUseYoutube]);
  useEffect(() => { reload(); client.get('/office/status').then(x => setWrite(!!x.write)).catch(() => {}); }, [reload, client]);
  useEffect(() => {
    if (editing === null || !['instagram', 'youtube'].includes(form.channel)) { setAssets([]); return; }
    let current = true;
    setAssetsBusy(true);
    setAssets([]);
    client.get(form.channel === 'instagram' ? '/instagram/media' : '/youtube/videos')
      .then(result => { if (current) setAssets(((form.channel === 'instagram' ? result.media : result.videos) || []).map(item => ({ id: item.id, title: item.caption || item.title || item.id, type: item.mediaType || '', url: item.permalink || null }))); })
      .catch(error => { if (current) { setAssets([]); setError(error.message); } })
      .finally(() => { if (current) setAssetsBusy(false); });
    return () => { current = false; };
  }, [client, editing, form.channel]);
  function open(flow = null) {
    setError(''); setEditing(flow || {});
    setForm(flow ? { ...flow, keywords: flow.keywords.join(', '), mediaId: flow.media_id || '', videoId: flow.video_id || '' } : { ...blank, mediaId: '', videoId: '', channel: canUseFlows && canUseWhatsapp ? 'whatsapp' : canUseFlows && canUseTelegram ? 'telegram' : canUseMeta ? 'meta' : canUseInstagram ? 'instagram' : 'youtube' });
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    const body = { ...form, mediaId: form.mediaId || null, videoId: form.videoId || null, keywords: form.keywords.split(',').map(x => x.trim()).filter(Boolean) };
    try {
      const target = editing?.id ? endpoint(editing) : endpoint({ channel: form.channel });
      if (editing?.id) await client.patch(`${target}/${editing.id}`, body);
      else await client.post(target, body);
      setEditing(null); await reload();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function toggle(flow) {
    try { await client.patch(`${endpoint(flow)}/${flow.id}`, { active: !flow.active }); await reload(); }
    catch (e) { setError(e.message); }
  }
  async function remove(flow) {
    if (!window.confirm(`Delete “${flow.name}”?`)) return;
    try { await client.del(`${endpoint(flow)}/${flow.id}`); await reload(); }
    catch (e) { setError(e.message); }
  }
  return <main className="page" style={{ maxWidth: 1080, margin: '24px auto', padding: '0 20px 48px' }} data-testid="flows-page">
    <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
      <div className="grow"><div className="row" style={{ gap: 9 }}><Zap size={21} className="acc" /><h1 style={{ margin: 0, fontSize: 24 }}>Flows</h1></div><p className="sec" style={{ margin: '5px 0 0' }}>Publish social media or automate replies across your connected channels.</p></div>
      {section === 'automation' && (canUseFlows || canUseInstagram || canUseYoutube) && write && <button className="btn primary" onClick={() => open()}><Plus size={15} />New flow</button>}
    </div>
    <div className="row" role="tablist" aria-label="Flows section" style={{ gap: 8, borderBottom: '1px solid var(--fc-surface-2)', paddingBottom: 12, marginBottom: 14 }}>
      <a className={`btn ${section === 'upload' ? 'primary' : ''}`} role="tab" aria-selected={section === 'upload'} href="#/flows/upload" onClick={() => setSection('upload')}>Upload</a>
      <a className={`btn ${section === 'automation' ? 'primary' : ''}`} role="tab" aria-selected={section === 'automation'} href="#/flows" onClick={() => setSection('automation')}>Flow Automation</a>
    </div>
    {section === 'upload' && <div>
      {canUseYoutube && <YouTube embedded canWrite={write} />}
      {(canUseInstagram || canUseMessenger) && <SocialUpload canWrite={write} canUseInstagram={canUseInstagram} canUseFacebook={canUseMessenger} />}
    </div>}
    {section === 'automation' && <>
    <div className="banner info" style={{ marginBottom: 14 }}>Choose a specific Instagram post or YouTube video for comment automation. Instagram can target any recent post; YouTube scans the latest 5 videos unless you select one. WhatsApp, Telegram, and Meta flows match incoming messages. Facebook Page post-comment automation is not available yet. <a href="#/settings/whatsapp">Connect WhatsApp</a> · <a href="#/settings/instagram">Connect Instagram</a> · <a href="#/settings/messenger">Connect Facebook Messenger</a> · <a href="#/settings/google">Connect YouTube through Google</a>.</div>
    {!write && <div className="banner info" style={{ marginBottom: 14 }}>This account has read-only access. Ask an admin to enable changes.</div>}
    {error && <div className="banner err" style={{ marginBottom: 12 }}>{error}</div>}
    {!data.flows.length ? <div className="card empty" style={{ padding: 34 }}>No flows yet. Add a keyword and a reply for Meta messages, Telegram, or YouTube comments.</div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 12 }}>
      {data.flows.map(flow => <article className="card" key={`${flow.channel}-${flow.id}`} style={{ padding: 16 }}>
        <div className="row"><strong className="grow">{flow.name}</strong><span className={`pill ${flow.active ? 'green' : ''}`}>{flow.active ? <CheckCircle2 size={12} /> : <CircleOff size={12} />}{stateLabel(flow)}</span></div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{CHANNELS.find(([key]) => key === flow.channel)?.[1]} · matches any keyword{flow.media_id ? ' · specific post' : ''}{flow.video_id ? ' · specific video' : flow.channel === 'youtube' ? ' · latest 5 videos' : ''}</div>
        <div className="row" style={{ gap: 5, flexWrap: 'wrap', marginTop: 9 }}>{flow.keywords.map(word => <span className="pill" key={word}>{word}</span>)}</div>
        <p className="sec" style={{ whiteSpace: 'pre-wrap', margin: '12px 0', fontSize: 13 }}>{flow.reply_text}</p>
        <div className="row" style={{ borderTop: '1px solid var(--fc-surface-2)', paddingTop: 10 }}>
          {write && ((flow.channel === 'meta' && canUseMeta) || (flow.channel === 'instagram' && canUseInstagram) || (flow.channel === 'youtube' && canUseYoutube) || (flow.channel === 'whatsapp' && canUseFlows && canUseWhatsapp) || (flow.channel === 'telegram' && canUseFlows && canUseTelegram) || (flow.channel === 'all' && canUseFlows && canUseWhatsapp && canUseTelegram)) && <><button className="btn sm grow" onClick={() => toggle(flow)}>{flow.active ? 'Pause' : 'Turn live'}</button><button className="btn ghost icon" aria-label={`Edit ${flow.name}`} onClick={() => open(flow)}><Pencil size={14} /></button><button className="btn ghost icon" aria-label={`Delete ${flow.name}`} onClick={() => remove(flow)}><Trash2 size={14} /></button></>}
          <span className="muted" style={{ fontSize: 11 }}>{new Date(flow.updated_at).toLocaleDateString()}</span>
        </div>
      </article>)}
    </div>}
    <section style={{ marginTop: 25 }}><h2 style={{ fontSize: 17 }}>Recent runs</h2>
      {!data.runs.length ? <div className="card empty" style={{ padding: 18 }}>Flow replies will appear here after the next matching message.</div> : <div className="card" style={{ padding: 0, overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><thead><tr>{['When','Flow','Chat','Content','Channel','Status','Error'].map(x => <th key={x} className="label" style={{ textAlign: 'left', padding: 12 }}>{x}</th>)}</tr></thead><tbody>{data.runs.map(run => <tr key={`${run.channel}-${run.id}`} style={{ borderTop: '1px solid var(--fc-surface-2)' }}><td style={{ padding: 12 }}>{new Date(run.created_at).toLocaleString()}</td><td style={{ padding: 12 }}>{run.flow_name || 'Deleted flow'}</td><td style={{ padding: 12 }}>{run.chat_name || 'Chat'}</td><td style={{ padding: 12 }}>{run.video_id ? <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(run.video_id)}`} target="_blank" rel="noreferrer">YouTube video</a> : run.media_id ? `Instagram post · ${run.media_id}` : '—'}</td><td style={{ padding: 12 }}>{run.channel}</td><td style={{ padding: 12 }}><span className={`pill ${run.status === 'sent' ? 'green' : 'amber'}`}>{run.status}</span></td><td style={{ padding: 12 }}>{run.error || '—'}</td></tr>)}</tbody></table></div>}
    </section>
    {editing !== null && <Modal title={editing?.id ? 'Edit message flow' : 'New message flow'} onClose={() => setEditing(null)}><form onSubmit={save}>
      <div className="field"><label className="label">Flow name</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={100} required autoFocus placeholder="Pricing question" /></div>
      <div className="field"><label className="label">Channel</label><select className="select" value={form.channel} disabled={!!editing?.id} onChange={e => setForm({ ...form, channel: e.target.value })}>{CHANNELS.filter(([key]) => key === 'meta' ? canUseMeta : key === 'instagram' ? canUseInstagram : key === 'youtube' ? canUseYoutube : key === 'whatsapp' ? canUseFlows && canUseWhatsapp : key === 'telegram' ? canUseFlows && canUseTelegram : key === 'all' ? canUseFlows && canUseWhatsapp && canUseTelegram : false).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></div>
      {form.channel === 'instagram' && <div className="field"><label className="label" htmlFor="instagram-flow-media">Instagram post</label><select id="instagram-flow-media" className="select" value={form.mediaId || ''} onChange={e => setForm({ ...form, mediaId: e.target.value })}><option value="">All posts</option>{form.mediaId && !assets.some(asset => asset.id === form.mediaId) && <option value={form.mediaId}>{form.mediaId} · saved target</option>}{assets.map(asset => <option value={asset.id} key={asset.id}>{asset.type ? `${asset.type} · ` : ''}{asset.title}</option>)}</select><small className="muted">{assetsBusy ? 'Loading recent posts…' : assets.length ? 'Only comments on the selected post can trigger this flow.' : 'Could not find posts, or the account has no media. The flow can still run on any post.'}</small></div>}
      {form.channel === 'youtube' && <div className="field"><label className="label" htmlFor="youtube-flow-video">YouTube video</label><select id="youtube-flow-video" className="select" value={form.videoId || ''} onChange={e => setForm({ ...form, videoId: e.target.value })}><option value="">Latest 5 videos</option>{form.videoId && !assets.some(asset => asset.id === form.videoId) && <option value={form.videoId}>{form.videoId} · saved target</option>}{assets.map(asset => <option value={asset.id} key={asset.id}>{asset.title}</option>)}</select><small className="muted">{assetsBusy ? 'Loading your recent videos…' : assets.length ? 'Only comments on the selected video can trigger this flow.' : 'Could not find videos. Connect YouTube with comment access or use the latest 5 videos.'}</small></div>}
      {form.channel === 'meta' && <div className="banner info">A Meta flow covers messages across WhatsApp, Instagram, and Messenger. For a specific Instagram post, create an Instagram comments flow.</div>}
      <div className="field"><label className="label">Keywords, comma separated</label><input className="input" value={form.keywords} onChange={e => setForm({ ...form, keywords: e.target.value })} placeholder="price, pricing, cost" required /></div>
      <div className="field"><label className="label">Automatic reply</label><textarea className="textarea" value={form.replyText} onChange={e => setForm({ ...form, replyText: e.target.value })} maxLength={1000} required placeholder="Thanks for asking — our pricing starts at…" /></div>
      <label className="row" style={{ gap: 8, marginBottom: 14 }}><input type="checkbox" checked={!!form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />Turn live immediately</label>
      {error && <div className="banner err" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" type="button" onClick={() => setEditing(null)}><X size={14} />Cancel</button><button className="btn primary" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}Save flow</button></div>
    </form></Modal>}
    </>}
  </main>;
}
