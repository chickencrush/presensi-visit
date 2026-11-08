/*******************************************************
 * PRESENSI VISIT — FRONTEND LOGIC
 *******************************************************/

const CONFIG = {
  // ⬇️ GANTI DENGAN URL WEB APP APPS SCRIPT ANDA (yang berakhiran /exec)
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz2rhDF1QwFe8xvYUbtj56zqzAF5L6BrmNosta3yZ33lQD9nX8r97bW6dbrsms1Er80jg/exec'
};

/* ================= STATE ================= */
let currentUser  = JSON.parse(localStorage.getItem('pv_user') || 'null');
let currentLoc   = { lat: null, lng: null, alamat: '' };
let watchId      = null;
let lastGeocode  = { time: 0, lat: 0, lng: 0 };

let selfieStream = null;
let selfieRAF    = null;
// Anti-mirror: di mobile kamera depan default mirror, kita flip canvas agar hasil TIDAK mirror.
let antiMirror   = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

let visitStream  = null;
let visitRAF     = null;
let fotosVisit   = [];

/* ================= ELEMEN ================= */
const $ = id => document.getElementById(id);
const els = {
  loginScreen: $('loginScreen'), appScreen: $('appScreen'),
  loginNama: $('loginNama'), loginInstansi: $('loginInstansi'), btnLogin: $('btnLogin'),
  btnLogout: $('btnLogout'), userLabel: $('userLabel'),

  video: $('video'), previewCanvas: $('previewCanvas'),
  cameraPlaceholder: $('cameraPlaceholder'), btnStartCam: $('btnStartCam'),
  btnMirror: $('btnMirror'), btnPresensi: $('btnPresensi'),
  presensiStatus: $('presensiStatus'),

  gpsAccuracy: $('gpsAccuracy'), lokasiNama: $('lokasiNama'), lokasiKoordinat: $('lokasiKoordinat'),

  visitTujuan: $('visitTujuan'), visitCatatan: $('visitCatatan'),
  fotoGrid: $('fotoGrid'), fotoCount: $('fotoCount'),
  btnKameraVisit: $('btnKameraVisit'), btnFileVisit: $('btnFileVisit'),
  fileInput: $('fileInput'), galleryInput: $('galleryInput'),
  visitLokasi: $('visitLokasi'), btnKirimVisit: $('btnKirimVisit'), visitStatus: $('visitStatus'),

  riwayatList: $('riwayatList'), btnRefresh: $('btnRefresh'),

  cameraModal: $('cameraModal'), visitVideo: $('visitVideo'),
  visitPreviewCanvas: $('visitPreviewCanvas'),
  btnCloseModal: $('btnCloseModal'), btnSnapVisit: $('btnSnapVisit')
};

/* ================= INIT ================= */
document.addEventListener('DOMContentLoaded', init);

function init() {
  bindEvents();
  if (currentUser && currentUser.nama) {
    showApp();
  } else {
    els.loginScreen.classList.add('active');
  }
}

function bindEvents() {
  els.btnLogin.addEventListener('click', login);
  els.btnLogout.addEventListener('click', logout);

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  els.btnStartCam.addEventListener('click', startSelfieCamera);
  els.btnMirror.addEventListener('click', toggleMirror);
  els.btnPresensi.addEventListener('click', simpanPresensi);

  els.btnKameraVisit.addEventListener('click', openVisitCamera);
  els.btnFileVisit.addEventListener('click', () => els.galleryInput.click());
  els.fileInput.addEventListener('change', handleFilePick);
  els.galleryInput.addEventListener('change', handleFilePick);
  els.btnKirimVisit.addEventListener('click', simpanVisit);

  els.btnCloseModal.addEventListener('click', closeVisitCamera);
  els.btnSnapVisit.addEventListener('click', snapVisitPhoto);
  els.btnRefresh.addEventListener('click', loadRiwayat);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopAllCameras();
  });
  window.addEventListener('beforeunload', stopAllCameras);
}

/* ================= AUTH ================= */
function login() {
  const nama = els.loginNama.value.trim();
  const instansi = els.loginInstansi.value.trim();
  if (!nama) { els.loginNama.focus(); return alert('Nama wajib diisi.'); }

  currentUser = { nama, instansi };
  localStorage.setItem('pv_user', JSON.stringify(currentUser));
  showApp();
}

function logout() {
  stopAllCameras();
  localStorage.removeItem('pv_user');
  currentUser = null;
  els.appScreen.classList.remove('active');
  els.loginScreen.classList.add('active');
}

function showApp() {
  els.loginScreen.classList.remove('active');
  els.appScreen.classList.add('active');
  els.userLabel.textContent = currentUser.nama;
  startGPS();
  loadRiwayat();
}

