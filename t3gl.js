/* Buck Ledger 3D Terrain Sim renderer (Elite + Example teaser), WebGL via Three.js. Loaded only when 3D opens.
 * Look and feel follow the owner's own 3D sim: lit, shaded ground with the aerial photo draped on it, orbit / zoom / tilt,
 * map markup (bedding, food, neighbor line) laid on top, raised moving route arrows, wind and slope-air particles,
 * cold-air mist in low ground, the scent plume from the picked stand, the walk-in, and green / yellow / red stands.
 * Physics stays in terrain.js on TRUE elevation. Here heights are only multiplied by the "Exaggerate terrain" setting for
 * drawing, and every drawn layer (air, mist, scent, routes, stands) uses that same drawn height so it sits on the ground.
 * No numbers, graphs or photos are drawn. */
import * as THREE from './vendor/three/three.module.min.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';

const ZC = { B: [70, 104, 58], F: [196, 186, 96], W: [70, 128, 170], C: [90, 140, 180], N: [150, 128, 80], R: [160, 156, 148], X: [150, 110, 96], '.': [128, 140, 96] };
// ---------- PALETTE: one color per icon type, nothing shared (also listed in README) ----------
export const PALETTE = {
  standGood: 0x00bfa5,    // teal        - stand rated good (not the bedding/field green)
  standCaution: 0xff8a00, // amber-orange - stand rated caution (not the hoof-print yellow)
  standAvoid: 0xa0001e,   // deep crimson - stand rated avoid (darker than the boundary coral-red)
  hoof: 0xffd23f,         // yellow       - hoof prints on buck routes
  scent: 0x9c6bff,        // violet       - scent cones
  thermalSink: 0x7fd4ff,  // icy sky-blue - sinking air vapor
  thermalRise: 0xff80ab,  // rose pink    - rising air vapor
  wind: 0xffffff,         // white        - wind vane and wind lines
  bedding: 0x2e7d32,      // forest green - bedding cover markup
  beddingMark: 0x6d4c41,  // brown        - bedded-deer marker
  food: 0xc8a26a,         // wheat        - food markup and crop-clump marker
  boundary: 0xff5252,     // coral-red    - property boundary / outside
  water: 0x1e4fa8,        // deep blue    - water / creek
  walkIn: 0xc6ff00,       // lime         - walk-in path
  north: 0x212121,        // black tip on a white post - north marker
  select: 0xffffff        // white ring   - selected stand
};
const rgbf = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const glsl = (h) => { const c = rgbf(h); return 'vec3(' + c.map(v => v.toFixed(3)).join(',') + ')'; };
const ZT = (() => { const z = (h, a) => rgbf(h).concat([a]); return { B: z(PALETTE.bedding, 0.30), F: z(PALETTE.food, 0.30), X: z(PALETTE.boundary, 0.10), W: z(PALETTE.water, 0.28), C: z(PALETTE.water, 0.24), N: [0.75, 0.55, 0.25, 0.25], R: [0.8, 0.8, 0.78, 0.22] }; })();
const SCOL = { green: PALETTE.standGood, yellow: PALETTE.standCaution, red: PALETTE.standAvoid };

// ---------- HOOF TRACK CONFIG: tune here, or set window.BL_HOOF = { ... } to override live ----------
// ---------- MOTION BALANCE: every layer moves at its own calm pace, eased and offset (all speeds here) ----------
export const MOTION = {
  scentPulseSec: 9,        // one full scent-cone extend + ease-back cycle (ease-in-out)
  scentMinReach: 0.35,     // how far the cone eases back to, as a share of its full length
  scentStandOffsetSec: 2.2,// each stand's cone starts its pulse this much after the previous one
  windCellsPerSec: 2.4,    // wind streamline drift speed (grid cells per second)
};
function motionCfg() { return Object.assign({}, MOTION, (typeof window !== 'undefined' && window.BL_MOTION) || {}); }
const easeIO = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
// thermal vapor: soft drifting mist, blue = sinking (flows downhill), orange = rising (flows uphill)
export const THERMAL = {
  opacity: 0.45,      // peak mist opacity (0 = invisible, 1 = solid); the aerial stays visible through it
  flowSpeed: 0.22     // how fast the mist drifts along the slope
};
export const HOOF = {
  staggerSec: 3,      // seconds between one route's walk starting and the next
  stepSpacingM: 26,   // ground distance between prints, metres
  trailLength: 8,     // prints in the trail; the tail loses one print each step as the front gains one (constant length)
  color: PALETTE.hoof, // print color (yellow)
  stepsPerSec: 1.6,   // walking pace of the prints
  pauseSec: 2,        // rest after a route finishes before it walks again
  printSizeM: 20      // drawn print size (display only; scaled up so it reads on a phone)
};
function hoofCfg() { return Object.assign({}, HOOF, (typeof window !== 'undefined' && window.BL_HOOF) || {}); }

