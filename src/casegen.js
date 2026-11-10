'use strict';
/* ---------- Case generator (pure) ---------- */
const CaseGen = (() => {
  const SCREWS = {
    'M2': { hole: 2.2, head: 3.8, headH: 1.3, nut: 1.6, nutW: 4.0, washer: 0.5 },
    'M2.5': { hole: 2.7, head: 4.5, headH: 1.6, nut: 2.0, nutW: 5.0, washer: 0.5 },
    'M3': { hole: 3.2, head: 5.5, headH: 1.8, nut: 2.4, nutW: 5.5, washer: 0.5 },
    'M4': { hole: 4.3, head: 7.0, headH: 2.4, nut: 3.2, nutW: 7.0, washer: 0.8 },
  };
  const LENGTHS = [4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30];

  const RING_GAP = 2.2, RING_TAB = 2.8; // hole edge to window; acrylic left round the hole
  function build(fig, p) {
    const G = Geo;
    const bb = G.bbox(fig);
    const ringR = p.keyring ? p.keyringD / 2 : 0;
    const margin = p.clear + p.border + (p.keyring ? p.keyringD + 8 : 0) + 6;
    const g = G.makeGrid(bb, margin, p.maxPx || 1200, 10);
    const sc = 1 / g.res;
    const figS = G.gridSigned(G.rasterize([fig], g, true), g);
    const cavS = G.closing(G.add(figS, p.clear), g.W, g.H, sc, p.cornerR);
    let outerS = G.closing(G.add(figS, p.clear + p.border), g.W, g.H, sc, Math.max(p.cornerR, 2));
    const warnings = [];
    // keyring
    let ring = null;
    if (p.keyring) {
      const cl = G.largestLoopMM(cavS, g);
      const at = cl && cl.length > 3 ? edgePoint(cl, p.keyringPos, cavS, g) : null;
      if (!at) { warnings.push('Couldn’t place the keyring hole there. Click the case again to move it.'); }
      else {
        const off = ringR + RING_GAP, x = at.x + at.nx * off, cy = at.y + at.ny * off;
        ring = { x, y: cy, d: p.keyringD };
        const tab = G.circleField(g, x, cy, ringR + RING_TAB);
        outerS = G.closing(G.fmax(outerS, tab), g.W, g.H, sc, 2);
      }
    }
    const fields = { figS, cavS, outerS };
    const lines = {
      figure: G.largestLoopMM(figS, g),
      cavity: G.largestLoopMM(cavS, g),
      outer: G.largestLoopMM(outerS, g),
    };
    const holes = [];
    if (ring) holes.push({ x: ring.x, y: ring.y, d: ring.d, kind: 'keyring' });
    let analysis = null, grooves = null;
    if (p.join === 'solvent') {
      const g1 = G.add(cavS, p.grooveOffset), g2 = G.add(cavS, p.grooveOffset + p.grooveWidth);
      grooves = { inner: G.largestLoopMM(g1, g), outer: G.largestLoopMM(g2, g), depth: p.grooveDepth };
      fields.grooveS = G.fmin(g2, G.neg(g1));
      if (p.grooveOffset + p.grooveWidth > p.border - 1.5) warnings.push('The groove sits too close to the outer edge. Reduce its distance or widen the border.');
      if (p.grooveDepth * 2 >= p.spacerT) warnings.push('Grooves on both faces would nearly cut through the spacer. Make them shallower.');
    } else if (p.join === 'screws') {
      analysis = placeScrews(g, cavS, outerS, ring, p);
      for (const s of analysis.screws) holes.push({ x: s.x, y: s.y, d: SCREWS[p.screw].hole, kind: 'screw', n: s.n });
      warnings.push(...analysis.warnings);
    }
    if (p.spacerT < p.figT) warnings.push('The spacer is thinner than the object, so the plates will press on it. Use a thicker spacer.');
    else if (p.spacerT - p.figT > 1.5) warnings.push('The object can rattle: the spacer is much thicker than the object.');
    return { g, fields, lines, holes, grooves, analysis, warnings, params: { ...p } };
  }

  /* Longest span allowed between two screws.
     Each stretch of plate between neighbouring screws is treated as a beam clamped at both ends
     (width = border, thickness = plate). A firm 2 N press at mid-span may open the edge by at most
     0.15 mm: delta = F L^3 / (192 E I)  ->  L = cbrt(192 E I delta / F). Cast acrylic E = 3200 MPa. */
  const SPAN = { E: 3200, F: 2, delta: 0.15 };
  function spanLimit(p) {
    const w = Math.max(2, p.border), t = Math.max(0.5, p.plateT), I = w * t ** 3 / 12;
    return Math.min(150, Math.max(15, Math.cbrt(192 * SPAN.E * I * SPAN.delta / SPAN.F)));
  }
  function inside(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
  function centroid(loop) { let a = 0, cx = 0, cy = 0; for (let i = 0; i < loop.length; i++) { const [x0, y0] = loop[i], [x1, y1] = loop[(i + 1) % loop.length]; const f = x0 * y1 - x1 * y0; a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f; } return a ? [cx / (3 * a), cy / (3 * a)] : [0, 0]; }

  function placeScrews(g, cavS, outerS, ring, p) {
    const G = Geo;
    const spec = SCREWS[p.screw]; const hr = spec.hole / 2; const m = p.edge;
    const medial = G.add(outerS, 0); for (let i = 0; i < medial.length; i++) medial[i] = outerS[i] + cavS[i];
    let path = G.largestLoopMM(medial, g);
    const warnings = [];
    if (!path) return { screws: [], warnings: ['Could not find room for screws. Widen the border.'], path: [] };
    path = G.resample(G.smoothLoop(path, 3), 0.5);
    const n = path.length; const L = n * 0.5;
    const clearance = path.map(([x, y]) => {
      let c = Math.min(-G.sample(cavS, g, x, y), G.sample(outerS, g, x, y)) - hr;
      if (ring) c = Math.min(c, Math.hypot(x - ring.x, y - ring.y) - ring.d / 2 - hr);
      return c;
    });
    const valid = clearance.map(c => c >= m);
    const validFrac = valid.filter(Boolean).length / n;
    // longest invalid stretch
    let longest = 0, run = 0; for (let k = 0; k < 2 * n; k++) { if (!valid[k % n]) { run++; longest = Math.max(longest, run); } else run = 0; }
    longest = Math.min(longest, n) * 0.5;
    let best = null;
    // Fewest screws: start from the count the span limit demands and add screws until every gap fits,
    // every screw has room, and the screws surround the middle of the case so the plates can't rock.
    const S = spanLimit(p); const mid = centroid(path);
    const minN = Math.max(3, p.minScrews || 3, Math.ceil(L / S));
    for (let N = minN; N <= minN + 12 && N <= 60; N++) {
      let bestPhase = null;
      for (let ph = 0; ph < 32; ph++) {
        const idx = [];
        let score = 0, ok = true;
        for (let k = 0; k < N; k++) {
          const target = Math.round(((k + ph / 32) / N) * n) % n;
          const win = Math.floor(n / N / 3);
          let bi = -1, bc = -1e9;
          for (let d = -win; d <= win; d++) {
            const q = (target + d + n) % n;
            if (!valid[q]) continue;
            const c = clearance[q] - Math.abs(d) * 0.002;
            if (c > bc) { bc = c; bi = q; }
          }
          if (bi < 0) { ok = false; score -= 100; continue; }
          idx.push(bi); score += Math.min(bc, 3);
        }
        if (!bestPhase || score > bestPhase.score) bestPhase = { idx, score, ok };
      }
      const idx = bestPhase.idx.slice().sort((a, b) => a - b);
      const gaps = idx.map((v, k) => (((idx[(k + 1) % idx.length] - v) + n) % n || n) * 0.5);
      const maxGap = gaps.length ? Math.max(...gaps) : L;
      const ring2 = idx.map(q => path[q]); const surrounds = idx.length >= 3 && inside(ring2, mid[0], mid[1]);
      best = { N, idx, gaps, maxGap, ok: bestPhase.ok, surrounds };
      if (bestPhase.ok && maxGap <= S * 1.05 && surrounds) break;
    }
    const screws = best.idx.map((q, k) => ({ x: path[q][0], y: path[q][1], n: k + 1, clearance: clearance[q] }));
    const minClear = screws.length ? Math.min(...screws.map(s => s.clearance)) : 0;
    if (validFrac < 0.6) warnings.push(`The border is too narrow for ${p.screw} holes along much of the outline. A border of about ${(2 * (hr + m) + 1).toFixed(1)} mm leaves room everywhere.`);
    if (best.maxGap > S * 1.05) warnings.push(`One gap between screws is ${best.maxGap.toFixed(0)} mm, longer than the ${S.toFixed(0)} mm the plates can span, because the border is too narrow there. Widen the border or use thicker acrylic.`);
    if (!best.ok) warnings.push('Some screws could not be placed. Widen the border or use a smaller screw.');
    const stack = 2 * p.plateT + p.spacerT;
    const need = stack + spec.washer + spec.nut + 0.5;
    let length = LENGTHS.find(l => l >= need) || Math.ceil(need);
    // Counterbores: a round pocket in the front plate for the head, a hex pocket in the back plate for the nut.
    let cb = null;
    if (p.counterbore) {
      cb = { headD: spec.head + 0.4, headDepth: spec.headH + 0.1, nutR: spec.nutW / Math.sqrt(3) + 0.15, nutDepth: spec.nut + 0.1 };
      const deepest = Math.max(cb.headDepth, cb.nutDepth), left = p.plateT - deepest;
      if (left < 0.8) warnings.push(`Flush ${p.screw} heads and nuts need pockets ${deepest.toFixed(1)} mm deep, which leaves only ${Math.max(0, left).toFixed(1)} mm of the ${p.plateT} mm plates. Use plates at least ${(deepest + 0.8).toFixed(1)} mm thick, or a smaller screw.`);
      // From the head seat, the screw should end inside the nut (at least 80% engaged) without poking out of the back.
      const reach = stack - cb.headDepth, shortest = reach - 0.1 - 0.2 * spec.nut;
      const fit = LENGTHS.filter(l => l >= shortest && l <= reach + 1e-9);
      if (fit.length) { length = fit[fit.length - 1]; cb.trim = null; }
      else { length = LENGTHS.find(l => l >= reach) || Math.ceil(reach); cb.trim = Math.floor(reach * 2) / 2; warnings.push(`No stock ${p.screw} screw ends flush with this stack. Buy ${length} mm screws and cut them to ${cb.trim} mm.`); }
      const pocketR = Math.max(cb.headD / 2, cb.nutR);
      const tight = screws.filter(s => s.clearance + hr - pocketR < 0.6).length;
      if (tight) warnings.push(`${tight} of the counterbores come within 0.6 mm of an edge. Widen the border or use a smaller screw.`);
      cb.reach = reach;
    }
    return { screws, path, gaps: best.gaps, maxGap: best.maxGap, span: S, cb, minClear, pathLength: L, spec, length, stack, validFrac, longestInvalid: longest, warnings };
  }

  // The window edge as a path that starts at its topmost point and runs one fixed way round,
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
    // the field is positive inside the window, so outward is the way it falls
    if (Geo.sample(cavS, g, x + nx * 0.5, y + ny * 0.5) > Geo.sample(cavS, g, x - nx * 0.5, y - ny * 0.5)) { nx = -nx; ny = -ny; }
    return { x, y, nx, ny };
  }
  // The fraction along the window edge nearest to a point (inverse of edgePoint).
  function edgeParam(loop, x, y) {
    const { pts, cum, L } = edgePath(loop); let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1];
      const f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a[0] + dx * f - x, a[1] + dy * f - y); if (d < bd) { bd = d; best = (cum[i] + f * (cum[i + 1] - cum[i])) / L; }
    }
    return best;
  }

  function ringAt(cs, x, y, d) {
    const at = edgePoint(cs.lines.cavity, edgeParam(cs.lines.cavity, x, y), cs.fields.cavS, cs.g); if (!at) return null;
    const off = d / 2 + RING_GAP; return { x: at.x + at.nx * off, y: at.y + at.ny * off, d, tab: d / 2 + RING_TAB };
  }

  function meshes(cs, p) {
    const G = Geo; const { g, fields, holes, grooves } = cs;
    const bbo = G.bbox(cs.lines.outer);
    const holeField = (x, y) => { let v = 1e3; for (const h of holes) v = Math.min(v, Math.hypot(x - h.x, y - h.y) - h.d / 2); return v; };
    const outer = (x, y) => G.sample(fields.outerS, g, x, y);
    const cav = (x, y) => G.sample(fields.cavS, g, x, y);
    const plateF = (x, y) => Math.min(outer(x, y), holeField(x, y));
    const spacerF = (x, y) => Math.min(outer(x, y), -cav(x, y), holeField(x, y));
    const pt = p.plateT, st = p.spacerT;
    const out = {};
    const cb = cs.analysis && cs.analysis.cb; const scr = cs.analysis ? cs.analysis.screws : [];
    // pocket fields: positive where the plate stays solid
    const headF = (x, y) => { let v = 1e3; for (const s of scr) v = Math.min(v, Math.hypot(x - s.x, y - s.y) - cb.headD / 2); return v; };
    const HEXN = [30, 90, 150].map(a => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)]);
    const nutF = (x, y) => { let v = 1e3; for (const s of scr) { const dx = x - s.x, dy = y - s.y; v = Math.min(v, Math.max(...HEXN.map(([a, b]) => Math.abs(dx * a + dy * b))) - cb.nutR * Math.cos(Math.PI / 6)); } return v; };
    out.back = cb ? G.mergeMeshes([G.extrude((x, y) => Math.min(plateF(x, y), nutF(x, y)), bbo, 0, cb.nutDepth), G.extrude(plateF, bbo, cb.nutDepth, pt)]) : G.extrude(plateF, bbo, 0, pt);
    if (grooves) {
      const gr = (x, y) => G.sample(fields.grooveS, g, x, y);
      const sg = (x, y) => Math.min(spacerF(x, y), -gr(x, y));
      const d = Math.min(grooves.depth, st / 2 - 0.05);
      out.spacer = G.mergeMeshes([G.extrude(sg, bbo, pt, pt + d), G.extrude(spacerF, bbo, pt + d, pt + st - d), G.extrude(sg, bbo, pt + st - d, pt + st)]);
    } else out.spacer = G.extrude(spacerF, bbo, pt, pt + st);
    out.front = cb ? G.mergeMeshes([G.extrude(plateF, bbo, pt + st, 2 * pt + st - cb.headDepth), G.extrude((x, y) => Math.min(plateF(x, y), headF(x, y)), bbo, 2 * pt + st - cb.headDepth, 2 * pt + st)]) : G.extrude(plateF, bbo, pt + st, 2 * pt + st);
    const fb = G.bbox(cs.lines.figure);
    out.figure = G.extrude((x, y) => G.sample(fields.figS, g, x, y), fb, pt, pt + p.figT);
    if (cs.analysis) {
      const sp = cs.analysis.spec; const top = 2 * pt + st;
      const parts = [], top_ = [], bottom = [];
      for (const s of cs.analysis.screws) {
        const r = (sp.hole - 0.2) / 2;
        if (cb) { // head and nut sunk into their pockets
          const seat = top - cb.headDepth, L = cb.trim || cs.analysis.length;
          top_.push(G.cylinder(s.x, s.y, r, Math.max(0.02, seat - L), seat + 0.01));
          top_.push(G.cylinder(s.x, s.y, sp.head / 2, seat, seat + sp.headH));
          bottom.push(G.cylinder(s.x, s.y, sp.nutW / Math.sqrt(3), cb.nutDepth - sp.nut, cb.nutDepth, 6));
          continue;
        }
        top_.push(G.cylinder(s.x, s.y, r, -sp.washer - sp.nut - 0.5, top + sp.washer + 0.01));
        top_.push(G.cylinder(s.x, s.y, sp.head / 2, top + sp.washer, top + sp.washer + sp.headH));
        top_.push(G.cylinder(s.x, s.y, sp.head / 2 + 0.3, top, top + sp.washer));
        bottom.push(G.cylinder(s.x, s.y, sp.nutW / 2, -sp.washer - sp.nut, -sp.washer, 6));
        bottom.push(G.cylinder(s.x, s.y, sp.head / 2 + 0.3, -sp.washer, 0));
      }
      parts.push(...top_, ...bottom);
      out.screws = parts.length ? G.mergeMeshes(parts) : null;
      out.screwHeads = top_.length ? G.mergeMeshes(top_) : null; // screw + top washer: rides up with the front plate
      out.screwNuts = bottom.length ? G.mergeMeshes(bottom) : null; // nut + bottom washer: drops with the back plate
    }
    return out;
  }
  return { build, meshes, edgeParam, ringAt, spanLimit, SPAN, SCREWS };
})();
if (typeof module !== 'undefined') module.exports = CaseGen;
