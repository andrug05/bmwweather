# BMW Weather Bridge (MGU ID7)

An independent Node.js service that fetches global weather forecasts from MET Norway Locationforecast and writes a BMW Weather-compatible cache file for the native MGU Weather OAP.

> **Experimental / not yet validated on a vehicle.** The native app's cache format is inferred from the installed OAP bundle. Back up the cache and verify the deserialized model before enabling the service on a car.

## What it does

- Uses HTTPS to MET Norway Locationforecast 2.0 (no API key and no npm dependencies).
- Converts MET Norway's GeoJSON-style time series into the forecast structure expected by the BMW Weather cache.
- Runs as a separate process; it does not patch `bundle.js` or replace the native app.
- Writes `/var/opt/public/oap/oap_12214/data/weatherDataCache.json` using a temporary file and atomic rename.
- Preserves the current cache as a timestamped backup before replacing it.
- Can run once for a manual test or periodically as a daemon.

## Network access on MGU

The service must be assigned a dedicated UID which is permitted by the installed `mgu-uplink` policy. The component declares UID `12256` and requests internet access through MGU Store. Verify the actual UID, routing policy and HTTPS/DNS connectivity on the target MGU. This project does not change global routes, DNS, firewall rules, or the uplink service.

## Install through MGU Store

1. Open **MGU Store → Settings → Add source**.
2. Add `andrug05/bmwweather`.
3. Choose **Branch** and select `main`.
4. Open **BMW Weather Bridge** and choose **Install**.

The bundled default location is Yoshkar-Ola. The configured UTC offset is +03:00. Change `native/andrug_bmwweather_bridge/config.json` in your own fork if you need another location/time zone.

## Data source and request policy

Weather data is provided by [MET Norway Locationforecast 2.0](https://api.met.no/weatherapi/locationforecast/2.0/documentation), with global coverage and forecasts up to nine days. MET Norway requires a descriptive User-Agent with genuine contact information; the bridge identifies the project through its public GitHub issues page. For locations outside the Nordic region, the service data is updated every six hours and identical requests should not be repeated more often than every three hours, so the default refresh interval is 180 minutes.

MET Norway data is licensed under CC BY 4.0. Attribution: **Weather data from MET Norway**. See the provider's terms and data policy before redistribution.

## Test

After installation, inspect the service log and cache on the MGU. A successful file write does **not** prove the BMW Weather app accepted or displayed the record.

## Important compatibility note

The bridge serializes the native cache envelope (`timestamp`, `localWeather`, `languageOfRequest`, `destWeather`, `location`, `data`). The exact nested forecast schema and cache acceptance rules can vary by OAP build. The initial mapping is based on reverse-engineering notes for Weather OAP 4.10.49 and must be checked against the target car's `bundle.js`.
