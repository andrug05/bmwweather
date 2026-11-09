#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

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
  c.temperatureUnit = c.temperatureUnit || 'celsius';
  c.windSpeedUnit = c.windSpeedUnit || 'kmh';
  c.refreshMinutes = Math.max(10, Number(c.refreshMinutes) || 30);
  c.requestTimeoutMs = Math.max(3000, Number(c.requestTimeoutMs) || 15000);
  c.keepBackups = Math.max(1, Number(c.keepBackups) || 5);
  return c;
}

function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'BMWWeatherBridge/0.1' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) req.destroy(new Error('Response too large')); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 300)));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('HTTPS request timeout')));
    req.on('error', reject);
  });
}

function cToF(c) { return Number((c * 9 / 5 + 32).toFixed(1)); }
function temp(v) { return { celsius: Number(v), fahrenheit: cToF(Number(v)) }; }
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
function kmhToMph(v) { return Number((Number(v) / 1.609344).toFixed(1)); }
function wind(v) { return { kmh: Number(v), mph: kmhToMph(v), ms: Number((Number(v) / 3.6).toFixed(1)) }; }
function average(arr, fallback) {
  const vals = arr.filter(v => Number.isFinite(Number(v))).map(Number);
  return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : fallback;
}
function period(hourly, date, from, to, dailyIndex, fallbackTemp, fallbackCode, fallbackWind) {
  const indexes = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i];
    if (t.slice(0,10) === date) {
      const h = Number(t.slice(11,13));
      if (h >= from && h < to) indexes.push(i);
    }
  }
  const pick = key => indexes.map(i => hourly[key] && hourly[key][i]).filter(v => v !== null && v !== undefined);
  const t = average(pick('temperature_2m'), fallbackTemp);
  const w = average(pick('wind_speed_10m'), fallbackWind);
  const code = pick('weather_code').length ? pick('weather_code')[Math.floor(pick('weather_code').length / 2)] : fallbackCode;
  const rain = average(pick('precipitation_probability'), 0);
  return {
    forecast: describe(code),
    temperature: temp(t),
    feelsLikeTemperature: temp(average(pick('apparent_temperature'), t)),
    windspeed: wind(w),
    rain_probability: Math.round(rain),
    precipitationAmount: Number(average(pick('precipitation'), 0).toFixed(1)),
    humidity: Math.round(average(pick('relative_humidity_2m'), 60)),
    aqi: 0
  };
}
function buildNativeEntry(c, raw) {
  const d = raw.daily, h = raw.hourly, days = [];
  for (let i = 0; i < Math.min(5, d.time.length); i++) {
    const date = d.time[i], code = d.weather_code[i], t = d.temperature_2m_mean[i];
    const w = d.wind_speed_10m_max[i] || 0;
    const morning = period(h,date,6,11,i,t,code,w);
    const midday = period(h,date,11,17,i,t,code,w);
    const evening = period(h,date,17,22,i,t,code,w);
    const night = period(h,date,0,6,i,t,code,w);
    const overall = {
      forecast: describe(code),
      temperaturemin: temp(d.temperature_2m_min[i]),
      temperature: temp(t),
      rain_probability: Number(d.precipitation_probability_max[i] || 0),
      sunrise: d.sunrise[i],
      sunset: d.sunset[i]
    };
    days.push({
      timestamp: date + 'T12:00:00',
      forecast: describe(code),
      morning, midday, evening, night, overall,
      current: {
        forecast: describe(raw.current && raw.current.weather_code !== undefined ? raw.current.weather_code : code),
        temperature: temp(raw.current && raw.current.temperature_2m !== undefined ? raw.current.temperature_2m : t),
        feelsLikeTemperature: temp(raw.current && raw.current.apparent_temperature !== undefined ? raw.current.apparent_temperature : t),
        windspeed: wind(raw.current && raw.current.wind_speed_10m !== undefined ? raw.current.wind_speed_10m : w),
        rain_probability: Number(d.precipitation_probability_max[i] || 0),
        precipitationAmount: Number(d.precipitation_sum[i] || 0),
        humidity: Number(raw.current && raw.current.relative_humidity_2m || 60),
        aqi: 0
      }
    });
  }
  return {
    provider: 'Open-Meteo',
    language: c.language,
    weatherList: days,
    alerts: []
  };
}
function backupAndWrite(file, data, keep) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) throw new Error('Cache directory does not exist: ' + dir);
  if (fs.existsSync(file)) {
    const backup = file + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, backup);
    const backups = fs.readdirSync(dir).filter(n => n.indexOf(path.basename(file) + '.backup-') === 0).sort().reverse();
    backups.slice(keep).forEach(n => { try { fs.unlinkSync(path.join(dir,n)); } catch (_) {} });
  }
  const tmp = file + '.bmwweather.tmp';
  fs.writeFileSync(tmp, JSON.stringify([data], null, 2), { mode: 0o644 });
  fs.renameSync(tmp, file);
}
async function update(c) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(c.latitude) +
    '&longitude=' + encodeURIComponent(c.longitude) +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max' +
    '&forecast_days=5&timezone=auto&temperature_unit=celsius&wind_speed_unit=kmh';
  const raw = await getJson(url, c.requestTimeoutMs);
  if (!raw || !raw.daily || !raw.hourly || !raw.daily.time || !raw.daily.time.length) throw new Error('Open-Meteo response is missing forecast data');
  const weather = buildNativeEntry(c, raw);
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
    data: weather
  };
  backupAndWrite(c.cachePath, entry, c.keepBackups);
  process.stdout.write(new Date().toISOString() + ' wrote weather cache for ' + c.town + '\n');
}
async function main() {
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
