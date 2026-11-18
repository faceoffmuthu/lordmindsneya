# Deploying Lord Minds

This guide takes you from an empty server to a working install, then covers upgrades, backups and the problems people usually hit. The default Docker Compose setup runs Lord Minds and a local n8n service in separate containers. Lord Minds stores its SQLite database and generated secrets in its own volume; n8n stores workflows, credentials, and executions in a second persistent volume. The Traefik example deploys Lord Minds only.

- [1. What you need](#1-what-you-need)
- [2. Fastest path: a fresh VPS with Caddy](#2-fastest-path-a-fresh-vps-with-caddy)
- [3. Behind an existing Traefik](#3-behind-an-existing-traefik)
- [4. Behind nginx](#4-behind-nginx)
- [5. Without Docker](#5-without-docker)
- [6. First-run checklist](#6-first-run-checklist)
- [7. Upgrading](#7-upgrading)
- [8. Backups and restore](#8-backups-and-restore)
- [9. Monitoring](#9-monitoring)
- [10. Running a public demo](#10-running-a-public-demo)
- [11. Troubleshooting](#11-troubleshooting)

---

## 1. What you need

| | |
|---|---|
| A server | Lord Minds alone can run on a small server. The default setup also runs local n8n; allow at least 2 vCPU, 4 GB RAM, and several GB of free disk for both services and their images. |
| Docker | Docker Engine 24+ with the Compose v2 plugin (`docker compose version`). |
| A domain name | e.g. `assistant.example.com`, with an **A/AAAA record** pointing at the server. |
| HTTPS | From a reverse proxy (Caddy, Traefik or nginx + Let's Encrypt). **Required** for webhooks, Google sign-in and the microphone. |
| Ports | 80 and 443 open to the internet (for the certificate and for webhooks). |

The keys themselves (OpenAI/Anthropic, Gemini, Google OAuth, WhatsApp, Telegram) are **not** server configuration — each user enters their own in the app.

## 2. Fastest path: a fresh VPS with Caddy

Caddy gets and renews the HTTPS certificate on its own.

```bash
# 1. Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh

# 2. The app
cd /opt/lordminds  # place your Lord Minds project files here first
cp .env.example .env
sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=https://assistant.example.com|' .env
sed -i 's|^LORDMINDS_PORT=.*|LORDMINDS_PORT=127.0.0.1:3000|' .env   # only reachable through Caddy
docker compose up -d --build

# 3. Caddy in front
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
assistant.example.com {
  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1        # stream chat steps (server-sent events) immediately
  }
}
EOF
sudo systemctl reload caddy
```

Open `https://assistant.example.com`, create the admin account, and continue with the [first-run checklist](#6-first-run-checklist).

## 3. Behind an existing Traefik

`docker-compose.traefik.yml` joins the container to Traefik's network and asks for a Let's Encrypt certificate. In `.env`:

```bash
PUBLIC_URL=https://assistant.example.com
LORDMINDS_HOST=assistant.example.com
TRAEFIK_NETWORK=traefik            # the external Docker network Traefik watches
TRAEFIK_CERTRESOLVER=letsencrypt   # the name of your certificate resolver
```

```bash
docker compose -p lordminds -f docker-compose.traefik.yml up -d --build
```

Notes:
- Traefik **ignores a container until its health check passes** (about 30 seconds after start), so the first request may 404 briefly.
- WebSockets (Talk) and server-sent events work through Traefik with no extra configuration.
- Use `-p lordminds` consistently: the project name becomes part of the volume name (`lordminds_openforge-data`). The legacy volume key remains `openforge-data` so older installs can keep their data.

## 4. Behind nginx

Publish the container on localhost (`LORDMINDS_PORT=127.0.0.1:3000`) and add a server block. The two `location` blocks matter: Talk is a **WebSocket**, and chat steps and new-message notices are **server-sent events** that must not be buffered.

```nginx
server {
  listen 443 ssl http2;
  server_name assistant.example.com;
  # ssl_certificate / ssl_certificate_key from certbot

  client_max_body_size 512m;  # supports YouTube video uploads (Lord Minds caps uploads at 500 MB)

  location /api/assistant/live {          # Talk (WebSocket)
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
  }

  location ~ ^/api/(assistant/chat|events)$ {   # server-sent events
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## 5. Without Docker

Node.js 22+ and a C/C++ toolchain (for `better-sqlite3`, usually prebuilt):

```bash
cd /opt/lordminds
(cd web && npm ci && npm run build) && rm -rf server/public && cp -r web/dist server/public
cd server && npm ci --omit=dev
PUBLIC_URL=https://assistant.example.com DATA_DIR=/var/lib/lordminds NODE_ENV=production node src/index.js
```

A systemd unit (`/etc/systemd/system/lordminds.service`):

```ini
[Unit]
Description=Lord Minds
After=network.target

[Service]
WorkingDirectory=/opt/lordminds/server
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/lordminds
Environment=PUBLIC_URL=https://assistant.example.com
ExecStart=/usr/bin/node src/index.js
Restart=always
User=lordminds

[Install]
WantedBy=multi-user.target
```

Then put Caddy or nginx in front as above.

## 6. First-run checklist

1. **Create the admin account** — the first visitor becomes admin; there is no default password.
2. **Settings → Model** — choose OpenAI or Anthropic, paste a key, pick a model, *Save & test*. The chat works from here on.
3. **Settings → Voice** — paste a Gemini key to enable **Talk**.
4. **Settings → Google** — enable the Gmail, Calendar and Tasks APIs in Google Cloud, create a *Web application* OAuth client with the **redirect URI shown in Settings**, paste the Client ID and Secret, then *Connect Google*. (Details in the README.)
5. **Settings → WhatsApp** — paste the phone number ID and access token, *Save & test*, then copy the **Callback URL** and **Verify token** into Meta and subscribe to `messages`.
6. **Settings → Telegram** — paste the bot token; the webhook is registered for you.
7. **Settings → Account → People** — create an invitation for each teammate, choose their permissions, and share the generated link. Each person creates their account with their own password and connects their own keys.
8. Turn **Demo** off in the top bar to see your own data.

## 7. Upgrading

From the project folder, rebuild the image and wait until the app is healthy:

```bash
cd /opt/lordminds && ./deploy.sh update
```

Or by hand from the project folder:

```bash
cd /opt/lordminds
docker compose up -d --build            # or: docker compose -p lordminds -f docker-compose.traefik.yml up -d --build
```

The database schema is created and extended automatically at boot; there are no manual migrations. Take a backup first (next section) — it is a 5-second job.

## 8. Backups and restore

Lord Minds stores `openforge.db` (+ `-wal`/`-shm`) and the generated `.session_secret` / `.encryption_key` in its data volume. **Back up the whole volume** — a database without its `.encryption_key` cannot decrypt the saved keys. The default Compose setup also stores n8n workflows, credentials, and executions in the `lordminds-n8n-data` volume. Back up both volumes if you use local n8n.

Find the volume name: `docker volume ls | grep openforge-data` (new installs use `lordminds_openforge-data`; older installs may retain their original project prefix).

**Online backup** (consistent SQLite copy, no downtime):

```bash
docker exec lordminds node -e "require('better-sqlite3')('/data/openforge.db').backup('/data/backup.db').then(()=>console.log('ok'))"
docker cp lordminds:/data/backup.db ./lordminds-$(date +%F).db
docker cp lordminds:/data/.encryption_key ./lordminds-encryption-key   # keep with the backup, keep it secret
docker cp lordminds:/data/.session_secret ./lordminds-session-secret
```

**Full volume snapshot** (simplest, stop first):

```bash
docker compose stop
docker run --rm -v lordminds_openforge-data:/data -v "$PWD":/backup alpine tar czf /backup/lordminds-data-$(date +%F).tgz -C /data .
docker run --rm -v lordminds-n8n-data:/data -v "$PWD":/backup alpine tar czf /backup/lordminds-n8n-$(date +%F).tgz -C /data .
docker compose start
```

**Restore**: stop the container, unpack the archive into the volume (`tar xzf … -C /data`), start it again. If you pinned `ENCRYPTION_KEY` in `.env`, keep the same value.

## 9. Monitoring

- `GET /health` → `{"ok":true}` — the container's own health check uses it.
- `docker logs -f lordminds` — startup line `[lord-minds] listening on :3000`, plus errors from integrations.
- In the app, **Settings** shows each integration's status and the last webhook received for WhatsApp and Telegram.

## 10. Running a public demo

To let visitors in without creating accounts, set both:

```bash
DEMO_LOGIN_EMAIL=demo@your-domain.example
DEMO_LOGIN_PASSWORD=pick-something
```

The account is created (or its password reset) at every boot and **shown on the sign-in page**. Combine it with the in-app **Demo** switch so visitors see sample data. Never enable this on an install that holds real keys.

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Traefik shows a 404 or its default certificate | The container is not healthy yet (wait ~30 s), the router labels did not load (check `TRAEFIK_NETWORK`), or the certificate is still being issued. `docker ps` should say `(healthy)`. |
| "redirect_uri_mismatch" on Google | The redirect URI in Google Cloud must match **exactly** the one shown in Settings → Google (scheme, host, path). Set `PUBLIC_URL` so it is stable. |
| Google worked, then stopped after a week | An OAuth app in **Testing** mode gets refresh tokens that expire after 7 days. Publish the consent screen to *In production*, or press *Reconnect Google*. |
| "Google did not grant this permission" | You unticked a box on the consent screen. Reconnect and allow everything. |
| WhatsApp "Verify and save" fails in Meta | The verify token in Meta must equal the one in Settings → WhatsApp, and `PUBLIC_URL` must be reachable over HTTPS from the internet. |
| WhatsApp messages never arrive | Subscribe the webhook to the **`messages`** field; check *Last webhook received* in Settings. If you set an App secret, it must be that app's secret or every delivery is refused. |
| "WhatsApp only allows a free-text reply within 24 hours" | Meta's rule: outside the 24-hour window only approved templates may be sent. |
| Telegram status shows an error | Usually `PUBLIC_URL` is not public HTTPS. Fix it and press *Save & re-register webhook*. |
| Talk says the microphone cannot open | The page must be served over HTTPS (or `localhost`) and the browser must allow the microphone. |
| Talk connects then closes | The Gemini key is wrong or the chosen Live model is not available to it — change the model in Settings → Voice. |
| Chat steps appear all at once at the end | A proxy is buffering server-sent events — see the nginx/Caddy blocks above. |
| Everyone's saved keys stopped working after a redeploy | `ENCRYPTION_KEY` changed, or the data volume was recreated without its `.encryption_key`. Restore it, or have users re-enter their keys. |
