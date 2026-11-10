'use strict';

const fs = require('fs');
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');

const logger = logging.getSDKLogger();
const STATE = 'ST_OnlineApps_BmwWeatherDiagnostics';
const DATA = '/var/opt/public/oap/oap_12214/data';
const REPORT = DATA + '/bmwweather-diagnostics.json';
const TRIGGER = DATA + '/bmwweather-diagnostics.request';
const ENTRY_UUID = 'e6a23f5b-1b0e-4f32-9c67-34f2d5a3c801';
const ROWS = {
  overall: 'diagOverall',
  bridge: 'diagBridge',
  uplink: 'diagUplink',
  dns: 'diagDns',
  metNorway: 'diagMet',
  cache: 'diagCache',
  permissions: 'diagPermissions',
  updated: 'diagUpdated',
  run: 'diagRun'
};

function truth(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}
function oneLine(value, max) {
  return String(value === undefined || value === null ? '—' : value)
    .replace(/[\r\n]+/g, ' ').slice(0, max || 96);
}

class BmwWeatherDiagnostics extends OnlineApp {
  constructor() {
    super();
    this._state = null;
    this._components = {};
    this._poll = null;
    this._lastPress = 0;
    this.on('initialized', () => this._initialize()
      .catch(err => logger.error('Diagnostics init failed: ' + (err.stack || err.message))));
    this.on('entryPointExecute', uuid => this._openEntry(uuid));
    this.on('shutdown', () => this._stopPolling());
    this.on('error', err => logger.warn('OnlineApp error: ' + (err && err.message)));
  }

  _startedForeground() {
    const reasons = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];
    const data = this.getVisibilityData && this.getVisibilityData();
    return reasons.indexOf((data && data.reason) || this.startReason) !== -1;
  }

  _initialize() {
    if (!this.rhmiApplication) {
      logger.info('Diagnostics started without foreground RHMI');
      return this.initialized();
    }
    this._state = this.rhmiApplication.getByName(STATE);
    if (!this._state) return Promise.reject(new Error('Missing RHMI state ' + STATE));
    Object.keys(ROWS).forEach(key => {
      this._components[key] = this.rhmiApplication.getByName(ROWS[key]);
    });
    const missing = Object.keys(ROWS).filter(key => !this._components[key]);
    if (missing.length) return Promise.reject(new Error('Missing RHMI components: ' + missing.join(', ')));

    this._components.run.on('action', () => this._requestCheck());
    this.rhmiApplication.on('userEvent', ev => {
      if (!ev || ev.eventType !== 'ACTION' || Number(ev.sourceId) !== Number(this._components.run.getId())) return;
      this._requestCheck();
    });
    this._state.on('visible', ev => {
      if (truth(ev && ev.visible)) this._startPolling();
      else this._stopPolling();
    });

    return this._state.updateResources()
      .then(() => this._registerEntryPoint())
      .then(() => {
        this._render();
        if (this._startedForeground()) {
          this.registerActive();
          this._startPolling();
        }
        return this.initialized();
      });
  }

  _registerEntryPoint() {
    const descriptions = (this.appDescription && this.appDescription.application &&
      this.appDescription.application.entryPoints) || [];
    const entry = this.getEntryPoints().find(ep =>
      descriptions.some(desc => desc.uuid === ep.getDescription().uuid));
    if (!entry) return Promise.reject(new Error('No diagnostic entry point was provided by App Manager'));
    const desc = entry.getDescription();
    return entry.init()
      .then(() => this.rhmiApplication.mapEntryState(desc.uuid, this._state))
      .then(() => entry.setAvailability('ENABLED'))
      .then(() => logger.info('BMW Weather Diagnostics entry point enabled'));
  }

  _openEntry(uuid) {
    if (!this.rhmiApplication || !uuid) return Promise.resolve();
    return Promise.resolve(this.rhmiApplication.openEntryState(uuid))
      .catch(err => logger.warn('Cannot open diagnostics state: ' + err.message));
  }

  _startPolling() {
    if (this._poll) return;
    this._render();
    this._poll = setInterval(() => this._render(), 2000);
  }

  _stopPolling() {
    if (this._poll) clearInterval(this._poll);
    this._poll = null;
  }

  _setText(key, value) {
    const component = this._components[key];
    if (!component) return;
    Promise.resolve(component.setValue(0, 'Text', oneLine(value, 112), 'Text'))
      .catch(err => logger.warn('RHMI update ' + key + ': ' + err.message));
  }

  _render() {
    let report = null;
    try {
      report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    } catch (err) {}
    if (!report || !report.checks) {
      this._setText('overall', 'Состояние: нет отчёта');
      this._setText('bridge', 'Bridge: ожидает диагностику');
      this._setText('uplink', 'Uplink: —');
      this._setText('dns', 'DNS: —');
      this._setText('metNorway', 'MET Norway: —');
      this._setText('cache', 'Кэш BMW Weather: —');
      this._setText('permissions', 'Права записи: —');
      this._setText('updated', 'Нажмите «Проверить» для запуска');
      return;
    }
    this._setText('overall', 'Итог: ' + report.overall);
    const c = report.checks;
    const line = (key, title) => title + ': ' +
      (c[key] ? String(c[key].status || 'unknown').toUpperCase() + ' — ' + (c[key].details || '') : 'нет данных');
    this._setText('bridge', line('bridge', 'Bridge'));
    this._setText('uplink', line('uplink', 'MGU Uplink'));
    this._setText('dns', line('dns', 'DNS'));
    this._setText('metNorway', line('metNorway', 'MET Norway'));
    this._setText('cache', line('cache', 'Кэш погоды'));
    this._setText('permissions', line('cacheWritePermission', 'Права записи'));
    this._setText('updated', 'Проверено: ' + (report.checkedAt || '—'));
  }

  _requestCheck() {
    const now = Date.now();
    if (now - this._lastPress < 700) return;
    this._lastPress = now;
    try {
      fs.writeFileSync(TRIGGER, JSON.stringify({
        requestedAt: new Date().toISOString(),
        source: 'mgu-store-rhmi-app'
      }) + '\n', { mode: 0o664 });
      try { fs.chmodSync(TRIGGER, 0o664); } catch (err) {}
      this._setText('updated', 'Запрос отправлен. Ожидание результата…');
      logger.info('Manual diagnostics request created');
    } catch (err) {
      this._setText('updated', 'Не удалось запустить: ' + (err.code || err.message));
      logger.warn('Cannot create diagnostics request: ' + (err.stack || err.message));
    }
  }
}

module.exports = BmwWeatherDiagnostics;
