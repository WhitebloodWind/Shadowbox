'use strict';
/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function busy(on, msg = 'Working…') { const b = $('#busy'); b.textContent = msg; b.hidden = !on; }
function later(fn) { busy(true); setTimeout(() => { try { fn(); } catch (e) { console.error(e); toast('Something went wrong: ' + e.message); } finally { busy(false); } }, 30); }
function debounce(fn, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function seg(id, onChange) {
  const el = $(id); const btns = Array.from(el.querySelectorAll('button'));
  const api = {
    get value() { return btns.find(b => b.getAttribute('aria-pressed') === 'true').dataset.v; },
    set(v, fire = false) { btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); if (fire && onChange) onChange(v); },
  };
  btns.forEach(b => b.addEventListener('click', () => { api.set(b.dataset.v); onChange && onChange(b.dataset.v); }));
  return api;
}
const num = id => parseFloat($(id).value);

/* ================= downloads & file writers ================= */
const dlReady = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
async function saveFile(filename, data) {
  const dl = await dlReady;
  if (dl) {
    try { await dl.save({ filename, data }); toast('Saved ' + filename); }
    catch (e) {
      if (e && e.code === 'declined') toast('Download cancelled');
      else if (e && e.code === 'rate_limited') toast('A save prompt is already open. Try again in a moment.');
      else toast('Couldn’t save ' + filename + (e && e.message ? ': ' + e.message : ''));
    }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data]);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const enc = s => new TextEncoder().encode(s);
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// Wheel input: a trackpad pinch arrives as ctrl + wheel in small steps, a two-finger drag as plain
// wheel events with fine (often fractional, often sideways) deltas, and a mouse wheel in whole notches.
// Returns { zoom: factor > 1 to zoom in } or { pan: [dx, dy] in screen px, as if dragging the content }.
function wheelGesture(e) {
  const u = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; const dx = e.deltaX * u, dy = e.deltaY * u;
  if (e.ctrlKey) return { zoom: Math.exp(-dy * 0.012) };
  const notch = e.deltaMode !== 0 || (dx === 0 && Number.isInteger(dy) && Math.abs(dy) >= 50 && (e.wheelDeltaY === undefined || e.wheelDeltaY === 0 || e.wheelDeltaY % 120 === 0));
  return notch ? { zoom: Math.exp(-dy * 0.0015) } : { pan: [-dx, -dy] };
}
function makeZip(files) { // [{name, data: Uint8Array|string}]
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc(f.data) : f.data; const name = enc(f.name); const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
// Shapes for writers: {loops:[[x,y]...], circles:[{x,y,d}], layer:'CUT'|'ENGRAVE'}; mm, y down.
function allPoints(groups) { const pts = []; for (const g of groups) { for (const l of g.loops || []) pts.push(...l); for (const c of g.circles || []) pts.push([c.x - c.d / 2, c.y - c.d / 2], [c.x + c.d / 2, c.y + c.d / 2]); } return pts; }
function toDXF(groups) {
  const bb = Geo.bbox(allPoints(groups));
  const X = x => (x - bb.x0).toFixed(4), Y = y => (bb.y1 - y).toFixed(4);
  const e = [];
  for (const g of groups) {
    const col = g.layer === 'ENGRAVE' ? '5' : '1';
    for (const l of g.loops || []) {
      e.push('0', 'POLYLINE', '8', g.layer, '62', col, '66', '1', '70', '1', '10', '0', '20', '0', '30', '0');
      for (const [x, y] of l) e.push('0', 'VERTEX', '8', g.layer, '10', X(x), '20', Y(y), '30', '0');
      e.push('0', 'SEQEND', '8', g.layer);
    }
    for (const c of g.circles || []) e.push('0', 'CIRCLE', '8', g.layer, '62', col, '10', X(c.x), '20', Y(c.y), '30', '0', '40', (c.d / 2).toFixed(4));
  }
  const head = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '2',
    '0', 'LAYER', '2', 'CUT', '70', '0', '62', '1', '6', 'CONTINUOUS', '0', 'LAYER', '2', 'ENGRAVE', '70', '0', '62', '5', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES'];
  return head.concat(e, ['0', 'ENDSEC', '0', 'EOF']).join('\n') + '\n';
}
function toSVG(groups, margin = 3) {
  const bb = Geo.bbox(allPoints(groups)); const w = bb.w + 2 * margin, h = bb.h + 2 * margin;
  const X = x => (x - bb.x0 + margin).toFixed(3), Y = y => (y - bb.y0 + margin).toFixed(3);
  let body = '';
  for (const g of groups) {
    const col = g.layer === 'ENGRAVE' ? '#0000ff' : '#ff0000';
    const d = (g.loops || []).map(l => 'M' + l.map(([x, y]) => X(x) + ' ' + Y(y)).join('L') + 'Z').join('');
    if (d) body += `<path id="${g.id || g.layer.toLowerCase()}" d="${d}" fill="none" stroke="${col}" stroke-width="0.1" fill-rule="evenodd"/>\n`;
    for (const c of g.circles || []) body += `<circle cx="${X(c.x)}" cy="${Y(c.y)}" r="${(c.d / 2).toFixed(3)}" fill="none" stroke="${col}" stroke-width="0.1"/>\n`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w, 3)}mm" height="${fmt(h, 3)}mm" viewBox="0 0 ${fmt(w, 3)} ${fmt(h, 3)}">\n${body}</svg>\n`;
}
function toPDF(groups) {
  const m = 10, pt = 72 / 25.4; const bb = Geo.bbox(allPoints(groups));
  const W = (bb.w + 2 * m) * pt, H = (bb.h + 2 * m + 12) * pt;
  const X = x => ((x - bb.x0 + m) * pt).toFixed(2), Y = y => (H - (y - bb.y0 + m) * pt).toFixed(2);
  let s = '0.6 w 1 0 0 RG 1 J 1 j\n';
  for (const g of groups) for (const l of g.loops || []) { s += X(l[0][0]) + ' ' + Y(l[0][1]) + ' m\n'; for (let i = 1; i < l.length; i++) s += X(l[i][0]) + ' ' + Y(l[i][1]) + ' l\n'; s += 'h S\n'; }
  const by = (12 / 2) * pt + 4; const bx = m * pt;
  s += `0 0 0 RG 0.8 w ${bx.toFixed(2)} ${by.toFixed(2)} m ${(bx + 50 * pt).toFixed(2)} ${by.toFixed(2)} l S\n`;
  s += `${bx.toFixed(2)} ${(by - 4).toFixed(2)} m ${bx.toFixed(2)} ${(by + 4).toFixed(2)} l S ${(bx + 50 * pt).toFixed(2)} ${(by - 4).toFixed(2)} m ${(bx + 50 * pt).toFixed(2)} ${(by + 4).toFixed(2)} l S\n`;
  s += `BT /F1 9 Tf ${(bx + 50 * pt + 8).toFixed(2)} ${(by - 3).toFixed(2)} Td (50 mm check bar. Print at 100%, no scaling.) Tj ET\n`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${s.length} >>\nstream\n${s}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
function toSTL(mesh, name) {
  const n = mesh.pos.length / 9; const buf = new ArrayBuffer(84 + n * 50); const dv = new DataView(buf);
  const h = enc((name || 'part').slice(0, 79)); new Uint8Array(buf, 0, h.length).set(h);
  dv.setUint32(80, n, true); let o = 84; const p = mesh.pos;
  for (let t = 0; t < n; t++) {
    const i = t * 9;
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, p[i + k], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

/* ================= tabs & steps ================= */
let phase = 1;
function setPhase(p) {
  phase = p;
  $('#tab1').setAttribute('aria-selected', String(p === 1)); $('#tab2').setAttribute('aria-selected', String(p === 2));
  $('#panel1').hidden = p !== 1; $('#panel2').hidden = p !== 2;
  $('#cv1').hidden = p !== 1; $('#tools').hidden = p === 1 && !P1.img;
  $('#empty1').hidden = !(p === 1 && !P1.img);
  $('#viewtabs').hidden = p !== 2;
  if (p === 2) P2.enter(); else { $('#cubeBox').hidden = true; $('#cv2').hidden = true; $('#cv3').hidden = true; $('#empty2').hidden = true; $('#legend').hidden = true; P1.resize(); }
  updateHud();
}
$('#tab1').addEventListener('click', () => setPhase(1));
$('#tab2').addEventListener('click', () => setPhase(2));
function openStep(panel, n) {
  $$(panel + ' .step').forEach(s => s.classList.toggle('open', s.dataset.step === String(n)));
  if (panel === '#panel1') P1.onStep(n);
}
$$('.step > .head').forEach(h => h.addEventListener('click', () => {
  const s = h.parentElement; const panel = '#' + s.closest('.phase-panel').id;
  if (s.classList.contains('open') && panel === '#panel2') { s.classList.remove('open'); return; }
  openStep(panel, s.dataset.step);
}));
function updateHud() {
  const hud = $('#hud'); hud.innerHTML = '';
  const chip = t => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = t; hud.appendChild(c); };
  if (phase === 1 && P1.img) {
    chip(P1.mmPerPx ? `Scale set: 1 mm = ${fmt(1 / P1.mmPerPx, 2)} px` : 'Scale not set');
    if (P1.line) { const b = Geo.bbox(P1.line); chip(`${fmt(b.w)} × ${fmt(b.h)} ${P1.mmPerPx ? 'mm' : 'px'}`); }
  }
  if (phase === 2 && P2.cs) { const b = Geo.bbox(P2.cs.lines.outer); chip(`Case ${fmt(b.w)} × ${fmt(b.h)} mm`); }
}

/* ================= PHASE 1 ================= */
const P1 = {
  img: null, src: null, work: null, W: 0, H: 0, mmPerPx: null, rectified: false,
  view: { s: 1, tx: 0, ty: 0 }, step: 1,
  cal: { mode: '2', pts: [] }, tool: 'edit', erase: null, eraseCv: null, maskCv: null, seed: null,
  contour: null, keys: null, line: null, enl: [], expSel: { traced: true }, sel: -1, traceDone: false,
};
const cv1 = $('#cv1'); const ctx1 = cv1.getContext('2d');
P1.resize = function () {
  const r = cv1.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  cv1.width = Math.max(1, Math.round(r.width * dpr)); cv1.height = Math.max(1, Math.round(r.height * dpr));
  P1.draw();
};
P1.fit = function () {
  if (!P1.work) return; const r = cv1.getBoundingClientRect();
  const s = Math.min(r.width / P1.W, r.height / P1.H) * 0.92; P1.view = { s, tx: (r.width - P1.W * s) / 2, ty: (r.height - P1.H * s) / 2 }; P1.draw();
};
const toScreen = (x, y) => [x * P1.view.s + P1.view.tx, y * P1.view.s + P1.view.ty];
const toWork = (sx, sy) => [(sx - P1.view.tx) / P1.view.s, (sy - P1.view.ty) / P1.view.s];
const mm2px = v => P1.mmPerPx ? v / P1.mmPerPx : v; // line coords are mm (or px when uncalibrated)
P1.unit = () => P1.mmPerPx || 1;

P1.load = function (file) {
  const url = URL.createObjectURL(file); const im = new Image();
  im.onload = () => {
    const max = 2000; const k = Math.min(1, max / Math.max(im.width, im.height));
    const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    P1.img = im; P1.src = c; P1.setWork(c); P1.mmPerPx = null; P1.rectified = false; $('#calReset').hidden = true;
    P1.cal.pts = []; P1.resetTrace();
    $('#empty1').hidden = true; $('#tools').hidden = false; $('#s1sub').textContent = file.name; $('#s2sub').textContent = 'Not set';
    markDone('#panel1', 1, true); markDone('#panel1', 2, false);
    openStep('#panel1', 2); P1.fit(); updateHud(); URL.revokeObjectURL(url);
  };
  im.onerror = () => toast('That file couldn’t be opened as an image.');
  im.src = url;
};
P1.setWork = function (c) { P1.work = c; P1.W = c.width; P1.H = c.height; P1.erase = new Uint8Array(P1.W * P1.H); P1.eraseCv = null; P1.eraseUndo = []; P1.eraseRedo = []; if (P1.updateEraseBtns) P1.updateEraseBtns(); };
P1.resetTrace = function () { P1.contour = P1.keys = P1.line = null; for (const e of P1.enl) e.loop = null; P1.maskCv = null; P1.seed = null; P1.sel = -1; P1.traceDone = false; $('#traceInfo').hidden = true; $('#s3sub').textContent = ''; if (P1.updateEnlInfo) { P1.updateEnlInfo(); P1.renderExport(); } };
function markDone(panel, n, v) { const s = $(`${panel} .step[data-step="${n}"]`); if (s) s.classList.toggle('done', v); }
P1.onStep = function (n) { P1.step = +n; P1.draw(); };

// ---- calibration ----
const calMode = seg('#calMode', v => {
  P1.cal.mode = v; P1.cal.pts = [];
  $('#calHelp2').hidden = v !== '2'; $('#calHelp4').hidden = v !== '4'; $('#calDistRow').hidden = v !== '2'; $('#calRectRows').hidden = v !== '4';
  P1.calCheck(); P1.draw();
});
P1.calNeed = () => P1.cal.mode === '2' ? 2 : 4;
P1.calCheck = () => { $('#calApply').disabled = P1.cal.pts.length !== P1.calNeed(); };
$('#calClear').addEventListener('click', () => { P1.cal.pts = []; P1.calCheck(); P1.draw(); });
$('#calReset').addEventListener('click', () => {
  P1.setWork(P1.src); P1.mmPerPx = null; P1.rectified = false; $('#calReset').hidden = true; P1.cal.pts = []; P1.resetTrace();
  $('#s2sub').textContent = 'Not set'; markDone('#panel1', 2, false); P1.calCheck(); P1.fit(); updateHud();
});
$('#calApply').addEventListener('click', () => {
  const pts = P1.cal.pts;
  if (P1.cal.mode === '2') {
    const d = num('#calDist'); const px = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    if (!(d > 0) || px < 2) { toast('Enter a distance and place two separate points.'); return; }
    P1.mmPerPx = d / px; P1.cal.pts = []; P1.resetTrace();
    finishCal();
  } else {
    const wmm = num('#calW'), hmm = num('#calH'); if (!(wmm > 0 && hmm > 0)) { toast('Enter the rectangle’s width and height.'); return; }
    later(() => { P1.rectify(pts, wmm, hmm); finishCal(); });
  }
});
function finishCal() {
  $('#s2sub').textContent = `1 mm = ${fmt(1 / P1.mmPerPx, 2)} px`; markDone('#panel1', 2, true);
  P1.calCheck(); openStep('#panel1', 3); P1.draw(); updateHud();
  toast('Scale set. Now trace the outline.');
}
P1.rectify = function (pts, wmm, hmm) {
  // order clockwise starting nearest top-left
  const c = pts.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  let o = pts.slice().sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  let k = 0, best = 1e18; o.forEach((p, i) => { const s = p[0] + p[1]; if (s < best) { best = s; k = i; } });
  o = o.slice(k).concat(o.slice(0, k));
  const H = Geo.homography(o, [[0, 0], [wmm, 0], [wmm, hmm], [0, hmm]]); if (!H) { toast('Those four points don’t form a rectangle. Try again.'); return; }
  const corners = [[0, 0], [P1.W, 0], [P1.W, P1.H], [0, P1.H]].map(p => Geo.applyH(H, p[0], p[1]));
  let bb = Geo.bbox(corners);
  const lim = 3 * Math.max(wmm, hmm);
  bb = { x0: Math.max(bb.x0, -lim), y0: Math.max(bb.y0, -lim), x1: Math.min(bb.x1, wmm + lim), y1: Math.min(bb.y1, hmm + lim) };
  const pxPerMm = (Math.hypot(o[1][0] - o[0][0], o[1][1] - o[0][1]) / wmm + Math.hypot(o[3][0] - o[0][0], o[3][1] - o[0][1]) / hmm) / 2;
  const res = Math.min(pxPerMm * 1.1, 2400 / Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0));
  const W = Math.round((bb.x1 - bb.x0) * res), Hh = Math.round((bb.y1 - bb.y0) * res);
  const Hi = Geo.invH(H);
  const sd = P1.work.getContext('2d').getImageData(0, 0, P1.W, P1.H).data;
  const out = document.createElement('canvas'); out.width = W; out.height = Hh; const oc = out.getContext('2d'); const od = oc.createImageData(W, Hh);
  const SW = P1.W, SH = P1.H;
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const [sx, sy] = Geo.applyH(Hi, bb.x0 + (i + 0.5) / res, bb.y0 + (j + 0.5) / res);
    const fx = sx - 0.5, fy = sy - 0.5; const x0 = Math.floor(fx), y0 = Math.floor(fy); const o4 = (j * W + i) * 4;
    if (x0 < 0 || y0 < 0 || x0 >= SW - 1 || y0 >= SH - 1) { od.data[o4 + 3] = 0; continue; }
    const tx = fx - x0, ty = fy - y0;
    for (let ch = 0; ch < 3; ch++) {
      const a = sd[(y0 * SW + x0) * 4 + ch], b = sd[(y0 * SW + x0 + 1) * 4 + ch], cc = sd[((y0 + 1) * SW + x0) * 4 + ch], d = sd[((y0 + 1) * SW + x0 + 1) * 4 + ch];
      od.data[o4 + ch] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
    }
    od.data[o4 + 3] = 255;
  }
  oc.putImageData(od, 0, 0);
  P1.setWork(out); P1.mmPerPx = 1 / res; P1.rectified = true; P1.cal.pts = []; P1.resetTrace(); $('#calReset').hidden = false; P1.fit();
};

