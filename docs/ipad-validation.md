# iPad validation

Primary iPad, Pencil and iPadOS version: **not yet identified**.
Physical-device acceptance: **not tested**. Desktop WebKit and synthetic pen events do not establish hardware responsiveness or palm rejection.

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
