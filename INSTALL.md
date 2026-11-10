# Installation on BMW MGU ID7

## Add the repository source

1. In MGU Store, open **Settings → Add source**.
2. Enter `andrug05/bmwweather`.
3. Select **Branch → main**.
4. Refresh/check the source so the components are listed.

## BMW Weather Bridge

Install **BMW Weather Bridge** to fetch MET Norway forecasts and write the candidate native BMW Weather cache. It runs as UID 12256 and uses MGU Store's `mgu-uplink`.

## BMW Weather Diagnostics — background tool

Install the separate **BMW Weather Diagnostics** tool. It has its own UID (12257), its own internet permission and its own service. It does not modify the Weather Bridge, restart it, or write to the native Weather cache.

It writes:
```text
/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.txt
/var/opt/public/oap/oap_12214/data/bmwweather-diagnostics.json
```

The text report gives a compact status per check; the JSON contains details. Local checks run every five minutes. MET Norway forecast requests are limited to once every three hours during one service lifetime.

## BMW Weather Diagnostics — graphical app

The graphical application is a separate **native OAP/RHMI source app**, registered in the repository's `mgu-repo.json`. It is not the old bmw-games build.

1. Refresh the `andrug05/bmwweather` **main** source in MGU Store.
2. Install the background **BMW Weather Diagnostics** tool first.
3. Find **BMW Weather Diagnostics** in the app section of the same source and install it.
4. Open the new app tile and press **Проверить**. It reads the background report and requests a new run when pressed.

Both the background tool and the graphical app are required for interactive diagnostics. The app itself does not make network requests or modify the Weather cache.

**Do not install the old 0.1.0 RHMI release asset.** It was built in the wrong package format and is obsolete.

## Remove

The background tool and graphical app can be installed and removed independently from MGU Store. Removing Diagnostics does not remove or change the Bridge. Removing the Bridge does not remove Diagnostics.
