# BMW Weather Diagnostics 0.2.4 — native OAP app

This is a source-package app for BMW MGU ID7. MGU Store discovers it through the root `mgu-repo.json` and builds it on the head unit using the installed BMW OAP SDK.

Version 0.2.4 fixes the GUI/service hand-off: the OAP app (UID 12224) creates its request and reads its report in its own `oap_12224/data` directory. The background diagnostics tool continues to read the native Weather cache and MGU uplink lease from `oap_12214/data`. The Bridge's own diagnostic report remains separate from the GUI report.

- `mgu-app.json`: source modules, SDK modules and supported HMI.
- `src/diagnostics.js`: RHMI application logic.
- `package/`: OAP package metadata and ID7 RHMI resources.
- `package/rhmiData/variantGroups/Common/images/`: app tile icon.
- `../..` `native/andrug_bmwweather_diagnostics/`: standalone service source.

The app UUID and entry-point UUID remain unchanged so the installed iDrive tile is preserved.
