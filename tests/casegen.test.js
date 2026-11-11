// Run with: node tests/casegen.test.js
const assert = require('assert');
global.Geo = require('../src/geom.js');
const CaseGen = require('../src/casegen.js');
const circ = (r, n = 200) => Array.from({ length: n }, (_, k) => [r * Math.cos(2 * Math.PI * k / n), r * Math.sin(2 * Math.PI * k / n)]);
const p = { figT: 1, clear: 1, border: 8, plateT: 2, spacerT: 1.5, cornerR: 1.5, keyring: false, join: 'screws', screw: 'M2', minScrews: 3, edge: 2, screwList: [] };

// No list entries: no screws.
const none = CaseGen.build(circ(30), p);
assert.strictEqual(none.analysis.screws.length, 0, 'empty list gives no screws');

// The plan suggests screws; accepting it reproduces the same count.
const plan = CaseGen.planScrews(none, p);
assert.ok(plan.screws.length >= 3, 'plan has at least 3 screws');
const accepted = CaseGen.build(circ(30), { ...p, screwList: plan.screws.map(s => [s.x, s.y]) });
assert.strictEqual(accepted.analysis.screws.length, plan.screws.length, 'accepted plan keeps its screws');

// A click off the screw line snaps onto it; two clicks at one spot make one screw.
const r = accepted.analysis.path.map(([x, y]) => Math.hypot(x, y)).reduce((a, b) => a + b) / accepted.analysis.path.length;
const one = CaseGen.build(circ(30), { ...p, screwList: [[0, -10], [0, -11]] });
assert.strictEqual(one.analysis.screws.length, 1, 'duplicate clicks merge');
assert.ok(Math.abs(Math.hypot(one.analysis.screws[0].x, one.analysis.screws[0].y) - r) < 1, 'screw snaps onto the screw line');
assert.ok(one.warnings.some(w => w.includes('surround')), 'one screw warns that the plates can rock');

console.log('All case generator tests passed');
