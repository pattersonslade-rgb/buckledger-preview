/* Buck Ledger weather: hourly Open-Meteo data, fetched ONLY when the user taps a button, cached on the phone.
 * Archive API for older days, forecast API (which also serves the last ~3 months) for recent and coming days. */
(function () {
  'use strict';
  var H = 'temperature_2m,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // hours come back in the phone's own time zone, the same clock the camera times are read in
  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto'; } catch (e) { return 'auto'; } }
  function key(lat, lng) { return lat.toFixed(2) + ',' + lng.toFixed(2); }
  function url(lat, lng, a, b) {
    var old = (Date.now() - new Date(a + 'T12:00:00').getTime()) > 80 * 864e5;
    return (old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast') +
      '?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) + '&start_date=' + a + '&end_date=' + b +
      '&hourly=' + H + '&timezone=' + encodeURIComponent(tz()) + '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch';
  }
  // cache: { "lat,lng": { "YYYY-MM-DD": [24 x {t,r,p,ws,wd,wg,cc}] } }
  function parse(j) {
    var h = j && j.hourly, out = {};
    if (!h || !Array.isArray(h.time)) throw new Error('bad weather data');
    h.time.forEach(function (t, i) {
      var day = String(t).slice(0, 10), hr = Number(String(t).slice(11, 13));
      if (!/^\d{4}-\d\d-\d\d$/.test(day) || !(hr >= 0 && hr < 24)) return;
      function v(a) { var x = h[a] && h[a][i]; return (typeof x === 'number' && isFinite(x)) ? x : null; }
      (out[day] = out[day] || [])[hr] = { t: v('temperature_2m'), r: v('precipitation'), p: v('pressure_msl'), ws: v('wind_speed_10m'), wd: v('wind_direction_10m'), wg: v('wind_gusts_10m'), cc: v('cloud_cover') };
    });
    return out;
  }
  // fetch every missing day (grouped into runs) for one place; returns number of days added
  function fill(cache, lat, lng, days, fetcher) {
    var k = key(lat, lng), have = cache[k] = cache[k] || {}, today = ymd(new Date());
    var need = days.filter(function (d) { return !have[d] || (d >= today); }).sort();
    if (!need.length) return Promise.resolve(0);
    var runs = [], cur = null;
    need.forEach(function (d) {
      if (cur && (new Date(d) - new Date(cur[1])) <= 864e5 * 1.5 && runs.length && (new Date(d) - new Date(cur[0])) < 864e5 * 60) cur[1] = d;
      else { cur = [d, d]; runs.push(cur); }
    });
    var added = 0;
    return runs.reduce(function (p, r) {
      return p.then(function () {
        return (fetcher || fetch)(url(lat, lng, r[0], r[1])).then(function (res) { if (!res.ok) throw new Error('weather ' + res.status); return res.json(); })
          .then(function (j) { var o = parse(j); Object.keys(o).forEach(function (d) { have[d] = o[d]; added++; }); });
      });
    }, Promise.resolve()).then(function () { return added; });
  }
  function hourAt(cache, lat, lng, date) {
    var day = (cache[key(lat, lng)] || {})[ymd(date)]; return day ? (day[date.getHours()] || null) : null;
  }
  // "front-like change": over the 24 h before `date`, pressure fell then rose AND temp dropped AND wind swung.
  function front(cache, lat, lng, date) {
    var hrs = [];
    for (var i = 30; i >= 0; i--) { var h = hourAt(cache, lat, lng, new Date(date.getTime() - i * 36e5)); if (h) hrs.push(h); }
    if (hrs.length < 18) return null;
    var ps = hrs.map(function (h) { return h.p; }).filter(function (x) { return x !== null; });
    if (ps.length < 18) return null;
    var minI = ps.indexOf(Math.min.apply(null, ps)), rise = ps[ps.length - 1] - ps[minI], fall = ps[0] - ps[minI];
    var t0 = hrs[0].t, t1 = hrs[hrs.length - 1].t, d0 = hrs[0].wd, d1 = hrs[hrs.length - 1].wd;
    var swing = (d0 === null || d1 === null) ? 0 : Math.abs(((d1 - d0 + 540) % 360) - 180);
    if (rise >= 2 && fall >= 1 && t0 !== null && t1 !== null && t0 - t1 >= 6 && swing >= 60) return 'cold';
    if (ps[ps.length - 1] - ps[0] <= -4) return 'falling';
    return null;
  }
  /* Property-clock weather for the simulators: Open-Meteo picks the time zone from the property's own spot (timezone=auto),
     so the hours are the property's hours, not the phone's. Times come back as real instants (unixtime).
     cache['site:lat,lng'] = { 'YYYY-MM-DD': [ {e (ms), t, ws, wd, cc, ...} by property hour ] } */
  function siteUrl(lat, lng, a, b) {
    var old = (Date.now() - new Date(a + 'T12:00:00').getTime()) > 80 * 864e5;
    return (old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast') +
      '?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) + '&start_date=' + a + '&end_date=' + b +
      '&hourly=' + H + '&timezone=auto&timeformat=unixtime&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch';
  }
  function parseSite(j) {
    var h = j && j.hourly, off = Number(j && j.utc_offset_seconds) || 0, out = {};
    if (!h || !Array.isArray(h.time)) throw new Error('bad weather data');
    h.time.forEach(function (t, i) {
      if (typeof t !== 'number' || !isFinite(t)) return;
      var L = new Date((t + off) * 1000), day = L.getUTCFullYear() + '-' + pad(L.getUTCMonth() + 1) + '-' + pad(L.getUTCDate()), hr = L.getUTCHours();
      function v(a) { var x = h[a] && h[a][i]; return (typeof x === 'number' && isFinite(x)) ? x : null; }
      (out[day] = out[day] || [])[hr] = { e: t * 1000, t: v('temperature_2m'), r: v('precipitation'), p: v('pressure_msl'), ws: v('wind_speed_10m'), wd: v('wind_direction_10m'), wg: v('wind_gusts_10m'), cc: v('cloud_cover') };
    });
    return out;
  }
  function fillSite(cache, lat, lng, a, b, fetcher) {
    var k = 'site:' + key(lat, lng), have = cache[k] = cache[k] || {};
    return (fetcher || fetch)(siteUrl(lat, lng, a, b)).then(function (res) { if (!res.ok) throw new Error('weather ' + res.status); return res.json(); })
      .then(function (j) { var o = parseSite(j), n = 0; Object.keys(o).forEach(function (d) { have[d] = o[d]; n++; }); return n; });
  }
  function siteHour(cache, lat, lng, ymdStr, hr) { var d = (cache['site:' + key(lat, lng)] || {})[ymdStr]; return d ? (d[hr] || null) : null; }
  var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function compass(deg) { return (deg === null || deg === undefined) ? '?' : DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }
  window.BLWx = { fillSite: fillSite, siteHour: siteHour, siteUrl: siteUrl, parseSite: parseSite, fill: fill, hourAt: hourAt, front: front, compass: compass, key: key, ymd: ymd, parse: parse, url: url };
})();
