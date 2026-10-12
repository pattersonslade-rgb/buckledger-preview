/* =====================================================================
   ENGINE: real weather -> hourly meteorology & stability -> Prandtl slope
   flow on the DEM -> trajectory Gaussian plume/puff ensembles -> relative
   concentration (chi/Q) fields and receptor exposure statistics.
   Pure (no DOM). Every parameter is listed in ENG.PAR with its source and is
   mirrored in the Methods panel and README.
   ===================================================================== */
const ENG=(()=>{
'use strict';
const PH=PHYS,D2R=Math.PI/180,R2D=180/Math.PI;
const PAR={
  z0:0.5,          // m. EPA-454/R-99-005 Table 6-10: parkland 0.5 m, forest 0.5-1.0 m (low end chosen; see limitations)
  rNoon:0.16,      // noon albedo, deciduous forest, autumn: AERSURFACE User's Guide (EPA-454/B-08-001) Table A-1
  calmU:1.0,       // m/s. Steady-state plume models are validated down to ~1 m/s (EPA-454/R-99-005 sec. 6.2.3); below it the puff (calm) mode is used
  dthdzStd:0.00327,// K/m. US Standard Atmosphere 1976 lapse rate 6.5 K/km -> d(theta)/dz = g/cp - 0.0065. Floor for the free-air N^2
  poolDepth:0.01,  // m. Depression-fill depth that marks a closed cold-air pool = the DEM vertical quantisation (terrain.json stores cm)
  slopeDeg:[0.05,0.1,0.2,0.35,0.6,1,1.6,2.5,4,6.5], // slope-model bins (deg) spanning the DEM's slope distribution; cells interpolate in log(angle)
  minSlopeDeg:0.05,// below this the DEM cannot resolve a slope (1.4 cm rise over a 16 m cell): no slope forcing
  nG:80,           // model grid (DEM 160x160 averaged 2x2 -> ~15.6 m x 15.9 m)
  dtSlope:30,      // s, slope-model time step
  storeEvery:10,   // store slope-model state every 10 steps (5 min)
  spinupH:8,       // h of slope-model spin-up before the first displayed hour
  zs:[0.75,1,1.5,2,3,4,5,6,8,10,13,16,20,25,30,40,50,65,80,100], // m, profile sample heights (lowest = 1.5 z0, AERMOD profile floor)
  nDir:5,          // direction quantiles of N(0, sigma_theta)
  layerK:2.15,     // plume-layer half depth in sigma_z for effective transport wind (AERMOD effective-parameter convention)
  Tmax:3600,       // s, puff travel time simulated per hour (= the averaging hour)
  sMax:2500,       // m, max travel distance (domain is ~1.25 km across)
  X:1e-4,          // s/m3, DEFAULT display threshold for P(chi/Q > X). User-adjustable. NOT a deer-detection threshold (none is known).
  receptorZ:0,     // m, ground-level receptors
  // 3DEP 0.5 m lidar drainage (micro-relief): used for the walk-in (Entry Risk) only in hours that qualify for a drainage flow
  lidarCloudMax:0.375, // cloud fraction <= 3/8: the Turner night-time stable classes E/F need <= 3/8 cloud (EPA-454/R-99-005 Table 6-6)
  lidarUmax:2.5,       // m/s at 10 m: midpoint of the 2-3 m/s ceiling; Soler et al. 2002 (shallow gully): drainage deepest/fastest with ambient wind < 2 m/s
  lidarDepth:2.0,      // m, drainage-layer depth of the weak case (h in u = sqrt(g' h sin(a) / C_D)); the realistic case for the median 0.86 deg slope
  lidarCase:'weak',    // weak (dtheta 1 K, h 2 m, C_D 0.02) = the realistic case; typical/strong are sensitivity cases
};
const GRAV=9.81,CP=1004;
/* ---------------- static terrain analysis ---------------- */
let G=null;
function prepStatic(TER,GEO,P,isInside){
  const n0=TER.n,n=PAR.nG,f=n0/n,h=new Float64Array(n*n);
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){let s=0;for(let a=0;a<f;a++)for(let b=0;b<f;b++)s+=TER.h[(i*f+a)*n0+j*f+b];h[i*n+j]=s/(f*f)}
  const dx=GEO.W/n,dy=GEO.H/n,N=n*n;
  const fill=PH.priorityFlood(h,n,n,0),fillE=PH.priorityFlood(h,n,n,1e-5),D=PH.dinf(fillE,n,n,dx,dy);
  const depth=new Float64Array(N),pool=new Uint8Array(N),slopeDeg=new Float64Array(N);
  for(let k=0;k<N;k++){depth[k]=fill[k]-h[k];pool[k]=depth[k]>PAR.poolDepth?1:0;slopeDeg[k]=Math.atan(D.slope[k])*R2D}
  const Lup=PH.upslopeLength(fillE,D,n,n,dx,dy),dZup=PH.upslopeDrop(fillE,D,n,n),A=PH.contributingArea(fillE,D,n,n,dx*dy);
  // downslope flow length to the nearest pool/outlet along D-inf receivers (fetch for UPslope flow)
  const Ldown=new Float64Array(N),dZdown=new Float64Array(N),asc=[...Array(N).keys()].sort((a,b)=>fillE[a]-fillE[b]);
  const dist=(k,r)=>Math.hypot(((r%n)-(k%n))*dx,(((r/n)|0)-((k/n)|0))*dy);
  for(const k of asc){if(pool[k])continue;let v=0,z=0,w=0;for(const[r,wt]of[[D.r1[k],D.w1[k]],[D.r2[k],D.w2[k]]])if(r>=0&&wt>1e-6){v+=wt*(dist(k,r)+Ldown[r]);z+=wt*(fillE[k]-fillE[r]+dZdown[r]);w+=wt}Ldown[k]=w?v/w:0;dZdown[k]=w?z/w:0}
  const bi=new Int8Array(N).fill(-1),bw=new Float32Array(N),facet=new Uint8Array(N),mask=new Uint8Array(N),lg=PAR.slopeDeg.map(Math.log);
  for(let k=0;k<N;k++){const s=slopeDeg[k];
    if(pool[k])facet[k]=5;else if(s<PAR.minSlopeDeg)facet[k]=4;else{const az=(Math.atan2(D.sx[k],-D.sy[k])*R2D+360)%360;facet[k]=Math.round(az/90)%4} // 0 N,1 E,2 S,3 W-facing, 4 flat, 5 pool
    if(!pool[k]&&s>=PAR.minSlopeDeg){const l=Math.log(s);let i=0;while(i<lg.length-2&&l>lg[i+1])i++;bi[k]=i;bw[k]=Math.min(1,Math.max(0,(l-lg[i])/(lg[i+1]-lg[i])))}
    mask[k]=isInside((k%n+.5)*dx,((k/n|0)+.5)*dy)?1:0}
  const ins=[...Array(N).keys()].filter(k=>mask[k]),sl=ins.map(k=>slopeDeg[k]).sort((a,b)=>a-b),q=p=>sl[Math.min(sl.length-1,Math.floor(p*sl.length))];
  G={n,dx,dy,W:GEO.W,H:GEO.H,h,fill,depth,pool,D,slopeDeg,Lup,Ldown,dZup,dZdown,A,bi,bw,facet,mask,
     stats:{slopeMedian:q(0.5),slopeP75:q(0.75),slopeP95:q(0.95),slopeMax:sl[sl.length-1],poolCells:ins.filter(k=>pool[k]).length,cells:ins.length,
       maxPoolDepth:Math.max(...ins.map(k=>depth[k])),relief:Math.max(...ins.map(k=>h[k]))-Math.min(...ins.map(k=>h[k]))}};
  return G;
}
const cellOf=(x,y)=>{const j=Math.floor(x/G.dx),i=Math.floor(y/G.dy);return(i<0||j<0||i>=G.n||j>=G.n)?-1:i*G.n+j};
/* ---------------- weather (Open-Meteo) ---------------- */
const CORE=['temperature_2m','wind_speed_10m','wind_direction_10m','wind_gusts_10m','surface_pressure','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','shortwave_radiation','relative_humidity_2m'];
const SUPP=['temperature_80m','temperature_120m','temperature_180m','soil_temperature_0cm','boundary_layer_height','temperature_975hPa','temperature_925hPa','geopotential_height_975hPa','geopotential_height_925hPa'];
const SRC_NAME={era5:'Open-Meteo Historical Weather API (ERA5 / ERA5-Land reanalysis)',hist:'Open-Meteo Historical Forecast API (archived NWP runs, best-match model)',fc:'Open-Meteo Forecast API (best-match NWP model)'};
const WXC={};
async function getJSON(url){const r=await fetch(url);if(!r.ok)throw new Error(url.split('?')[0].split('/')[2]+' HTTP '+r.status);const j=await r.json();if(j.error)throw new Error(j.reason||'API error');return j}
// a, b: YYYY-MM-DD (local). today: YYYY-MM-DD. zonedFn(y,m,d,h,mi) -> epoch ms for America/Chicago wall time.
async function fetchWx(a,b,loc,today,zonedFn){
  const key=[a,b,loc.lat,loc.lng].join('|');if(WXC[key])return WXC[key];
  const q=`latitude=${loc.lat}&longitude=${loc.lng}&timezone=America%2FChicago&wind_speed_unit=ms&start_date=${a}&end_date=${b}`;
  const suppKind=b<today?'hist':'fc',suppUrl=suppKind==='hist'?'https://historical-forecast-api.open-meteo.com/v1/forecast':'https://api.open-meteo.com/v1/forecast';
  const notes=[];
  const supp=await getJSON(`${suppUrl}?${q}&hourly=${[...CORE,...SUPP].join(',')}&minutely_15=wind_speed_10m,wind_direction_10m`);
  let arch=null;if(a<today){try{arch=await getJSON(`https://archive-api.open-meteo.com/v1/archive?${q}&hourly=${CORE.join(',')},soil_temperature_0_to_7cm,boundary_layer_height`)}catch(e){notes.push('ERA5 archive unavailable ('+e.message+'); NWP values used')}}
  const toMs=s=>{const[d,t]=s.split('T'),[y,m,dd]=d.split('-').map(Number),[hh,mi]=t.split(':').map(Number);return zonedFn(y,m,dd,hh,mi)};
  const AI={};if(arch)arch.hourly.time.forEach((s,i)=>AI[s]=i);
  const hours=supp.hourly.time.map((s,i)=>{const r={t:toMs(s),iso:s,src:{}};
    for(const v of CORE){const av=arch&&AI[s]!==undefined?arch.hourly[v]?.[AI[s]]:null;if(av!=null){r[v]=av;r.src[v]='era5'}else{r[v]=supp.hourly[v]?.[i]??null;r.src[v]=r[v]==null?'none':suppKind}}
    for(const v of SUPP){r[v]=supp.hourly[v]?.[i]??null;r.src[v]=r[v]==null?'none':suppKind}
    if(arch&&AI[s]!==undefined){r.soil_temperature_0_to_7cm=arch.hourly.soil_temperature_0_to_7cm?.[AI[s]]??null;r.blh_era5=arch.hourly.boundary_layer_height?.[AI[s]]??null}
    return r}).filter(r=>r.wind_speed_10m!=null&&r.wind_direction_10m!=null&&r.temperature_2m!=null);
  const m15=(supp.minutely_15?.time||[]).map((s,i)=>({t:toMs(s),ws:supp.minutely_15.wind_speed_10m[i],wd:supp.minutely_15.wind_direction_10m[i]})).filter(o=>o.ws!=null&&o.wd!=null);
  const used={};hours.forEach(h=>Object.values(h.src).forEach(s=>used[s]=1));
  const res={hours,m15,suppKind,notes,sources:Object.keys(used).filter(k=>SRC_NAME[k]).map(k=>SRC_NAME[k]),gridElev:supp.elevation,gridLat:supp.latitude,gridLng:supp.longitude};
  WXC[key]=res;return res;
}
/* ---------------- hourly meteorology & stability ---------------- */
const sunCache={};
function sunDay(ms,lat,lng,dayStartFn){const d0=dayStartFn(ms),k=d0+'|'+lat;if(sunCache[k])return sunCache[k];
  const noon=d0+12*36e5,r={rise:PH.sunEvent(d0,noon,lat,lng,true),set:PH.sunEvent(noon,d0+24*36e5,lat,lng,false),
    dawn:PH.sunEvent(d0,noon,lat,lng,true,-6),dusk:PH.sunEvent(noon,d0+24*36e5,lat,lng,false,-6),noon};sunCache[k]=r;return r}
function albedo(elev){if(elev<=0)return PAR.rNoon;const r=PAR.rNoon;return r+(1-r)*Math.exp(-0.1*elev-0.5*(1-r)*(1-r))} // AERMOD eq. 3 albedo(phi)
function thetaK(TK,p){return TK*Math.pow(1000/p,0.2857)}
function metRecord(w,wx,loc,dayStartFn){
  const t=w.t,sp=PH.solarPosition(t,loc.lat,loc.lng),spP=PH.solarPosition(t-36e5,loc.lat,loc.lng),elevMean=(sp.elevation+spP.elevation)/2;
  const U=Math.max(0,w.wind_speed_10m),dir=w.wind_direction_10m,TK=w.temperature_2m+273.15,Pp=w.surface_pressure??1013,n=(w.cloud_cover??0)/100,SW=Math.max(0,w.shortwave_radiation??0);
  const sd=sunDay(t,loc.lat,loc.lng,dayStartFn);
  const nightT=t<sd.rise+36e5||t>sd.set-36e5; // Turner: night = 1 h before sunset to 1 h after sunrise (EPA-454/R-99-005 Table 6-6)
  const low=w.cloud_cover_low??0,mid=w.cloud_cover_mid??0,high=w.cloud_cover_high??0;
  const ceiling=low>=62.5?'low':mid>=62.5?'mid':high>=62.5?'high':'none'; // ceiling = lowest layer >= 5/8 (broken/overcast)
  const tenths=Math.round(n*10);
  const tur=PH.pgTurner(U,sp.elevation,tenths,ceiling,nightT);
  let dTsign=null,dTsrc='none';
  if(w.temperature_80m!=null){const d=w.temperature_80m-w.temperature_2m;dTsign=d<0?-1:1;dTsrc=`T80-T2 = ${d.toFixed(2)} K`}
  else if(w.soil_temperature_0cm!=null){const d=w.temperature_2m-w.soil_temperature_0cm;dTsign=d<0?-1:1;dTsrc=`T2-Tskin = ${d.toFixed(2)} K`}
  const isDay=sp.elevation>0;
  const srdt=(isDay||dTsign!==null)?PH.pgSRDT(U,isDay,SW,dTsign):null;
  const sc=PH.surfaceScheme({U10:U,TK,P_hPa:Pp,n,Kdown:SW,z0:PAR.z0,albedo:albedo(elevMean),blh:null});
  let h=sc.branch==='convective'?(w.boundary_layer_height??w.blh_era5??null):2400*Math.pow(sc.ustar,1.5); // convective: NWP PBL height; stable: Venkatram (1980)
  let wstar=0;if(sc.branch==='convective'&&h)wstar=Math.cbrt(GRAV*sc.H*h/(sc.rho*CP*TK));
  // free-air stratification between 975 and 925 hPa
  let N2=null,N2src='US Std Atmosphere floor';
  if(w.temperature_975hPa!=null&&w.temperature_925hPa!=null&&w.geopotential_height_975hPa!=null&&w.geopotential_height_925hPa!=null){
    const th1=thetaK(w.temperature_975hPa+273.15,975),th2=thetaK(w.temperature_925hPa+273.15,925),dz=w.geopotential_height_925hPa-w.geopotential_height_975hPa;
    if(dz>50){N2=GRAV/((th1+th2)/2)*(th2-th1)/dz;N2src=`975-925 hPa: dtheta/dz = ${((th2-th1)/dz*1000).toFixed(2)} K/km`}}
  const N2floor=GRAV/TK*PAR.dthdzStd;const N2used=Math.max(N2??0,N2floor);
  // sigma_theta from 15-min directions within +-60 min
  const dirs=wx.m15.filter(o=>Math.abs(o.t-t)<=60*6e4).map(o=>o.wd);
  let sth=dirs.length>=3?PH.circStd(dirs):null,sthSrc=dirs.length>=3?`${dirs.length} x 15-min directions (+-1 h)`:'';
  if(sth===null){const hh=wx.hours.filter(o=>Math.abs(o.t-t)<=36e5).map(o=>o.wind_direction_10m);sth=PH.circStd(hh);sthSrc='hourly directions (t-1 h, t, t+1 h)'}
  return{t,iso:w.iso,src:w.src,U,dir,gust:w.wind_gusts_10m,TK,T2:w.temperature_2m,RH:w.relative_humidity_2m??null,T80:w.temperature_80m,Tsoil0:w.soil_temperature_0cm,Tsoil07:w.soil_temperature_0_to_7cm,P:Pp,n,low,mid,high,SW,
    blhNwp:w.boundary_layer_height??w.blh_era5??null,elev:sp.elevation,az:sp.azimuth,elevMean,nightT,isDay,ceiling,tenths,tur,srdt,dTsign,dTsrc,
    Rn:sc.Rn,H:sc.H,ustar:sc.ustar,thstar:sc.thstar,L:sc.L,branch:sc.branch,rho:sc.rho,h,wstar,golder:PH.golderClass(sc.L,PAR.z0),
    N2:N2used,N2raw:N2,N2src,sth,sthSrc,albedo:albedo(elevMean)};
}
/* ---------------- slope flow (Prandtl column per slope bin) ---------------- */
function interpMet(hrs,t){let i=0;while(i<hrs.length-2&&hrs[i+1].t<=t)i++;const a=hrs[i],b=hrs[i+1]||a,f=b.t>a.t?Math.min(1,Math.max(0,(t-a.t)/(b.t-a.t))):0,L=(p,q)=>p+(q-p)*f;
  return{U:L(a.U,b.U),TK:L(a.TK,b.TK),P:L(a.P,b.P),n:L(a.n,b.n),SW:L(a.SW,b.SW),N2:L(a.N2,b.N2),elevMean:L(a.elevMean,b.elevMean),blh:a.branch==='convective'?a.blhNwp:null}}
async function runSlope(met,tA,tB,progress){
  // One 1-D Prandtl column per slope bin. Each column is RESTARTED FROM REST whenever the sign of the
  // surface buoyancy flux changes (regime onset), so that the column state at age a is the state of a
  // Lagrangian column that left the drainage divide (katabatic) or the valley floor (anabatic) at onset.
  const grid=PH.makeSlopeGrid(55,2,1.08),dt=PAR.dtSlope,z0=PAR.z0;
  const bins=PAR.slopeDeg.map(deg=>({deg,m:PH.slopeModel(Math.sin(deg*D2R),grid,{kMode:'closure'}),prof:[],jet:[],bbar:[],depth:[]}));
  const times=[],regime=[],onsets=[];const nSteps=Math.ceil((tB-tA)/(dt*1000));let sgn=0;
  for(let step=0;step<=nSteps;step++){const t=tA+step*dt*1000,e=interpMet(met,t);
    const base=PH.surfaceScheme({U10:e.U,TK:e.TK,P_hPa:e.P,n:e.n,Kdown:e.SW,z0,albedo:albedo(e.elevMean),blh:null});
    const s=base.H>=0?1:-1;if(s!==sgn){sgn=s;onsets.push(t);for(const b of bins)b.m.reset()}
    const Us1=PH.windAtHeight(e.U,grid.zc[0],z0,base.L);
    const fluxFn=us10=>{const sc=PH.surfaceScheme({U10:Math.hypot(e.U,us10),TK:e.TK,P_hPa:e.P,n:e.n,Kdown:e.SW,z0,albedo:albedo(e.elevMean),blh:null});
      const h=sc.branch==='convective'?(e.blh||1000):2400*Math.pow(sc.ustar,1.5);return{Bs:GRAV/e.TK*sc.H/(sc.rho*CP),ustar:sc.ustar,L:sc.L,h,H:sc.H}};
    if(step%PAR.storeEvery===0){times.push(t);regime.push({sgn,onset:onsets[onsets.length-1]});
      for(const b of bins){b.prof.push(Float32Array.from(PAR.zs,z=>b.m.at(z)));b.jet.push(b.m.jet().umax);b.bbar.push(b.m.bMean());b.depth.push(b.m.depth())}}
    if(step<nSteps)for(const b of bins)b.m.step(dt,{N2:e.N2,z0,Usyn1:Us1,fluxFn});
    if(progress&&step%240===0){await progress(step/nSteps)}}
  return{t0:tA,dtS:dt*PAR.storeEvery,times,regime,onsets,bins,grid};
}
/* per-hour slope state: profile per bin, fetch factor per cell */
function slopeHour(SL,t){
  const idx=Math.max(0,Math.min(SL.times.length-1,Math.round((t-SL.t0)/(SL.dtS*1000))));
  const reg=SL.regime[idx],sc=Math.max(0,SL.times.findIndex(x=>x>=reg.onset)),ageNow=idx-sc;
  const nb=SL.bins.length,N=G.n*G.n;
  const B=SL.bins.map(b=>({series:b.jet.slice(sc,idx+1)}));
  // per cell: age index reached at the cell's fetch, then the energy bound
  const cellBin=new Int16Array(N).fill(-1),cellAge=new Int16Array(N*2),cellScale=new Float32Array(N*2),fac=new Float32Array(N);
  const profC={}; // cache cumulative integrals per (bin, age)
  const getP=(bb,a)=>{const key=bb*10000+a;if(!profC[key]){const prof=SL.bins[bb].prof[sc+a];profC[key]={prof,cum:cumul(prof)}}return profC[key]};
  for(let k=0;k<N;k++){const i=G.bi[k];if(i<0)continue;cellBin[k]=i;const w=G.bw[k];let fsum=0;
    [[i,0],[i+1,1]].forEach(([bb,slot])=>{const X=reg.sgn<0?G.Lup[k]:G.Ldown[k],dZ=reg.sgn<0?G.dZup[k]:G.dZdown[k],ser=B[bb].series;
      let dist=0,a=0;for(;a<ageNow;a++){const d=Math.abs(ser[a])*SL.dtS;if(dist+d>=X)break;dist+=d}
      const jet=Math.abs(SL.bins[bb].jet[sc+a]),bb2=Math.abs(SL.bins[bb].bbar[sc+a]),bound=Math.sqrt(2*bb2*Math.max(dZ,0));
      const s=jet>1e-6?Math.min(1,bound/jet):0;cellAge[2*k+slot]=a;cellScale[2*k+slot]=s;
      const jn=Math.abs(SL.bins[bb].jet[idx]);fsum+=(slot?w:1-w)*(jn>1e-6?Math.min(1,jet*s/jn):0)});
    fac[k]=fsum}
  return{idx,sc,ageNow,reg,cellAge,cellScale,getP,fac,t,jets:SL.bins.map(b=>b.jet[idx]),depths:SL.bins.map(b=>b.depth[idx])};
}
function cumul(prof){const z=PAR.zs,c=new Float64Array(z.length);for(let i=1;i<z.length;i++)c[i]=c[i-1]+0.5*(prof[i]+prof[i-1])*(z[i]-z[i-1]);return c}
function profAt(prof,z){const zs=PAR.zs;if(z<=zs[0])return prof[0];for(let i=1;i<zs.length;i++)if(zs[i]>=z){const f=(z-zs[i-1])/(zs[i]-zs[i-1]);return prof[i-1]+f*(prof[i]-prof[i-1])}return prof[zs.length-1]}
function cumAt(c,prof,z){const zs=PAR.zs;if(z<=zs[0])return 0;for(let i=1;i<zs.length;i++)if(zs[i]>=z){const f=(z-zs[i-1]),pz=profAt(prof,z);return c[i-1]+0.5*(prof[i-1]+pz)*f}return c[zs.length-1]+prof[zs.length-1]*(z-zs[zs.length-1])}
function layerAvg(prof,c,a,b){if(b-a<0.05)return profAt(prof,(a+b)/2);return(cumAt(c,prof,b)-cumAt(c,prof,a))/(b-a)}
/* ---------------- hourly context: synoptic profile + slope state ---------------- */
function hourCtx(rec,SL){
  const syn=Float32Array.from(PAR.zs,z=>PH.windAtHeight(rec.U,z,PAR.z0,rec.L));
  return{rec,syn,synC:cumul(syn),sl:SL?slopeHour(SL,rec.t):null};
}
/* ---------------- 3DEP lidar drainage field (5 m, gravity current) ---------------- */
let LIDAR=null;
// f: lidar/drain.json {step,nx,ny,u_weak,u_typical,u_strong,ex,ey,pool} in the app frame (x east, y south from the overlay NW corner)
function setLidarDrain(f){if(!f){LIDAR=null;return}const F=a=>Float32Array.from(a);
  LIDAR={step:f.step,nx:f.nx,ny:f.ny,u:{weak:F(f.u_weak),typical:F(f.u_typical),strong:F(f.u_strong)},ex:F(f.ex),ey:F(f.ey),pool:Uint8Array.from(f.pool),cases:f.cases,realistic:f.realistic}}
// does this hour qualify for a radiative drainage flow? clear (<= 3/8 cloud), light wind, sun below the horizon
function lidarQualifies(rec){return !!LIDAR&&rec.elev<0&&rec.U<=PAR.lidarUmax&&rec.n<=PAR.lidarCloudMax}
function lidarWhy(rec){return{sunBelow:rec.elev<0,lightWind:rec.U<=PAR.lidarUmax,clear:rec.n<=PAR.lidarCloudMax,loaded:!!LIDAR}}
// downslope drainage vector (m/s, x east, y south) at a point: nearest 5 m cell (no smoothing across ridges); 0 in pools / outside
function lidarVec(x,y,cs){if(!LIDAR)return[0,0];const i=Math.floor(y/LIDAR.step),j=Math.floor(x/LIDAR.step);
  if(i<0||j<0||i>=LIDAR.ny||j>=LIDAR.nx)return[0,0];const k=i*LIDAR.nx+j;if(LIDAR.pool[k])return[0,0];const u=LIDAR.u[cs||PAR.lidarCase][k];return[u*LIDAR.ex[k],u*LIDAR.ey[k]]}
// velocity (x east, y south) at a point for transport of a plume of vertical spread sz released at H
// ctx.lidar (set by walkExposure in qualifying hours): the fraction of the plume layer [a,b] below the drainage depth moves with the
// lidar gravity current instead of the 16 m NED slope column; the rest keeps the NED slope column
function velocity(ctx,x,y,H,sz,dirOff,slopeOn){
  const a=Math.max(PAR.zs[0],H-PAR.layerK*sz),b=Math.min(100,Math.max(a+0.05,H+PAR.layerK*sz));
  const Us=layerAvg(ctx.syn,ctx.synC,a,b),th=(ctx.rec.dir+dirOff)*D2R;
  let vx=-Math.sin(th)*Us,vy=Math.cos(th)*Us,fl=0;
  if(slopeOn&&ctx.lidar&&LIDAR){fl=Math.max(0,Math.min(1,(PAR.lidarDepth-a)/(b-a)));if(fl>0){const v=lidarVec(x,y);vx+=fl*v[0];vy+=fl*v[1]}}
  if(slopeOn&&ctx.sl&&fl<1){const k=cellOf(x,y);if(k>=0&&G.bi[k]>=0){const us=(1-fl)*(huntActive(ctx)?anabaticU(ctx,k,a,b):cellSlopeU(ctx.sl,k,z=>null,a,b)); // + = upslope
    vx-=us*G.D.sx[k];vy-=us*G.D.sy[k]}}
  return[vx,vy];
}
// slope-flow speed in a cell (+ = upslope): layer average over [a,b], or the point value at a when b is undefined
/* Daytime upslope (anabatic) flow in convective hours: Hunt, Fernando & Princevac (2003, J. Atmos. Sci. 60:2169-2182)
   mean upslope velocity on a gentle heated slope U_M = C alpha^(1/3) w*, w* = (F_bs h)^(1/3); C = 3-5 from VTMX data and laboratory
   runs (Fernando et al., OSTI 835530). Their theory needs a slope much longer than the CBL depth h; on shorter slopes the convective
   plume engulfs the slope (Hocut et al. 2015, J. Fluid Mech., regime beta <= 10 deg), so U_M is scaled by min(1, X/h) (ASSUMPTION:
   linear ramp). alpha = mean slope over the downslope fetch X to the pool/outlet (G.Ldown, G.dZdown). Vertical profile: log law from
   z0 to the surface-layer top 0.1 h, uniform above (CBL mixed layer). Replaces the 1-D Prandtl column in convective anabatic hours:
   that column (K closure) does not reproduce the alpha^(1/3) w* scaling (tests section 18). PAR.anabatic = 'prandtl' restores it. */
Object.assign(PAR,{anabatic:'hunt2003',huntC:4});
function huntActive(ctx){return PAR.anabatic==='hunt2003'&&ctx.rec&&ctx.rec.branch==='convective'&&ctx.rec.wstar>0&&ctx.rec.h>0&&(!ctx.sl||ctx.sl.reg.sgn>0)}
function huntProfile(z,h){const z0=PAR.z0,zs=Math.max(0.1*h,z0*2+1);if(z<=z0)return 0;return z>=zs?1:Math.log(z/z0)/Math.log(zs/z0)}
function huntUM(X,dZ,wstar,h){if(!(X>0)||!(dZ>0)||!(wstar>0)||!(h>0))return 0;return PAR.huntC*Math.cbrt(Math.atan(dZ/X))*wstar*Math.min(1,X/h)}
function anabaticU(ctx,k,a,b){const h=ctx.rec.h,UM=huntUM(G.Ldown[k],G.dZdown[k],ctx.rec.wstar,h);if(!UM)return 0;
  if(b===undefined||b-a<0.05)return UM*huntProfile(b===undefined?a:(a+b)/2,h);let s=0;for(let i=0;i<8;i++)s+=huntProfile(a+(b-a)*(i+0.5)/8,h);return UM*s/8}
function cellSlopeU(sl,k,_,a,b){const i=G.bi[k],w=G.bw[k];let u=0;
  for(const[bb,slot,ww]of[[i,0,1-w],[i+1,1,w]]){if(ww<=0)continue;const P=sl.getP(bb,sl.cellAge[2*k+slot]),v=b===undefined?profAt(P.prof,a):layerAvg(P.prof,P.cum,a,b);u+=ww*sl.cellScale[2*k+slot]*v}
  return u}
function slopeWindAt(ctx,x,y,z){const k=cellOf(x,y);if(k<0||!ctx.sl)return{us:0,vx:0,vy:0,fac:0,k};if(G.bi[k]<0)return{us:0,vx:0,vy:0,fac:0,k,pool:!!G.pool[k]};
  const us=huntActive(ctx)?anabaticU(ctx,k,Math.max(PAR.zs[0],z)):cellSlopeU(ctx.sl,k,null,Math.max(PAR.zs[0],z));return{us,hunt:huntActive(ctx),vx:-us*G.D.sx[k],vy:-us*G.D.sy[k],fac:ctx.sl.fac[k],k,age:ctx.sl.cellAge[2*k]*ctx.sl.idx}}
/* ---------------- ensembles ---------------- */
function dirOffsets(sth){const out=[];for(let i=0;i<PAR.nDir;i++)out.push(PH.PhiInv((i+0.5)/PAR.nDir)*sth);return out}
function classSet(rec){const s=[rec.tur.cls];if(rec.srdt&&rec.srdt!==rec.tur.cls)s.push(rec.srdt);return s}
function members(rec,kind){ // kind: 'full' (dir x class x scheme), 'field' (dir x class, Briggs), 'lite' (dir, Turner, Briggs)
  const offs=dirOffsets(rec.sth),cls=kind==='lite'?[rec.tur.cls]:classSet(rec),sch=kind==='full'?['briggs','pg']:['briggs'],out=[];
  for(const d of offs)for(const c of cls)for(const s of sch)out.push({d,cls:c,scheme:s});return out}
function pathFor(ctx,src,H,m,slopeOn,inside){
  const rec=ctx.rec,v0=velocity(ctx,src.x,src.y,H,0.1,m.d,slopeOn),sp=Math.hypot(v0[0],v0[1]),mode=sp>=PAR.calmU?'plume':'calm';
  const ts=PH.turbScales(rec.ustar,rec.wstar,rec.h,H);
  const szOf=(s,tau)=>mode==='calm'?Math.max(0.05,ts.sw*tau):PH.sigmas(m.scheme,m.cls,Math.max(s,0.5)).sz;
  const pts=PH.buildPath(src,(x,y,s,tau)=>velocity(ctx,x,y,H,szOf(s,tau),m.d,slopeOn),{mode,cls:m.cls,scheme:m.scheme,sv:ts.sv,sw:ts.sw,Tmax:PAR.Tmax,sMax:PAR.sMax,dsMax:8,inside});
  return{pts,mode,sp0:sp,v0,ts};
}
function lid(rec){return rec.branch==='convective'?rec.h:null} // reflection at the mixing lid only for convective hours
function quant(arr,p){const a=[...arr].sort((x,y)=>x-y);if(!a.length)return NaN;const r=p*(a.length-1),i=Math.floor(r),f=r-i;return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*f}
function stats(vals,X){return{med:quant(vals,0.5),p10:quant(vals,0.1),p90:quant(vals,0.9),pX:vals.filter(v=>v>X).length/vals.length,n:vals.length}}
/* receptor exposure for one stand at one hour.
   groups: [{id,label,pts:[{x,y}]}] -> per group per member: max chi/Q over the group's points */
function standExposure(ctx,stand,groups,kind,inside,X,slopeOn=true){
  const ms=members(ctx.rec,kind),per=groups.map(()=>[]),modes={};let sp0=0,v0=[0,0];
  for(const m of ms){const P=pathFor(ctx,stand,stand.H,m,slopeOn,inside);modes[P.mode]=(modes[P.mode]||0)+1;if(m.d===0||ms.length===1||Math.abs(m.d)<1e-9){sp0=P.sp0;v0=P.v0}
    groups.forEach((g,gi)=>{let mx=0;for(const p of g.pts){const c=PH.pathChiQ(P.pts,p.x,p.y,PAR.receptorZ,stand.H,lid(ctx.rec));if(c>mx)mx=c}per[gi].push(mx)})}
  const c0=pathFor(ctx,stand,stand.H,{d:0,cls:ctx.rec.tur.cls,scheme:'briggs'},slopeOn,inside);
  return{groups:groups.map((g,gi)=>({id:g.id,...stats(per[gi],X),vals:per[gi]})),modes,nMembers:ms.length,sp0:c0.sp0,v0:c0.v0,mode:c0.mode,central:c0.pts};
}
/* ground-level chi/Q field (cell means) for one stand: ensemble mean and per-member exceedance */
function standField(ctx,stand,inside,X){
  const ms=members(ctx.rec,'field'),N=G.n*G.n,mean=new Float32Array(N),exc=new Float32Array(N),tmp=new Float64Array(N),grid={nx:G.n,ny:G.n,dx:G.dx,dy:G.dy},paths=[];
  for(const m of ms){tmp.fill(0);const P=pathFor(ctx,stand,stand.H,m,true,inside);paths.push(P);PH.pathSplat(P.pts,grid,PAR.receptorZ,stand.H,lid(ctx.rec),tmp,1);
    for(let k=0;k<N;k++){mean[k]+=tmp[k]/ms.length;if(tmp[k]>X)exc[k]+=1/ms.length}}
  // per-facet share of ground-level dose (mean field, inside the boundary)
  const fac=new Float64Array(6);let tot=0;for(let k=0;k<N;k++)if(G.mask[k]){fac[G.facet[k]]+=mean[k];tot+=mean[k]}
  return{mean,exc,paths,facetShare:Array.from(fac,v=>tot?v/tot:0),nMembers:ms.length};
}
/* adjoint map: for a source at height H in each coarse cell, ensemble-mean of max chi/Q over the receptor points */
function adjointMap(ctx,H,pts,inside,step=2){
  const n=G.n,out=new Float32Array(n*n).fill(-1),ms=members(ctx.rec,'lite');
  for(let i=Math.floor(step/2);i<n;i+=step)for(let j=Math.floor(step/2);j<n;j+=step){const k=i*n+j;if(!G.mask[k])continue;const src={x:(j+.5)*G.dx,y:(i+.5)*G.dy};let acc=0;
    for(const m of ms){const P=pathFor(ctx,src,H,m,true,inside);let mx=0;for(const p of pts){const c=PH.pathChiQ(P.pts,p.x,p.y,PAR.receptorZ,H,lid(ctx.rec));if(c>mx)mx=c}acc+=mx/ms.length}
    for(let a=0;a<step;a++)for(let b=0;b<step;b++){const ii=i-Math.floor(step/2)+a,jj=j-Math.floor(step/2)+b;if(ii<n&&jj<n&&ii>=0&&jj>=0&&G.mask[ii*n+jj])out[ii*n+jj]=acc}}
  return out;
}

/* =====================================================================
   WALK-IN AS A MOVING SOURCE (routes, parking and bedding areas from Slade's markup)
   Puffs of mass Q*dt_r are released every ds metres along the walk, starting at the parking spot,
   at walking speed v. Each puff follows the same hour-mean 3-D wind as the stand plumes (synoptic MO
   profile + Prandtl slope flow) with P-G/Briggs sigmas from its own travel distance. The ground-level
   concentration at time t is the sum over released puffs:
     chi(r,t)/Q = sum_i dt_r * exp(-|r - p_i(t-t_i)|^2 / 2 sy^2) / (2 pi sy^2) * V(z; H, sz)
   sy^2 = sy(s)^2 + sy0^2, sz^2 = sz(s)^2 + sz0^2. The receptor value is the peak over time and over the
   bed-polygon points. Units s/m^3, same as the stand chi/Q.
   ===================================================================== */
Object.assign(PAR,{
  walkSpeed:1.4,   // m/s. Comfortable gait speed of adults 20-59 y, 1.27-1.46 m/s (Bohannon 1997, Age Ageing 26:15-19). A night walk-in is likely slower: see the sensitivity run.
  walkH:1.0,       // m, walker / ground-setup source height (Slade, 2026-09-30: ground ~1 m)
  treeH:6.0,       // m, tree/saddle setup height (Slade, 2026-09-30)
  stepH:0.05,      // m, footstep sound source height (foot-ground contact); scent of the walker uses walkH
  earH:0.7,        // m, deer ear height for sound receivers (ASSUMPTION: bedded/standing deer 0.5-1.1 m)
  walkDs:5,        // m, release spacing (numerical; puffs smoothed by the segment variance ds^2/12)
  bodyW:0.5,bodyH:1.8, // m. Initial puff size from the ISC3 volume-source rule sy0 = W/4.3, sz0 = Hb/2.15 (EPA-454/B-95-003b sec. 1.2.2); W, Hb = a standing adult
  walkHorizon:900, // s simulated after the walker reaches the stand
  walkSMax:800,    // m puff travel limit (beds are within ~400 m of every route)
  bedStep:12,      // m receptor spacing inside/along a bedding polygon
  bedZ:0           // m receptor height (ground level; same convention as the stand receptors)
});
function toXY(GEO,ll){return ll.map(q=>GEO.xy(q[0],q[1]))}
function pip(poly,x,y){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)c=!c}return c}
function bedReceptors(poly,step){const pts=[];
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],L=Math.hypot(b.x-a.x,b.y-a.y),n=Math.max(1,Math.ceil(L/step));for(let k=0;k<n;k++)pts.push({x:a.x+(b.x-a.x)*k/n,y:a.y+(b.y-a.y)*k/n,edge:true})}
  const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y);
  for(let x=Math.min(...xs)+step/2;x<Math.max(...xs);x+=step)for(let y=Math.min(...ys)+step/2;y<Math.max(...ys);y+=step)if(pip(poly,x,y))pts.push({x,y,edge:false});
  const bb=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  let cx=0,cy=0,A=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],c=a.x*b.y-b.x*a.y;A+=c;cx+=(a.x+b.x)*c;cy+=(a.y+b.y)*c}A/=2;
  return{pts,bb,poly,area:Math.abs(A),centroid:{x:cx/(6*A),y:cy/(6*A)}}}
