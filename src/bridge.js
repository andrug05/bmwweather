#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const uplink = require('./uplink');
const urlModule = require('url');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.BMW_WEATHER_CONFIG || path.join(ROOT, 'config.json');
const DEFAULT_CACHE = '/var/opt/public/oap/oap_12214/data/weatherDataCache.json';

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
      headers: { Accept: 'application/json', 'User-Agent': 'BMWWeatherBridge/0.1.9' }
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
  return { provider: 'Open-Meteo', language: c.language, weatherList: days, alerts: [] };
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
async function update(c) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(c.latitude) +
    '&longitude=' + encodeURIComponent(c.longitude) +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m' +
    '&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant' +
    '&forecast_days=5&timezone=auto&temperature_unit=celsius&wind_speed_unit=kmh';
  const raw = await getJson(url, c.requestTimeoutMs);
  if (!raw || !raw.daily || !raw.hourly || !raw.daily.time || !raw.daily.time.length || !raw.hourly.time) throw new Error('Open-Meteo response is missing forecast data');
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
  validateNativeEntry(entry);
  backupAndWrite(c.cachePath, entry, c.keepBackups);
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
