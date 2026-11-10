# BMW Weather Bridge and Diagnostics (MGU ID7)

This repository provides two independent MGU Store tools for BMW MGU ID7:

- **BMW Weather Bridge** fetches global forecasts from MET Norway Locationforecast and writes a candidate BMW Weather cache.
- **BMW Weather Diagnostics** independently checks the Bridge, MGU Store uplink, DNS, MET Norway HTTPS, and the native Weather cache. It writes a plain-text and JSON report without changing the Weather cache.

> **Experimental / not yet validated on a vehicle.** A successful network request or cache write does not prove the native BMW Weather app accepted or displayed the forecast.

## Install through MGU Store

1. Open **MGU Store → Settings → Add source**.
2. Add `andrug05/bmwweather`.
3. Select branch `main` and refresh the source.
4. Install **BMW Weather Bridge** to provide weather data.
5. Install **BMW Weather Diagnostics** separately when troubleshooting is needed.

The Bridge runs under UID 12256. Diagnostics runs under UID 12257. Both declare their own MGU Store internet permission and do not change global routes, DNS, firewall rules or the uplink service.

## Diagnostics reports

Diagnostics checks whether the Bridge process is present, whether the app-specific uplink lease exists, whether MET Norway resolves and responds over HTTPS, and whether the native Weather cache is readable JSON with the expected envelope. It also checks for the Bridge's own report.

It writes:
- `/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.txt` — compact, copy-friendly summary.
- `/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.json` — detailed machine-readable report.

Local checks run every five minutes. MET Norway forecast requests are limited to at most one per three hours per diagnostic service lifetime. The tool never modifies the Weather cache or restarts the Bridge.

## Data source and request policy

The Bridge uses MET Norway Locationforecast 2.0. No API key is required. The provider requires a descriptive User-Agent. The Bridge refresh interval is 180 minutes. Attribution: **Weather data from MET Norway** (CC BY 4.0).

## Compatibility

The Bridge serializes a candidate native cache envelope based on reverse-engineering notes for Weather OAP 4.10.49. The nested forecast schema and cache acceptance rules can vary by OAP build and must be checked on the target car.
