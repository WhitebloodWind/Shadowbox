// Run with: node tests/snapgen.test.js
const assert = require('assert');
global.Geo = require('../src/geom.js');
const SnapGen = require('../src/snapgen.js');
const circ = (r, n = 200) => Array.from({ length: n }, (_, k) => [r * Math.cos(2 * Math.PI * k / n), r * Math.sin(2 * Math.PI * k / n)]);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
const p = { figT: 1, clear: 1, plateT: 2, lip: 2, wall: 3.6, faceT: 1.6, fit: 0.2, cornerR: 1.5, keyring: false, keyringD: 4, keyringPos: 0, clips: 0, clipW: 6 };
const radii = loop => loop.map(([x, y]) => Math.hypot(x, y));

// A 30 mm circle: sheet = object + gap + overlap, border = sheet + clearance + wall.
const cs = SnapGen.build(circ(30), p);
near(Math.max(...radii(cs.lines.sheet)), 33, 0.25, 'acrylic sheet radius');
near(Math.max(...radii(cs.lines.outer)), 36.8, 0.25, 'printed border radius');
near(Math.max(...radii(cs.lines.window)), 31, 0.25, 'window radius');
assert.strictEqual(cs.holes.length, 0, 'no holes without a keyring');
assert.ok(cs.clips.length >= 3, 'at least three clips');
assert.deepStrictEqual(cs.warnings, [], 'no warnings for a sensible case');

// Clips sit in the middle of the wall and point outward.
for (const cl of cs.clips) {
  near(Math.hypot(cl.x, cl.y), 35, 0.3, 'clip is on the wall mid-line');
  assert.ok(cl.x * cl.nx + cl.y * cl.ny > 0, 'clip normal points out of the case');
  near(cl.vt, p.wall / 2 - SnapGen.CLIP.tabT, 0.15, 'tab hugs the outside of the wall');
}
assert.strictEqual(SnapGen.build(circ(30), { ...p, clips: 7 }).clips.length, 7, 'clip count can be set');

// Heights: the borders meet at mid-height and the tab tip stays inside the back border.
const D = cs.dims; near(D.H, 8.2, 1e-9, 'case thickness'); near(D.zm, 4.1, 1e-9, 'mid-height'); assert.ok(D.zt > 0 && D.zt < p.faceT, 'tab tip stops short of the back face');

// Keyring: a hole in the printed border only. The acrylic sheet is unchanged and the hole clears it.
const kr = SnapGen.build(circ(30), { ...p, keyring: true });
assert.strictEqual(kr.holes.length, 1, 'keyring adds one hole');
near(Math.max(...radii(kr.lines.sheet)), 33, 0.25, 'sheet is the same with a keyring');
const h = kr.holes[0]; assert.ok(Math.hypot(h.x, h.y) - h.d / 2 > 33.2, 'hole is outside the sheet pocket');
for (const cl of kr.clips) assert.ok(Math.hypot(cl.x - h.x, cl.y - h.y) > 8, 'clips keep away from the keyring tab');

// Warnings for cases the clips can't work in.
assert.ok(SnapGen.build(circ(30), { ...p, wall: 2 }).warnings.some(w => w.includes('wall')), 'thin wall warns');
assert.ok(SnapGen.build(circ(30), { ...p, plateT: 0.5, faceT: 0.8, figT: 0.2 }).warnings.some(w => w.includes('too thin')), 'thin case warns');

// Meshes: both borders and both sheets come out non-empty, inside the case's height.
const m = SnapGen.meshes(cs, p);
for (const k of ['back', 'front', 'backSheet', 'frontSheet', 'figure']) assert.ok(m[k].pos.length > 0 && m[k].pos.length % 9 === 0, `${k} mesh has triangles`);
const zs = mesh => { let lo = Infinity, hi = -Infinity; for (let i = 2; i < mesh.pos.length; i += 3) { lo = Math.min(lo, mesh.pos[i]); hi = Math.max(hi, mesh.pos[i]); } return [lo, hi]; };
near(zs(m.back)[0], 0, 1e-6, 'back border starts at the bottom'); near(zs(m.back)[1], D.zm, 1e-6, 'back border ends at mid-height');
near(zs(m.front)[0], D.zt, 1e-4, 'front border reaches down to the tab tips'); near(zs(m.front)[1], D.H, 1e-4, 'front border ends at the top');

console.log('All snap generator tests passed');
