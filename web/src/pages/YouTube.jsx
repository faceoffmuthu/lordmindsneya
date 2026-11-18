import { useCallback, useEffect, useState } from 'react';
import { Youtube, Upload, Loader2, RefreshCw, ExternalLink, MessageSquareText, CalendarClock } from 'lucide-react';
import { uploadYoutubeVideo } from '../api';
import { useApi } from '../lib/apiContext';

const emptyStatus = { connected: false, uploadAccess: false, commentAccess: false, channel: null, error: null };

export default function YouTube({ embedded = false, canWrite = true }) {
  const { api: client, demo } = useApi();
  const [status, setStatus] = useState(emptyStatus);
  const [form, setForm] = useState({ title: '', description: '', tags: '', visibility: 'private', publishAt: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const reload = useCallback(async () => {
    try { setStatus(await client.get('/youtube/status') || emptyStatus); }
    catch (e) { setStatus({ ...emptyStatus, error: e.message }); }
  }, [client]);
  useEffect(() => { reload(); }, [reload]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setResult(null);
    if (!file || !file.type.startsWith('video/')) { setError('Choose a video file.'); setBusy(false); return; }
    if (file.size > 500 * 1024 * 1024) { setError('Choose a file under 500 MB.'); setBusy(false); return; }
    const scheduled = form.publishAt ? new Date(form.publishAt) : null;
    if (scheduled && scheduled.getTime() < Date.now() + 60_000) { setError('Choose a publish time at least one minute in the future.'); setBusy(false); return; }
    const when = scheduled ? `schedule for ${scheduled.toLocaleString()}` : `upload as ${form.visibility}`;
    if (!window.confirm(`Upload “${file.name}” to ${status.channel?.title || 'your YouTube channel'} and ${when}?`)) { setBusy(false); return; }
    try {
      if (demo) {
        setResult({ id: 'demo-video', title: form.title, privacyStatus: form.publishAt ? 'private' : form.visibility, publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : null, url: 'https://www.youtube.com' });
        setFile(null); setBusy(false); return;
      }
      const response = await uploadYoutubeVideo(file, {
        title: form.title, description: form.description,
        tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean),
        privacyStatus: scheduled ? 'private' : form.visibility,
        publishAt: scheduled ? scheduled.toISOString() : '',
        fileSize: file.size,
      });
      setResult(response.video); setFile(null); setForm({ title: '', description: '', tags: '', visibility: 'private', publishAt: '' });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className={embedded ? '' : 'page'} style={embedded ? { marginTop: 16 } : { maxWidth: 1000, margin: '24px auto', padding: '0 20px 48px' }} data-testid="youtube-page">
    {!embedded && <div className="row" style={{ marginBottom: 18, flexWrap: 'wrap' }}><div className="grow"><div className="row" style={{ gap: 9 }}><Youtube size={22} className="acc" /><h1 style={{ margin: 0, fontSize: 24 }}>YouTube automation</h1></div><p className="sec" style={{ margin: '5px 0 0' }}>Upload and schedule videos, and automate keyword-based comment replies.</p></div><button className="btn" onClick={reload}><RefreshCw size={14} />Refresh</button></div>}
    <div className={`banner ${status.connected && status.uploadAccess && status.commentAccess ? 'ok' : 'info'}`} style={{ marginBottom: 16 }}>
      {status.connected ? <>Connected to <strong>{status.channel?.title}</strong>. Upload: {status.uploadAccess ? 'ready' : 'scope missing'} · Comment replies: {status.commentAccess ? 'ready' : 'scope missing'}.</> : <>Connect Google and enable YouTube Data API v3 to use this feature. <a href="#/settings/google">Open Google settings</a>{status.error ? ` — ${status.error}` : ''}</>}
    </div>
    {status.connected && (!status.uploadAccess || !status.commentAccess) && <div className="banner info" style={{ marginBottom: 16 }}>Reconnect Google in Settings → Google and grant the YouTube upload and comment scopes. The Google OAuth consent screen may require verification before other accounts can use these scopes.</div>}
    <section className="card" style={{ padding: 18 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{embedded ? 'YouTube' : ''} upload or schedule a video</h2>
      <p className="sec" style={{ marginTop: 0 }}>Scheduled videos upload immediately as private and are set to publish at the selected time. Choose visibility carefully; public uploads can be viewed by anyone.</p>
      {!status.uploadAccess && <div className="banner info" style={{ marginBottom: 12 }}>YouTube upload permission is not connected yet.</div>}
      <form onSubmit={submit}>
        <div className="field"><label className="label" htmlFor="yt-file">Video file (up to 500 MB)</label><input key={file?.name || 'empty'} id="yt-file" className="input" type="file" accept="video/*" onChange={event => setFile(event.target.files?.[0] || null)} required /></div>
        <div className="grid2">
          <div className="field"><label className="label" htmlFor="yt-title">Title</label><input id="yt-title" className="input" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} maxLength={100} required placeholder="Video title" /></div>
          <div className="field"><label className="label" htmlFor="yt-tags">Tags, comma separated</label><input id="yt-tags" className="input" value={form.tags} onChange={event => setForm({ ...form, tags: event.target.value })} placeholder="tutorial, product" /></div>
        </div>
        <div className="field"><label className="label" htmlFor="yt-description">Description</label><textarea id="yt-description" className="textarea" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} maxLength={5000} rows={4} placeholder="Describe your video" /></div>
        <div className="grid2">
          <div className="field"><label className="label" htmlFor="yt-privacy">Visibility</label><select id="yt-privacy" className="select" value={form.visibility} onChange={event => setForm({ ...form, visibility: event.target.value })}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></div>
          <div className="field"><label className="label" htmlFor="yt-schedule"><CalendarClock size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Schedule publish time (optional)</label><input id="yt-schedule" className="input" type="datetime-local" value={form.publishAt} onChange={event => setForm({ ...form, publishAt: event.target.value })} /><div className="hint">When set, YouTube keeps the video private until this time.</div></div>
        </div>
        {error && <div className="banner err" style={{ marginBottom: 12 }}>{error}</div>}
        {result && <div className="banner ok" style={{ marginBottom: 12 }}>Uploaded: <a href={result.url} target="_blank" rel="noreferrer">{result.title} <ExternalLink size={13} /></a>{result.publishAt ? ` · scheduled ${new Date(result.publishAt).toLocaleString()}` : ` · ${result.privacyStatus}`}</div>}
        <button className="btn primary" disabled={!canWrite || !status.uploadAccess || !status.connected || !file || !form.title.trim() || busy}>{busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}{busy ? 'Uploading…' : form.publishAt ? 'Upload and schedule' : 'Upload video'}</button>
      </form>
    </section>
    {!embedded && <section className="card" style={{ padding: 18, marginTop: 16 }}><h2 style={{ margin: '0 0 6px', fontSize: 18 }}><MessageSquareText size={18} style={{ verticalAlign: -3, marginRight: 6 }} />YouTube comment replies</h2><p className="sec">Create keyword-based replies in <a href="#/flows">Flows</a> by selecting <strong>YouTube comments</strong>. Lord Minds checks recent comments on your latest five videos every 15 minutes; a matching comment receives one reply per active rule.</p>{!status.commentAccess && <div className="hint">Reconnect Google and grant YouTube comment access to turn these flows live.</div>}</section>}
  </div>;
}