function resample(path,ds){const out=[{x:path[0].x,y:path[0].y,s:0}];let s=0,carry=0;
  for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],L=Math.hypot(b.x-a.x,b.y-a.y);let d=ds-carry;
    while(d<=L){out.push({x:a.x+(b.x-a.x)*d/L,y:a.y+(b.y-a.y)*d/L,s:s+d});d+=ds}carry=L-(d-ds);s+=L}
  return{pts:out,length:s}}
function prepWalk(GEO,w,beds){const path=toXY(GEO,w.path),r=resample(path,PAR.walkDs);
  // minimum distance from the walk to each bed (0 if the route touches or crosses it)
  const dmin=beds.map(B=>{let m=Infinity;for(const p of r.pts){if(pip(B.poly,p.x,p.y)){m=0;break}for(let i=0;i<B.poly.length;i++){const a=B.poly[i],b=B.poly[(i+1)%B.poly.length],vx=b.x-a.x,vy=b.y-a.y,t=Math.min(1,Math.max(0,((p.x-a.x)*vx+(p.y-a.y)*vy)/(vx*vx+vy*vy)));m=Math.min(m,Math.hypot(p.x-a.x-t*vx,p.y-a.y-t*vy))}}return m});
  return{...w,xy:path,rel:r.pts,length:r.length,dmin}}
