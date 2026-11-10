# BMW Weather Bridge and Diagnostics (MGU ID7)

This repository provides two background MGU Store tools and a separate graphical RHMI application:

- **BMW Weather Bridge** fetches global forecasts from MET Norway Locationforecast and writes a candidate BMW Weather cache.
- **BMW Weather Diagnostics (tool)** checks the Bridge, MGU Store uplink, DNS, MET Norway HTTPS, native Weather cache and permissions. It writes JSON and text reports.
- **BMW Weather Diagnostics (app)** is a native OAP/RHMI app for the MGU ID7 application list. It displays the report and can request a new check from the background tool.

> **Experimental / not yet validated on a vehicle.** A successful network request or cache write does not prove the native BMW Weather app accepted or displayed the forecast.

## Install through MGU Store

1. Open **MGU Store → Settings → Add source**.
2. Add the GitHub repository `andrug05/bmwweather`.
3. Select the `main` branch and refresh the source.
4. Install **BMW Weather Bridge** for weather data.
5. Install the background **BMW Weather Diagnostics** tool.
6. Install **BMW Weather Diagnostics** app from the same repository source. It is a separate app component and should appear in the Store's app list after refreshing the source.

The graphical app is published as an OAP source package through `mgu-repo.json` and is built by the head unit against its own BMW OAP SDK. It is not a `bmw-games` archive and is not installed from the old 0.1.0 GitHub Release. The old release is obsolete and should not be used.

## Diagnostics reports

The background tool writes:
- `/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.txt`
- `/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.json`

Local checks run every five minutes. MET Norway forecast requests are limited to at most one per three hours per diagnostic service lifetime. The graphical app reads the JSON report and writes a request marker when **Проверить** is pressed; the background tool consumes that marker and performs the check.

## Data source and request policy

The Bridge uses MET Norway Locationforecast 2.0. No API key is required. The provider requires a descriptive User-Agent. The Bridge refresh interval is 180 minutes. Attribution: **Weather data from MET Norway** (CC BY 4.0).

## Compatibility

The Bridge serializes a candidate native cache envelope based on reverse-engineering notes for Weather OAP 4.10.49. The nested forecast schema and cache acceptance rules can vary by OAP build and must be checked on the target car.
