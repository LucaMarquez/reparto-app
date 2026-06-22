// App de reparto - motor Transistorsoft (ubicacion nativa en segundo plano)
import BackgroundGeolocation from '@transistorsoft/capacitor-background-geolocation';

const DB_URL = window.FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
const CODIGO = window.CODIGO_LOGISTICA;

// Firebase (solo lectura de roster/paquetes para la UI; la ubicacion sube nativa)
firebase.initializeApp(window.FIREBASE_CONFIG);
const db = firebase.database();
const rosterRef = db.ref('rooms/' + CODIGO + '/roster');
const asgRef = db.ref('rooms/' + CODIGO + '/assignments');

const $ = s => document.querySelector(s);
const EST = { pendiente:'Pendiente', en_camino:'En camino', entregado:'Entregado' };
const ESTC = { pendiente:'#f5a623', en_camino:'#3483fa', entregado:'#00a650' };

let roster = {}, miId = '', listo = false, compartiendo = false, iniciando = false;
function msg(t, c){ const e = $('#estado'); e.textContent = t; e.className = 'estado ' + c; }

rosterRef.on('value', s => {
  roster = s.val() || {};
  const sel = $('#quien'); const prev = localStorage.getItem('rep_id') || miId;
  sel.innerHTML = '<option value="">¿Quién sos?</option>' +
    Object.keys(roster).map(id => `<option value="${id}">${roster[id].name}</option>`).join('');
  if (prev && roster[prev]) { sel.value = prev; if (!miId) elegir(prev); }
});
asgRef.on('value', s => pintar(s.val() || {}));

function elegir(id){ miId = id; localStorage.setItem('rep_id', id); asgRef.once('value').then(s => pintar(s.val() || {})); }
$('#quien').onchange = e => elegir(e.target.value);

function pintar(asg){
  const cont = $('#lista');
  if (!miId){ cont.innerHTML = '<div class="vacio">Elegí tu nombre para ver tus paquetes.</div>'; $('#cnt').textContent = '0'; return; }
  const mios = Object.values(asg).filter(a => a && a.driverId === miId);
  $('#cnt').textContent = mios.length;
  if (!mios.length){ cont.innerHTML = '<div class="vacio">No tenés paquetes asignados todavía.</div>'; return; }
  cont.innerHTML = mios.map(a => {
    const c = ESTC[a.estado] || '#666';
    const maps = a.direccion ? `<a class="maps" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.direccion)}">🗺️ Abrir en Maps</a>` : '';
    return `<div class="card"><div class="p">${a.producto || 'Paquete'}</div>` +
      (a.direccion ? `<div class="d">📍 ${a.direccion}</div>` : '') + (a.nota ? `<div class="d">📝 ${a.nota}</div>` : '') +
      `<span class="est" style="background:${c}">${EST[a.estado] || a.estado || ''}</span><br>${maps}</div>`;
  }).join('');
}

async function prepararBG(){
  if (listo) return;
  // Latido: aunque el repartidor esté quieto, manda la posición cada ~60s
  BackgroundGeolocation.onHeartbeat(() => {
    BackgroundGeolocation.getCurrentPosition({ samples: 1, persist: true }).catch(() => {});
  });
  await BackgroundGeolocation.ready({
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
    distanceFilter: 10,
    locationUpdateInterval: 15000,
    heartbeatInterval: 60,
    preventSuspend: true,
    stopOnTerminate: false,
    startOnBoot: true,
    foregroundService: true,
    notification: { title: 'Reparto en curso', text: 'Compartiendo tu ubicación.' },
    backgroundPermissionRationale: {
      title: 'Permitir ubicación "Todo el tiempo"',
      message: 'Para que tu encargado vea tu ubicación durante el reparto, elegí "Permitir todo el tiempo".',
      positiveAction: 'Cambiar a "Permitir todo el tiempo"'
    },
    method: 'PUT',
    httpRootProperty: '.',
    locationTemplate: '{"lat":<%= latitude %>,"lng":<%= longitude %>,"acc":<%= accuracy %>,"speed":<%= speed %>,"ts":"<%= timestamp %>"}',
    autoSync: true,
    batchSync: false,
    autoSyncThreshold: 0,
    debug: false,
    logLevel: BackgroundGeolocation.LOG_LEVEL_OFF
  });
  listo = true;
}

async function start(){
  if (!miId){ msg('Elegí tu nombre primero.', 'err'); return; }
  if (iniciando) return;            // evita doble inicio (causa del error "Waiting for previous start")
  iniciando = true;
  $('#btnStart').style.display = 'none'; $('#btnStop').style.display = 'block'; $('#aviso').style.display = 'block'; $('#quien').disabled = true;
  compartiendo = true; msg('Iniciando ubicación en segundo plano…', 'ok');
  try {
    await prepararBG();
    await BackgroundGeolocation.setConfig({ url: DB_URL + '/rooms/' + CODIGO + '/drivers/' + miId + '.json' });
    const st = await BackgroundGeolocation.getState();
    if (!st.enabled) { await BackgroundGeolocation.start(); }   // solo inicia si no estaba ya activo
    await BackgroundGeolocation.getCurrentPosition({ samples: 1, persist: true });
    msg('✅ Compartiendo ubicación en segundo plano.', 'ok');
  } catch (e) {
    msg('No pude iniciar: ' + (e.message || e), 'err');
  } finally {
    iniciando = false;
  }
}

async function stop(){
  compartiendo = false;
  try { await BackgroundGeolocation.stop(); } catch(e){}
  try { await db.ref('rooms/' + CODIGO + '/drivers/' + miId).remove(); } catch(e){}
  $('#btnStart').style.display = 'block'; $('#btnStop').style.display = 'none'; $('#aviso').style.display = 'none'; $('#quien').disabled = false;
  msg('Dejaste de compartir.', 'err');
}

$('#btnStart').onclick = start;
$('#btnStop').onclick = stop;
