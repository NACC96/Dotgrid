# Dotgrid iPad

An iPad-first, local grid vector editor adapted from [Hundredrabbits Dotgrid](https://github.com/hundredrabbits/Dotgrid). It keeps the established line, arc and quadratic path engine, with captured Pencil input, explicit touch editing, three layers, full-document undo, local projects and offline app caching.

This is a testable implementation candidate. **Real iPad/Pencil acceptance is pending.** Desktop WebKit and synthetic pen tests cannot establish palm behavior, Pencil feel, Home Screen lifecycle or native Files destinations. The proposed platform floor is iPadOS/Safari 17; the primary device is not yet identified.

## Run locally

Requires Node.js 22 or later and npm. Runtime code has no third-party dependencies.

```sh
npm ci
npx playwright install chromium webkit
npm test
npm start
```

Open `http://127.0.0.1:4173`. `npm run build` produces the allowlisted `dist/` application; deploy that directory only. Root `index.html` and `debug.html` are generated entry points, not editing sources. The desktop harness serves `dist/`, including the service worker. A localhost URL on your Mac cannot be reached as localhost from your iPad; use an HTTPS deployment for device testing.

## Draw and edit

Pencil or mouse taps add 15-unit snapped points. Choose Line, either arc direction and size, or Quadratic Bézier; then **Apply**. Lines/arcs need at least two points. Quadratic construction needs 3, 5, 7 or 9. **Close path** closes the last path. **Remove last point** and **Cancel** affect pending construction. Pending points are not saved until Apply; changing context offers Finish, Discard points or Stay.

Fingers navigate with a two-finger pan/pinch after Pencil lifts. In **Touch editing** mode, one finger edits; a second finger cancels the tentative edit before navigating. Select Move shared point, Move segment, Duplicate segment or Move layer before dragging. Segment targeting uses the nearest vertex; **Next target** cycles overlapping segment candidates. Shared-point edits affect all matching vertices in the active layer. Delete modes show the proposed result; **Apply deletion** commits it. Deleting a quadratic point removes affected curve primitives and the orphaned Close while retaining unaffected curves with their original coordinates.

Use Front/Middle/Back for the active layer. Settings offers color with Apply/Cancel, thickness, caps, joins, fill, mirror, explicit document dimensions, merge and clear. Resize, rotation and zoom change only the viewport. Undo/redo restores geometry, styles and dimensions together, with 20 completed actions retained. Opening a project starts a new history baseline.

Keyboard: Cmd/Ctrl+Z undo; Shift+Cmd/Ctrl+Z or Cmd/Ctrl+Y redo; Cmd/Ctrl+1/2/3 layers; Cmd/Ctrl+O import; Cmd/Ctrl+N new; Cmd/Ctrl+S/E export; Cmd/Ctrl+M merge. A/S/D/F/T/Y apply line/arc/reverse/quadratic/large arc/large reverse; Z closes; Escape clears construction; Backspace removes the last pending point; H toggles grid; 0 fits. Text fields and dialogs keep their own keyboard/clipboard behavior. Copy/cut/paste supports an active-layer payload within compatible editors.

## Save and back up

The project-name button opens Local projects: New, import `.grid`, open, rename, duplicate, delete and backup. Saves use IndexedDB. **Saved** appears only after the latest revision’s transaction completes. An unfinished drag or unapplied points are not durable. A save failure preserves the draft and offers Retry, Export backup or an explicit discard when leaving. Exporting or cancelling Share does not authorize a project switch. A concurrent editor cannot overwrite another saved revision: keep the draft, Save as copy, export, or explicitly load the saved version.

Export first prepares `.grid`, SVG or PNG, then offers separate Share and Download taps. `.grid` is the editable backup; SVG/PNG are artwork exports without grid/selection overlays. PNG defaults to transparent 2× document resolution. A provisional 16,777,216-pixel allocation budget offers lower resolution before allocating oversized PNGs. Import limits are provisional: 10 MiB JSON, 50,000 vertices/segments and 10,000 units per dimension. Oversized files are rejected as a whole.

Save `.grid` backups in Files after substantial work and before changing devices or URLs. Local browser storage can be cleared or evicted; a persistence request is not an independent backup. Safari and a Home Screen app may have separate libraries. Transfer explicitly through `.grid` export/import.

## Install, offline use and updates

See [deployment instructions](docs/deployment.md) and [physical-device checklist](docs/ipad-validation.md). Install from Safari’s Share → Add to Home Screen → Open as Web App. Open the installed app online and wait for **Offline ready** before testing a cold offline launch. Installation alone does not guarantee offline use.

App updates remain pending until **Save and update** safely checkpoints the latest drawing and coordinates other open editors. Dirty, active or unresponsive editors defer the update. **Repair offline cache** refreshes only application files; it retains the artwork database. If the application shell is entirely absent while offline, reconnect to recover the app. Do not clear website data as routine troubleshooting.

Settings → Diagnostics shows local render-work/frame/allocation metrics, release and storage state. No artwork or diagnostics are uploaded. Performance targets and actual-device acceptance remain in the [validation record](docs/ipad-validation.md).

## Source and licenses

Baseline: `af10366e69ae02bc36cc81522cdd6fbf7ea17238`. Source code is MIT; retain [LICENSE](LICENSE). Upstream text/images/non-code assets have a [separate BY-NC-SA license](LICENSE.by-nc-sa-4.0.md). This app ships newly authored icons, interface and help text; upstream example artwork, fonts and documentation are excluded from `dist/`. The original `README.txt` is retained as historical upstream documentation. Distribution includes both license notices.
