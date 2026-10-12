/* =====================================================================
   PHYSICS MODULE (pure functions, no DOM). Shared by the app and the
   Node unit tests (hbk-build/tests/run_tests.js).
   Every constant below carries its source. See README "Methods".
   ===================================================================== */
const PHYS=(()=>{
'use strict';
const D2R=Math.PI/180,R2D=180/Math.PI;
const clamp=(x,a,b)=>x<a?a:x>b?b:x;
/* Physical constants */
const KARMAN=0.4;          // von Karman constant (AERMOD formulation, EPA-454/B-23-010, eq. 6)
const GRAV=9.81;           // m s-2
const SIGMA_SB=5.67e-8;    // Stefan-Boltzmann, W m-2 K-4
const CP=1004;             // J kg-1 K-1, dry air
const RD=287.05;           // J kg-1 K-1, dry air gas constant
const NU_AIR=1.5e-5;       // m2 s-1, kinematic viscosity of air at ~20 C (molecular floor for K)

/* ---------------------------------------------------------------
   1. NOAA solar position (NOAA GML Solar Calculator spreadsheet,
      after Meeus 1998, "Astronomical Algorithms"). ms = UTC epoch ms.
   --------------------------------------------------------------- */
function solarPosition(ms,lat,lng){
  const jd=ms/86400000+2440587.5, jc=(jd-2451545)/36525;
  const L0=((280.46646+jc*(36000.76983+jc*0.0003032))%360+360)%360;
  const M=357.52911+jc*(35999.05029-0.0001537*jc), Mr=M*D2R;
  const ecc=0.016708634-jc*(0.000042037+0.0000001267*jc);
  const C=Math.sin(Mr)*(1.914602-jc*(0.004817+0.000014*jc))+Math.sin(2*Mr)*(0.019993-0.000101*jc)+Math.sin(3*Mr)*0.000289;
  const trueLong=L0+C, omega=125.04-1934.136*jc;
  const appLong=trueLong-0.00569-0.00478*Math.sin(omega*D2R);
  const meanObl=23+(26+(21.448-jc*(46.815+jc*(0.00059-jc*0.001813)))/60)/60;
  const obl=meanObl+0.00256*Math.cos(omega*D2R);
  const decl=Math.asin(Math.sin(obl*D2R)*Math.sin(appLong*D2R));
  const y=Math.tan(obl*D2R/2)**2, L0r=L0*D2R;
  const eqTime=4*R2D*(y*Math.sin(2*L0r)-2*ecc*Math.sin(Mr)+4*ecc*y*Math.sin(Mr)*Math.cos(2*L0r)-0.5*y*y*Math.sin(4*L0r)-1.25*ecc*ecc*Math.sin(2*Mr));
  const minUTC=((ms/60000)%1440+1440)%1440;
  let tst=((minUTC+eqTime+4*lng)%1440+1440)%1440;
  let ha=tst/4<0?tst/4+180:tst/4-180;
  const latr=lat*D2R;
  const cosZ=clamp(Math.sin(latr)*Math.sin(decl)+Math.cos(latr)*Math.cos(decl)*Math.cos(ha*D2R),-1,1);
  const zen=Math.acos(cosZ)*R2D, e0=90-zen;
  let refr;const te=Math.tan(e0*D2R);
  if(e0>85)refr=0;else if(e0>5)refr=58.1/te-0.07/te**3+0.000086/te**5;
  else if(e0>-0.575)refr=1735+e0*(-518.2+e0*(103.4+e0*(-12.79+e0*0.711)));else refr=-20.772/te;
  refr/=3600;
  const zr=zen*D2R; let az;
  const den=Math.cos(latr)*Math.sin(zr);
  if(Math.abs(den)>1e-9){const a=Math.acos(clamp((Math.sin(latr)*Math.cos(zr)-Math.sin(decl))/den,-1,1))*R2D;az=ha>0?(a+180)%360:(540-a)%360}else az=lat>0?180:0;
  return{elevation:e0+refr,elevationGeom:e0,zenith:zen-refr,azimuth:az,declination:decl*R2D,eqTime,hourAngle:ha};
}
/* Sunrise/sunset: time when the geometric elevation crosses -0.833 deg (NOAA definition:
   refraction 0.5667 deg + solar semi-diameter). Found by bisection on solarPosition. */
function sunEvent(msLo,msHi,lat,lng,rising,alt=-0.833){
  const f=t=>solarPosition(t,lat,lng).elevationGeom-alt;
  let a=msLo,b=msHi,fa=f(a),fb=f(b);if(fa*fb>0)return null;
  for(let i=0;i<50;i++){const m=(a+b)/2,fm=f(m);if(fa*fm<=0){b=m;fb=fm}else{a=m;fa=fm}}
  return (a+b)/2;
}

/* ---------------------------------------------------------------
   2. Pasquill-Gifford stability class (1=A ... 6=F)
   2a. Turner (1964/1970) net-radiation-index method, as tabulated in
       EPA-454/R-99-005 (2000) Tables 6-4, 6-5, 6-6.
   --------------------------------------------------------------- */
const TURNER_TABLE=[ // rows: wind bins (knots 0-1,2-3,4-5,6,7,8-9,10,11,>=12); cols: NRI 4,3,2,1,0,-1,-2
 [1,1,2,3,4,6,7],[1,2,2,3,4,6,7],[1,2,3,4,4,5,6],[2,2,3,4,4,5,6],[2,2,3,4,4,4,5],[2,3,3,4,4,4,5],[3,3,4,4,4,4,5],[3,3,4,4,4,4,4],[3,4,4,4,4,4,4]];
function turnerWindRow(u_ms){const kt=Math.round(u_ms/0.514444);
  if(kt<=1)return 0;if(kt<=3)return 1;if(kt<=5)return 2;if(kt===6)return 3;if(kt===7)return 4;if(kt<=9)return 5;if(kt===10)return 6;if(kt===11)return 7;return 8}
function insolationClass(elevDeg){return elevDeg>60?4:elevDeg>35?3:elevDeg>15?2:1} // Table 6-5
/* cloudTenths: total cloud (0-10). ceiling: 'low' (<7000 ft), 'mid' (7000-16000 ft), 'high'/'none'.
   nightTurner: true from 1 h before sunset to 1 h after sunrise (Table 6-6 item 2). */
function netRadiationIndex(elevDeg,cloudTenths,ceiling,nightTurner){
  if(cloudTenths>=10&&ceiling==='low')return 0;                 // item 1
  if(nightTurner)return cloudTenths<=4?-2:-1;                     // item 2
  let ic=insolationClass(elevDeg);                                 // item 3
  if(cloudTenths<=5)return ic;
  let mod=ic;
  if(ceiling==='low')mod-=2;else if(ceiling==='mid')mod-=1;           // steps (1),(2)
  if(cloudTenths>=10&&ceiling!=='low')mod-=1;                     // step (3), cumulative with (2)
  return Math.max(1,mod);
}
function pgTurner(u10,elevDeg,cloudTenths,ceiling,nightTurner){
  const nri=netRadiationIndex(elevDeg,cloudTenths,ceiling,nightTurner);
  const col=[4,3,2,1,0,-1,-2].indexOf(nri);
  const cls=TURNER_TABLE[turnerWindRow(u10)][col];
  return{cls:Math.min(cls,6),nri,raw:cls}; // EPA combines G (7) with F (6)
}
/* 2b. Solar-radiation / delta-T (SRDT) method, EPA-454/R-99-005 Table 6-7 (after Bowen et al. 1983). */
function pgSRDT(u10,isDay,swWm2,dTdzSign){
  if(isDay){const row=u10<2?0:u10<3?1:u10<5?2:u10<6?3:4,col=swWm2>=925?0:swWm2>=675?1:swWm2>=175?2:3;
    return[[1,1,2,4],[1,2,3,4],[2,2,3,4],[3,3,4,4],[3,4,4,4]][row][col]}
  // night: vertical temperature gradient < 0 (lapse) or >= 0 (inversion)
  if(dTdzSign<0)return u10<2?5:4;
  return u10<2?6:u10<2.5?5:4;
}
/* 2c. Golder (1972) relation between P-G class, roughness and Obukhov length, using the fit
   1/L = a + b log10(z0) (Myrup & Ranzieri 1976; tabulated in Seinfeld & Pandis 2006, Ch. 18).
   Used ONLY as a cross-check display, never to drive the plume. */
const GOLDER=[[-0.096,0.029],[-0.037,0.029],[-0.002,0.018],[0,0],[0.004,-0.018],[0.035,-0.036]];
function golderClass(L,z0){const inv=1/L,lz=Math.log10(z0);let best=4,bd=1e9;
  GOLDER.forEach(([a,b],i)=>{const d=Math.abs(inv-(a+b*lz));if(d<bd){bd=d;best=i+1}});return best}
const CLS='ABCDEF';

/* ---------------------------------------------------------------
   3. Monin-Obukhov similarity
   --------------------------------------------------------------- */
// Unstable: Paulson (1970) (as used in AERMOD eq. 7). Stable: Beljaars & Holtslag (1991), which
// reduces to the Businger-Dyer -5 z/L for small z/L.
function psiM(zeta){
  if(zeta<0){const x=Math.pow(1-16*zeta,0.25);return 2*Math.log((1+x)/2)+Math.log((1+x*x)/2)-2*Math.atan(x)+Math.PI/2}
  const a=1,b=0.667,c=5,d=0.35;return-(a*zeta+b*(zeta-c/d)*Math.exp(-d*zeta)+b*c/d);
}
// Dimensionless temperature gradient: Dyer (1974) / Businger et al. (1971)
function phiH(zeta){return zeta<0?Math.pow(1-16*zeta,-0.5):1+5*zeta}
// Wind speed at height z from the 10 m wind (log-linear MO profile).
function windAtHeight(U10,z,z0,L,zref=10){
  const F=zz=>Math.log(zz/z0)-psiM(zz/L)+psiM(z0/L);
  const zz=Math.max(z,z0*1.5);return U10*Math.max(0,F(zz))/F(zref);
}

/* ---------------------------------------------------------------
   4. Surface energy balance -> H, u*, theta*, L, w*, mixing height
      Daytime: Holtslag & van Ulden (1983) net radiation (also AERMOD eq. 3) and
      their Priestley-Taylor sensible-heat formula. Night: van Ulden & Holtslag (1985)
      theta* = 0.09(1-0.5 n^2) and the AERMOD/Venkatram u* quadratic (AERMOD eqs. 14-16, 20-21).
   --------------------------------------------------------------- */
const HVU={c1:5.31e-13,c2:60,c3:0.12,alphaPT:1.0,betaPT:20,Gfrac:0.1};
function satVapSlopeOverGamma(TK,P_hPa){ // s/gamma for the Priestley-Taylor term
  const T=TK-273.15,es=6.112*Math.exp(17.67*T/(T+243.5));            // Bolton (1980), hPa
  const s=es*17.67*243.5/((T+243.5)**2);                              // hPa/K
  const gamma=CP*P_hPa/(0.622*2.501e6);                               // psychrometric constant, hPa/K
  return s/gamma;
}
function netRadiation(Kdown,TK,n,albedo){return((1-albedo)*Kdown+HVU.c1*TK**6-SIGMA_SB*TK**4+HVU.c2*n)/(1+HVU.c3)}
function surfaceScheme(o){
  // o: {U10, TK, P_hPa, n (0-1), Kdown (W/m2), z0, albedo, blh (m or null), zref}
  const zref=o.zref||10,U=Math.max(o.U10,0.01),T=o.TK,rho=o.P_hPa*100/(RD*T);
  const Rn=netRadiation(o.Kdown,T,o.n,o.albedo);
  let H=null,branch;
  if(Rn>0){const sg=satVapSlopeOverGamma(T,o.P_hPa),gs=1/sg;
    H=(((1-HVU.alphaPT)+gs)/(1+gs))*(Rn-HVU.Gfrac*Rn)-HVU.betaPT}
  let ustar,thstar,L,wstar=0,h;
  if(H!==null&&H>0){branch='convective';
    let Lc=-1e9;for(let i=0;i<60;i++){ustar=KARMAN*U/(Math.log(zref/o.z0)-psiM(zref/Lc)+psiM(o.z0/Lc));
      const Ln=-rho*CP*T*ustar**3/(KARMAN*GRAV*H);if(Math.abs(Ln-Lc)<0.01*Math.abs(Lc)){Lc=Ln;break}Lc=Ln}
    L=Lc;thstar=-H/(rho*CP*ustar);
    h=o.blh||null;if(h)wstar=Math.cbrt(GRAV*H*h/(rho*CP*T));
  }else{branch='stable';
    const CD=KARMAN/Math.log(zref/o.z0);let th=0.09*(1-0.5*o.n*o.n);
    const solve=thv=>{const u02=5*zref*GRAV*thv/T,ucr=Math.sqrt(4*u02/CD);
      if(U>=ucr)return{us:CD*U/2*(1+Math.sqrt(Math.max(0,1-4*u02/(CD*U*U)))),th:thv};
      const uscr=CD*ucr/2;return{us:uscr*U/ucr,th:thv*U/ucr}};
    let r=solve(th);
    for(let i=0;i<20&&r.us*r.th>0.05;i++){r=solve(0.05/r.us)} // Hanna (1986) limit, AERMOD eq. 21
    ustar=r.us;thstar=r.th;H=-rho*CP*ustar*thstar;L=T*ustar*ustar/(KARMAN*GRAV*Math.max(thstar,1e-6));
    h=o.blh||2400*Math.pow(ustar,1.5); // Venkatram (1980), AERMOD eq. 24
  }
  if(!h)h=null;
  return{Rn,H,ustar,thstar,L,wstar,h,rho,branch};
}

/* ---------------------------------------------------------------
   5. Dispersion coefficients (x in metres, return metres)
   5a. Briggs (1973) open-country formulas (Hanna, Briggs & Hosker 1982; Seinfeld & Pandis 2006).
   --------------------------------------------------------------- */
function briggsRural(cls,x){
  const r=Math.pow(1+0.0001*x,-0.5);
  switch(cls){
    case 1:return{sy:0.22*x*r,sz:0.20*x};
    case 2:return{sy:0.16*x*r,sz:0.12*x};
    case 3:return{sy:0.11*x*r,sz:0.08*x*Math.pow(1+0.0002*x,-0.5)};
    case 4:return{sy:0.08*x*r,sz:0.06*x*Math.pow(1+0.0015*x,-0.5)};
    case 5:return{sy:0.06*x*r,sz:0.03*x/(1+0.0003*x)};
    default:return{sy:0.04*x*r,sz:0.016*x/(1+0.0003*x)};
  }
}
/* 5b. Pasquill-Gifford curves (Turner 1970 Figs 3-2/3-3) in the analytic form used by EPA ISC3
   (EPA-454/B-95-003b, Vol. II, eqs. 1-32 to 1-34, Tables 1-1 and 1-2). x in km inside. */
const ISC_SY={1:[24.1670,2.5334],2:[18.3330,1.8096],3:[12.5000,1.0857],4:[8.3330,0.72382],5:[6.2500,0.54287],6:[4.1667,0.36191]};
const ISC_SZ={ // [xmax_km, a, b]
 1:[[0.10,122.800,0.94470],[0.15,158.080,1.05420],[0.20,170.220,1.09320],[0.25,179.520,1.12620],[0.30,217.410,1.26440],[0.40,258.890,1.40940],[0.50,346.750,1.72830],[3.11,453.850,2.11660],[1e9,null,null]],
 2:[[0.20,90.673,0.93198],[0.40,98.483,0.98332],[1e9,109.300,1.09710]],
 3:[[1e9,61.141,0.91465]],
 4:[[0.30,34.459,0.86974],[1.00,32.093,0.81066],[3.00,32.093,0.64403],[10.00,33.504,0.60486],[30.00,36.650,0.56589],[1e9,44.053,0.51179]],
 5:[[0.10,24.260,0.83660],[0.30,23.331,0.81956],[1.00,21.628,0.75660],[2.00,21.628,0.63077],[4.00,22.534,0.57154],[10.00,24.703,0.50527],[20.00,26.970,0.46713],[40.00,35.420,0.37615],[1e9,47.618,0.29592]],
 6:[[0.20,15.209,0.81558],[0.70,14.457,0.78407],[1.00,13.953,0.68465],[2.00,13.953,0.63227],[3.00,14.823,0.54503],[7.00,16.187,0.46490],[15.00,17.836,0.41507],[30.00,22.651,0.32681],[60.00,27.074,0.27436],[1e9,34.219,0.21716]]};
function pgISC(cls,x){
  const xk=Math.max(x,1e-3)/1000,[c,d]=ISC_SY[cls];
  const th=0.017453293*(c-d*Math.log(xk)),sy=465.11628*xk*Math.tan(th);
  let sz;for(const[xm,a,b]of ISC_SZ[cls]){if(xk<=xm){sz=a===null?5000:a*Math.pow(xk,b);break}}
  return{sy,sz:Math.min(sz,5000)};
}
function sigmas(scheme,cls,x){return scheme==='pg'?pgISC(cls,x):briggsRural(cls,x)}

/* ---------------------------------------------------------------
   6. Gaussian plume / puff kernels (per unit emission: chi/Q, s m-3)
   --------------------------------------------------------------- */
// Vertical factor with ground reflection (Turner 1970 eq. 3.1) and, if a mixing lid h is
// given, the image sum for reflection at h (Turner 1970 eq. 5.8; ISC3/AERMOD practice).
function verticalFactor(z,H,sz,h){
  const g=(d)=>Math.exp(-d*d/(2*sz*sz));
  let s=g(z-H)+g(z+H);
  if(h&&h>H&&sz>0.3*h){for(let k=1;k<=3;k++){s+=g(z-H-2*k*h)+g(z+H-2*k*h)+g(z-H+2*k*h)+g(z+H+2*k*h)}}
  return s/(Math.sqrt(2*Math.PI)*sz);
}
// Steady Gaussian plume, chi/Q at (x downwind, y crosswind, z) for a source at height H.
function plumeChiQ(x,y,z,H,u,sy,sz,h){
  if(x<=0)return 0;
  return Math.exp(-y*y/(2*sy*sy))/(Math.sqrt(2*Math.PI)*sy*u)*verticalFactor(z,H,sz,h);
}
// Ground-level centreline helper used by the textbook tests: Turner (1970) eq. 3.3
function plumeGroundCL(Q,u,sy,sz,H){return Q/(Math.PI*sy*sz*u)*Math.exp(-H*H/(2*sz*sz))}
// Standard normal CDF (Abramowitz & Stegun 26.2.17 via erf approximation 7.1.26)
function erf(x){const s=x<0?-1:1;x=Math.abs(x);const t=1/(1+0.3275911*x);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return s*y}
function Phi(x){return 0.5*(1+erf(x/Math.SQRT2))}
function PhiInv(p){ // Acklam's rational approximation (rel. error < 1.2e-9)
  const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00],
  b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01],
  c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00],
  d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
  const pl=0.02425;let q,r;
  if(p<pl){q=Math.sqrt(-2*Math.log(p));return(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)}
  if(p>1-pl){q=Math.sqrt(-2*Math.log(1-p));return-(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)}
  q=p-0.5;r=q*q;return(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
// Circular standard deviation in degrees (Mardia & Jupp 2000: sqrt(-2 ln R)).
function circStd(degs){let s=0,c=0;for(const d of degs){s+=Math.sin(d*D2R);c+=Math.cos(d*D2R)}
  const R=Math.hypot(s,c)/degs.length;return R>=1?0:Math.sqrt(-2*Math.log(R))*R2D}
// Turbulence velocity scales for the low-wind puff mode (AERMOD formulation eqs. 34-35, 39-41):
// sigma_v^2 = 3.6 u*^2 + 0.35 w*^2, floor 0.2 m/s; sigma_w^2 = (1.3u*)^2 + 1.6 (z/zi)^(2/3) w*^2, floor 0.02 m/s.
function turbScales(ustar,wstar,zi,z){
  let sv=Math.sqrt(3.6*ustar*ustar+0.35*wstar*wstar);sv=Math.max(sv,0.2);
  let swc2=0;if(wstar>0&&zi)swc2=1.6*Math.pow(Math.min(z,0.1*zi)/zi,2/3)*wstar*wstar;
  const sw=Math.max(Math.sqrt((1.3*ustar)**2+swc2),0.02);
  return{sv,sw};
}

/* ---------------------------------------------------------------
   7. Slope flow: time-dependent Prandtl (1942) model, 1-D in the slope-normal
      coordinate n (Zardi & Whiteman 2013, eqs. 2.4-2.5; Grisogono & Oerlemans 2001):
        du/dt = b sin(a) + d/dn(Km du/dn)              u: along-slope, + = UPslope
        db/dt = -N^2 sin(a) u + d/dn(Kh db/dn)         b = g theta'/theta0
      BC: u(0)=0; -Kh db/dn(0) = Bs (surface kinematic buoyancy flux, g/theta0 * H/(rho cp)).
      Implicit (backward-Euler) diffusion, symplectic coupling. Steady analytic solution
      (constant K, prescribed surface b0): u = b0/(N sqrt(Pr)) e^{-n/l} sin(n/l),
      l = (4 Km Kh / (N^2 sin^2 a))^{1/4}  (Prandtl 1942; Oerlemans & Grisogono 2002).
   --------------------------------------------------------------- */
function prandtlAnalytic(b0,N,sinA,Km,Kh){
  const l=Math.pow(4*Km*Kh/(N*N*sinA*sinA),0.25),A=b0/(N*Math.sqrt(Km/Kh));
  return{l,u:n=>A*Math.exp(-n/l)*Math.sin(n/l),b:n=>b0*Math.exp(-n/l)*Math.cos(n/l),umax:Math.abs(A)*Math.exp(-Math.PI/4)*Math.sin(Math.PI/4),zjet:Math.PI*l/4};
}
function makeSlopeGrid(nz=55,dz0=2,ratio=1.07){ // geometric grid of layer centres; first centre must sit above z0
  const zf=[0];for(let k=0;k<nz;k++)zf.push(zf[k]+dz0*Math.pow(ratio,k));
  const zc=[];for(let k=0;k<nz;k++)zc.push(0.5*(zf[k]+zf[k+1]));return{zf,zc,nz};
}
function tridiag(a,b,c,d,n){ // in-place Thomas algorithm; a: sub, b: diag, c: super
  for(let i=1;i<n;i++){const m=a[i]/b[i-1];b[i]-=m*c[i-1];d[i]-=m*d[i-1]}
  d[n-1]/=b[n-1];for(let i=n-2;i>=0;i--)d[i]=(d[i]-c[i]*d[i+1])/b[i];return d;
}
/* State for one slope angle. opts.kMode: 'const' (Prandtl test: constant K, no-slip, prescribed b0)
   or 'closure' (app). In closure mode:
     K = max(K_MO, K_local, nu)
     K_MO  = k u* n (1-n/h)^2 / phiH(n'/L) for n<h, n' = min(n,0.1h) if unstable
             (Troen & Mahrt 1986; Holtslag & Boville 1993)
     K_loc = l^2 |du/dn| f(Ri), l = k n/(1+k n/30 m), f = 1/(1+10 Ri (1+8 Ri)) for Ri>0,
             f = sqrt(1-18 Ri) for Ri<0 (Holtslag & Boville 1993; Louis 1979)
     Surface stress: tau/rho = C_D |V1| u1, C_D = (k / ln(z1/z0))^2, |V1| includes the ambient
             wind at the first level (bulk surface-layer drag; Garratt 1992 eq. 3.? / Louis 1979).  */
function slopeModel(sinA,grid,opts={}){
  const nz=grid.nz,zc=grid.zc,zf=grid.zf;
  const u=new Float64Array(nz),b=new Float64Array(nz),Km=new Float64Array(nz+1);
  const A=new Float64Array(nz),B=new Float64Array(nz),C=new Float64Array(nz),D=new Float64Array(nz);
  let last=null;
  function setK(env){
    for(let k=0;k<=nz;k++){const n=zf[k];let K;
      if(opts.kMode==='const'){K=opts.K}else{
        let kmo=0;const h=env.h||0;
        if(n>0&&n<h){const nn=env.L<0?Math.min(n,0.1*h):n;kmo=KARMAN*env.ustar*n*(1-n/h)**2/phiH(nn/env.L)}
        let kl=0;if(k>0&&k<nz){const dz=zc[k]-zc[k-1],du=(u[k]-u[k-1])/dz,db=(b[k]-b[k-1])/dz+env.N2;
          const S2=du*du+1e-8,Ri=db/S2,l=KARMAN*n/(1+KARMAN*n/30),f=Ri>0?1/(1+10*Ri*(1+8*Ri)):Math.sqrt(1-18*Ri);
          kl=l*l*Math.sqrt(S2)*f}
        K=Math.max(kmo,kl,NU_AIR)}
      Km[k]=K}
  }
  // bottom: 'dirichlet' value, or flux (scalar), or drag coefficient (momentum, implicit)
  function diffuse(x,dt,bc){
    for(let k=0;k<nz;k++){const dzk=zf[k+1]-zf[k];
      const kd=k>0?Km[k]/(zc[k]-zc[k-1]):0, ku=k<nz-1?Km[k+1]/(zc[k+1]-zc[k]):Km[nz]/(zf[nz]-zc[k]);
      A[k]=-dt*kd/dzk;C[k]=k<nz-1?-dt*ku/dzk:0;B[k]=1+dt*(kd+ku)/dzk;D[k]=x[k];
      if(k===0){A[k]=0;
        if(bc.dirichlet!==undefined){const kb=Km[0]/zc[0];B[k]+=dt*kb/dzk;D[k]+=dt*kb/dzk*bc.dirichlet}
        else if(bc.drag!==undefined){B[k]+=dt*bc.drag/dzk}
        else D[k]+=dt*bc.flux/dzk}}
    tridiag(A,B,C,D,nz);for(let k=0;k<nz;k++)x[k]=D[k];
  }
  function step(dt,env){ // env: {Bs (m2 s-3), N2, ustar, L, h, z0, Usyn1, fluxFn?} or test {b0, N2}
    if(env.fluxFn){ // surface fluxes recomputed with the vector sum of ambient + slope wind at 10 m
      const f=env.fluxFn(at(10,u));env=Object.assign({},env,f);last=f}
    setK(env);
    for(let k=0;k<nz;k++)u[k]+=dt*b[k]*sinA;          // buoyancy forcing (old b)
    if(opts.kMode==='const')diffuse(u,dt,{dirichlet:0});
    else{const CD=(KARMAN/Math.log(zc[0]/env.z0))**2,V1=Math.hypot(u[0],env.Usyn1||0);diffuse(u,dt,{drag:CD*V1})}
    for(let k=0;k<nz;k++)b[k]-=dt*env.N2*sinA*u[k];     // background-stratification advection (new u)
    if(env.b0!==undefined)diffuse(b,dt,{dirichlet:env.b0});else diffuse(b,dt,{flux:env.Bs});
  }
  function at(z,arr){if(z<=zc[0])return arr[0];for(let k=1;k<nz;k++)if(zc[k]>=z){const f=(z-zc[k-1])/(zc[k]-zc[k-1]);return arr[k-1]+f*(arr[k]-arr[k-1])}return arr[nz-1]}
  function jet(){let m=0,zm=0;for(let k=0;k<nz;k++)if(Math.abs(u[k])>Math.abs(m)){m=u[k];zm=zc[k]}return{umax:m,zjet:zm}}
  function depth(){const j=jet();if(!j.umax)return 0;for(let k=nz-1;k>=0;k--)if(Math.abs(u[k])>=0.1*Math.abs(j.umax)&&Math.sign(u[k])===Math.sign(j.umax))return zf[k+1];return 0}
  // layer-mean buoyancy over the flow layer (for the energy bound used by the app)
  function bMean(){const d=depth();if(!d)return 0;let s=0,w=0;for(let k=0;k<nz&&zf[k]<d;k++){const dz=Math.min(zf[k+1],d)-zf[k];s+=b[k]*dz;w+=dz}return w?s/w:0}
  function reset(){u.fill(0);b.fill(0)}
  return{u,b,step,at:(z)=>at(z,u),bAt:(z)=>at(z,b),jet,depth,bMean,reset,grid,lastFlux:()=>last};
}

/* ---------------------------------------------------------------
   8. DEM hydrology: priority-flood depression filling (Barnes et al. 2014),
      D-infinity flow direction and contributing area (Tarboton 1997).
   --------------------------------------------------------------- */
function priorityFlood(h,nx,ny,eps=0){
  const out=Float64Array.from(h),done=new Uint8Array(nx*ny);const heap=[];
  const push=(k,v)=>{heap.push([v,k]);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p][0]<=heap[i][0])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p}};
  const pop=()=>{const t=heap[0],l=heap.pop();if(heap.length){heap[0]=l;let i=0;for(;;){const a=2*i+1,c=a+1;let m=i;if(a<heap.length&&heap[a][0]<heap[m][0])m=a;if(c<heap.length&&heap[c][0]<heap[m][0])m=c;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];i=m}}return t};
  for(let i=0;i<ny;i++)for(let j=0;j<nx;j++)if(i===0||j===0||i===ny-1||j===nx-1){const k=i*nx+j;done[k]=1;push(k,out[k])}
  while(heap.length){const[v,k]=pop();const i=(k/nx)|0,j=k%nx;
    for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){if(!di&&!dj)continue;const a=i+di,c=j+dj;if(a<0||c<0||a>=ny||c>=nx)continue;const q=a*nx+c;if(done[q])continue;done[q]=1;
      if(out[q]<=v+eps)out[q]=v+eps;push(q,out[q])}}
  return out;
}
// D-infinity for rectangular cells (dx east-west, dy north-south; row 0 = north).
// Returns per cell: slope (tan), angle (radians, math convention in the x-east/y-south grid frame
// expressed as unit vector sx (east), sy (south)), and the two receiving neighbours with weights.
function dinf(h,nx,ny,dx,dy){
  const slope=new Float64Array(nx*ny),sx=new Float64Array(nx*ny),sy=new Float64Array(nx*ny);
  const r1=new Int32Array(nx*ny).fill(-1),r2=new Int32Array(nx*ny).fill(-1),w1=new Float64Array(nx*ny),w2=new Float64Array(nx*ny);
  // 8 facets: (cardinal di,dj), (diagonal di,dj)
  const F=[[[0,1],[-1,1]],[[-1,0],[-1,1]],[[-1,0],[-1,-1]],[[0,-1],[-1,-1]],[[0,-1],[1,-1]],[[1,0],[1,-1]],[[1,0],[1,1]],[[0,1],[1,1]]];
  for(let i=0;i<ny;i++)for(let j=0;j<nx;j++){const k=i*nx+j,e0=h[k];let best=0,bvx=0,bvy=0,bk1=-1,bk2=-1,bw1=0,bw2=0;
    for(const[[ci,cj],[gi,gj]]of F){const i1=i+ci,j1=j+cj,i2=i+gi,j2=j+gj;if(i1<0||j1<0||i1>=ny||j1>=nx||i2<0||j2<0||i2>=ny||j2>=nx)continue;
      const e1=h[i1*nx+j1],e2=h[i2*nx+j2];
      const d1=ci!==0?dy:dx, d2=ci!==0?dx:dy;              // cardinal distance, perpendicular distance
      const s1=(e0-e1)/d1,s2=(e1-e2)/d2,rmax=Math.atan2(d2,d1);let r=Math.atan2(s2,s1),s;
      if(r<0){r=0;s=s1}else if(r>rmax){r=rmax;s=(e0-e2)/Math.hypot(d1,d2)}else s=Math.hypot(s1,s2);
      if(s>best){best=s;
        // unit vectors in metres (x east, y south)
        const cx=cj*dx,cy=ci*dy,cl=Math.hypot(cx,cy),px=(gj-cj)*dx,py=(gi-ci)*dy,pl=Math.hypot(px,py);
        const ux=cx/cl,uy=cy/cl,vx=px/pl,vy=py/pl;bvx=Math.cos(r)*ux+Math.sin(r)*vx;bvy=Math.cos(r)*uy+Math.sin(r)*vy;
        bk1=i1*nx+j1;bk2=i2*nx+j2;bw1=(rmax-r)/rmax;bw2=r/rmax}}
    slope[k]=best;sx[k]=bvx;sy[k]=bvy;r1[k]=bk1;r2[k]=bk2;w1[k]=bw1;w2[k]=bw2}
  return{slope,sx,sy,r1,r2,w1,w2};
}
function contributingArea(hFilledEps,D,nx,ny,cellArea){
  const n=nx*ny,ord=[...Array(n).keys()].sort((a,b)=>hFilledEps[b]-hFilledEps[a]),A=new Float64Array(n).fill(cellArea);
  for(const k of ord){if(D.r1[k]>=0)A[D.r1[k]]+=A[k]*D.w1[k];if(D.r2[k]>=0)A[D.r2[k]]+=A[k]*D.w2[k]}
  return A;
}

