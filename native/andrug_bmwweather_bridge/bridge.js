#!/usr/bin/env node
'use strict';

// Start as root, then immediately drop to the dedicated bridge UID.
// Keep GID 12214 so the service can read the uplink lease and write Weather's cache.
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  process.setgid(12214);
  process.setuid(12256);
} else if (typeof process.getuid === 'function' && process.getuid() !== 12256) {
  throw new Error('BMW Weather Bridge must run as UID 12256; got ' + process.getuid());
}

const fs = require('fs');
const path = require('path');
const https = require('https');
const dns = require('dns');
const uplink = require('./uplink');
const urlModule = require('url');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.BMW_WEATHER_CONFIG || path.join(ROOT, 'config.json');
const DATA_DIR = '/var/opt/public/oap/oap_12214/data';
const DEFAULT_CACHE = path.join(DATA_DIR, 'weatherDataCache.json');
const DIAGNOSTICS_PATH = path.join(DATA_DIR, 'bmwweather-diagnostics.json');
const diagnostics = { component: 'BMW Weather Bridge', version: '0.2.3', startedAt: new Date().toISOString(), updatedAt: null, overall: 'starting', stages: {}, lastError: null, lastSuccess: null };
function stage(name, status, details) {
  diagnostics.stages[name] = Object.assign({ status: status, at: new Date().toISOString() }, details || {});
  diagnostics.updatedAt = new Date().toISOString();
  writeDiagnostics();
  process.stdout.write('DIAG ' + name + ' ' + status + (details && details.message ? ' ' + details.message : '') + '\n');
}
function writeDiagnostics() {
  try {
    if (!fs.existsSync(DATA_DIR)) return;
    const tmp = DIAGNOSTICS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(diagnostics, null, 2), { mode: 0o644 });
    fs.renameSync(tmp, DIAGNOSTICS_PATH);
    try { fs.chmodSync(DIAGNOSTICS_PATH, 0o644); } catch (_) {}
  } catch (e) {
    process.stderr.write('DIAG_WRITE_ERROR ' + e.message + '\\n');
  }
}
function safeError(e) { return String(e && (e.stack || e.message) || e).slice(0, 1800); }

function loadConfig() {
  const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  c.cachePath = c.cachePath || DEFAULT_CACHE;
  ['town', 'latitude', 'longitude'].forEach(k => {
    if (c[k] === undefined || c[k] === null || c[k] === '') throw new Error('Missing config value: ' + k);
  });
  if (!Number.isFinite(Number(c.latitude)) || !Number.isFinite(Number(c.longitude))) throw new Error('Invalid latitude/longitude');
  c.language = c.language || 'en';
  c.refreshMinutes = Math.max(10, Number(c.refreshMinutes) || 30);
  c.requestTimeoutMs = Math.max(3000, Number(c.requestTimeoutMs) || 15000);
  c.keepBackups = Math.max(1, Number(c.keepBackups) || 5);
  return c;
}

