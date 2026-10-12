/* Buck Ledger port of the original 3D sim: settings + data loader. The renderer (app.bundle.js) is the original sim, built from its own source.
   ?ex=1 -> Example property (original precomputed data, text identifiers hidden). ?buyer=1 -> the buyer's own ground (built by buyer.js). */
(function () {
  var QS = new URLSearchParams(location.search), buyer = QS.get('buyer') === '1';
  var hex = function (h) { return '#' + ('00000' + h.toString(16)).slice(-6); };
  var P = { standGood: 0x00bfa5, standCaution: 0xff8a00, standAvoid: 0xa0001e, hoof: 0xffd23f, scent: 0x9c6bff, thermalSink: 0x7fd4ff, thermalRise: 0xff80ab, bedding: 0x2e7d32, beddingMark: 0x6d4c41, food: 0xc8a26a, boundary: 0xff5252, walkIn: 0xc6ff00 };
  var f = function (h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; };
  var SC = f(P.scent);
  window.BL_PORT = {
    anon: !buyer, tapLabels: false, noBucks: buyer ? 'No buck visits on this day' : null, palette: P, dataBase: buyer ? 'buyer:' : 'data/',
    scentRGB: function (a) { return [SC[0] + .25 * (1 - a) * (1 - SC[0]), SC[1] + .25 * (1 - a) * (1 - SC[1]), SC[2]]; },
    sinkRGB: f(P.thermalSink), riseRGB: f(P.thermalRise),
    tours: function (T) { // same tour segments; the Example's stands replace the old ones nearest to them; no numbers in captions
      var MAP = { eastface: 'south', gasline: 'east' }, out = {};
      Object.keys(T).forEach(function (d) { out[d] = T[d].map(function (s) { var o = Object.assign({}, s); if (o.feat) o.feat = MAP[o.feat] || o.feat;
        o.cap = o.cap.replace(/\{(st|why|walk):(\w+)\}/g, function (_, k, id) { return '{' + k + ':' + (MAP[id] || id) + '}'; }).replace(/^Oct \d+ /, ''); o.cap = o.cap.charAt(0).toUpperCase() + o.cap.slice(1); return o; }); });
      return out; },
    keyPatch: function (K) {
      K[0][1] = 'linear-gradient(90deg,' + hex(P.standGood) + ' 0 33%,' + hex(P.standCaution) + ' 33% 66%,' + hex(P.standAvoid) + ' 66%)'; K[0][2] = 'Stands: teal = good, amber = careful, crimson = stay out (your scent vs the beds and buck routes, this hour). Tap a stand for its reason';
      K[1][1] = 'linear-gradient(90deg,' + hex(P.walkIn) + ',#fff)'; K[1][2] = 'Safest walk-in to the best stand (moving dots = you walking in). Crimson = every walk-in leaks scent into a bed';
      K[4][1] = 'linear-gradient(90deg,' + hex(P.thermalSink) + ',' + hex(P.thermalRise) + ')'; K[4][2] = 'Air at the ground and vapor: blue = cold air sinking, sliding downhill & pooling; rose pink = warm air rising after sunup';
      K[5][1] = 'linear-gradient(90deg,' + hex(P.scent) + ',#c9b2ff)'; K[5][2] = 'Your scent: violet cones reach downwind off each stand; violet puffs = the engine scent paths';
      K[6][2] = 'Buck routes: yellow hoof prints walk each route · solid glow = backed by camera visits · dotted = guess';
      K[10][1] = hex(P.bedding);
    },
    keyNote: null,
    views: buyer ? function (W, H, F) { // the original six views, aimed at the same kinds of places on the buyer's ground
      var s0 = (F.stands[0] || { p: [W / 2, H / 2] }).p, lowp = [W / 2, H / 2];
      return [{ id: 'all', name: 'Whole place', fit: true, t: [W / 2, H / 2], o: [0, 1100, 520] }, { id: 'south', name: 'South end', t: [W / 2, H * .75], o: [-90, 250, 300] },
        { id: 'north', name: 'North end', t: [W / 2, H * .3], o: [-120, 330, 380] }, { id: 'low', name: 'Low ground', t: lowp, o: [-380, 170, 260] },
        { id: 'ground', name: 'Eye level, south', t: [W / 2, H * .8], o: [-170, 42, 150] }, { id: 'swf', name: 'First stand (close)', t: s0, o: [-60, 150, 170] }]; } : null
  };
  function load(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  var go = buyer ? load('buyer.js').then(function () { return window.BLBuyer.prepare(); }) : (window.HBK_DAYS = window.BL_DAYS = {}, load('data/static.js').then(function () { return load('data/oak.js'); }).then(function () { window.HBK_STATIC = window.BL_STATIC; window.HBK_OAK = window.BL_OAK; return load('data/days.js'); }));
  go.then(function () {
    var S = window.HBK_STATIC.sources || {};
    window.BL_PORT.keyNote = 'Everything moves on real data: Open-Meteo hourly weather run through the wind, thermal and scent model, USGS lidar ground (' + (S.dem || 'USGS 3DEP') + '), aerial imagery (' + (S.naip || 'USDA NAIP via USGS') + ') and camera visits shown only as marks and routes (no pictures here). Time of day shows as sun and moon; temperature as the warm or cool tint; pressure as how heavy and hazy the air looks. Guessed route stretches are dotted. Oak areas are modelled from public forest data except the planted oaks the owner confirmed. Field Tips: tap any ground for a sourced tip.';
    return load('app.bundle.js');
  }).catch(function (e) { var l = document.getElementById('loading'); if (l) l.textContent = 'Could not load the 3D ground. ' + (e && e.message || ''); });
})();
