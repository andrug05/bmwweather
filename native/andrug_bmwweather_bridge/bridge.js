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
const diagnostics = { component: 'BMW Weather Bridge', version: '0.2.2', startedAt: new Date().toISOString(), updatedAt: null, overall: 'starting', stages: {}, lastError: null, lastSuccess: null };
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
      headers: { Accept: 'application/json', 'User-Agent': 'BMWWeatherBridge/0.2.1 https://github.com/andrug05/bmwweather/issues' }
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
  return { provider: 'MET Norway', language: c.language, weatherList: days, alerts: [] };
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

function metSymbolCode(symbol) {
  const s = String(symbol || '').replace(/_(day|night|polartwilight)$/, '');
  if (s === 'clearsky') return 0;
  if (s === 'fair') return 1;
  if (s === 'partlycloudy') return 2;
  if (s === 'cloudy') return 3;
  if (s === 'fog') return 45;
  if (/^lightrainandthunder$/.test(s)) return 95;
  if (/^(rain|heavyrain)andthunder$/.test(s)) return 99;
  if (/^(lightsnow|snow|heavysnow)andthunder$/.test(s)) return 96;
  if (/^heavyrainshowers/.test(s)) return 82;
  if (/^rainshowers/.test(s)) return 81;
  if (/^lightrainshowers/.test(s)) return 80;
  if (/^heavyrain/.test(s)) return 65;
  if (/^lightrain/.test(s)) return 61;
  if (/^rain/.test(s)) return 63;
  if (/^heavysnowshowers/.test(s)) return 86;
  if (/^(snowshowers|lightsnowshowers)/.test(s)) return 85;
  if (/^lightsnow/.test(s)) return 71;
  if (/^heavysnow/.test(s)) return 75;
  if (/^snow/.test(s)) return 73;
  if (/sleet/.test(s)) return 77;
  return 3;
}
function metLocalTime(iso, offsetSeconds) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid MET Norway timestamp: ' + iso);
  return new Date(d.getTime() + offsetSeconds * 1000).toISOString().slice(0, 19);
}
function buildMetRaw(payload, c) {
  const series = payload && payload.properties && payload.properties.timeseries;
  if (!Array.isArray(series) || !series.length) throw new Error('MET Norway response has no properties.timeseries');
  const offset = numberOr(c.utcOffsetSeconds, 10800);
  const hourly = {
    time: [], temperature_2m: [], relative_humidity_2m: [], apparent_temperature: [],
    precipitation_probability: [], precipitation: [], weather_code: [],
    wind_speed_10m: [], wind_direction_10m: []
  };
  series.forEach(item => {
    const details = item.data && item.data.instant && item.data.instant.details || {};
    const next = item.data && (item.data.next_1_hours || item.data.next_6_hours || item.data.next_12_hours) || {};
    const nextDetails = next.details || {};
    const symbol = next.summary && next.summary.symbol_code;
    hourly.time.push(metLocalTime(item.time, offset));
    hourly.temperature_2m.push(numberOr(details.air_temperature, null));
    hourly.relative_humidity_2m.push(numberOr(details.relative_humidity, null));
    hourly.apparent_temperature.push(numberOr(details.apparent_air_temperature, numberOr(details.air_temperature, null)));
    hourly.precipitation_probability.push(numberOr(nextDetails.precipitation_probability, 0));
    hourly.precipitation.push(numberOr(nextDetails.precipitation_amount, 0));
    hourly.weather_code.push(metSymbolCode(symbol));
    hourly.wind_speed_10m.push(numberOr(details.wind_speed, 0) * 3.6);
    hourly.wind_direction_10m.push(numberOr(details.wind_from_direction, 0));
  });
  const groups = {};
  hourly.time.forEach((time, i) => {
    const date = time.slice(0, 10);
    if (!groups[date]) groups[date] = [];
    groups[date].push(i);
  });
  const dates = Object.keys(groups).sort().slice(0, 5);
  const daily = {
    time: dates, weather_code: [], temperature_2m_mean: [], temperature_2m_min: [],
    temperature_2m_max: [], precipitation_probability_max: [], precipitation_sum: [],
    sunrise: [], sunset: [], wind_speed_10m_max: [], wind_direction_10m_dominant: []
  };
  const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
  dates.forEach(date => {
    const ix = groups[date];
    const vals = key => ix.map(i => hourly[key][i]).filter(v => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
    const temps = vals('temperature_2m');
    const codes = vals('weather_code');
    const counts = {};
    codes.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const dominantCode = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0] || 3;
    daily.weather_code.push(Number(dominantCode));
    daily.temperature_2m_mean.push(mean(temps));
    daily.temperature_2m_min.push(temps.length ? Math.min.apply(null, temps) : 0);
    daily.temperature_2m_max.push(temps.length ? Math.max.apply(null, temps) : 0);
    daily.precipitation_probability_max.push(Math.max.apply(null, vals('precipitation_probability').concat([0])));
    daily.precipitation_sum.push(vals('precipitation').reduce((a,b)=>a+b,0));
    daily.sunrise.push('');
    daily.sunset.push('');
    daily.wind_speed_10m_max.push(Math.max.apply(null, vals('wind_speed_10m').concat([0])));
    daily.wind_direction_10m_dominant.push(mean(vals('wind_direction_10m')));
  });
  const first = series[0].data && series[0].data.instant && series[0].data.instant.details || {};
  const firstNext = series[0].data && (series[0].data.next_1_hours || series[0].data.next_6_hours) || {};
  return {
    utc_offset_seconds: offset, hourly, daily,
    current: {
      temperature_2m: numberOr(first.air_temperature, 0),
      relative_humidity_2m: numberOr(first.relative_humidity, 60),
      apparent_temperature: numberOr(first.apparent_air_temperature, numberOr(first.air_temperature, 0)),
      precipitation: numberOr(firstNext.details && firstNext.details.precipitation_amount, 0),
      weather_code: metSymbolCode(firstNext.summary && firstNext.summary.symbol_code),
      wind_speed_10m: numberOr(first.wind_speed, 0) * 3.6,
      wind_direction_10m: numberOr(first.wind_from_direction, 0)
    }
  };
}

