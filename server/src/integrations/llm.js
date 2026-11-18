// The chat model — OpenAI, Anthropic, or local Ollama, chosen per user in Settings.
// Plain REST over fetch (no SDKs). Both providers run the same tool loop:
// model asks for tools → we run them as the signed-in user → model answers.

const DEFAULT_MODELS = {
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
  ollama: [],
};
const OLLAMA_DEFAULT_URL = 'http://localhost:11434/v1';
const MAX_ITERATIONS = 8;

function cleanOllamaBase(value) {
  let url;
  try { url = new URL(String(value || OLLAMA_DEFAULT_URL).trim()); }
  catch { throw new Error('Enter a valid local Ollama URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || !local || url.username || url.password || url.search || url.hash) {
    throw new Error('Ollama must use a local URL such as http://localhost:11434/v1.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path && path !== '/v1') throw new Error('Use the Ollama server root or its /v1 endpoint.');
  return `${url.origin}${path || '/v1'}`;
}

async function http(url, opts, label) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 90000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error?.type || body?.message || text.slice(0, 200) || res.statusText;
    const err = new Error(`${label}: ${msg}`); err.status = res.status; throw err;
  }
  return body;
}

// ── model lists (also how a key is tested) ──
async function listModels(provider, apiKey, baseUrl) {
  if (provider === 'ollama') {
    const base = cleanOllamaBase(baseUrl);
    const b = await http(`${new URL(base).origin}/api/tags`, { timeout: 10000 }, 'Ollama');
    return (b.models || []).map(m => m.name || m.model).filter(name => name && !/:cloud$/i.test(name)).sort();
  }
  if (provider === 'openai') {
    const b = await http('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 }, 'OpenAI');
    const ids = (b.data || []).map(m => m.id).filter(id => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|tts|transcribe|search|image|embedding|instruct)/.test(id));
    return ids.sort((a, b) => b.localeCompare(a));
  }
  if (provider === 'anthropic') {
    const b = await http('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, timeout: 15000 }, 'Anthropic');
    return (b.data || []).map(m => m.id);
  }
  throw new Error('Pick OpenAI, Anthropic, or Ollama.');
}

// ── one agent turn with tools ──
// history: [{role:'user'|'assistant', content:string}]
// tools:   [{name, description, input_schema}]
// runTool(name, args) → any JSON-able value (throws → reported to the model)
async function runAgent({ provider, apiKey, baseUrl, model, system, history, tools, runTool }) {
  if (provider === 'anthropic') return runAnthropic({ apiKey, model, system, history, tools, runTool });
  if (provider === 'openai') return runOpenAI({ apiKey, model, system, history, tools, runTool });
  if (provider === 'ollama') return runOpenAI({ provider, baseUrl: cleanOllamaBase(baseUrl), model, system, history, tools, runTool });
  throw new Error('No model provider is set. Open Settings → Model.');
}

async function callTool(runTool, name, args) {
  try { return JSON.stringify(await runTool(name, args)).slice(0, 24000); }
  catch (e) { return JSON.stringify({ error: String(e.message || e).slice(0, 400) }); }
}

async function runOpenAI({ provider = 'openai', apiKey, baseUrl, model, system, history, tools, runTool }) {
  const messages = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.content }))];
  const oaTools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const usage = { input: 0, output: 0 };
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const b = await http(provider === 'ollama' ? `${baseUrl}/chat/completions` : 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, tools: oaTools, tool_choice: 'auto' }),
    }, provider === 'ollama' ? 'Ollama' : 'OpenAI');
    usage.input += b.usage?.prompt_tokens || 0; usage.output += b.usage?.completion_tokens || 0;
    const msg = b.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (!calls.length) return { text: msg.content || '', usage };
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
    for (const c of calls) {
      let args = c.function.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = {}; } }
      messages.push({ role: 'tool', tool_call_id: c.id, content: await callTool(runTool, c.function.name, args) });
    }
  }
  return { text: 'I stopped after several steps without finishing. Try asking in a narrower way.', usage };
}

async function runAnthropic({ apiKey, model, system, history, tools, runTool }) {
  const messages = history.map(m => ({ role: m.role, content: m.content || ' ' }));
  const usage = { input: 0, output: 0 };
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const b = await http('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2048, system, tools, messages }),
    }, 'Anthropic');
    usage.input += b.usage?.input_tokens || 0; usage.output += b.usage?.output_tokens || 0;
    const blocks = b.content || [];
    const uses = blocks.filter(x => x.type === 'tool_use');
    const text = blocks.filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
    if (b.stop_reason !== 'tool_use' || !uses.length) return { text, usage };
    messages.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id, content: await callTool(runTool, u.name, u.input || {}) });
    messages.push({ role: 'user', content: results });
  }
  return { text: 'I stopped after several steps without finishing. Try asking in a narrower way.', usage };
}

module.exports = { DEFAULT_MODELS, OLLAMA_DEFAULT_URL, cleanOllamaBase, listModels, runAgent };
