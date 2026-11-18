import { useCallback, useEffect, useState } from 'react';
import { Facebook, Instagram, Loader2, RefreshCw, Upload, ExternalLink } from 'lucide-react';
import { useApi } from '../lib/apiContext';
import { uploadSocialPost } from '../api';

const empty = { instagram: null, messenger: null };

export default function SocialUpload({ canWrite = true, canUseInstagram = true, canUseFacebook = true }) {
  const { api: client, demo } = useApi();
  const [settings, setSettings] = useState(empty);
  const [destination, setDestination] = useState(canUseInstagram ? 'instagram' : 'facebook');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const publicHttps = window.location.protocol === 'https:' && !/localhost|127\.0\.0\.1/i.test(window.location.hostname);
  const reload = useCallback(async () => {
    try { const value = await client.get('/settings'); setSettings({ instagram: value.instagram, messenger: value.messenger }); }
    catch (e) { setError(e.message); }
  }, [client]);
  useEffect(() => { reload(); }, [reload]);
  const connected = destination === 'instagram'
    ? settings.instagram?.status === 'connected'
    : settings.messenger?.accessToken?.set;

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setResult(null);
    if (!file) { setError('Choose an image or video first.'); setBusy(false); return; }
    if (file.size > 500 * 1024 * 1024) { setError('Choose media under 500 MB.'); setBusy(false); return; }
    if (!caption.trim()) { setError('Write a caption before publishing.'); setBusy(false); return; }
    if (!demo && !publicHttps) { setError('Publishing Instagram and Facebook media requires Lord Minds to have a public HTTPS address.'); setBusy(false); return; }
    const target = destination === 'instagram' ? `Instagram${settings.instagram?.username ? ` @${settings.instagram.username}` : ''}` : `Facebook Page ${settings.messenger?.pageName || ''}`;
    if (!window.confirm(`Publish “${file.name}” directly to ${target}?`)) { setBusy(false); return; }
    try {
      const response = await uploadSocialPost(file, { destination, caption: caption.trim() });
      setResult(response.post); setFile(null); setCaption('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <section>
    <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}><div className="grow"><h2 style={{ margin: 0, fontSize: 18 }}>Instagram & Facebook</h2><p className="sec" style={{ margin: '5px 0 0' }}>Upload a photo or video and publish it directly to a connected account.</p></div><button className="btn" type="button" onClick={reload}><RefreshCw size={14} />Refresh connections</button></div>
    {!publicHttps && !demo && <div className="banner info" style={{ marginBottom: 12 }}>Direct social publishing needs a deployed public HTTPS address. Current address: {window.location.origin}. Set <code>PUBLIC_URL</code> after deploying Lord Minds.</div>}
    <div className="row" role="tablist" aria-label="Upload destination" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      {canUseInstagram && <button className={`btn ${destination === 'instagram' ? 'primary' : ''}`} role="tab" aria-selected={destination === 'instagram'} onClick={() => { setDestination('instagram'); setError(''); setResult(null); }}><Instagram size={15} />Instagram</button>}
      {canUseFacebook && <button className={`btn ${destination === 'facebook' ? 'primary' : ''}`} role="tab" aria-selected={destination === 'facebook'} onClick={() => { setDestination('facebook'); setError(''); setResult(null); }}><Facebook size={15} />Facebook Page</button>}
    </div>
    <div className={`banner ${connected ? 'ok' : 'info'}`} style={{ marginBottom: 12 }}>
      {destination === 'instagram'
        ? connected ? <>Connected to <strong>@{settings.instagram.username || settings.instagram.accountId}</strong>. Instagram publishing requires an approved content publishing permission.</> : <>Connect an Instagram professional account in <a href="#/settings/instagram">Settings → Instagram</a>.</>
        : connected ? <>Connected to Facebook Page <strong>{settings.messenger.pageName || settings.messenger.pageId}</strong>. Publishing requires the Page posting permission (<code>pages_manage_posts</code>).</> : <>Connect a Facebook Page in <a href="#/settings/messenger">Settings → Messenger</a>. The Page token also needs <code>pages_manage_posts</code>.</>}
    </div>
    <form className="card" onSubmit={submit} style={{ padding: 18 }}>
      <div className="field"><label className="label" htmlFor="social-file">Photo or video (up to 500 MB)</label><input key={`${destination}-${file?.name || 'empty'}`} className="input" id="social-file" type="file" accept={destination === 'instagram' ? 'image/jpeg,video/mp4,video/quicktime' : 'image/jpeg,image/png,video/mp4,video/quicktime,video/webm'} onChange={event => { setFile(event.target.files?.[0] || null); setResult(null); }} required /><div className="hint">Instagram supports JPEG photos and Reel videos. Facebook publishes photos or videos to the connected Page.</div></div>
      <div className="field"><label className="label" htmlFor="social-caption">Caption</label><textarea className="textarea" id="social-caption" rows={4} maxLength={2200} value={caption} onChange={event => setCaption(event.target.value)} placeholder="Write your post caption" required /></div>
      {error && <div className="banner err" style={{ marginBottom: 12 }}>{error}</div>}
      {result && <div className="banner ok" style={{ marginBottom: 12 }}>Published to {result.destination}: <a href={result.url} target="_blank" rel="noreferrer">Open post <ExternalLink size={13} /></a></div>}
      {!canWrite && <div className="banner info" style={{ marginBottom: 12 }}>This account has read-only access. Ask an admin to enable changes.</div>}
      <button className="btn primary" disabled={!canWrite || !connected || !file || !caption.trim() || busy}>{busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}{busy ? 'Publishing…' : `Publish to ${destination === 'instagram' ? 'Instagram' : 'Facebook Page'}`}</button>
    </form>
  </section>;
}
