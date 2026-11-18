# Lord Minds desktop app

This Electron wrapper runs the existing Lord Minds server locally and opens it in a native desktop window. It stores the desktop app's database and generated encryption/session keys in the operating system's application-data directory, not in the project checkout.

## Run during development

From this directory:

```powershell
npm install
npm run dev
```

## Build an installer

On Windows:

```powershell
npm run package:win
```

The NSIS installer is written to `desktop/dist`. Build the macOS DMG on a Mac:

```bash
npm run package:mac
```

To build a macOS `.pkg` installer instead of a `.dmg`:

```bash
npm run package:mac:pkg
```

To produce one installer that works on both Apple Silicon and Intel Macs, run this on a Mac:

```bash
npm run package:mac -- --universal
```

## Build a Mac installer from Windows

Windows cannot build macOS installers. This repository includes `.github/workflows/build-macos-desktop.yml`, which runs Apple Silicon and Intel package builds on GitHub-hosted Macs. Push the project to a GitHub repository, open **Actions → Build macOS desktop installer → Run workflow**, then download the matching `Lord-Minds-macOS-arm64-pkg` or `Lord-Minds-macOS-x64-pkg` artifact. The resulting `.pkg` can be shared and installed on a Mac.

The packaging process creates a clean staging copy of the server, including its verified production dependencies. It deliberately excludes `server/data` and `.env`, so an installer never contains local accounts, API keys or database data.

The desktop app does not embed n8n. Connect an external n8n instance in Lord Minds Settings when you need automations. Integrations that require public webhooks or Google OAuth still need a public HTTPS endpoint.
