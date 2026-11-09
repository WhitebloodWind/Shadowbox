/* ================= 3D viewer (plain WebGL) ================= */
class Viewer {
  constructor(cv) {
    this.cv = cv; const gl = cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true }); this.gl = gl; this.items = [];
    this.yaw = -1.05; this.pitch = 0.75; this.dist = 250; this.target = [0, 0, 2]; this.explode = 0.35; this.ok = !!gl;
    if (!gl) return;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec3 p;attribute vec3 n;uniform mat4 M;uniform vec3 off;varying vec3 vn;void main(){vn=n;gl_Position=M*vec4(p+off,1.0);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec3 vn;uniform vec4 col;uniform vec3 L;uniform float lit;void main(){float d=abs(dot(normalize(vn),L));float k=mix(1.0,0.45+0.55*d,lit);gl_FragColor=vec4(col.rgb*k*col.a,col.a);}'));
    gl.linkProgram(pr); this.pr = pr;
    this.loc = { p: gl.getAttribLocation(pr, 'p'), n: gl.getAttribLocation(pr, 'n'), M: gl.getUniformLocation(pr, 'M'), off: gl.getUniformLocation(pr, 'off'), col: gl.getUniformLocation(pr, 'col'), L: gl.getUniformLocation(pr, 'L'), lit: gl.getUniformLocation(pr, 'lit') };
    const pts = new Map(); let st = null;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); st = { yaw: this.yaw, pitch: this.pitch, dist: this.dist, p: [e.clientX, e.clientY], d: pts.size === 2 ? this.pinch(pts) : 0 }; });
    cv.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { if (!st.d) st.d = this.pinch(pts); this.dist = Math.max(10, st.dist * st.d / this.pinch(pts)); }
      else { this.yaw = st.yaw - (e.clientX - st.p[0]) * 0.008; this.pitch = Math.max(-1.45, Math.min(1.5, st.pitch + (e.clientY - st.p[1]) * 0.008)); }
      this.render();
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size) { const [q] = pts.values(); st = { yaw: this.yaw, pitch: this.pitch, dist: this.dist, p: q, d: 0 }; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.dist *= Math.exp(e.deltaY * 0.0012); this.render(); }, { passive: false });
    cv.addEventListener('dblclick', () => { this.resetView(); this.render(); });
  }
  pinch(pts) { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; }
  setItems(list, bb) {
    if (!this.ok) return; const gl = this.gl;
    for (const it of this.items) { gl.deleteBuffer(it.bp); gl.deleteBuffer(it.bn); if (it.bl) gl.deleteBuffer(it.bl); }
    this.items = list.filter(i => i.mesh).map(i => {
      const bp = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bp); gl.bufferData(gl.ARRAY_BUFFER, i.mesh.pos, gl.STATIC_DRAW);
      const bn = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bn); gl.bufferData(gl.ARRAY_BUFFER, i.mesh.nor, gl.STATIC_DRAW);
      let bl = null; if (i.mesh.lines.length) { bl = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bl); gl.bufferData(gl.ARRAY_BUFFER, i.mesh.lines, gl.STATIC_DRAW); }
      return { ...i, bp, bn, bl, count: i.mesh.pos.length / 3, lcount: i.mesh.lines.length / 3 };
    });
    const first = !this.bb; this.bb = bb; if (first) this.needFit = true; else this.target = [bb.cx, -bb.cy, 2];
  }
  resetView() { if (!this.bb) return; const r = this.cv.getBoundingClientRect(); const asp = r.width > 0 && r.height > 0 ? r.width / r.height : 1; this.dist = Math.max(this.bb.w, this.bb.h) * 2.1 / Math.min(1, asp * 0.75); this.target = [this.bb.cx, -this.bb.cy, 2]; this.yaw = -1.05; this.pitch = 0.75; }
  render() {
    if (!this.ok || this.cv.hidden) return; const gl = this.gl; const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect(); const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    if (this.needFit && r.width > 0) { this.needFit = false; this.resetView(); }
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.items.length) return;
    gl.useProgram(this.pr); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE);
    const t = this.target; const cp = Math.cos(this.pitch);
    const eye = [t[0] + this.dist * cp * Math.cos(this.yaw), t[1] + this.dist * cp * Math.sin(this.yaw), t[2] + this.dist * Math.sin(this.pitch)];
    const M = mul(perspective(0.6, W / H, this.dist * 0.02, this.dist * 20), lookAt(eye, t, [0, 0, 1]));
    gl.uniformMatrix4fv(this.loc.M, false, M);
    const Ld = [0.35, -0.45, 0.82]; const ll = Math.hypot(...Ld); gl.uniform3f(this.loc.L, Ld[0] / ll, Ld[1] / ll, Ld[2] / ll);
    const ex = this.explode * Math.max(8, (this.bb ? Math.max(this.bb.w, this.bb.h) : 100) * 0.12);
    const zOf = it => it.zc + ex * it.layer; const dEye = it => Math.hypot(t[0] - eye[0], t[1] - eye[1], zOf(it) - eye[2]);
    const order = this.items.filter(i => i.alpha >= 1).concat(this.items.filter(i => i.alpha < 1).sort((a, b) => dEye(b) - dEye(a)));
    gl.enableVertexAttribArray(this.loc.p);
    for (const it of order) {
      gl.uniform3f(this.loc.off, 0, 0, ex * it.layer);
      gl.bindBuffer(gl.ARRAY_BUFFER, it.bp); gl.vertexAttribPointer(this.loc.p, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.loc.n); gl.bindBuffer(gl.ARRAY_BUFFER, it.bn); gl.vertexAttribPointer(this.loc.n, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(this.loc.col, it.color[0], it.color[1], it.color[2], it.alpha); gl.uniform1f(this.loc.lit, 1);
      gl.depthMask(it.alpha >= 1); gl.drawArrays(gl.TRIANGLES, 0, it.count);
      if (it.bl) {
        gl.disableVertexAttribArray(this.loc.n); gl.vertexAttrib3f(this.loc.n, 0, 0, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, it.bl); gl.vertexAttribPointer(this.loc.p, 3, gl.FLOAT, false, 0, 0);
        gl.uniform4f(this.loc.col, it.edge[0], it.edge[1], it.edge[2], it.edge[3]); gl.uniform1f(this.loc.lit, 0);
        gl.drawArrays(gl.LINES, 0, it.lcount);
      }
    }
    gl.depthMask(true);
  }
}
function perspective(fovy, a, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
function lookAt(e, c, u) {
  let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; let l = Math.hypot(...z); z = z.map(v => v / l);
  let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x) || 1; x = x.map(v => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -d(x, e), -d(y, e), -d(z, e), 1];
}
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }

