# Installation on BMW MGU ID7

## MGU Store installation (recommended)

The repository contains `mgu-repo.json` and a native tool component under `native/andrug_bmwweather_bridge/`.

1. In MGU Store, open **Settings → Add source**.
2. Enter `andrug05/bmwweather`.
3. Select **Branch → main**.
4. Open **BMW Weather Bridge** and select **Install**.

The component installs and enables `andrug-bmwweather-bridge.service`. It runs as UID `12214`, which is also the UID declared for internet access through `mgu-uplink`. The bundled configuration uses Yoshkar-Ola coordinates. To use another city, change `native/andrug_bmwweather_bridge/config.json` in your own fork before adding that fork as a source.

**Important:** installation enables the service, which periodically writes the native Weather cache. It creates a timestamped backup before replacing an existing cache file. The native app's acceptance of the generated data is still experimental and must be checked on the car.

## Manual test / diagnostics

The manual script remains available at `src/bridge.js`. Copy `config.example.json` to `config.json`, set the location and run:

```sh
node src/bridge.js --once
```

Before a manual test, back up the native cache:

```sh
cp -p /var/opt/public/oap/oap_12214/data/weatherDataCache.json /var/opt/public/oap/oap_12214/data/weatherDataCache.json.manual-backup
```

A successful file write does **not** prove the BMW Weather app accepted or displayed the record.

## Rollback

Remove **BMW Weather Bridge** from MGU Store. If the native Weather app does not display the forecast, restore the cache backup created before the first bridge write. Do not remove or modify the native Weather OAP application.
