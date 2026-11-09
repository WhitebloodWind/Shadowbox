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
      const cbb = G.bbox(fig);
      const x = cbb.x0 + p.keyringPos * cbb.w;
      const i = Math.min(g.W - 1, Math.max(0, Math.floor((x - g.ox) * g.res)));
      let topY = null;
      for (let j = 0; j < g.H; j++) if (cavS[j * g.W + i] > 0) { topY = g.oy + (j + 0.5) / g.res; break; }
      if (topY === null) { warnings.push('Keyring position is outside the outline. Move the slider.'); }
      else {
        const cy = topY - (ringR + 2.2);
        ring = { x, y: cy, d: p.keyringD };
        const tab = G.circleField(g, x, cy, ringR + 2.8);
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
    } else {
      analysis = placeScrews(g, cavS, outerS, ring, p);
      for (const s of analysis.screws) holes.push({ x: s.x, y: s.y, d: SCREWS[p.screw].hole, kind: 'screw', n: s.n });
      warnings.push(...analysis.warnings);
    }
    if (p.spacerT < p.figT) warnings.push('The spacer is thinner than the object, so the plates will press on it. Use a thicker spacer.');
    else if (p.spacerT - p.figT > 1.5) warnings.push('The object can rattle: the spacer is much thicker than the object.');
    return { g, fields, lines, holes, grooves, analysis, warnings, params: { ...p } };
  }

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
    const minN = Math.max(p.minScrews, Math.ceil(L / p.spacing));
    for (let N = minN; N <= minN + 8 && N <= 60; N++) {
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
      best = { N, idx, gaps, maxGap, ok: bestPhase.ok };
      if (bestPhase.ok && maxGap <= p.spacing * 1.15) break;
    }
    const screws = best.idx.map((q, k) => ({ x: path[q][0], y: path[q][1], n: k + 1, clearance: clearance[q] }));
    const minClear = screws.length ? Math.min(...screws.map(s => s.clearance)) : 0;
    if (validFrac < 0.6) warnings.push(`The border is too narrow for ${p.screw} holes along much of the outline. A border of about ${(2 * (hr + m) + 1).toFixed(1)} mm leaves room everywhere.`);
    if (best.maxGap > p.spacing * 1.15) warnings.push(`One gap between screws is ${best.maxGap.toFixed(0)} mm, longer than your ${p.spacing} mm limit, because the border is too narrow there. Widen the border or accept the gap.`);
    if (!best.ok) warnings.push('Some screws could not be placed. Widen the border or use a smaller screw.');
    const stack = 2 * p.plateT + p.spacerT;
    const need = stack + spec.washer + spec.nut + 0.5;
    const length = LENGTHS.find(l => l >= need) || Math.ceil(need);
    return { screws, path, gaps: best.gaps, maxGap: best.maxGap, minClear, pathLength: L, spec, length, stack, validFrac, longestInvalid: longest, warnings };
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
    out.back = G.extrude(plateF, bbo, 0, pt);
    if (grooves) {
      const gr = (x, y) => G.sample(fields.grooveS, g, x, y);
      const sg = (x, y) => Math.min(spacerF(x, y), -gr(x, y));
      const d = Math.min(grooves.depth, st / 2 - 0.05);
      out.spacer = G.mergeMeshes([G.extrude(sg, bbo, pt, pt + d), G.extrude(spacerF, bbo, pt + d, pt + st - d), G.extrude(sg, bbo, pt + st - d, pt + st)]);
    } else out.spacer = G.extrude(spacerF, bbo, pt, pt + st);
    out.front = G.extrude(plateF, bbo, pt + st, 2 * pt + st);
    const fb = G.bbox(cs.lines.figure);
    out.figure = G.extrude((x, y) => G.sample(fields.figS, g, x, y), fb, pt, pt + p.figT);
    if (cs.analysis) {
      const sp = cs.analysis.spec; const top = 2 * pt + st;
      const parts = [];
      for (const s of cs.analysis.screws) {
        const r = (sp.hole - 0.2) / 2;
        parts.push(G.cylinder(s.x, s.y, r, -sp.washer - sp.nut - 0.5, top + sp.washer + 0.01));
        parts.push(G.cylinder(s.x, s.y, sp.head / 2, top + sp.washer, top + sp.washer + sp.headH));
        parts.push(G.cylinder(s.x, s.y, sp.nutW / 2, -sp.washer - sp.nut, -sp.washer, 6));
        parts.push(G.cylinder(s.x, s.y, sp.head / 2 + 0.3, top, top + sp.washer));
        parts.push(G.cylinder(s.x, s.y, sp.head / 2 + 0.3, -sp.washer, 0));
      }
      out.screws = parts.length ? G.mergeMeshes(parts) : null;
    }
    return out;
  }
  return { build, meshes, SCREWS };
})();
if (typeof module !== 'undefined') module.exports = CaseGen;
