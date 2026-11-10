'use strict';

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const https = require('https');
const net = require('net');

const WEATHER_DATA = '/var/opt/public/oap/oap_12214/data';
const APP_DATA = '/var/opt/public/oap/oap_12224/data';
const CACHE = path.join(WEATHER_DATA, 'weatherDataCache.json');
const BRIDGE_REPORT = path.join(WEATHER_DATA, 'bmwweather-diagnostics.json');
const REPORT = path.join(APP_DATA, 'bmwweather-diagnostics.json');
const SUMMARY = path.join(APP_DATA, 'bmwweather-diagnostics.txt');
const TRIGGER = path.join(APP_DATA, 'bmwweather-diagnostics.request');
const BRIDGE_DIR = '/var/opt/andrug-bmwweather-bridge/current';
const BRIDGE_UNIT = 'andrug-bmwweather-bridge.service';
const OWN_LEASE = path.join(WEATHER_DATA, 'uplink.json');
const SYSTEM_LEASE = '/run/mgu-uplink/lease.json';
const API = 'wttr.in';
const API_PATH = '/Yoshkar-Ola?format=j1&lang=ru';
const USER_AGENT = 'BMWWeatherDiagnostics/0.1.0 https://github.com/andrug05/bmwweather/issues';
const API_MIN_INTERVAL = 3 * 60 * 60 * 1000;
const LOOP_INTERVAL = 5 * 60 * 1000;