function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    // This MGU runs an older Node.js runtime. Use the legacy options-object
    // overload instead of https.get(url, options, callback), which is not
    // supported consistently by its bundled HTTPS implementation.
    const parsed = urlModule.parse(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname) {
      return reject(new Error('Unsupported weather URL: ' + url));
    }
    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: (parsed.pathname || '/') + (parsed.search || ''),
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'BMWWeatherBridge/0.2.3 https://github.com/andrug05/bmwweather/issues' }
    };
    const req = https.get(options, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) req.destroy(new Error('Response too large'));
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 300)));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('HTTPS request timeout')));
    req.on('error', reject);
  });
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function temp(value) {
  const c = numberOr(value, 0);
  return { C: Number(c.toFixed(1)), F: Number((c * 9 / 5 + 32).toFixed(1)) };
}
function describe(code) {
  const m = {
    0:'Ясно',1:'Преимущественно ясно',2:'Переменная облачность',3:'Пасмурно',
    45:'Туман',48:'Изморозь',51:'Слабая морось',53:'Морось',55:'Сильная морось',
    56:'Ледяная морось',57:'Сильная ледяная морось',61:'Небольшой дождь',63:'Дождь',65:'Сильный дождь',
    66:'Ледяной дождь',67:'Сильный ледяной дождь',71:'Небольшой снег',73:'Снег',75:'Сильный снег',
    77:'Снежные зёрна',80:'Ливень',81:'Сильный ливень',82:'Очень сильный ливень',
    85:'Снегопад',86:'Сильный снегопад',95:'Гроза',96:'Гроза с градом',99:'Сильная гроза с градом'
  };
  return m[Number(code)] || 'Переменная облачность';
}
// These identifiers are taken from the native MGU Constants imagesDay/imagesNight maps.
function forecastId(code) {
  const m = {
    0:'sunny', 1:'clouded', 2:'cloudy', 3:'overcast',
    45:'fog', 48:'fog',
    51:'light_rain', 53:'moderate_rain', 55:'heavy_rain',
    56:'ice_rain', 57:'ice_rain',
    61:'light_rain', 63:'moderate_rain', 65:'heavy_rain',
    66:'ice_rain', 67:'ice_rain',
    71:'light_snow', 73:'moderate_snow', 75:'heavy_snow', 77:'sleet',
    80:'light_rain', 81:'moderate_rain', 82:'heavy_rain',
    85:'light_snow', 86:'heavy_snow',
    95:'thunderstorm', 96:'thunderstorm_with_hail', 99:'thunderstorm_with_hail'
  };
  return m[Number(code)] || 'unknown';
}
function windDirection(degrees) {
  const d = numberOr(degrees, 0);
  return ['north','northeast','east','southeast','south','southwest','west','northwest'][Math.round(d / 45) % 8];
}
function wind(speed, direction) {
  const kmh = numberOr(speed, 0);
  return { kmh: Number(kmh.toFixed(1)), mph: Number((kmh / 1.609344).toFixed(1)), direction: windDirection(direction) };
}
function average(arr, fallback) {
  const vals = arr.filter(v => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : fallback;
}
function timezoneOffset(seconds) {
  const s = numberOr(seconds, 0);
  const sign = s < 0 ? '-' : '+';
  const mins = Math.abs(Math.round(s / 60));
  return sign + String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}
function period(hourly, date, from, to, fallbackTemp, fallbackCode, fallbackWind, fallbackDirection) {
  const indexes = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i];
    if (t.slice(0, 10) === date) {
      const h = Number(t.slice(11, 13));
      if (h >= from && h < to) indexes.push(i);
    }
  }
  const pick = key => indexes.map(i => hourly[key] && hourly[key][i]).filter(v => v !== null && v !== undefined);
  const t = average(pick('temperature_2m'), fallbackTemp);
  const w = average(pick('wind_speed_10m'), fallbackWind);
  const codes = pick('weather_code');
  const code = codes.length ? codes[Math.floor(codes.length / 2)] : fallbackCode;
  const directions = pick('wind_direction_10m');
  const direction = directions.length ? directions[Math.floor(directions.length / 2)] : fallbackDirection;
  return {
    forecast: forecastId(code),
    temperature: temp(t),
    feelsLikeTemperature: temp(average(pick('apparent_temperature'), t)),
    windspeed: wind(w, direction),
    rain_probability: Math.round(average(pick('precipitation_probability'), 0)),
    precipitationAmount: Number(average(pick('precipitation'), 0).toFixed(1)),
    humidity: Math.round(average(pick('relative_humidity_2m'), 60)),
    aqi: 0
  };
}
function buildNativeEntry(c, raw) {
  const d = raw.daily, h = raw.hourly, days = [];
  const offset = timezoneOffset(raw.utc_offset_seconds);
  for (let i = 0; i < Math.min(5, d.time.length); i++) {
    const date = d.time[i], code = d.weather_code[i], t = d.temperature_2m_mean[i];
    const w = d.wind_speed_10m_max[i] || 0;
    const direction = d.wind_direction_10m_dominant && d.wind_direction_10m_dominant[i];
    const morning = period(h, date, 6, 11, t, code, w, direction);
    const midday = period(h, date, 11, 17, t, code, w, direction);
    const evening = period(h, date, 17, 22, t, code, w, direction);
    const night = period(h, date, 0, 6, t, code, w, direction);
    const overall = {
      forecast: forecastId(code),
      temperaturemin: temp(d.temperature_2m_min[i]),
      temperature: temp(d.temperature_2m_max[i]),
      rain_probability: Number(d.precipitation_probability_max[i] || 0),
      windspeed: wind(w, direction),
      feelsLikeTemperature: temp(t),
      sunrise: d.sunrise[i].slice(11, 16),
      sunset: d.sunset[i].slice(11, 16)
    };
    const current = raw.current || {};
    const currentCode = current.weather_code !== undefined ? current.weather_code : code;
    days.push({
      timestamp: date + 'T12:00:00' + offset,
      description: describe(code),
      forecast: forecastId(code),
      morning, midday, evening, night, overall,
      current: {
        forecast: forecastId(currentCode),
        temperature: temp(current.temperature_2m !== undefined ? current.temperature_2m : t),
        feelsLikeTemperature: temp(current.apparent_temperature !== undefined ? current.apparent_temperature : t),
        windspeed: wind(current.wind_speed_10m !== undefined ? current.wind_speed_10m : w, current.wind_direction_10m !== undefined ? current.wind_direction_10m : direction),
        rain_probability: Number(d.precipitation_probability_max[i] || 0),
        precipitationAmount: Number(current.precipitation !== undefined ? current.precipitation : d.precipitation_sum[i] || 0),
        humidity: numberOr(current.relative_humidity_2m, 60),
        aqi: 0
      }
    });
  }
  return { provider: 'wttr.in', language: c.language, weatherList: days, alerts: [] };
}
function validateNativeEntry(entry) {
  if (!entry || !entry.data || !Array.isArray(entry.data.weatherList) || entry.data.weatherList.length < 1) throw new Error('Native payload has no weatherList');
  const validForecasts = new Set(['clouded','cloudy','duststorm','fog','hail','haze','heavy_rain','heavy_snow','ice_rain','light_rain','light_snow','moderate_rain','moderate_snow','overcast','sand','sandstorm','sleet','snowstorm','sunny','thunderstorm','thunderstorm_with_hail','unknown']);
  entry.data.weatherList.forEach((day, i) => {
    if (!day.timestamp || !day.description || !validForecasts.has(day.forecast)) throw new Error('Invalid native day header at index ' + i);
    ['morning','midday','evening','night','current','overall'].forEach(k => {
      const f = day[k];
      if (!f || !validForecasts.has(f.forecast) || !f.temperature || !Number.isFinite(f.temperature.C) || !Number.isFinite(f.temperature.F) || !f.windspeed || !Number.isFinite(f.windspeed.kmh) || !Number.isFinite(f.windspeed.mph) || !f.windspeed.direction) {
        throw new Error('Invalid native forecast block ' + k + ' at day ' + i);
      }
    });
  });
  if (!Array.isArray(entry.data.alerts)) throw new Error('Native alerts must be an array');
}
function backupAndWrite(file, data, keep) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) throw new Error('Cache directory does not exist: ' + dir);
  if (fs.existsSync(file)) {
    const backup = file + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, backup);
    const backups = fs.readdirSync(dir).filter(n => n.indexOf(path.basename(file) + '.backup-') === 0).sort().reverse();
    backups.slice(keep).forEach(n => { try { fs.unlinkSync(path.join(dir, n)); } catch (_) {} });
  }
  const tmp = file + '.bmwweather.tmp';
  fs.writeFileSync(tmp, JSON.stringify([data], null, 2), { mode: 0o644 });
  fs.renameSync(tmp, file);
}

