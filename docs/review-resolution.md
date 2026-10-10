# Candidate review resolution

The complete ce-code-review receipt is recorded under run `20261010-115608-b6721c24`. Nine local review lenses covered the implementation against upstream `af10366e69ae02bc36cc81522cdd6fbf7ea17238`. The original pre-fix verdict was **Not ready**: seven findings were confirmed and one discretionary cleanup was rejected. This document records the subsequent fixes without changing that original receipt.

| Finding | Resolution | Regression evidence |
|---|---|---|
| 1 — legacy resize dimensions | Keep retained width/height synchronized with canonical size during resize and validation. Undo restores the original dimensions. | `tests/unit/edit-boundaries.test.js`: exported legacy fields agree with both fork validation and pinned upstream migration. |
| 2 — connected quadratic endpoint | Append a continuation without its shared start point only to compatible odd-length curves. Leave imported even-length arrays untouched and create a separate new curve. | Connected paths and SVG reach each requested endpoint; the existing imported path remains unchanged. |
| 3 — project transition / late save | Freeze and cancel input throughout checkpoint, storage operation and activation. Reject overlapping transitions. Ignore save completions from an earlier project generation; wait for existing saves before saving a copy and pause new original-project saves through copy creation, including suspension events. | Real IndexedDB and canvas regressions cover delayed New/import/delete, stale save completion and save-as-copy ordering. |
| 4 — unsaveable oversized edits | Validate the prospective complete document before replacing data, adding history or notifying autosave. Clean up rejected drag previews; retain rejected construction points. | At-limit duplicate, construction and combined paste reject without changing revision/history; `.grid` backup remains usable. Browser actions produce notices without uncaught errors. |
| 5 — mixed-case none paint | Canonicalize the stroke and fill sentinel to lowercase during validation. | Canvas omits paint; independently decoded SVG and PNG remain transparent. |
| 6 — stalled precache work | Bound the complete network/body/digest verification stage to 15 seconds, abort outstanding requests, and clean up the timer. Write cache entries only after every resource verifies. | Controlled install and repair stalls reject with a retry message and no cache writes; failed repair preserves the existing shell. |
| 8 — runtime update evidence | Build three distinct runtime bundles in scratch fixtures and assert their execution markers after activation/recovery. | Both browser engines switch runtime markers while retaining saved artwork and the preceding cache. |

Finding 7 was rejected: removing unused inherited Source compatibility wrappers was discretionary cleanup with no demonstrated defect. Those methods remain; this is not deferred work.

Targeted follow-up verification closed findings 1–6 and 8 with no unresolved findings. Its separate `review-fix-verification.json` preserves the original receipt and records ten focused tests, five actual-Client probes and the final full suite.

A subsequent hosting preflight identified Pages HTML canonical redirects. The cache fetches `/` and `/404` while retaining its stable `index.html`/`404.html` keys, with an update-server fixture that reproduces those redirects. This integration follow-up passed the complete 59-unit/78-browser suite plus Cloudflare local-emulator header, digest and offline lifecycle checks before publication.

The cross-model pass did not run because the available runner terminates quiet/slow runs by timeout, contrary to the user's agent-run rule. Local adversarial review ran instead. No programmatic peer run was launched or interrupted.

Physical Pencil, Files, installed-app lifecycle and sustained iPad performance checks remain **Not tested** in `ipad-validation.md`. Desktop browser tests do not establish device acceptance. Deployment evidence and final automated counts are recorded in `implementation.md`.
