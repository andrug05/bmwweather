# Installation on BMW MGU ID7

## Add the source

1. In MGU Store, open **Settings → Add source**.
2. Enter `andrug05/bmwweather`.
3. Select **Branch → main**.
4. Refresh/check the source so both components appear.

## BMW Weather Bridge

Install **BMW Weather Bridge** to fetch MET Norway forecasts and write the native BMW Weather cache. It runs as UID 12256 and uses MGU Store's `mgu-uplink`.

## BMW Weather Diagnostics (separate tool)

Install **BMW Weather Diagnostics** as a separate component. It has its own UID (12257), its own internet permission and its own service. It does not modify the Weather Bridge, restart it, or write to the native Weather cache.

After installation, wait about 20 seconds. The diagnostic tool creates two easy-to-copy reports:

```text
/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.txt
/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.json
```

The text report gives a compact status per check; the JSON contains details. Both are written with mode `0644`. The tool refreshes local checks every five minutes. It does not request the MET Norway forecast more often than once every three hours during one service lifetime, respecting the provider's request policy.

The diagnostics check:
- whether the Bridge process and component directory exist;
- the diagnostic process UID/GID;
- app-specific and system MGU uplink lease presence;
- DNS resolution and HTTPS forecast retrieval from MET Norway;
- native Weather cache readability and expected JSON envelope;
- availability of the Bridge's own diagnostic report.

No root access is required for normal use. If the shared OAP data directory itself is inaccessible, the tool reports the failure in its service log; it does not attempt privilege escalation.

## Remove

The two components can be installed and removed independently from MGU Store. Removing Diagnostics does not remove or change the Bridge. Removing the Bridge does not remove Diagnostics.
