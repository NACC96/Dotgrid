# iPad validation

Primary iPad, Pencil and iPadOS version: **not yet identified**.
Physical-device acceptance: **not tested**. Desktop WebKit and synthetic pen events do not establish hardware responsiveness or palm rejection.

Candidate testing origin: [feat-ipad-pwa.dotgrid-ipad-preview.pages.dev](https://feat-ipad-pwa.dotgrid-ipad-preview.pages.dev). Application release: `fd0451ec4ad699cc36ab`; project/IndexedDB schema: `1`. This temporary preview is updated manually; export `.grid` backups before moving to a permanent origin.

Record the device model/model number, Pencil generation, iPadOS, power mode, available storage, refresh capability, application release and database schema before testing.

Run in Safari and installed Home Screen mode:

- Pencil taps, shared-point/segment drags, capture loss, palm contact and finger navigation between edits.
- Touch mode, second-finger cancellation, all construction/style/layer commands.
- Rotation, Split View and keyboard appearance without document-size changes.
- Small/standard/stress benchmark drag and pinch traces; inspect recurring frames over 33 ms and tasks over 50 ms. The proposed p95 render-work target is 12 ms for the standard drawing.
- Await Saved, terminate/reopen, compare the revision; repeat offline. Interruption before Saved is a separate case.
- Import/export `.grid`, SVG and PNG through Files; inspect the actual destination and reopen the editable backup.
- Install, verify Offline ready, cold-launch in airplane mode and save/reopen.
- Update during dirty/pending work and with another editor open; verify safe checkpoint, one reload and recovery.
- Cache repair retains projects; missing app resources while offline require reconnection.

Record Pass / Fail / Not tested and reproduction notes for each item. No row is passed merely because its desktop test succeeds.

## Acceptance record

| Item | Safari | Home Screen | Evidence / operator notes |
|---|---|---|---|
| Device/Pencil/iPadOS identified | Not tested | Not tested | User is not sure of the hardware yet; inspect Settings → General → About and Pencil identification |
| Rapid taps, palm contacts, captured drags | Not tested | Not tested | Synthetic desktop ownership tests passed; physical routing remains unknown |
| Two-finger navigation / touch-edit cancellation | Not tested | Not tested | Desktop state tests passed |
| All tools, styles, layers, keyboard and dimensions | Not tested | Not tested | Chromium/WebKit integration passed |
| 30-second standard Pencil/pinch traces | Not tested | Not tested | Desktop renderer samples in desktop-benchmarks.json are preliminary evidence only |
| Saved restart, undo/redo restart, interruption before Saved | Not tested | Not tested | Real browser IndexedDB completion/reopen and failure tests passed |
| .grid/SVG/PNG reach Files and reopen | Not tested | Not tested | Typed file/download/PNG pixels tested; native destinations untested |
| Safari-to-Home-Screen library transfer | Not tested | Not tested | Never assume automatic transfer; editable .grid export/import is available |
| Offline ready and cold airplane-mode launch | Not tested | Not tested | Desktop worker cold-launch/edit/save tests passed |
| Pending/dirty/other-editor update; one reload | Not tested | Not tested | Desktop old/new/recovery sequence passed |
| Cache repair and compatible recovery retain projects | Not tested | Not tested | Browser cache-only repair/previous release tests passed |
| User accepts Pencil responsiveness | Not tested | Not tested | Required before first-release acceptance |

Record the tested HTTPS origin and commit/release in each completed row. Preview and production libraries are separate. Do not place the only copy of real work in a preview library.
