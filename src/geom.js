'use strict';
/* ---------- Geometry engine (pure functions, no DOM) ---------- */
const Geo = (() => {
  const INF = 1e20;

  // Exact Euclidean distance transform (Felzenszwalb & Huttenlocher).
  // feature[i] = 1 marks feature pixels. Returns distance in pixels to nearest feature pixel centre.
  function edt(feature, w, h) {
    const n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const g = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = feature[i] ? 0 : INF;
    function dt(len) {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let p = v[k];
        let s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
        while (s <= z[k]) { k--; p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = g[y * w + x];
      dt(h);
      for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) f[x] = g[o + x];
      dt(w);
      for (let x = 0; x < w; x++) out[o + x] = Math.sqrt(d[x]);
    }
    return out;
  }

  function invert(m) { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; }
  function maskOf(F, level = 0) { const m = new Uint8Array(F.length); for (let i = 0; i < F.length; i++) m[i] = F[i] > level ? 1 : 0; return m; }

  // Signed field in "units" (scale = units per pixel): positive inside, zero on the boundary midway between pixel centres.
  function signedField(mask, w, h, scale = 1) {
    const dOut = edt(mask, w, h), dIn = edt(invert(mask), w, h);
    const F = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) F[i] = (mask[i] ? (dIn[i] - 0.5) : -(dOut[i] - 0.5)) * scale;
    return F;
  }
  const add = (F, c) => { const o = new Float32Array(F.length); for (let i = 0; i < F.length; i++) o[i] = F[i] + c; return o; };
  const neg = F => { const o = new Float32Array(F.length); for (let i = 0; i < F.length; i++) o[i] = -F[i]; return o; };
  const fmax = (A, B) => { const o = new Float32Array(A.length); for (let i = 0; i < A.length; i++) o[i] = A[i] > B[i] ? A[i] : B[i]; return o; };
  const fmin = (A, B) => { const o = new Float32Array(A.length); for (let i = 0; i < A.length; i++) o[i] = A[i] < B[i] ? A[i] : B[i]; return o; };
  // Morphological closing of the region F>0 by radius r (rounds inside corners to radius r).
  function closing(F, w, h, scale, r) {
    if (r <= 0) return F;
    return add(signedField(maskOf(add(F, r)), w, h, scale), -r);
  }
  function opening(F, w, h, scale, r) {
    if (r <= 0) return F;
    return add(signedField(maskOf(add(F, -r)), w, h, scale), r);
  }

  // Marching squares. Inside = F > level. Node (x,y) is pixel centre (x,y) in index space.
  function contours(F, W, H, level = 0) {
    const W2 = W + 2;
    const val = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1e9 : F[y * W + x] - level;
    const pts = new Map(), adj = new Map();
    const hid = (x, y) => 2 * ((y + 1) * W2 + (x + 1));
    const vid = (x, y) => 2 * ((y + 1) * W2 + (x + 1)) + 1;
    const ensure = (id, x0, y0, x1, y1, a, b) => {
      if (!pts.has(id)) { let t = a / (a - b); if (!isFinite(t)) t = 0.5; t = Math.min(1, Math.max(0, t)); pts.set(id, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); }
    };
    const link = (a, b) => {
      let la = adj.get(a); if (!la) adj.set(a, la = []); la.push(b);
      let lb = adj.get(b); if (!lb) adj.set(b, lb = []); lb.push(a);
    };
    for (let y = -1; y < H; y++) {
      for (let x = -1; x < W; x++) {
        const tl = val(x, y), tr = val(x + 1, y), br = val(x + 1, y + 1), bl = val(x, y + 1);
        const c = (tl > 0 ? 8 : 0) | (tr > 0 ? 4 : 0) | (br > 0 ? 2 : 0) | (bl > 0 ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const T = hid(x, y), B = hid(x, y + 1), L = vid(x, y), R = vid(x + 1, y);
        const eT = () => ensure(T, x, y, x + 1, y, tl, tr);
        const eB = () => ensure(B, x, y + 1, x + 1, y + 1, bl, br);
        const eL = () => ensure(L, x, y, x, y + 1, tl, bl);
        const eR = () => ensure(R, x + 1, y, x + 1, y + 1, tr, br);
        const seg = (a, ea, b, eb) => { ea(); eb(); link(a, b); };
        const centre = (tl + tr + br + bl) / 4 > 0;
        switch (c) {
          case 1: seg(L, eL, B, eB); break;
          case 2: seg(B, eB, R, eR); break;
          case 3: seg(L, eL, R, eR); break;
          case 4: seg(T, eT, R, eR); break;
          case 5: if (centre) { seg(L, eL, T, eT); seg(B, eB, R, eR); } else { seg(T, eT, R, eR); seg(L, eL, B, eB); } break;
          case 6: seg(T, eT, B, eB); break;
          case 7: seg(T, eT, L, eL); break;
          case 8: seg(L, eL, T, eT); break;
          case 9: seg(T, eT, B, eB); break;
          case 10: if (centre) { seg(T, eT, R, eR); seg(L, eL, B, eB); } else { seg(L, eL, T, eT); seg(B, eB, R, eR); } break;
          case 11: seg(T, eT, R, eR); break;
          case 12: seg(L, eL, R, eR); break;
          case 13: seg(B, eB, R, eR); break;
          case 14: seg(L, eL, B, eB); break;
        }
      }
    }
    const loops = [], seen = new Set();
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop = []; let prev = -1, cur = start;
      for (let guard = 0; guard < 5e6; guard++) {
        seen.add(cur); loop.push(pts.get(cur));
        const nb = adj.get(cur); if (!nb || nb.length < 2) break;
        const nxt = nb[0] !== prev ? nb[0] : nb[1];
        if (nxt === start || seen.has(nxt)) break;
        prev = cur; cur = nxt;
      }
      if (loop.length > 2) loops.push(loop);
    }
    return loops;
  }

  function area(loop) { let a = 0; for (let i = 0, n = loop.length; i < n; i++) { const p = loop[i], q = loop[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function largest(loops) { let best = null, ba = -1; for (const l of loops) { const a = Math.abs(area(l)); if (a > ba) { ba = a; best = l; } } return best; }
  function perimeter(loop) { let s = 0; for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i + 1) % loop.length]; s += Math.hypot(q[0] - p[0], q[1] - p[1]); } return s; }
  function bbox(loop) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of loop) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  function resample(loop, step) {
    const n = loop.length; const cum = [0];
    for (let i = 0; i < n; i++) { const p = loop[i], q = loop[(i + 1) % n]; cum.push(cum[i] + Math.hypot(q[0] - p[0], q[1] - p[1])); }
    const L = cum[n]; const m = Math.max(8, Math.round(L / step)); const out = []; let j = 0;
    for (let k = 0; k < m; k++) {
      const s = k * L / m; while (j < n - 1 && cum[j + 1] < s) j++;
      const p = loop[j], q = loop[(j + 1) % n]; const seg = cum[j + 1] - cum[j]; const t = seg > 0 ? (s - cum[j]) / seg : 0;
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    return out;
  }
  function smoothLoop(loop, k) {
    if (k <= 0) return loop; const n = loop.length; const out = [];
    for (let i = 0; i < n; i++) { let sx = 0, sy = 0; for (let j = -k; j <= k; j++) { const p = loop[(i + j + n) % n]; sx += p[0]; sy += p[1]; } out.push([sx / (2 * k + 1), sy / (2 * k + 1)]); }
    return out;
  }
  // Ramer-Douglas-Peucker for closed loops
  function rdpOpen(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); const A = pts[a], B = pts[b];
      const dx = B[0] - A[0], dy = B[1] - A[1]; const len = Math.hypot(dx, dy) || 1e-9;
      let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (pts[i][0] - A[0]) - dx * (pts[i][1] - A[1])) / len; if (d > md) { md = d; mi = i; } }
      if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function rdpClosed(loop, eps) {
    if (loop.length < 4) return loop.slice();
    let far = 0, fd = -1; for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
    const a = rdpOpen(loop.slice(0, far + 1), eps), b = rdpOpen(loop.slice(far).concat([loop[0]]), eps);
    return a.slice(0, -1).concat(b.slice(0, -1));
  }
  // Centripetal Catmull-Rom through closed key points
  function catmull(P, step = 0.4) {
    const n = P.length; if (n < 3) return P.slice(); const out = [];
    const d = (a, b) => Math.max(1e-6, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
      const m = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < m; k++) {
        const t = t1 + (t2 - t1) * k / m; const pt = [0, 0];
        for (let c = 0; c < 2; c++) {
          const A1 = (t1 - t) / (t1 - t0) * p0[c] + (t - t0) / (t1 - t0) * p1[c];
          const A2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c];
          const A3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
          const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
          const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
          pt[c] = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
        }
        out.push(pt);
      }
    }
    return out;
  }

  // ----- mm grids -----
  function makeGrid(bb, margin, maxPx = 1200, maxRes = 10) {
    const w = bb.w + 2 * margin, h = bb.h + 2 * margin;
    const res = Math.min(maxRes, maxPx / Math.max(w, h));
    const W = Math.ceil(w * res), H = Math.ceil(h * res);
    return { ox: bb.x0 - margin, oy: bb.y0 - margin, res, W, H };
  }
  // Even-odd scanline fill of loops (mm) into grid. Pixel (i,j) centre is at mm (ox+(i+0.5)/res, oy+(j+0.5)/res).
  function rasterize(loops, g, conservative = false) {
    const m = new Uint8Array(g.W * g.H); const edges = [];
    for (const loop of loops) for (let i = 0, n = loop.length; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      const ax = (a[0] - g.ox) * g.res, ay = (a[1] - g.oy) * g.res, bx = (b[0] - g.ox) * g.res, by = (b[1] - g.oy) * g.res;
      if (ay !== by) edges.push(ay < by ? [ay, by, ax, bx] : [by, ay, bx, ax]);
    }
    edges.sort((p, q) => p[0] - q[0]);
    let active = [], ei = 0;
    for (let j = 0; j < g.H; j++) {
      const yc = j + 0.5;
      while (ei < edges.length && edges[ei][0] <= yc) active.push(edges[ei++]);
      active = active.filter(e => e[1] > yc);
      const xs = [];
      for (const e of active) if (e[0] <= yc) xs.push(e[2] + (yc - e[0]) * (e[3] - e[2]) / (e[1] - e[0]));
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(g.W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
        for (let i = i0; i <= i1; i++) m[j * g.W + i] = 1;
      }
    }
    if (conservative) for (const loop of loops) for (let k = 0, n = loop.length; k < n; k++) {
      const a = loop[k], b = loop[(k + 1) % n];
      const ax = (a[0] - g.ox) * g.res, ay = (a[1] - g.oy) * g.res, bx = (b[0] - g.ox) * g.res, by = (b[1] - g.oy) * g.res;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.3));
      for (let t = 0; t <= steps; t++) { const x = Math.floor(ax + (bx - ax) * t / steps), y = Math.floor(ay + (by - ay) * t / steps); if (x >= 0 && y >= 0 && x < g.W && y < g.H) m[y * g.W + x] = 1; }
    }
    return m;
  }
  const gridSigned = (mask, g) => signedField(mask, g.W, g.H, 1 / g.res);
  const toMM = (loop, g) => loop.map(([x, y]) => [g.ox + (x + 0.5) / g.res, g.oy + (y + 0.5) / g.res]);
  function largestLoopMM(F, g, level = 0) { const l = largest(contours(F, g.W, g.H, level)); return l ? toMM(l, g) : null; }
  function sample(F, g, x, y) {
    const fx = (x - g.ox) * g.res - 0.5, fy = (y - g.oy) * g.res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const at = (a, b) => (a < 0 || b < 0 || a >= g.W || b >= g.H) ? -1e3 : F[b * g.W + a];
    return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
  }
  function circleField(g, cx, cy, r) {
    const F = new Float32Array(g.W * g.H);
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
      const x = g.ox + (i + 0.5) / g.res, y = g.oy + (j + 0.5) / g.res; F[j * g.W + i] = r - Math.hypot(x - cx, y - cy);
    }
    return F;
  }
  function offsetLoop(loop, d) {
    const bb = bbox(loop); const g = makeGrid(bb, Math.max(0, d) + 4, 1400, 12);
    const S = gridSigned(rasterize([loop], g), g);
    return largestLoopMM(add(S, d), g);
  }

  // ----- Extrusion mesh from a field (inside > 0) -----
  // fieldAt(x,y) in mm. Returns {pos, nor, lines}
  function extrude(fieldAt, bb, z0, z1, step = 0.35) {
    const ox = bb.x0 - 2 * step, oy = bb.y0 - 2 * step;
    const W = Math.ceil((bb.w + 4 * step) / step) + 1, H = Math.ceil((bb.h + 4 * step) / step) + 1;
    const F = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) F[j * W + i] = fieldAt(ox + i * step, oy + j * step);
    const P = [], N = [];
    const X = i => ox + i * step, Y = j => oy + j * step;
    const tri = (a, b, c, nz) => { // a,b,c: [x,y] mm (y down) at height z; want normal sign nz
      const A = [a[0], -a[1]], B = [b[0], -b[1]], C = [c[0], -c[1]];
      const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      const z = nz > 0 ? z1 : z0;
      const list = (cross > 0) === (nz > 0) ? [A, B, C] : [A, C, B];
      for (const p of list) { P.push(p[0], p[1], z); N.push(0, 0, nz); }
    };
    const face = (poly) => { for (let k = 1; k + 1 < poly.length; k++) { tri(poly[0], poly[k], poly[k + 1], 1); tri(poly[0], poly[k], poly[k + 1], -1); } };
    const interp = (p, q, a, b) => { const t = a / (a - b); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
    for (let j = 0; j < H - 1; j++) {
      let run = -1;
      for (let i = 0; i < W - 1; i++) {
        const v = [F[j * W + i], F[j * W + i + 1], F[(j + 1) * W + i + 1], F[(j + 1) * W + i]];
        const full = v[0] > 0 && v[1] > 0 && v[2] > 0 && v[3] > 0;
        if (full) { if (run < 0) run = i; continue; }
        if (run >= 0) { face([[X(run), Y(j)], [X(i), Y(j)], [X(i), Y(j + 1)], [X(run), Y(j + 1)]]); run = -1; }
        if (!(v[0] > 0 || v[1] > 0 || v[2] > 0 || v[3] > 0)) continue;
        const c = [[X(i), Y(j)], [X(i + 1), Y(j)], [X(i + 1), Y(j + 1)], [X(i), Y(j + 1)]];
        const ins = v.map(a => a > 0);
        const saddle = (ins[0] && ins[2] && !ins[1] && !ins[3]) || (ins[1] && ins[3] && !ins[0] && !ins[2]);
        if (saddle && (v[0] + v[1] + v[2] + v[3]) / 4 <= 0) {
          for (let k = 0; k < 4; k++) if (ins[k]) {
            const pk = (k + 3) % 4, nk = (k + 1) % 4;
            face([interp(c[pk], c[k], v[pk], v[k]), c[k], interp(c[k], c[nk], v[k], v[nk])]);
          }
          continue;
        }
        const poly = [];
        for (let k = 0; k < 4; k++) {
          const nk = (k + 1) % 4;
          if (ins[k]) poly.push(c[k]);
          if (ins[k] !== ins[nk]) poly.push(interp(c[k], c[nk], v[k], v[nk]));
        }
        if (poly.length >= 3) face(poly);
      }
      if (run >= 0) face([[X(run), Y(j)], [X(W - 1), Y(j)], [X(W - 1), Y(j + 1)], [X(run), Y(j + 1)]]);
    }
    // walls
    const loops = contours(F, W, H, 0).map(l => l.map(([x, y]) => [ox + x * step, oy + y * step]));
    const lines = [];
    for (const loop of loops) {
      for (let k = 0, n = loop.length; k < n; k++) {
        const a = loop[k], b = loop[(k + 1) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy); if (len < 1e-9) continue;
        let nx = dy / len, ny = -dx / len; // candidate normal in y-down plane
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if (fieldAt(mx + nx * step * 0.3, my + ny * step * 0.3) > fieldAt(mx - nx * step * 0.3, my - ny * step * 0.3)) { nx = -nx; ny = -ny; }
        const n3 = [nx, -ny, 0];
        const A0 = [a[0], -a[1], z0], B0 = [b[0], -b[1], z0], B1 = [b[0], -b[1], z1], A1 = [a[0], -a[1], z1];
        const cr = (p, q, r) => { const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]; return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; };
        const push = (p, q, r) => { const c = cr(p, q, r); const ok = c[0] * n3[0] + c[1] * n3[1] + c[2] * n3[2] >= 0; const L = ok ? [p, q, r] : [p, r, q]; for (const s of L) { P.push(s[0], s[1], s[2]); N.push(n3[0], n3[1], n3[2]); } };
        push(A0, B0, B1); push(A0, B1, A1);
        lines.push(a[0], -a[1], z0, b[0], -b[1], z0, a[0], -a[1], z1, b[0], -b[1], z1);
      }
    }
    return { pos: new Float32Array(P), nor: new Float32Array(N), lines: new Float32Array(lines) };
  }
  function cylinder(cx, cy, r, z0, z1, seg = 24) {
    const P = [], N = [], X = cx, Y = -cy;
    for (let k = 0; k < seg; k++) {
      const a0 = 2 * Math.PI * k / seg, a1 = 2 * Math.PI * (k + 1) / seg;
      const p0 = [X + r * Math.cos(a0), Y + r * Math.sin(a0)], p1 = [X + r * Math.cos(a1), Y + r * Math.sin(a1)];
      const n0 = [Math.cos(a0), Math.sin(a0), 0], n1 = [Math.cos(a1), Math.sin(a1), 0];
      P.push(p0[0], p0[1], z0, p1[0], p1[1], z0, p1[0], p1[1], z1, p0[0], p0[1], z0, p1[0], p1[1], z1, p0[0], p0[1], z1);
      N.push(...n0, ...n1, ...n1, ...n0, ...n1, ...n0);
      P.push(X, Y, z1, p0[0], p0[1], z1, p1[0], p1[1], z1); N.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
      P.push(X, Y, z0, p1[0], p1[1], z0, p0[0], p0[1], z0); N.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
    }
    return { pos: new Float32Array(P), nor: new Float32Array(N), lines: new Float32Array(0) };
  }
  function mergeMeshes(list) {
    let n = 0, m = 0; for (const a of list) { n += a.pos.length; m += a.lines.length; }
    const pos = new Float32Array(n), nor = new Float32Array(n), lines = new Float32Array(m); let o = 0, q = 0;
    for (const a of list) { pos.set(a.pos, o); nor.set(a.nor, o); o += a.pos.length; lines.set(a.lines, q); q += a.lines.length; }
    return { pos, nor, lines };
  }

  // Homography from 4 point pairs (src -> dst)
  function solve(A, b) {
    const n = b.length; const M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b); if (!h) return null; return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function applyH(H, x, y) { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; }
  function invH(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }

  return { edt, invert, maskOf, signedField, add, neg, fmax, fmin, closing, opening, contours, area, largest, perimeter, bbox, resample, smoothLoop, rdpClosed, catmull, makeGrid, rasterize, gridSigned, toMM, largestLoopMM, sample, circleField, offsetLoop, extrude, cylinder, mergeMeshes, homography, applyH, invH };
})();
if (typeof module !== 'undefined') module.exports = Geo;
