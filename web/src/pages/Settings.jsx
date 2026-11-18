import { useEffect, useState } from 'react';
import { Bot, AudioLines, Chrome, MessageCircle, Send, UserRound, Users, Loader2, CheckCircle2, AlertCircle, Plug, Trash2, KeyRound, ExternalLink, Copy, Workflow, Instagram, Facebook } from 'lucide-react';
import { api } from '../api';
import { CopyBox } from '../components/ui.jsx';

const SECTIONS = [
  { id: 'model', label: 'Model', icon: Bot },
  { id: 'voice', label: 'Voice', icon: AudioLines },
  { id: 'google', label: 'Google', icon: Chrome },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'messenger', label: 'Facebook Page', icon: Facebook },
  { id: 'telegram', label: 'Telegram', icon: Send },
  { id: 'n8n', label: 'Automations', icon: Workflow },
  { id: 'instagram', label: 'Instagram', icon: Instagram },
  { id: 'account', label: 'Account', icon: UserRound },
];

function Status({ ok, warn, children }) {
  return <span className={`pill ${ok ? 'green' : warn ? 'amber' : ''}`}>{ok ? <CheckCircle2 size={12} /> : warn ? <AlertCircle size={12} /> : null}{children}</span>;
}
function SecretField({ label, id, value, onChange, mask, placeholder, hint }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={mask?.set ? `Saved ••••${mask.last4} — paste a new one to replace it` : placeholder} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
function useSave(setView) {
  const [st, setSt] = useState({ busy: false, err: '', ok: '' });
  const run = async (fn, ok = 'Saved.') => {
    setSt({ busy: true, err: '', ok: '' });
    try { const v = await fn(); if (v) setView(v); setSt({ busy: false, err: '', ok }); return v; }
    catch (e) { setSt({ busy: false, err: e.message, ok: '' }); return null; }
  };
  const Msg = () => (st.err ? <div className="banner err" style={{ marginBottom: 12 }}>{st.err}</div> : st.ok ? <div className="banner ok" style={{ marginBottom: 12 }}>{st.ok}</div> : null);
  return [st, run, Msg];
}

function ModelSection({ v, setView }) {
  const [provider, setProvider] = useState(v.provider || 'anthropic');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(v.model || '');
  const [baseUrl, setBaseUrl] = useState(v.baseUrl || 'http://localhost:11434/v1');
  const [models, setModels] = useState([]);
  const [st, run, Msg] = useSave(setView);
  useEffect(() => {
    if (provider === 'ollama') {
      const timer = setTimeout(() => api.get(`/settings/model/models?provider=ollama&baseUrl=${encodeURIComponent(baseUrl)}`).then(r => {
          const available = r.models || [];
          setModels(available);
          setModel(current => current && available.includes(current) ? current : available[0] || current);
        }).catch(() => setModels([])), 350);
      return () => clearTimeout(timer);
    } else if (v.apiKey.set && v.provider === provider) {
      api.get('/settings/model/models').then(r => setModels(r.models || [])).catch(() => {});
    } else setModels([]);
    return undefined;
  }, [v.apiKey.set, v.provider, provider, baseUrl]);
  const list = [...new Set([...(models.length && (provider === 'ollama' || v.provider === provider) ? models : []), ...(v.defaults?.[provider] || [])])];
  const same = v.provider === provider;
  const readyToSave = provider === 'ollama' ? !!model.trim() && !!baseUrl.trim() : !!key || (same && v.apiKey.set);
  return (
    <>
      <p className="lead">Choose the model that powers Lord Minds. OpenAI and Anthropic use your API key. Ollama runs a model on this computer without sending prompts to a cloud provider.</p>
      <div className="field"><label className="label">Provider</label>
        <div className="seg">{[['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['ollama', 'Ollama · Local']].map(([k, l]) => <button key={k} type="button" className={provider === k ? 'on' : ''} onClick={() => { setProvider(k); if (k !== provider) { setModel(''); setModels([]); } }}>{l}</button>)}</div>
      </div>
      {provider === 'ollama' ? <>
        <div className="field"><label className="label" htmlFor="ollama-url">Local Ollama URL</label>
          <input id="ollama-url" className="input" type="url" value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setModel(''); setModels([]); }} placeholder="http://localhost:11434/v1" />
          <div className="hint">Ollama must be running locally. Installed models are loaded from your Ollama server.</div></div>
      </> : <SecretField id="model-key" label={`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`} value={key} onChange={setKey} mask={same ? v.apiKey : null}
        placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'} hint={provider === 'openai' ? <>Create one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>.</> : <>Create one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.</>} />}
      <div className="field"><label className="label" htmlFor="model-name">Model</label>
        <input id="model-name" className="input" list="model-list" value={model} placeholder={models[0] || v.defaults?.[provider]?.[0] || (provider === 'ollama' ? 'Install a model first' : '')} onChange={(e) => setModel(e.target.value)} />
        <datalist id="model-list">{list.map(m => <option key={m} value={m} />)}</datalist>
        <div className="hint">{provider === 'ollama' ? models.length ? 'Choose one of the models installed in Ollama.' : 'No local models found. In Terminal, run: ollama pull qwen3:8b' : 'Any model id your key can use. Saving checks the key with the provider.'}</div>
      </div>
      <Msg />
      <div className="row">
        <button className="btn primary" disabled={st.busy || !readyToSave} onClick={() => run(async () => { const r = await api.put('/settings/model', { provider, apiKey: provider === 'ollama' ? undefined : key || undefined, baseUrl: provider === 'ollama' ? baseUrl : undefined, model: model || undefined }); setKey(''); if (r.models) setModels(r.models); return r; }, provider === 'ollama' ? 'Ollama connected. Your model runs locally.' : 'Key checked and saved.')}>
          {st.busy ? <Loader2 size={15} className="spin" /> : provider === 'ollama' ? <Bot size={15} /> : <KeyRound size={15} />}Save & test</button>
        {v.provider && <button className="btn danger" onClick={() => run(() => api.del('/settings/model'), 'Model connection removed.')}><Trash2 size={14} />Remove</button>}
      </div>
    </>
  );
}

function VoiceSection({ v, setView }) {
  const [key, setKey] = useState('');
  const [f, setF] = useState({ model: v.model, voice: v.voice, language: v.language });
  const [st, run, Msg] = useSave(setView);
  return (
    <>
      <p className="lead">Talk mode uses <strong>Gemini Live</strong> for real-time voice. Your microphone audio is streamed through this server to Google with your own key; the assistant uses the same tools as in chat and still only prepares drafts.</p>
      <SecretField id="gemini-key" label="Gemini API key" value={key} onChange={setKey} mask={v.apiKey} placeholder="AIza…" hint={<>Create one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.</>} />
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="live-model">Live model</label>
          <input id="live-model" className="input" list="live-models" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
          <datalist id="live-models"><option value="gemini-3.1-flash-live-preview" /><option value="gemini-2.5-flash-native-audio-preview-09-2025" /><option value="gemini-live-2.5-flash-preview" /></datalist>
          <div className="hint">Must be a Gemini model that supports the Live API.</div></div>
        <div className="field"><label className="label" htmlFor="live-voice">Voice</label>
          <select id="live-voice" className="select" value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })}>{(v.voices || []).map(x => <option key={x}>{x}</option>)}</select></div>
      </div>
      <div className="field"><label className="label" htmlFor="live-lang">Spoken language</label>
        <input id="live-lang" className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} placeholder="English" /></div>
      <Msg />
      <div className="row">
        <button className="btn primary" disabled={st.busy || (!key && !v.apiKey.set)} onClick={() => run(async () => { const r = await api.put('/settings/voice', { ...f, apiKey: key || undefined }); setKey(''); return r; })}>
          {st.busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}Save</button>
        {v.apiKey.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/voice'), 'Removed.')}><Trash2 size={14} />Remove</button>}
      </div>
    </>
  );
}

