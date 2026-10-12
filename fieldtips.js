/* Buck Ledger Field Tips: free for every tier. Each tip is short plain words with its published source.
   Every source link was opened on Oct 12, 2026 (CT). Anything without a source was left out. */
(function () {
  var V = 'Opened Oct 12, 2026';
  var TIPS = [
    { id: 'bottoms', type: 'bottom', title: 'Bottoms and low spots',
      text: 'On clear, calm nights, cool air slides downhill and pools in bottoms and low spots like water. It is coldest around sunrise, and your scent rides that same drift downhill.',
      src: [{ name: 'National Weather Service: Mountain/Valley Fog (cold air drainage)', url: 'https://www.weather.gov/safety/fog-mountain-valley', v: V },
            { name: 'FAO: Frost protection, cold air flows downhill and collects in low spots', url: 'https://www.fao.org/4/y7223e/y7223e0c.htm', v: V }] },
    { id: 'water', type: 'water', title: 'Water',
      text: 'Water warms and cools slowly. On a sunny day the cooler air over water drifts toward warmer land. On a clear night the land gets colder than the water, so the drift turns and heads from land toward the water.',
      src: [{ name: 'National Weather Service Binghamton: Lake Shadow / Lake Breeze', url: 'https://www.weather.gov/bgm/WeatherInActionLakeShadowBreeze', v: V }] },
    { id: 'field', type: 'field', title: 'Open fields after sunrise',
      text: 'Open ground heats first once the sun hits it. Warming air starts to rise and the downhill drift turns uphill. Expect a calm, swirly spell during the switch, and in fall it lasts longer than in spring.',
      src: [{ name: 'Nadeau et al. 2020, Environmental Fluid Mechanics (morning slope-flow transition)', url: 'https://link.springer.com/article/10.1007/s10652-018-9582-z', v: V },
            { name: 'Farina et al. 2023, Journal of Applied Meteorology and Climatology (read from a PDF excerpt; the site blocks automated checks)', url: 'https://journals.ametsoc.org/view/journals/apme/62/4/JAMC-D-22-0011.1.xml', v: 'Excerpt, Oct 12, 2026' },
            { name: 'De Frenne et al. 2019, Nature Ecology & Evolution (open ground is hotter than under trees on hot days)', url: 'https://www.nature.com/articles/s41559-019-0842-1', v: V }] },
    { id: 'woods', type: 'woods', title: 'Woods and timber',
      text: 'Wind slows a lot under timber, and more under a thick canopy than a thin one. Under trees the air also stays cooler on hot days and milder on cold nights than out in the open.',
      src: [{ name: 'US Forest Service RMRS-GTR-266 (wind under a forest canopy)', url: 'https://research.fs.usda.gov/treesearch/39729', v: V },
            { name: 'US Forest Service RMRS-GTR-192, wind reduction by canopy cover table', url: 'https://www.fs.usda.gov/rm/pubs/rmrs_gtr192.pdf', v: V },
            { name: 'De Frenne et al. 2019, Nature Ecology & Evolution', url: 'https://www.nature.com/articles/s41559-019-0842-1', v: V }] },
    { id: 'slope', type: 'slope', title: 'Slopes at night',
      text: 'On a clear night, air along even a gentle slope slides downhill. Small dips and curves in the slope steer it, so it does not always run straight down.',
      src: [{ name: 'Haiden & Whiteman 2005, Journal of Applied Meteorology (katabatic flow on a low-angle slope)', url: 'https://www.osti.gov/biblio/15020523', v: V }] },
    { id: 'soil', type: 'soil', title: 'Soil types',
      text: 'Moist ground (not soaked) stores the day\u2019s heat and gives it back at night better than dry, loose or high-organic ground. Dry, fluffy ground gets colder on a clear night.',
      src: [{ name: 'FAO: Frost protection, soil heat storage and conduction', url: 'https://www.fao.org/4/y7223e/y7223e0c.htm', v: V }] }
  ];
  function appLink() { var c = window.BL_CONFIG || window.CONFIG || {}; return c.APP_URL || (location.origin + location.pathname); }
  function share(id) {
    var t = TIPS.filter(function (x) { return x.id === id; })[0]; if (!t) return Promise.resolve('none');
    var data = { title: 'Field tip: ' + t.title, text: t.title + ': ' + t.text + ' (Buck Ledger Field Tips)', url: appLink() };
    if (navigator.share) return navigator.share(data).then(function () { return 'shared'; }, function () { return 'cancelled'; });
    if (navigator.clipboard) return navigator.clipboard.writeText(data.text + ' ' + data.url).then(function () { return 'copied'; }, function () { return 'none'; });
    return Promise.resolve('none');
  }
  window.BLTips = { all: TIPS, byType: function (ty) { return TIPS.filter(function (x) { return x.type === ty; })[0] || null; }, share: share, appLink: appLink };
})();
