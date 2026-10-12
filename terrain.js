/* Buck Ledger 3D Terrain Sim (Elite). Canvas painter renderer, phone first.
 * Elevation: USGS 3DEP (fetched once, on a tap, for your property box; US only), cached on the phone.
 * Air: hourly wind/cloud/temp for the picked day (Open-Meteo, on a tap) or your own wind pick.
 * Physics (all labeled in the research doc):
 *   - Pasquill-Gifford stability class by Turner's method (EPA-454/R-99-005, Tables 6-4..6-6)
 *   - Briggs (1973) open-country plume spread, Gaussian plume ground level (Turner 1970)
 *   - Thermals: daytime upslope / night downslope (cold-air drainage) flow, blended with the wind
 *   - Deer routes: least-cost paths between YOUR bedding and food marks over the real slope
 * Rules: no numbers, no graphs and no trail-cam photos inside the 3D view. Plain words only. */
(function () {
  'use strict';
  var COLS = 20, ROWS = 26, K = 4, NX = COLS * K, NY = ROWS * K, D2R = Math.PI / 180;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- 3DEP: box, URL, TIFF ---------- */
  // box: { lat, lng, acres } -> bbox around the centre, aspect = 2D map (20 wide x 26 tall), north up
  // Elevation and aerial photo are both requested in Web Mercator (EPSG:3857) for the SAME box. In 3857 a ground box with the
  // map's shape keeps square pixels, so the USGS servers return exactly the box asked for (in lat/long degrees they widen it
  // to keep pixels square, which would shift things). The box is sized in true ground metres at the property's latitude.
  var RM = 6378137;
  function merc(lat, lng) { return [RM * lng * D2R, RM * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2))]; }
  function bbox(box) {
    var area = box.acres * 4046.86, w = Math.sqrt(area / (ROWS / COLS)), h = w * ROWS / COLS;
    var dLat = h / 2 / 111320, dLng = w / 2 / (111320 * Math.cos(box.lat * D2R));
    var c = merc(box.lat, box.lng), k = 1 / Math.cos(box.lat * D2R);   // 3857 metres per ground metre at this latitude
    return { w: box.lng - dLng, s: box.lat - dLat, e: box.lng + dLng, n: box.lat + dLat, wm: w, hm: h,
      mx0: c[0] - w / 2 * k, my0: c[1] - h / 2 * k, mx1: c[0] + w / 2 * k, my1: c[1] + h / 2 * k, k: k };
  }
  function mercBox(b) { return [b.mx0, b.my0, b.mx1, b.my1].map(function (v) { return v.toFixed(2); }).join(','); }
  function demURL(box, nx, ny) {
    var b = bbox(box);
    return 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=' + mercBox(b) +
      '&bboxSR=3857&imageSR=3857&size=' + (nx || NX) + ',' + (ny || NY) + '&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&compression=None&f=image';
  }
  function imageURL(box, nx, ny) {
    var b = bbox(box);
    return 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export?bbox=' + mercBox(b) +
      '&bboxSR=3857&imageSR=3857&size=' + (nx || 1536) + ',' + (ny || 1997) + '&format=jpg&f=image';
  }
  function parseTiff(buf) {
    var v = new DataView(buf), le;
    var bo = v.getUint16(0); if (bo === 0x4949) le = true; else if (bo === 0x4d4d) le = false; else throw new Error('not a TIFF');
    if (v.getUint16(2, le) !== 42) throw new Error('not a classic TIFF');
    var ifd = v.getUint32(4, le), n = v.getUint16(ifd, le), T = {};
    var SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 8: 2, 9: 4, 11: 4, 12: 8, 16: 8 };
    for (var i = 0; i < n; i++) {
      var e = ifd + 2 + i * 12, tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), cnt = v.getUint32(e + 4, le), sz = SZ[type] || 1;
      var off = cnt * sz <= 4 ? e + 8 : v.getUint32(e + 8, le), vals = [];
      for (var k = 0; k < Math.min(cnt, 1e6); k++) {
        var o = off + k * sz;
        vals.push(type === 3 || type === 8 ? v.getUint16(o, le) : type === 4 || type === 9 ? v.getUint32(o, le) : type === 1 || type === 2 || type === 6 ? v.getUint8(o) : type === 11 ? v.getFloat32(o, le) : type === 12 ? v.getFloat64(o, le) : 0);
      }
      T[tag] = vals;
    }
    var W = T[256][0], H = T[257][0], bps = (T[258] || [32])[0], comp = (T[259] || [1])[0], fmt = (T[339] || [3])[0], spp = (T[277] || [1])[0];
    if (comp !== 1) throw new Error('compressed TIFF not supported');
    if (bps !== 32 || fmt !== 3 || spp !== 1) throw new Error('expected one float32 band');
    var out = new Float32Array(W * H);
    if (T[322]) {   // tiled
      var tw = T[322][0], th = T[323][0], offs = T[324], across = Math.ceil(W / tw);
      offs.forEach(function (o, t) {
        var tx = (t % across) * tw, ty = Math.floor(t / across) * th;
        for (var y = 0; y < th; y++) for (var x = 0; x < tw; x++) {
          var X = tx + x, Y = ty + y; if (X >= W || Y >= H) continue;
          out[Y * W + X] = v.getFloat32(o + (y * tw + x) * 4, le);
        }
      });
    } else {        // strips
      var rps = (T[278] || [H])[0], so = T[273];
      so.forEach(function (o, s) { for (var y = 0; y < rps; y++) { var Y = s * rps + y; if (Y >= H) break; for (var x = 0; x < W; x++) out[Y * W + x] = v.getFloat32(o + (y * W + x) * 4, le); } });
    }
    return { w: W, h: H, z: out };
  }
  // clean elevation: fill noData from neighbours; null if mostly missing (outside the US)
  function cleanDem(d) {
    if (!d || d.w !== NX || d.h !== NY) return null;
    var z = Float32Array.from(d.z), bad = 0, i;
    for (i = 0; i < z.length; i++) if (!(z[i] > -500 && z[i] < 9000)) { z[i] = NaN; bad++; }
    if (bad > z.length * 0.2) return null;
    for (var pass = 0; pass < 50 && bad; pass++) {
      bad = 0;
      for (i = 0; i < z.length; i++) if (isNaN(z[i])) {
        var x = i % NX, y = (i / NX) | 0, s = 0, c = 0;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) { var X = x + o[0], Y = y + o[1]; if (X >= 0 && Y >= 0 && X < NX && Y < NY && !isNaN(z[Y * NX + X])) { s += z[Y * NX + X]; c++; } });
        if (c) z[i] = s / c; else bad++;
      }
    }
    return z;
  }
  // Example terrain for the demo: made up, smooth ridge + draw. NOT a real place.
  function exampleDem() {
    var z = new Float32Array(NX * NY), E = window.BL_EXAMPLE;
    if (E && E.zdm && E.zdm.length === NX * NY) { for (var k = 0; k < NX * NY; k++) z[k] = E.zdm[k] / 10; return z; }
    for (var y = 0; y < NY; y++) for (var x = 0; x < NX; x++) {
      var u = x / NX, w = y / NY;
      z[y * NX + x] = 120 + 22 * Math.sin(u * 3.1 + 0.4) * Math.cos(w * 2.2) + 14 * Math.exp(-((u - 0.7) * (u - 0.7) + (w - 0.3) * (w - 0.3)) / 0.03) - 10 * Math.exp(-Math.pow(u - 0.35 - 0.1 * Math.sin(w * 6), 2) / 0.004) + 6 * w;
    }
    return z;
  }

  /* ---------- sun + stability ---------- */
  function sunElev(date, lat, lng) {   // NOAA simplified (degrees), good to ~0.1 deg
    var jd = date.getTime() / 864e5 + 2440587.5, n = jd - 2451545, L = (280.46 + 0.9856474 * n) % 360, g = (357.528 + 0.9856003 * n) * D2R;
    var lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * n) * D2R;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam)), ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    var gmst = (18.697374558 + 24.06570982441908 * n) % 24, ha = (gmst * 15 + lng) * D2R - ra;
    return Math.asin(Math.sin(lat * D2R) * Math.sin(dec) + Math.cos(lat * D2R) * Math.cos(dec) * Math.cos(ha)) / D2R;
  }
  var TURNER = [[1, 1, 2, 3, 4, 6, 7], [1, 2, 2, 3, 4, 6, 7], [1, 2, 3, 4, 4, 5, 6], [2, 2, 3, 4, 4, 5, 6], [2, 2, 3, 4, 4, 4, 5], [2, 3, 3, 4, 4, 4, 5], [3, 3, 4, 4, 4, 4, 5], [3, 3, 4, 4, 4, 4, 4], [3, 4, 4, 4, 4, 4, 4]];
  function stability(u10, elev, cloudPct, nightish) {   // 1=A (very unstable) .. 6=F (very stable)
    var kt = Math.round(u10 / 0.514444), row = kt <= 1 ? 0 : kt <= 3 ? 1 : kt <= 5 ? 2 : kt === 6 ? 3 : kt === 7 ? 4 : kt <= 9 ? 5 : kt === 10 ? 6 : kt === 11 ? 7 : 8;
    var ct = Math.round(clamp(cloudPct, 0, 100) / 10), nri;
    if (nightish) nri = ct <= 4 ? -2 : -1;
    else { var ic = elev > 60 ? 4 : elev > 35 ? 3 : elev > 15 ? 2 : 1; nri = ct <= 5 ? ic : Math.max(1, ic - 1 - (ct >= 10 ? 1 : 0)); }   // ceiling unknown: treated as mid-level cloud
    return Math.min(6, TURNER[row][[4, 3, 2, 1, 0, -1, -2].indexOf(nri)]);
  }
  function briggs(cls, x) {
    var r = Math.pow(1 + 0.0001 * x, -0.5);
    switch (cls) {
      case 1: return { sy: 0.22 * x * r, sz: 0.20 * x };
      case 2: return { sy: 0.16 * x * r, sz: 0.12 * x };
      case 3: return { sy: 0.11 * x * r, sz: 0.08 * x * Math.pow(1 + 0.0002 * x, -0.5) };
      case 4: return { sy: 0.08 * x * r, sz: 0.06 * x * Math.pow(1 + 0.0015 * x, -0.5) };
      case 5: return { sy: 0.06 * x * r, sz: 0.03 * x / (1 + 0.0003 * x) };
      default: return { sy: 0.04 * x * r, sz: 0.016 * x / (1 + 0.0003 * x) };
    }
  }
  /* Wind-direction spread by stability class. PUBLISHED: EPA-454/R-99-005 (Meteorological Monitoring Guidance for Regulatory
     Modeling Applications) Table 6-9a, sigma-A ranges per class: A >= 22.5, B 17.5-22.5, C 12.5-17.5, D 7.5-12.5, E 3.8-7.5,
     F < 3.8 degrees. The low edge of each range is used (F: its only published edge). The hour is run as a
     small set of wind directions spread across that range (quantiles of a normal spread; the member count is a numerical
     choice, never shown). */
  var SIGMA_A = [0, 22.5, 17.5, 12.5, 7.5, 3.8, 3.8], NMEM = 5;
  function normInv(p) { var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572], q = p - 0.5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  function memberAir(A) {   // central member first
    var out = [A], sg = SIGMA_A[A.cls] || 7.5, k;
    for (k = 0; k < NMEM; k++) {
      var off = normInv((k + 0.5) / NMEM) * sg; if (Math.abs(off) < 1e-6) continue;
      var c = Math.cos(off * D2R), s = Math.sin(off * D2R), B = {}; for (var key in A) B[key] = A[key];
      B.tx = A.tx * c - A.ty * s; B.ty = A.tx * s + A.ty * c; B.off = off; out.push(B);
    }
    return out;
  }
  function chi(cls, x, u, H) { var s = briggs(cls, Math.max(x, 5)); return Math.exp(-H * H / (2 * s.sz * s.sz)) / (Math.PI * s.sy * s.sz * Math.max(u, 0.5)); }
  // No smell distance or threshold: no study gives one. The plume is the path your air takes (wind + cover + slope air)
  // with its sideways spread (Briggs sigma-y), followed until it leaves the property. Stands are rated only by whether that
  // path crosses deer areas (NDA: keep scent from blowing toward deer).

  /* Wind under cover. PUBLISHED: wind adjustment factors (WAF) from USDA Forest Service RMRS-GTR-266 (Andrews 2012),
     Table 6 (BehavePlus / Fireline Handbook): partially sheltered 0.3, fully sheltered sparse stand 0.2, fully sheltered
     dense stand 0.1; unsheltered short fuel 0.4. WAF multiplies the 20-ft wind; a 10-m (33-ft) wind is divided by 1.15 first
     (same report). ESTIMATE: which shelter class each map zone falls in. */
  var WAF = { 'B': 0.1, 'N': 0.2, 'C': 0.2, '.': 0.3, 'X': 0.3, 'F': 0.4, 'W': 0.4, 'R': 0.4 };
  function underCover(u10, zone) { return u10 / 1.15 * (WAF[zone] == null ? 0.3 : WAF[zone]); }

  /* Slope (thermal) air speed, PUBLISHED values only. Downslope (night): about 1 m/s (2.2 mph) on slopes a few hundred
     meters long, 2-3 m/s (4.5-6.7 mph) on slopes 1 km (0.6 mi) or longer (Haiden & Whiteman 2005). Shorter than 1 km uses the
     short-slope value; 1 km+ uses the middle of 2-3. Upslope (day): usually 1-2 m/s (2.2-4.5 mph) (Royal Meteorological
     Society); the middle, 1.5, is used. While the air turns over after sunrise, no slope speed is used (direction unsettled). */
  function slopeFlow(mode, sunEl, runM) {
    if (mode === 'down') return runM >= 1000 ? 2.5 : 1;
    if (mode === 'up') return 1.5;
    return 0;
  }

  /* ---------- terrain fields ---------- */
  function fields(z, wm, hm) {
    var dx = wm / NX, dy = hm / NY, gx = new Float32Array(NX * NY), gy = new Float32Array(NX * NY), sl = new Float32Array(NX * NY), mn = 1e9, mx = -1e9;
    for (var y = 0; y < NY; y++) for (var x = 0; x < NX; x++) {
      var i = y * NX + x, xl = Math.max(0, x - 1), xr = Math.min(NX - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(NY - 1, y + 1);
      gx[i] = (z[y * NX + xr] - z[y * NX + xl]) / ((xr - xl) * dx); gy[i] = (z[yd * NX + x] - z[yu * NX + x]) / ((yd - yu) * dy);
      sl[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]); if (z[i] < mn) mn = z[i]; if (z[i] > mx) mx = z[i];
    }
    // DISPLAY ONLY: low spots, below the mean of the neighbourhood, used to tint cold-air pooling (not in ratings)
    var low = new Float32Array(NX * NY);
    for (y = 0; y < NY; y++) for (x = 0; x < NX; x++) {
      var s = 0, c = 0; for (var oy = -3; oy <= 3; oy++) for (var ox = -3; ox <= 3; ox++) { var X = x + ox, Y = y + oy; if (X >= 0 && Y >= 0 && X < NX && Y < NY) { s += z[Y * NX + X]; c++; } }
      low[y * NX + x] = s / c - z[y * NX + x];
    }
    return { dx: dx, dy: dy, gx: gx, gy: gy, sl: sl, min: mn, max: mx, low: low };
  }
  function zoneAt(map, x, y) { return map ? map.cells[((y / K) | 0) * COLS + ((x / K) | 0)] : '.'; }

  /* ---------- the hour: air flow ---------- */
  // air: { wd (deg, FROM), ws (mph), cc (cloud %), t (F) } ; ctx: { lat, lng, date (hour) }
  function airAt(air, date, lat, lng, rise, set) {
    var u10 = (air.ws || 0) * 0.44704, el = sunElev(date, lat, lng), t = date.getTime();
    var nightish = rise && set ? (t < rise.getTime() + 36e5 || t > set.getTime() - 36e5) : el < 10;
    var cls = stability(u10, el, air.cc == null ? 30 : air.cc, nightish);
    // Downslope at night, upslope by day (RMetS: the flow reverses after sunset). Morning turnover: from sunrise to +60 min
    // (Farina et al. 2023: starts within 30 min of sunrise, lasts 45-60 min in fall; Nadeau et al. 2020). No evening study
    // was verified, so there is no evening window: air switches to downslope at sunset.
    var mode;
    if (rise && set) mode = t < rise.getTime() || t >= set.getTime() ? 'down' : t < rise.getTime() + 60 * 6e4 ? 'mixed' : 'up';
    else mode = el > 0 ? 'up' : 'down';
    var to = (air.wd + 180) * D2R;
    return { u10: u10, el: el, cls: cls, mode: mode, tx: Math.sin(to), ty: -Math.cos(to), calm: u10 < 1.0 };
  }
  function flowAt(F, A, i) {
    // m/s: open wind slowed by cover (published WAF) plus slope air (published speeds), see notes above
    var uw = underCover(A.u10, F.zone ? F.zone[i] : '.'), th = slopeFlow(A.mode, A.el, F.run || 300);
    var sf = F.sl[i] > 1e-4 ? 1 : 0, dir = A.mode === 'up' ? 1 : -1;   // any real tilt (the guard only skips flat cells)
    var gx = F.gx[i], gy = F.gy[i], gl = F.sl[i] || 1;
    var vx = uw * A.tx + th * sf * dir * gx / gl, vy = uw * A.ty + th * sf * dir * gy / gl;
    return [vx, vy];
  }
  // follow the air from (x0,y0) in DEM cells; returns points with distance (m)
  function trace(F, A, x0, y0, maxM) {
    var pts = [], x = x0, y = y0, d = 0, step = Math.min(F.dx, F.dy);
    for (var k = 0; k < 400 && d < maxM; k++) {
      var i = clamp(Math.round(y), 0, NY - 1) * NX + clamp(Math.round(x), 0, NX - 1), v = flowAt(F, A, i), sp = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
      if (sp < 0.05) break;
      x += v[0] / sp * step / F.dx; y += v[1] / sp * step / F.dy; d += step;
      if (x < 0 || y < 0 || x > NX - 1 || y > NY - 1) break;
      pts.push({ x: x, y: y, d: d, u: Math.max(sp, 0.5), nx: -v[1] / sp, ny: v[0] / sp });
    }
    return pts;
  }
  // scent grid from one source; H = height of the scent source (m)
  function plume(F, A, x0, y0, H, maxM) {
    var g = new Float32Array(NX * NY), pts = trace(F, A, x0, y0, maxM || 1e9);
    pts.forEach(function (p) {
      var s = briggs(A.cls, p.d), span = s.sy;   // core of the plume: +/- one sigma-y each side of the air path
      var steps = Math.max(1, Math.ceil(span / F.dx));
      for (var k = -steps; k <= steps; k++) {
        var off = k * span / steps, X = Math.round(p.x + p.nx * off / F.dx), Y = Math.round(p.y + p.ny * off / F.dy);
        if (X < 0 || Y < 0 || X >= NX || Y >= NY) continue;
        var val = Math.exp(-off * off / (2 * s.sy * s.sy)); if (val > g[Y * NX + X]) g[Y * NX + X] = val;   // 0..1 shading only
      }
    });
    return { g: g, pts: pts };
  }

  /* ---------- deer: where they likely are this hour ---------- */
  // Time of day (MSU P3927, direction only): the sunrise hour and sunset hour are the activity peaks (no peak width is
  // published, so only those hours count); daylight between; night outside. Without sun times: clock hour 6 / 18 as stand-ins.
  // The sunrise hour = the hour on the slider that holds sunrise (same for sunset). No minute window is used.
  function phase(date, rise, set) {
    var t = date.getTime(), r = rise ? rise.getTime() : new Date(date).setHours(6, 0, 0, 0), s = set ? set.getTime() : new Date(date).setHours(18, 0, 0, 0), HR = 36e5;
    if (r >= t && r < t + HR) return 'morning';
    if (s >= t && s < t + HR) return 'evening';
    return t > r && t < s ? 'midday' : 'night';
  }
  // Active deer areas by phase (MSU P3927, direction only): night = food + routes; sunrise / sunset hour = bedding, routes,
  // food; daylight = bedding + routes (bedded most by day; "bucks move every day, and they move during daylight hours").
  var ACTIVE = { night: { F: 1, R: 1 }, morning: { B: 1, F: 1, R: 1 }, midday: { B: 1, R: 1 }, evening: { B: 1, F: 1, R: 1 } };
  function comps(map, ch) {   // connected groups of one zone on the 2D map (in map cells)
    var seen = {}, out = [];
    for (var i = 0; i < COLS * ROWS; i++) {
      if (map.cells[i] !== ch || seen[i]) continue;
      var q = [i], cells = []; seen[i] = 1;
      while (q.length) { var j = q.pop(), x = j % COLS, y = (j / COLS) | 0; cells.push(j); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) { var X = x + o[0], Y = y + o[1], n = Y * COLS + X; if (X >= 0 && Y >= 0 && X < COLS && Y < ROWS && !seen[n] && map.cells[n] === ch) { seen[n] = 1; q.push(n); } }); }
      out.push(cells);
    }
    return out;
  }
  function dijkstra(cost, starts) {   // simple binary-heap Dijkstra over DEM cells, 8 neighbours
    var N = NX * NY, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), heap = [];
    function push(d, i) { heap.push([d, i]); var k = heap.length - 1; while (k) { var p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; var t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var k = 0; for (;;) { var l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; var t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m; } } return top; }
    starts.forEach(function (s) { dist[s] = 0; push(0, s); });
    while (heap.length) {
      var it = pop(), d = it[0], i = it[1]; if (d > dist[i]) continue;
      var x = i % NX, y = (i / NX) | 0;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue; var X = x + ox, Y = y + oy; if (X < 0 || Y < 0 || X >= NX || Y >= NY) continue;
        var j = Y * NX + X, nd = d + (cost[i] + cost[j]) / 2 * (ox && oy ? 1.414 : 1);
        if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); }
      }
    }
    return { dist: dist, prev: prev };
  }
  function centreOf(cells) { var sx = 0, sy = 0; cells.forEach(function (j) { sx += j % COLS; sy += (j / COLS) | 0; }); return [Math.round((sx / cells.length + 0.5) * K), Math.round((sy / cells.length + 0.5) * K)]; }
  function routes(map, F) {
    // Rank order only (MSU P3927: bucks avoid open understory and keep to cover): fewest open cells first, then fewest
    // mixed cells, then fewest cover cells. The tier sizes only keep ranks apart; they are not deer data. No slope cost.
    var cost = new Float64Array(NX * NY), TIER = { 'B': 0, 'N': 0, 'C': 0, '.': 1, 'X': 1, 'F': 2, 'R': 2, 'W': 2 }, STEP = [1, 1e5, 1e10];
    for (var i = 0; i < NX * NY; i++) { var z = zoneAt(map, i % NX, (i / NX) | 0); cost[i] = STEP[TIER[z] == null ? 1 : TIER[z]]; }
    var beds = comps(map, 'B'), foods = comps(map, 'F'), out = [];
    if (!beds.length || !foods.length) return out;
    var starts = []; foods.forEach(function (c) { c.forEach(function (j) { var p = [((j % COLS) + 0.5) * K | 0, (((j / COLS) | 0) + 0.5) * K | 0]; starts.push(p[1] * NX + p[0]); }); });
    var D = dijkstra(cost, starts);
    beds.slice(0, 6).forEach(function (b) {
      var c = centreOf(b), i = clamp(c[1], 0, NY - 1) * NX + clamp(c[0], 0, NX - 1), path = [];
      for (var g = 0; i >= 0 && g < 4000; g++) { path.push(i); i = D.prev[i]; }
      if (path.length > 2) out.push(path);   // from bedding to food
    });
    return out;
  }

  /* ---------- the whole hour (run in the phone for any property) ---------- */
  function cellHit(map, onRoute, deer, j) {
    var z = zoneAt(map, j % NX, (j / NX) | 0), area = z === 'B' || z === 'F' || onRoute[j];
    return area ? (deer[j] ? (z === 'B' ? 'B' : z === 'F' ? 'F' : 'R') : 'q') : '';
  }
  // Follow one member's air from the stand until it leaves the property box. Returns what it crosses, in order.
  function memberPath(T, A, x0, y0, deer, onRoute) {
    var pts = trace(T.F, A, x0, y0, 1e9), first = '', quiet = false, inside = 0, outside = 0, exit = null;
    for (var k = 0; k < pts.length; k++) {
      var p = pts[k], j = clamp(Math.round(p.y), 0, NY - 1) * NX + clamp(Math.round(p.x), 0, NX - 1), z = zoneAt(T.map, j % NX, (j / NX) | 0);
      if (z === 'X') { outside++; if (!exit) exit = p; continue; }
      inside++;
      // sideways spread: one Briggs sigma-y each side of the path (textbook plume core)
      var sy = briggs(A.cls, Math.max(p.d, 5)).sy, steps = Math.max(1, Math.ceil(sy / T.F.dx));
      for (var q = -steps; q <= steps; q++) {
        var X = Math.round(p.x + p.nx * q * sy / steps / T.F.dx), Y = Math.round(p.y + p.ny * q * sy / steps / T.F.dy);
        if (X < 0 || Y < 0 || X >= NX || Y >= NY) continue;
        var h = cellHit(T.map, onRoute, deer, Y * NX + X);
        if (h === 'q') quiet = true; else if (h && !first) first = h;
      }
    }
    if (!exit && pts.length) exit = pts[pts.length - 1];
    return { pts: pts, hit: first, quiet: quiet, inside: inside, outside: outside, exit: exit };
  }
  function model(T, air, date) {
    var map = T.map, A = airAt(air, date, T.lat, T.lng, T.rise, T.set), ph = phase(date, T.rise, T.set), W = ACTIVE[ph];
    var deer = new Float32Array(NX * NY), onRoute = new Uint8Array(NX * NY);
    T.routes.forEach(function (r) { r.forEach(function (i) { for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) { var x = i % NX + ox, y = ((i / NX) | 0) + oy; if (x >= 0 && y >= 0 && x < NX && y < NY) onRoute[y * NX + x] = 1; } }); });
    for (var i = 0; i < NX * NY; i++) { var z = zoneAt(map, i % NX, (i / NX) | 0); deer[i] = ((z === 'B' && W.B) || (z === 'F' && W.F) || (onRoute[i] && W.R)) ? 1 : 0; }
    var mem = memberAir(A);
    var stands = (map.stands || []).map(function (s) {
      var x0 = s.x * K + K / 2, y0 = s.y * K + K / 2, runs = mem.map(function (B) { return memberPath(T, B, x0, y0, deer, onRoute); });
      var c = runs[0], anyHit = runs.filter(function (r) { return r.hit; })[0];
      // RANKED RULE (no cutoff number): red = the middle of the wind spread carries your air over an active deer area;
      // yellow = only the edges of the spread do, or it crosses deer areas that are quiet this hour, or the air is calm or
      // turning over; green = no part of the spread touches a deer area on the property.
      var color = c.hit ? 'red' : (anyHit || runs.some(function (r) { return r.quiet; }) || A.calm || A.mode === 'mixed') ? 'yellow' : 'green';
      var hit = c.hit || (anyHit && anyHit.hit) || '';
      var off = c.outside > c.inside;   // more of the middle path is off the property than on it (a comparison, no share number)
      var g = new Float32Array(NX * NY);
      runs.forEach(function (r, m) { r.pts.forEach(function (p) { var sy = briggs(A.cls, Math.max(p.d, 5)).sy, steps = Math.max(1, Math.ceil(sy / T.F.dx)); for (var q = -steps; q <= steps; q++) { var off2 = q * sy / steps, X = Math.round(p.x + p.nx * off2 / T.F.dx), Y = Math.round(p.y + p.ny * off2 / T.F.dy); if (X < 0 || Y < 0 || X >= NX || Y >= NY) continue; var v = Math.exp(-off2 * off2 / (2 * sy * sy)) * (m ? 0.6 : 1); if (v > g[Y * NX + X]) g[Y * NX + X] = v; } }); });
      return { name: s.name, x: x0, y: y0, plume: { g: g, pts: c.pts }, members: runs.map(function (r) { return r.pts; }), color: color, hit: hit, edgeOnly: !c.hit && !!anyHit, quiet: runs.some(function (r) { return r.quiet; }), off: off, exit: c.exit,
        hitB: hit === 'B' ? 1 : 0, hitR: hit === 'R' ? 1 : 0, hitF: hit === 'F' ? 1 : 0 };
    });
    return { A: A, phase: ph, deer: deer, onRoute: onRoute, stands: stands, mem: mem };
  }
  // safest walk-in from the closest parking spot to a stand (rank order only: clean air first, then stay out of deer
  // areas and off the neighbor line, then shortest). Uses the whole wind spread, like the stands.
  function walkIn(T, M, s) {
    if (!T.parking.length) return null;
    var F = T.F, cost = new Float32Array(NX * NY);
    for (var y = 0; y < NY; y += 2) for (var x = 0; x < NX; x += 2) {
      var bad = 0;
      for (var m = 0; m < M.mem.length && !bad; m++) { var pts = trace(F, M.mem[m], x, y, 1e9); for (var k = 0; k < pts.length; k += 2) { var j = Math.round(pts[k].y) * NX + Math.round(pts[k].x); if (M.deer[j]) { bad = m === 0 ? 2 : 1; break; } } }
      for (var oy = 0; oy < 2; oy++) for (var ox = 0; ox < 2; ox++) if (y + oy < NY && x + ox < NX) cost[(y + oy) * NX + x + ox] = bad;
    }
    for (var i = 0; i < NX * NY; i++) {
      var z = zoneAt(T.map, i % NX, (i / NX) | 0);
      cost[i] = cost[i] === 2 ? 1e15 : cost[i] === 1 ? 1e10 : (M.deer[i] || z === 'B' || z === 'X') ? 1e5 : 1;   // tier sizes only keep ranks apart
    }
    var goal = clamp(Math.round(s.y), 0, NY - 1) * NX + clamp(Math.round(s.x), 0, NX - 1), D = dijkstra(cost, [goal]), best = null;
    T.parking.forEach(function (p) { var j = clamp(p.y * K + 2, 0, NY - 1) * NX + clamp(p.x * K + 2, 0, NX - 1); if (best === null || D.dist[j] < D.dist[best]) best = j; });
    var path = [], i2 = best, exposed = 0, crosses = 0;
    for (var g = 0; i2 >= 0 && g < 5000; g++) { path.push(i2); if (cost[i2] >= 1e10) exposed++; if (M.onRoute[i2]) crosses++; i2 = D.prev[i2]; }
    return { path: path, exposed: exposed, crosses: crosses, from: best };
  }
  var DIR8 = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  function dirWord(dx, dy) { var a = (Math.atan2(dx, -dy) / D2R + 360) % 360; return DIR8[Math.round(a / 45) % 8]; }
  var HITW = { B: 'bedding', R: 'a deer route', F: 'the food' };
  function reasons(T, M, s, w) {
    var A = M.A, out = [], wind = A.calm ? 'Calm, shifting air' : 'Wind from the ' + DIR8[Math.round(((A.tx === 0 && A.ty === 0) ? 0 : ((Math.atan2(-A.tx, A.ty) / D2R) + 360) % 360) / 45) % 8];
    out.push(wind + (A.mode === 'down' ? ', and cooling air is sinking downhill.' : A.mode === 'up' ? ', and warming air is rising uphill.' : ', and the air is switching between rising and sinking.'));
    if (s.color === 'red') out.push('Your air blows straight over ' + HITW[s.hit] + ' where deer should be now. Skip this stand this hour.');
    else if (s.color === 'yellow') out.push(A.calm ? 'With almost no wind, your air has no steady path and can swirl.' : A.mode === 'mixed' ? 'Right after sunrise the air is turning over from downhill to uphill. Scent may swirl.' : s.edgeOnly ? 'Your air mostly misses deer, but when the wind wavers it can drift over ' + HITW[s.hit] + '. Hunt it with care.' : 'Your air crosses deer areas that are likely quiet this hour. Hunt it with care.');
    else out.push('Your air does not blow over bedding, food or the routes on the property this hour, even when the wind wavers.');
    if (s.off && s.exit) out.push('Most of your scent blows ' + dirWord(s.exit.x - s.x, s.exit.y - s.y) + ' off the property.');
    if (A.mode === 'down' && s.color !== 'green') out.push('Cold air drains into low ground and carries scent with it.');
    if (!T.hasDem) out.push('No elevation loaded yet, so rising and sinking air is left out. Get USGS elevation on the terrain tab to add it.');
    if (w === null) out.push('Mark where you park to get a walk-in.');
    else if (w) {
      var p = w.from, dx = (p % NX) - s.x, dy = ((p / NX) | 0) - s.y;
      out.push('Safest walk-in comes from the ' + dirWord(dx, dy) + (w.exposed ? '. No path is fully clean; part of it blows toward deer.' : '. It keeps your scent off where deer should be.') + (w.crosses ? ' It has to cross a deer route.' : ''));
    }
    return out;
  }
  var PHASE_WORD = { night: 'Night: deer likely on food and moving.', morning: 'Sunrise hour: deer likely moving between food and bed.', midday: 'Daylight: deer likely bedded, and moving some.', evening: 'Sunset hour: deer likely up and heading to food.' };

  /* ---------- rendering (painter's algorithm) ---------- */
  var ZCOL = { B: [46, 125, 50], F: [200, 162, 106], W: [30, 79, 168], C: [30, 79, 168], N: [120, 140, 70], R: [150, 140, 128], X: [150, 80, 70], '.': [104, 128, 76] };
  function mount(el, host) {
    var LAY = { wind: false, thermals: false, scent: true, routes: true };
    var flat = !!host.flat, T = null, view = flat ? { yaw: 0, pitch: Math.PI / 2 } : { yaw: -0.5, pitch: 0.95 }, hour = host.hour == null ? 17 : host.hour, day = host.day || new Date(), sel = 0, M = null, W = null, raf = 0, parts = [], dead = false, buf = null, bufKey = '';
    var demo = !!host.demo;
    el.innerHTML = '<div class="t3">' + (demo ? '<div class="t3-demo">Example property. Not your land.</div>' : '') +
      '<div class="t3-stage"><canvas class="t3-cv" aria-label="' + (flat ? '2D map view' : '3D terrain view') + '"></canvas><div class="t3-phase" aria-live="polite"></div></div>' +
      '<div class="t3-ctl"><label class="t3-scrub"><span class="t3-when"></span><input type="range" min="0" max="23" step="1" class="t3-hour" aria-label="Time of day"></label>' +
      '<div class="t3-row">' + (demo ? '' : '<label class="field t3-day"><span>Day</span><input type="date" class="t3-date"></label>') +
      (flat ? '' : '<button class="btn sm ink" data-t3="turn">Turn</button><button class="btn sm ink" data-t3="top">Top view</button>') + '</div>' +
      ('<div class="t3-chips" role="group" aria-label="Show on the map">' + [['wind', 'Wind'], ['thermals', 'Thermals'], ['scent', 'Scent'], ['routes', 'Routes']].map(function (c) { return '<button type="button" class="t3-chip' + (LAY[c[0]] ? ' on' : '') + '" data-t3l="' + c[0] + '" aria-pressed="' + !!LAY[c[0]] + '">' + c[1] + '</button>'; }).join('') + '</div>') +
      (flat ? '' : '<label class="t3-ex"><span>Exaggerate terrain</span><input type="range" min="1" max="10" step="0.5" value="3" class="t3-exag" aria-label="Exaggerate terrain"><span class="t3-exw"><i>Natural</i><i>Strong</i></span></label>') +
      '<div class="t3-air"></div><div class="t3-stands"></div><ul class="t3-why read"></ul></div></div>';
    var cv = el.querySelector('canvas'), g = cv.getContext('2d'), hr = el.querySelector('.t3-hour'), dt = el.querySelector('.t3-date');
    hr.value = hour; if (dt) dt.value = ymd(day);
    var gl = null, exag = 3, glTried = false, stage = el.querySelector('.t3-stage');
    function zoneW(gx, gy) { return zoneAt(T.map, clamp(gx, 0, NX - 1), clamp(gy, 0, NY - 1)); }
    function pushGL() {
      if (!gl || !T || !M) return;
      var s = M.stands[sel], lowMax = 0; for (var i = 0; i < NX * NY; i++) if (T.F.low[i] > lowMax) lowMax = T.F.low[i];
      var fine = host.fine ? host.fine() : null, d = when(hour);
      gl.update({ NX: NX, NY: NY, K: K, COLS: COLS, ROWS: ROWS, z: T.z, wm: T.wm, hm: T.hm, map: T.map, routes: T.routes, routeCam: T.routeCam, parking: T.parking,
        stands: M.stands, sel: sel, walk: W, why: M.stands.map(function (st) { var r = reasons(T, M, st, undefined); return r[1] || r[0] || ''; }), phase: M.phase, mode: M.A.mode, calm: M.A.calm, windTo: [M.A.tx, M.A.ty], sunEl: M.A.el, sunAz: ((d.getTime() / 36e5 + (T.lng || 0) / 15) % 24 + 24) % 24 / 24 * 360,   // solar-time direction of the sun, for shading only
        mem: M.mem, flowAt: function (i) { return flowAt(T.F, M.A, i); }, flowAtM: function (m, i) { return flowAt(T.F, M.mem[m] || M.A, i); },
        scentGrid: s ? s.plume.g : null, low: T.F.low, lowMax: lowMax, zoneAt: zoneW,
        aerial: host.aerial ? host.aerial() : null, fine: fine, fineURL: fine ? null : (host.fineDem ? host.fineDem() : null),
        key: JSON.stringify(host.box()) + T.map.cells });
    }
    function tryGL() {
      if (flat || glTried || host.gl === false) return; glTried = true;
      import('./t3gl.js').then(function (m) {
        if (dead) return;
        gl = m.create(stage, { tipAt: function (gx, gy) {   // which Field Tip fits this spot: water, low bottom, field, woods, else slope
          if (!window.BLTips || !T) return null; var i = clamp(Math.round(gy), 0, NY - 1) * NX + clamp(Math.round(gx), 0, NX - 1), z = zoneW(Math.round(gx), Math.round(gy));
          var ty = (z === 'W' || z === 'C') ? 'water' : z === 'F' ? 'field' : z === 'B' ? 'woods' : (T.F.low[i] > 0.6 ? 'bottom' : 'slope');
          return BLTips.byType(ty); }, layers: LAY, exag: exag, parseTiff: parseTiff, onPick: function (k) { sel = k; compute(); }, onAerial: function () {} });
        if (gl) { cv.style.display = 'none'; pushGL(); }
      }).catch(function () { gl = null; });
    }
    function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function setup() {
      var z = host.dem(), map = host.map(), box = host.box();
      if (!z || !map || !box) { T = null; return; }
      var b = bbox(box), F = fields(z, b.wm, b.hm), st = host.sunTimes(day);
      F.zone = []; for (var zi = 0; zi < NX * NY; zi++) F.zone.push(zoneAt(map, zi % NX, (zi / NX) | 0));
      F.run = Math.hypot(b.wm, b.hm);   // slope length: the property's span (ESTIMATE; slopes may run past the box)
      T = { z: z, map: map, F: F, lat: box.lat, lng: box.lng, wm: b.wm, hm: b.hm, rise: st && st.rise, set: st && st.set, parking: host.parking() || [], hasDem: host.hasDem ? !!host.hasDem() : true };
      T.routes = routes(map, F);
      // a route is drawn solid where it runs through a map square that has one of your cameras (seen on camera), dashed elsewhere
      var camSq = {}; (map.cams || []).forEach(function (c) { camSq[c.y * COLS + c.x] = 1; });
      T.routeCam = T.routes.map(function (r) { return r.map(function (i) { return camSq[(((i / NX) | 0) / K | 0) * COLS + ((i % NX) / K | 0)] ? 1 : 0; }); });
      var rel = Math.max(F.max - F.min, 1); T.ex = clamp(0.16 * b.wm / rel, 1, 6);
      bufKey = '';
    }
    // the slider is the property's own clock (host.when maps day + hour in the property's time zone to a real instant)
    function when(h) { return host.when ? host.when(day, h) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0); }
    function hourWord(d) {
      var p = phase(d, T && T.rise, T && T.set), h = hour;
      if (p === 'morning') return 'Sunrise hour';
      if (p === 'evening') return 'Sunset hour';
      return p === 'night' ? (h < 12 ? 'Before dawn' : 'After dark') : p === 'morning' ? 'Early morning' : p === 'midday' ? (h < 12 ? 'Late morning' : 'Midday') : 'Late afternoon';
    }
    function compute() {
      if (!T) return;
      var d = when(hour), air = host.air(d) || host.manualAir();
      M = model(T, air, d);
      var s = M.stands[sel]; W = s ? walkIn(T, M, s) : undefined;
      el.querySelector('.t3-when').textContent = hourWord(d);
      el.querySelector('.t3-phase').textContent = PHASE_WORD[M.phase];
      el.querySelector('.t3-air').innerHTML = host.airNote ? host.airNote(d) : '';
      el.querySelector('.t3-stands').innerHTML = M.stands.length ? M.stands.map(function (s2, k) { return '<button class="t3-st ' + s2.color + (k === sel ? ' on' : '') + '" data-t3st="' + k + '"><i></i>' + esc(s2.name) + '</button>'; }).join('') : '<p class="small muted">No stands yet. Add them in the 2D map editor.</p>';
      el.querySelector('.t3-why').innerHTML = s ? reasons(T, M, s, W).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') : '';
      bufKey = ''; seed(); pushGL();
    }
    // projection
    function size() { var w = el.clientWidth || 360, h = Math.round(Math.min(w * 0.95, 520)), r = Math.min(window.devicePixelRatio || 1, 2); cv.width = w * r; cv.height = h * r; cv.style.height = h + 'px'; g.setTransform(r, 0, 0, r, 0, 0); return { w: w, h: h }; }
    var S = size();
    function proj(x, y, zz) {   // x,y in DEM cells, zz in metres
      var X = (x - NX / 2) * T.F.dx, Y = (y - NY / 2) * T.F.dy, Z = (zz - (T.F.min + T.F.max) / 2) * T.ex;
      var c = Math.cos(view.yaw), s = Math.sin(view.yaw), xr = c * X - s * Y, yr = s * X + c * Y;
      var sc = Math.min(S.w, S.h) / (Math.max(T.wm, T.hm) * 1.05);
      return [S.w / 2 + xr * sc, S.h / 2 + (yr * Math.sin(view.pitch) - Z * Math.cos(view.pitch)) * sc, yr * Math.cos(view.pitch) + Z * Math.sin(view.pitch)];
    }
    function zAt(x, y) { var X = clamp(Math.round(x), 0, NX - 1), Y = clamp(Math.round(y), 0, NY - 1); return T.z[Y * NX + X]; }
    function terrain() {
      var key = view.yaw.toFixed(3) + view.pitch.toFixed(3) + S.w + 'x' + S.h + (M ? M.phase + sel : '');
      if (buf && key === bufKey) return;
      bufKey = key; buf = buf || document.createElement('canvas'); buf.width = cv.width; buf.height = cv.height;
      var b = buf.getContext('2d'), r = cv.width / S.w; b.setTransform(r, 0, 0, r, 0, 0); b.clearRect(0, 0, S.w, S.h);
      var step = 2, quads = [], sunEl = M ? M.A.el : 30, night = sunEl < -2, scent = M && M.stands[sel] ? M.stands[sel].plume.g : null;
      var lx = -0.5, ly = -0.6, lz = 0.62;   // DISPLAY ONLY: light from the northwest-above (map shading)
      for (var y = 0; y < NY - step; y += step) for (var x = 0; x < NX - step; x += step) {
        var p1 = proj(x, y, zAt(x, y)), p2 = proj(x + step, y, zAt(x + step, y)), p3 = proj(x + step, y + step, zAt(x + step, y + step)), p4 = proj(x, y + step, zAt(x, y + step));
        var i = (y + 1) * NX + x + 1, nx = -T.F.gx[i] * T.ex, ny = -T.F.gy[i] * T.ex, nl = Math.sqrt(nx * nx + ny * ny + 1), sh = clamp((nx * lx + ny * ly + lz) / nl / 0.62, 0.35, 1.25);
        var zc = ZCOL[zoneAt(T.map, x + 1, y + 1)] || ZCOL['.'], col = [zc[0] * sh, zc[1] * sh, zc[2] * sh];
        if (M && M.deer[i] >= 0.6 && zoneAt(T.map, x + 1, y + 1) === '.') col = [col[0] * 0.9 + 30, col[1] * 0.9 + 22, col[2] * 0.9];
        if (M && LAY.thermals && M.A.mode === 'down' && T.F.low[i] > 0.6) col = [col[0] * 0.75, col[1] * 0.8, col[2] * 0.8 + 50];   // cold air pooling: DISPLAY ONLY tint (0.6 m below the local mean picks low spots to shade; not used in ratings)
        if (M && LAY.thermals && M.A.mode !== 'mixed') { var tw = 0.16; col = M.A.mode === 'down' ? [col[0] * (1 - tw) + 127 * tw, col[1] * (1 - tw) + 212 * tw, col[2] * (1 - tw) + 255 * tw] : [col[0] * (1 - tw) + 255 * tw, col[1] * (1 - tw) + 128 * tw, col[2] * (1 - tw) + 171 * tw]; }
        if (scent && LAY.scent) { var sv = Math.max(scent[i], scent[i + 1] || 0, scent[i + NX] || 0); if (sv > 0.05) { var a = 0.2 + 0.35 * sv; col = [col[0] * (1 - a) + 156 * a, col[1] * (1 - a) + 107 * a, col[2] * (1 - a) + 255 * a]; } }
        if (night) col = [col[0] * 0.55, col[1] * 0.6, col[2] * 0.75 + 12];
        quads.push({ d: (p1[2] + p2[2] + p3[2] + p4[2]) / 4, p: [p1, p2, p3, p4], c: 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')' });
      }
      quads.sort(function (a, c) { return a.d - c.d; });
      quads.forEach(function (q) { b.beginPath(); b.moveTo(q.p[0][0], q.p[0][1]); for (var k = 1; k < 4; k++) b.lineTo(q.p[k][0], q.p[k][1]); b.closePath(); b.fillStyle = q.c; b.fill(); b.strokeStyle = q.c; b.lineWidth = 0.6; b.stroke(); });
    }
    function seed() { parts = []; if (!M || !M.stands[sel]) return; var s = M.stands[sel]; for (var k = 0; k < 120; k++) parts.push({ x: s.x, y: s.y, age: Math.random() * 120, m: k % M.mem.length }); }
    function frame(ts) {
      if (dead) return;
      if (gl) return;
      if (!T) { g.clearRect(0, 0, S.w, S.h); return; }
      terrain(); g.clearRect(0, 0, S.w, S.h); g.drawImage(buf, 0, 0, S.w, S.h);
      var t = (ts || 0) / 1000;
      // wind (chip): a few soft streaks that drift with the near-ground air, no per-cell arrows
      if (M && LAY.wind) {
        var stp = 16, ph2 = (t * 0.25) % 1;
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.lineCap = 'round';
        for (var ay = stp / 2; ay < NY; ay += stp) for (var ax = stp / 2; ax < NX; ax += stp) {
          var ai = ay * NX + ax, v = flowAt(T.F, M.A, ai), vs = Math.sqrt(v[0] * v[0] + v[1] * v[1]); if (vs < 0.05) continue;
          var L2 = stp * 0.5, bx = ax + v[0] / vs * L2 * (ph2 - 0.5), by = ay + v[1] / vs * L2 * (ph2 - 0.5);
          var p0 = proj(bx - v[0] / vs * L2 / 2, by - v[1] / vs * L2 / 2, zAt(bx, by) + 4), p1 = proj(bx + v[0] / vs * L2 / 2, by + v[1] / vs * L2 / 2, zAt(bx, by) + 4);
          g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
        }
      }
      // buck routes (chip): 2-4 bold smooth paths with a glow moving bed -> food in the evening, back in the morning
      if (M && LAY.routes) T.routes.slice().sort(function (a, c) { return c.length - a.length; }).slice(0, 4).forEach(function (r, ri) {
        var rev = M.phase === 'morning' || M.phase === 'midday', pts = rev ? r.slice().reverse() : r, a = M.phase === 'midday' ? 0.4 : 0.95, P2 = [];
        for (var q = 0; q < pts.length; q += 3) P2.push(proj(pts[q] % NX, (pts[q] / NX) | 0, T.z[pts[q]] + 2));
        var lq = pts[pts.length - 1]; P2.push(proj(lq % NX, (lq / NX) | 0, T.z[lq] + 2)); if (P2.length < 2) return;
        g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(255,210,63,' + (a * 0.85) + ')'; g.lineWidth = 5; g.beginPath(); g.moveTo(P2[0][0], P2[0][1]);
        for (var k = 1; k < P2.length - 1; k++) g.quadraticCurveTo(P2[k][0], P2[k][1], (P2[k][0] + P2[k + 1][0]) / 2, (P2[k][1] + P2[k + 1][1]) / 2);
        g.lineTo(P2[P2.length - 1][0], P2[P2.length - 1][1]); g.stroke();
        var gk = Math.floor(((t * 0.12 + ri * 0.27) % 1) * (P2.length - 1)), gp = P2[gk], gr = g.createRadialGradient(gp[0], gp[1], 0, gp[0], gp[1], 12);
        gr.addColorStop(0, 'rgba(255,255,230,' + a + ')'); gr.addColorStop(1, 'rgba(255,255,230,0)'); g.fillStyle = gr; g.beginPath(); g.arc(gp[0], gp[1], 12, 0, 7); g.fill();
      });
      // moving scent from the picked stand
      if (M && LAY.scent && M.stands[sel]) {
        parts.forEach(function (p) {
          var i = clamp(Math.round(p.y), 0, NY - 1) * NX + clamp(Math.round(p.x), 0, NX - 1), v = flowAt(T.F, M.mem[p.m] || M.A, i), sp = Math.sqrt(v[0] * v[0] + v[1] * v[1]) || 1;
          var jit = M.A.calm ? 1.2 : M.A.mode === 'mixed' ? 0.6 : 0.25;   // DISPLAY ONLY: arrow wobble
          p.x += v[0] / sp * 0.45 + (Math.random() - 0.5) * jit; p.y += v[1] / sp * 0.45 + (Math.random() - 0.5) * jit; p.age++;
          if (p.age > 140 || p.x < 0 || p.y < 0 || p.x >= NX || p.y >= NY) { p.x = M.stands[sel].x; p.y = M.stands[sel].y; p.age = 0; }
          var q = proj(p.x, p.y, zAt(p.x, p.y) + 3); g.fillStyle = 'rgba(156,107,255,' + (0.8 * (1 - p.age / 140)) + ')'; g.beginPath(); g.arc(q[0], q[1], 2.1, 0, 7); g.fill();
        });
      }
      // walk-in
      if (W && W.path) {
        g.setLineDash([5, 5]); g.lineDashOffset = -t * 12; g.strokeStyle = '#c6ff00'; g.lineWidth = 2.5; g.beginPath();
        W.path.forEach(function (i, k) { var p = proj(i % NX, (i / NX) | 0, T.z[i] + 3); if (k) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke(); g.setLineDash([]);
      }
      // parking + stands
      T.parking.forEach(function (p) { var q = proj(p.x * K + 2, p.y * K + 2, zAt(p.x * K + 2, p.y * K + 2) + 4); g.fillStyle = '#1d3557'; g.fillRect(q[0] - 8, q[1] - 8, 16, 16); g.fillStyle = '#fff'; g.font = 'bold 11px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('P', q[0], q[1] + 4); });
      if (M) M.stands.forEach(function (s, k) {
        var q = proj(s.x, s.y, zAt(s.x, s.y) + 6), c = { green: '#00bfa5', yellow: '#ff8a00', red: '#a0001e' }[s.color];   // PALETTE (t3gl.js / README)
        g.strokeStyle = '#111'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0], q[1] - 16); g.stroke();
        g.fillStyle = c; g.beginPath(); g.arc(q[0], q[1] - 20, k === sel ? 8 : 6, 0, 7); g.fill(); g.lineWidth = k === sel ? 3 : 1.5; g.strokeStyle = '#fff'; g.stroke();
        g.font = (k === sel ? 'bold ' : '') + '12px system-ui,sans-serif'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.65)'; g.strokeText(s.name, q[0], q[1] - 32); g.fillStyle = '#fff'; g.fillText(s.name, q[0], q[1] - 32);
        s.sx = q[0]; s.sy = q[1] - 20;
      });
      // wind arrow (top-left): which way the air goes
      if (M && !M.A.calm) {
        var c = Math.cos(view.yaw), sn = Math.sin(view.yaw), wx = c * M.A.tx - sn * M.A.ty, wy = (sn * M.A.tx + c * M.A.ty) * Math.sin(view.pitch), ang = Math.atan2(wy, wx);
        g.save(); g.translate(34, 34); g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(0, 0, 24, 0, 7); g.fill(); g.rotate(ang); g.fillStyle = '#e8f1ff'; g.beginPath(); g.moveTo(15, 0); g.lineTo(-6, -8); g.lineTo(-2, 0); g.lineTo(-6, 8); g.closePath(); g.fill(); g.restore();
        g.fillStyle = '#fff'; g.font = '10px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('wind', 34, 70);
      }
      // north marker
      var nN = proj(NX / 2, -6, T.F.max), nC = proj(NX / 2, 0, T.F.max); g.fillStyle = '#fff'; g.font = 'bold 12px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('N', nN[0], nN[1]);
      raf = requestAnimationFrame(frame);
    }
    // gestures
    var drag = null;
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false }; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', function (e) { if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true; view.yaw = drag.yaw + dx * 0.01; view.pitch = clamp(drag.pitch - dy * 0.006, 0.45, Math.PI / 2); });
    cv.addEventListener('pointerup', function (e) {
      if (drag && !drag.moved && M) { var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; M.stands.forEach(function (s, k) { if (Math.hypot(s.sx - x, s.sy - y) < 22) { sel = k; compute(); } }); }
      drag = null;
    });
    el.addEventListener('input', function (e) { if (e.target === hr) { hour = Number(hr.value); compute(); } else if (e.target.classList.contains('t3-exag')) { exag = Number(e.target.value); if (gl) gl.setExag(exag); } });
    el.addEventListener('change', function (e) { if (e.target === dt && dt.value) { var p = dt.value.split('-'); day = new Date(+p[0], p[1] - 1, +p[2], 12); setup(); compute(); if (host.onDay) host.onDay(day); } });
    el.addEventListener('click', function (e) {
      var lb = e.target.closest('[data-t3l]');
      if (lb) { var k = lb.getAttribute('data-t3l'); LAY[k] = !LAY[k]; lb.classList.toggle('on', LAY[k]); lb.setAttribute('aria-pressed', LAY[k]); if (gl) gl.setLayers(LAY); return; }
      var b = e.target.closest('[data-t3]'), st = e.target.closest('[data-t3st]');
      if (st) { sel = Number(st.getAttribute('data-t3st')); compute(); return; }
      if (!b) return; var a = b.getAttribute('data-t3');
      if (gl) { gl.view(a); return; }
      if (a === 'turn') view.yaw += Math.PI / 4; else if (a === 'top') view.pitch = view.pitch > 1.5 ? 0.95 : Math.PI / 2;
    });
    function onResize() { S = size(); bufKey = ''; }
    window.addEventListener('resize', onResize);
    setup(); compute(); raf = requestAnimationFrame(frame); tryGL();
    return {
      destroy: function () { dead = true; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); if (gl) gl.destroy(); },
      gl: function () { return gl; }, setLayers: function (o) { Object.keys(o).forEach(function (k) { LAY[k] = !!o[k]; var c = el.querySelector('[data-t3l=' + k + ']'); if (c) c.classList.toggle('on', LAY[k]); }); if (gl) gl.setLayers(LAY); },
      setExag: function (e) { exag = e; var x = el.querySelector('.t3-exag'); if (x) x.value = e; if (gl) gl.setExag(e); },
      refresh: function () { setup(); compute(); },
      state: function () { return M ? { phase: M.phase, mode: M.A.mode, cls: M.A.cls, calm: M.A.calm, stands: M.stands.map(function (s) { return { name: s.name, color: s.color, hitB: s.hitB, hitR: s.hitR, quiet: s.quiet, edgeOnly: s.edgeOnly, off: s.off }; }), members: M.mem.length, flat: flat, webgl: !!gl, layers: JSON.parse(JSON.stringify(LAY)), counts: gl ? gl.counts() : null, aerial: !!(gl && gl.hasAerial()), fineGround: !!(gl && gl.usesFine()), exag: exag, hasDem: T.hasDem, when: when(hour).toISOString(), routeCam: T.routeCam.map(function (r) { return r.some(Boolean); }), routes: T.routes.length, walk: W ? { len: W.path.length, exposed: W.exposed } : W, why: Array.prototype.map.call(el.querySelectorAll('.t3-why li'), function (l) { return l.textContent; }) } : null; },
      setHour: function (h) { hour = h; hr.value = h; compute(); }, setSel: function (k) { sel = k; compute(); },
      renderMs: function () { var t0 = performance.now(); bufKey = ''; terrain(); return performance.now() - t0; }
    };
  }
  window.BLTerrain = { mount: mount, imageURL: imageURL, merc: merc, SIGMA_A: SIGMA_A, memberAir: memberAir, phase: phase, COLS: COLS, ROWS: ROWS, K: K, bbox: bbox, demURL: demURL, parseTiff: parseTiff, cleanDem: cleanDem, exampleDem: exampleDem, stability: stability, briggs: briggs, chi: chi, sunElev: sunElev, NX: NX, NY: NY, _model: model, _fields: fields, _routes: routes, underCover: underCover, slopeFlow: slopeFlow, WAF: WAF,  };
})();
