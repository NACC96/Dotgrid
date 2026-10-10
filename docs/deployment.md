# Deployment and release operation

The application artifact is `dist/`. The implementation is a release candidate, with physical iPad/Pencil acceptance pending. Do not interpret an automated WebKit pass or a working HTTPS URL as device acceptance.

## Build

```sh
npm ci
npm test
```

The build uses exact runtime/style/public allowlists and content-derived release IDs, with a SHA-256/MIME-checked complete precache. It excludes source maps, Node helpers, tests, fixtures, project files, upstream example assets and debug pages. Only generated `dist/` contents are uploaded. Build setting: `npm run build`; output: `dist`. Do not use repository root as the hosting output.

## Cloudflare Pages candidate

Cloudflare Pages is the planned static host. No functions, artwork database, paid domain or application server is required. The local Cloudflare CLI and dashboard are authenticated to the user's personal account. The user approved publication to [NACC96/Dotgrid](https://github.com/NACC96/Dotgrid) and a new `dotgrid-ipad` Pages preview, and selected **Git integration** for automatic updates. GitHub browser sign-in to `NACC96` is now confirmed, but project creation still fails with Git-installation error `8000011`. Pages lists a different connected owner; `NACC96` already has the shared Cloudflare Workers and Pages app installed with access to all repositories. Repairing this existing installation or creating a temporary preview awaits a separate user decision because reinstalling the shared app affects other repositories.

Configure the Git-connected project as follows:

| Setting | Candidate value |
|---|---|
| Project | `dotgrid-ipad` |
| GitHub repository | `NACC96/Dotgrid` |
| Build command / output | `npm run build` / `dist` |
| Node version | `22` |
| Production branch | `master` |
| Automatic production deployments | Disabled pending acceptance |
| Automatic preview deployments | `feat/ipad-pwa` |

Preserve existing GitHub app access during this deployment. Do not narrow its all-repository scope or uninstall the shared installation without explicit authorization, because that could interrupt unrelated builds. A new independent installation should have access to Dotgrid only. The candidate should be deployed as a preview from `feat/ipad-pwa`, with the actual returned URL recorded after successful deployment.

Capture the actual returned preview URL and release ID. Use disposable `.grid` fixtures there. The preview branch alias is suitable for candidate testing, but must not hold the only copy of real work. Fix the permanent production origin before ordinary use; artwork belongs to its browser origin and will not move automatically to another URL. Production publication follows primary-device acceptance and the user's production-origin decision.

A Direct Upload Pages project cannot be switched into Git integration later; the selected project mode is Git integration. Do not create a Direct Upload replacement under this name. [Cloudflare Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

The `_headers` file supplies CSP, MIME protection and cache settings. Missing resources must return a genuine 404; `404.html` prevents Pages from treating this editor as a catch-all SPA. HTML, manifest and worker revalidate; only content-hashed scripts/styles receive immutable caching. The precache fetches HTML at canonical `/` and `/404` URLs while keeping stable internal cache keys: Pages redirects `.html` routes to extensionless paths. Unexpected resource redirects still fail validation. Check deployed responses independently, including those canonical paths, an unknown script path, manifest, PNG icons, CSP and worker scope. [Pages route matching](https://developers.cloudflare.com/pages/configuration/serving-pages/). [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/).

## iPad installation and backup

Open the chosen HTTPS URL in Safari, use Share → Add to Home Screen, enable Open as Web App where shown, and Add. Open that Home Screen icon online. Wait for **Offline ready** inside Settings; it verifies the complete controlled-worker cache. Then test a cold airplane-mode launch, edit, wait for **Saved**, and reopen. [Apple installation guide](https://support.apple.com/guide/ipad/ipad8f1f7a29/ipados).

Safari and the installed app can use separate project libraries. Export editable `.grid` projects from Safari and import them in the installed app when needed. Check the actual Files destination after Share/Download; neither a button click nor a Share success alone proves a backup exists. Local storage is subject to browser policy, user clearing and device loss even when persistent storage is requested. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/), [Safari 17.2 installation storage behavior](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).

## Updates and recovery

Publish a new artifact online. Open installed Dotgrid online or reconnect; a waiting release exposes **Save and update**. Pending construction must be finished/discarded or the update remains postponed. The initiating editor freezes completed edits while checkpointing. Other controlled editors must be Saved, idle and responsive; dirty/pending/unresponsive peers postpone activation. A clean coordinated activation reloads each participating editor once and restores its saved project. Schema version is currently 1.

A provider rollback does not replace code already running on a device. Build a compatible recovery release with a new content-derived release ID and use the same safe-update sequence. Keep the preceding source revision and artifact until recovery checks pass. Do not downgrade IndexedDB schema or delete it as part of an update. [Pages rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/).

**Repair offline cache** refetches only current application shell files, validating each response; it preserves IndexedDB. If the shell has been entirely evicted and cannot launch offline, reconnect first. Do not advise clearing all website data. Export `.grid` backups before origin changes, substantial upgrades or device migration.

## Release evidence

Record source commit, artifact/release ID, app/project schema, preview/production origin, response/header checks and automated results in `docs/implementation.md`. Record device model/Pencil/iPadOS, Safari versus installed mode, power/storage/display conditions, benchmark and Files results in `docs/ipad-validation.md`. All unperformed device checks remain **Not tested**.
