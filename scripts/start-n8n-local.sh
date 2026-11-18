#!/bin/sh
set -eu

PROJECT_DIR="/Users/kamalesh/Downloads/lordminds"
N8N_PACKAGE_ROOT="${N8N_PACKAGE_ROOT:-/Users/kamalesh/.npm/_npx/925348dc94ac5885/node_modules}"
N8N_NODE_BIN="${N8N_NODE_BIN:-/Users/kamalesh/.npm/_npx/387698761821791d/node_modules/node/bin/node}"
EDITOR_DIST="$N8N_PACKAGE_ROOT/n8n-editor-ui/dist"

mkdir -p "$EDITOR_DIST/static"
cp "$PROJECT_DIR/web/public/lord-minds-logo.svg" "$EDITOR_DIST/static/lord-minds-logo.svg"

cat > "$EDITOR_DIST/static/lord-minds-branding.js" <<'BRANDING'
(() => {
  const applyTitle = () => {
    const title = document.querySelector('title');
    if (!title) return;
    const page = title.textContent
      .replace(/^n8n\.io\s*-\s*/i, '')
      .replace(/\s*[-|—]\s*n8n(?:\[[^\]]+\])?$/i, '')
      .replace(/^Lord Minds\s*[-|—]?\s*/i, '')
      .replace(/\s*[-|—]\s*Lord Minds$/i, '')
      .replace(/^n8n\s+/i, '')
      .trim();
    const branded = page ? `Lord Minds — ${page}` : 'Lord Minds';
    if (title.textContent !== branded) title.textContent = branded;
  };

  const applyTextBrand = () => {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const replacements = [
      [/\bn8n\b/gi, 'Lord Minds'],
    ];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('script,style,code,pre,input,textarea,[contenteditable="true"]')) continue;
      let value = node.nodeValue;
      for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
      if (value !== node.nodeValue) node.nodeValue = value;
    }
  };

  const ensureLordMindsHome = () => {
    if (window.location.port !== '5678' || !document.body || document.getElementById('lord-minds-home-link')) return;
    const link = document.createElement('a');
    link.id = 'lord-minds-home-link';
    link.href = 'http://localhost:3000/#/automations';
    link.textContent = '← Lord Minds';
    Object.assign(link.style, {
      position: 'fixed', top: '16px', right: '22px', zIndex: '10000',
      padding: '9px 15px', borderRadius: '999px', border: '1px solid #e1b71b',
      background: '#104d73', color: '#fff', font: '600 13px system-ui, sans-serif',
      textDecoration: 'none', boxShadow: '0 2px 8px #0002',
    });
    document.body.appendChild(link);
  };

  const applyBrand = () => { applyTitle(); applyTextBrand(); ensureLordMindsHome(); };
  applyBrand();
  new MutationObserver(applyBrand).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });
})();
BRANDING

python3 - "$EDITOR_DIST/index.html" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
html = path.read_text()
html = html.replace(
    '<link rel="icon" href="/{{BASE_PATH}}/favicon.ico" />',
    '<link rel="icon" type="image/svg+xml" href="/{{BASE_PATH}}/static/lord-minds-logo.svg" />',
)
html = html.replace(
    '<title>n8n.io - Workflow Automation</title>',
    '<title>Lord Minds - Workflow Automation</title>',
)
script = '<script src="/{{BASE_PATH}}/static/lord-minds-branding.js" nonce="{{CSP_NONCE}}"></script>'
anchor = '<script src="/{{BASE_PATH}}/static/base-path.js" type="text/javascript" nonce="{{CSP_NONCE}}"></script>'
import re
html = re.sub(r'\s*<script src="/{{BASE_PATH}}/static/lord-minds-branding\.js(?:\?v=[^"]*)?" nonce="\{\{CSP_NONCE\}\}"></script>', '', html)
script = script.replace('branding.js"', 'branding.js?v=6"')
html = html.replace(anchor, anchor + '\n\t\t' + script)
path.write_text(html)
PY

if [ "${BRANDING_ONLY:-0}" = "1" ]; then
  exit 0
fi

exec "$N8N_NODE_BIN" "$N8N_PACKAGE_ROOT/n8n/bin/n8n" start