function GoogleSection({ v, setView }) {
  const [clientId, setClientId] = useState(v.clientId || '');
  const [secret, setSecret] = useState('');
  const [st, run, Msg] = useSave(setView);
  useEffect(() => {
    const on = (e) => { if (e.origin === window.location.origin && e.data?.type === 'openforge:google') api.get('/settings').then(setView); };
    window.addEventListener('message', on); return () => window.removeEventListener('message', on);
  }, [setView]);
  return (
    <>
      <p className="lead">Gmail, Google Calendar, Google Tasks and Google Drive — through <strong>your own</strong> Google Cloud OAuth client. Lord Minds can search Drive and read Docs, Slides, text files, and the first tab of Sheets. It never edits Drive files.</p>
      <ol className="steps-list">
        <li>In <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noreferrer">Google Cloud Console</a>, enable the <strong>Gmail API</strong>, <strong>Google Calendar API</strong>, <strong>Google Tasks API</strong>, <strong>Google Drive API</strong>, and (for YouTube) the <strong>YouTube Data API v3</strong>.</li>
        <li>Set up the OAuth consent screen (External). Add yourself as a test user — or publish the app so sign-ins don't expire after 7 days.</li>
        <li>To enable YouTube, also enable <strong>YouTube Data API v3</strong> and allow the <code>youtube.upload</code> and <code>youtube.force-ssl</code> scopes on the OAuth consent screen. Use the separate Connect YouTube button below to grant them.</li>
        <li>The app requests the Drive read-only scope <code>https://www.googleapis.com/auth/drive.readonly</code> and the YouTube scopes above, then reconnect Google and grant access.</li>
        <li>Create credentials → <strong>OAuth client ID</strong> → <em>Web application</em>, and add this <strong>Authorized redirect URI</strong>:</li>
      </ol>
      <div className="field"><CopyBox value={v.redirectUri} testid="google-redirect" /></div>
      <div className="field"><label className="label">Authorized JavaScript origin (optional)</label><CopyBox value={v.javascriptOrigin} /></div>
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="g-id">Client ID</label>
          <input id="g-id" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" /></div>
        <SecretField id="g-secret" label="Client secret" value={secret} onChange={setSecret} mask={v.clientSecret} placeholder="GOCSPX-…" />
      </div>
      <Msg />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" disabled={st.busy || !clientId} onClick={() => run(async () => { const r = await api.put('/settings/google', { clientId, clientSecret: secret || undefined }); setSecret(''); return r; })}>Save client</button>
        <button className="btn primary" disabled={st.busy || !v.clientSecret.set || !v.clientId} onClick={() => run(async () => { const { url } = await api.post('/settings/google/connect'); window.open(url, 'lordminds-google', 'width=520,height=680'); return null; }, 'A Google window opened — finish signing in there.')}>
          <Plug size={15} />{v.connected ? 'Reconnect Google' : 'Connect Google'}</button>
        <button className="btn" disabled={st.busy || !v.clientSecret.set || !v.clientId} onClick={() => run(async () => { const { url } = await api.post('/settings/youtube/connect'); window.open(url, 'lordminds-youtube', 'width=520,height=680'); return null; }, 'A Google window opened — grant YouTube access there.') }><Plug size={15} />{v.youtubeUpload && v.youtubeComments ? 'Reconnect YouTube' : 'Connect YouTube'}</button>
        {v.connected && <button className="btn danger" onClick={() => run(() => api.post('/settings/google/disconnect'), 'Disconnected.')}>Disconnect</button>}
        {v.clientId && <button className="btn ghost" onClick={() => run(() => api.del('/settings/google'), 'Removed.')}><Trash2 size={14} />Remove client</button>}
      </div>
      {v.status === 'expired' && <div className="banner err" style={{ marginTop: 12 }}>Google sign-in expired: {v.lastError}. Press Reconnect.</div>}
      {v.connected && <div className="hint" style={{ marginTop: 10 }}>Connected as <strong>{v.email}</strong>. {v.driveConnected ? 'Drive read access is enabled.' : 'Reconnect Google to add Drive read access.'}</div>}
      {v.connected && <div className="hint" style={{ marginTop: 6 }}>YouTube: {v.youtubeUpload && v.youtubeComments ? 'upload and comment automation permissions are enabled.' : 'connect YouTube above to grant upload and comment access.'}</div>}
      <div className="row" style={{ marginTop: 10 }}><a className="btn ghost" href="https://drive.google.com" target="_blank" rel="noreferrer"><ExternalLink size={14} />Open Google Drive</a></div>
    </>
  );
}

