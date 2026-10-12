/* Buck Ledger sun + moon helpers (on-device, no network).
 * Moon formulas follow the widely used SunCalc approach (V. Agafonkin, BSD), after Meeus / NASA approximations.
 * Moon effects on deer are WEAK EVIDENCE (GPS-collar studies found no consistent pattern); the app labels them so. */
(function () {
  'use strict';
  var PI = Math.PI, rad = PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  function toJ(d) { return d.valueOf() / dayMs - 0.5 + J1970; }
  function toDays(d) { return toJ(d) - J2000; }
  function ra(l, b) { return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)); }
  function dec(l, b) { return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)); }
  function sidereal(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }
  function alt(H, phi, dc) { return Math.asin(Math.sin(phi) * Math.sin(dc) + Math.cos(phi) * Math.cos(dc) * Math.cos(H)); }
  function sunCoords(d) {
    var M = rad * (357.5291 + 0.98560028 * d), C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + rad * 102.9372 + PI; return { dec: dec(L, 0), ra: ra(L, 0) };
  }
  function moonCoords(d) {
    var L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
    var l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dt = 385001 - 20905 * Math.cos(M);
    return { ra: ra(l, b), dec: dec(l, b), dist: dt };
  }
  function moonAlt(date, lat, lng) {
    var lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d), H = sidereal(d, lw) - c.ra;
    var h = alt(H, phi, c.dec); return h + rad * 0.017 / Math.tan(h + rad * 10.26 / (h + rad * 5.10));
  }
  function moonIllum(date) {
    var d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    var phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    var inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    var angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / PI };
  }
  function phaseName(p) {
    var n = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
    return n[Math.round(p * 8) % 8];
  }
  // moonrise / moonset for the local calendar day of `date` (scan in 10-minute steps, then refine)
  function moonTimes(date, lat, lng) {
    var t0 = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(), h0 = rad * 0.133, rise = null, set = null;
    var prev = moonAlt(new Date(t0), lat, lng) - h0;
    for (var m = 10; m <= 1440; m += 10) {
      var cur = moonAlt(new Date(t0 + m * 6e4), lat, lng) - h0;
      if (prev < 0 && cur >= 0 && !rise) rise = refine(t0 + (m - 10) * 6e4, t0 + m * 6e4, lat, lng, h0);
      if (prev >= 0 && cur < 0 && !set) set = refine(t0 + (m - 10) * 6e4, t0 + m * 6e4, lat, lng, h0);
      prev = cur;
    }
    return { rise: rise ? new Date(rise) : null, set: set ? new Date(set) : null };
  }
  function refine(a, b, lat, lng, h0) { var fa = moonAlt(new Date(a), lat, lng) - h0; for (var i = 0; i < 20; i++) { var mid = (a + b) / 2, fm = moonAlt(new Date(mid), lat, lng) - h0; if ((fa < 0) === (fm < 0)) { a = mid; fa = fm; } else b = mid; } return (a + b) / 2; }
  function moonAt(date, lat, lng) {
    var il = moonIllum(date), up = (lat !== null && lng !== null && lat !== undefined) ? moonAlt(date, lat, lng) > 0 : null;
    return { fraction: il.fraction, phase: il.phase, name: phaseName(il.phase), up: up };
  }
  window.BLAstro = { moonAt: moonAt, moonTimes: moonTimes, moonIllum: moonIllum, phaseName: phaseName, moonAlt: moonAlt };
})();