/* ---------------------------------------------------------------
   9. Trajectory-following Gaussian puff integration (Lagrangian puff model;
      cf. CALPUFF, Scire et al. 2000). A continuous source of unit strength releases
      mass dt per step; each puff follows the (hour-frozen) wind field at source height.
      'plume' mode (transport speed >= 1 m/s): puff sigmas = sigma(x) of the P-G class,
        x = distance travelled (Briggs 1973 or ISC3 P-G). For straight uniform wind this
        sum reproduces the steady Gaussian plume (verified in the unit tests).
      'calm' mode (< 1 m/s; EPA treats < 1 m/s as calm for steady plumes): sigma_y = sigma_v t,
        sigma_z = sigma_w t (Taylor 1921 short-time limit) with AERMOD turbulence scales.
   --------------------------------------------------------------- */
function buildPath(src,velFn,o){
  const pts=[];let x=src.x,y=src.y,s=0,tau=0;const Tmax=o.Tmax||3600,dsMax=o.dsMax||8,sMax=o.sMax||4000;
  let guard=0;
  while(tau<Tmax&&guard++<5000){
    const v0=velFn(x,y,s,tau),sp0=Math.hypot(v0[0],v0[1]);
    let dt;
    if(o.mode==='calm'){dt=Math.max(1,0.25*tau);if(sp0*dt>dsMax)dt=dsMax/Math.max(sp0,1e-6)}
    else{const sg=sigmas(o.scheme,o.cls,Math.max(s,0.5)).sy;const ds=clamp(0.5*sg,0.25,dsMax);dt=Math.min(ds/Math.max(sp0,1e-3),60)}
    if(tau+dt>Tmax)dt=Tmax-tau;
    const xm=x+0.5*dt*v0[0],ym=y+0.5*dt*v0[1],vm=velFn(xm,ym,s+0.5*dt*sp0,tau+0.5*dt),spm=Math.hypot(vm[0],vm[1]);
    const sm=s+0.5*dt*spm,taum=tau+0.5*dt;
    let sy,sz;
    if(o.mode==='calm'){sy=Math.max(o.sv*taum,0.05);sz=Math.max(o.sw*taum,0.05)}
    else{const g=sigmas(o.scheme,o.cls,Math.max(sm,0.1));sy=g.sy;sz=g.sz}
    pts.push({x:xm,y:ym,s:sm,tau:taum,dt,sy,sz,vx:vm[0],vy:vm[1]});
    x+=dt*vm[0];y+=dt*vm[1];s+=dt*spm;tau+=dt;
    if(o.inside&&!o.inside(x,y))break;if(s>sMax)break;
  }
  return pts;
}
function pathChiQ(pts,rx,ry,rz,H,h){
  let c=0;for(const p of pts){const dx=rx-p.x,dy=ry-p.y,r2=dx*dx+dy*dy;if(r2>36*p.sy*p.sy)continue;
    c+=p.dt*Math.exp(-r2/(2*p.sy*p.sy))/(2*Math.PI*p.sy*p.sy)*verticalFactor(rz,H,p.sz,h)}
  return c;
}
// Splat onto a regular grid (cell averages, exact for each Gaussian via the normal CDF).
function pathSplat(pts,grid,rz,H,h,out,weight=1){
  const{nx,ny,dx,dy}=grid,gx=new Float64Array(nx),gy=new Float64Array(ny);
  for(const p of pts){const R=4*p.sy;
    const j0=Math.max(0,Math.floor((p.x-R)/dx)),j1=Math.min(nx-1,Math.floor((p.x+R)/dx)),i0=Math.max(0,Math.floor((p.y-R)/dy)),i1=Math.min(ny-1,Math.floor((p.y+R)/dy));
    if(j1<j0||i1<i0)continue;const vf=verticalFactor(rz,H,p.sz,h)*p.dt*weight;if(vf<1e-12)continue;
    for(let j=j0;j<=j1;j++)gx[j]=(Phi(((j+1)*dx-p.x)/p.sy)-Phi((j*dx-p.x)/p.sy))/dx;
    for(let i=i0;i<=i1;i++)gy[i]=(Phi(((i+1)*dy-p.y)/p.sy)-Phi((i*dy-p.y)/p.sy))/dy;
    for(let i=i0;i<=i1;i++){const a=gy[i]*vf;if(a<1e-14)continue;const row=i*nx;for(let j=j0;j<=j1;j++)out[row+j]+=a*gx[j]}}
  return out;
}
// Fetch-limited slope-flow speed (Lagrangian column; cf. Manins & Sawford 1979): a column
// starting near the drainage divide at regime onset reaches fetch X after age a_X with
// X = integral_0^{a_X} |u(t)| dt; the speed there is u(min(a_X, age_now)).
function fetchLimited(series,dt,X,ageSteps){
  let dist=0;const n=Math.min(ageSteps,series.length-1);
  for(let k=0;k<n;k++){const d=Math.abs(series[k])*dt;if(dist+d>=X)return series[k];dist+=d}
  return series[Math.max(0,n)];
}

