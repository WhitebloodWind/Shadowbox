# Shadowbox

Turn a photo of a flat object into a cut-ready outline, then into a display case. Two case styles:

- **Acrylic stack**: laser-cut front plate, spacer and back plate, joined with screws or solvent cement.
- **Snap-fit frame**: two plain acrylic sheets held in two 3D-printed borders that clip together. No screws; the keyring hole goes through the printed parts only. Everything runs in the browser with classic image processing: no AI, no server.

## Workflow

**Outline**
1. Upload a photo with a ruler or grid paper in the shot.
2. Set the scale with two points, or four rectangle corners (which also corrects camera tilt).
3. Trace the outline, then adjust the key points.
4. Optionally enlarge the line (even offset or scale from centre).
5. Export SVG, DXF, PDF (1:1) or JSON.

**Case**
1. Pick the case style: Acrylic stack or Snap-fit frame.
2. Set thicknesses, gap, corner radius and an optional keyring hole, plus border width (acrylic) or wall, overlap, face and print clearance (snap-fit).
3. Acrylic: join with screws or solvent cement. Snap-fit: choose the number and width of clips, or leave it automatic.
4. Export laser files (DXF and SVG), STL parts and a parts list.

For the snap-fit frame, print both borders flat face down without supports (PETG flexes best), then stack back border, sheet, object, sheet and press the front border on until every clip clicks. If parts are tight, raise the print clearance and export again.

## Run

Open `index.html` in Chrome, Edge or Firefox. To serve it on your network:

```
python -m http.server 8000
```

## Develop

Source lives in `src/`; `index.html` is generated.

| File | Contents |
|---|---|
| `src/shell.html` | Layout and styles. Scripts are inserted at `/*GEOM*/`, `/*CASEGEN*/`, `/*SNAPGEN*/`, `/*APP*/`. |
| `src/geom.js` | Geometry engine: distance transforms, marching squares, offsets, extrusion meshing, homography. |
| `src/casegen.js` | Acrylic stack generator: cavity, border, keyring, screw placement, solvent grooves, meshes. |
| `src/snapgen.js` | Snap-fit generator: sheet and border outlines, keyring tab, clip placement, clip and border meshes. Clip sizes are the `CLIP` constants at the top. |
| `src/app1.js` | Helpers, file writers (SVG, DXF, PDF, STL, ZIP), Outline phase. |
| `src/app2.js` | WebGL viewer, SVG and DXF importers, Case phase. |

```
python build.py             # rebuild index.html after editing src/
node tests/geom.test.js     # geometry tests
node tests/casegen.test.js  # acrylic stack tests
node tests/snapgen.test.js  # snap-fit tests
```

All geometry is in millimetres with the y axis pointing down; DXF and STL exports flip y.
