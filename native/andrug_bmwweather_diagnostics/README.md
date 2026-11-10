# BMW Weather Diagnostics

Standalone MGU Store tool for BMW MGU ID7. It is independent of the Weather Bridge service and runs under its own UID (12257) with its own MGU Store internet permission.

## What it checks

- Whether the BMW Weather Bridge process and component directory are present, and the component version.
- Whether this diagnostic tool has its own MGU Store uplink lease, or only the system-wide lease.
- DNS resolution for `api.met.no` using the DNS servers advertised by the lease.
- HTTPS access to MET Norway Locationforecast 2.0, HTTP status, JSON validity and forecast time-step count.
- Whether the native BMW Weather cache exists, is readable JSON and has the expected forecast envelope.
- Whether the Bridge's own diagnostic report is available.

The diagnostic tool does not modify the Weather cache and does not restart or change the Bridge. It writes its own report files:

- `/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.json`
- `/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.txt`

Both files are created with mode 0644. The text report is intended to be easy to copy and send for support.

The checks refresh every five minutes. To respect MET Norway's request interval, an identical forecast request is made no more often than once every three hours per service lifetime. A service restart performs a fresh request.

## Install

In MGU Store, refresh the `andrug05/bmwweather` source on branch `main`, find **BMW Weather Diagnostics**, and install it. It is a separate tile and can be removed independently from **BMW Weather Bridge**.

After installation, wait about 20 seconds and retrieve the text or JSON report from the shared OAP data directory using an available MGU Store file viewer. No root access is required. If the shared directory itself is not readable to the caller, the diagnostic service records that as a report-write error in its service journal; it does not attempt privilege escalation.