// ---- tracing ----
const toolSeg = seg('#toolSeg', v => {
  P1.tool = v; $('#brushRow').hidden = v !== 'erase';
  $('#toolHint').textContent = v === 'edit' ? 'Drag a point to move it. Double-click the line to add a point. Select a point and press Delete to remove it.'
    : v === 'pick' ? 'Click the object you want if the trace picked the wrong one.' : P1.eraseHint();
  P1.draw();
});
$('#brush').addEventListener('input', () => $('#brushV').textContent = $('#brush').value + ' mm');
$('#traceBtn').addEventListener('click', () => P1.runTrace());
const retrace = debounce(() => { if (P1.traceDone) P1.runTrace(); }, 350);
['#thr', '#gap', '#thin'].forEach(id => $(id).addEventListener('input', () => { if (id === '#thr') { $('#thrAuto').checked = false; $('#thrV').textContent = (+$('#thr').value).toFixed(2); } retrace(); }));
['#thrAuto', '#dark', '#even'].forEach(id => $(id).addEventListener('change', () => retrace()));
$('#detail').addEventListener('change', () => { if (P1.contour) { P1.makeKeys(); P1.updateLine(); } });
$('#smooth').addEventListener('change', () => { if (P1.keys) P1.updateLine(); });
// Erasing: paint to erase, paint with Restore to bring areas back, undo and redo strokes.
P1.eraseMode = 'add'; P1.eraseUndo = []; P1.eraseRedo = [];
P1.eraseHint = () => P1.eraseMode === 'add' ? 'Paint over anything that shouldn’t be part of the object, like a keyring or a shadow.' : 'Paint over erased (red) areas to bring them back.';
const eraseSeg = seg('#eraseSeg', v => { P1.eraseMode = v; $('#toolHint').textContent = P1.eraseHint(); });
P1.updateEraseBtns = () => { $('#undoErase').disabled = !P1.eraseUndo.length; $('#redoErase').disabled = !P1.eraseRedo.length; };
P1.eraseSnapshot = () => { P1.eraseUndo.push(P1.erase.slice()); if (P1.eraseUndo.length > 30) P1.eraseUndo.shift(); P1.eraseRedo = []; P1.updateEraseBtns(); };
P1.rebuildEraseCv = function () { // redraw the red overlay from the mask
  const W = P1.W, H = P1.H; let any = false; for (let i = 0; i < P1.erase.length; i++) if (P1.erase[i]) { any = true; break; }
  if (!any) { P1.eraseCv = null; return; }
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const im = x.createImageData(W, H);
  for (let i = 0; i < P1.erase.length; i++) if (P1.erase[i]) { const o = i * 4; im.data[o] = 0xE0; im.data[o + 1] = 0x37; im.data[o + 2] = 0x2A; im.data[o + 3] = 255; }
  x.putImageData(im, 0, 0); P1.eraseCv = c;
};
P1.swapErase = function (from, to) { if (!from.length) return; to.push(P1.erase.slice()); P1.erase = from.pop(); P1.rebuildEraseCv(); P1.updateEraseBtns(); P1.draw(); retrace(); };
$('#undoErase').addEventListener('click', () => P1.swapErase(P1.eraseUndo, P1.eraseRedo));
$('#redoErase').addEventListener('click', () => P1.swapErase(P1.eraseRedo, P1.eraseUndo));
document.addEventListener('keydown', e => {
  if (phase !== 1 || P1.step !== 3 || P1.tool !== 'erase' || !(e.ctrlKey || e.metaKey) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); P1.swapErase(P1.eraseUndo, P1.eraseRedo); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); P1.swapErase(P1.eraseRedo, P1.eraseUndo); }
});
$('#clearErase').addEventListener('click', () => { if (!P1.eraseCv) return; P1.eraseSnapshot(); P1.erase.fill(0); P1.eraseCv = null; P1.draw(); retrace(); });
$('#delPt').addEventListener('click', () => P1.deleteSel());
document.addEventListener('keydown', e => {
  if (phase !== 1 || P1.step !== 3 || P1.sel < 0) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); P1.deleteSel(); }
});
P1.deleteSel = function () { if (P1.sel < 0 || !P1.keys || P1.keys.length <= 4) return; P1.keys.splice(P1.sel, 1); P1.sel = -1; $('#delPt').disabled = true; P1.updateLine(); };

