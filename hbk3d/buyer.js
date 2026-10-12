/* Buck Ledger port: the buyer's own ground for the SAME renderer as the Example.
   Builds HBK_STATIC (3 m 3DEP mesh, 2048 USGS aerial, pool texture, drainage) and HBK_DAYS (the original engine, unmodified,
   run in the phone on the buyer's Open-Meteo hours, stands, bedding, food and parking) in the formats precompute.js writes. */
(function () {
  'use strict';
  var IN = function () { return window.BL_BUYER_INPUT || (window.parent && window.parent !== window && window.parent.BL_BUYER_INPUT) || null; };
  var TZ = 'America/Chicago', D2R = Math.PI / 180;
  var _fp = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function lp(ms) { var o = {}; _fp.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; }); return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second }; }
  function tzOff(ms) { var p = lp(ms); return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms) / 60000; }
  function zoned(y, m, d, h, mi) { h = h || 0; mi = mi || 0; var g = Date.UTC(y, m - 1, d, h, mi), t = g - tzOff(g) * 6e4; return g - tzOff(t) * 6e4; }
  function dayStart(ms) { var p = lp(ms); return zoned(p.y, p.m, p.d, 0, 0); }
  function ymd(ms) { var p = lp(ms); return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'); }
  function load(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  function b64(ta) { var u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength), s = '', C = 0x8000; for (var i = 0; i < u.length; i += C) s += String.fromCharCode.apply(null, u.subarray(i, i + C)); return btoa(s); }
  function status(t) { var l = document.getElementById('loading'); if (l) l.textContent = t; }
  function tfetch(url, tries) { // USGS servers sometimes stall: 40 s timeout, retried
    tries = tries == null ? 2 : tries;
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ac ? setTimeout(function () { ac.abort(); }, 40000) : 0;
    return fetch(url, ac ? { signal: ac.signal } : undefined).then(function (r) { clearTimeout(t); if (!r.ok && r.status >= 500 && tries > 0) return tfetch(url, tries - 1); return r; },
      function (e) { clearTimeout(t); if (tries > 0) return tfetch(url, tries - 1); throw e; });
  }
  function fetchBuf(url) { return tfetch(url).then(function (r) { if (!r.ok) throw new Error('USGS HTTP ' + r.status); return r.arrayBuffer(); }); }
  function blobToURI(b) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); }); }
  function fillND(z, w, h) { // USGS no-data (-9999 / NaN) cells take the mean of their valid neighbours, repeated until none are left
    var bad = 0; for (var i = 0; i < z.length; i++) if (!(z[i] > -1000)) { z[i] = NaN; bad++; } if (bad > z.length * 0.2) throw new Error('USGS has no elevation for most of this box');
    for (var pass = 0; bad && pass < 200; pass++) { bad = 0; for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var k = y * w + x; if (z[k] === z[k]) continue; var s = 0, c = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; var v = z[yy * w + xx]; if (v === v) { s += v; c++; } }
      if (c) z[k] = s / c; else bad++; } } return z; }
  var CTX = null; // { G, GEO, P, STANDS, BEDS, WALKS, routes, box, inside }

  function moonPos(date, lat, lng) { // same SunCalc / Meeus approximations as astro.js, plus azimuth
    var rad = D2R, e = rad * 23.4397, d = date.valueOf() / 864e5 - 0.5 + 2440588 - 2451545;
    var L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d), l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F);
    var ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)), dc = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
    var H = rad * (280.16 + 360.9856235 * d) - rad * -lng - ra, phi = rad * lat;
    var alt = Math.asin(Math.sin(phi) * Math.sin(dc) + Math.cos(phi) * Math.cos(dc) * Math.cos(H)), az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dc) * Math.cos(phi));
    return { alt: alt / rad, az: (az / rad + 180 + 360) % 360 };
  }

  function prepare() {
    var I = IN(); if (!I || !I.box || !I.map) return Promise.reject(new Error('No property box yet'));
    var T = (window.parent && window.parent.BLTerrain) || window.BLTerrain, bb = T.bbox(I.box), W = bb.wm, H = bb.hm;
    var nx = Math.min(1200, Math.round(W / 3) + 1), ny = Math.min(1200, Math.round(H / 3) + 1); // 3 m mesh step, same as the Example
    status('Getting your USGS 3DEP ground…');
    var demP = I.demData ? Promise.resolve(I.demData) : fetchBuf(T.demURL(I.box, nx, ny)).then(function (buf) { var r = T.parseTiff(buf); return { nx: r.w, ny: r.h, z: fillND(r.z, r.w, r.h) }; });
    var imgP = (I.imageURI ? Promise.resolve(I.imageURI) : tfetch(T.imageURL(I.box, 2048, Math.round(2048 * H / W))).then(function (r) { if (!r.ok) throw new Error('USGS imagery HTTP ' + r.status); return r.blob(); }).then(blobToURI));
    return Promise.all([demP, imgP, load('engine/04_physics.js').then(function () { return load('engine/05_engine.js'); })]).then(function (R) {
      var dem = R[0], naip = R[1]; status('Building your 3D ground…');
      var z = dem.z, hmin = Infinity, hmax = -Infinity; for (var i = 0; i < z.length; i++) { if (z[i] < hmin) hmin = z[i]; if (z[i] > hmax) hmax = z[i]; }
      hmin = Math.floor(hmin * 10) / 10; var hmm = new Uint16Array(z.length); for (i = 0; i < z.length; i++) hmm[i] = Math.max(0, Math.min(65535, Math.round((z[i] - hmin) * 1000)));
      var mesh = { nx: dem.nx, ny: dem.ny, step_x: W / (dem.nx - 1), step_y: H / (dem.ny - 1), hmin: hmin, h_mm: b64(hmm) };
      var hAt = function (x, y) { var fx = Math.min(Math.max(x / mesh.step_x, 0), dem.nx - 1.001), fy = Math.min(Math.max(y / mesh.step_y, 0), dem.ny - 1.001), j = fx | 0, k = fy | 0, a = fx - j, b = fy - k, q = k * dem.nx + j;
        return (1 - b) * ((1 - a) * z[q] + a * z[q + 1]) + b * ((1 - a) * z[q + dem.nx] + a * z[q + dem.nx + 1]); };
      // drainage grid (5 m): downhill unit vector, slope-flow speed (engine weak case), closed pools by depression fill
      var st = 5, dnx = Math.ceil(W / st), dny = Math.ceil(H / st), N = dnx * dny, hh = new Float64Array(N);
      for (i = 0; i < dny; i++) for (var j = 0; j < dnx; j++) hh[i * dnx + j] = hAt((j + .5) * st, (i + .5) * st);
      var fill = PHYS.priorityFlood(hh, dnx, dny, 0), ex = new Int8Array(N), ey = new Int8Array(N), uu = new Uint8Array(N), pool = new Uint8Array(N);
      var Pp = ENG.PAR, gp = 9.81 * 1 / 288, Cd = 0.02;
      for (i = 0; i < dny; i++) for (j = 0; j < dnx; j++) { var k2 = i * dnx + j, gx = hh[i * dnx + Math.min(dnx - 1, j + 1)] - hh[i * dnx + Math.max(0, j - 1)], gyy = hh[Math.min(dny - 1, i + 1) * dnx + j] - hh[Math.max(0, i - 1) * dnx + j];
        gx /= 2 * st; gyy /= 2 * st; var g = Math.hypot(gx, gyy); if (g > 1e-6) { ex[k2] = Math.round(-gx / g * 127); ey[k2] = Math.round(-gyy / g * 127); }
        var sa = Math.sin(Math.atan(g)); uu[k2] = Math.min(255, Math.round(Math.sqrt(gp * Pp.lidarDepth * sa / Cd) * 200)); pool[k2] = fill[k2] - hh[k2] > Pp.poolDepth ? 1 : 0; }
      // pool texture (512 x 512): closed pools plus ground well below its surroundings (cold air collects there)
      var cv = document.createElement('canvas'); cv.width = cv.height = 512; var g2 = cv.getContext('2d'), id = g2.createImageData(512, 512);
      for (i = 0; i < 512; i++) for (j = 0; j < 512; j++) { var x = (j + .5) / 512 * W, y = (i + .5) / 512 * H, di = Math.min(dny - 1, (y / st) | 0), dj = Math.min(dnx - 1, (x / st) | 0), dk = di * dnx + dj;
        var depth = fill[dk] - hh[dk], v = Math.min(1, depth / 0.5) * 255; var o = (i * 512 + j) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255; }
      g2.putImageData(id, 0, 0);
      // property features from the 2D map (20 x 26 cells over the same box)
      var M = I.map, C = 20, Rr = 26, cw = W / C, ch = H / Rr, cellsOf = function (z0) { var o = []; for (var q = 0; q < C * Rr; q++) if (M.cells[q] === z0) o.push(q); return o; };
      var sq = function (q) { var x0 = (q % C) * cw, y0 = ((q / C) | 0) * ch; return [[x0, y0], [x0 + cw, y0], [x0 + cw, y0 + ch], [x0, y0 + ch]]; };
      var comps = function (z0) { var seen = {}, out = []; cellsOf(z0).forEach(function (q) { if (seen[q]) return; var st2 = [q], c = []; seen[q] = 1; while (st2.length) { var a = st2.pop(); c.push(a); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var xx = a % C + d[0], yy = ((a / C) | 0) + d[1], b = yy * C + xx; if (xx >= 0 && yy >= 0 && xx < C && yy < Rr && !seen[b] && M.cells[b] === z0) { seen[b] = 1; st2.push(b); } }); } out.push(c); }); return out; };
      var hull = function (pts) { pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); var cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }, lo = [], up = [];
        pts.forEach(function (p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }); pts.slice().reverse().forEach(function (p) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }); return lo.slice(0, -1).concat(up.slice(0, -1)); };
      var compPoly = function (c) { return c.length === 1 ? sq(c[0]) : hull([].concat.apply([], c.map(sq))); };
      var inner = []; for (var q = 0; q < C * Rr; q++) if (M.cells[q] !== 'X') inner.push(q);
      var boundary = inner.length && inner.length < C * Rr ? hull([].concat.apply([], inner.map(sq))) : [[1, 1], [W - 1, 1], [W - 1, H - 1], [1, H - 1]];
      var bedAreas = comps('B').map(function (c, k) { return { id: 'bed' + k, name: k ? 'Bedding' : 'Bedding area', poly: compPoly(c), big: k === 0 }; });
      var plots = comps('F').map(function (c, k) { return { id: 'food' + k, name: 'Food', poly: compPoly(c) }; });
      var water = cellsOf('W').concat(cellsOf('C')).map(sq);
      var cen = function (q) { return [(q.x + .5) * cw, (q.y + .5) * ch]; };
      var stands = (M.stands || []).map(function (s, k) { return { id: 's' + k, name: s.name || 'Stand', p: cen(s), h: 5, type: 'box' }; });
      var parking = (I.parking || []).map(function (p, k) { return { id: 'p' + k, name: 'Parking', p: cen(p) }; });
      window.HBK_STATIC = { W: W, H: H, mesh: mesh, naip: naip, pool: cv.toDataURL('image/png'), drain: { step: st, nx: dnx, ny: dny, ex: b64(ex), ey: b64(ey), u: b64(uu), pool: b64(pool) },
        feat: { boundary: boundary, stands: stands, cameras: [], beds: [], bedAreas: bedAreas, plots: plots, bait: [], scrapes: [], parking: parking, yourTrails: [], gasline: [], water: water, foodLabel: 'Food' },
        sources: { dem: 'USGS 3DEP (The National Map, best available), resampled to a 3 m mesh', naip: 'USGS The National Map, Imagery Only (mostly USDA NAIP, leaf-on; flight year varies by area)' } };
      var oc = document.createElement('canvas'); oc.width = oc.height = 1;
      window.HBK_OAK = { tex: oc.toDataURL('image/png'), nx: 1, ny: 1, labels: {}, classes: {}, peaks: { white: 0, red: 0 }, source: 'No oak layer for this property' };
      // engine static analysis on the same ground (160 x 160 -> engine 80 x 80)
      var n0 = 160, th = new Float64Array(n0 * n0); for (i = 0; i < n0; i++) for (j = 0; j < n0; j++) th[i * n0 + j] = hAt((j + .5) / n0 * W, (i + .5) / n0 * H);
      var bp = boundary.map(function (p) { return { x: p[0], y: p[1] }; }), pip = function (x, y) { return ENG.pip(bp, x, y); };
      var GEO = { W: W, H: H, xy: function (la, lo) { return { x: (lo - bb.w) / (bb.e - bb.w) * W, y: (bb.n - la) / (bb.n - bb.s) * H }; } };
      var G = ENG.prepStatic({ n: n0, h: th }, GEO, {}, pip); ENG.setLidarDrain(null);
      var STANDS = stands.map(function (s) { return { id: s.id, name: s.name, x: s.p[0], y: s.p[1], H: 5 }; });
      var BEDS = bedAreas.map(function (B) { var r = ENG.bedReceptors(B.poly.map(function (p) { return { x: p[0], y: p[1] }; }), ENG.PAR.bedStep); r.id = B.id; r.name = 'the bedding'; return r; });
      var WALKS = []; parking.forEach(function (pk) { STANDS.forEach(function (s) { var xy = [{ x: pk.p[0], y: pk.p[1] }, { x: s.x, y: s.y }], r = ENG.resample(xy, ENG.PAR.walkDs); WALKS.push({ id: 'w_' + pk.id + '_' + s.id, stand: s.id, src: 'slade', from: 'Parking', win: 'any', sec: 'any', xy: xy, rel: r.pts, length: r.length }); }); });
      var RT = T._routes(M, null).map(function (path, k) { var pts = path.map(function (g) { return { x: ((g % T.NX) + .5) / T.NX * W, y: (((g / T.NX) | 0) + .5) / T.NY * H }; }); return { key: 'r' + k, buck: 'r' + k, kind: 'guess', dir: 'fwd', period: 'dusk', label: 'Bedding → food (likely route)', n_visits: 0, pts: pts }; });
      CTX = { G: G, GEO: GEO, STANDS: STANDS, BEDS: BEDS, WALKS: WALKS, RT: RT, box: I.box, inside: function (x, y) { return x >= -150 && y >= -150 && x <= W + 150 && y <= H + 150; }, pip: pip };
      // day list: the chosen day and the six before it (each runs the engine when picked)
      var base = I.day ? new Date(I.day) : new Date(), list = [];
      for (var k = 0; k < 7; k++) { var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - k, 12); var id2 = 'd' + ymd(d.getTime()).replace(/-/g, '');
        list.push({ id: id2, label: (k === 0 ? 'Your day' : k === 1 ? 'Day before' : 'Earlier') + ' · ' + d.toLocaleString('en-US', { weekday: 'long' }), title: k === 0 ? 'Real weather on your ground' : 'Real weather, ' + ['two', 'three', 'four', 'five', 'six'][k - 2] + ' days before', d: d.getTime() }); }
      window.BL_DAY_LIST = list; window.BL_PORT.loadDay = computeDay; window.HBK_DAYS = window.HBK_DAYS || {};
      var hp = new URLSearchParams(location.search); if (!hp.get('day')) history.replaceState(null, '', location.pathname + location.search + '&day=' + list[0].id);
      return true;
    });
  }

  function computeDay(id) {
    if (window.HBK_DAYS[id]) return Promise.resolve(window.HBK_DAYS[id]);
    var L0 = window.BL_DAY_LIST.filter(function (x) { return x.id === id; })[0]; var p = lp(L0.d), t0 = zoned(p.y, p.m, p.d, 12, 0), t1 = t0 + 24 * 36e5;
    var I = IN(), loc = { lat: I.box.lat, lng: I.box.lng }, today = ymd(Date.now()); status('Running the wind, thermal and scent model on your day…');
    var wxP = I.wx ? Promise.resolve(I.wx) : ENG.fetchWx(ymd(t0 - 24 * 36e5), ymd(t1 + 24 * 36e5), loc, today, zoned);
    return wxP.then(function (wx) {
      var c = CTX, ENGp = ENG.PAR, X = ENGp.X, sev = function (pX) { return pX >= 0.5 ? 2 : pX >= 0.15 ? 1 : 0; };
      var met = wx.hours.map(function (w) { return ENG.metRecord(w, wx, loc, dayStart); }); var tA = t0 - ENGp.spinupH * 36e5;
      return ENG.runSlope(met.filter(function (r) { return r.t >= tA - 36e5 && r.t <= t1 + 36e5; }), tA, t1).then(function (SL) {
        var n = c.G.n, N = n * n, NH = 25, FS = 0.04, fvx = new Int8Array(NH * N), fvy = new Int8Array(NH * N), hrs = [], plumeIdx = [], plumeData = [], cross = [], setup = [], poolF = 0;
        var routes = c.RT.map(function (r) { var s = ENG.resample(r.pts, 4).pts.map(function (q) { return { x: q.x, y: q.y }; }); return Object.assign({}, r, { samples: s, solid: s.map(function () { return 0; }) }); });
        for (var i = 0; i < NH; i++) { var t = t0 + i * 36e5, rec = met.filter(function (r) { return r.t === t; })[0]; if (!rec) throw new Error('Missing weather hour');
          var ctx = ENG.hourCtx(rec, SL);
          for (var k = 0; k < N; k++) { var x = (k % n + .5) * c.G.dx, y = ((k / n | 0) + .5) * c.G.dy, v = ENG.velocity(ctx, x, y, 1, 0.3, 0, true);
            fvx[i * N + k] = Math.max(-127, Math.min(127, Math.round(v[0] / FS))); fvy[i * N + k] = Math.max(-127, Math.min(127, Math.round(v[1] / FS))); }
          var cl = 'ABCDEF'[rec.tur.cls - 1];
          if (rec.H <= 0 && (cl === 'E' || cl === 'F')) poolF += Math.max(0, -rec.Rn) * 3600 / 9e5 * (cl === 'F' ? 1 : 0.6); else if (rec.H > 0) poolF -= rec.H * 3600 / 2e5; else poolF -= 0.35;
          poolF = Math.max(0, Math.min(1, poolF)); var sl = ctx.sl, mp = moonPos(new Date(t), loc.lat, loc.lng), mi = window.parent && window.parent.BLAstro ? window.parent.BLAstro.moonIllum(new Date(t)).fraction * 100 : null;
          var P3 = met.filter(function (r) { return r.t === t - 3 * 36e5; })[0];
          hrs.push({ t: t, U: +rec.U.toFixed(2), dir: Math.round(rec.dir), gust: rec.gust, T2: +rec.T2.toFixed(1), RH: rec.RH, P: +(rec.P || 0).toFixed(1), n: +rec.n.toFixed(2), low: rec.low, mid: rec.mid, high: rec.high, SW: Math.round(rec.SW),
            elev: +rec.elev.toFixed(1), az: +rec.az.toFixed(1), cls: cl, srdt: rec.srdt ? 'ABCDEF'[rec.srdt - 1] : null, branch: rec.branch, Hf: +rec.H.toFixed(1), Rn: +rec.Rn.toFixed(1), L: +rec.L.toFixed(1), ustar: +rec.ustar.toFixed(3), wstar: +(rec.wstar || 0).toFixed(3), mixH: rec.h ? Math.round(rec.h) : null, sgn: sl ? sl.reg.sgn : 0,
            hunt: ENG.huntActive(ctx), lidarQ: false, jet: sl ? +Math.max.apply(null, sl.jets.map(Math.abs)).toFixed(2) : 0, poolF: +poolF.toFixed(3),
            moonAlt: +mp.alt.toFixed(1), moonAz: +mp.az.toFixed(1), moonIll: mi == null ? null : +mi.toFixed(1), front: 0, dP3: P3 && rec.P && P3.P ? +(rec.P - P3.P).toFixed(2) : null, dP24: null, precip: null, wxStatus: null, cv: null });
          var ms = ENG.members(rec, 'field');
          c.STANDS.forEach(function (st, si) { var mem = [];
            ms.forEach(function (m) { var Pth = ENG.pathFor(ctx, st, st.H, m, true, c.inside), pts = Pth.pts; if (!pts.length) { mem.push(null); return; }
              var keep = [], next = 0; for (var q = 0; q < pts.length; q++) { var pp = pts[q]; if (pp.tau >= next || q === pts.length - 1) { keep.push(q); next = pp.tau < 60 ? pp.tau + 5 : pp.tau < 300 ? pp.tau + 20 : pp.tau + 90; } if (pp.s > 900) break; }
              var arr = []; keep.forEach(function (q) { var pp = pts[q], u = Math.max(0.05, pp.dt > 0 ? ((q > 0 ? Math.hypot(pp.x - pts[q - 1].x, pp.y - pts[q - 1].y) : 0.5) / pp.dt) : 1);
                var vf = PHYS.verticalFactor(0, st.H, pp.sz, ctx.rec.branch === 'convective' ? ctx.rec.h : null), chi = vf / (Math.sqrt(2 * Math.PI) * pp.sy * Math.max(u, 0.1));
                arr.push(Math.round(pp.x), Math.round(pp.y), Math.min(32767, Math.round(pp.sy * 10)), Math.min(32767, Math.round(pp.sz * 10)), Math.min(32767, Math.round(pp.tau)), Math.max(-120, Math.round(Math.log10(Math.max(chi, 1e-12)) * 10))); });
              var off = plumeData.length; Array.prototype.push.apply(plumeData, arr); mem.push({ mode: Pth.mode, off: off, len: arr.length / 6 }); });
            plumeIdx.push({ i: i, si: si, mem: mem }); });
          c.STANDS.forEach(function (st, si) { var paths = ms.map(function (m) { return ENG.pathFor(ctx, st, st.H, m, true, c.inside).pts; });
            routes.forEach(function (r, ri) { r.samples.forEach(function (pp, pi) { if (pi % 2) return; var cc = 0; paths.forEach(function (pts) { cc += PHYS.pathChiQ(pts, pp.x, pp.y, 0, st.H, ctx.rec.branch === 'convective' ? ctx.rec.h : null) / paths.length; }); if (cc > X) cross.push(i, ri, pi, si); }); }); });
          var lh = lp(t).h, win = lh >= 3 && lh < 12 ? 'morning' : 'evening', st8 = [];
          c.STANDS.forEach(function (st, si) {
            var ex = c.BEDS.length ? ENG.standExposure(ctx, st, c.BEDS, 'field', c.inside, X) : { groups: [], central: [], mode: rec.U < 0.5 ? 'calm' : 'plume' };
            var g = ex.groups.map(function (q, gi) { return { name: c.BEDS[gi].name, pX: q.pX, inside: ENG.pip(c.BEDS[gi].poly, st.x, st.y) }; });
            var nCr = 0; for (var j = 0; j < cross.length; j += 4) if (cross[j] === i && cross[j + 3] === si) nCr++;
            var worst = g.slice().sort(function (a, b) { return b.pX - a.pX; })[0] || { pX: 0, name: '' }, ins = g.filter(function (q) { return q.inside; })[0], lvl = sev(worst.pX), why;
            var cen = ex.central || [], c150 = cen.filter(function (pp) { return pp.s >= 150; })[0] || cen[cen.length - 1], CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
            var goes = c150 && Math.hypot(c150.x - st.x, c150.y - st.y) > 20 ? CARD[Math.round(((Math.atan2(c150.x - st.x, -(c150.y - st.y)) * 180 / Math.PI + 360) % 360) / 22.5) % 16] : null;
            if (ins) { lvl = 2; why = 'You sit inside ' + ins.name; } else if (lvl === 2) why = 'Scent drifts into ' + worst.name; else if (lvl === 1) why = 'Scent can swirl into ' + worst.name;
            else if (nCr) { lvl = 1; why = 'Scent crosses a likely buck route'; } else if (ex.mode === 'calm' && rec.sgn < 0) why = 'Still air: scent sinks and creeps downhill, away from the beds';
            else if (ex.mode === 'calm') why = 'Still air: scent hangs around the stand, clear of the beds'; else if (goes) why = 'Scent drifts ' + goes + ' across the property, clear of the beds'; else why = 'Scent stays clear of the beds';
            var wres = c.WALKS.filter(function (w) { return w.stand === st.id; }).map(function (w) { var r = ENG.walkExposure(ctx, w, c.BEDS.length ? c.BEDS : [], 'lite', c.inside, X); var ww = (r.beds || []).map(function (q, bi) { return { name: c.BEDS[bi].name, pX: q.pX }; }).sort(function (a, b) { return b.pX - a.pX; })[0] || { pX: 0, name: '' };
              return { id: w.id, src: w.src, from: w.from, lvl: sev(ww.pX), pX: +ww.pX.toFixed(2), hit: ww.pX >= 0.15 ? ww.name : null }; }).sort(function (a, b) { return a.lvl - b.lvl || a.pX - b.pX; });
            st8.push({ id: st.id, lvl: lvl, why: why, goes: goes, score: +(worst.pX + (nCr ? 0.05 : 0)).toFixed(3), walks: wres.slice(0, 3) }); });
          setup.push({ i: i, win: win, sec: rec.U < 0.5 ? 'calm' : 'any', stands: st8 });
        }
        var used = {}; setup.forEach(function (h) { h.stands.forEach(function (q) { q.walks.forEach(function (w) { used[w.id] = 1; }); }); });
        var sunA = ENG.sunDay(t0, loc.lat, loc.lng, dayStart), sunB = ENG.sunDay(t0 + 24 * 36e5, loc.lat, loc.lng, dayStart);
        var D = { id: id, label: L0.label, title: L0.title, t0: t0, t1: t1, hours: 24, sun: { rise: [sunA.rise, sunB.rise], set: [sunA.set, sunB.set], dawn: [sunA.dawn, sunB.dawn], dusk: [sunA.dusk, sunB.dusk] },
          hrs: hrs, field: { n: n, dx: c.G.dx, dy: c.G.dy, scale: FS, z: 1, vx: b64(fvx), vy: b64(fvy) },
          stands: c.STANDS.map(function (s) { return { id: s.id, name: s.name, p: [+s.x.toFixed(1), +s.y.toFixed(1)], H: s.H }; }),
          plumes: { idx: plumeIdx, data: b64(Int16Array.from(plumeData)), stride: 6 }, cross: b64(Int16Array.from(cross)), X: X,
          routes: routes.map(function (r) { return { key: r.key, buck: r.buck, name: 'Likely route', color: '#FFD23F', kind: 'guess', dir: r.dir, period: r.period, label: r.label, n_visits: 0, tied: 0, samples: r.samples.map(function (q) { return [+q.x.toFixed(1), +q.y.toFixed(1)]; }), solid: r.solid }; }),
          visits: [], setup: setup, walks: c.WALKS.filter(function (w) { return used[w.id]; }).map(function (w) { return { id: w.id, stand: w.stand, src: w.src, from: w.from, path: w.xy.map(function (q) { return [+q.x.toFixed(1), +q.y.toFixed(1)]; }) }; }),
          cameras: [], sources: { weather: wx.sources, notes: wx.notes, engine: 'original 04_physics.js + 05_engine.js (unmodified), run in the phone' } };
        window.HBK_DAYS[id] = D; status(''); return D;
      });
    });
  }
  window.BLBuyer = { prepare: prepare, computeDay: computeDay, moonPos: moonPos };
})();
