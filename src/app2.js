/* ================= 3D viewer (plain WebGL) ================= */
class Viewer {
  constructor(cv) {
    this.cv = cv; const gl = cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true }); this.gl = gl; this.items = [];
    this.yaw = -1.05; this.pitch = 0.75; this.roll = 0; this.dist = 250; this.target = [0, 0, 2]; this.explode = 0.35; this.ok = !!gl;
    if (!gl) return;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec3 p;attribute vec3 n;uniform mat4 M;uniform vec3 off;varying vec3 vn;void main(){vn=n;gl_Position=M*vec4(p+off,1.0);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec3 vn;uniform vec4 col;uniform vec3 L;uniform float lit;void main(){float d=abs(dot(normalize(vn),L));float k=mix(1.0,0.45+0.55*d,lit);gl_FragColor=vec4(col.rgb*k*col.a,col.a);}'));
    gl.linkProgram(pr); this.pr = pr;
    this.loc = { p: gl.getAttribLocation(pr, 'p'), n: gl.getAttribLocation(pr, 'n'), M: gl.getUniformLocation(pr, 'M'), off: gl.getUniformLocation(pr, 'off'), col: gl.getUniformLocation(pr, 'col'), L: gl.getUniformLocation(pr, 'L'), lit: gl.getUniformLocation(pr, 'lit') };
    // photo program: a textured quad (premultiplied alpha)
    const pq = gl.createProgram();
    gl.attachShader(pq, sh(gl.VERTEX_SHADER, 'attribute vec3 p;attribute vec2 uv;uniform mat4 M;uniform vec3 off;varying vec2 vu;void main(){vu=uv;gl_Position=M*vec4(p+off,1.0);}'));
    gl.attachShader(pq, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 vu;uniform sampler2D tex;uniform float a;void main(){vec4 c=texture2D(tex,vu);if(c.a<0.02)discard;gl_FragColor=c*a;}'));
    gl.linkProgram(pq); this.pq = pq;
    this.qloc = { p: gl.getAttribLocation(pq, 'p'), uv: gl.getAttribLocation(pq, 'uv'), M: gl.getUniformLocation(pq, 'M'), off: gl.getUniformLocation(pq, 'off'), tex: gl.getUniformLocation(pq, 'tex'), a: gl.getUniformLocation(pq, 'a') };
    this.photo = null; this.showPhoto = true;
    /* Navigation (Revit style):
       middle drag = pan, Shift + middle drag = orbit, wheel = zoom at the cursor, double-click middle = zoom to fit.
       Also: left drag = orbit, Shift + left or right drag = pan (for trackpads), two-finger pinch = zoom, double-click = fit. */
    const pts = new Map(); let st = null;
    const begin = (e, mode) => { st = { mode, yaw: this.yaw, pitch: this.pitch, dist: this.dist, target: this.target.slice(), p: [e.clientX, e.clientY], d: pts.size === 2 ? this.pinch(pts) : 0 }; };
    let lastMid = 0;
    cv.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); // stop autoscroll
    cv.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      try { cv.setPointerCapture(e.pointerId); } catch (_) {} pts.set(e.pointerId, [e.clientX, e.clientY]);
      let mode;
      if (e.button === 1) {
        e.preventDefault();
        const now = performance.now(); if (now - lastMid < 350) { lastMid = 0; this.resetView(); this.render(); pts.delete(e.pointerId); st = null; return; } lastMid = now;
        mode = e.shiftKey ? 'orbit' : 'pan';
      } else if (e.button === 2) mode = 'pan';
      else mode = e.shiftKey ? 'pan' : 'orbit';
      begin(e, mode);
    });
    cv.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !st) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { if (!st.d) st.d = this.pinch(pts); this.dist = Math.max(1, st.dist * st.d / this.pinch(pts)); }
      else {
        // Shift can be pressed or released mid-drag with the middle button, as in Revit.
        const mode = e.buttons & 4 ? (e.shiftKey ? 'orbit' : 'pan') : st.mode;
        if (mode !== st.mode) { begin(e, mode); return; }
        const dx = e.clientX - st.p[0], dy = e.clientY - st.p[1];
        if (mode === 'pan') {
          const { x, y } = this.camAxes(); const r = cv.getBoundingClientRect();
          const k = 2 * st.dist * Math.tan(0.3) / Math.max(1, r.height);
          this.target = [0, 1, 2].map(i => st.target[i] - x[i] * dx * k + y[i] * dy * k);
        } else { this.yaw = st.yaw - dx * 0.008; this.pitch = Math.max(-1.45, Math.min(1.5, st.pitch + dy * 0.008)); }
      }
      this.render();
    });
    const up = e => {
      if (st && pts.size === 1 && e.button === 0 && this.onClick && Math.hypot(e.clientX - st.p[0], e.clientY - st.p[1]) < 5) { const z = this.clickZ ? this.clickZ() : this.target[2]; const h = this.pickPlane(e.clientX, e.clientY, z); if (h && this.onClick(h[0], -h[1])) { this.yaw = st.yaw; this.pitch = st.pitch; this.target = st.target; this.render(); } }
      pts.delete(e.pointerId); if (pts.size) { const [q] = pts.values(); begin({ clientX: q[0], clientY: q[1] }, 'orbit'); } else st = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const g = wheelGesture(e);
      if (g.pan) { // two-finger drag pans, like the middle button
        const { x, y } = this.camAxes(); const r = cv.getBoundingClientRect(); const s = 2 * this.dist * Math.tan(0.3) / Math.max(1, r.height);
        this.target = this.target.map((t, i) => t - x[i] * g.pan[0] * s + y[i] * g.pan[1] * s); this.render(); return;
      }
      const k = 1 / g.zoom;
      const hit = this.pickPlane(e.clientX, e.clientY);
      if (hit) this.target = this.target.map((t, i) => hit[i] + (t - hit[i]) * k);
      this.dist *= k; this.render();
    }, { passive: false });
    cv.addEventListener('dblclick', () => { this.resetView(); this.render(); });
  }
  eye() { const t = this.target, cp = Math.cos(this.pitch); return [t[0] + this.dist * cp * Math.cos(this.yaw), t[1] + this.dist * cp * Math.sin(this.yaw), t[2] + this.dist * Math.sin(this.pitch)]; }
  camAxes() { // x = screen right, y = screen up, z = towards the eye
    const e = this.eye(), t = this.target; let z = [e[0] - t[0], e[1] - t[1], e[2] - t[2]]; let l = Math.hypot(...z); z = z.map(v => v / l);
    let x = [-z[1], z[0], 0]; l = Math.hypot(...x) || 1; x = x.map(v => v / l);
    const y0 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    // roll turns the picture about the line of sight
    const c = Math.cos(this.roll), s = Math.sin(this.roll);
    return { x: [0, 1, 2].map(i => c * x[i] - s * y0[i]), y: [0, 1, 2].map(i => s * x[i] + c * y0[i]), z };
  }
  viewMat(e) { const { x, y, z } = this.camAxes(); const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -d(x, e), -d(y, e), -d(z, e), 1]; }
  pickPlane(cx, cy, zp) { // where the cursor ray meets a horizontal plane (default: through the target)
    const r = this.cv.getBoundingClientRect(); if (!r.width || !r.height) return null;
    const { x, y, z } = this.camAxes(); const e = this.eye(); const th = Math.tan(0.3);
    const u = ((cx - r.left) / r.width * 2 - 1) * th * r.width / r.height, v = (1 - (cy - r.top) / r.height * 2) * th;
    const d = [0, 1, 2].map(i => x[i] * u + y[i] * v - z[i]);
    if (Math.abs(d[2]) < 1e-4) return null; const s = ((zp === undefined ? this.target[2] : zp) - e[2]) / d[2];
    if (!(s > 0) || s > this.dist * 50) return null; return d.map((di, i) => e[i] + di * s);
  }
  setPhoto(ph) { // ph: { canvas, x0, y0, x1, y1 (mm, y down), z, layer } or null
    if (!this.ok) return; const gl = this.gl;
    if (this.photo) { gl.deleteTexture(this.photo.tex); gl.deleteBuffer(this.photo.bp); gl.deleteBuffer(this.photo.bu); }
    this.photo = null; if (!ph) return;
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ph.canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(w => gl.texParameteri(gl.TEXTURE_2D, w, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const { x0, y0, x1, y1, z } = ph;
    const P = new Float32Array([x0, -y0, z, x1, -y0, z, x1, -y1, z, x0, -y0, z, x1, -y1, z, x0, -y1, z]);
    const U = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    const bp = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bp); gl.bufferData(gl.ARRAY_BUFFER, P, gl.STATIC_DRAW);
    const bu = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bu); gl.bufferData(gl.ARRAY_BUFFER, U, gl.STATIC_DRAW);
    this.photo = { tex, bp, bu, layer: ph.layer, zc: z };
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
    const first = !this.bb; this.bb = bb; if (first) this.needFit = true;
  }
  resetView() { if (!this.bb) return; const r = this.cv.getBoundingClientRect(); const asp = r.width > 0 && r.height > 0 ? r.width / r.height : 1; this.dist = Math.max(this.bb.w, this.bb.h) * 2.1 / Math.min(1, asp * 0.75); this.target = [this.bb.cx, -this.bb.cy, 2]; this.yaw = -1.05; this.pitch = 0.75; this.roll = 0; }
  render() {
    if (!this.ok || this.cv.hidden) return; const gl = this.gl; const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect(); const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    if (this.needFit && r.width > 0) { this.needFit = false; this.resetView(); }
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.items.length) return;
    gl.useProgram(this.pr); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE);
    const t = this.target; const eye = this.eye();
    const M = mul(perspective(0.6, W / H, this.dist * 0.02, this.dist * 20), this.viewMat(eye));
    gl.uniformMatrix4fv(this.loc.M, false, M);
    const Ld = [0.35, -0.45, 0.82]; const ll = Math.hypot(...Ld); gl.uniform3f(this.loc.L, Ld[0] / ll, Ld[1] / ll, Ld[2] / ll);
    const ex = this.explode * Math.max(8, (this.bb ? Math.max(this.bb.w, this.bb.h) : 100) * 0.12); this.ex = ex;
    const zOf = it => it.zc + ex * it.layer; const dEye = it => Math.hypot(t[0] - eye[0], t[1] - eye[1], zOf(it) - eye[2]);
    const opaque = this.items.filter(i => i.alpha >= 1), clear = this.items.filter(i => i.alpha < 1).sort((a, b) => dEye(b) - dEye(a));
    this.drawItems(opaque, ex); this.drawItems(clear, ex); this.drawPhoto(M, ex);
    gl.depthMask(true);
  }
  drawPhoto(M, ex) {
    const ph = this.photo; if (!ph || !this.showPhoto) return; const gl = this.gl, L = this.qloc;
    gl.useProgram(this.pq); gl.uniformMatrix4fv(L.M, false, M); gl.uniform3f(L.off, 0, 0, ex * ph.layer); gl.uniform1f(L.a, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ph.tex); gl.uniform1i(L.tex, 0);
    gl.enableVertexAttribArray(L.p); gl.bindBuffer(gl.ARRAY_BUFFER, ph.bp); gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(L.uv); gl.bindBuffer(gl.ARRAY_BUFFER, ph.bu); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 0, 0);
    gl.depthMask(true); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(L.uv); gl.useProgram(this.pr);
  }
  drawItems(order, ex) {
    const gl = this.gl;
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
const cv2 = $('#cv2'), ctx2 = cv2.getContext('2d'); const viewer = new Viewer($('#cv3'));
// View cube: shows the camera's orientation.
//  - click a face, edge or corner to look from there
//  - drag the cube to orbit
//  - when looking straight at a face: the triangles step to the next face, the curved arrows turn the view 90 degrees
const Cube = (() => {
  const cv = $('#cube'); const S = 120; let hover = null, anim = null, token = 0, drag = null;
  // viewer space: x right, y = back of the object, z = up
  const F = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], t: 'TOP' }, { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0], t: 'BOTTOM' },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], t: 'FRONT' }, { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1], t: 'BACK' },
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], t: 'RIGHT' }, { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1], t: 'LEFT' },
  ];
  const ARROWS = [
    { id: 'up', x: 60, y: 9, rot: 0 }, { id: 'down', x: 60, y: 111, rot: Math.PI }, { id: 'left', x: 9, y: 60, rot: -Math.PI / 2 }, { id: 'right', x: 111, y: 60, rot: Math.PI / 2 },
    { id: 'ccw', x: 93, y: 12 }, { id: 'cw', x: 111, y: 28 },
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const geom = () => { const ax = viewer.camAxes(); const k = S * 0.24; const P = w => [S / 2 + dot(w, ax.x) * k, S / 2 - dot(w, ax.y) * k]; return { ax, P }; };
  const aligned = () => Math.max(...viewer.camAxes().z.map(Math.abs)) > 0.995; // looking straight at a face
  const cell = a => a > 0.45 ? 1 : a < -0.45 ? -1 : 0; // face split into 3 x 3: corners, edges, centre
  function hit(mx, my) {
    if (aligned()) for (const a of ARROWS) if (Math.hypot(mx - a.x, my - a.y) < 10) return { arrow: a.id };
    const { ax, P } = geom(); let best = null;
    for (const f of F) {
      const vis = dot(f.n, ax.z); if (vis < 0.05) continue;
      const c = P(f.n), pu = P([f.n[0] + f.u[0], f.n[1] + f.u[1], f.n[2] + f.u[2]]), pv = P([f.n[0] + f.v[0], f.n[1] + f.v[1], f.n[2] + f.v[2]]);
      const U = [pu[0] - c[0], pu[1] - c[1]], V = [pv[0] - c[0], pv[1] - c[1]], d = U[0] * V[1] - U[1] * V[0]; if (Math.abs(d) < 1e-6) continue;
      const dx = mx - c[0], dy = my - c[1]; const a = (dx * V[1] - dy * V[0]) / d, b = (U[0] * dy - U[1] * dx) / d;
      if (Math.abs(a) <= 1 && Math.abs(b) <= 1 && (!best || vis > best.vis)) best = { f, a: cell(a), b: cell(b), vis };
    }
    return best;
  }
  const dirOf = h => [0, 1, 2].map(i => h.f.n[i] + h.a * h.f.u[i] + h.b * h.f.v[i]);
  const hoverKey = h => !h ? null : h.arrow ? { arrow: h.arrow } : { dir: dirOf(h) };
  function draw() {
    if ($('#cubeBox').hidden || !viewer.ok) return;
    const dpr = window.devicePixelRatio || 1; if (cv.width !== S * dpr) { cv.width = S * dpr; cv.height = S * dpr; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, S, S);
    const { ax, P } = geom(); const ink = '#1E2A24', panel = '#EEF2F0', line = '#8C9A93', acc = css('--accent') || '#3a8';
    const faces = F.map(f => ({ f, vis: dot(f.n, ax.z) })).filter(o => o.vis > 0.02).sort((p, q) => p.vis - q.vis);
    for (const { f, vis } of faces) {
      const pt = (a, b) => P([f.n[0] + a * f.u[0] + b * f.v[0], f.n[1] + a * f.u[1] + b * f.v[1], f.n[2] + a * f.u[2] + b * f.v[2]]);
      const quad = (a0, b0, a1, b1) => { c.beginPath(); [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].forEach(([a, b], i) => { const [x, y] = pt(a, b); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); };
      quad(-1, -1, 1, 1); c.globalAlpha = 0.96; c.fillStyle = panel; c.fill(); c.globalAlpha = 0.22 * (1 - vis); c.fillStyle = '#000'; c.fill(); c.globalAlpha = 1;
      c.lineWidth = 1; c.strokeStyle = line; c.stroke();
      if (hover && hover.dir) { // highlight the hovered face, edge or corner wherever it shows on this face
        const dir = hover.dir; const fa = dot(dir, f.u), fb = dot(dir, f.v), fn = dot(dir, f.n);
        if (fn > 0) { const r = v => v > 0 ? [0.45, 1] : v < 0 ? [-1, -0.45] : [-0.45, 0.45]; const [a0, a1] = r(fa), [b0, b1] = r(fb); quad(a0, b0, a1, b1); c.globalAlpha = 0.55; c.fillStyle = acc; c.fill(); c.globalAlpha = 1; }
      }
      const o = pt(0, 0), pu = pt(1, 0), pv = pt(0, -1); const k = 1 / 100;
      c.save(); c.setTransform(dpr * (pu[0] - o[0]) * k, dpr * (pu[1] - o[1]) * k, dpr * (pv[0] - o[0]) * k, dpr * (pv[1] - o[1]) * k, dpr * o[0], dpr * o[1]);
      c.fillStyle = ink; c.globalAlpha = 0.85; c.font = `700 ${f.t.length > 5 ? 26 : 30}px Archivo, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(f.t, 0, 2); c.restore();
    }
    const O = P([-1.25, -1.25, -1.25]); [[[1, 0, 0], '#E0372A'], [[0, 1, 0], '#3BB273'], [[0, 0, 1], '#3D7FE0']].forEach(([d, col]) => { const q = P([-1.25 + d[0] * 0.8, -1.25 + d[1] * 0.8, -1.25 + d[2] * 0.8]); c.beginPath(); c.moveTo(O[0], O[1]); c.lineTo(q[0], q[1]); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); });
    if (aligned()) for (const a of ARROWS) {
      const on = hover && hover.arrow === a.id; c.save(); c.translate(a.x, a.y);
      c.fillStyle = on ? acc : panel; c.strokeStyle = on ? acc : line; c.lineWidth = 1.5;
      if (a.rot !== undefined) { c.rotate(a.rot); c.beginPath(); c.moveTo(0, -6); c.lineTo(7, 4); c.lineTo(-7, 4); c.closePath(); c.globalAlpha = 0.95; c.fill(); c.globalAlpha = 1; c.strokeStyle = on ? acc : ink; c.lineWidth = 1; c.stroke(); }
      else { // curved arrow; ccw turns the picture anticlockwise
        const cw = a.id === 'cw'; c.strokeStyle = on ? acc : panel; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, 6, cw ? -2.6 : -0.55, cw ? 0.55 : 2.6, !cw ? false : false); c.stroke();
        const ea = cw ? 0.55 : -0.55 + Math.PI; // arrowhead at the end of the arc
        const hx = 6 * Math.cos(cw ? 0.55 : 2.6), hy = 6 * Math.sin(cw ? 0.55 : 2.6); const tx = cw ? -Math.sin(0.55) : -Math.sin(2.6), ty = cw ? Math.cos(0.55) : Math.cos(2.6);
        const sgn = cw ? 1 : -1; c.beginPath(); c.moveTo(hx + tx * 4 * sgn, hy + ty * 4 * sgn); c.lineTo(hx + Math.cos(ea - 1.6) * 3.5, hy + Math.sin(ea - 1.6) * 3.5); c.lineTo(hx - Math.cos(ea - 1.6) * 3.5, hy - Math.sin(ea - 1.6) * 3.5); c.closePath(); c.fillStyle = on ? acc : panel; c.fill();
      }
      c.restore();
    }
  }
  const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
  function animateTo(to) {
    const from = { yaw: viewer.yaw, pitch: viewer.pitch, roll: viewer.roll, dist: viewer.dist, target: viewer.target.slice() };
    const t0 = performance.now(), T = 380; if (anim) cancelAnimationFrame(anim);
    const my = ++token; let done = false;
    const step = now => {
      if (my !== token || done) return; const s = Math.min(1, (now - t0) / T), e = s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2; const m = (a, b) => a + (b - a) * e;
      viewer.yaw = m(from.yaw, to.yaw); viewer.pitch = m(from.pitch, to.pitch); viewer.roll = m(from.roll, to.roll); viewer.dist = m(from.dist, to.dist); viewer.target = from.target.map((v, i) => m(v, to.target[i]));
      viewer.render(); done = s >= 1; anim = done ? null : requestAnimationFrame(step);
    };
    if (document.hidden) { step(t0 + T); return; }
    anim = requestAnimationFrame(step);
    setTimeout(() => { if (my === token && !done) { cancelAnimationFrame(anim); step(t0 + T); } }, T + 250); // finish even if frames are throttled
  }
  function snap(dir) {
    const l = Math.hypot(...dir); const d = dir.map(v => v / l); const lim = Math.PI / 2 - 0.002;
    const pitch = Math.max(-lim, Math.min(lim, Math.asin(d[2]))); const yaw = Math.hypot(d[0], d[1]) < 1e-6 ? -Math.PI / 2 : Math.atan2(d[1], d[0]);
    const keep = { yaw: viewer.yaw, pitch: viewer.pitch, roll: viewer.roll, dist: viewer.dist, target: viewer.target.slice() };
    viewer.resetView(); const fit = { dist: viewer.dist, target: viewer.target.slice() }; Object.assign(viewer, keep);
    animateTo({ yaw: keep.yaw + angDiff(keep.yaw, yaw), pitch, roll: keep.roll + angDiff(keep.roll, 0), ...fit });
  }
  function arrow(id) {
    const { x, y } = viewer.camAxes();
    if (id === 'cw' || id === 'ccw') { animateTo({ yaw: viewer.yaw, pitch: viewer.pitch, roll: viewer.roll + (id === 'cw' ? -1 : 1) * Math.PI / 2, dist: viewer.dist, target: viewer.target.slice() }); return; }
    const r = v => v.map(Math.round); // the neighbouring face in that screen direction
    snap(r({ up: y, down: y.map(v => -v), left: x.map(v => -v), right: x }[id]));
  }
  const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { if (e.button !== 0) return; try { cv.setPointerCapture(e.pointerId); } catch (_) {} drag = { x: e.clientX, y: e.clientY, yaw: viewer.yaw, pitch: viewer.pitch, moved: false }; });
  cv.addEventListener('pointermove', e => {
    if (drag) { // drag the cube to orbit
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) { drag.moved = true; token++; if (anim) cancelAnimationFrame(anim); hover = null; }
      const lim = Math.PI / 2 - 0.002; viewer.yaw = drag.yaw - dx * 0.012; viewer.pitch = Math.max(-lim, Math.min(lim, drag.pitch + dy * 0.012)); viewer.render(); return;
    }
    const nh = hoverKey(hit(...local(e))); if (JSON.stringify(nh) !== JSON.stringify(hover)) { hover = nh; draw(); }
  });
  const end = e => {
    if (!drag) return; const d = drag; drag = null;
    if (d.moved || e.type === 'pointercancel') return;
    const h = hit(...local(e)); if (!h) return;
    if (h.arrow) arrow(h.arrow); else snap(dirOf(h));
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!drag) { hover = null; draw(); } });
  $('#cubeHome').addEventListener('click', () => snap([Math.cos(-1.05) * Math.cos(0.75), Math.sin(-1.05) * Math.cos(0.75), Math.sin(0.75)]));
  return { draw, snap, hit, arrow, aligned };
})();
{ const baseRender = viewer.render.bind(viewer); viewer.render = () => { baseRender(); Cube.draw(); }; }
viewer.onClick = (x, y) => { if (!P2.placing) return false; P2.placeKeyring(x, y); return true; };
viewer.clickZ = () => P2.p ? P2.p.plateT + P2.p.spacerT + (viewer.ex || 0) : 0;
const viewSeg = seg('#viewSeg', v => { P2.view = v; P2.show(); });
$('#explode').addEventListener('input', () => { viewer.explode = +$('#explode').value; viewer.render(); });
$('#showPhoto').addEventListener('change', () => { viewer.showPhoto = $('#showPhoto').checked; viewer.render(); });
const joinSeg = seg('#joinSeg', v => { $('#noneRows').hidden = v !== 'none'; $('#screwRows').hidden = v !== 'screws'; $('#solventRows').hidden = v !== 'solvent'; P2.recompute(); });
P2.keyPos = null; // where the keyring hole sits, as a fraction round the window edge; null until the user places it
$('#keyring').addEventListener('change', () => { const on = $('#keyring').checked; $('#keyRows').hidden = !on; P2.setPlacing(on && P2.keyPos === null); P2.recompute(); });
// Keyring placement: click the button, then click the case in either view.
P2.placing = false;
P2.setPlacing = function (on) {
  P2.placing = on; $('#keyPlace').setAttribute('aria-pressed', String(on)); $('#keyPlace').textContent = on ? 'Cancel' : P2.keyPos === null ? 'Place the hole' : 'Move the hole';
  $('#keyHint').textContent = on ? 'Click where you want the hole on the 3D model or the cut layout. It goes on the nearest edge. Esc cancels.' : P2.keyPos === null ? 'The hole isn’t placed yet.' : 'The hole is placed. Click Move the hole to put it somewhere else.';
  $('#cv2').style.cursor = $('#cv3').style.cursor = on ? 'crosshair' : '';
};
$('#keyPlace').addEventListener('click', () => P2.setPlacing(!P2.placing));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && P2.placing) P2.setPlacing(false); });
P2.placeKeyring = function (x, y) { // x, y in case mm, y down
  if (!P2.cs || !P2.cs.lines.cavity) return;
  P2.keyPos = CaseGen.edgeParam(P2.cs.lines.cavity, x, y); P2.setPlacing(false); P2.recompute();
};
const recomputeDeb = debounce(() => P2.recompute(), 400);
['#figT', '#clear', '#border', '#plateT', '#spacerT', '#cornerR', '#keyD', '#minScrews', '#edge', '#gOff', '#gW', '#gD'].forEach(id => $(id).addEventListener('input', recomputeDeb));
['#screw'].forEach(id => $(id).addEventListener('change', () => P2.recompute()));
$('#cbore').addEventListener('change', () => { $('#cboreHint').hidden = !$('#cbore').checked; P2.recompute(); });
$('#toOutline').addEventListener('click', () => setPhase(1));
P2.getFig = function () {
  if (!P1.line || !P1.mmPerPx) { P2.figOff = null; return null; }
  const lp = P1.line; const b = Geo.bbox(lp); P2.figOff = [b.cx, b.cy];
  return Geo.resample(lp.map(([x, y]) => [x - b.cx, y - b.cy]), 0.3);
};
P2.params = () => ({
  figT: num('#figT'), clear: Math.max(0, num('#clear')), border: Math.max(2, num('#border')), plateT: Math.max(0.5, num('#plateT')), spacerT: Math.max(0.5, num('#spacerT')), cornerR: Math.max(0, num('#cornerR')),
  keyring: $('#keyring').checked && P2.keyPos !== null, keyringD: Math.max(1.5, num('#keyD')), keyringPos: P2.keyPos || 0,
  join: joinSeg.value, screw: $('#screw').value, counterbore: $('#cbore').checked, minScrews: Math.max(2, Math.round(num('#minScrews'))), edge: Math.max(0.5, num('#edge')),
  grooveOffset: Math.max(0.3, num('#gOff')), grooveWidth: Math.max(0.2, num('#gW')), grooveDepth: Math.max(0.1, num('#gD')),
});
P2.enter = function () {
  if (!(P1.line && P1.mmPerPx)) $('#srcHint').textContent = 'Nothing traced yet. Set the scale and trace an outline in the Outline tab.';
  if (P2.dirty) P2.recompute(); else P2.show();
};
P2.show = function () {
  const has = !!P2.cs;
  $('#empty2').hidden = has; $('#cv2').hidden = !has || P2.view !== 'layout'; $('#cv3').hidden = !has || P2.view !== '3d';
  $('#explodeBox').hidden = P2.view !== '3d'; $('#navHint').hidden = $('#cubeBox').hidden = !has || P2.view !== '3d'; if (P2.view !== '3d') $('#photoBox').hidden = true; else if (has) $('#photoBox').hidden = !viewer.photo; $('#legend').hidden = !has || P2.view !== 'layout'; $('#tools').hidden = P2.view === '3d' && has;
  if (has && P2.view === '3d') { if (!viewer.ok) { toast('3D preview needs WebGL, which isn’t available here. Showing the cut layout.'); viewSeg.set('layout'); P2.view = 'layout'; return P2.show(); } viewer.render(); }
  if (has && P2.view === 'layout') { if (!P2.lvOK) { P2.fitLayout(); P2.lvOK = cv2.getBoundingClientRect().width > 0; } P2.drawLayout(); }
};
P2.recompute = function () {
  if (phase !== 2) { P2.dirty = true; return; }
  const fig = P2.getFig();
  if (!fig) { P2.cs = null; P2.show(); $('#analysis').hidden = true; $('#warnings').innerHTML = ''; $('#bom').innerHTML = ''; updateHud(); $('#srcHint').textContent = 'Nothing traced yet. Set the scale and trace an outline in the Outline tab.'; return; }
  P2.dirty = false;
  later(() => {
    const p = P2.params(); const cs = CaseGen.build(fig, p); const ms = CaseGen.meshes(cs, p);
    P2.cs = cs; P2.meshes = ms; P2.p = p;
    const bb = Geo.bbox(cs.lines.outer);
    const st = p.spacerT, pt = p.plateT;
    viewer.setItems([
      { mesh: ms.back, color: [0.80, 0.90, 0.98], alpha: 0.32, edge: [0.55, 0.72, 0.85, 0.7], layer: 0, zc: pt / 2 },
      { mesh: ms.figure, color: [0.90, 0.92, 0.91], alpha: 1, edge: [0.55, 0.60, 0.58, 0.5], layer: 1, zc: pt + p.figT / 2 },
      { mesh: ms.spacer, color: [0.42, 0.66, 0.90], alpha: 0.55, edge: [0.3, 0.5, 0.75, 0.8], layer: 1, zc: pt + st / 2 },
      { mesh: ms.front, color: [0.80, 0.90, 0.98], alpha: 0.32, edge: [0.55, 0.72, 0.85, 0.7], layer: 2, zc: pt * 1.5 + st },
      { mesh: ms.screwHeads, color: [0.62, 0.65, 0.69], alpha: 1, edge: [0, 0, 0, 0], layer: 2.6, zc: 2 * pt + st },
      { mesh: ms.screwNuts, color: [0.55, 0.58, 0.62], alpha: 1, edge: [0, 0, 0, 0], layer: -0.6, zc: 0 },
    ], bb);
    P2.updatePhoto(p);
    const key = Geo.bbox(fig).w.toFixed(1) + ',' + Geo.bbox(fig).h.toFixed(1); if (key !== P2.figKey) { P2.figKey = key; P2.lvOK = false; }
    const fb = Geo.bbox(cs.lines.figure); $('#srcHint').textContent = `Built from the traced outline, ${fmt(fb.w)} × ${fmt(fb.h)} mm. Edit it in the Outline tab.`;
    $('#t2sub').textContent = `${fmt(bb.w, 0)} × ${fmt(bb.h, 0)} mm`;
    P2.updateAnalysis(); P2.updateBOM(); P2.show(); updateHud();
  });
};
// A lightly shaded silhouette of the traced outline, laid on top of the object in the 3D view.
P2.silhouetteCanvas = function () {
  if (!P1.line || !P1.mmPerPx) return null;
  const b = Geo.bbox(P1.line), pad = 1, x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad;
  const k = Math.min(10, 2048 / Math.max(x1 - x0, y1 - y0)); // px per mm
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.round((x1 - x0) * k)); c.height = Math.max(2, Math.round((y1 - y0) * k));
  const x = c.getContext('2d'); x.beginPath();
  P1.line.forEach(([mx, my], i) => { const X = (mx - x0) * k, Y = (my - y0) * k; i ? x.lineTo(X, Y) : x.moveTo(X, Y); });
  x.closePath(); x.fillStyle = 'rgba(52, 78, 66, 0.62)'; x.fill();
  x.lineJoin = 'round'; x.lineCap = 'round'; x.lineWidth = Math.max(3, 0.8 * k); x.setLineDash([2.2 * k, 1.4 * k]); x.strokeStyle = 'rgba(12, 24, 18, 1)'; x.stroke(); x.setLineDash([]);
  return { canvas: c, x0, y0, x1, y1 };
};
P2.updatePhoto = function (p) {
  const ph = P2.figOff ? P2.silhouetteCanvas() : null;
  $('#photoBox').hidden = !ph;
  if (!ph) { viewer.setPhoto(null); return; }
  const [ox, oy] = P2.figOff;
  viewer.setPhoto({ canvas: ph.canvas, x0: ph.x0 - ox, y0: ph.y0 - oy, x1: ph.x1 - ox, y1: ph.y1 - oy, z: p.plateT + p.figT + 0.08, layer: 1 });
};
P2.updateAnalysis = function () {
  const cs = P2.cs, p = P2.p, box = $('#analysis'); box.hidden = !cs.analysis && !cs.grooves;
  if (!cs.analysis && !cs.grooves) { box.innerHTML = ''; $('#t3sub').textContent = 'Not yet'; }
  else if (cs.analysis) {
    const a = cs.analysis;
    box.innerHTML = `<dl><dt>Screws needed</dt><dd>${a.screws.length} × ${p.screw} × ${a.length} mm</dd><dt>Screw line around the window</dt><dd>${fmt(a.pathLength, 0)} mm</dd><dt>Longest gap between screws</dt><dd>${fmt(a.maxGap)} mm (allowed ${fmt(a.span, 0)} mm)</dd><dt>Thinnest material beside a hole</dt><dd>${fmt(a.minClear)} mm</dd><dt>Stack thickness</dt><dd>${fmt(a.stack)} mm</dd>${a.cb ? `<dt>Head pockets</dt><dd>⌀${fmt(a.cb.headD)} × ${fmt(a.cb.headDepth)} mm deep</dd><dt>Nut pockets</dt><dd>${fmt(2 * a.cb.nutR)} mm hex × ${fmt(a.cb.nutDepth)} mm deep</dd>` : ''}</dl><p class="hint" style="margin:8px 0 0">${a.screws.length} is the fewest that works. Each stretch of ${fmt(p.plateT)} mm plate between screws is treated as a beam clamped at both ends; with a ${fmt(p.border)} mm border it can span ${fmt(a.span, 0)} mm before a firm press opens the edge more than ${CaseGen.SPAN.delta} mm. The screws also surround the middle of the case so it can’t rock, and each hole has at least ${p.edge} mm of acrylic beside it.</p>`;
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
    if (a.cb) rows.push([`Screw`, `${p.screw} × ${a.length} mm pan head`, n, a.cb.trim ? `Cut to ${a.cb.trim} mm so the end sits flush` : 'Head sits flush in its pocket'], ['Nut', `${p.screw} hex nut`, n, 'Sits flush in its hex pocket']);
    else rows.push([`Screw`, `${p.screw} × ${a.length} mm pan head`, n, `${a.spec.hole} mm holes`], ['Nut', `${p.screw} hex nut`, n, ''], ['Washer', `${p.screw} nylon washer`, 2 * n, 'Under the head and the nut']);
  } else if (cs.grooves) rows.push(['Solvent cement', 'Acrylic solvent cement', 1, 'With a needle applicator']);
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
  if (cs.analysis && cs.analysis.cb) for (const s of cs.analysis.screws) { const [X, Y] = T(s.x, s.y); c.beginPath(); c.arc(X, Y, cs.analysis.cb.headD / 2 * P2.lv.s * dpr, 0, Math.PI * 2); c.strokeStyle = eng; c.lineWidth = 1.5 * dpr; c.stroke(); }
  $('#legEng').hidden = !cs.grooves && !(cs.analysis && cs.analysis.cb); $('#legScrew').hidden = !cs.analysis;
};
(() => {
  let st = null; const pts = new Map();
  cv2.addEventListener('pointerdown', e => { try { cv2.setPointerCapture(e.pointerId); } catch (_) {} pts.set(e.pointerId, [e.clientX, e.clientY]); st = { x: e.clientX, y: e.clientY, v: { ...P2.lv } }; });
  cv2.addEventListener('pointermove', e => { if (!pts.has(e.pointerId) || !st) return; P2.lv = { ...st.v, tx: st.v.tx + e.clientX - st.x, ty: st.v.ty + e.clientY - st.y }; P2.drawLayout(); });
  const up = e => {
    if (st && P2.placing && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 5) { const r = cv2.getBoundingClientRect(); P2.placeKeyring((e.clientX - r.left - P2.lv.tx) / P2.lv.s, (e.clientY - r.top - P2.lv.ty) / P2.lv.s); }
    pts.delete(e.pointerId); st = null;
  };
  cv2.addEventListener('pointerup', up); cv2.addEventListener('pointercancel', up);
  cv2.addEventListener('wheel', e => { e.preventDefault(); const r = cv2.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const g = wheelGesture(e); const v = P2.lv; if (g.pan) { P2.lv = { ...v, tx: v.tx + g.pan[0], ty: v.ty + g.pan[1] }; P2.drawLayout(); return; } const k = g.zoom; P2.lv = { s: v.s * k, tx: x - (x - v.tx) * k, ty: y - (y - v.ty) * k }; P2.drawLayout(); }, { passive: false });
})();
// exports
$$('[data-exp2]').forEach(b => b.addEventListener('click', () => P2.export(b.dataset.exp2)));
P2.export = function (kind) {
  const cs = P2.cs, p = P2.p; if (!cs) { toast('There’s no case to export yet.'); return; }
  const circles = cs.holes.map(h => ({ x: h.x, y: h.y, d: h.d }));
  const laserFiles = () => {
    const bb = Geo.bbox(cs.lines.outer); const dx = bb.w + 5;
    const sh = (l, o) => l.map(([x, y]) => [x + o, y]); const shc = (cc, o) => cc.map(c => ({ ...c, x: c.x + o }));
    let plates = [{ layer: 'CUT', id: 'plates', loops: [cs.lines.outer, sh(cs.lines.outer, dx)], circles: circles.concat(shc(circles, dx)) }];
    const cb = cs.analysis && cs.analysis.cb;
    if (cb) {
      // The back plate is drawn mirrored so its nut pockets can be engraved face up; flip it over to assemble.
      const mx = (x) => 2 * bb.cx - x + dx; const mir = l => l.map(([x, y]) => [mx(x), y]).reverse();
      const ring = (x, y, r, n, a0 = 0) => Array.from({ length: n }, (_, k) => [x + r * Math.cos(a0 + 2 * Math.PI * k / n), y + r * Math.sin(a0 + 2 * Math.PI * k / n)]);
      plates = [
        { layer: 'CUT', id: 'plates', loops: [cs.lines.outer, mir(cs.lines.outer)], circles: circles.concat(circles.map(c => ({ ...c, x: mx(c.x) }))) },
        { layer: 'ENGRAVE', id: 'head-pockets', loops: cs.analysis.screws.map(s => ring(s.x, s.y, cb.headD / 2, 48)) },
        { layer: 'ENGRAVE', id: 'nut-pockets', loops: cs.analysis.screws.map(s => ring(mx(s.x), s.y, cb.nutR, 6)) },
      ];
    }
    const spacer = [{ layer: 'CUT', id: 'spacer-cut', loops: [cs.lines.outer, cs.lines.cavity], circles }];
    if (cs.grooves) spacer.push({ layer: 'ENGRAVE', id: 'spacer-groove', loops: [cs.grooves.inner, cs.grooves.outer] });
    const pn = `front-and-back-plates_${p.plateT}mm_acrylic`, sn = `spacer_${p.spacerT}mm_acrylic`;
    const readme = [`Laser files for your acrylic case`, ``, `Units: millimetres. Red = cut. Blue = engrave.`, `Case size: ${fmt(bb.w)} x ${fmt(bb.h)} mm.`, ``,
      `${pn}: cut once from ${p.plateT} mm clear acrylic. This sheet holds both plates.` + (cb ? ` Left = front plate, right = back plate (drawn mirrored). Raster-engrave the blue pockets first: round head pockets ${fmt(cb.headDepth)} mm deep on the front plate, hex nut pockets ${fmt(cb.nutDepth)} mm deep on the back plate. Test the depth on scrap. Then cut. Flip the back plate over so its pockets face out.` : ''),
      `${sn}: cut from ${p.spacerT} mm acrylic.` + (cs.grooves ? ` Engrave the blue groove first, ${p.grooveDepth} mm deep, then flip the spacer and engrave the other face. Cut last.` : ''),
      ``, `Cut holes and inner shapes before outer outlines so parts don't shift.`, `Kerf (about 0.1-0.2 mm) makes holes slightly larger and outlines slightly smaller. That only adds clearance.`,
      cs.analysis ? (cb ? `Hardware: ${cs.analysis.screws.length} x ${p.screw} x ${cs.analysis.length} mm screws${cb.trim ? ` cut to ${cb.trim} mm` : ''} and nuts. No washers: heads and nuts sit in their pockets.` : `Hardware: ${cs.analysis.screws.length} x ${p.screw} x ${cs.analysis.length} mm screws, nuts and ${2 * cs.analysis.screws.length} washers.`) : cs.grooves ? `Join with acrylic solvent cement applied from the outer edge.` : `No join method chosen yet.`].join('\n');
    return [
      { name: pn + '.dxf', data: toDXF(plates) }, { name: pn + '.svg', data: toSVG(plates) },
      { name: sn + '.dxf', data: toDXF(spacer) }, { name: sn + '.svg', data: toSVG(spacer) },
      { name: 'README.txt', data: readme }];
  };
  const stlFiles = () => {
    const m = P2.meshes; const files = [{ name: 'back_plate.stl', data: toSTL(m.back, 'back plate') }, { name: 'spacer.stl', data: toSTL(m.spacer, 'spacer') }, { name: 'front_plate.stl', data: toSTL(m.front, 'front plate') }, { name: 'object_reference.stl', data: toSTL(m.figure, 'object') }];
    if (m.screws) files.push({ name: 'screws_reference.stl', data: toSTL(m.screws, 'screws') });
    return files;
  };
  const csv = () => { const q = s => '"' + String(s).replace(/"/g, '""') + '"'; return ['Part,Spec,Qty,Notes', ...P2.bomRows().map(r => [r[0], r[1], r[2], r[3]].map(q).join(','))].join('\n') + '\n'; };
  if (kind === 'laser') saveFile('acrylic-case-laser-files.zip', makeZip(laserFiles()));
  else if (kind === 'stl') saveFile('acrylic-case-3d-parts.zip', makeZip(stlFiles()));
  else if (kind === 'csv') saveFile('acrylic-case-parts.csv', csv());
  else if (kind === 'all') saveFile('acrylic-case.zip', makeZip([
    ...laserFiles().map(f => ({ ...f, name: 'laser/' + f.name })),
    ...stlFiles().map(f => ({ ...f, name: '3d-parts/' + f.name })),
    { name: 'parts-list.csv', data: csv() }]));
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