/* ================= importers ================= */
function parseSVGLoops(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'); const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('This file isn’t a valid SVG.');
  root.querySelectorAll('script,foreignObject,image,iframe,a,animate,set').forEach(n => n.remove());
  root.querySelectorAll('*').forEach(n => { for (const at of Array.from(n.attributes)) if (/^on/i.test(at.name) || /href/i.test(at.name)) n.removeAttribute(at.name); });
  const unitMM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
  const wAttr = (root.getAttribute('width') || '').trim(); const m = wAttr.match(/^([\d.]+)\s*([a-z%]*)$/i);
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let mmPerUnit = 25.4 / 96;
  if (vb.length === 4 && vb[2] > 0) { if (m && m[2] !== '%' && unitMM[m[2].toLowerCase()] !== undefined) mmPerUnit = parseFloat(m[1]) * unitMM[m[2].toLowerCase()] / vb[2]; }
  else if (m && unitMM[m[2].toLowerCase()] !== undefined) mmPerUnit = 25.4 / 96;
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('style', 'position:absolute;left:-100000px;top:0;width:10px;height:10px;visibility:hidden');
  const node = document.importNode(root, true); node.removeAttribute('viewBox'); node.setAttribute('width', '100000'); node.setAttribute('height', '100000');
  host.appendChild(node); document.body.appendChild(host);
  const loops = [];
  try {
    for (const el of node.querySelectorAll('path,polygon,polyline,rect,circle,ellipse')) {
      if (typeof el.getTotalLength !== 'function') continue; const len = el.getTotalLength(); if (!(len > 0)) continue;
      const step = Math.max(len / 6000, 0.2 / mmPerUnit); const n = Math.max(16, Math.ceil(len / step)); const ds = len / n;
      const M = el.getCTM(); let cur = []; let prev = null;
      for (let k = 0; k <= n; k++) {
        const p = el.getPointAtLength(Math.min(len, k * ds));
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > ds * 3) { if (cur.length > 2) loops.push(cur); cur = []; }
        const x = M ? M.a * p.x + M.c * p.y + M.e : p.x, y = M ? M.b * p.x + M.d * p.y + M.f : p.y;
        cur.push([x * mmPerUnit, y * mmPerUnit]); prev = p;
      }
      if (cur.length > 2) loops.push(cur);
    }
  } finally { host.remove(); }
  return loops;
}
function parseDXFLoops(text) {
  const L = text.split(/\r?\n/); const pr = [];
  for (let i = 0; i + 1 < L.length; i += 2) pr.push([parseInt(L[i].trim(), 10), L[i + 1].trim()]);
  let unit = 1; const iu = pr.findIndex(p => p[0] === 9 && p[1] === '$INSUNITS');
  if (iu >= 0 && pr[iu + 1]) unit = ({ 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 })[parseInt(pr[iu + 1][1], 10)] || 1;
  let i = pr.findIndex((p, k) => p[0] === 2 && p[1] === 'ENTITIES' && pr[k - 1] && pr[k - 1][1] === 'SECTION');
  if (i < 0) i = 0;
  const ents = []; let cur = null;
  for (i = i + 1; i < pr.length; i++) { const [c, v] = pr[i]; if (c === 0) { if (v === 'ENDSEC') break; cur = { type: v, d: [] }; ents.push(cur); } else if (cur) cur.d.push([c, v]); }
  const loops = [], open = [];
  const arcPts = (cx, cy, r, a0, a1) => { while (a1 <= a0) a1 += 360; const n = Math.max(8, Math.ceil((a1 - a0) / 3)); const o = []; for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; };
  const bulgeSeg = (p, q, b) => { if (!b) return [p]; const th = 4 * Math.atan(b); const dx = q[0] - p[0], dy = q[1] - p[1]; const c = Math.hypot(dx, dy); if (c < 1e-12) return [p]; const r = c / (2 * Math.sin(th / 2)); const h = r * Math.cos(th / 2); const cx = (p[0] + q[0]) / 2 - dy / c * h, cy = (p[1] + q[1]) / 2 + dx / c * h; const a0 = Math.atan2(p[1] - cy, p[0] - cx); const n = Math.max(4, Math.ceil(Math.abs(th) * 20)); const o = []; for (let k = 0; k < n; k++) { const a = a0 + th * k / n; o.push([cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)]); } return o; };
  const get = (d, c) => { const f = d.find(p => p[0] === c); return f ? parseFloat(f[1]) : 0; };
  for (let k = 0; k < ents.length; k++) {
    const e = ents[k], d = e.d;
    if (e.type === 'LWPOLYLINE') {
      const pts = [], bul = []; for (const [c, v] of d) { if (c === 10) { pts.push([parseFloat(v), 0]); bul.push(0); } else if (c === 20) pts[pts.length - 1][1] = parseFloat(v); else if (c === 42 && pts.length) bul[pts.length - 1] = parseFloat(v); }
      const closed = (get(d, 70) & 1) === 1; const o = [];
      for (let j = 0; j < pts.length; j++) { if (!closed && j === pts.length - 1) { o.push(pts[j]); break; } o.push(...bulgeSeg(pts[j], pts[(j + 1) % pts.length], bul[j])); }
      (closed ? loops : open).push(o);
    } else if (e.type === 'POLYLINE') {
      const closed = (get(d, 70) & 1) === 1; const pts = [];
      while (ents[k + 1] && ents[k + 1].type === 'VERTEX') { k++; pts.push([get(ents[k].d, 10), get(ents[k].d, 20)]); }
      (closed ? loops : open).push(pts);
    } else if (e.type === 'LINE') open.push([[get(d, 10), get(d, 20)], [get(d, 11), get(d, 21)]]);
    else if (e.type === 'ARC') open.push(arcPts(get(d, 10), get(d, 20), get(d, 40), get(d, 50), get(d, 51)));
    else if (e.type === 'CIRCLE') loops.push(arcPts(get(d, 10), get(d, 20), get(d, 40), 0, 360).slice(0, -1));
    else if (e.type === 'ELLIPSE') {
      const cx = get(d, 10), cy = get(d, 20), mx = get(d, 11), my = get(d, 21), ra = get(d, 40) || 1; let t0 = get(d, 41), t1 = d.some(p => p[0] === 42) ? get(d, 42) : 2 * Math.PI;
      const o = []; const n = 120; for (let j = 0; j <= n; j++) { const t = t0 + (t1 - t0) * j / n; o.push([cx + mx * Math.cos(t) - my * ra * Math.sin(t), cy + my * Math.cos(t) + mx * ra * Math.sin(t)]); }
      (Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6 ? loops : open).push(o);
    } else if (e.type === 'SPLINE') {
      const deg = get(d, 71) || 3; const knots = d.filter(p => p[0] === 40).map(p => parseFloat(p[1]));
      const cps = []; const fps = [];
      for (const [c, v] of d) { if (c === 10) cps.push([parseFloat(v), 0]); else if (c === 20 && cps.length) cps[cps.length - 1][1] = parseFloat(v); else if (c === 11) fps.push([parseFloat(v), 0]); else if (c === 21 && fps.length) fps[fps.length - 1][1] = parseFloat(v); }
      let o = [];
      if (cps.length > deg && knots.length === cps.length + deg + 1) {
        const n = Math.max(40, cps.length * 12); const u0 = knots[deg], u1 = knots[cps.length];
        for (let j = 0; j <= n; j++) { const u = Math.min(u1 - 1e-9, u0 + (u1 - u0) * j / n); let s = deg; while (s < cps.length - 1 && knots[s + 1] <= u) s++; const dd = []; for (let q = 0; q <= deg; q++) dd.push(cps[s - deg + q].slice()); for (let r = 1; r <= deg; r++) for (let q = deg; q >= r; q--) { const ii = s - deg + q; const a = (u - knots[ii]) / ((knots[ii + deg - r + 1] - knots[ii]) || 1); dd[q] = [(1 - a) * dd[q - 1][0] + a * dd[q][0], (1 - a) * dd[q - 1][1] + a * dd[q][1]]; } o.push(dd[deg]); }
      } else o = fps.length ? fps : cps;
      ((get(d, 70) & 1) === 1 ? loops : open).push(o);
    }
  }
  // chain open pieces
  const tol = 0.05; const used = new Array(open.length).fill(false);
  for (let a = 0; a < open.length; a++) {
    if (used[a]) continue; used[a] = true; let chain = open[a].slice(); let grown = true;
    while (grown) {
      grown = false; const end = chain[chain.length - 1];
      for (let b = 0; b < open.length; b++) {
        if (used[b]) continue; const s = open[b][0], t = open[b][open[b].length - 1];
        if (Math.hypot(s[0] - end[0], s[1] - end[1]) < tol) { chain = chain.concat(open[b].slice(1)); used[b] = true; grown = true; break; }
        if (Math.hypot(t[0] - end[0], t[1] - end[1]) < tol) { chain = chain.concat(open[b].slice(0, -1).reverse()); used[b] = true; grown = true; break; }
      }
    }
    const s = chain[0], e = chain[chain.length - 1];
    if (chain.length > 2 && Math.hypot(s[0] - e[0], s[1] - e[1]) < tol * 4) loops.push(chain.slice(0, -1));
  }
  return loops.map(l => l.map(([x, y]) => [x * unit, -y * unit]));
}

