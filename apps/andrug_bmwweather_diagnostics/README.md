# BMW Weather Diagnostics — native OAP app

This directory is a source-package app for BMW MGU ID7. MGU Store discovers it through the root `mgu-repo.json`, reads `mgu-app.json`, and builds the package on the head unit using the installed BMW OAP SDK.

- `mgu-app.json`: source modules and SDK modules.
- `src/diagnostics.js`: RHMI application logic.
- `package/`: OAP package metadata and ID7 RHMI resources.
- `package/rhmiData/variantGroups/Common/images/`: app tile icon.

The app reads the report written by the background `andrug-bmwweather-diagnostics` tool and requests a new check by creating `bmwweather-diagnostics.request` in the shared OAP data directory.

The old `0.1.0` bmw-games release is not compatible with the MGU Store app catalog and must not be used.