function wttrCode(value) {
  const map = {
    113:0,116:2,119:3,122:3,143:45,176:61,179:71,182:66,185:56,
    200:95,227:73,230:75,248:45,260:48,263:51,266:53,281:56,284:57,
    293:61,296:61,299:63,302:63,305:65,308:65,311:66,314:67,317:66,
    320:71,323:73,326:73,329:75,332:75,335:75,338:75,350:77,
    353:80,356:81,359:82,362:66,365:66,368:71,371:75,374:77,377:77,
    386:95,389:96,392:95,395:99
  };
  return map[Number(value)] === undefined ? 3 : map[Number(value)];
}
function wttrClock(value) {
  const m = String(value || '0').match(/^(\\d{1,4})$/);
  const n = m ? Number(m[1]) : 0;
  const h = Math.min(23, Math.floor(n / 100));
  return String(h).padStart(2, '0') + ':00';
}
function wttrRaw(payload, c) {
  if (!payload || !Array.isArray(payload.weather) || !payload.weather.length) throw new Error('wttr.in response has no weather array');
  const hourly = {
    time: [], temperature_2m: [], relative_humidity_2m: [], apparent_temperature: [],
    precipitation_probability: [], precipitation: [], weather_code: [],
    wind_speed_10m: [], wind_direction_10m: []
  };
  const daily = {
    time: [], weather_code: [], temperature_2m_mean: [], temperature_2m_min: [],
    temperature_2m_max: [], precipitation_probability_max: [], precipitation_sum: [],
    sunrise: [], sunset: [], wind_speed_10m_max: [], wind_direction_10m_dominant: []
  };
  payload.weather.slice(0, 5).forEach(day => {
    const date = String(day.date || '');
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return;
    const hours = Array.isArray(day.hourly) ? day.hourly : [];
    const dayTemps = [];
    const dayCodes = [];
    let maxRain = 0, sumRain = 0, maxWind = 0, windDirs = [];
    hours.forEach(h => {
      const hour = wttrClock(h.time);
      const t = numberOr(h.tempC, 0);
      const code = wttrCode(h.weatherCode);
      const windSpeed = numberOr(h.windspeedKmph, 0);
      dayTemps.push(t); dayCodes.push(code);
      maxRain = Math.max(maxRain, numberOr(h.chanceofrain, 0));
      sumRain += numberOr(h.precipMM, 0);
      maxWind = Math.max(maxWind, windSpeed);
      windDirs.push(numberOr(h.winddirDegree, 0));
      hourly.time.push(date + 'T' + hour + ':00');
      hourly.temperature_2m.push(t);
      hourly.relative_humidity_2m.push(numberOr(h.humidity, 60));
      hourly.apparent_temperature.push(numberOr(h.FeelsLikeC, t));
      hourly.precipitation_probability.push(numberOr(h.chanceofrain, 0));
      hourly.precipitation.push(numberOr(h.precipMM, 0));
      hourly.weather_code.push(code);
      hourly.wind_speed_10m.push(windSpeed);
      hourly.wind_direction_10m.push(numberOr(h.winddirDegree, 0));
    });
    const counts = {};
    dayCodes.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const dominant = Object.keys(counts).sort((x,y) => counts[y] - counts[x])[0] || 3;
    const astronomy = day.astronomy && day.astronomy[0] || {};
    function isoClock(v) {
      const m = String(v || '').match(/^(\\d{1,2}):(\\d{2})\\s*(AM|PM)$/i);
      if (!m) return date + 'T06:00:00';
      let h = Number(m[1]) % 12;
      if (m[3].toUpperCase() === 'PM') h += 12;
      return date + 'T' + String(h).padStart(2, '0') + ':' + m[2] + ':00';
    }
    daily.time.push(date);
    daily.weather_code.push(Number(dominant));
    daily.temperature_2m_mean.push(dayTemps.length ? dayTemps.reduce((x,y)=>x+y,0)/dayTemps.length : 0);
    daily.temperature_2m_min.push(numberOr(day.mintempC, Math.min.apply(null, dayTemps.concat([0]))));
    daily.temperature_2m_max.push(numberOr(day.maxtempC, Math.max.apply(null, dayTemps.concat([0]))));
    daily.precipitation_probability_max.push(maxRain);
    daily.precipitation_sum.push(sumRain);
    daily.sunrise.push(isoClock(astronomy.sunrise));
    daily.sunset.push(isoClock(astronomy.sunset));
    daily.wind_speed_10m_max.push(maxWind);
    daily.wind_direction_10m_dominant.push(windDirs.length ? windDirs[Math.floor(windDirs.length/2)] : 0);
  });
  if (!daily.time.length || !hourly.time.length) throw new Error('wttr.in response contains no usable hourly forecast');
  const cc = payload.current_condition && payload.current_condition[0] || {};
  return {
    utc_offset_seconds: numberOr(c.utcOffsetSeconds, 10800),
    hourly, daily,
    current: {
      temperature_2m: numberOr(cc.temp_C, 0),
      relative_humidity_2m: numberOr(cc.humidity, 60),
      apparent_temperature: numberOr(cc.FeelsLikeC, numberOr(cc.temp_C, 0)),
      precipitation: numberOr(cc.precipMM, 0),
      weather_code: wttrCode(cc.weatherCode),
      wind_speed_10m: numberOr(cc.windspeedKmph, 0),
      wind_direction_10m: numberOr(cc.winddirDegree, 0)
    }
  };
}

