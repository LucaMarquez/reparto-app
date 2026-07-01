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

let roster = {}, miId = '', listo = false, compartiendo = false, iniciando = false, ultimoAsg = {};
function msg(t, c){ const e = $('#estado'); e.textContent = t; e.className = 'estado ' + c; }
function scanMsg(html){ const e = $('#scaninfo'); if(!e) return; e.innerHTML = html; e.classList.add('show'); }

rosterRef.on('value', s => {
  roster = s.val() || {};
  const sel = $('#quien'); const prev = localStorage.getItem('rep_id') || miId;
  sel.innerHTML = '<option value="">¿Quién sos?</option>' +
    Object.keys(roster).map(id => `<option value="${id}">${roster[id].name}</option>`).join('');
  if (prev && roster[prev]) { sel.value = prev; if (!miId) elegir(prev); }
});
asgRef.on('value', s => { ultimoAsg = s.val() || {}; pintar(ultimoAsg); });

function elegir(id){ miId = id; localStorage.setItem('rep_id', id); asgRef.once('value').then(s => pintar(s.val() || {})); }
$('#quien').onchange = e => elegir(e.target.value);

function pintar(asg){
  const cont = $('#lista');
  if (!miId){ cont.innerHTML = '<div class="vacio">Elegí tu nombre para ver tus paquetes.</div>'; $('#cnt').textContent = '0'; return; }
  const mios = Object.entries(asg).filter(([k,a]) => a && a.driverId === miId);
  $('#cnt').textContent = mios.length;
  if (!mios.length){ cont.innerHTML = '<div class="vacio">No tenés paquetes asignados todavía.</div>'; return; }
  cont.innerHTML = mios.map(([k,a]) => {
    const c = ESTC[a.estado] || '#666';
    const maps = a.direccion ? `<a class="maps" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.direccion)}">🗺️ Abrir en Maps</a>` : '';
    const entregado = a.estado === 'entregado' || a.estado === 'delivered';
    const btnEnt = entregado ? '' : `<button class="ent" data-ent="${k}" style="width:auto;margin-top:8px;margin-left:8px;padding:9px 13px;background:#00a650;font-size:13px">Entregué ✅</button>`;
    return `<div class="card"><div class="p">${a.producto || 'Paquete'}</div>` +
      (a.direccion ? `<div class="d">📍 ${a.direccion}</div>` : '') + (a.nota ? `<div class="d">📝 ${a.nota}</div>` : '') +
      `<span class="est" style="background:${c}">${EST[a.estado] || a.estado || ''}</span><br>${maps}${btnEnt}</div>`;
  }).join('');
  cont.querySelectorAll('button[data-ent]').forEach(b => { b.onclick = () => { if (confirm('¿Marcar este paquete como entregado?')) asgRef.child(b.getAttribute('data-ent')).update({ estado: 'entregado' }); }; });
}

// ---- Escaneo de etiqueta de Mercado Libre (mismo criterio que la web) ----
let qr = null, escaneando = false;

// El QR de ML trae un JSON con "id" = número de envío (shipping_id). Cruzamos contra envioId; respaldo mlId.
function buscarPaquete(code){
  const txt = String(code);
  let envio = '';
  try { const o = JSON.parse(txt); if (o && o.id) envio = String(o.id); } catch(e){}
  const nums = (txt.match(/\d{6,}/g) || []);
  return Object.entries(ultimoAsg).find(([k,a]) => {
    if (!a) return false;
    const eid = String(a.envioId || ''), mid = String(a.mlId || '');
    if (envio && eid && envio === eid) return true;
    if (envio && mid && envio === mid) return true;
    if (eid && (txt.includes(eid) || nums.includes(eid))) return true;
    if (mid && (txt.includes(mid) || nums.includes(mid))) return true;
    return false;
  });
}
function asignarme(key, a){
  const nombre = roster[miId] ? roster[miId].name : miId;
  asgRef.child(key).update({ driverId: miId, driverName: nombre });
  scanMsg('✅ <b>' + (a.producto || 'Paquete') + '</b> asignado a tu hoja de ruta.' + (a.direccion ? '<br>📍 ' + a.direccion : ''));
}
function crearManual(code){
  const nombre = roster[miId] ? roster[miId].name : miId;
  asgRef.push({ producto: 'Paquete escaneado', direccion: '', receptor: '', nota: 'Código ' + code, mlId: '', envioId: '', driverId: miId, driverName: nombre, estado: 'pendiente', ts: Date.now() });
  scanMsg('✅ Paquete agregado a tu hoja de ruta con el código escaneado. La dirección la podés completar desde el panel.');
}
function procesarCodigo(code){
  const found = buscarPaquete(code);
  if (found){ asignarme(found[0], found[1]); return; }
  scanMsg('🔎 Escaneé este código pero no encontré una venta importada que coincida:<br><code style="word-break:break-all">' +
    String(code).replace(/</g,'&lt;') + '</code><br>Importá la venta desde el panel, o agregalo igual:' +
    '<br><button id="btnManual" style="margin-top:8px;background:#00a650">➕ Agregar a mi ruta con este código</button>');
  const b = $('#btnManual'); if (b) b.onclick = () => crearManual(code);
}
async function pararScan(){
  escaneando = false;
  $('#btnScan').style.display = 'block'; $('#btnScanStop').style.display = 'none';
  try { if (qr){ await qr.stop(); await qr.clear(); } } catch(e){}
}
async function iniciarScan(){
  if (!miId){ msg('Elegí tu nombre primero.', 'err'); return; }
  if (typeof window.Html5Qrcode === 'undefined'){ msg('No cargó el lector de códigos. Revisá tu conexión.', 'err'); return; }
  const info = $('#scaninfo'); if (info) info.classList.remove('show');
  $('#btnScan').style.display = 'none'; $('#btnScanStop').style.display = 'block';
  try {
    qr = new window.Html5Qrcode('reader');
    escaneando = true;
    await qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } },
      (txt) => { if (!escaneando) return; pararScan(); procesarCodigo(txt); }, () => {});
  } catch(e){
    $('#btnScan').style.display = 'block'; $('#btnScanStop').style.display = 'none';
    msg('No pude abrir la cámara: ' + (e.message || e), 'err');
  }
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
if ($('#btnScan')) $('#btnScan').onclick = iniciarScan;
if ($('#btnScanStop')) $('#btnScanStop').onclick = pararScan;