let apiMemo = null;
let apiCheckedAt = 0;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function statInfo(file) {
  try {
    const s = fs.statSync(file);
    return { exists: true, readable: true, bytes: s.size, mtime: s.mtime.toISOString(), mode: (s.mode & 0o777).toString(8), uid: s.uid, gid: s.gid };
  } catch (e) {
    return { exists: false, readable: false, error: e.code || e.message };
  }
}
function result(status, details, extra) {
  const x = { status: status, details: details };
  if (extra) Object.keys(extra).forEach(k => { x[k] = extra[k]; });
  return x;
}
function processInfo() {
  let found = [];
  try {
    fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).forEach(pid => {
      try {
        const cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' ');
        if (cmd.indexOf('andrug-bmwweather-bridge') !== -1 || cmd.indexOf('/bridge.js') !== -1) {
          const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
          const m = status.match(/^Uid:\s+(\d+)/m);
          found.push({ pid: Number(pid), uid: m ? Number(m[1]) : null, command: cmd.trim().slice(0, 180) });
        }
      } catch (e) {}
    });
  } catch (e) {}
  return found;
}
function dnsServers() {
  const own = readJson(OWN_LEASE);
  const sys = readJson(SYSTEM_LEASE);
  const lease = own || sys;
  const servers = lease && Array.isArray(lease.dns) ? lease.dns.filter(x => net.isIP(x)) : [];
  return { ownLease: !!(own && own.ip), systemLease: !!(sys && sys.ip), leaseSource: own && own.ip ? 'app' : (sys && sys.ip ? 'system' : 'none'), servers: servers };
}
function resolveHost(host, servers) {
  return new Promise(resolve => {
    if (!servers.length) return resolve({ ok: false, error: 'No DNS servers in MGU uplink lease' });
    const r = new dns.Resolver();
    try { r.setServers(servers); } catch (e) { return resolve({ ok: false, error: e.message }); }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { r.cancel(); } catch (e) {}
      resolve({ ok: false, error: 'DNS timeout' });
    }, 12000);
    r.resolve4(host, (err, addresses) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(err ? { ok: false, error: err.code || err.message } : { ok: !!(addresses && addresses.length), addresses: addresses || [] });
    });
  });
}
function httpsGet(host, requestPath, servers, timeout) {
  return new Promise(resolve => {
    const r = new dns.Resolver();
    try { r.setServers(servers); } catch (e) { return resolve({ ok: false, error: e.message }); }
    let done = false;
    const finish = value => { if (!done) { done = true; resolve(value); } };
    const req = https.get({
      hostname: host,
      path: requestPath,
      method: 'GET',
      timeout: timeout || 18000,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      lookup: (hostname, options, cb) => {
        const family = options && options.family ? options.family : 4;
        const fn = family === 6 ? r.resolve6 : r.resolve4;
        fn.call(r, hostname, (err, addresses) => {
          if (err || !addresses || !addresses.length) return cb(err || new Error('DNS returned no addresses'));
          const list = addresses.map(a => ({ address: a, family: family }));
          if (options && options.all) return cb(null, list);
          cb(null, list[0].address, list[0].family);
        });
      }
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) req.destroy(new Error('Response too large')); });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) {}
        finish({ ok: res.statusCode >= 200 && res.statusCode < 300, httpStatus: res.statusCode, bytes: body.length, validJson: !!parsed, weatherDays: parsed && Array.isArray(parsed.weather) ? parsed.weather.length : 0, error: res.statusCode >= 400 ? ('HTTP ' + res.statusCode) : undefined });
      });
    });
    req.on('error', e => finish({ ok: false, error: e.code || e.message }));
    req.on('timeout', () => { req.destroy(new Error('HTTPS timeout')); });
  });
}
function checkApi(servers) {
  const now = Date.now();
  if (apiMemo && now - apiCheckedAt < API_MIN_INTERVAL) {
    return Promise.resolve(Object.assign({}, apiMemo, { cached: true, lastChecked: new Date(apiCheckedAt).toISOString() }));
  }
  return httpsGet(API, API_PATH, servers, 20000).then(v => {
    apiMemo = v;
    apiCheckedAt = Date.now();
    return Object.assign({}, v, { cached: false, lastChecked: new Date(apiCheckedAt).toISOString() });
  });
}
function cacheCheck() {
  const info = statInfo(CACHE);
  if (!info.exists) return result('error', 'Native Weather cache is missing', info);
  const payload = readJson(CACHE);
  if (!payload) return result('error', 'Cache is not readable JSON', info);
  const root = Array.isArray(payload) ? payload[0] : payload;
  const days = root && root.data && root.data.weatherList;
  const valid = !!(root && root.timestamp && root.location && root.data && Array.isArray(days));
  return result(valid ? 'ok' : 'warning', valid ? 'Cache JSON and native weatherList envelope are present' : 'JSON exists but does not match the expected Weather envelope', Object.assign({}, info, { rootIsArray: Array.isArray(payload), forecastDays: Array.isArray(days) ? days.length : 0, timestamp: root && root.timestamp || null }));
}
function effectiveAccess(st, uid, gid, required) {
  const mode = st.mode & 0o777;
  const bits = uid === st.uid ? ((mode >> 6) & 7) : (gid === st.gid ? ((mode >> 3) & 7) : (mode & 7));
  return (bits & required) === required;
}
function bridgeCacheWriteCheck() {
  try {
    const dir = fs.statSync(WEATHER_DATA);
    const dirOK = effectiveAccess(dir, 12256, 12214, 3);
    let fileOK = true, fileInfo = null;
    try {
      const file = fs.statSync(CACHE);
      fileInfo = { uid: file.uid, gid: file.gid, mode: (file.mode & 0o777).toString(8) };
      fileOK = effectiveAccess(file, 12256, 12214, 2);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const ok = dirOK && fileOK;
    return result(ok ? 'ok' : 'error', ok ? 'Filesystem mode bits appear to allow Bridge UID 12256 / GID 12214 to replace the cache' : 'Filesystem mode bits deny Bridge UID 12256 / GID 12214 write access to the cache path', {
      directory: { uid: dir.uid, gid: dir.gid, mode: (dir.mode & 0o777).toString(8), bridgeWriteExecute: dirOK },
      cache: fileInfo,
      bridgeCanWriteExistingCache: fileOK
    });
  } catch (e) {
    return result('error', 'Cannot inspect cache directory permissions', { error: e.code || e.message });
  }
}
function bridgeCheck() {
  const p = processInfo();
  const component = readJson(path.join(BRIDGE_DIR, 'component.json'));
  if (!p.length) return result('error', 'BMW Weather Bridge process was not found', { componentInstalled: !!component, componentVersion: component && component.version || null, processes: [] });
  return result('ok', 'BMW Weather Bridge process found', { componentInstalled: !!component, componentVersion: component && component.version || null, processes: p });
}
function writeReport(report) {
  try {
    if (!fs.existsSync(APP_DATA)) throw new Error('Diagnostics OAP data directory is missing or not accessible');
    const tmp = REPORT + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n', { mode: 0o644 });
    fs.renameSync(tmp, REPORT);
    try { fs.chmodSync(REPORT, 0o644); } catch (e) {}
    const verify = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    const summary = [];
    summary.push('BMW Weather Diagnostics ' + report.version + ' — ' + report.checkedAt);
    summary.push('Overall: ' + report.overall);
    Object.keys(report.checks).forEach(k => summary.push(k + ': ' + report.checks[k].status + ' — ' + report.checks[k].details));
    fs.writeFileSync(SUMMARY, summary.join('\n') + '\n', { mode: 0o644 });
    try { fs.chmodSync(SUMMARY, 0o644); } catch (e) {}
    return { ok: !!verify.checkedAt, bytes: fs.statSync(REPORT).size };
  } catch (e) {
    return { ok: false, error: e.code || e.message };
  }
}
async function runOnce() {
  const lease = dnsServers();
  const checks = {};
  checks.bridge = bridgeCheck();
  checks.uplink = result(lease.ownLease ? 'ok' : (lease.systemLease ? 'warning' : 'error'),
    lease.ownLease ? 'App-specific uplink lease is present' : (lease.systemLease ? 'System uplink is online, but no app-specific lease was found' : 'No active MGU uplink lease found'),
    { leaseSource: lease.leaseSource, dnsServers: lease.servers });
  const dnsResult = await resolveHost(API, lease.servers);
  checks.dns = result(dnsResult.ok ? 'ok' : 'error', dnsResult.ok ? 'wttr.in hostname resolved' : 'wttr.in DNS lookup failed', dnsResult);
  const api = await checkApi(lease.servers);
  checks.metNorway = result(api.ok && api.weatherDays > 0 ? 'ok' : 'error',
    api.ok && api.weatherDays > 0 ? 'wttr.in returned a forecast' : 'wttr.in request or forecast validation failed', api);
  checks.cache = cacheCheck();
  checks.cacheWritePermission = bridgeCacheWriteCheck();
  checks.bridgeDiagnostics = (function () {
    const f = BRIDGE_REPORT;
    const d = readJson(f);
    return d ? result('ok', 'Bridge diagnostic report is present', { file: f, checkedAt: d.checkedAt || d.timestamp || null, overall: d.overall || null }) : result('warning', 'Bridge diagnostic report is not present or is not valid JSON', { file: f, fileInfo: statInfo(f) });
  })();
  const statuses = Object.keys(checks).map(k => checks[k].status);
  const overall = statuses.indexOf('error') !== -1 ? 'ERROR' : (statuses.indexOf('warning') !== -1 ? 'WARNING' : 'OK');
  const report = { application: 'BMW Weather Diagnostics', version: '0.2.4', checkedAt: new Date().toISOString(), uid: typeof process.getuid === 'function' ? process.getuid() : null, gid: typeof process.getgid === 'function' ? process.getgid() : null, overall: overall, checks: checks, output: { json: REPORT, text: SUMMARY } };
  const saved = writeReport(report);
  console.log('[BMW-WEATHER-DIAG] ' + JSON.stringify({ overall: overall, saved: saved, checks: statuses }));
}
let runBusy = false;
async function run() {
  if (runBusy) return;
  runBusy = true;
  try { await runOnce(); }
  finally { runBusy = false; }
}
async function loop() {
  try { await run(); } catch (e) { console.error('[BMW-WEATHER-DIAG] fatal:', e.stack || e.message); }
  setTimeout(loop, LOOP_INTERVAL);
}
function watchRequests() {
  try {
    if (fs.existsSync(TRIGGER)) {
      const request = readJson(TRIGGER);
      fs.unlinkSync(TRIGGER);
      console.log('[BMW-WEATHER-DIAG] manual request received: ' + (request && request.source || 'unknown'));
      run().catch(e => console.error('[BMW-WEATHER-DIAG] request failed:', e.stack || e.message));
    }
  } catch (e) {
    console.error('[BMW-WEATHER-DIAG] request watcher:', e.code || e.message);
  }
}
setInterval(watchRequests, 1000);
loop();
