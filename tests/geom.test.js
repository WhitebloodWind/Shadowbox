// Run with: node tests/geom.test.js
const assert = require('assert');
const G = require('../src/geom.js');
const circ = (r, n = 200) => Array.from({ length: n }, (_, k) => [r * Math.cos(2 * Math.PI * k / n), r * Math.sin(2 * Math.PI * k / n)]);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

const rs = G.offsetLoop(circ(20), 5).map(p => Math.hypot(p[0], p[1]));
near(Math.min(...rs), 25, 0.06, 'circle offset min radius'); near(Math.max(...rs), 25, 0.06, 'circle offset max radius');

const sq = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
const b = G.bbox(G.offsetLoop(sq, 3)); near(b.w, 46, 0.05, 'square offset width');

const Lsh = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]];
const g = G.makeGrid(G.bbox(Lsh), 8, 1200, 10); const S = G.gridSigned(G.rasterize([Lsh], g), g);
const lp = G.largestLoopMM(G.closing(S, g.W, g.H, 1 / g.res, 4), g);
let md = 1e9; for (const p of lp) md = Math.min(md, Math.hypot(p[0] - 10, p[1] - 10));
near(md, 4 * (Math.SQRT2 - 1), 0.1, 'inside corner rounding');

const m = G.extrude((x, y) => Math.min(20 - Math.abs(x), 20 - Math.abs(y)), G.bbox(sq), 0, 2);
let A = 0; for (let i = 0; i < m.pos.length; i += 9) if (m.nor[i + 2] === 1) { const p = m.pos; A += ((p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) - (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i])) / 2; }
near(A, 1600, 0.5, 'extruded top face area');

const H = G.homography([[10, 10], [110, 20], [100, 120], [5, 100]], [[0, 0], [50, 0], [50, 50], [0, 50]]);
const q = G.applyH(H, 100, 120); near(q[0], 50, 1e-6, 'homography x'); near(q[1], 50, 1e-6, 'homography y');

console.log('All geometry tests passed');
