# Shadowbox

Turn a photo of a flat object into a cut-ready outline, then into a laser-cut acrylic case (acrylic, spacer, acrylic). Everything runs in the browser with classic image processing: no AI, no server.

## Workflow

**Outline**
1. Upload a photo with a ruler or grid paper in the shot.
2. Set the scale with two points, or four rectangle corners (which also corrects camera tilt).
3. Trace the outline, then adjust the key points.
4. Optionally enlarge the line (even offset or scale from centre).
5. Export SVG, DXF, PDF (1:1) or JSON.

**Case**
1. Use the traced line or import an SVG or DXF.
2. Set thicknesses, gap, border, corner radius and an optional keyring hole.
3. Join with screws (automatic placement and analysis) or solvent cement (engraved relief grooves).
4. Export laser files (DXF and SVG), STL parts and a parts list.

## Run

Open `index.html` in Chrome, Edge or Firefox. To serve it on your network:

```
python -m http.server 8000
```

## Develop

Source lives in `src/`; `index.html` is generated.

| File | Contents |
|---|---|
| `src/shell.html` | Layout and styles. Scripts are inserted at `/*GEOM*/`, `/*CASEGEN*/`, `/*APP*/`. |
| `src/geom.js` | Geometry engine: distance transforms, marching squares, offsets, extrusion meshing, homography. |
| `src/casegen.js` | Case generator: cavity, border, keyring, screw placement, solvent grooves, meshes. |
| `src/app1.js` | Helpers, file writers (SVG, DXF, PDF, STL, ZIP), Outline phase. |
| `src/app2.js` | WebGL viewer, SVG and DXF importers, Case phase. |

```
python build.py          # rebuild index.html after editing src/
node tests/geom.test.js  # geometry tests
```

All geometry is in millimetres with the y axis pointing down; DXF and STL exports flip y.