async function update(c) {
  diagnostics.overall = 'running';
  diagnostics.lastError = null;
  stage('config', 'ok', { town: c.town, latitude: Number(c.latitude), longitude: Number(c.longitude), refreshMinutes: c.refreshMinutes });
  try {
    const st = fs.statSync(DATA_DIR);
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    stage('cache_directory', 'ok', { writable: true, mode: (st.mode & 0o777).toString(8) });
  } catch (e) { stage('cache_directory', 'error', { message: safeError(e) }); throw e; }
  const ownLease = uplink.getOwnLease ? uplink.getOwnLease() : null;
  const systemLease = uplink.getSystemLease ? uplink.getSystemLease() : null;
  stage('mgu_uplink', ownLease && ownLease.ip ? 'ok' : 'error', { appLeasePresent: !!(ownLease && ownLease.ip), systemLeasePresent: !!(systemLease && systemLease.ip), dnsServerCount: uplink.getActiveDnsServers().length, message: ownLease && ownLease.ip ? 'App-specific uplink lease is present' : 'No app-specific uplink lease for UID 12256' });
  await new Promise(resolve => dns.lookup('api.met.no', (err, address) => {
    if (err) { stage('dns', 'error', { message: safeError(err) }); return resolve(); }
    stage('dns', 'ok', { resolved: true, addressFamily: address.indexOf(':') >= 0 ? 6 : 4 });
    resolve();
  }));
  const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' + encodeURIComponent(Number(c.latitude).toFixed(4)) +
    '&lon=' + encodeURIComponent(Number(c.longitude).toFixed(4));
  stage('met_norway_https', 'running', { host: 'api.met.no' });
  let response;
  try { response = await getJson(url, c.requestTimeoutMs); stage('met_norway_https', 'ok', { http: '2xx' }); }
  catch (e) { stage('met_norway_https', 'error', { message: safeError(e) }); throw e; }
  let raw;
  try { raw = buildMetRaw(response, c); stage('forecast_parse', 'ok', { timeSteps: response.properties.timeseries.length, days: Object.keys(raw.daily.time).length }); }
  catch (e) { stage('forecast_parse', 'error', { message: safeError(e) }); throw e; }
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
  process.stdout.write(new Date().toISOString() + ' wrote validated native weather cache for ' + c.town + '\n');
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