function WhatsAppSection({ v, setView }) {
  const [f, setF] = useState({ phoneNumberId: v.phoneNumberId || '', accessToken: '', verifyToken: v.verifyToken || '', appSecret: '' });
  const [st, run, Msg] = useSave(setView);
  return (
    <>
      <p className="lead">The <strong>WhatsApp Cloud API</strong> (Meta). Incoming messages reach Lord Minds through a webhook; you reply from the Chats card. A free-text reply is only allowed within 24 hours of the person's last message — that's Meta's rule.</p>
      <ol className="steps-list">
        <li>At <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a> create a Business app and add the <strong>WhatsApp</strong> product.</li>
        <li>From WhatsApp → API Setup copy the <strong>Phone number ID</strong>. For a token that doesn't expire, create a <strong>System User</strong> token in Business Settings with <code>whatsapp_business_messaging</code>.</li>
        <li>Save here, then paste the <strong>Callback URL</strong> and <strong>Verify token</strong> below into WhatsApp → Configuration → Webhook, and subscribe to the <code>messages</code> field.</li>
      </ol>
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="wa-id">Phone number ID</label>
          <input id="wa-id" className="input" inputMode="numeric" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} placeholder="1234567890123456" /></div>
        <SecretField id="wa-token" label="Access token" value={f.accessToken} onChange={(x) => setF({ ...f, accessToken: x })} mask={v.accessToken} placeholder="EAAG…" />
      </div>
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="wa-verify">Verify token</label>
          <input id="wa-verify" className="input" value={f.verifyToken} onChange={(e) => setF({ ...f, verifyToken: e.target.value })} placeholder="Leave blank to generate one" />
          <div className="hint">Any string you choose — Meta sends it back once to prove the webhook is yours.</div></div>
        <SecretField id="wa-secret" label="App secret (recommended)" value={f.appSecret} onChange={(x) => setF({ ...f, appSecret: x })} mask={v.appSecret} placeholder="From App settings → Basic" hint="Used to check every webhook really came from Meta." />
      </div>
      <Msg />
      <div className="row">
        <button className="btn primary" disabled={st.busy || !f.phoneNumberId} onClick={() => run(async () => { const r = await api.put('/settings/whatsapp', { ...f, accessToken: f.accessToken || undefined, appSecret: f.appSecret || undefined }); setF({ ...f, accessToken: '', appSecret: '', verifyToken: r.whatsapp.verifyToken }); return r; }, 'Checked with Meta and saved.')}>
          {st.busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}Save & test</button>
        {v.accessToken.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/whatsapp'), 'Removed.')}><Trash2 size={14} />Remove</button>}
      </div>
      {v.callbackUrl && (
        <div style={{ marginTop: 16 }}>
          <div className="field"><label className="label">Callback URL — paste into Meta</label><CopyBox value={v.callbackUrl} testid="wa-callback" /></div>
          <div className="field"><label className="label">Verify token — paste into Meta</label><CopyBox value={v.verifyToken} /></div>
          <div className="hint">{v.displayPhone ? `Number: ${v.displayPhone}. ` : ''}{v.lastEventAt ? `Last webhook received ${new Date(v.lastEventAt).toLocaleString()}.` : 'No webhook received yet.'}</div>
        </div>
      )}
    </>
  );
}

