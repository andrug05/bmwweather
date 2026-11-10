# Installation on BMW MGU ID7

## MGU Store installation

1. In MGU Store, open **Settings → Add source**.
2. Enter `andrug05/bmwweather`.
3. Select **Branch → main**.
4. Open **BMW Weather Bridge** and select **Install**.

The component installs and enables `andrug-bmwweather-bridge.service`. It runs as UID `12256`, uses MGU Store's `mgu-uplink` for internet access, and writes the native Weather cache. The bundled configuration uses Yoshkar-Ola coordinates and UTC+03:00.

**Important:** installation enables the service, which periodically writes the native Weather cache. It creates a timestamped backup before replacing an existing cache file. The native app's acceptance of the generated data is experimental and must be checked on the car.

## Data source

The bridge uses MET Norway Locationforecast 2.0. No API key is required. The provider requires a descriptive User-Agent with contact information. The default refresh interval is 180 minutes because forecasts outside the Nordic region update every six hours and identical requests should not be repeated more often than every three hours. Attribution: **Weather data from MET Norway** (CC BY 4.0).

## Rollback

Remove **BMW Weather Bridge** from MGU Store. If the native Weather app does not display the forecast, restore the timestamped cache backup created by the bridge. Do not remove or modify the native Weather OAP application.


## Diagnostics (v0.2.2)

The service writes a JSON report to `/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.json` with mode `0644`, so it can be read by non-root processes that have access to the shared OAP data directory. It records service identity, the app-specific MGU Store uplink lease, DNS resolution, MET Norway HTTPS access, forecast parsing, native payload validation, and cache write/read-back. Errors are stored in `lastError`; no private keys or full uplink lease contents are included. The service also emits `DIAG` journal lines for each stage.