P1.runTrace = function () {
  if (!P1.work) { toast('Upload a photo first.'); return; }
  later(() => P1.trace());
};
P1.trace = function () {
  const W = P1.W, H = P1.H, N = W * H; const d = P1.work.getContext('2d').getImageData(0, 0, W, H).data;
  const L = new Float32Array(N); const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i++) { L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; alpha[i] = d[i * 4 + 3] > 127 ? 1 : 0; }
  const dark = $('#dark').checked;
  // lighting normalisation
  let Nn = new Float32Array(N);
  if ($('#even').checked) {
    const bs = Math.max(2, Math.ceil(Math.max(W, H) / 150)), sw = Math.ceil(W / bs), sh = Math.ceil(H / bs);
    let sm = new Float32Array(sw * sh);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!alpha[i]) continue; const k = Math.floor(y / bs) * sw + Math.floor(x / bs); const v = dark ? L[i] : 255 - L[i]; if (v > sm[k]) sm[k] = v; }
    const nb = (a, fn) => { const o = new Float32Array(sw * sh); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let mx = 0, sum = 0, n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue; const v = a[yy * sw + xx]; if (v > mx) mx = v; sum += v; n++; } o[y * sw + x] = fn === 'max' ? mx : sum / n; } return o; };
    sm = nb(nb(sm, 'max'), 'avg');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const fx = Math.min(sw - 1.001, Math.max(0, (x + 0.5) / bs - 0.5)), fy = Math.min(sh - 1.001, Math.max(0, (y + 0.5) / bs - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0; const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const bg = (sm[y0 * sw + x0] * (1 - tx) + sm[y0 * sw + x1] * tx) * (1 - ty) + (sm[y1 * sw + x0] * (1 - tx) + sm[y1 * sw + x1] * tx) * ty;
      const i = y * W + x; const v = dark ? L[i] : 255 - L[i]; Nn[i] = Math.min(1.2, v / Math.max(8, bg));
    }
  } else { for (let i = 0; i < N; i++) Nn[i] = (dark ? L[i] : 255 - L[i]) / 255; }
  // threshold
  let t = +$('#thr').value;
  if ($('#thrAuto').checked) {
    const hist = new Float64Array(256); let tot = 0;
    for (let i = 0; i < N; i++) if (alpha[i]) { hist[Math.min(255, Math.floor(Nn[i] / 1.2 * 255))]++; tot++; }
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, bt = 128;
    for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; bt = i; } }
    t = (bt + 0.5) / 255 * 1.2; t = Math.max(0.05, Math.min(0.95, t));
    $('#thr').value = t; $('#thrV').textContent = 'auto ' + t.toFixed(2);
  }
  let m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = (alpha[i] && Nn[i] < t && !P1.erase[i]) ? 1 : 0;
  const pxmm = 1 / P1.unit();
  const gapPx = num('#gap') * pxmm, thinPx = num('#thin') * pxmm;
  let F = Geo.signedField(m, W, H, 1);
  if (gapPx > 0) F = Geo.closing(F, W, H, 1, gapPx);
  let Fo = thinPx > 0 ? Geo.opening(F, W, H, 1, thinPx) : F;
  const mo = Geo.maskOf(Fo);
  // components
  const lab = new Int32Array(N); const sizes = [0]; const stack = new Int32Array(N); let nl = 0;
  for (let i = 0; i < N; i++) {
    if (!mo[i] || lab[i]) continue; nl++; let sp = 0, cnt = 0; stack[sp++] = i; lab[i] = nl;
    while (sp) { const p = stack[--sp]; cnt++; const x = p % W, y = (p - x) / W;
      if (x > 0 && mo[p - 1] && !lab[p - 1]) { lab[p - 1] = nl; stack[sp++] = p - 1; }
      if (x < W - 1 && mo[p + 1] && !lab[p + 1]) { lab[p + 1] = nl; stack[sp++] = p + 1; }
      if (y > 0 && mo[p - W] && !lab[p - W]) { lab[p - W] = nl; stack[sp++] = p - W; }
      if (y < H - 1 && mo[p + W] && !lab[p + W]) { lab[p + W] = nl; stack[sp++] = p + W; } }
    sizes.push(cnt);
  }
  if (!nl) { toast('Nothing was found at this threshold. Try moving the threshold slider.'); return; }
  let pick = 1;
  if (P1.seed) {
    const [sx, sy] = P1.seed; const si = Math.floor(sy) * W + Math.floor(sx);
    if (lab[si]) pick = lab[si];
    else { let bd = 1e18; for (let i = 0; i < N; i += 3) if (lab[i]) { const x = i % W, y = (i - x) / W; const dd = (x - sx) ** 2 + (y - sy) ** 2; if (dd < bd) { bd = dd; pick = lab[i]; } } }
  } else { let bs = 0; for (let k = 1; k <= nl; k++) if (sizes[k] > bs) { bs = sizes[k]; pick = k; } }
  let comp = new Uint8Array(N); for (let i = 0; i < N; i++) comp[i] = lab[i] === pick ? 1 : 0;
  if (thinPx > 0) { const dd = Geo.edt(comp, W, H); const mc = Geo.maskOf(F); for (let i = 0; i < N; i++) comp[i] = (mc[i] && dd[i] <= thinPx + 2) ? 1 : 0; }
  // fill holes
  const outside = new Uint8Array(N); let sp = 0;
  const pushO = p => { if (!comp[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < W; x++) { pushO(x); pushO((H - 1) * W + x); } for (let y = 0; y < H; y++) { pushO(y * W); pushO(y * W + W - 1); }
  while (sp) { const p = stack[--sp]; const x = p % W, y = (p - x) / W; if (x > 0) pushO(p - 1); if (x < W - 1) pushO(p + 1); if (y > 0) pushO(p - W); if (y < H - 1) pushO(p + W); }
  for (let i = 0; i < N; i++) if (!outside[i]) comp[i] = 1;
  // smooth sub-pixel contour
  const S = Geo.signedField(comp, W, H, 1);
  const loop = Geo.largest(Geo.contours(S, W, H, 0));
  if (!loop) { toast('No outline found.'); return; }
  const u = P1.unit();
  P1.contour = Geo.smoothLoop(loop, 1).map(([x, y]) => [(x + 0.5) * u, (y + 0.5) * u]);
  // overlay
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H; const mctx = mc.getContext('2d'); const md = mctx.createImageData(W, H);
  for (let i = 0; i < N; i++) if (comp[i]) { md.data[i * 4] = 255; md.data[i * 4 + 1] = 90; md.data[i * 4 + 2] = 70; md.data[i * 4 + 3] = 70; }
  mctx.putImageData(md, 0, 0); P1.maskCv = mc;
  P1.traceDone = true; P1.makeKeys(); P1.updateLine(); markDone('#panel1', 3, true);
};
P1.makeKeys = function () {
  const u = P1.unit(); const eps = num('#detail') * (P1.mmPerPx ? 1 : 1 / 0.1);
  P1.keys = Geo.rdpClosed(Geo.resample(P1.contour, 0.25 * (P1.mmPerPx ? 1 : 10)), eps);
  P1.sel = -1; $('#delPt').disabled = true;
};
P1.updateLine = function () {
  if (!P1.keys) return;
  P1.line = $('#smooth').checked ? Geo.catmull(P1.keys, 0.3 * (P1.mmPerPx ? 1 : 10)) : P1.keys.slice();
  const b = Geo.bbox(P1.line); const unit = P1.mmPerPx ? 'mm' : 'px';
  $('#traceInfo').hidden = false;
  $('#traceInfo').innerHTML = `<dl><dt>Size</dt><dd>${fmt(b.w)} × ${fmt(b.h)} ${unit}</dd><dt>Key points</dt><dd>${P1.keys.length}</dd><dt>Perimeter</dt><dd>${fmt(Geo.perimeter(P1.line))} ${unit}</dd></dl>` + (P1.mmPerPx ? '' : '<p class="hint" style="margin:8px 0 0">Set the scale in step 2 to get millimetres.</p>');
  $('#s3sub').textContent = `${fmt(b.w, 0)} × ${fmt(b.h, 0)} ${unit}`;
  P1.computeEnl(); P1.draw(); updateHud();
};

// ---- enlarge: any number of lines, each with its own setting ----
let enlSeq = 0;
const ENL_COLORS = ['--engrave', '#E39B2B', '#A35BD6', '#169C9C', '#D6457B', '#6B8E23'];
P1.enlColor = e => { const c = ENL_COLORS[(e.id - 1) % ENL_COLORS.length]; return c.startsWith('--') ? css(c) : c; };
P1.addEnl = function () {
  enlSeq++; const e = { id: enlSeq, name: 'Line ' + enlSeq, mode: 'offset', offset: 1, scale: 105, loop: null };
  P1.enl.push(e); P1.expSel['enl' + e.id] = true; P1.renderEnl(); P1.computeEnl(e);
};
P1.computeEnl = function (only) {
  for (const e of P1.enl) {
    if (only && e !== only) continue;
    e.loop = null; if (!P1.line) continue;
    if (e.mode === 'offset') { if (e.offset > 0) e.loop = Geo.offsetLoop(P1.line, e.offset); }
    else { const s = e.scale / 100; if (s > 0 && Math.abs(s - 1) > 1e-6) { const b = Geo.bbox(P1.line); e.loop = P1.line.map(([x, y]) => [b.cx + (x - b.cx) * s, b.cy + (y - b.cy) * s]); } }
  }
  P1.updateEnlInfo(); P1.renderExport(); P1.draw();
};
P1.renderEnl = function () {
  const box = $('#enlList'); box.innerHTML = '';
  for (const e of P1.enl) {
    const row = document.createElement('div'); row.className = 'enl-row';
    row.innerHTML = `<div class="enl-head"><span class="sw" style="color:${P1.enlColor(e)}"></span><b></b><span class="enl-size" data-size="${e.id}"></span><button class="enl-del" aria-label="Remove ${e.name}">×</button></div>
      <div class="row"><select aria-label="${e.name} method"><option value="offset">Even gap</option><option value="scale">Scale from centre</option></select><input type="number" aria-label="${e.name} amount" step="0.1"><span class="val"></span></div>`;
    row.querySelector('b').textContent = e.name;
    const sel = row.querySelector('select'), inp = row.querySelector('input'), unit = row.querySelector('.val');
    const sync = () => { sel.value = e.mode; inp.value = e.mode === 'offset' ? e.offset : e.scale; inp.min = e.mode === 'offset' ? 0 : 10; inp.step = e.mode === 'offset' ? 0.1 : 0.5; unit.textContent = e.mode === 'offset' ? (P1.mmPerPx ? 'mm' : 'px') : '%'; };
    sync();
    const deb = debounce(() => P1.computeEnl(e), 250);
    sel.addEventListener('change', () => { e.mode = sel.value; sync(); P1.computeEnl(e); });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!isFinite(v)) return; if (e.mode === 'offset') e.offset = v; else e.scale = v; deb(); });
    row.querySelector('.enl-del').addEventListener('click', () => { P1.enl = P1.enl.filter(x => x !== e); delete P1.expSel['enl' + e.id]; P1.renderEnl(); P1.updateEnlInfo(); P1.renderExport(); P1.draw(); });
    box.appendChild(row);
  }
};
P1.updateEnlInfo = function () {
  const unit = P1.mmPerPx ? 'mm' : 'px';
  for (const e of P1.enl) {
    const el = document.querySelector(`[data-size="${e.id}"]`); if (!el) continue;
    if (e.loop) { const b = Geo.bbox(e.loop); el.textContent = `${fmt(b.w)} × ${fmt(b.h)} ${unit}`; }
    else el.textContent = P1.line ? 'Same as traced' : 'Trace first';
  }
  const n = P1.enl.filter(e => e.loop).length;
  $('#s4sub').textContent = n ? `${n} line${n > 1 ? 's' : ''}` : 'Optional';
};
$('#enlAdd').addEventListener('click', () => P1.addEnl());

