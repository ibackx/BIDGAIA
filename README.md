# Serenity Chat Widget Demo

Minimal React + Vite demo integrating Serenity JavaScript Chat Widget (and AIHubChat) with flag detection via callbacks, non-blocking alert banners, and console logging.

## Run

```
npm install
npm run dev
```
Open the Vite URL (usually `http://localhost:5173`).

## Load the SDK

Add the official SDK `<script>` in `index.html` to expose `window.AIHubChat` or `window.SerenityChatWidget`.

Examples (replace with your official CDN):
```
<!-- AIHubChat -->
<script defer src="https://YOUR-AI-HUB-CDN/aihub-chat.min.js"></script>
<!-- SerenityChatWidget -->
<script defer src="https://YOUR-SERENITY-CDN/serenity-chat-widget.min.js"></script>
```

- AIHubChat mounts into `#aihub-chat`.
- SerenityChatWidget mounts into `#serenity-chat-container`.

## Configure Credentials

Edit `src/serenityWidget.js`:
- AIHubChat: set `apiKey`, `agentCode`, `baseURL`.
- Serenity: set `AGENT_ID` (e.g., GAIA Comunidad) and theme options.

## Flags and Banners

Hooks `onBeforeRender` and `onMessage` detect flags in raw skills; banners show without blocking agent messages. See `src/components/AlertBanner.jsx` and `src/components/AlertBanner.css`.

## Troubleshooting

- Chat not visible: Add the correct SDK `<script>` and credentials.
- SDK load error: Use the official CDN URL you already use elsewhere.
- No flags: Confirm your agent returns raw skills with flags.
	- Verificá que el script del SDK cargue (consola del navegador).
	- Confirmá que `agentId` o `agentCode/apiKey` sean válidos.
	- Revisá que exista el contenedor con id `serenity-chat-container`.

## Deploy (GitHub Pages)

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys the site to GitHub Pages.

Steps:
- Create a repo under the Binit GitHub org, e.g. `binit/BIDGAIA`.
- Push this code to the `main` branch.
- In GitHub, go to `Settings` → `Pages` and set:
  - Source: `GitHub Actions`.
  - If needed, grant workflow permissions under `Settings` → `Actions` → `General` → `Workflow permissions` → `Read and write permissions`.
- After the first push, the public URL will be:
  - `https://<org>.github.io/<repo>/` (e.g., `https://binit.github.io/BIDGAIA/`).

Notes:
- If assets don't load under the repo path, set `base: '/BIDGAIA/'` in `vite.config.js`.
- For SPA routing on Pages, consider adding a `404.html` that mirrors `index.html` to handle deep links.

## Manual Build

To build locally:

```
npm ci
npm run build
```

Output goes to `dist/`.