/* ================= GPS ================= */
function startGPS() {
  if (!navigator.geolocation) {
    els.lokasiNama.textContent = 'GPS tidak didukung browser ini';
    return;
  }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  watchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      currentLoc.lat = latitude;
      currentLoc.lng = longitude;
      els.gpsAccuracy.textContent = `±${Math.round(accuracy)} m`;
      els.lokasiKoordinat.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

      const now = Date.now();
      const dist = haversine(lastGeocode.lat, lastGeocode.lng, latitude, longitude);
      if (now - lastGeocode.time > 12000 || dist > 50) {
        lastGeocode = { time: now, lat: latitude, lng: longitude };
        reverseGeocode(latitude, longitude);
      }
      els.visitLokasi.textContent = currentLoc.alamat || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    },
    err => {
      els.lokasiNama.textContent = 'Izin lokasi ditolak / tidak tersedia';
      console.warn(err);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=id`
    );
    const data = await res.json();
    currentLoc.alamat = data.display_name || '';
    els.lokasiNama.textContent = currentLoc.alamat || 'Lokasi tidak diketahui';
    els.visitLokasi.textContent = currentLoc.alamat;
  } catch {
    els.lokasiNama.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1) return 999999;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ================= TAB ================= */
function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  $('tab' + tab).classList.add('active');
  if (tab === 'Riwayat') loadRiwayat();
}

/* ================= SELFIE CAMERA ================= */
async function startSelfieCamera() {
  try {
    selfieStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    els.video.srcObject = selfieStream;
    await els.video.play();
    els.cameraPlaceholder.classList.add('hidden');
    els.btnStartCam.classList.add('hidden');
    els.btnMirror.classList.remove('hidden');
    els.btnMirror.textContent = `↔ Anti-Mirror: ${antiMirror ? 'ON' : 'OFF'}`;
    els.btnPresensi.disabled = false;
    renderSelfiePreview();
  } catch (err) {
    alert('Tidak bisa mengakses kamera. Pastikan situs menggunakan HTTPS dan izin kamera diberikan.');
    console.error(err);
  }
}

function renderSelfiePreview() {
  if (!selfieStream) return;
  const v = els.video, c = els.previewCanvas;
  if (v.readyState >= 2) {
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth; c.height = v.videoHeight;
    }
    const ctx = c.getContext('2d');
    ctx.save();
    if (antiMirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    ctx.restore();
  }
  selfieRAF = requestAnimationFrame(renderSelfiePreview);
}

function toggleMirror() {
  antiMirror = !antiMirror;
  els.btnMirror.textContent = `↔ Anti-Mirror: ${antiMirror ? 'ON' : 'OFF'}`;
}

/* ================= SIMPAN PRESENSI ================= */
async function simpanPresensi() {
  if (!selfieStream) return alert('Aktifkan kamera terlebih dahulu.');
  if (currentLoc.lat === null) return alert('Lokasi GPS belum terdeteksi. Tunggu sebentar.');

  const selfie = els.previewCanvas.toDataURL('image/jpeg', 0.75);
  setLoading(els.btnPresensi, true, 'Menyimpan...');
  els.presensiStatus.textContent = '';

  try {
    const res = await postToGAS({
      action: 'savePresensi',
      nama: currentUser.nama,
      instansi: currentUser.instansi,
      lat: currentLoc.lat,
      lng: currentLoc.lng,
      alamat: currentLoc.alamat,
      selfie
    });
    if (!res.success) throw new Error(res.message || 'Gagal menyimpan');

    els.presensiStatus.textContent = '✅ Presensi berhasil disimpan!';
    els.presensiStatus.className = 'status ok';
    loadRiwayat();
  } catch (err) {
    els.presensiStatus.textContent = '❌ ' + err.message;
    els.presensiStatus.className = 'status err';
  } finally {
    setLoading(els.btnPresensi, false, 'Ambil Presensi 📸');
  }
}

/* ================= VISIT CAMERA ================= */
async function openVisitCamera() {
  els.cameraModal.classList.add('open');
  try {
    visitStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    els.visitVideo.srcObject = visitStream;
    await els.visitVideo.play();
    renderVisitPreview();
  } catch {
    try {
      visitStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      els.visitVideo.srcObject = visitStream;
      await els.visitVideo.play();
      renderVisitPreview();
    } catch (e) {
      alert('Kamera tidak tersedia. Gunakan tombol "Pilih File".');
      closeVisitCamera();
    }
  }
}

function renderVisitPreview() {
  if (!visitStream) return;
  const v = els.visitVideo, c = els.visitPreviewCanvas;
  if (v.readyState >= 2) {
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth; c.height = v.videoHeight;
    }
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  }
  visitRAF = requestAnimationFrame(renderVisitPreview);
}

function snapVisitPhoto() {
  if (!visitStream) return;
  const dataUrl = els.visitPreviewCanvas.toDataURL('image/jpeg', 0.72);
  addFoto(dataUrl);
  closeVisitCamera();
}

function closeVisitCamera() {
  els.cameraModal.classList.remove('open');
  if (visitStream) {
    visitStream.getTracks().forEach(t => t.stop());
    visitStream = null;
  }
  if (visitRAF) { cancelAnimationFrame(visitRAF); visitRAF = null; }
}

/* ================= FILE PICKER ================= */
async function handleFilePick(e) {
  const files = Array.from(e.target.files || []).slice(0, 3 - fotosVisit.length);
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const dataUrl = await compressFile(file);
    addFoto(dataUrl);
  }
  e.target.value = '';
}

function compressFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1280;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function addFoto(dataUrl) {
  if (fotosVisit.length >= 3) return alert('Maksimal 3 foto dokumentasi.');
  fotosVisit.push(dataUrl);
  renderFotos();
}

function renderFotos() {
  els.fotoGrid.innerHTML = '';
  fotosVisit.forEach((src, i) => {
    const div = document.createElement('div');
    div.className = 'foto-item';
    div.innerHTML = `<img src="${src}" alt="Foto ${i+1}"><button data-i="${i}">✕</button>`;
    div.querySelector('button').addEventListener('click', () => {
      fotosVisit.splice(i, 1);
      renderFotos();
    });
    els.fotoGrid.appendChild(div);
  });
  els.fotoCount.textContent = `${fotosVisit.length}/3`;
}

/* ================= SIMPAN VISIT ================= */
async function simpanVisit() {
  const tujuan = els.visitTujuan.value.trim();
  const catatan = els.visitCatatan.value.trim();

  if (!tujuan) return alert('Tujuan visit wajib diisi.');
  if (fotosVisit.length === 0) return alert('Minimal 1 foto dokumentasi.');
  if (currentLoc.lat === null) return alert('Lokasi GPS belum terdeteksi.');

  setLoading(els.btnKirimVisit, true, 'Mengirim...');
  els.visitStatus.textContent = '';

  try {
    const res = await postToGAS({
      action: 'saveVisit',
      nama: currentUser.nama,
      instansi: currentUser.instansi,
      tujuan,
      catatan,
      lat: currentLoc.lat,
      lng: currentLoc.lng,
      alamat: currentLoc.alamat,
      fotos: fotosVisit
    });
    if (!res.success) throw new Error(res.message || 'Gagal mengirim');

    els.visitStatus.textContent = '✅ Laporan visit berhasil dikirim!';
    els.visitStatus.className = 'status ok';

    els.visitTujuan.value = '';
    els.visitCatatan.value = '';
    fotosVisit = [];
    renderFotos();
    loadRiwayat();
  } catch (err) {
    els.visitStatus.textContent = '❌ ' + err.message;
    els.visitStatus.className = 'status err';
  } finally {
    setLoading(els.btnKirimVisit, false, 'Kirim Laporan 🚀');
  }
}

/* ================= RIWAYAT ================= */
async function loadRiwayat() {
  els.riwayatList.innerHTML = '<p class="muted">Memuat data...</p>';
  try {
    const res  = await fetch(CONFIG.GAS_URL + '?action=getAll');
    const data = await res.json();

    const items = [
      ...(data.presensi || []).map(r => ({ type: 'presensi', r })),
      ...(data.visit    || []).map(r => ({ type: 'visit',    r }))
    ].sort((a, b) => new Date(b.r.Timestamp) - new Date(a.r.Timestamp));

    if (items.length === 0) {
      els.riwayatList.innerHTML = '<p class="muted">Belum ada data.</p>';
      return;
    }

    els.riwayatList.innerHTML = items.map(({ type, r }) => {
      const tgl = r.Timestamp ? new Date(r.Timestamp).toLocaleString('id-ID') : '—';
      if (type === 'presensi') {
        return `
          <div class="riwayat-item">
            <div class="ri-head">
              <span class="ri-type presensi">PRESENSI</span>
              <span class="muted">${tgl}</span>
            </div>
            <h4>${esc(r.Nama || '')}</h4>
            <p>📍 ${esc(r.Alamat || '-')}</p>
            ${r.SelfieURL ? `<div class="ri-thumbs"><img src="${r.SelfieURL}" loading="lazy" alt="Selfie"></div>` : ''}
          </div>`;
      }
      const thumbs = [r.Foto1, r.Foto2, r.Foto3].filter(Boolean)
        .map(u => `<img src="${u}" loading="lazy" alt="Dok">`).join('');
      return `
        <div class="riwayat-item">
          <div class="ri-head">
            <span class="ri-type visit">VISIT</span>
            <span class="muted">${tgl}</span>
          </div>
          <h4>${esc(r.Tujuan || '')}</h4>
          <p>👤 ${esc(r.Nama || '')} · 🏢 ${esc(r.Instansi || '-')}</p>
          <p>📝 ${esc(r.Catatan || '-')}</p>
          <p>📍 ${esc(r.Alamat || '-')}</p>
          ${thumbs ? `<div class="ri-thumbs">${thumbs}</div>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    els.riwayatList.innerHTML = `<p class="status err">Gagal memuat: ${esc(err.message)}</p>`;
  }
}

/* ================= UTIL ================= */
async function postToGAS(payload) {
  const res = await fetch(CONFIG.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  return res.json();
}

function setLoading(btn, loading, text) {
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ ' + text : text;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function stopAllCameras() {
  if (selfieStream) { selfieStream.getTracks().forEach(t => t.stop()); selfieStream = null; }
  if (selfieRAF) { cancelAnimationFrame(selfieRAF); selfieRAF = null; }
  closeVisitCamera();
}
