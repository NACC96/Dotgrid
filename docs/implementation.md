# Implementation evidence — Dotgrid iPad candidate

Recorded October 10, 2026. Software implementation is published in [PR #1](https://github.com/NACC96/Dotgrid/pull/1); **first-release acceptance is incomplete** until an actual iPad/Pencil passes the device checklist and a permanent production origin is accepted.

The reviewed plan remains unchanged. Its SHA-256 is `643772baec72fedbf747fd3ab558006162c80b969d75a90fee87e4150eef2d7d`. Upstream baseline is `af10366e69ae02bc36cc81522cdd6fbf7ea17238`; implementation branch is `feat/ipad-pwa`. Candidate runtime source commit is `39149e5da1684b190092cd802cecc324b02c81be`.

## Delivered software

| Unit | Local implementation/evidence | Outstanding acceptance |
|---|---|---|
| U1 | Pinned upstream baseline, geometry characterization, deterministic 50/500/2500-segment and legacy fixtures; Node/Playwright harness | No baseline requirement pending locally |
| U2 | Committed document / session / viewport boundaries; 20 full-document actions, branching and baseline reset; signed coordinates; fixed dimensions | Actual rotation, Split View and software-keyboard checks |
| U3 | Captured Pointer Events; pen/mouse edits, deliberate touch mode, second-finger rollback, palm-contact suppression, cancellation and stable gestures | Actual Pencil routing, palm behavior, rapid taps and interrupted contacts |
| U4 | Frame-scheduled direct Canvas 2D; per-layer Path2D cache; bounded backing pixels; local diagnostics and benchmark evidence | 30-second physical drag/pinch traces and user acceptance of Pencil feel |
| U5 | Semantic 44-pixel controls; all constructions, move/duplicate/delete modes, layer/merge, styles, dimensions, undo/redo, keyboard scope, pending-point choices | Touch workflow on target hardware |
| U6 | Revision-checked atomic IndexedDB, autosave status, project library, previous-good recovery; validated imports and prepared .grid/SVG/PNG; separate share/download | Actual Files destinations, real storage pressure and installed-app restart |
| U7 | Deterministic allowlisted dist; owned icons; complete MIME/digest-verified precache; offline readiness, cache-only repair, safe multi-editor update/recovery | Safari and Home Screen lifecycle on iPad |
| U8 | Installation/backup/recovery/deployment documentation; local candidate and screenshots | Deployment-mode choice, deployed-response checks, primary device and production acceptance |

The hardware gate could not run because the primary device is unknown/unavailable in this workspace. Local implementation continued to produce a reviewable candidate. This does not establish the proposed supported device range or certify the renderer/input architecture on an iPad.

The runtime editor remains one plain JavaScript bundle. Packaging uses external content-hashed JS/CSS instead of inline HTML code to support the self-only Content Security Policy and consistent versioned assets; this is a reversible distribution adaptation. Source constructors and the upstream path grammar remain. Obsolete upstream desktop modules are excluded from the runtime allowlist. Imported drawings are validated copies and source files are never overwritten.

## Automated verification

`npm test` runs syntax checks, Node tests, a deterministic build and the Chromium/WebKit browser suite. Lint here means JavaScript syntax validation; no static typechecker or stylistic lint is configured.

The complete integration suite passed **59 Node tests and 78 browser tests** (39 each in Chromium and WebKit), including a newer draft behind an older save, copy creation failure, suspension during copying and retained exportable artwork.

The suite exercises full undo state, pointer cancellation/ownership, legacy appended quadratic geometry, fresh bounded exports and transparent painter order, real IndexedDB abort/reopen/conflicts/recovery, stale save completions across project generations, exclusive New/import/delete transitions, explicit editor recovery, failed project switches retaining the draft after backup, concurrent rename conflicts, capability errors, cold offline launch and save, cache repair, two-editor update freezing, pending/failed/unresponsive update deferral, compatible recovery releases, and missing/wrong-MIME/wrong-digest precache failures preserving the preceding release. Browser pen contacts are synthetic with a capture test surface; mouse contacts use the actual browser pointer path.

Cloudflare’s local Pages emulator parsed all nine header rules and passed byte-digest checks for every public application resource, expected MIME/CSP/cache headers and a genuine missing-asset 404. Chromium and WebKit ran the app under those headers, reached Offline ready, then cold-launched, saved and reopened offline without page errors. [Local provider evidence](pages-local-validation.json) records these checks; this is not deployed HTTPS or hardware evidence.

Test log: `/tmp/dotgrid-full-tests-final.log` (session-local). Physical tests are deliberately separate in [ipad-validation.md](ipad-validation.md).

## Desktop performance evidence

These measurements precede the review fixes; rendering code did not change during those fixes. They are local macOS Playwright measurements at 1024×768 CSS pixels and DPR 2. Each corpus ran 120 navigation frames plus 120 synthetic snapped drag-preview frames. The metric is time inside the renderer, including its path-cache update; it excludes event delivery, some input preparation and end-to-end Pencil latency. These short desktop traces are not the plan's 30-second iPad acceptance traces.

| Corpus | Segments / vertices | Chromium renderer p95 | WebKit renderer p95 |
|---|---|---|---|
| Small | 50 / 108 | 0.3 ms | 1.0 ms |
| Standard | 500 / 1083 | 0.4 ms | 1.0 ms |
| Stress | 2500 / 5417 | 1.1 ms | 3.0 ms |

No observed Chromium long tasks exceeded 50 ms during these traces. WebKit does not expose the long-task entry type in this harness, so its zero counter is not a measurement of absent long tasks. Each trace had zero or one recorded frame gap over 33 ms; the short trace does not establish sustained-device performance. Full counts, styles, mirror modes, dimensions, path-command counts and allocations are in [desktop-benchmarks.json](desktop-benchmarks.json).

[Landscape screenshot](screenshots/editor-landscape.png) and [narrow portrait screenshot](screenshots/editor-portrait.png) show a disposable locally generated study. No demo artwork or test project is shipped in the app shell.

## Simplification and review

The ce-simplify-code pass used independent reuse, quality and efficiency reviewers. Applied two reuse improvements, three dead-state/style removals and four efficiency improvements: shared clone/error helpers; removal of write-only preview/error state and unused CSS; Set-based hit deduplication, repeated-position preview suppression, one validation per SVG snapshot, and cursor-based metadata listing. Safety validation, save/update protection and accessibility controls remain intact.

The complete ce-code-review receipt is run `20261010-115608-b6721c24` under `/tmp/compound-engineering-501/ce-code-review/20261010-115608-b6721c24/review.json` (session-local). Nine local lenses confirmed seven findings; its pre-fix verdict was Not ready. Findings 1–6 and 8 were fixed with regressions, documented in [review-resolution.md](review-resolution.md). Finding 7 was rejected as discretionary removal of inherited compatibility methods without a demonstrated defect. The cross-model pass was skipped because its runner terminates quiet/slow runs; local adversarial review ran instead. Targeted follow-up source verification found no unresolved code findings. The final full suite passed after all fixes. A subsequent source-backed Pages canonical-HTML preflight fix also passed the full suite, redirecting offline/update fixtures and the local provider smoke test.

## Release state

The user authorized a GitHub fork and Cloudflare Pages preview. The fork is [NACC96/Dotgrid](https://github.com/NACC96/Dotgrid); branch `feat/ipad-pwa` is published in ready-for-review [PR #1](https://github.com/NACC96/Dotgrid/pull/1). The seven corrected review findings and remaining device acceptance are also recorded in [the PR review comment](https://github.com/NACC96/Dotgrid/pull/1#issuecomment-6100993039). The application release is `fd0451ec4ad699cc36ab` with project/IndexedDB schema version 1. Cloudflare project creation awaits the Git integration versus Direct Upload decision, because Direct Upload cannot be converted to Git integration later. No preview is deployed yet. Production is not approved by a desktop test result. Provisional limits (10 MiB JSON, 50k geometry items, 10k dimensions, 16,777,216 raster pixels) require actual-device measurement.
