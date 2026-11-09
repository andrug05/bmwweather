# BMW Weather Bridge (MGU ID7)

An independent Node.js service that downloads forecast data from Open-Meteo and writes a BMW Weather-compatible cache file for the native MGU Weather OAP.

> **Experimental / not yet validated on a vehicle.** The native app's cache format is inferred from the installed OAP bundle. Back up the cache and verify the deserialized model before enabling the service on a car.

## What it does

- Uses HTTPS requests to Open-Meteo (no npm dependencies).
- Runs as a separate process; it does not patch `bundle.js` or replace the native app.
- Writes `/var/opt/public/oap/oap_12214/data/weatherDataCache.json` using a temporary file and atomic rename.
- Preserves the current cache as a timestamped backup before replacing it.
- Can run once for a manual test or periodically as a daemon.

## Network access on MGU

The service must be assigned a dedicated UID which is permitted by the installed `mgu-uplink` policy. Do not assume that adding a UID file alone is sufficient: verify the actual UID, routing policy and HTTPS/DNS connectivity on the target MGU. This project deliberately does not change global routes, DNS, firewall rules, or the uplink service.

## Install

See [INSTALL.md](INSTALL.md). First copy `config.example.json` to `config.json` and set the vehicle's current town, latitude, longitude and language.

## Test

```sh
node src/bridge.js --once
```

Inspect the generated JSON and native app behavior before enabling the init script.

## Important compatibility note

The bridge serializes the native cache envelope (`timestamp`, `localWeather`, `languageOfRequest`, `destWeather`, `location`, `data`). The exact nested forecast schema and cache acceptance rules can vary by OAP build. The initial mapping is based on reverse-engineering notes for Weather OAP 4.10.49 and must be checked against the target car's `bundle.js`. A successful file write does **not** prove the BMW Weather app has accepted or displayed the record.

## Data source

Weather data: [Open-Meteo](https://open-meteo.com/). Check its current terms and attribution requirements before public redistribution or commercial use.