function walkExposure(ctx0,walk,beds,kind,inside,X,o={}){
  const useL=o.lidar!==false&&o.slopeOn!==false&&lidarQualifies(ctx0.rec),ctx=useL?Object.assign({},ctx0,{lidar:true}):ctx0;
  const v=o.speed||PAR.walkSpeed,ds=PAR.walkDs,dtr=ds/v,H=o.H||PAR.walkH;
  // o.eta (optional, per node): slowness factor (1 = open walking). Node i is reached at t_i = sum_j<i eta_j*ds/v and releases eta_i*ds/v of scent
  // (dwell time). Used for dense cane (terrain factor, Soule & Goldman 1972). Without o.eta every node has eta = 1 (previous behaviour).
  const eta=o.eta&&o.eta.length===walk.rel.length?o.eta:null,tN=new Float64Array(walk.rel.length);for(let i=1;i<tN.length;i++)tN[i]=tN[i-1]+(eta?eta[i-1]:1)*dtr;
  const Tw=eta?tN[tN.length-1]+eta[eta.length-1]*dtr:walk.length/v,nT=Math.ceil((Tw+PAR.walkHorizon)/dtr)+2;
  const sy0=Math.hypot(PAR.bodyW/4.3,ds/Math.sqrt(12)),sz0=PAR.bodyH/2.15,hl=lid(ctx.rec),ms=members(ctx.rec,kind);
  const res=beds.map(()=>({vals:[],tPeak:[],frac:[]}));
  for(const m of ms){
    const conc=beds.map(B=>new Float64Array(nT*B.pts.length));
    walk.rel.forEach((r,i)=>{const ti=eta?tN[i]:i*dtr,i0=eta?Math.round(ti/dtr):i,wt=eta?eta[i]:1,Tmax=Tw+PAR.walkHorizon-ti;if(Tmax<=0)return;
      const v0=velocity(ctx,r.x,r.y,H,0.1,m.d,o.slopeOn!==false),sp=Math.hypot(v0[0],v0[1]),mode=sp>=PAR.calmU?'plume':'calm',ts=PH.turbScales(ctx.rec.ustar,ctx.rec.wstar,ctx.rec.h,H);
      const szOf=(s,tau)=>mode==='calm'?Math.max(0.05,ts.sw*tau):PH.sigmas(m.scheme,m.cls,Math.max(s,0.5)).sz;
      const pts=PH.buildPath(r,(x,y,s,tau)=>velocity(ctx,x,y,H,Math.hypot(szOf(s,tau),sz0),m.d,o.slopeOn!==false),{mode,cls:m.cls,scheme:m.scheme,sv:ts.sv,sw:ts.sw,Tmax,sMax:PAR.walkSMax,dsMax:8,inside});
      // sample the puff at tau_n = n*dtr (piecewise-linear in tau between path points; the release point at tau=0)
      let k=0;for(let n=0;i0+n<nT;n++){const tau=n*dtr;while(k<pts.length-1&&pts[k+1].tau<tau)k++;
        let px,py,sy,sz;
        if(!pts.length||tau<=pts[0].tau){const f=pts.length?tau/pts[0].tau:0;px=r.x+(pts.length?(pts[0].x-r.x)*f:0);py=r.y+(pts.length?(pts[0].y-r.y)*f:0);sy=pts.length?pts[0].sy*f:0;sz=pts.length?pts[0].sz*f:0}
        else if(k>=pts.length-1){if(tau>pts[pts.length-1].tau+pts[pts.length-1].dt)break;const p=pts[pts.length-1];px=p.x;py=p.y;sy=p.sy;sz=p.sz}
        else{const a=pts[k],b=pts[k+1],f=(tau-a.tau)/(b.tau-a.tau);px=a.x+(b.x-a.x)*f;py=a.y+(b.y-a.y)*f;sy=a.sy+(b.sy-a.sy)*f;sz=a.sz+(b.sz-a.sz)*f}
        sy=Math.hypot(sy,sy0);sz=Math.hypot(sz,sz0);const R=4*sy,vf=wt*PH.verticalFactor(PAR.bedZ,H,sz,hl)*dtr/(2*Math.PI*sy*sy);if(vf<1e-14)continue;
        beds.forEach((B,bi)=>{if(px<B.bb[0]-R||px>B.bb[2]+R||py<B.bb[1]-R||py>B.bb[3]+R)return;const C=conc[bi],base=(i0+n)*B.pts.length;
          for(let q=0;q<B.pts.length;q++){const dx=B.pts[q].x-px,dy=B.pts[q].y-py,r2=dx*dx+dy*dy;if(r2<R*R)C[base+q]+=vf*Math.exp(-r2/(2*sy*sy))}})}});
    beds.forEach((B,bi)=>{let mx=0,tm=0;const C=conc[bi],np=B.pts.length,rp=new Float64Array(np);
      for(let j=0;j<C.length;j++){const q=j%np;if(C[j]>rp[q])rp[q]=C[j];if(C[j]>mx){mx=C[j];tm=Math.floor(j/np)*dtr}}
      const inner=B.pts.map((p,q)=>q).filter(q=>!B.pts[q].edge),use=inner.length?inner:B.pts.map((p,q)=>q);
      res[bi].vals.push(mx);res[bi].tPeak.push(tm);res[bi].frac.push(use.filter(q=>rp[q]>X).length/use.length)})}
  return{beds:res.map((r,bi)=>({id:beds[bi].id,...stats(r.vals,X),vals:r.vals,tPeak:quant(r.tPeak,0.5),fracMed:quant(r.frac,0.5),fracP90:quant(r.frac,0.9),frac:r.frac})),nMembers:ms.length,Tw,speed:v,lidar:useL}}