// ---------- low-poly 3D objects (shared geometry, built once; phone-light) ----------
const OBJ = {};
function objGeo() {
  if (OBJ.ok) return OBJ; OBJ.ok = true;
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), C = (r1, r2, h, s) => new THREE.CylinderGeometry(r1, r2, h, s || 6);
  OBJ.box = B(1, 1, 1); OBJ.cyl = C(0.5, 0.5, 1, 6); OBJ.cone = C(0, 0.5, 1, 6); OBJ.cone4 = C(0, 0.72, 1, 4); OBJ.ico = new THREE.IcosahedronGeometry(0.5, 0);
  OBJ.disc = new THREE.TorusGeometry(1, 0.08, 4, 24); OBJ.disc.rotateX(Math.PI / 2);
  // hoof print: flat top-down shape of two split heart-shaped halves, pointed toe forward (-Z), lying flat (normal +Y)
  const half = (sd) => { const s = new THREE.Shape(); s.moveTo(sd * 0.04, 0.5); s.bezierCurveTo(sd * 0.32, 0.36, sd * 0.36, -0.2, sd * 0.24, -0.42); s.bezierCurveTo(sd * 0.16, -0.52, sd * 0.06, -0.5, sd * 0.05, -0.38); s.bezierCurveTo(sd * 0.02, -0.1, sd * 0.02, 0.2, sd * 0.04, 0.5); return s; };
  OBJ.hoof = new THREE.ShapeGeometry([half(1), half(-1)], 4); OBJ.hoof.rotateX(-Math.PI / 2);
  Object.values(OBJ).forEach(g => { if (g && g.isBufferGeometry) g.userData.shared = true; });
  return OBJ;
}
const MATS = {};
let _hoofMat = null;   // flat yellow prints drawn on the ground surface (polygon offset keeps them on top of the terrain without lifting them)
function hoofMat() { if (!_hoofMat) { _hoofMat = new THREE.MeshBasicMaterial({ color: HOOF.color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false }); _hoofMat.userData.shared = true; } return _hoofMat; }
function mat(c) { if (!MATS[c]) { MATS[c] = new THREE.MeshLambertMaterial({ color: c, flatShading: true }); MATS[c].userData.shared = true; } return MATS[c]; }
function part(g, c, sx, sy, sz, x, y, z, rx, rz) { const m = new THREE.Mesh(g, mat(c)); m.scale.set(sx, sy, sz); m.position.set(x || 0, y || 0, z || 0); if (rx) m.rotation.x = rx; if (rz) m.rotation.z = rz; return m; }
// each model is ~1 unit tall/wide at scale 1 and sits on y = 0 (its base)
function ladderStand(col) { const o = objGeo(), g = new THREE.Group(), dk = 0x2b2b2b;
  g.add(part(o.box, dk, 0.05, 1, 0.05, -0.16, 0.5, 0.08, -0.12), part(o.box, dk, 0.05, 1, 0.05, 0.16, 0.5, 0.08, -0.12));
  for (let k = 1; k < 5; k++) g.add(part(o.box, dk, 0.32, 0.03, 0.03, 0, k * 0.19, 0.12 - k * 0.022));
  g.add(part(o.cyl, 0x5b4630, 0.14, 1.25, 0.14, 0, 0.62, -0.18), part(o.box, col, 0.42, 0.06, 0.36, 0, 0.98, 0.0), part(o.box, col, 0.36, 0.22, 0.05, 0, 1.12, -0.16)); return g; }
function treeStand(col) { const o = objGeo(), g = new THREE.Group();
  g.add(part(o.cyl, 0x5b4630, 0.16, 1.4, 0.16, 0, 0.7, 0), part(o.cone, 0x3d6b35, 0.7, 0.6, 0.7, 0, 1.55, 0), part(o.box, col, 0.4, 0.06, 0.34, 0, 0.95, 0.24), part(o.box, col, 0.3, 0.2, 0.05, 0, 1.08, 0.09)); return g; }
function blind(col) { const o = objGeo(), g = new THREE.Group();
  g.add(part(o.box, col, 0.7, 0.55, 0.7, 0, 0.275, 0), part(o.cone4, 0x3a3a2a, 0.75, 0.32, 0.75, 0, 0.71, 0, 0, 0), part(o.box, 0x111111, 0.32, 0.1, 0.02, 0, 0.38, 0.36)); g.children[1].rotation.y = Math.PI / 4; return g; }
function northMarker() { const o = objGeo(), g = new THREE.Group();
  g.add(part(o.cyl, 0xeeeeee, 0.06, 1, 0.06, 0, 0.5, 0), part(o.cone, PALETTE.north, 0.36, 0.5, 0.36, 0, 1.0, -0.2, -Math.PI / 2), part(o.box, 0xffffff, 0.06, 0.06, 0.4, 0, 1.0, 0.1)); return g; }
function windVane() { const o = objGeo(), g = new THREE.Group(); // points along -Z
  g.add(part(o.cyl, PALETTE.wind, 0.12, 1.1, 0.12, 0, 0, 0.1, Math.PI / 2), part(o.cone, PALETTE.wind, 0.42, 0.55, 0.42, 0, 0, -0.62, -Math.PI / 2), part(o.box, 0xd8d8d8, 0.02, 0.32, 0.3, 0, 0, 0.6)); return g; }