function MessengerSection({ v, setView }) {
  const [f, setF] = useState({ pageId: v.pageId || '', accessToken: '', appSecret: '', verifyToken: v.verifyToken || '' });
  const [st, run, Msg] = useSave(setView);
  return <>
    <p className="lead">Connect a Facebook Page for Messenger automation and direct Page publishing from Flows → Upload. For publishing, the Page token also needs Meta’s <code>pages_manage_posts</code> permission.</p>
    <ol className="steps-list">
      <li>In Meta for Developers, add Messenger to your app and create a Page access token with the required messaging and webhook permissions.</li>
      <li>Enter the numeric Page ID, Page access token, and Meta app secret, then save and test.</li>
      <li>Copy the callback URL and verify token to your app's Webhooks configuration. Subscribe the Page to <code>messages</code>.</li>
    </ol>
    <div className="field"><label className="label" htmlFor="ms-page">Facebook Page ID</label><input id="ms-page" className="input" inputMode="numeric" value={f.pageId} onChange={e => setF({ ...f, pageId: e.target.value })} placeholder="Numeric Page ID" /></div>
    <SecretField id="ms-token" label="Page access token" value={f.accessToken} onChange={accessToken => setF({ ...f, accessToken })} mask={v.accessToken} placeholder="Paste Page token" hint="Encrypted at rest and never returned to the browser." />
    <SecretField id="ms-secret" label="Meta app secret" value={f.appSecret} onChange={appSecret => setF({ ...f, appSecret })} mask={v.appSecret} placeholder="Paste app secret" />
    <div className="field"><label className="label" htmlFor="ms-verify">Webhook verify token</label><input id="ms-verify" className="input" value={f.verifyToken} onChange={e => setF({ ...f, verifyToken: e.target.value })} placeholder="Generated when saved" /></div>
    <Msg />
    <div className="row"><button className="btn primary" disabled={st.busy || !f.pageId || (!f.accessToken && !v.accessToken.set)} onClick={() => run(async () => { const r = await api.put('/settings/messenger', { ...f, accessToken: f.accessToken || undefined, appSecret: f.appSecret || undefined }); setF({ ...f, accessToken: '', appSecret: '', verifyToken: r.messenger.verifyToken }); return r; }, 'Facebook Page checked and webhook prepared.')}>{st.busy ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}Save & test</button>{v.accessToken.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/messenger'), 'Messenger disconnected.') }><Trash2 size={14} />Remove</button>}</div>
    {v.callbackUrl && <div className="field" style={{ marginTop: 16 }}><label className="label">Meta webhook callback URL</label><CopyBox value={v.callbackUrl} /><div className="hint">{v.pageName ? `Page: ${v.pageName}. ` : ''}{v.lastEventAt ? `Last event ${new Date(v.lastEventAt).toLocaleString()}.` : 'Waiting for the first event.'}</div></div>}
    {v.status === 'error' && <div className="banner err" style={{ marginTop: 12 }}>{v.lastError}</div>}
  </>;
}

function TelegramSection({ v, setView }) {
  const [token, setToken] = useState('');
  const [st, run, Msg] = useSave(setView);
  return (
    <>
      <p className="lead">A <strong>Telegram bot</strong> as a chat channel. Lord Minds registers its webhook for you — messages to the bot appear on the Chats card and you reply from there.</p>
      <ol className="steps-list">
        <li>In Telegram, message <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> → <code>/newbot</code> and copy the token.</li>
        <li>Paste it here and press Save. To read group messages, also turn off privacy mode with <code>/setprivacy</code>.</li>
      </ol>
      <SecretField id="tg-token" label="Bot token" value={token} onChange={setToken} mask={v.botToken} placeholder="123456789:AA…" />
      <Msg />
      <div className="row">
        <button className="btn primary" disabled={st.busy || (!token && !v.botToken.set)} onClick={() => run(async () => { const r = await api.put('/settings/telegram', { botToken: token || undefined }); setToken(''); return r; }, 'Saved.')}>
          {st.busy ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}{v.botToken.set ? 'Save & re-register webhook' : 'Save & register webhook'}</button>
        {v.botToken.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/telegram'), 'Removed and webhook deleted.')}><Trash2 size={14} />Remove</button>}
      </div>
      {v.status === 'error' && <div className="banner err" style={{ marginTop: 12 }}>{v.lastError}</div>}
      {v.webhookUrl && <div className="field" style={{ marginTop: 16 }}><label className="label">Webhook registered with Telegram</label><CopyBox value={v.webhookUrl} /></div>}
      {v.botUsername && <div className="hint">Bot: <a href={`https://t.me/${v.botUsername}`} target="_blank" rel="noreferrer">@{v.botUsername}</a>. {v.lastEventAt ? `Last message received ${new Date(v.lastEventAt).toLocaleString()}.` : 'No messages received yet.'}</div>}
    </>
  );
}

function N8nSection({ v, setView }) {
  const [baseUrl, setBaseUrl] = useState(v.baseUrl || v.localBaseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [st, run, Msg] = useSave(setView);
  useEffect(() => { if (!v.baseUrl && v.localBaseUrl) setBaseUrl(v.localBaseUrl); }, [v.baseUrl, v.localBaseUrl]);
  return <>
    <p className="lead">Connect the Lord Minds automation editor to browse, test, and activate workflows. Each invited account stores its own editor URL and encrypted access key.</p>
    <div className="banner info" style={{ marginBottom: 14 }}>Local workflow editor: <a href={v.localBaseUrl}>{v.localBaseUrl}</a>. It runs locally with Lord Minds. Open the editor to create an access key under Settings → API.</div>
    <ol className="steps-list">
      <li>In the Lord Minds workflow editor, create an access key under Settings → API.</li>
      <li>Use the local URL below, or paste a remote instance URL and API key. Remote instances must use HTTPS.</li>
    </ol>
    <div className="field"><label className="label" htmlFor="n8n-url">Workflow editor URL</label><input id="n8n-url" className="input" type="url" autoComplete="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={v.localBaseUrl || 'https://automation.example.com'} /></div>
    <SecretField id="n8n-key" label="Workflow editor access key" value={apiKey} onChange={setApiKey} mask={v.apiKey} placeholder="Paste access key" hint="The key is encrypted at rest and never returned to the browser." />
    <Msg />
    <div className="row">
      {v.localBaseUrl && <button className="btn ghost" onClick={() => setBaseUrl(v.localBaseUrl)}>Use local editor</button>}
      <button className="btn primary" disabled={st.busy || !baseUrl || (!apiKey && !v.apiKey.set)} onClick={() => run(async () => { const r = await api.put('/settings/n8n', { baseUrl, apiKey: apiKey || undefined }); setApiKey(''); return r; }, 'Lord Minds automation connection verified and saved.')}>{st.busy ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}Save & test</button>
      {v.apiKey.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/n8n'), 'Connection removed.')}><Trash2 size={14} />Remove</button>}
      {v.baseUrl && <a className="btn ghost" href={v.baseUrl}><ExternalLink size={14} />Open workflow editor</a>}
    </div>
    {v.status === 'error' && <div className="banner err" style={{ marginTop: 12 }}>{v.lastError}</div>}
  </>;
}

function InstagramSection({ v, setView }) {
  const [f, setF] = useState({ accountId: v.accountId || '', accessToken: '', appSecret: '', verifyToken: v.verifyToken || '' });
  const [st, run, Msg] = useSave(setView);
  return <>
    <p className="lead">Connect an Instagram professional account to reply privately to matching comments. Each account uses its own Meta app credentials and webhook.</p>
    <ol className="steps-list">
      <li>In Meta for Developers, configure Instagram API with Instagram Login or the supported Facebook Login flow. Use a professional account and grant comment management and messaging permissions.</li>
      <li>Enter the numeric Instagram account ID, access token, and Meta app secret. Save & test checks the account token.</li>
      <li>Copy the callback URL and verify token below into your Meta app’s Webhooks configuration, then subscribe to the <code>comments</code> field.</li>
    </ol>
    <div className="field"><label className="label" htmlFor="ig-id">Instagram professional account ID</label><input id="ig-id" className="input" inputMode="numeric" value={f.accountId} onChange={e => setF({ ...f, accountId: e.target.value })} placeholder="Numeric account ID" /></div>
    <SecretField id="ig-token" label="Instagram access token" value={f.accessToken} onChange={accessToken => setF({ ...f, accessToken })} mask={v.accessToken} placeholder="Paste access token" hint="Encrypted at rest and never returned to the browser." />
    <SecretField id="ig-secret" label="Meta app secret" value={f.appSecret} onChange={appSecret => setF({ ...f, appSecret })} mask={v.appSecret} placeholder="Paste app secret" />
    <div className="field"><label className="label" htmlFor="ig-verify">Webhook verify token</label><input id="ig-verify" className="input" value={f.verifyToken} onChange={e => setF({ ...f, verifyToken: e.target.value })} placeholder="Generated when you save" /><div className="hint">Keep this value private. Meta uses it when verifying the callback.</div></div>
    <Msg />
    <div className="row"><button className="btn primary" disabled={st.busy || (!f.accessToken && !v.accessToken.set) || !f.accountId} onClick={() => run(async () => { const r = await api.put('/settings/instagram', { ...f, accessToken: f.accessToken || undefined, appSecret: f.appSecret || undefined }); setF({ ...f, accessToken: '', appSecret: '', verifyToken: r.instagram.verifyToken }); return r; }, 'Instagram account checked and webhook prepared.')}>{st.busy ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}Save & test</button>{v.accessToken.set && <button className="btn danger" onClick={() => run(() => api.del('/settings/instagram'), 'Instagram disconnected.') }><Trash2 size={14} />Remove</button>}</div>
    {v.username && <div className="hint" style={{ marginTop: 12 }}>Connected as @{v.username}. {v.lastEventAt ? `Last webhook ${new Date(v.lastEventAt).toLocaleString()}.` : 'Waiting for the first webhook.'}</div>}
    {v.callbackUrl && <div className="field" style={{ marginTop: 16 }}><label className="label">Meta webhook callback URL</label><CopyBox value={v.callbackUrl} /></div>}
    {v.status === 'error' && <div className="banner err" style={{ marginTop: 12 }}>{v.lastError}</div>}
    <div className="hint" style={{ marginTop: 12 }}>Meta must approve the app and grant the required permissions for accounts outside development mode. See <a href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/private-replies/" target="_blank" rel="noreferrer">Meta private replies documentation</a>.</div>
  </>;
}

const ACCESS_OPTIONS = [
  ['assistant', 'Assistant chat'],
  ['crm', 'CRM contacts and pipeline'],
  ['google', 'Google data, including Drive'],
  ['whatsapp', 'WhatsApp chats'],
  ['messenger', 'Facebook Page & Messenger'],
  ['telegram', 'Telegram chats'],
  ['n8n', 'Lord Minds workflows'],
  ['flows', 'Automations and broadcasts'],
  ['instagram', 'Instagram comment replies'],
  ['youtube', 'YouTube automation'],
  ['voice', 'Voice mode'],
  ['write', 'Create and send changes'],
];
const FULL_ACCESS = Object.fromEntries(ACCESS_OPTIONS.map(([key]) => [key, true]));

function PermissionChecks({ value = FULL_ACCESS, onChange }) {
  return <div className="permission-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px 16px', margin: '8px 0 12px' }}>
    {ACCESS_OPTIONS.map(([key, label]) => <label key={key} className="row" style={{ gap: 8, fontSize: 13 }}>
      <input type="checkbox" checked={value[key] !== false} onChange={e => onChange({ ...value, [key]: e.target.checked })} />{label}
    </label>)}
  </div>;
}

function AccountSection({ user, onUserChange }) {
  const [f, setF] = useState({ name: user.name, currentPassword: '', newPassword: '' });
  const [st, run, Msg] = useSave(() => {});
  const [users, setUsers] = useState(null);
  const [nu, setNu] = useState({ email: '', role: 'user', permissions: { ...FULL_ACCESS } });
  const [accessEdits, setAccessEdits] = useState({});
  const [ust, urun, UMsg] = useSave(() => {});
  const isAdmin = user.role === 'admin';
  const [invites, setInvites] = useState([]);
  const loadUsers = () => isAdmin && Promise.all([api.get('/auth/users'), api.get('/auth/invites')]).then(([u, i]) => { setUsers(u.users); setInvites(i.invites); }).catch(() => {});
  useEffect(() => { loadUsers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <p className="lead">Signed in as <strong>{user.email}</strong> ({user.role}).</p>
      <div className="grid2">
        <div className="field"><label className="label" htmlFor="acc-name">Name</label><input id="acc-name" className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div />
        <div className="field"><label className="label" htmlFor="acc-cur">Current password</label><input id="acc-cur" className="input" type="password" autoComplete="current-password" value={f.currentPassword} onChange={e => setF({ ...f, currentPassword: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="acc-new">New password</label><input id="acc-new" className="input" type="password" autoComplete="new-password" value={f.newPassword} onChange={e => setF({ ...f, newPassword: e.target.value })} /></div>
      </div>
      <Msg />
      <button className="btn primary" disabled={st.busy} onClick={() => run(async () => { await api.put('/auth/me', f); setF({ ...f, currentPassword: '', newPassword: '' }); onUserChange(); return null; })}>Save</button>
      {isAdmin && (
        <div style={{ marginTop: 26 }}>
          <h3 style={{ margin: '0 0 6px', display: 'flex', gap: 8, alignItems: 'center' }}><Users size={17} />People on this install</h3>
          <p className="sec" style={{ marginTop: 0, fontSize: 13.5 }}>Invite people by email. They create their own password from a single-use link. You choose their access before sending the invite; their data and connections stay separate.</p>
          {(users || []).map(u => (
            <div key={u.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--fc-surface-2)' }}>
              <div className="row">
                <span className="grow"><strong>{u.name}</strong> <span className="muted">{u.email}</span></span>
                <span className="pill">{u.role}</span>
                {u.id !== user.id && <button className="btn ghost icon" aria-label={`Remove ${u.name}`} onClick={() => { if (window.confirm(`Remove ${u.name}? Their settings and conversations are deleted.`)) urun(async () => { await api.del(`/auth/users/${u.id}`); loadUsers(); return null; }, 'Removed.'); }}><Trash2 size={14} /></button>}
              </div>
              {u.id !== user.id && u.role !== 'admin' && <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--fc-text-secondary)' }}>Manage access</summary>
                <PermissionChecks value={accessEdits[u.id] || u.permissions || FULL_ACCESS} onChange={p => setAccessEdits({ ...accessEdits, [u.id]: p })} />
                <button className="btn sm" disabled={ust.busy} onClick={() => urun(async () => { await api.patch(`/auth/users/${u.id}`, { permissions: accessEdits[u.id] || u.permissions || FULL_ACCESS }); setAccessEdits({ ...accessEdits, [u.id]: undefined }); loadUsers(); return null; }, 'Access saved.')}>Save access</button>
              </details>}
            </div>
          ))}
          {invites.length > 0 && <div style={{ margin: '18px 0 8px' }}>
            <div className="label">Pending invitations</div>
            {invites.map(i => <div key={i.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--fc-surface-2)', flexWrap: 'wrap' }}>
              <span className="grow"><strong>{i.email}</strong> <span className="muted">· {i.role} · expires {new Date(i.expires_at).toLocaleDateString()}</span></span>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(i.link)}><Copy size={13} />Copy invite link</button>
              <button className="btn ghost icon" aria-label={`Revoke invitation for ${i.email}`} onClick={() => urun(async () => { await api.del(`/auth/invites/${i.id}`); loadUsers(); return null; }, 'Invitation revoked.')}><Trash2 size={14} /></button>
            </div>)}
          </div>}
          <div className="grid2" style={{ marginTop: 10 }}>
            <input className="input" placeholder="Email to invite" name="invite-recipient" autoComplete="off" type="email" value={nu.email} onChange={e => setNu({ ...nu, email: e.target.value })} aria-label="New user email" />
            <select className="select" value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })} aria-label="Role"><option value="user">User</option><option value="admin">Admin</option></select>
          </div>
          {nu.role === 'user' ? <>
            <div className="label" style={{ marginTop: 12 }}>Access for this account</div>
            <PermissionChecks value={nu.permissions} onChange={permissions => setNu({ ...nu, permissions })} />
          </> : <div className="hint" style={{ margin: '10px 0' }}>Admins can manage accounts, but their data remains private to their own account.</div>}
          <div className="hint" style={{ margin: '8px 0' }}>Create the invite, then copy the link from Pending invitations and share it with them. Links expire after 7 days; this app does not send email automatically.</div>
          <div style={{ marginTop: 10 }}><UMsg /></div>
          <button className="btn" disabled={ust.busy || !nu.email.trim()} onClick={() => urun(async () => { const r = await api.post('/auth/invites', nu); setNu({ email: '', role: 'user', permissions: { ...FULL_ACCESS } }); await loadUsers(); return r; }, 'Invite created. Copy the link from Pending invitations and share it with them.')}>Create invite</button>
        </div>
      )}
    </>
  );
}

export default function SettingsPage({ user, section, onUserChange }) {
  const [view, setView] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/settings').then(setView).catch(e => setErr(e.message)); }, []);
  // Switching sections swaps the card in place; keep the page at the top so nothing jumps.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [section]);
  const access = user.permissions || FULL_ACCESS;
  const visibleSections = SECTIONS.filter(s => s.id === 'account' || (s.id === 'model' ? access.assistant : s.id === 'voice' ? access.voice : s.id === 'google' ? access.google : s.id === 'whatsapp' ? access.whatsapp : s.id === 'messenger' ? access.messenger !== false : s.id === 'telegram' ? access.telegram : s.id === 'n8n' ? access.n8n !== false : s.id === 'flows' ? access.flows !== false : s.id === 'instagram' ? access.instagram !== false : s.id === 'youtube' ? access.youtube !== false : true));
  const active = visibleSections.find(s => s.id === section) || visibleSections.find(s => s.id === 'account') || visibleSections[0];
  const connected = (id) => {
    if (!view) return false;
    if (id === 'model') return !!view.model.provider;
    if (id === 'voice') return view.voice.apiKey.set;
    if (id === 'google') return view.google.connected;
    if (id === 'whatsapp') return view.whatsapp.accessToken.set;
    if (id === 'messenger') return view.messenger.accessToken.set;
    if (id === 'telegram') return view.telegram.status === 'connected';
    if (id === 'n8n') return view.n8n.status === 'connected';
    if (id === 'instagram') return view.instagram.status === 'connected';
    return false;
  };
  const badge = (id) => {
    if (!view) return null;
    if (id === 'model') return <Status ok={!!view.model.provider} warn={view.model.status === 'error'}>{view.model.provider ? `${view.model.provider === 'ollama' ? 'Ollama · Local' : view.model.provider} · ${view.model.model}` : 'Not set'}</Status>;
    if (id === 'voice') return <Status ok={view.voice.apiKey.set}>{view.voice.apiKey.set ? 'Gemini Live' : 'Not set'}</Status>;
    if (id === 'google') return <Status ok={view.google.connected} warn={view.google.status === 'expired'}>{view.google.connected ? 'Connected' : view.google.status === 'expired' ? 'Expired' : view.google.clientId ? 'Client saved' : 'Not set'}</Status>;
    if (id === 'whatsapp') return <Status ok={view.whatsapp.accessToken.set}>{view.whatsapp.accessToken.set ? 'Connected' : 'Not set'}</Status>;
    if (id === 'messenger') return <Status ok={view.messenger.accessToken.set} warn={view.messenger.status === 'error'}>{view.messenger.accessToken.set ? (view.messenger.pageName || 'Connected') : view.messenger.status === 'error' ? 'Error' : 'Not set'}</Status>;
    if (id === 'telegram') return <Status ok={view.telegram.status === 'connected'} warn={view.telegram.status === 'error'}>{view.telegram.status === 'connected' ? 'Webhook on' : view.telegram.status === 'error' ? 'Error' : 'Not set'}</Status>;
    if (id === 'n8n') return <Status ok={view.n8n.status === 'connected'} warn={view.n8n.status === 'error'}>{view.n8n.status === 'connected' ? 'Connected' : view.n8n.status === 'error' ? 'Error' : 'Not set'}</Status>;
    if (id === 'instagram') return <Status ok={view.instagram.status === 'connected'} warn={view.instagram.status === 'error'}>{view.instagram.status === 'connected' ? (view.instagram.username ? `@${view.instagram.username}` : 'Connected') : view.instagram.status === 'error' ? 'Error' : 'Not set'}</Status>;
    return null;
  };
  return (
    <div className="settings">
      <nav className="card snav" aria-label="Settings sections">
        {visibleSections.map(s => (
          <a key={s.id} href={`#/settings/${s.id}`} className={active.id === s.id ? 'on' : ''} data-testid={`snav-${s.id}`}>
            <s.icon size={16} />{s.label}{s.id !== 'account' && <span className={`dot ${connected(s.id) ? 'ok' : ''}`} />}
          </a>
        ))}
      </nav>
      <div>
        {err && <div className="banner err">{err}</div>}
        {!view ? <div className="card ssec"><div className="empty"><Loader2 className="spin" /></div></div> : (
          <section key={active.id} className="card ssec" data-testid={`settings-${active.id}`}>
            <h2><active.icon size={19} />{active.label}<span style={{ marginLeft: 'auto' }}>{badge(active.id)}</span></h2>
            {active.id === 'model' && <ModelSection v={view.model} setView={setView} />}
            {active.id === 'voice' && <VoiceSection v={view.voice} setView={setView} />}
            {active.id === 'google' && <GoogleSection v={view.google} setView={setView} />}
            {active.id === 'whatsapp' && <WhatsAppSection v={view.whatsapp} setView={setView} />}
            {active.id === 'messenger' && <MessengerSection v={view.messenger} setView={setView} />}
            {active.id === 'telegram' && <TelegramSection v={view.telegram} setView={setView} />}
            {active.id === 'n8n' && <N8nSection v={view.n8n} setView={setView} />}
            {active.id === 'instagram' && <InstagramSection v={view.instagram} setView={setView} />}
            {active.id === 'account' && <AccountSection user={user} onUserChange={onUserChange} />}
          </section>
        )}
      </div>
    </div>
  );
}