/* Footstep sound at the bed: ISO 9613-2 octave-band attenuation from the closest walk point.
   The footstep source level is NOT established in the literature (see Methods); the received level is
   returned per dB of source level: L_rec = L_1m - A. */
function walkSound(rec,walk,beds,o={}){const TC=rec.T2,RH=rec.RH??70,pkPa=(rec.P??1013)/10,hs=o.hs??PAR.stepH,hr=o.hr??PAR.earH;
  return beds.map((B,bi)=>{const d=Math.max(1,walk.dmin[bi]);
    // centroid: foliage path = length of the straight line inside the polygon (ISO 9613-2 Annex A, dense cover)
    let best=null;for(const p of walk.rel){const dx=B.centroid.x-p.x,dy=B.centroid.y-p.y,L=Math.hypot(dx,dy);if(!best||L<best.L)best={L,p}}
    let df=0;const n=Math.ceil(best.L);for(let k=0;k<n;k++){const x=best.p.x+(B.centroid.x-best.p.x)*(k+0.5)/n,y=best.p.y+(B.centroid.y-best.p.y)*(k+0.5)/n;if(pip(B.poly,x,y))df+=best.L/n}
    const bands=PH.OCT.map(f=>{const e=PH.soundAtten(f,d,{TC,RH,pkPa,hs,hr,G:1}),c=PH.soundAtten(f,best.L,{TC,RH,pkPa,hs,hr,G:1,df});return{f,edge:e.A,centroid:c.A,centroidNoFol:c.A-c.Afol}});
    return{id:B.id,dEdge:d,dCentroid:best.L,dfCentroid:df,bands,TC,RH}})}
