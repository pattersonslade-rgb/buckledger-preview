/* Buck Ledger Movement Simulator, 2D (Elite).
 * Rebuilt Oct 12, 2026 on the same engine as the 3D Terrain Sim (terrain.js, BLTerrain), shown from straight above:
 * wind + slope air, scent with the wind's wavering spread, deer routes computed in the phone from YOUR bedding and food
 * marks, stands green / yellow / red with plain reasons, and the safest walk-in. No numbers, no graphs, no photos.
 * This file keeps the property map: the example property, the editor, and cleaning of saved maps. */
(function () {
  'use strict';
  var COLS = 20, ROWS = 26, N = COLS * ROWS;
  var ZONES = {
    '.': { name: 'Open / mixed', color: '#d8cfa6' },
    'B': { name: 'Bedding cover', color: '#4d6a37' },
    'F': { name: 'Food plot / ag field', color: '#c3c957' },
    'W': { name: 'Water', color: '#3f86c0' },
    'C': { name: 'Creek / slough', color: '#79acd6' },
    'N': { name: 'Funnel / pinch', color: '#9b7440' },
    'R': { name: 'Road / trail', color: '#9d9d98' },
    'X': { name: 'Neighbor boundary', color: '#c8553d' }
  };
  var ZKEYS = Object.keys(ZONES);
  var MAX_STANDS = 12, MAX_CAMS = 20;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) && v >= lo && v <= hi ? v : d; }

  /* ---------- example property: a real layout with every identifier removed (relative heights only, mirrored, renamed) ---------- */
  function example() {
    var E = window.BL_EXAMPLE || {};
    return {
      v: 1, name: 'Example property', example: true, acres: E.acres || 240, cols: COLS, rows: ROWS, cells: E.cells || new Array(N + 1).join('.'),
      stands: (E.stands || []).map(function (s) { return { x: s.x, y: s.y, name: s.name }; }),
      cams: (E.cams || []).map(function (c) { return { x: c.x, y: c.y, cam: '' }; })
    };
  }
  function exampleParking() { return ((window.BL_EXAMPLE || {}).parking || []).map(function (p) { return { x: p.x, y: p.y }; }); }
  function blank() { var c = ''; for (var i = 0; i < N; i++) c += '.'; return { v: 1, name: 'My property', example: false, acres: 80, cols: COLS, rows: ROWS, cells: c, stands: [], cams: [] }; }
  // Sanitize anything that comes from storage or a backup file.
  function clean(m) {
    if (!m || typeof m !== 'object') return null;
    var cells = typeof m.cells === 'string' ? m.cells : '';
    if (cells.length !== N) return null;
    cells = cells.replace(/[^.BFWCNRX]/g, '.');
    function pt(o) { return o && typeof o === 'object' && Number.isInteger(o.x) && Number.isInteger(o.y) && o.x >= 0 && o.y >= 0 && o.x < COLS && o.y < ROWS; }
    return {
      v: 1, name: String(m.name || 'My property').slice(0, 60), example: !!m.example, acres: num(m.acres, 1, 100000, 80), cols: COLS, rows: ROWS, cells: cells,
      stands: (Array.isArray(m.stands) ? m.stands : []).filter(pt).slice(0, MAX_STANDS).map(function (s, i) { return { x: s.x, y: s.y, name: String(s.name || ('Stand ' + (i + 1))).slice(0, 30) }; }),
      cams: (Array.isArray(m.cams) ? m.cams : []).filter(pt).slice(0, MAX_CAMS).map(function (c) { return { x: c.x, y: c.y, cam: String(c.cam || '').slice(0, 40) }; })
    };
  }

  /* ---------- UI ---------- */
  var CSS = '.bsim{color:inherit}.bsim .bs-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}' +
    '.bsim .bs-tab{min-height:44px;border-radius:10px;border:1px solid #3a4331;background:#252b20;color:#eee9da;font:inherit;font-weight:700}.bsim .bs-tab.on{background:#d9822b;border-color:#d9822b;color:#1d1407}' +
    '.bsim .bs-wrap{display:block}.bsim canvas{width:100%;display:block;border-radius:12px;background:#d8cfa6;touch-action:pan-y}.bsim.editing canvas{touch-action:none}' +
    '.bsim .bs-card{background:#f2ead6;color:#2a2b22;border-radius:14px;padding:12px;margin:10px 0}.bsim .bs-card h3{margin:0 0 8px;font-size:16px}' +
    '.bsim .bs-row{margin:0 0 12px}.bsim .bs-lab{display:flex;justify-content:space-between;font-size:13.5px;color:#6b6553;margin-bottom:4px}.bsim .bs-lab b{color:#2a2b22}' +
    '.bsim input[type=range]{width:100%;accent-color:#c4621a;height:30px}' +
    '.bsim .bs-seg{display:grid;gap:5px}.bsim .bs-seg button,.bsim .bs-btn{min-height:42px;border-radius:9px;border:2px solid #cbbf9f;background:#fffaf0;color:#2a2b22;font:inherit;font-size:13.5px;font-weight:700;padding:4px 6px}' +
    '.bsim .bs-seg button.on{background:#2a2b22;border-color:#2a2b22;color:#f2ead6}.bsim .bs-btn.go{background:#d9822b;border-color:#d9822b;color:#1d1407}' +
    '.bsim .bs-why{margin:0;padding-left:18px;line-height:1.45;font-size:14.5px}.bsim .bs-why li{margin-bottom:6px}.bsim .bs-src{display:inline-block;font-size:10.5px;font-weight:700;color:#7a3d14;border:1px solid #d6b48a;border-radius:8px;padding:0 5px;margin-left:2px;vertical-align:1px;white-space:nowrap}' +
    '.bsim .bs-stand{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed #cbbf9f;font-size:14.5px}.bsim .bs-stand:last-child{border-bottom:0}.bsim .bs-dot{width:14px;height:14px;border-radius:50%;flex:none;border:2px solid #2a2b22}' +
    '.bsim .c-green{background:#3f9b3a}.bsim .c-yellow{background:#e3c02f}.bsim .c-red{background:#cf3b2b}.bsim .bs-tools{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.bsim .bs-tools button{min-height:44px;border-radius:9px;border:2px solid #cbbf9f;background:#fffaf0;font:inherit;font-size:12px;font-weight:700;color:#2a2b22;display:flex;align-items:center;gap:5px;padding:3px 5px;text-align:left;line-height:1.1}' +
    '.bsim .bs-tools button.on{border-color:#2a2b22;box-shadow:0 0 0 2px #2a2b22 inset}.bsim .bs-sw{width:14px;height:14px;border-radius:3px;flex:none;border:1px solid rgba(0,0,0,.3)}' +
    '.bsim .bs-note{font-size:12.5px;color:#6b6553;margin:6px 0 0}.bsim .bs-in{width:100%;min-height:44px;border-radius:9px;border:1px solid #cbbf9f;background:#fffaf0;color:#2a2b22;font:inherit;font-size:16px;padding:8px 10px}' +
    '.bsim .bs-legend{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11.5px;color:#d9d4c4;margin:6px 2px 0}.bsim .bs-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:3px;vertical-align:-1px}' +
    '.bsim .bs-flag{background:#33291b;border:1px solid #d9822b;color:#f7d9b5;border-radius:10px;padding:7px 10px;font-size:13px;margin:0 0 8px}' +
    '@media (min-width:820px){.bsim .bs-wrap{display:grid;grid-template-columns:1.1fr 1fr;gap:14px;align-items:start}}';

  function mount(root, host) {
    host = host || {};
    if (!document.getElementById('bsim-css')) { var st = document.createElement('style'); st.id = 'bsim-css'; st.textContent = CSS; document.head.appendChild(st); }
    var map = clean(host.getMap && host.getMap()) || example();
    var mode = 'sim', tool = 'B', brush = 1, camPick = '', undo = [], dead = false, canvas = null, ctx = null, cw = 0, eng = null;
    function saveMap() { if (host.saveMap) host.saveMap(map); }
    function shell() {
      if (eng) { eng.destroy(); eng = null; }
      root.innerHTML = '<div class="bsim" id="bsim"><div class="bs-tabs"><button class="bs-tab" data-bs="mode-sim">Simulate</button><button class="bs-tab" data-bs="mode-edit">Edit map</button></div>' +
        (map.example ? '<div class="bs-flag" id="bs-example">Showing the <b>Example property</b> (not your land). Tap <b>Edit map</b> to draw yours.</div>' : '') +
        (mode === 'sim' ? '<div id="bs-engine"></div><p class="bs-note" id="bs-model">This is a model, not a forecast. Wind spread, scent spread and slope air come from published air-flow methods; deer routes come from your own bedding and food marks.</p>'
          : '<div class="bs-wrap"><div><canvas id="bs-canvas" aria-label="Property map"></canvas><div class="bs-legend" id="bs-legend"></div></div><div id="bs-side"></div></div>') + '</div>';
      Array.prototype.forEach.call(root.querySelectorAll('.bs-tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-bs') === 'mode-' + mode); });
      if (mode === 'sim') {
        canvas = null; ctx = null;
        var el = root.querySelector('#bs-engine');
        if (window.BLTerrain && host.engineHost) eng = window.BLTerrain.mount(el, host.engineHost(map, map.example ? exampleParking() : null));
        return;
      }
      root.querySelector('#bsim').classList.add('editing');
      canvas = root.querySelector('#bs-canvas'); ctx = canvas.getContext('2d');
      canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
      size(); side(); legend(); draw();
    }
    function size() { var w = Math.min(root.clientWidth || 360, 560), dpr = window.devicePixelRatio || 1; cw = w / COLS; canvas.style.height = (cw * ROWS) + 'px'; canvas.width = Math.round(w * dpr); canvas.height = Math.round(cw * ROWS * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function legend() {
      var el = root.querySelector('#bs-legend'); if (!el) return;
      el.innerHTML = ZKEYS.filter(function (k) { return k !== '.'; }).map(function (k) { return '<span><i style="background:' + ZONES[k].color + '"></i>' + ZONES[k].name + '</span>'; }).join('');
    }
    function side() { var el = root.querySelector('#bs-side'); if (!el) return; el.innerHTML = editPanel(); bindEdit(); }
    function editPanel() {
      var camOpts = (host.cameras ? host.cameras() : []);
      return '<div class="bs-card" id="bs-editor"><h3>Draw your property</h3>' +
        '<div class="bs-tools">' + ZKEYS.map(function (k) { return '<button data-bs="tool:' + k + '" class="' + (tool === k ? 'on' : '') + '"><span class="bs-sw" style="background:' + ZONES[k].color + '"></span>' + (k === '.' ? 'Erase' : ZONES[k].name) + '</button>'; }).join('') +
        '<button data-bs="tool:stand" class="' + (tool === 'stand' ? 'on' : '') + '"><span class="bs-sw" style="background:#fff;border-radius:50%"></span>Stand</button>' +
        (host.cameras ? '<button data-bs="tool:cam" class="' + (tool === 'cam' ? 'on' : '') + '"><span class="bs-sw" style="background:#2a2b22"></span>Camera</button>' : '') + '</div>' +
        '<div class="bs-seg" style="grid-template-columns:1fr 1fr;margin-top:8px"><button data-bs="brush:1" class="' + (brush === 1 ? 'on' : '') + '">Fine brush</button><button data-bs="brush:2" class="' + (brush === 2 ? 'on' : '') + '">Wide brush</button></div>' +
        (tool === 'cam' ? '<label class="bs-lab" style="margin-top:8px"><span>Which Buck Ledger camera?</span></label><select class="bs-in" id="bs-campick">' + (camOpts.length ? camOpts.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === camPick ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') : '<option value="">No cameras yet</option>') + '</select>' : '') +
        '<p class="bs-note">Tap or drag on the map to paint. ' + (host.cameras ? 'Stand / Camera' : 'Stand') + ': tap to place, tap again to remove. North is up.' + (host.cameras ? ' Routes are drawn solid where they pass a square with one of your cameras.' : '') + '</p></div>' +
        '<div class="bs-card"><label class="bs-lab"><span>Property name</span></label><input class="bs-in" id="bs-name" maxlength="60" value="' + esc(map.name) + '">' +
        '<label class="bs-lab" style="margin-top:8px"><span>Acres (sets the scale)</span><b id="bs-scale">' + scaleText() + '</b></label><input class="bs-in" id="bs-acres" type="number" min="1" max="100000" value="' + map.acres + '">' +
        '<div class="bs-seg" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px"><button data-bs="undo">↶ Undo</button><button data-bs="clear">Blank map</button><button data-bs="example">Example</button></div>' +
        '<p class="bs-note">Saved on this phone automatically, and included in your Buck Ledger backup file.</p></div>';
    }
    function scaleText() { var sq = map.acres / N, side = Math.sqrt(map.acres * 43560 / N); return 'each square ≈ ' + (sq < 1 ? sq.toFixed(2) : sq.toFixed(1)) + ' ac (' + Math.round(side) + ' ft)'; }
    function bindEdit() {
      var nm = root.querySelector('#bs-name'), ac = root.querySelector('#bs-acres'), cp = root.querySelector('#bs-campick');
      nm.addEventListener('change', function () { map.name = String(nm.value || 'My property').slice(0, 60); map.example = false; saveMap(); });
      ac.addEventListener('change', function () { map.acres = num(ac.value, 1, 100000, map.acres); ac.value = map.acres; root.querySelector('#bs-scale').textContent = scaleText(); saveMap(); });
      if (cp) { if (!camPick && cp.value) camPick = cp.value; cp.addEventListener('change', function () { camPick = cp.value; }); }
    }
    /* drawing */
    function draw() {
      if (!ctx) return; var c = map.cells, W2 = cw * COLS, H2 = cw * ROWS;
      ctx.clearRect(0, 0, W2, H2);
      for (var i = 0; i < N; i++) { var x = i % COLS, y = (i / COLS) | 0; ctx.fillStyle = ZONES[c[i]].color; ctx.fillRect(x * cw, y * cw, cw + 0.5, cw + 0.5); }
      ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1;
      for (var gx = 1; gx < COLS; gx++) { ctx.beginPath(); ctx.moveTo(gx * cw, 0); ctx.lineTo(gx * cw, H2); ctx.stroke(); }
      for (var gy = 1; gy < ROWS; gy++) { ctx.beginPath(); ctx.moveTo(0, gy * cw); ctx.lineTo(W2, gy * cw); ctx.stroke(); }
      map.stands.forEach(function (s, k) {
        var px = (s.x + 0.5) * cw, py = (s.y + 0.5) * cw, r = Math.max(7, cw * 0.42);
        ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#1d1d17'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1d1d17'; ctx.font = 'bold ' + Math.round(r * 1.1) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k + 1), px, py + 0.5);
      });
      map.cams.forEach(function (cm) { var px = cm.x * cw, py = cm.y * cw; ctx.fillStyle = '#2a2b22'; ctx.fillRect(px + cw * 0.18, py + cw * 0.18, cw * 0.64, cw * 0.64); });
      ctx.fillStyle = 'rgba(29,29,23,.8)'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N ↑', W2 - 18, 12);
    }
    /* editing */
    var painting = false, lastCell = -1;
    function cellAt(e) { var r = canvas.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / (r.width / COLS)), y = Math.floor((e.clientY - r.top) / (r.height / ROWS)); return x >= 0 && y >= 0 && x < COLS && y < ROWS ? [x, y] : null; }
    function pushUndo() { undo.push(JSON.stringify(map)); if (undo.length > 30) undo.shift(); }
    function paintAt(p) {
      var arr = map.cells.split(''), changed = false;
      for (var dy = 0; dy < brush; dy++) for (var dx = 0; dx < brush; dx++) { var x = p[0] + dx, y = p[1] + dy; if (x < COLS && y < ROWS && arr[y * COLS + x] !== tool) { arr[y * COLS + x] = tool; changed = true; } }
      if (changed) { map.cells = arr.join(''); map.example = false; draw(); }
    }
    function placePoint(p) {
      var list = tool === 'stand' ? map.stands : map.cams, k = -1;
      list.forEach(function (o, i) { if (o.x === p[0] && o.y === p[1]) k = i; });
      pushUndo();
      if (k >= 0) list.splice(k, 1);
      else if (tool === 'stand') { if (map.stands.length >= MAX_STANDS) { if (host.toast) host.toast('Up to ' + MAX_STANDS + ' stands'); undo.pop(); return; } map.stands.push({ x: p[0], y: p[1], name: 'Stand ' + (map.stands.length + 1) }); }
      else { if (!camPick) { if (host.toast) host.toast('Log a pull first so you have a camera to place'); undo.pop(); return; } if (map.cams.length >= MAX_CAMS) { undo.pop(); return; } map.cams.push({ x: p[0], y: p[1], cam: camPick }); }
      map.example = false; saveMap(); draw();
    }
    function onDown(e) {
      if (mode !== 'edit') return; var p = cellAt(e); if (!p) return; e.preventDefault();
      if (tool === 'stand' || tool === 'cam') { placePoint(p); return; }
      pushUndo(); painting = true; lastCell = -1; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} paintAt(p);
    }
    function onMove(e) { if (!painting) return; var p = cellAt(e); if (!p) return; var id = p[1] * COLS + p[0]; if (id === lastCell) return; lastCell = id; paintAt(p); }
    function onUp() { if (!painting) return; painting = false; saveMap(); var f = root.querySelector('#bs-example'); if (f) f.remove(); }
    function onClick(e) {
      var b = e.target.closest('[data-bs]'); if (!b || !root.contains(b)) return;
      var a = b.getAttribute('data-bs'), kv = a.split(':'), k = kv[0], v = kv[1];
      if (a === 'mode-sim' || a === 'mode-edit') { mode = a === 'mode-sim' ? 'sim' : 'edit'; shell(); return; }
      if (k === 'tool') { tool = v; side(); return; }
      if (k === 'brush') { brush = Number(v); side(); return; }
      if (a === 'undo') { var u = undo.pop(); if (u) { var old = clean(JSON.parse(u)); if (old) { map.cells = old.cells; map.stands = old.stands; map.cams = old.cams; } saveMap(); shell(); } return; }
      if (a === 'clear') { pushUndo(); var nm = map.example ? 'My property' : map.name, ac = map.example ? 80 : map.acres; map = blank(); map.name = nm; map.acres = ac; saveMap(); shell(); return; }
      if (a === 'example') { pushUndo(); map = example(); saveMap(); shell(); return; }
    }
    function onResize() { if (!canvas) return; size(); draw(); }
    function destroy() { dead = true; if (eng) { eng.destroy(); eng = null; } root.removeEventListener('click', onClick); window.removeEventListener('resize', onResize); }
    root.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
    shell();
    var api = {
      destroy: destroy, getMap: function () { return JSON.parse(JSON.stringify(map)); },
      engine: function () { return eng; },
      state: function () { var e = eng && eng.state(); return { mode: mode, tool: tool, example: !!map.example, engine: e, stands: e ? e.stands : [], why: e ? e.why : [] }; }
    };
    root.__bsim = api;
    return api;
  }
  window.BuckSim = { mount: mount, example: example, exampleParking: exampleParking, blank: blank, clean: clean, ZONES: ZONES, COLS: COLS, ROWS: ROWS };
})();