// Longest upslope flow-path length to each cell along D-infinity receivers (slope-flow fetch).
function upslopeLength(hFilledEps,D,nx,ny,dx,dy){
  const n=nx*ny,ord=[...Array(n).keys()].sort((a,b)=>hFilledEps[b]-hFilledEps[a]),L=new Float64Array(n);
  const dist=(k,r)=>Math.hypot(((r%nx)-(k%nx))*dx,(((r/nx)|0)-((k/nx)|0))*dy);
  for(const k of ord){for(const[r,w]of[[D.r1[k],D.w1[k]],[D.r2[k],D.w2[k]]])if(r>=0&&w>1e-6){const v=L[k]+dist(k,r);if(v>L[r])L[r]=v}}
  return L;
}
// Largest elevation drop from any upslope cell to each cell along D-infinity receivers (available descent).
function upslopeDrop(hFilledEps,D,nx,ny){
  const n=nx*ny,ord=[...Array(n).keys()].sort((a,b)=>hFilledEps[b]-hFilledEps[a]),Z=new Float64Array(n);
  for(const k of ord){for(const[r,w]of[[D.r1[k],D.w1[k]],[D.r2[k],D.w2[k]]])if(r>=0&&w>1e-6){const v=Z[k]+hFilledEps[k]-hFilledEps[r];if(v>Z[r])Z[r]=v}}
  return Z;
}