async function update(c) {
  diagnostics.overall = 'running';
  diagnostics.lastError = null;
  stage('config', 'ok', { town: c.town, latitude: Number(c.latitude), longitude: Number(c.longitude), refreshMinutes: c.refreshMinutes, provider: 'wttr.in' });
  try {
    const st = fs.statSync(DATA_DIR);
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    stage('cache_directory', 'ok', { writable: true, mode: (st.mode & 0o777).toString(8) });
  } catch (e) { stage('cache_directory', 'error', { message: safeError(e) }); throw e; }
  const ownLease = uplink.getOwnLease ? uplink.getOwnLease() : null;
  const systemLease = uplink.getSystemLease ? uplink.getSystemLease() : uplink.getLease();
  const lease = ownLease || systemLease;
  stage('mgu_uplink', lease && lease.ip ? 'ok' : 'warning', {
    appLeasePresent: !!(ownLease && ownLease.ip),
    systemLeasePresent: !!(systemLease && systemLease.ip),
    dnsServers: uplink.getActiveDnsServers(),
    message: lease && lease.ip ? 'MGU Store uplink lease detected; using bmwcaminfo DNS resolver model' : 'No MGU uplink lease file detected; trying configured DNS fallback'
  });
  await new Promise(resolve => dns.lookup('wttr.in', (err, address) => {
    if (err) { stage('dns', 'error', { message: safeError(err) }); return resolve(); }
    stage('dns', 'ok', { host: 'wttr.in', resolved: true, addressFamily: address.indexOf(':') >= 0 ? 6 : 4 });
    resolve();
  }));
  const url = 'https://wttr.in/' + encodeURIComponent(c.town) + '?format=j1&lang=' + encodeURIComponent(c.language || 'ru');
  stage('wttr_https', 'running', { host: 'wttr.in' });
  let response;
  try {
    response = await getJson(url, c.requestTimeoutMs);
    stage('wttr_https', 'ok', { http: '2xx' });
  } catch (e) {
    stage('wttr_https', 'error', { message: safeError(e) });
    throw e;
  }
  let raw;
  try {
    raw = wttrRaw(response, c);
    stage('forecast_parse', 'ok', { days: raw.daily.time.length, timeSteps: raw.hourly.time.length });
  } catch (e) {
    stage('forecast_parse', 'error', { message: safeError(e) });
    throw e;
  }
  const entry = {
    timestamp: new Date().toISOString(),
    localWeather: true,
    languageOfRequest: c.language,
    destWeather: false,
    location: {
      town: c.town,
      state: c.state || '',
      position: { longitude: Number(c.longitude), latitude: Number(c.latitude), coordinatesValid: true }
    },
    data: buildNativeEntry(c, raw)
  };
  try { validateNativeEntry(entry); stage('native_payload', 'ok', { forecastDays: entry.data.weatherList.length }); }
  catch (e) { stage('native_payload', 'error', { message: safeError(e) }); throw e; }
  try {
    backupAndWrite(c.cachePath, entry, c.keepBackups);
    const saved = JSON.parse(fs.readFileSync(c.cachePath, 'utf8'));
    if (!Array.isArray(saved) || !saved[0] || !saved[0].data || !Array.isArray(saved[0].data.weatherList)) throw new Error('Cache read-back validation failed');
    const stat = fs.statSync(c.cachePath);
    stage('cache_write', 'ok', { path: c.cachePath, bytes: stat.size, modifiedAt: stat.mtime.toISOString(), readBack: true });
  } catch (e) { stage('cache_write', 'error', { path: c.cachePath, message: safeError(e) }); throw e; }
  diagnostics.overall = 'ok';
  diagnostics.lastSuccess = new Date().toISOString();
  diagnostics.lastError = null;
  writeDiagnostics();
  process.stdout.write(new Date().toISOString() + ' wrote validated native weather cache for ' + c.town + '\\n');
}
async function main() {
  // Use the same MGU Store lease-aware DNS resolver as BMW Speed Camera Warning.
  // mgu-uplink writes the per-UID lease to the native Weather OAP data directory.
  uplink.init('/var/opt/public/oap/oap_12214/data');
  process.stdout.write(new Date().toISOString() + ' UPLINK ' + uplink.describe() + '\n');
  const c = loadConfig();
  const once = process.argv.indexOf('--once') !== -1;
  const run = async () => {
    try { await update(c); }
    catch (e) { process.stderr.write(new Date().toISOString() + ' ERROR ' + (e.stack || e.message) + '\n'); }
  };
  await run();
  if (!once) setInterval(run, c.refreshMinutes * 60000);
}
main().catch(e => { process.stderr.write('FATAL ' + (e.stack || e.message) + '\n'); process.exitCode = 1; });
