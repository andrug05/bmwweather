'use strict';

const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');

const W = 1600, H = 520;
const DATA = '/var/opt/public/oap/oap_12214/data';
const REPORT = path.join(DATA, 'bmwweather-diagnostics.json');
const TRIGGER = path.join(DATA, 'bmwweather-diagnostics.request');
const C = { bg:'#080d13', panel:'#111b26', text:'#edf3f8', muted:'#91a2b5', blue:'#55b8ff', green:'#55dfa0', yellow:'#ffd166', red:'#ff626d', line:'#293847' };
const LABELS = {
 bridge:'Weather Bridge', uplink:'MGU Store Uplink', dns:'DNS api.met.no',
 metNorway:'MET Norway HTTPS', cache:'Кэш BMW Weather',
 cacheWritePermission:'Права записи кэша', bridgeDiagnostics:'Отчёт Bridge'
};
const statusColor = s => s==='ok' ? C.green : s==='warning' ? C.yellow : s==='error' ? C.red : C.muted;
const clip = (s,n) => String(s===undefined||s===null?'—':s).replace(/[\r\n]+/g,' ').slice(0,n);

mgu.run({ async start(ctx) {
 const {ui,log}=ctx;
 let report=null, view='main', message='Ожидание диагностического отчёта', messageUntil=0, busy=false;
 function readReport() {
  try {
   const next=JSON.parse(fs.readFileSync(REPORT,'utf8'));
   if(next && next.checks && typeof next.checks==='object') { report=next; message='Отчёт загружен'; }
  } catch(e) { if(!report) message='Отчёт ещё не создан: '+clip(e.code||e.message,48); }
 }
 function requestCheck() {
  if(busy) return;
  try {
   fs.writeFileSync(TRIGGER,JSON.stringify({requestedAt:new Date().toISOString(),source:'rhmi-ui'})+'\n',{mode:0o664});
   busy=true; message='Запрос отправлен диагностическому сервису'; messageUntil=Date.now()+15000;
   log.info('DIAGNOSTICS_REQUEST_WRITTEN '+TRIGGER);
  } catch(e) {
   message='Не удалось запустить проверку: '+clip(e.code||e.message,60);
   log.warn('DIAGNOSTICS_REQUEST_FAILED '+(e.stack||e));
  }
  render();
 }
 function text(cv,s,x,y,size,color,opts) {
  cv.text(String(s),x,y,size,color,Object.assign({font:'label',literal:true},opts||{}));
 }
 function render() {
  const cv=ctx.canvas(W,H).clear(C.bg);
  cv.roundRect(18,12,W-36,48,10,C.panel);
  text(cv,'BMW WEATHER DIAGNOSTICS',42,44,22,C.blue);
  const overall=report?report.overall:'NO DATA';
  const oc=overall==='OK'?C.green:overall==='WARNING'?C.yellow:overall==='ERROR'?C.red:C.muted;
  cv.roundRect(1320,20,230,32,9,oc);
  text(cv,overall,1435,43,17,'#071018',{align:'center'});
  cv.roundRect(28,76,980,386,14,C.panel);
  text(cv,'РЕЗУЛЬТАТЫ ПРОВЕРКИ',52,108,16,C.muted);
  const keys=['bridge','uplink','dns','metNorway','cache','cacheWritePermission','bridgeDiagnostics'];
  keys.forEach((key,i)=>{
   const y=145+i*43, item=report&&report.checks&&report.checks[key];
   const st=item?item.status:'unknown';
   cv.circle(62,y-5,8,statusColor(st));
   text(cv,LABELS[key]||key,86,y,18,C.text);
   text(cv,item?clip(item.details,76):'Ожидание данных',430,y,15,item?statusColor(st):C.muted);
   cv.line(52,y+15,980,y+15,1,C.line);
  });
  cv.roundRect(1030,76,542,386,14,C.panel);
  text(cv,view==='details'?'ПОДРОБНОСТИ':'СОСТОЯНИЕ',1054,108,16,C.muted);
  if(view==='details'&&report&&report.checks) {
   const keys2=['uplink','dns','metNorway','cache','cacheWritePermission','bridge'];
   let y=145;
   keys2.forEach(k=>{
    const x=report.checks[k]||{};
    text(cv,LABELS[k]||k,1054,y,15,C.blue); y+=22;
    const detail=clip(x.details||x.error||'нет данных',58);
    text(cv,detail,1054,y,14,statusColor(x.status)); y+=26;
    const extra=x.dnsServers?'DNS: '+x.dnsServers.join(', '):x.addresses?'IP: '+x.addresses.join(', '):x.httpStatus?'HTTP '+x.httpStatus+' · прогнозов: '+(x.timeseries||0):'';
    if(extra){text(cv,clip(extra,62),1054,y,12,C.muted);y+=20;}
   });
  } else {
   text(cv,report?'Последняя проверка:':'Последняя проверка:',1054,148,15,C.muted);
   text(cv,report?clip(report.checkedAt,40):'—',1054,176,16,C.text);
   text(cv,'Версия сервиса: '+(report?clip(report.version,24):'—'),1054,216,15,C.text);
   text(cv,'UID / GID: '+(report?report.uid+' / '+report.gid:'—'),1054,244,15,C.text);
   text(cv,'Источник данных: MET Norway Locationforecast',1054,292,14,C.muted);
   text(cv,'Интервал запроса API: не чаще 3 часов',1054,318,14,C.muted);
   text(cv,clip(message,62),1054,382,15,busy?C.yellow:C.muted);
  }
  text(cv,'1 — запустить проверку     2 — подробности     3 — обновить отчёт',42,495,16,C.muted);
  text(cv,'BMW MGU ID7',1545,495,13,C.muted,{align:'right'});
  return ui.image('MAIN_GFX',cv);
 }
 ui.onClick('BTN_RUN',requestCheck);
 ui.onClick('BTN_DETAILS',()=>{view=view==='details'?'main':'details';render();});
 ui.onClick('BTN_REFRESH',()=>{readReport();busy=false;render();});
 ui.onVisible((name,visible)=>{if(name==='MAIN'&&visible){readReport();render();}});
 ctx.loop('MAIN',2000,()=>{
  const was=report&&report.checkedAt;
  readReport();
  if(report&&report.checkedAt!==was) {busy=false;message='Получен новый отчёт';}
  if(Date.now()>messageUntil&&busy) message='Проверка выполняется…';
  render();
 });
 readReport();render();
 log.info('BMW Weather Diagnostics RHMI 0.1.0 started');
}});