// ---- export ----
P1.exportItems = () => [{ key: 'traced', name: 'Traced outline', slug: 'traced', loop: P1.line, color: css('--cut') }]
  .concat(P1.enl.map(e => ({ key: 'enl' + e.id, name: e.name, slug: e.name.toLowerCase().replace(/\s+/g, '-'), loop: e.loop, color: P1.enlColor(e), e })));
P1.renderExport = function () {
  const box = $('#expLines'); if (!box) return; box.innerHTML = '';
  const unit = P1.mmPerPx ? 'mm' : 'px';
  for (const it of P1.exportItems()) {
    const lab = document.createElement('label'); lab.className = 'check exp-check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!P1.expSel[it.key] && !!it.loop; cb.disabled = !it.loop;
    cb.addEventListener('change', () => { P1.expSel[it.key] = cb.checked; });
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.color = it.color;
    const nm = document.createElement('span'); nm.textContent = it.name;
    const sm = document.createElement('small');
    if (it.loop) { const b = Geo.bbox(it.loop); sm.textContent = `${fmt(b.w)} × ${fmt(b.h)} ${unit}`; } else sm.textContent = it.key === 'traced' ? 'Not traced yet' : 'Same as traced';
    lab.append(cb, sw, nm, sm); box.appendChild(lab);
  }
};
$$('[data-exp]').forEach(b => b.addEventListener('click', () => P1.export(b.dataset.exp)));
P1.export = function (kind) {
  if (!P1.line) { toast('Trace an outline first.'); return; }
  if (!P1.mmPerPx) { toast('Set the scale in step 2 before exporting, so the file is in millimetres.'); return; }
  const items = P1.exportItems().filter(it => it.loop && P1.expSel[it.key]);
  if (!items.length) { toast('Choose at least one line to export.'); return; }
  const groups = items.map(it => ({ id: it.slug, layer: 'CUT', loops: [it.loop] }));
  const base = 'outline' + (items.length === 1 ? '-' + items[0].slug : '');
  if (kind === 'svg') saveFile(base + '.svg', toSVG(groups));
  else if (kind === 'pdf') saveFile(base + '.pdf', toPDF(groups));
  else if (kind === 'dxf') saveFile(base + '-dxf.zip', makeZip([{ name: base + '.dxf', data: toDXF(groups) }]));
  else if (kind === 'json') saveFile(base + '.json', JSON.stringify({
    units: 'mm', yAxis: 'down', keyPoints: P1.keys.map(p => p.map(v => +v.toFixed(3))),
    lines: items.map(it => ({ name: it.name, ...(it.e ? (it.e.mode === 'offset' ? { method: 'even gap', distanceMM: it.e.offset } : { method: 'scale from centre', scalePercent: it.e.scale }) : { method: 'traced' }), points: it.loop.map(p => p.map(v => +v.toFixed(3))) })),
  }, null, 1));
};
$('#toCase').addEventListener('click', () => {
  if (!P1.line || !P1.mmPerPx) { toast('Trace an outline and set the scale first.'); return; }
  P2.dirty = true; setPhase(2);
});
P1.renderExport();