/* ---------------- Outdoor sound propagation (ISO 9613-1:1993, ISO 9613-2:1996) ----------------
   Octave-band attenuation from a point source: A = A_div + A_atm + A_gr (+ A_fol).
   A_div = 20 log10(d/d0) + 11 - 11 relative to 1 m reference level: here the source is specified as
   L_p at 1 m, so A_div(re 1 m) = 20 log10(d/1 m) (spherical spreading). */
const OCT=[63,125,250,500,1000,2000,4000,8000],OCTX=[-4,-3,-2,-1,0,1,2,3].map(n=>1000*Math.pow(10,3*n/10)); // nominal and exact mid-band (ISO 266)
function isoAlpha(f,TC,RH,pkPa=101.325){ // dB/m, ISO 9613-1 eqs. (3)-(5), Annex B
  const T=TC+273.15,T0=293.15,T01=273.16,pr=101.325,pa=pkPa/pr;
  const C=-6.8346*Math.pow(T01/T,1.261)+4.6151,psat=Math.pow(10,C),h=RH*psat/pa; // h = molar conc. of water vapour, %
  const frO=pa*(24+4.04e4*h*(0.02+h)/(0.391+h));
  const frN=pa*Math.pow(T/T0,-0.5)*(9+280*h*Math.exp(-4.170*(Math.pow(T/T0,-1/3)-1)));
  return 8.686*f*f*(1.84e-11/pa*Math.sqrt(T/T0)+Math.pow(T/T0,-2.5)*(0.01275*Math.exp(-2239.1/T)/(frO+f*f/frO)+0.1068*Math.exp(-3352.0/T)/(frN+f*f/frN)));
}
function isoGround(f,hs,hr,dp,G){ // dB, ISO 9613-2 sec. 7.3.1 general method, Table 3 (A_gr = A_s + A_r + A_m)
  const e=Math.exp,k=1-e(-dp/50);
  const ap=h=>1.5+3.0*e(-0.12*(h-5)*(h-5))*k+5.7*e(-0.09*h*h)*(1-e(-2.8e-6*dp*dp));
  const bp=h=>1.5+8.6*e(-0.09*h*h)*k,cp=h=>1.5+14.0*e(-0.46*h*h)*k,dpf=h=>1.5+5.0*e(-0.9*h*h)*k;
  const one=h=>f<=63?-1.5:f<=125?-1.5+G*ap(h):f<=250?-1.5+G*bp(h):f<=500?-1.5+G*cp(h):f<=1000?-1.5+G*dpf(h):-1.5*(1-G);
  const q=dp<=30*(hs+hr)?0:1-30*(hs+hr)/dp,Am=f<=63?-3*q:-3*q*(1-G);
  return one(hs)+one(hr)+Am;
}
const FOL_10_20=[0,0,1,1,1,1,2,3],FOL_PER_M=[0.02,0.03,0.04,0.05,0.06,0.08,0.09,0.12];
function isoFoliage(f,df){ // dB, ISO 9613-2 Annex A Table A.1 (dense foliage that blocks the view); df capped at 200 m
  const i=OCT.indexOf(f);if(i<0||df<10)return 0;return df<=20?FOL_10_20[i]:Math.min(df,200)*FOL_PER_M[i]}
