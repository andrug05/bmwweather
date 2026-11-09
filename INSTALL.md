# Installation on BMW MGU ID7

This guide is intentionally conservative. It does not modify global networking or the native Weather OAP code.

## 1. Copy the module

Copy this repository to the MGU, for example:

```sh
mkdir -p /var/opt/public/bmwweather
# transfer repository files into this directory
```

Check the Node runtime first:

```sh
node --version
id
```

## 2. Configure the location

```sh
cd /var/opt/public/bmwweather
cp config.example.json config.json
vi config.json
```

Set `town`, `latitude`, and `longitude` to the location that the native Weather app should display. Configure language and refresh interval as needed.

## 3. Verify network access under the service UID

Do not run the service as root for the final setup. Choose a dedicated UID only after checking the existing MGU account and mgu-uplink policy. Confirm DNS and HTTPS access to `api.open-meteo.com:443` under that UID. The service itself does not add routing rules or change DNS.

The exact UID integration is device-specific. The `mgu-uplink` UID allow-list must be configured by the MGU owner/operator, then verified with read-only route and HTTPS tests. Do not overwrite existing UID or app policy files.

## 4. Run a one-shot test

```sh
node src/bridge.js --once
```

Before the first run, back up the native cache:

```sh
cp -p /var/opt/public/oap/oap_12214/data/weatherDataCache.json /var/opt/public/oap/oap_12214/data/weatherDataCache.json.manual-backup
```

Review the generated JSON. If the native app does not show the forecast, restore the backup and inspect the exact OAP 4.10.49 model/cache schema before trying again.

## 5. Enable periodic execution

Only after the one-shot output and native app behavior are verified, configure the platform's supported init/supervisor mechanism to run:

```sh
node /var/opt/public/bmwweather/src/bridge.js
```

Do not blindly install the example init script on an unknown MGU firmware. Confirm its init system and service conventions first.

## Rollback

Stop the bridge process, then restore the backup:

```sh
cp -p /var/opt/public/oap/oap_12214/data/weatherDataCache.json.manual-backup /var/opt/public/oap/oap_12214/data/weatherDataCache.json
```
