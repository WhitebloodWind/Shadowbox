'use strict';
/* ---------- Snap-fit case generator (pure) ----------
   Stack, bottom to top: back printed border, back acrylic sheet, the object, front acrylic sheet, front printed border.
   Each printed border is a rim that overlaps the edge of its sheet, plus a wall round the sheets. The two walls meet
   at mid-height. Snap clips are springy tabs on the front border that hook into notches in the back border.
   The acrylic sheets are plain outlines: no holes. The keyring hole goes through the printed borders only. */
const SnapGen = (() => {
  const RING_GAP = 1.2, RING_TAB = 2.8; // hole edge to the sheet pocket; printed material left round the hole
  // Clip shape, mm. tabT = tab thickness, barb = how far the hook sticks in, barbH = hook height,
  // slit = gap each side of the tab, back = gap behind the tab so it can flex, maxLen = longest tab below mid-height.
  const CLIP = { tabT: 1.0, barb: 0.7, barbH: 1.2, slit: 0.5, back: 0.4, maxLen: 6 };

  // Heights. zm = where the two borders meet, zf = underside of the front rim, zt = tip of the clip tabs.
  function dims(p) {
    const H = 2 * p.faceT + 2 * p.plateT + p.figT, zm = H / 2, tabLen = Math.max(0.4, Math.min(CLIP.maxLen, zm - 0.6));
    return { H, zm, zf: H - p.faceT, zt: zm - tabLen, tabLen };
  }

  function build(fig, p) {
    const G = Geo, c = p.fit, D = dims(p), warnings = [];
    const bb = G.bbox(fig);
    const ringR = p.keyring ? p.keyringD / 2 : 0;
    const margin = p.clear + p.lip + c + p.wall + (p.keyring ? p.keyringD + 8 : 0) + 6;
    const g = G.makeGrid(bb, margin, p.maxPx || 1200, 10), sc = 1 / g.res;
    const figS = G.gridSigned(G.rasterize([fig], g, true), g);
    const windowS = G.closing(G.add(figS, p.clear), g.W, g.H, sc, p.cornerR);        // opening in the rims
    const sheetS = G.closing(G.add(figS, p.clear + p.lip), g.W, g.H, sc, p.cornerR); // acrylic outline
    const cavS = G.add(sheetS, c);                                                    // pocket the sheets sit in
    let outerS = G.add(sheetS, c + p.wall);
    // keyring: a printed tab with a hole, outside the sheet pocket
    let ring = null;
    if (p.keyring) {
      const cl = G.largestLoopMM(cavS, g);
      const at = cl && cl.length > 3 ? edgePoint(cl, p.keyringPos, cavS, g) : null;
      if (!at) warnings.push('Couldn’t place the keyring hole there. Click the case again to move it.');
      else {
        const off = ringR + RING_GAP;
        ring = { x: at.x + at.nx * off, y: at.y + at.ny * off, d: p.keyringD };
        outerS = G.closing(G.fmax(outerS, G.circleField(g, ring.x, ring.y, ringR + RING_TAB)), g.W, g.H, sc, 2);
      }
    }
    // clips: spread round the middle of the wall, nudged onto its straightest stretches and away from the keyring tab
    let clips = [];
    const mid = G.largestLoopMM(G.add(sheetS, c + p.wall / 2), g);
    if (mid) {
      const path = G.resample(G.smoothLoop(mid, 3), 0.5), n = path.length, L = n * 0.5;
      const hw = p.clipW / 2, k = Math.max(2, Math.round((hw + 2) / 0.5));
      const sag = path.map((q, i) => { // how far the wall bows from a straight line across the clip
        const a = path[(i - k + n) % n], b = path[(i + k) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / l;
      });
      const free = path.map(([x, y]) => !ring || Math.hypot(x - ring.x, y - ring.y) > ringR + RING_TAB + hw + 2);
      const N = p.clips > 0 ? Math.round(p.clips) : Math.max(3, Math.round(L / 45));
      let best = null;
      for (let ph = 0; ph < 16; ph++) {
        const idx = []; let cost = 0;
        for (let j = 0; j < N; j++) {
          const target = Math.round((j + ph / 16) / N * n) % n, win = Math.floor(n / N / 4);
          let bi = -1, bc = Infinity;
          for (let d = -win; d <= win; d++) { const q = (target + d + n) % n; if (!free[q]) continue; const v = sag[q] + Math.abs(d) * 0.0005; if (v < bc) { bc = v; bi = q; } }
          if (bi < 0) { cost += 10; continue; }
          idx.push(bi); cost += bc;
        }
        if (!best || cost < best.cost) best = { idx, cost };
      }
      clips = [...new Set(best.idx)].sort((a, b) => a - b).map((q, j) => {
        const a = path[(q - k + n) % n], b = path[(q + k) % n]; let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        let nx = ty, ny = -tx; const [x, y] = path[q];
        if (G.sample(outerS, g, x + nx, y + ny) > G.sample(outerS, g, x - nx, y - ny)) { nx = -nx; ny = -ny; } // n points out of the case
        // vt = inner face of the tab, measured outward from the middle of the wall
        return { x, y, tx, ty, nx, ny, vt: G.sample(outerS, g, x, y) - CLIP.tabT, sag: sag[q], n: j + 1 };
      });
      if (clips.some(cl => cl.sag > 0.6)) warnings.push('Some clips sit on a tight curve, so their tabs won’t lie flat against the wall. Use narrower clips or fewer of them.');
    }
    if (clips.length < 3) warnings.push('Fewer than three clips fit, so the borders can pull apart at one side. Use narrower clips or a larger outline.');
    const minWall = CLIP.tabT + CLIP.barb + c + 1;
    if (p.wall < minWall) warnings.push(`The printed wall is too thin for the clips. Make it at least ${minWall.toFixed(1)} mm wide.`);
    if (D.tabLen < CLIP.barbH + 1) warnings.push(`The case is only ${D.H.toFixed(1)} mm thick, which is too thin for the clip hooks. Use a thicker printed face or thicker acrylic (at least ${(2 * (CLIP.barbH + 1.6)).toFixed(1)} mm in total).`);
    const fields = { figS, windowS, sheetS, cavS, outerS };
    const lines = {
      figure: G.largestLoopMM(figS, g), window: G.largestLoopMM(windowS, g), sheet: G.largestLoopMM(sheetS, g),
      cavity: G.largestLoopMM(cavS, g), outer: G.largestLoopMM(outerS, g),
    };
    const holes = ring ? [{ x: ring.x, y: ring.y, d: ring.d, kind: 'keyring' }] : [];
    return { g, fields, lines, holes, clips, dims: D, warnings, params: { ...p } };
  }

  // The pocket edge as a path that starts at its topmost point and runs one fixed way round,
  // so a fraction 0..1 names a spot on the edge.
  function edgePath(loop) {
    let pts = loop.slice(); if (Geo.area(pts) < 0) pts.reverse();
    let top = 0; for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[top][1] - 1e-9 || (Math.abs(pts[i][1] - pts[top][1]) < 1e-9 && Math.abs(pts[i][0]) < Math.abs(pts[top][0]))) top = i;
    pts = pts.slice(top).concat(pts.slice(0, top));
    const cum = [0]; for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    return { pts, cum, L: cum[pts.length] };
  }
  function edgePoint(loop, t, cavS, g) {
    const { pts, cum, L } = edgePath(loop); const n = pts.length; if (!(L > 0)) return null;
    const s = ((t % 1) + 1) % 1 * L; let i = 0; while (i < n - 1 && cum[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % n], f = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
    const k = Math.max(2, Math.round(n / 120)); const P = pts[(i - k + n) % n], Q = pts[(i + 1 + k) % n];
    let nx = Q[1] - P[1], ny = -(Q[0] - P[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    // the field is positive inside the pocket, so outward is the way it falls
    if (Geo.sample(cavS, g, x + nx * 0.5, y + ny * 0.5) > Geo.sample(cavS, g, x - nx * 0.5, y - ny * 0.5)) { nx = -nx; ny = -ny; }
    return { x, y, nx, ny };
  }
  // The fraction along the pocket edge nearest to a point (inverse of edgePoint).
  function edgeParam(loop, x, y) {
    const { pts, cum, L } = edgePath(loop); let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1];
      const f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a[0] + dx * f - x, a[1] + dy * f - y); if (d < bd) { bd = d; best = (cum[i] + f * (cum[i + 1] - cum[i])) / L; }
    }
    return best;
  }
  // Where a keyring hole clicked at (x, y) would land: same rule build() uses.
  function ringAt(cs, x, y, d) {
    const at = edgePoint(cs.lines.cavity, edgeParam(cs.lines.cavity, x, y), cs.fields.cavS, cs.g); if (!at) return null;
    const off = d / 2 + RING_GAP; return { x: at.x + at.nx * off, y: at.y + at.ny * off, d, tab: d / 2 + RING_TAB };
  }

  /* 3D parts. Everything is a stack of flat slabs, each the region where a 2D field is positive.
     The borders are meshed coarsely, with a small box round each clip cut out and re-meshed finely,
     because clip details (0.2-0.7 mm) are smaller than the coarse mesh step. */
  function meshes(cs, p) {
    const G = Geo, { g, fields, holes, clips } = cs, D = cs.dims, c = p.fit, K = CLIP;
    const bbo = G.bbox(cs.lines.outer);
    const S = F => (x, y) => G.sample(F, g, x, y);
    const outer = S(fields.outerS), cav = S(fields.cavS), win = S(fields.windowS), sheet = S(fields.sheetS), figF = S(fields.figS);
    const hole = (x, y) => { let v = 1e3; for (const h of holes) v = Math.min(v, Math.hypot(x - h.x, y - h.y) - h.d / 2); return v; };
    const rim = (x, y) => Math.min(outer(x, y), -win(x, y), hole(x, y));   // flat frame over the sheet edge
    const wall = (x, y) => Math.min(outer(x, y), -cav(x, y), hole(x, y));  // ring round the sheets
    // a clip's own frame: u along the wall, v outward from the middle of the wall
    const uv = (cl, x, y) => [(x - cl.x) * cl.tx + (y - cl.y) * cl.ty, (x - cl.x) * cl.nx + (y - cl.y) * cl.ny];
    const hw = p.clipW / 2, zw = hw + K.slit + 1, R = p.wall / 2 + c + p.lip + 1.5;
    const zone = cl => (x, y) => { const [u, v] = uv(cl, x, y); return Math.min(zw - Math.abs(u), R - Math.abs(v)); };
    const zones = (x, y) => { let m = -1e3; for (const cl of clips) m = Math.max(m, zone(cl)(x, y)); return m; };
    const coarse = f => (x, y) => Math.min(f(x, y), -zones(x, y));
    const band = (cl, a, b) => (x, y) => { const [u, v] = uv(cl, x, y); return Math.min(a - Math.abs(u), v - b); }; // |u| <= a and v >= b
    // slabs between sorted heights; pick(zMid) returns the field for that slab, or null for nothing
    const stack = (bb, zs, pick, step) => {
      const out = [], z = [...new Set(zs.map(v => +v.toFixed(4)))].sort((a, b) => a - b);
      for (let i = 0; i + 1 < z.length; i++) { if (z[i + 1] - z[i] < 0.02) continue; const f = pick((z[i] + z[i + 1]) / 2); if (f) out.push(G.extrude(f, bb, z[i], z[i + 1], step)); }
      return out;
    };
    const back = [G.extrude(coarse(rim), bbo, 0, p.faceT), G.extrude(coarse(wall), bbo, p.faceT, D.zm)];
    const front = [G.extrude(coarse(wall), bbo, D.zm, D.zf), G.extrude(coarse(rim), bbo, D.zf, D.H)];
    for (const cl of clips) {
      const zf_ = zone(cl), inZone = f => (x, y) => Math.min(f(x, y), zf_(x, y) + 0.05); // +0.05: overlap the coarse mesh slightly
      const corners = [[-zw, -R], [zw, -R], [zw, R], [-zw, R]].map(([u, v]) => [cl.x + cl.tx * u + cl.nx * v, cl.y + cl.ty * u + cl.ny * v]);
      const bb = G.bbox(corners);
      // back border: a notch for the tab, deeper where the hook sits so it has a ledge to catch under
      const notch = band(cl, hw + c, cl.vt - c), groove = band(cl, hw + c, cl.vt - K.barb - c);
      const g0 = D.zt - c, g1 = D.zt + K.barbH + c;
      back.push(...stack(bb, [0, g0, g1, p.faceT, D.zm], z => {
        const base = z < p.faceT ? rim : wall, cut = z < g0 ? null : z < g1 ? groove : notch;
        return inZone(cut ? (x, y) => Math.min(base(x, y), -cut(x, y)) : base);
      }, 0.12));
      // front border: the tab hangs from the rim, freed from the wall by a slit each side and a gap behind;
      // its hook is stepped so it rides over the back wall as the halves are pressed together
      const tab = inset => { const b = band(cl, hw, cl.vt - inset); return (x, y) => Math.min(b(x, y), outer(x, y)); };
      const freed = band(cl, hw + K.slit, cl.vt - K.back), plain = tab(0), s = K.barbH / 3;
      front.push(...stack(bb, [D.zt, D.zt + s, D.zt + 2 * s, D.zt + K.barbH, D.zm, D.zf, D.H], z => {
        if (z > D.zf) return inZone(rim);
        if (z > D.zm) return inZone((x, y) => Math.max(Math.min(wall(x, y), -freed(x, y)), plain(x, y)));
        if (z > D.zt + K.barbH) return inZone(plain);
        return inZone(tab(K.barb * Math.min(3, 1 + Math.floor((z - D.zt) / s)) / 3));
      }, 0.12));
    }
    const sb = G.bbox(cs.lines.sheet), fb = G.bbox(cs.lines.figure);
    return {
      back: G.mergeMeshes(back), front: G.mergeMeshes(front),
      backSheet: G.extrude(sheet, sb, p.faceT, p.faceT + p.plateT),
      frontSheet: G.extrude(sheet, sb, D.zf - p.plateT, D.zf),
      figure: G.extrude(figF, fb, p.faceT + p.plateT, p.faceT + p.plateT + p.figT),
    };
  }
  return { build, meshes, edgeParam, ringAt, dims, CLIP };
})();
if (typeof module !== 'undefined') module.exports = SnapGen;