function soundAtten(f,d,o){ // total attenuation re the 1 m level
  d=Math.max(d,1);const Adiv=20*Math.log10(d),Aatm=isoAlpha(OCTX[OCT.indexOf(f)]||f,o.TC,o.RH,o.pkPa)*d,Agr=isoGround(f,o.hs,o.hr,d,o.G??1),Afol=o.df?isoFoliage(f,o.df):0;
  return{A:Adiv+Aatm+Agr+Afol,Adiv,Aatm,Agr,Afol}}
return{OCT,OCTX,isoAlpha,isoGround,isoFoliage,soundAtten,KARMAN,GRAV,SIGMA_SB,CP,RD,CLS,HVU,solarPosition,sunEvent,pgTurner,pgSRDT,netRadiationIndex,insolationClass,golderClass,
  psiM,phiH,windAtHeight,satVapSlopeOverGamma,netRadiation,surfaceScheme,briggsRural,pgISC,sigmas,verticalFactor,plumeChiQ,plumeGroundCL,
  erf,Phi,PhiInv,circStd,turbScales,prandtlAnalytic,makeSlopeGrid,slopeModel,priorityFlood,dinf,contributingArea,buildPath,pathChiQ,pathSplat,fetchLimited,upslopeLength,upslopeDrop};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=PHYS;