export const OBJ3D = {
  scale: 1 / 32,          // object size as a share of the property's span (display only; positions are exact)
  maxZoneMarkers: 10      // bedding / food markers per kind
};
function objCfg() { return Object.assign({}, OBJ3D, (typeof window !== 'undefined' && window.BL_OBJ3D) || {}); }
export function create(stage, opt) {
  const canvas = document.createElement('canvas'); canvas.className = 't3-gl'; canvas.setAttribute('aria-label', '3D terrain view');
  stage.insertBefore(canvas, stage.firstChild);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); } catch (e) { canvas.remove(); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 2, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.47; controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.8; controls.screenSpacePanning = false;
  let G = null, exag = opt.exag || 3, dead = false, raf = 0, aerialTex = null, aerialURL = '', fineKey = '', fine = null;
  const U = { uLight: { value: new THREE.Vector3(0.4, 0.8, 0.3) }, uAmb: { value: 0.45 }, uNight: { value: 0 }, uHasA: { value: 0 }, uA: { value: null }, uMark: { value: null }, uPool: { value: null }, uPoolOn: { value: 0 }, uTime: { value: 0 }, uTherm: { value: 0 }, uThermDir: { value: 0 }, uThermOp: { value: THERMAL.opacity }, uThermSp: { value: THERMAL.flowSpeed } };
  const layers = Object.assign({ wind: false, thermals: false, scent: true, routes: true }, opt.layers || {});
  const terrMat = new THREE.ShaderMaterial({ uniforms: U,
    vertexShader: `attribute vec3 color; attribute float aH; varying float vH; varying vec2 vUv; varying vec3 vN; varying vec3 vC; varying vec3 vW; void main(){ vH=aH; vUv=uv; vN=normal; vC=color; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform sampler2D uA,uMark,uPool; uniform vec3 uLight; uniform float uAmb,uNight,uHasA,uPoolOn,uTime,uTherm,uThermDir,uThermOp,uThermSp; varying float vH; varying vec2 vUv; varying vec3 vN; varying vec3 vC; varying vec3 vW;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      void main(){ vec3 base=uHasA>.5?texture2D(uA,vUv).rgb:vC; float d=max(dot(normalize(vN),normalize(uLight)),0.); vec3 c=base*(uAmb+ (1.-uAmb)*1.25*d);
        vec4 m=texture2D(uMark,vUv); c=mix(c,m.rgb,m.a);
        if(uTherm>.5){ vec2 q=vW.xz*.01; float fl=vH*7.+uTime*uThermSp*uThermDir; float m=n2(q+vec2(fl,fl*.6))*.65+n2(q*2.7+vec2(fl*1.7,-fl)+vec2(uTime*.03))*.35; m=smoothstep(.38,.85,m); vec3 tc=uThermDir>.5?${glsl(PALETTE.thermalSink)}:uThermDir<-.5?${glsl(PALETTE.thermalRise)}:vec3(.93,.93,.93); c=mix(c,tc,m*uThermOp); }
        float l=dot(c,vec3(.3,.59,.11)); c=mix(c,vec3(l)*vec3(.8,.92,1.2),uNight*.55)*(1.-uNight*.35);
        float p=texture2D(uPool,vUv).r*uPoolOn; float nn=n2(vW.xz*.02+vec2(uTime*.03,uTime*.02))*.6+n2(vW.xz*.06-vec2(uTime*.04,0.))*.4; c=mix(c,vec3(.72,.85,1.),clamp(p*(.45+.5*nn),0.,.6));
        gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
      }` });
  const sky = new THREE.Color(0x9fb8cc); scene.background = sky;
  const groupO = new THREE.Group(); scene.add(groupO);
  const sunL = new THREE.DirectionalLight(0xfff4e0, 2.2), hemiL = new THREE.HemisphereLight(0xdfeeff, 0x4a4030, 1.6); scene.add(sunL, hemiL);
  const raycaster = new THREE.Raycaster(); let standMeshes = [];
  function size() { const w = stage.clientWidth || 360, hh = Math.round(Math.min(w * 1.05, 560)); renderer.setSize(w, hh, false); canvas.style.width = w + 'px'; canvas.style.height = hh + 'px'; camera.aspect = w / hh; camera.updateProjectionMatrix(); }
  size(); window.addEventListener('resize', size);

  // ---------- heights (true metres) on the drawing grid ----------
  function heights(D) {
    if (D.fine && D.fine.z) return D.fine;
    return { nx: D.NX, ny: D.NY, z: D.z };
  }
  function hTrue(D, gx, gy) {   // gx, gy in engine cells (0..NX, 0..NY), bilinear on the best grid
    const H = G.H, fx = Math.min(Math.max(gx / D.NX * H.nx - 0.5, 0), H.nx - 1.001), fy = Math.min(Math.max(gy / D.NY * H.ny - 0.5, 0), H.ny - 1.001), j = fx | 0, i = fy | 0, a = fx - j, b = fy - i, k = i * H.nx + j;
    return (1 - b) * ((1 - a) * H.z[k] + a * H.z[k + 1]) + b * ((1 - a) * H.z[k + H.nx] + a * H.z[k + H.nx + 1]);
  }
  function P(D, gx, gy, up) { return new THREE.Vector3((gx / D.NX - 0.5) * D.wm, (hTrue(D, gx, gy) - G.zmin) * exag + (up || 0), (gy / D.NY - 0.5) * D.hm); }

  function buildGround(D) {
    const H = heights(D), nx = H.nx, ny = H.ny, pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2), col = new Float32Array(nx * ny * 3);
    let zmin = 1e9, zmax = -1e9; for (let k = 0; k < nx * ny; k++) { if (H.z[k] < zmin) zmin = H.z[k]; if (H.z[k] > zmax) zmax = H.z[k]; }
    const ah = new Float32Array(nx * ny); for (let k = 0; k < nx * ny; k++) ah[k] = (H.z[k] - zmin) / Math.max(1, zmax - zmin);
    G.H = H; G.zmin = zmin;
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
      const k = i * nx + j, gx = (j + 0.5) / nx * D.NX, gy = (i + 0.5) / ny * D.NY;
      pos[3 * k] = (gx / D.NX - 0.5) * D.wm; pos[3 * k + 1] = (H.z[k] - zmin) * exag; pos[3 * k + 2] = (gy / D.NY - 0.5) * D.hm;
      uv[2 * k] = (j + 0.5) / nx; uv[2 * k + 1] = 1 - (i + 0.5) / ny;
      const zc = ZC[D.zoneAt(gx, gy)] || ZC['.']; col[3 * k] = zc[0] / 255; col[3 * k + 1] = zc[1] / 255; col[3 * k + 2] = zc[2] / 255;
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let q = 0;
    for (let i = 0; i < ny - 1; i++) for (let j = 0; j < nx - 1; j++) { const a = i * nx + j, b = a + 1, c = a + nx, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aH', new THREE.BufferAttribute(ah, 1)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    if (G.ground) { G.ground.geometry.dispose(); G.ground.geometry = g; } else { G.ground = new THREE.Mesh(g, terrMat); scene.add(G.ground); }
    // edge skirt so the block does not float
    if (G.skirt) { scene.remove(G.skirt); G.skirt.geometry.dispose(); }
    const sk = new THREE.PlaneGeometry(D.wm * 6, D.hm * 6); sk.rotateX(-Math.PI / 2); G.skirt = new THREE.Mesh(sk, new THREE.MeshBasicMaterial({ color: 0x3c4a33 })); G.skirt.position.y = -2; scene.add(G.skirt);
  }
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  function markTex(D) {   // bedding / food / neighbor line etc. laid over the photo
    return canvasTex(D.COLS * 16, D.ROWS * 16, (g) => {
      for (let i = 0; i < D.COLS * D.ROWS; i++) { const z = D.map.cells[i], t = ZT[z]; if (!t) continue; const x = (i % D.COLS) * 16, y = ((i / D.COLS) | 0) * 16;
        g.fillStyle = `rgba(${t[0] * 255 | 0},${t[1] * 255 | 0},${t[2] * 255 | 0},${D.aerial ? t[3] : t[3] * 0.6})`; g.fillRect(x, y, 16, 16); }
      // outline each zone edge so the markup reads on top of the photo
      g.lineWidth = 1.5;
      for (let y = 0; y < D.ROWS; y++) for (let x = 0; x < D.COLS; x++) { const z = D.map.cells[y * D.COLS + x]; if (!ZT[z]) continue; const t = ZT[z]; g.strokeStyle = `rgba(${t[0] * 255 | 0},${t[1] * 255 | 0},${t[2] * 255 | 0},.95)`;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < D.COLS && Y < D.ROWS && D.map.cells[Y * D.COLS + X] === z) return; g.beginPath(); if (dx) { const xx = (x + (dx > 0 ? 1 : 0)) * 16; g.moveTo(xx, y * 16); g.lineTo(xx, y * 16 + 16); } else { const yy = (y + (dy > 0 ? 1 : 0)) * 16; g.moveTo(x * 16, yy); g.lineTo(x * 16 + 16, yy); } g.stroke(); }); }
    });
  }
  function gridTex(D, arr, rgb) { const d = new Uint8Array(D.NX * D.NY * 4); for (let i = 0; i < D.NX * D.NY; i++) { const y = (i / D.NX) | 0, x = i % D.NX, k = ((D.NY - 1 - y) * D.NX + x) * 4, v = Math.max(0, Math.min(1, arr[i])); d[k] = rgb[0]; d[k + 1] = rgb[1]; d[k + 2] = rgb[2]; d[k + 3] = v * 255; } const t = new THREE.DataTexture(d, D.NX, D.NY, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; }

  // ---------- wind streamlines: a few soft flowing lines (no per-cell arrows) ----------
  const NSTR = 34, TRAIL = 26;
  // each streamline is a thin ribbon (quad per trail step) that fades toward its tail
  const NV = NSTR * TRAIL * 2, strGeo = new THREE.BufferGeometry(), sIdx = [];
  for (let n = 0; n < NSTR; n++) for (let k = 0; k < TRAIL - 1; k++) { const q = (n * TRAIL + k) * 2; sIdx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  strGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NV * 3), 3));
  strGeo.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(NV), 1)); strGeo.setIndex(sIdx);
  const strMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uCol: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: 'attribute float aA; varying float vA; void main(){ vA=aA; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uCol; varying float vA; void main(){ gl_FragColor=vec4(uCol,vA*.85); }' });
  const streams = new THREE.Mesh(strGeo, strMat); streams.frustumCulled = false; streams.renderOrder = 5; scene.add(streams);
  let strS = [];
  const callout = document.createElement('div'); callout.className = 't3-callout'; callout.hidden = true; stage.appendChild(callout); let picked = null, pickables = [], objs = [];
  function clearOverlays() { while (groupO.children.length) { const c = groupO.children.pop(); c.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); if (o.material && !o.material.userData.shared) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); } standMeshes = []; pickables = []; objs = []; }
  function buildOverlays() {
    const D = G.D; clearOverlays();
    const span = Math.max(D.wm, D.hm), arrowS = span / 90;
    // buck routes: flat yellow hoof prints lying on the ground, walking each route in its travel direction (instanced)
    G.tracks = []; G.trackT0 = null;
    if (layers.routes) {
      const C = hoofCfg(), rs = D.routes.slice().sort((a, b) => b.length - a.length).slice(0, 4);
      rs.forEach((r, ri) => {
        const rev = D.phase === 'morning' || D.phase === 'midday', path = rev ? r.slice().reverse() : r;
        const v = []; for (let k = 0; k < path.length; k += 3) v.push(P(D, (path[k] % D.NX) + 0.5, ((path[k] / D.NX) | 0) + 0.5, 0));
        const last = path[path.length - 1]; v.push(P(D, (last % D.NX) + 0.5, ((last / D.NX) | 0) + 0.5, 0)); if (v.length < 2) return;
        const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal'), n = Math.max(2, Math.round(curve.getLength() / C.stepSpacingM)) + 1, pose = [];
        const im = new THREE.InstancedMesh(objGeo().hoof, hoofMat(), n); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const clampG = (a, m) => Math.max(0, Math.min(m - 1, a));
        for (let k = 0; k < n; k++) {
          const u = k / (n - 1), c = curve.getPointAt(u), tg = curve.getTangentAt(u), off = C.printSizeM * 0.45 * (k % 2 ? 1 : -1);
          const gx = clampG(((c.x + tg.z * off) / D.wm + 0.5) * D.NX, D.NX), gy = clampG(((c.z - tg.x * off) / D.hm + 0.5) * D.NY, D.NY), e = 0.6;
          const p0 = P(D, gx, gy, 0), px = P(D, clampG(gx + e, D.NX), gy, 0).sub(P(D, clampG(gx - e, D.NX), gy, 0)), pz = P(D, gx, clampG(gy + e, D.NY), 0).sub(P(D, gx, clampG(gy - e, D.NY), 0));
          const nrm = new THREE.Vector3().crossVectors(pz, px).normalize(); if (nrm.y < 0) nrm.negate();
          const f = tg.clone().sub(nrm.clone().multiplyScalar(tg.dot(nrm))).normalize(), zA = f.clone().negate(), xA = new THREE.Vector3().crossVectors(nrm, zA).normalize();
          const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, nrm, zA));
          pose.push({ p: p0, q, gx, gy }); im.setMatrixAt(k, new THREE.Matrix4().makeScale(0, 0, 0));
        }
        im.renderOrder = 4; im.frustumCulled = false; groupO.add(im);
        G.tracks.push({ im, pose, delay: ri * C.staggerSec, dim: D.phase === 'midday' ? 0.6 : 1 });
      });
    }
    // scent: one soft plume from each stand, following that stand's air path (width drawn as a display shape)
    G.cones = [];
    if (layers.scent) D.stands.forEach((s, k) => {
      const pts = (s.plume && s.plume.pts) || []; if (pts.length < 2) return;
      let n = Math.min(pts.length, 160); for (let i = 0; i < n; i++) if (pts[i].x < 0 || pts[i].y < 0 || pts[i].x > D.NX - 1 || pts[i].y > D.NY - 1) { n = i; break; } const pos = [], al = [], dd = [], idx = [], wmax = span / 7;
      for (let i = 0; i < n; i++) {
        const p = pts[i], c = P(D, p.x, p.y, span / 110), w = Math.min(wmax, span / 300 + i / n * wmax), pa0 = pts[Math.max(0, i - 3)], pb0 = pts[Math.min(n - 1, i + 3)], tdx = (pb0.x - pa0.x) * D.wm / D.NX, tdy = (pb0.y - pa0.y) * D.hm / D.NY, nx = -tdy, ny = tdx, L = Math.hypot(nx, ny) || 1;
        const ex = nx / L * w, ez = ny / L * w, cl = (gx, gy) => [Math.max(0, Math.min(D.NX - 1, gx)), Math.max(0, Math.min(D.NY - 1, gy))];
        const lg = cl((c.x - ex) / D.wm * D.NX + D.NX / 2, (c.z - ez) / D.hm * D.NY + D.NY / 2), rg = cl((c.x + ex) / D.wm * D.NX + D.NX / 2, (c.z + ez) / D.hm * D.NY + D.NY / 2);
        const lp = P(D, lg[0], lg[1], span / 160), rp = P(D, rg[0], rg[1], span / 160);
        pos.push(lp.x, lp.y, lp.z, rp.x, rp.y, rp.z);
        const a = (1 - i / n) * (k === D.sel ? 0.55 : 0.32); al.push(a, a); dd.push(i / n, i / n);
        if (i) { const q = 2 * i; idx.push(q - 2, q - 1, q, q - 1, q + 1, q); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.Float32BufferAttribute(al, 1)); g.setAttribute('aD', new THREE.Float32BufferAttribute(dd, 1)); g.setIndex(idx);
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uReach: { value: 1 } },
        vertexShader: 'attribute float aA; attribute float aD; varying float vA; varying float vD; void main(){ vA=aA; vD=aD; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'uniform float uReach; varying float vA; varying float vD; void main(){ float tip=1.-smoothstep(uReach-.12,uReach,vD); gl_FragColor=vec4(' + glsl(PALETTE.scent) + ',vA*tip); }' });
      const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 3; groupO.add(mesh); G.cones.push({ m, k });
    });
    // walk-in
    if (D.walk && D.walk.path && D.walk.path.length > 1) {
      const v = D.walk.path.map(i => P(D, (i % D.NX) + 0.5, ((i / D.NX) | 0) + 0.5, span / 140));
      const L = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineDashedMaterial({ color: PALETTE.walkIn, dashSize: span / 90, gapSize: span / 140 }));
      L.computeLineDistances(); L.renderOrder = 6; groupO.add(L); G.walkLine = L;
    } else G.walkLine = null;
    // ---------- 3D objects: all sit on the terrain at their true spot (base = ground height x exaggeration) ----------
    const O3 = objCfg(), us = span * O3.scale, ground = (gx, gy) => P(D, gx, gy, 0);
    const pick = (obj, info) => { obj.userData.pick = info; obj.traverse(m => { if (m.isMesh) { m.userData.pick = info; pickables.push(m); } }); };
    const place = (obj, gx, gy, s, yaw) => { obj.position.copy(ground(gx, gy)); obj.scale.setScalar(s); obj.rotation.y = yaw || 0; obj.userData.gx = gx; obj.userData.gy = gy; groupO.add(obj); return obj; };
    // stands: ladder / tree stands and ground blinds, colored by the stand rule
    D.stands.forEach((s, k) => {
      const col = SCOL[s.color] || 0xcccccc, isBlind = /blind/i.test(s.name) || s.kind === 'blind';
      const m = place(isBlind ? blind(col) : (k % 2 ? treeStand(col) : ladderStand(col)), s.x, s.y, us * (isBlind ? 1.3 : 1.6), 0);
      m.userData.k = k; standMeshes.push(m); objs.push(m);
      pick(m, { kind: 'stand', k, name: s.name, why: (D.why && D.why[k]) || '' });
      if (k === D.sel) { const ring = new THREE.Mesh(objGeo().disc, new THREE.MeshBasicMaterial({ color: PALETTE.select })); ring.scale.setScalar(us * 1.1); ring.position.copy(ground(s.x, s.y)).add(new THREE.Vector3(0, us * 0.05, 0)); groupO.add(ring); }
    });
    // bedding and food: subtle markers (bedded-deer silhouette / crop clump), instanced
    const zcells = (ch) => { const out = []; for (let y = 0; y < D.ROWS; y++) for (let x = 0; x < D.COLS; x++) if (D.map.cells[y * D.COLS + x] === ch && (x + y) % 3 === 0) out.push([x * D.K + D.K / 2, y * D.K + D.K / 2]); return out.slice(0, O3.maxZoneMarkers); };
    const inst = (geo, color, cells, s, kind, name, why, yOff) => { if (!cells.length) return;
      const im = new THREE.InstancedMesh(geo, mat(color), cells.length), q = new THREE.Matrix4();
      cells.forEach((c, i) => { const p = ground(c[0], c[1]); q.compose(new THREE.Vector3(p.x, p.y + s * (yOff || 0), p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i * 1.7) % 6.28, 0)), new THREE.Vector3(s, s * 0.55, s * 1.6)); im.setMatrixAt(i, q); });
      im.userData.cells = cells; im.userData.kind = kind; groupO.add(im); pick(im, { kind, k: 0, name, why }); objs.push(im); return im; };
    const o = objGeo();
    inst(o.ico, PALETTE.beddingMark, zcells('B'), us * 0.55, 'bedding', 'Bedding', 'Thick cover where deer lie up by day.', 0.2);   // bedded-deer body
    inst(o.cone, PALETTE.food, zcells('F'), us * 0.45, 'food', 'Food', 'Where deer feed, mostly at dusk and night.', 0.5);   // crop clump
    // north marker
    const nm = place(northMarker(), D.NX / 2, 1, us * 1.4, 0); pick(nm, { kind: 'north', k: 0, name: 'North', why: 'This way is north.' }); objs.push(nm);
    // wind vane floating above the land (wind layer)
    G.vane = windVane(); G.vane.visible = layers.wind && !D.calm; G.vane.scale.setScalar(us * 2.2);
    { const top = P(D, D.NX * 0.12, D.NY * 0.12, 0); G.vane.position.set(top.x, relief() * exag + span * 0.08, top.z); G.vane.rotation.y = Math.atan2(-D.windTo[0], -D.windTo[1]); }
    groupO.add(G.vane); pick(G.vane, { kind: 'wind', k: 0, name: 'Wind', why: D.calm ? 'Calm air.' : 'The arrow shows which way the wind is blowing.' });
    // seeds
    strS = []; for (let k = 0; k < NSTR; k++) strS.push({ x: Math.random() * D.NX, y: Math.random() * D.NY, age: Math.random() * 200, tr: [] });
    applyLayers(D); if (picked) showCallout();
  }
  function lighting(D) {
    const el = D.sunEl, night = el < -2 ? 1 : el < 4 ? (4 - el) / 6 : 0, az = (D.sunAz || 200) * Math.PI / 180, alt = Math.max(el, 12) * Math.PI / 180;
    U.uLight.value.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)); U.uNight.value = night;
    scene.background = new THREE.Color().setHSL(0.58, 0.35, 0.72 - 0.55 * night);
    sunL.position.copy(U.uLight.value).multiplyScalar(1000); sunL.intensity = 2.2 * (1 - night * 0.7); hemiL.intensity = 1.6 * (1 - night * 0.5);

  }
  function loadAerial(D) {
    if (!D.aerial) { U.uHasA.value = 0; return; }
    if (D.aerial === aerialURL && aerialTex) { U.uHasA.value = 1; return; }
    aerialURL = D.aerial;
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(D.aerial, t => {
      if (dead || aerialURL !== D.aerial) return; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      if (aerialTex) aerialTex.dispose(); aerialTex = t; U.uA.value = t; U.uHasA.value = 1; if (opt.onAerial) opt.onAerial(true);
    }, undefined, () => { U.uHasA.value = 0; if (opt.onAerial) opt.onAerial(false); });
  }
  function relief() { let mx = 0; const z = G.H.z; for (let k = 0; k < z.length; k++) if (z[k] - G.zmin > mx) mx = z[k] - G.zmin; return mx; }
  function frameCamera(D) { const span = Math.max(D.wm, D.hm), r = relief() * exag; controls.minDistance = span * 0.15; controls.maxDistance = span * 4; controls.target.set(0, r / 2, 0); camera.position.set(-span * 0.27, r + span * 0.6, span * 0.76); controls.update(); }
  // keep the view on the ground when the height setting changes (camera moves up/down only; the ground never moves sideways)
  function refit(oldE) { const r = relief(), d = r * (exag - oldE) / 2; controls.target.y += d; camera.position.y += d; const top = r * exag + Math.max(G.D.wm, G.D.hm) * 0.25; if (camera.position.y < top) camera.position.y = top; controls.update(); }

  function update(D) {   // called by the engine after every recompute
    const newGround = !G || G.key !== D.key;
    if (!G) G = {};
    G.D = D;
    if (D.fineURL && D.fineURL !== fineKey && !D.fine) {
      fineKey = D.fineURL; fetch(D.fineURL).then(r => r.ok ? r.arrayBuffer() : null).then(buf => { if (!buf || dead || !opt.parseTiff) return; const t = opt.parseTiff(buf); let s = 0, c = 0; t.z.forEach(v => { if (v > -500 && v < 9000) { s += v; c++; } }); if (c < t.z.length * 0.8) return; const m = s / c; const z = Float32Array.from(t.z, v => v > -500 && v < 9000 ? v : m); fine = { nx: t.w, ny: t.h, z, key: D.key }; G.key = null; update(G.D); }).catch(() => {});
    }
    if (fine && fine.key === D.key) D.fine = fine;
    if (newGround || G.fineUsed !== !!D.fine) {
      G.key = D.key; G.fineUsed = !!D.fine; buildGround(D);
      if (U.uMark.value) U.uMark.value.dispose(); U.uMark.value = markTex(D);
      if (U.uPool.value) U.uPool.value.dispose(); const low = new Float32Array(D.NX * D.NY); for (let i = 0; i < low.length; i++) low[i] = Math.max(0, D.low[i]) / Math.max(0.5, D.lowMax); U.uPool.value = gridTex(D, low, [255, 255, 255]);
      if (newGround && !G.framed) { frameCamera(D); G.framed = true; }
    }
    loadAerial(D);
    buildOverlays(); lighting(D);
  }
  function setExag(e) { const o = exag; exag = e; if (G && G.D) { buildGround(G.D); buildOverlays(); refit(o); } }

  function applyLayers(D) {
    streams.visible = layers.wind; if (G && G.vane) G.vane.visible = layers.wind && !D.calm;
    const TH = Object.assign({}, THERMAL, (typeof window !== 'undefined' && window.BL_THERMAL) || {}); U.uThermOp.value = TH.opacity; U.uThermSp.value = TH.flowSpeed;
    U.uTherm.value = layers.thermals ? 1 : 0; U.uThermDir.value = D.mode === 'down' ? 1 : D.mode === 'up' ? -1 : 0; U.uPoolOn.value = layers.thermals && D.mode === 'down' ? 1 : 0;
  }
  // ---------- animation ----------
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  let lastT = null;
  function tick(ts) {
    if (dead) return; raf = requestAnimationFrame(tick); const t = (ts || 0) / 1000, dt = Math.min(0.1, lastT == null ? 0 : t - lastT); lastT = t; U.uTime.value = t;
    if (G && G.D) {
      const D = G.D, span = Math.max(D.wm, D.hm);
      if (layers.wind) {   // slow streamlines that follow the near-ground air (wind + slope air)
        const pa = strGeo.attributes.position.array, aa = strGeo.attributes.aA.array; let q = 0;
        strS.forEach(p => { p.age++;
          const i = Math.min(D.NY - 1, Math.max(0, p.y | 0)) * D.NX + Math.min(D.NX - 1, Math.max(0, p.x | 0)), v = D.flowAt(i), sp = Math.hypot(v[0], v[1]);
          if (sp < 0.03 || p.age > 220 || p.x < 0 || p.y < 0 || p.x >= D.NX || p.y >= D.NY) { p.x = Math.random() * D.NX; p.y = Math.random() * D.NY; p.age = 0; p.tr = []; }
          else { const st = motionCfg().windCellsPerSec * dt; p.x += v[0] / sp * st; p.y += v[1] / sp * st; }
          if (p.age % 2 === 0) { p.tr.push(P(D, p.x, p.y, span / 40)); if (p.tr.length > TRAIL) p.tr.shift(); }
          const f = Math.min(1, p.age / 30) * Math.min(1, (220 - p.age) / 30), w = span / 260, n0 = p.tr.length;
          for (let k = 0; k < TRAIL; k++) { const o = (q * TRAIL + k) * 2, j = k - (TRAIL - n0);
            if (j < 0) { aa[o] = aa[o + 1] = 0; const z = p.tr[0]; if (z) { pa.set([z.x, z.y, z.z, z.x, z.y, z.z], o * 3); } continue; }
            const c = p.tr[j], d = p.tr[Math.min(n0 - 1, j + 1)], e = p.tr[Math.max(0, j - 1)]; let dx = d.x - e.x, dz = d.z - e.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
            pa.set([c.x - dz * w, c.y, c.z + dx * w, c.x + dz * w, c.y, c.z - dx * w], o * 3); aa[o] = aa[o + 1] = (k / TRAIL) * f; }
          q++; });
        strGeo.attributes.position.needsUpdate = true; strGeo.attributes.aA.needsUpdate = true;
        strMat.uniforms.uCol.value.set(PALETTE.wind);
      }
      if (G.cones && G.cones.length) {   // telescoping scent cones: slow eased pulse downwind, each stand offset
        const M = motionCfg();
        G.cones.forEach(c => { const ph = ((t + c.k * M.scentStandOffsetSec) % M.scentPulseSec) / M.scentPulseSec, e = easeIO(ph < 0.5 ? ph * 2 : (1 - ph) * 2);
          c.m.uniforms.uReach.value = M.scentMinReach + (1.12 - M.scentMinReach) * e; });
      }
      if (G.tracks && G.tracks.length) {   // walking cadence: one new print at the front each step, the oldest one leaves the tail the same step,
        const C = hoofCfg(), mm = new THREE.Matrix4(), sv = new THREE.Vector3(), zero = new THREE.Vector3(0, 0, 0); if (G.trackT0 == null) G.trackT0 = t;   // so the trail keeps a constant length
        G.tracks.forEach(tr => { const n = tr.pose.length, cyc = Math.max((n + C.trailLength) / C.stepsPerSec + C.pauseSec, G.tracks.length * C.staggerSec), el = t - G.trackT0 - tr.delay;
          const step = el < 0 ? -1 : Math.floor((el % cyc) * C.stepsPerSec); let vis = 0; sv.setScalar(C.printSizeM);
          tr.pose.forEach((ps, k) => { const age = step - k, on = age >= 0 && age < C.trailLength; if (on) vis++; mm.compose(ps.p, ps.q, on ? sv : zero); tr.im.setMatrixAt(k, mm); });
          tr.vis = vis; tr.front = step; tr.im.instanceMatrix.needsUpdate = true; });
      }
      if (G.walkLine) G.walkLine.material.dashOffset = -t * span / 60;
      if (G.ring) G.ring.lookAt(camera.position);
    }
    controls.update(); renderer.render(scene, camera); placeCallout();
  }
  raf = requestAnimationFrame(tick);
  // tap / click: pick the 3D object under the finger; a small 3D-anchored callout gives its name and plain-word reason
  function pickAt(nx, ny) {
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hit = raycaster.intersectObjects(pickables, false)[0], info = hit && hit.object.userData.pick;
    if (!info) {   // bare ground: show the Field Tip for that kind of spot (water, bottom, field, woods, slope)
      const g = G && G.ground && opt.tipAt ? raycaster.intersectObject(G.ground, false)[0] : null, D = G && G.D;
      const tip = g ? opt.tipAt((g.point.x / D.wm + 0.5) * D.NX, (g.point.z / D.hm + 0.5) * D.NY) : null;
      if (!tip) { picked = null; callout.hidden = true; return null; }
      picked = { kind: 'tip', point: g.point.clone(), tip }; showCallout(); return { kind: 'tip', type: tip.type, name: tip.title, why: tip.text };
    }
    picked = { kind: info.kind, k: info.k, inst: hit.instanceId == null ? null : hit.instanceId };
    if (info.kind === 'stand' && opt.onPick && G.D.sel !== info.k) opt.onPick(info.k); else showCallout();
    return Object.assign({}, info);
  }
  function pickedObj() { if (!picked) return null; return objs.find(o => o.userData.pick && o.userData.pick.kind === picked.kind && o.userData.pick.k === picked.k) || (picked.kind === 'wind' ? G.vane : null); }
  function showCallout() {
    if (picked && picked.kind === 'tip') { callout.className = 't3-callout tip'; callout.innerHTML = '<b></b><span></span>'; callout.firstChild.textContent = 'Field tip: ' + picked.tip.title; callout.lastChild.textContent = picked.tip.text; callout.hidden = false; placeCallout(); return; }
    callout.className = 't3-callout'; const o = pickedObj(); if (!o) { callout.hidden = true; return; } const i = o.userData.pick;
    callout.innerHTML = '<b></b><span></span>'; callout.firstChild.textContent = i.name; callout.lastChild.textContent = i.why || ''; callout.hidden = false; placeCallout(); }
  function anchorOf(o) { const v = new THREE.Vector3(); if (o.isInstancedMesh) { const m = new THREE.Matrix4(); o.getMatrixAt(picked && picked.inst != null ? picked.inst : 0, m); v.setFromMatrixPosition(m); } else { const b = new THREE.Box3().setFromObject(o); v.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2); } return v; }
  function placeCallout() { if (callout.hidden) return; const o = picked && picked.kind === 'tip' ? null : pickedObj(); if (!o && !(picked && picked.kind === 'tip')) { callout.hidden = true; return; } const v = (o ? anchorOf(o) : picked.point.clone()).project(camera), w = canvas.clientWidth, h = canvas.clientHeight;
    callout.style.left = Math.round((v.x + 1) / 2 * w) + 'px'; callout.style.top = Math.round((1 - v.y) / 2 * h) + 'px'; }
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => { if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) return; const r = canvas.getBoundingClientRect(); pickAt((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); });
  return {
    update, setExag, canvas,
    view: (k) => { const D = G && G.D; if (!D) return; const span = Math.max(D.wm, D.hm); if (k === 'top') camera.position.set(0, span * 1.4, span * 0.01); else { const a = Math.atan2(camera.position.x, camera.position.z) + Math.PI / 4, r = Math.hypot(camera.position.x, camera.position.z); camera.position.set(Math.sin(a) * r, camera.position.y, Math.cos(a) * r); } controls.update(); },
    groundTop: () => G && G.ground ? (G.ground.geometry.computeBoundingBox(), G.ground.geometry.boundingBox.max.y) : 0,
    // alignment probes for tests: nearest ground vertex (position + photo coordinate) and the drawn stand spots
    probe: (gx, gy) => { const H = G.H, D = G.D, j = Math.max(0, Math.min(H.nx - 1, Math.round(gx / D.NX * H.nx - 0.5))), i = Math.max(0, Math.min(H.ny - 1, Math.round(gy / D.NY * H.ny - 0.5))), k = i * H.nx + j,
      pa = G.ground.geometry.attributes.position.array, ua = G.ground.geometry.attributes.uv.array;
      return { gx: (j + 0.5) / H.nx * D.NX, gy: (i + 0.5) / H.ny * D.NY, x: pa[3 * k], y: pa[3 * k + 1], z: pa[3 * k + 2], u: ua[2 * k], v: ua[2 * k + 1], zTrue: H.z[k], zmin: G.zmin, wm: D.wm, hm: D.hm, exag }; },
    objects: () => objs.concat(G && G.vane ? [G.vane] : []).map(o => { const i = o.userData.pick || {}, out = { kind: i.kind, k: i.k, name: i.name, instanced: !!o.isInstancedMesh, flat: false, meshes: 0, sprites: 0 };
      out.colors = []; o.traverse(m => { if (m.isMesh) { out.meshes++; const h = m.material.color && m.material.color.getHex(); if (h != null && out.colors.indexOf(h) < 0) out.colors.push(h); } if (m.isSprite) out.sprites++; });
      if (o.isInstancedMesh) { const m = new THREE.Matrix4(), v = new THREE.Vector3(); out.count = o.count; out.pts = o.userData.cells.map((c, j) => { o.getMatrixAt(j, m); v.setFromMatrixPosition(m); return { x: v.x, y: v.y, z: v.z, gx: c[0], gy: c[1], gyTrue: P(G.D, c[0], c[1], 0).y }; }); }
      else { out.x = o.position.x; out.y = o.position.y; out.z = o.position.z; out.gx = o.userData.gx; out.gy = o.userData.gy; if (out.gx != null) { const g = P(G.D, out.gx, out.gy, 0); out.groundX = g.x; out.groundY = g.y; out.groundZ = g.z; } }
      const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()).project(camera); out.screen = [(c.x + 1) / 2 * canvas.clientWidth, (1 - c.y) / 2 * canvas.clientHeight]; return out; }),
    sprites: () => { let n = 0; scene.traverse(o => { if (o.isSprite) n++; }); return n; },
    hoofTilt: () => (G && G.tracks || []).map(t => t.pose.map(ps => { const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ps.q), e = 0.6, cl = (a, m) => Math.max(0, Math.min(m - 1, a)), D = G.D;
      const px = P(D, cl(ps.gx + e, D.NX), ps.gy, 0).sub(P(D, cl(ps.gx - e, D.NX), ps.gy, 0)), pz = P(D, ps.gx, cl(ps.gy + e, D.NY), 0).sub(P(D, ps.gx, cl(ps.gy - e, D.NY), 0)), n = new THREE.Vector3().crossVectors(pz, px).normalize();
      return { dot: Math.abs(up.dot(n)), dy: ps.p.y - P(D, ps.gx, ps.gy, 0).y }; })).flat(),
    focus: (kind, k, d) => { const o = objs.find(x => x.userData.pick && x.userData.pick.kind === kind && x.userData.pick.k === k); if (!o) return false; const span = Math.max(G.D.wm, G.D.hm), r = span * (d || 0.16);
      controls.target.copy(o.position); camera.position.copy(o.position).add(new THREE.Vector3(-r * 0.55, r * 0.55, r * 0.75)); controls.update(); return true; },
    grid: () => { const D = G.D; return { NX: D.NX, NY: D.NY, K: D.K, COLS: D.COLS, ROWS: D.ROWS, cells: D.map.cells }; },
    tap: (nx, ny) => pickAt(nx, ny), screenOfGrid: (gx, gy) => { const v = P(G.D, gx, gy, 0).project(camera); return [(v.x + 1) / 2 * canvas.clientWidth, (1 - v.y) / 2 * canvas.clientHeight]; }, callout: () => callout.hidden ? null : { text: callout.textContent, name: callout.firstChild && callout.firstChild.textContent, why: callout.lastChild && callout.lastChild.textContent, left: callout.style.left, top: callout.style.top },
    stands: () => standMeshes.map(m => ({ k: m.userData.k, x: m.position.x, z: m.position.z, sx: G.D.stands[m.userData.k].x, sy: G.D.stands[m.userData.k].y })),
    setLayers: (o) => { Object.assign(layers, o || {}); if (G && G.D) { buildOverlays(); lighting(G.D); applyLayers(G.D); } }, layers: () => Object.assign({}, layers),
    counts: () => ({ routeTracks: (G && G.tracks || []).length, hoofPrints: (G && G.tracks || []).reduce((a, t) => a + t.pose.length, 0), trails: (G && G.tracks || []).map(t => ({ vis: t.vis || 0, front: t.front == null ? -1 : t.front, n: t.pose.length })), hoofConfig: hoofCfg(), motion: motionCfg(), coneReach: (G && G.cones || []).map(c => +c.m.uniforms.uReach.value.toFixed(3)), visiblePrints: (G && G.tracks || []).reduce((a, t) => a + (t.vis || 0), 0), plumes: groupO.children.filter(c => c.renderOrder === 3).length, streamlines: layers.wind ? NSTR : 0, lit: strGeo.attributes.aA.array.filter(a => a > 0).length, vis: streams.visible, arrows: 0 }),
    hoof: hoofCfg,
    hasAerial: () => U.uHasA.value > 0.5, usesFine: () => !!(G && G.fineUsed),
    destroy: () => { dead = true; callout.remove(); cancelAnimationFrame(raf); window.removeEventListener('resize', size); controls.dispose(); renderer.dispose(); canvas.remove(); }
  };
}