// ---- drawing ----
function drawMatGrid(ctx, w, h, toS, unitPerMM, sPerUnit, dpr) {
  // grid in mm when calibrated
  const pxPerMM = sPerUnit * unitPerMM; let step = 1; while (step * pxPerMM < 9) step *= step === 1 ? 5 : 2;
  const major = step * (step === 1 ? 10 : step === 5 ? 2 : 5);
  const [ox, oy] = toS(0, 0);
  ctx.lineWidth = 1 * dpr;
  for (const [st, a] of [[step, 0.08], [major, 0.2]]) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.beginPath();
    const sp = st * pxPerMM * dpr; const x0 = ((ox * dpr) % sp + sp) % sp, y0 = ((oy * dpr) % sp + sp) % sp;
    for (let x = x0; x < w; x += sp) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
    for (let y = y0; y < h; y += sp) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke();
  }
}
P1.draw = function () {
  const dpr = window.devicePixelRatio || 1; const c = ctx1; const w = cv1.width, h = cv1.height;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
  if (P1.mmPerPx) drawMatGrid(c, w, h, toScreen, 1 / P1.mmPerPx, P1.view.s, dpr);
  if (!P1.work) return;
  c.setTransform(dpr * P1.view.s, 0, 0, dpr * P1.view.s, dpr * P1.view.tx, dpr * P1.view.ty);
  c.imageSmoothingEnabled = P1.view.s < 2;
  c.globalAlpha = P1.step >= 3 && P1.line ? 0.75 : 1; c.drawImage(P1.work, 0, 0); c.globalAlpha = 1;
  if (P1.step === 3 && P1.maskCv && P1.tool !== 'edit') c.drawImage(P1.maskCv, 0, 0);
  if (P1.eraseCv && P1.step === 3) { c.globalAlpha = 0.55; c.drawImage(P1.eraseCv, 0, 0); c.globalAlpha = 1; }
  c.setTransform(1, 0, 0, 1, 0, 0);
  const cut = css('--cut'), eng = css('--engrave');
  const path = (loop, col, width, dash) => {
    if (!loop) return; c.beginPath();
    loop.forEach(([x, y], i) => { const [sx, sy] = toScreen(mm2px(x), mm2px(y)); i ? c.lineTo(sx * dpr, sy * dpr) : c.moveTo(sx * dpr, sy * dpr); });
    c.closePath(); c.strokeStyle = col; c.lineWidth = width * dpr; c.setLineDash(dash ? [6 * dpr, 4 * dpr] : []); c.stroke(); c.setLineDash([]);
  };
  for (const e of P1.enl) path(e.loop, P1.enlColor(e), 2, true);
  path(P1.line, cut, 2);
  if (P1.step === 3 && P1.keys && P1.tool === 'edit') {
    P1.keys.forEach(([x, y], i) => {
      const [sx, sy] = toScreen(mm2px(x), mm2px(y)); const r = (i === P1.sel ? 5.5 : 4) * dpr;
      c.beginPath(); c.rect(sx * dpr - r, sy * dpr - r, 2 * r, 2 * r); c.fillStyle = i === P1.sel ? cut : '#fff'; c.fill(); c.lineWidth = 1.5 * dpr; c.strokeStyle = cut; c.stroke();
    });
  }
  if (P1.step === 2) {
    const pts = P1.cal.pts.map(p => toScreen(p[0], p[1]));
    c.strokeStyle = '#FFD84D'; c.lineWidth = 2 * dpr;
    if (pts.length > 1) { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x * dpr, y * dpr) : c.moveTo(x * dpr, y * dpr)); if (P1.cal.mode === '4' && pts.length === 4) c.closePath(); c.stroke(); }
    pts.forEach(([x, y], i) => {
      c.beginPath(); c.arc(x * dpr, y * dpr, 7 * dpr, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo((x - 11) * dpr, y * dpr); c.lineTo((x + 11) * dpr, y * dpr); c.moveTo(x * dpr, (y - 11) * dpr); c.lineTo(x * dpr, (y + 11) * dpr); c.stroke();
      c.fillStyle = '#FFD84D'; c.font = `${12 * dpr}px Archivo, sans-serif`; c.fillText(String(i + 1), (x + 10) * dpr, (y - 10) * dpr);
    });
    if (P1.hover) P1.drawLoupe(c, dpr);
  }
};
// Brush outline: shows the eraser or restore brush at its real size under the cursor.
{
  const baseDraw = P1.draw;
  P1.draw = function () {
    baseDraw();
    const erasing = phase === 1 && P1.step === 3 && P1.tool === 'erase' && P1.work;
    cv1.style.cursor = erasing ? 'none' : '';
    if (!erasing || !P1.brushAt) return;
    const dpr = window.devicePixelRatio || 1, c = ctx1; const [x, y] = P1.brushAt;
    const r = Math.max(1, num('#brush') / P1.unit() * P1.view.s) * dpr; const add = P1.eraseMode !== 'remove';
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.beginPath(); c.arc(x * dpr, y * dpr, r, 0, Math.PI * 2);
    c.fillStyle = add ? 'rgba(224,55,42,0.18)' : 'rgba(80,210,230,0.20)'; c.fill();
    c.lineWidth = 3 * dpr; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.stroke();
    c.lineWidth = 1.5 * dpr; c.strokeStyle = add ? '#FF6B5E' : '#6FE3F2'; c.stroke();
    c.beginPath(); c.moveTo(x * dpr - 4 * dpr, y * dpr); c.lineTo(x * dpr + 4 * dpr, y * dpr); c.moveTo(x * dpr, y * dpr - 4 * dpr); c.lineTo(x * dpr, y * dpr + 4 * dpr);
    c.lineWidth = 1.5 * dpr; c.strokeStyle = '#fff'; c.stroke();
    c.font = `600 ${11 * dpr}px Archivo, sans-serif`; c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3 * dpr;
    const label = `${add ? 'Erase' : 'Restore'} ${num('#brush')} mm`; const tx = x * dpr + r * 0.72 + 6 * dpr, ty = y * dpr - r * 0.72 - 4 * dpr;
    c.strokeText(label, tx, ty); c.fillText(label, tx, ty);
    c.restore();
  };
}
$('#brush').addEventListener('input', () => { if (P1.brushAt) P1.draw(); });
P1.drawLoupe = function (c, dpr) {
  const [wx, wy] = P1.hover; const R = 64, z = 5; const cx = cv1.width - (R + 16) * dpr, cy = (R + 56) * dpr;
  c.save(); c.beginPath(); c.arc(cx, cy, R * dpr, 0, Math.PI * 2); c.clip();
  c.fillStyle = '#000'; c.fillRect(cx - R * dpr, cy - R * dpr, 2 * R * dpr, 2 * R * dpr);
  c.imageSmoothingEnabled = false;
  const srcR = R / z / P1.view.s * P1.view.s; // in work px
  const sr = R / z;
  c.drawImage(P1.work, wx - sr, wy - sr, 2 * sr, 2 * sr, cx - R * dpr, cy - R * dpr, 2 * R * dpr, 2 * R * dpr);
  c.strokeStyle = '#FFD84D'; c.lineWidth = 1.2 * dpr; c.beginPath(); c.moveTo(cx - R * dpr, cy); c.lineTo(cx + R * dpr, cy); c.moveTo(cx, cy - R * dpr); c.lineTo(cx, cy + R * dpr); c.stroke();
  c.restore(); c.beginPath(); c.arc(cx, cy, R * dpr, 0, Math.PI * 2); c.strokeStyle = '#fff'; c.lineWidth = 2 * dpr; c.stroke();
  void srcR;
};