/* ================= PHASE 2 ================= */
const P2 = { kind: 'traced', importLoop: null, cs: null, meshes: null, view: '3d', dirty: true, lv: { s: 1, tx: 0, ty: 0 } };
P2.source = seg('#srcSeg', v => { P2.sourceKind = v; P2.dirty = true; P2.fillEnlPick(); P2.recompute(); });
P2.enlSel = () => { const id = +$('#enlPick').value; return P1.enl.find(e => e.id === id && e.loop) || P1.enl.find(e => e.loop) || null; };
P2.fillEnlPick = function () {
  const sel = $('#enlPick'); const cur = +sel.value; const ok = P1.enl.filter(e => e.loop);
  sel.innerHTML = ''; for (const e of ok) { const o = document.createElement('option'); o.value = e.id; const b = Geo.bbox(e.loop); o.textContent = `${e.name}, ${fmt(b.w)} × ${fmt(b.h)} mm`; sel.appendChild(o); }
  if (ok.some(e => e.id === cur)) sel.value = cur;
  $('#enlPickRow').hidden = P2.sourceKind !== 'enlarged' || ok.length === 0;
};
$('#enlPick').addEventListener('change', () => { P2.dirty = true; P2.recompute(); });
P2.sourceKind = 'traced';
const cv2 = $('#cv2'), ctx2 = cv2.getContext('2d'); const viewer = new Viewer($('#cv3'));
const viewSeg = seg('#viewSeg', v => { P2.view = v; P2.show(); });
$('#explode').addEventListener('input', () => { viewer.explode = +$('#explode').value; viewer.render(); });
const joinSeg = seg('#joinSeg', v => { $('#screwRows').hidden = v !== 'screws'; $('#solventRows').hidden = v !== 'solvent'; P2.recompute(); });
$('#keyring').addEventListener('change', () => { $('#keyRows').hidden = !$('#keyring').checked; P2.recompute(); });
const recomputeDeb = debounce(() => P2.recompute(), 400);
['#figT', '#clear', '#border', '#cornerR', '#keyD', '#keyPos', '#spacing', '#minScrews', '#edge', '#gOff', '#gW', '#gD', '#impScale'].forEach(id => $(id).addEventListener('input', recomputeDeb));
['#plateT', '#spacerT', '#screw'].forEach(id => $(id).addEventListener('change', () => P2.recompute()));
$('#file2').addEventListener('change', e => { const f = e.target.files[0]; if (f) P2.importFile(f); e.target.value = ''; });
const useSample = () => {
  const pts = []; for (let k = 0; k < 360; k++) { const a = k / 360 * 2 * Math.PI; const r = 34 + 7 * Math.sin(3 * a + 0.4) + 3.5 * Math.cos(5 * a) + 2 * Math.sin(7 * a); pts.push([r * Math.cos(a) * 1.15, r * Math.sin(a)]); }
  P2.importLoop = pts; $('#impScale').value = 1; P2.source.set('import'); P2.sourceKind = 'import'; P2.dirty = true; P2.recompute();
};
$('#sample').addEventListener('click', useSample); $('#sample2').addEventListener('click', useSample);
P2.importFile = function (f) {
  const name = f.name.toLowerCase(); const rd = new FileReader();
  rd.onload = () => {
    try {
      const loops = name.endsWith('.dxf') ? parseDXFLoops(rd.result) : parseSVGLoops(rd.result);
      const lp = Geo.largest(loops.filter(l => l.length > 2));
      if (!lp || Math.abs(Geo.area(lp)) < 1) { toast('No closed outline was found in that file.'); return; }
      P2.importLoop = lp; $('#impScale').value = 1; P2.source.set('import'); P2.sourceKind = 'import'; P2.dirty = true; P2.recompute();
      const b = Geo.bbox(lp); toast(`Imported ${f.name}: ${fmt(b.w)} × ${fmt(b.h)} mm`);
    } catch (err) { console.error(err); toast('That file couldn’t be read: ' + err.message); }
  };
  rd.readAsText(f);
};
P2.getFig = function () {
  let lp = null; const k = P2.sourceKind;
  if (k === 'traced' && P1.line && P1.mmPerPx) lp = P1.line;
  else if (k === 'enlarged' && P2.enlSel() && P1.mmPerPx) lp = P2.enlSel().loop;
  else if (k === 'import' && P2.importLoop) { const s = num('#impScale') || 1; lp = P2.importLoop.map(([x, y]) => [x * s, y * s]); }
  if (!lp) return null;
  const b = Geo.bbox(lp); return Geo.resample(lp.map(([x, y]) => [x - b.cx, y - b.cy]), 0.3);
};
P2.params = () => ({
  figT: num('#figT'), clear: Math.max(0, num('#clear')), border: Math.max(2, num('#border')), plateT: num('#plateT'), spacerT: num('#spacerT'), cornerR: Math.max(0, num('#cornerR')),
  keyring: $('#keyring').checked, keyringD: Math.max(1.5, num('#keyD')), keyringPos: num('#keyPos'),
  join: joinSeg.value, screw: $('#screw').value, spacing: Math.max(10, num('#spacing')), minScrews: Math.max(2, Math.round(num('#minScrews'))), edge: Math.max(0.5, num('#edge')),
  grooveOffset: Math.max(0.3, num('#gOff')), grooveWidth: Math.max(0.2, num('#gW')), grooveDepth: Math.max(0.1, num('#gD')),
});
P2.enter = function () {
  P2.fillEnlPick(); const es = P2.enlSel();
  const hint = { traced: P1.line && P1.mmPerPx ? `Using the traced outline, ${fmt(Geo.bbox(P1.line).w)} × ${fmt(Geo.bbox(P1.line).h)} mm.` : 'Nothing traced yet. Trace an outline in the Outline tab, or import a file.',
    enlarged: es && P1.mmPerPx ? `Using ${es.name}, ${fmt(Geo.bbox(es.loop).w)} × ${fmt(Geo.bbox(es.loop).h)} mm.` : 'There’s no enlarged line. Add one in step 4 of the Outline tab.',
    import: P2.importLoop ? 'Using the imported outline.' : 'Import an SVG or DXF with a closed outline.' };
  $('#srcHint').textContent = hint[P2.sourceKind];
  if (P2.dirty) P2.recompute(); else P2.show();
};
P2.show = function () {
  const has = !!P2.cs;
  $('#empty2').hidden = has; $('#cv2').hidden = !has || P2.view !== 'layout'; $('#cv3').hidden = !has || P2.view !== '3d';
  $('#explodeBox').hidden = P2.view !== '3d'; $('#legend').hidden = !has || P2.view !== 'layout'; $('#tools').hidden = P2.view === '3d' && has;
  if (has && P2.view === '3d') { if (!viewer.ok) { toast('3D preview needs WebGL, which isn’t available here. Showing the cut layout.'); viewSeg.set('layout'); P2.view = 'layout'; return P2.show(); } viewer.render(); }
  if (has && P2.view === 'layout') { if (!P2.lvOK) { P2.fitLayout(); P2.lvOK = cv2.getBoundingClientRect().width > 0; } P2.drawLayout(); }
};
P2.recompute = function () {
  if (phase !== 2) { P2.dirty = true; return; }
  const fig = P2.getFig();
  if (!fig) { P2.cs = null; P2.show(); $('#analysis').hidden = true; $('#warnings').innerHTML = ''; $('#bom').innerHTML = ''; updateHud(); const h = { traced: 'Nothing traced yet. Trace an outline in the Outline tab, or import a file.', enlarged: 'There’s no enlarged line. Add one in step 4 of the Outline tab.', import: 'Import an SVG or DXF with a closed outline.' }; $('#srcHint').textContent = h[P2.sourceKind]; return; }
  P2.dirty = false;
  later(() => {
    const p = P2.params(); const cs = CaseGen.build(fig, p); const ms = CaseGen.meshes(cs, p);
    P2.cs = cs; P2.meshes = ms; P2.p = p;
    const bb = Geo.bbox(cs.lines.outer);
    const st = p.spacerT, pt = p.plateT;
    viewer.setItems([
      { mesh: ms.back, color: [0.80, 0.90, 0.98], alpha: 0.32, edge: [0.55, 0.72, 0.85, 0.7], layer: 0, zc: pt / 2 },
      { mesh: ms.figure, color: [0.28, 0.50, 0.36], alpha: 1, edge: [0.12, 0.25, 0.16, 0.6], layer: 1, zc: pt + p.figT / 2 },
      { mesh: ms.spacer, color: [0.42, 0.66, 0.90], alpha: 0.55, edge: [0.3, 0.5, 0.75, 0.8], layer: 1, zc: pt + st / 2 },
      { mesh: ms.front, color: [0.80, 0.90, 0.98], alpha: 0.32, edge: [0.55, 0.72, 0.85, 0.7], layer: 2, zc: pt * 1.5 + st },
      { mesh: ms.screws, color: [0.62, 0.65, 0.69], alpha: 1, edge: [0, 0, 0, 0], layer: 2.6, zc: pt + st / 2 },
    ], bb);
    const key = P2.sourceKind + Geo.bbox(fig).w.toFixed(1) + (P2.sourceKind === 'enlarged' && P2.enlSel() ? P2.enlSel().id : ''); if (key !== P2.figKey) { P2.figKey = key; P2.lvOK = false; }
    const hint = { traced: 'Using the traced outline', enlarged: 'Using ' + (P2.enlSel() ? P2.enlSel().name : 'the enlarged line'), import: 'Using the imported outline' }[P2.sourceKind];
    const fb = Geo.bbox(cs.lines.figure); $('#srcHint').textContent = `${hint}, ${fmt(fb.w)} × ${fmt(fb.h)} mm.`; $('#t1sub').textContent = `${fmt(fb.w, 0)} × ${fmt(fb.h, 0)} mm`;
    $('#t2sub').textContent = `${fmt(bb.w, 0)} × ${fmt(bb.h, 0)} mm`;
    P2.updateAnalysis(); P2.updateBOM(); P2.show(); updateHud();
  });
};
P2.updateAnalysis = function () {
  const cs = P2.cs, p = P2.p, box = $('#analysis'); box.hidden = false;
  if (cs.analysis) {
    const a = cs.analysis;
    box.innerHTML = `<dl><dt>Screws needed</dt><dd>${a.screws.length} × ${p.screw} × ${a.length} mm</dd><dt>Screw line around the window</dt><dd>${fmt(a.pathLength, 0)} mm</dd><dt>Longest gap between screws</dt><dd>${fmt(a.maxGap)} mm</dd><dt>Thinnest material beside a hole</dt><dd>${fmt(a.minClear)} mm</dd><dt>Stack thickness</dt><dd>${fmt(a.stack)} mm</dd></dl><p class="hint" style="margin:8px 0 0">Screws sit midway between the window and the outer edge. ${a.screws.length} keeps every gap near or under ${p.spacing} mm; each hole has at least ${p.edge} mm of acrylic beside it.</p>`;
    $('#t3sub').textContent = `${a.screws.length} × ${p.screw}`;
  } else {
    box.innerHTML = `<dl><dt>Groove</dt><dd>${fmt(p.grooveWidth)} mm wide, ${fmt(p.grooveDepth, 2)} mm deep</dd><dt>Distance from window</dt><dd>${fmt(p.grooveOffset)} mm</dd></dl><p class="hint" style="margin:8px 0 0">Engrave the groove, flip the spacer and engrave the other face too. Apply solvent from the outer edge and let it wick in up to the groove.</p>`;
    $('#t3sub').textContent = 'Solvent';
  }
  $('#warnings').innerHTML = cs.warnings.map(w => `<div class="warn">${w}</div>`).join('');
};
P2.bomRows = function () {
  const cs = P2.cs, p = P2.p; const bb = Geo.bbox(cs.lines.outer); const size = `${fmt(bb.w)} × ${fmt(bb.h)} mm`;
  const rows = [
    ['Front plate', `Clear cast acrylic, ${p.plateT} mm`, 1, size],
    ['Back plate', `Clear cast acrylic, ${p.plateT} mm`, 1, size],
    ['Spacer', `Acrylic, ${p.spacerT} mm`, 1, size],
  ];
  if (cs.analysis) {
    const a = cs.analysis, n = a.screws.length;
    rows.push([`Screw`, `${p.screw} × ${a.length} mm pan head`, n, `${a.spec.hole} mm holes`], ['Nut', `${p.screw} hex nut`, n, ''], ['Washer', `${p.screw} nylon washer`, 2 * n, 'Under the head and the nut']);
  } else rows.push(['Solvent cement', 'Acrylic solvent cement', 1, 'With a needle applicator']);
  if (p.keyring) rows.push(['Keyring', 'Split ring or jump ring', 1, `Fits a ${p.keyringD} mm hole`]);
  rows.push(['Your object', `${p.figT} mm thick`, 1, '']);
  return rows;
};
P2.updateBOM = function () {
  const rows = P2.bomRows(); const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  $('#bom').innerHTML = '<thead><tr><th>Part</th><th>Spec</th><th style="text-align:right">Qty</th></tr></thead><tbody>' + rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}${r[3] ? `<br><span class="hint">${esc(r[3])}</span>` : ''}</td><td class="q">${r[2]}</td></tr>`).join('') + '</tbody>';
};
// layout view
P2.fitLayout = function () {
  if (!P2.cs) return; const r = cv2.getBoundingClientRect(); const bb = Geo.bbox(P2.cs.lines.outer);
  const s = Math.min(r.width / (bb.w + 20), r.height / (bb.h + 20)) * 0.9 || 1; P2.lv = { s, tx: r.width / 2 - bb.cx * s, ty: r.height / 2 - bb.cy * s };
};
P2.drawLayout = function () {
  const dpr = window.devicePixelRatio || 1; const r = cv2.getBoundingClientRect();
  cv2.width = Math.max(1, Math.round(r.width * dpr)); cv2.height = Math.max(1, Math.round(r.height * dpr));
  const c = ctx2; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv2.width, cv2.height);
  const T = (x, y) => [(x * P2.lv.s + P2.lv.tx) * dpr, (y * P2.lv.s + P2.lv.ty) * dpr];
  drawMatGrid(c, cv2.width, cv2.height, (x, y) => [x * P2.lv.s + P2.lv.tx, y * P2.lv.s + P2.lv.ty], 1, P2.lv.s, dpr);
  const cs = P2.cs; if (!cs) return;
  const cut = css('--cut'), eng = css('--engrave'), ink = css('--mat-ink');
  const poly = (l, stroke, w, fill, dash) => { if (!l) return; c.beginPath(); l.forEach(([x, y], i) => { const [X, Y] = T(x, y); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.setLineDash(dash || []); c.strokeStyle = stroke; c.lineWidth = w * dpr; c.stroke(); c.setLineDash([]); } };
  poly(cs.lines.outer, null, 0, 'rgba(225,240,250,0.10)');
  poly(cs.lines.figure, null, 0, 'rgba(120,200,140,0.22)');
  if (cs.analysis) poly(cs.analysis.path, ink, 1, null, [5 * dpr, 4 * dpr]);
  if (cs.grooves) { poly(cs.grooves.inner, eng, 1.5); poly(cs.grooves.outer, eng, 1.5); }
  poly(cs.lines.outer, cut, 2); poly(cs.lines.cavity, cut, 2);
  for (const h of cs.holes) {
    const [X, Y] = T(h.x, h.y); c.beginPath(); c.arc(X, Y, Math.max(1.5 * dpr, h.d / 2 * P2.lv.s * dpr), 0, Math.PI * 2); c.strokeStyle = cut; c.lineWidth = 2 * dpr; c.stroke();
    if (h.kind === 'screw') { c.fillStyle = ink; c.font = `600 ${11 * dpr}px Archivo, sans-serif`; c.fillText(String(h.n), X + (h.d / 2 * P2.lv.s + 4) * dpr, Y - 4 * dpr); }
  }
  $('#legEng').hidden = !cs.grooves; $('#legScrew').hidden = !cs.analysis;
};
(() => {
  let st = null; const pts = new Map();
  cv2.addEventListener('pointerdown', e => { cv2.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); st = { x: e.clientX, y: e.clientY, v: { ...P2.lv } }; });
  cv2.addEventListener('pointermove', e => { if (!pts.has(e.pointerId) || !st) return; P2.lv = { ...st.v, tx: st.v.tx + e.clientX - st.x, ty: st.v.ty + e.clientY - st.y }; P2.drawLayout(); });
  const up = e => { pts.delete(e.pointerId); st = null; };
  cv2.addEventListener('pointerup', up); cv2.addEventListener('pointercancel', up);
  cv2.addEventListener('wheel', e => { e.preventDefault(); const r = cv2.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const k = Math.exp(-e.deltaY * 0.0015); const v = P2.lv; P2.lv = { s: v.s * k, tx: x - (x - v.tx) * k, ty: y - (y - v.ty) * k }; P2.drawLayout(); }, { passive: false });
})();
// exports
$$('[data-exp2]').forEach(b => b.addEventListener('click', () => P2.export(b.dataset.exp2)));
P2.export = function (kind) {
  const cs = P2.cs, p = P2.p; if (!cs) { toast('There’s no case to export yet.'); return; }
  const circles = cs.holes.map(h => ({ x: h.x, y: h.y, d: h.d }));
  if (kind === 'laser') {
    const bb = Geo.bbox(cs.lines.outer); const dx = bb.w + 5;
    const sh = (l, o) => l.map(([x, y]) => [x + o, y]); const shc = (cc, o) => cc.map(c => ({ ...c, x: c.x + o }));
    const plates = [{ layer: 'CUT', id: 'plates', loops: [cs.lines.outer, sh(cs.lines.outer, dx)], circles: circles.concat(shc(circles, dx)) }];
    const spacer = [{ layer: 'CUT', id: 'spacer-cut', loops: [cs.lines.outer, cs.lines.cavity], circles }];
    if (cs.grooves) spacer.push({ layer: 'ENGRAVE', id: 'spacer-groove', loops: [cs.grooves.inner, cs.grooves.outer] });
    const pn = `front-and-back-plates_${p.plateT}mm_acrylic`, sn = `spacer_${p.spacerT}mm_acrylic`;
    const readme = [`Laser files for your acrylic case`, ``, `Units: millimetres. Red = cut. Blue = engrave.`, `Case size: ${fmt(bb.w)} x ${fmt(bb.h)} mm.`, ``,
      `${pn}: cut once from ${p.plateT} mm clear acrylic. This sheet holds both plates.`,
      `${sn}: cut from ${p.spacerT} mm acrylic.` + (cs.grooves ? ` Engrave the blue groove first, ${p.grooveDepth} mm deep, then flip the spacer and engrave the other face. Cut last.` : ''),
      ``, `Cut holes and inner shapes before outer outlines so parts don't shift.`, `Kerf (about 0.1-0.2 mm) makes holes slightly larger and outlines slightly smaller. That only adds clearance.`,
      cs.analysis ? `Hardware: ${cs.analysis.screws.length} x ${p.screw} x ${cs.analysis.length} mm screws, nuts and ${2 * cs.analysis.screws.length} washers.` : `Join with acrylic solvent cement applied from the outer edge.`].join('\n');
    saveFile('acrylic-case-laser-files.zip', makeZip([
      { name: pn + '.dxf', data: toDXF(plates) }, { name: pn + '.svg', data: toSVG(plates) },
      { name: sn + '.dxf', data: toDXF(spacer) }, { name: sn + '.svg', data: toSVG(spacer) },
      { name: 'README.txt', data: readme }]));
  } else if (kind === 'stl') {
    const m = P2.meshes; const files = [{ name: 'back_plate.stl', data: toSTL(m.back, 'back plate') }, { name: 'spacer.stl', data: toSTL(m.spacer, 'spacer') }, { name: 'front_plate.stl', data: toSTL(m.front, 'front plate') }, { name: 'object_reference.stl', data: toSTL(m.figure, 'object') }];
    if (m.screws) files.push({ name: 'screws_reference.stl', data: toSTL(m.screws, 'screws') });
    saveFile('acrylic-case-3d-parts.zip', makeZip(files));
  } else if (kind === 'csv') {
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    saveFile('acrylic-case-parts.csv', ['Part,Spec,Qty,Notes', ...P2.bomRows().map(r => [r[0], r[1], r[2], r[3]].map(q).join(','))].join('\n') + '\n');
  }
};

/* ================= init ================= */
$('#zoomIn').addEventListener('click', () => zoomBy(1.25));
$('#zoomOut').addEventListener('click', () => zoomBy(0.8));
$('#zoomFit').addEventListener('click', () => { if (phase === 1) P1.fit(); else { P2.fitLayout(); P2.drawLayout(); } });
function zoomBy(k) {
  const r = stage.getBoundingClientRect(); const x = r.width / 2, y = r.height / 2;
  if (phase === 1) { const v = P1.view; P1.view = { s: v.s * k, tx: x - (x - v.tx) * k, ty: y - (y - v.ty) * k }; P1.draw(); }
  else { const v = P2.lv; P2.lv = { s: v.s * k, tx: x - (x - v.tx) * k, ty: y - (y - v.ty) * k }; P2.drawLayout(); }
}
new ResizeObserver(() => { if (phase === 1) P1.resize(); else P2.show(); }).observe(stage);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { P1.draw(); if (P2.cs) P2.show(); });
setPhase(1);