/* Sound from a stationary setup (hunter at height hs: 1 m ground, 6 m tree/saddle) to the nearest edge of each bed
   and to the bed centroid (foliage path = straight-line length inside the polygon). Returns A per octave band (dB re 1 m). */
function setupSound(rec,src,hs,beds){const TC=rec.T2,RH=rec.RH??70,pkPa=(rec.P??1013)/10,hr=PAR.earH;
  return beds.map(B=>{let dE=Infinity;const n=B.poly.length;for(let i=0;i<n;i++){const a=B.poly[i],b=B.poly[(i+1)%n],vx=b.x-a.x,vy=b.y-a.y,t=Math.max(0,Math.min(1,((src.x-a.x)*vx+(src.y-a.y)*vy)/(vx*vx+vy*vy))),d=Math.hypot(src.x-a.x-t*vx,src.y-a.y-t*vy);if(d<dE)dE=d}
    const inside=pip(B.poly,src.x,src.y);if(inside)dE=0;const L=Math.hypot(B.centroid.x-src.x,B.centroid.y-src.y);let df=0;const m=Math.max(1,Math.ceil(L/2));
    for(let k=0;k<m;k++){const x=src.x+(B.centroid.x-src.x)*(k+0.5)/m,y=src.y+(B.centroid.y-src.y)*(k+0.5)/m;if(pip(B.poly,x,y))df+=L/m}
    return{id:B.id,inside,dEdge:dE,dCentroid:L,dfCentroid:df,bands:PH.OCT.map(f=>({f,edge:PH.soundAtten(f,Math.max(1,dE),{TC,RH,pkPa,hs,hr,G:1}).A,centroid:PH.soundAtten(f,L,{TC,RH,pkPa,hs,hr,G:1,df}).A}))}})}
return{anabaticU,huntActive,huntUM,huntProfile,setLidarDrain,lidarQualifies,lidarWhy,lidarVec,get LIDAR(){return LIDAR},setupSound,resample,prepWalk,bedReceptors,walkExposure,walkSound,toXY,pip,PAR,SRC_NAME,prepStatic,fetchWx,metRecord,runSlope,slopeHour,hourCtx,velocity,slopeWindAt,cellSlopeU,members,pathFor,standExposure,standField,adjointMap,stats,quant,dirOffsets,sunDay,cellOf,get G(){return G}};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ENG;