// ---- pointer interaction (phase 1) ----
const ptrs = new Map(); let drag = null;
function localXY(e, el) { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
cv1.addEventListener('pointerdown', e => {
  if (!P1.work) return; cv1.setPointerCapture(e.pointerId); const [x, y] = localXY(e, cv1); ptrs.set(e.pointerId, [x, y]);
  if (e.button === 1) { e.preventDefault(); drag = { type: 'pan', sx: x, sy: y, view: { ...P1.view } }; return; }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag = { type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view: { ...P1.view } }; return; }
  const [wx, wy] = toWork(x, y); drag = { type: 'maybe', sx: x, sy: y, moved: false, view: { ...P1.view } };
  const near = (pts, conv) => { let bi = -1, bd = 12; pts.forEach((p, i) => { const [sx, sy] = toScreen(...conv(p)); const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; bi = i; } }); return bi; };
  if (P1.step === 2) { const i = near(P1.cal.pts, p => p); if (i >= 0) drag = { type: 'cal', i }; }
  else if (P1.step === 3 && P1.tool === 'edit' && P1.keys) { const i = near(P1.keys, p => [mm2px(p[0]), mm2px(p[1])]); if (i >= 0) { drag = { type: 'key', i }; P1.sel = i; $('#delPt').disabled = false; P1.draw(); } }
  else if (P1.step === 3 && P1.tool === 'erase') { P1.eraseSnapshot(); drag = { type: 'erase', last: [wx, wy] }; P1.paint(wx, wy); }
});
cv1.addEventListener('pointermove', e => {
  const [x, y] = localXY(e, cv1); const [wx, wy] = toWork(x, y);
  if (P1.step === 2 && P1.work) { P1.hover = [wx, wy]; if (!drag) P1.draw(); }
  if (P1.step === 3 && P1.tool === 'erase' && P1.work) { P1.brushAt = [x, y]; if (!drag) P1.draw(); } else if (P1.brushAt) { P1.brushAt = null; }
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [x, y]);
  if (!drag) return;
  if (drag.type === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const k = d / drag.d; const v = drag.view; const s = v.s * k;
    P1.view = { s, tx: m[0] - (drag.m[0] - v.tx) * k, ty: m[1] - (drag.m[1] - v.ty) * k }; P1.draw(); return;
  }
  if (drag.type === 'cal') { P1.cal.pts[drag.i] = [wx, wy]; P1.draw(); return; }
  if (drag.type === 'key') { const u = P1.unit(); P1.keys[drag.i] = [wx * u, wy * u]; P1.line = $('#smooth').checked ? Geo.catmull(P1.keys, 0.3 * (P1.mmPerPx ? 1 : 10)) : P1.keys.slice(); P1.draw(); return; }
  if (drag.type === 'erase') { // fill in between samples so fast strokes stay continuous
    const [lx, ly] = drag.last; const r = num('#brush') / P1.unit(); const n = Math.max(1, Math.ceil(Math.hypot(wx - lx, wy - ly) / Math.max(0.5, r * 0.5)));
    for (let i = 1; i <= n; i++) P1.paint(lx + (wx - lx) * i / n, ly + (wy - ly) * i / n, i < n); drag.last = [wx, wy]; return;
  }
  if (drag.type === 'maybe' || drag.type === 'pan') {
    if (Math.hypot(x - drag.sx, y - drag.sy) > 4) drag.type = 'pan';
    if (drag.type === 'pan') { P1.view = { ...drag.view, tx: drag.view.tx + x - drag.sx, ty: drag.view.ty + y - drag.sy }; P1.draw(); }
  }
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
  if (!drag) return;
  const [x, y] = localXY(e, cv1); const [wx, wy] = toWork(x, y);
  if (drag.type === 'maybe') {
    if (P1.step === 2) { if (P1.cal.pts.length < P1.calNeed()) P1.cal.pts.push([wx, wy]); P1.calCheck(); P1.draw(); }
    else if (P1.step === 3 && P1.tool === 'pick') { P1.seed = [wx, wy]; P1.runTrace(); }
    else if (P1.step === 3 && P1.tool === 'edit') { P1.sel = -1; $('#delPt').disabled = true; P1.draw(); }
  } else if (drag.type === 'key') { P1.updateLine(); }
  else if (drag.type === 'erase') { if (P1.traceDone) P1.runTrace(); }
  else if (drag.type === 'cal') P1.calCheck();
  if (ptrs.size === 0) drag = null;
}
cv1.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
cv1.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
cv1.addEventListener('pointerup', endPtr); cv1.addEventListener('pointercancel', endPtr);
cv1.addEventListener('pointerleave', () => { if (P1.hover || P1.brushAt) { P1.hover = null; P1.brushAt = null; P1.draw(); } });
cv1.addEventListener('dblclick', e => {
  if (P1.step !== 3 || P1.tool !== 'edit' || !P1.keys) return;
  const [x, y] = localXY(e, cv1); const [wx, wy] = toWork(x, y); const u = P1.unit(); const p = [wx * u, wy * u];
  let bi = 0, bd = 1e18; const K = P1.keys;
  for (let i = 0; i < K.length; i++) { const a = K[i], b = K[(i + 1) % K.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]); if (d < bd) { bd = d; bi = i; } }
  K.splice(bi + 1, 0, p); P1.sel = bi + 1; $('#delPt').disabled = false; P1.updateLine();
});
cv1.addEventListener('wheel', e => {
  e.preventDefault(); const [x, y] = localXY(e, cv1); const g = wheelGesture(e); const v = P1.view;
  if (g.pan) { P1.view = { ...v, tx: v.tx + g.pan[0], ty: v.ty + g.pan[1] }; P1.draw(); return; }
  const k = g.zoom; P1.view = { s: v.s * k, tx: x - (x - v.tx) * k, ty: y - (y - v.ty) * k }; P1.draw();
}, { passive: false });
P1.paint = function (wx, wy, noDraw) {
  const r = num('#brush') / P1.unit(); const W = P1.W, H = P1.H; const add = P1.eraseMode !== 'remove';
  if (!P1.eraseCv) { if (!add) return; P1.eraseCv = document.createElement('canvas'); P1.eraseCv.width = W; P1.eraseCv.height = H; }
  const ec = P1.eraseCv.getContext('2d'); ec.globalCompositeOperation = add ? 'source-over' : 'destination-out'; ec.fillStyle = '#E0372A'; ec.beginPath(); ec.arc(wx, wy, r, 0, Math.PI * 2); ec.fill(); ec.globalCompositeOperation = 'source-over';
  for (let y = Math.max(0, Math.floor(wy - r)); y <= Math.min(H - 1, Math.ceil(wy + r)); y++) for (let x = Math.max(0, Math.floor(wx - r)); x <= Math.min(W - 1, Math.ceil(wx + r)); x++) if ((x + 0.5 - wx) ** 2 + (y + 0.5 - wy) ** 2 <= r * r) P1.erase[y * W + x] = add ? 1 : 0;
  if (!noDraw) P1.draw();
};
// file input & drop
$('#file1').addEventListener('change', e => { const f = e.target.files[0]; if (f) P1.load(f); e.target.value = ''; });
const stage = $('#stage');
stage.addEventListener('dragover', e => { e.preventDefault(); });
stage.addEventListener('drop', e => {
  e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
  if (phase === 1 && f.type.startsWith('image/')) P1.load(f); else if (phase === 2) P2.importFile(f); else toast('Drop an image file here.');
});
