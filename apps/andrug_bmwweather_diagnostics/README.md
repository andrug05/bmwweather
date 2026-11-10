# BMW Weather Diagnostics 0.2.1 — native OAP app

This is a source-package app for BMW MGU ID7. MGU Store discovers it through the root `mgu-repo.json` and builds it on the head unit using the installed BMW OAP SDK.

Version 0.2.1 makes the ID7 compatibility explicit at all three discovery levels: the repository component entry, `mgu-app.json`, and the OAP `package.json`. The Store listing also receives an explicit title and description.

- `mgu-app.json`: source modules, SDK modules and supported HMI.
- `src/diagnostics.js`: RHMI application logic.
- `package/`: OAP package metadata and ID7 RHMI resources.
- `package/rhmiData/variantGroups/Common/images/`: app tile icon.

The app reads the report written by the background `andrug-bmwweather-diagnostics` tool and requests a new check by creating `bmwweather-diagnostics.request` in the shared OAP data directory.

The old `0.1.0` bmw-games release is obsolete and must not be used.
