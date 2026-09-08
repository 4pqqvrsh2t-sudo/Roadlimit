'use strict';
const $=id=>document.getElementById(id);
const CFG={
  unknownDisplay:'~35',
  tileDeg:0.005,
  queryRadiusM:650,
  gpsRejectM:45,
  matchMaxM:55,
  sourcePriority:{correction:120,spartanburg:110,scdot:105,esp32:100,osm:80,unknown:0},
  cacheMs:24*60*60*1000,
  announceCooldownMs:3500,
  limitStableFixes:2
};
const URLS={
  spartanburg:'https://maps.spartanburgcounty.org/server/rest/services/Planning/IZM_Streets/MapServer/1/query',
  scdot:'https://gis.scdot.org/hosting/rest/services/Speed_Limits/FeatureServer/16/query',
  overpass:['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']
};
let state={watch:null,recording:false,track:[],events:[],tile:null,lastRaw:null,lastSmooth:null,lastMatch:null,lastLimit:null,pendingLimit:null,pendingCount:0,lastAnnounce:0,lastDrive:null,reviewMap:null,hardware:null,sourceHealth:{},wake:null,fixSeq:0};
const memTiles=new Map(),tilePromises=new Map();

function meters(a,b,c,d){const R=6371000,p=Math.PI/180,x=(c-a)*p*Math.cos((a+c)*p/2),y=(d-b)*p;return Math.hypot(x,y)*R}
function bearing(a,b,c,d){const p=Math.PI/180,y1=a*p,y2=c*p,dl=(d-b)*p,y=Math.sin(dl)*Math.cos(y2),x=Math.cos(y1)*Math.sin(y2)-Math.sin(y1)*Math.cos(y2)*Math.cos(dl);return(Math.atan2(y,x)*180/Math.PI+360)%360}
function angleDiff(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d}
function normName(s=''){return s.toUpperCase().replace(/\b(STREET|ST|ROAD|RD|AVENUE|AVE|BOULEVARD|BLVD|HIGHWAY|HWY|DRIVE|DR|LANE|LN|COURT|CT|PARKWAY|PKWY)\b/g,'').replace(/[^A-Z0-9]/g,'').trim()}
function lineDistance(p,a,b){const R=6371000,r=Math.PI/180,co=Math.cos(p.lat*r),x=(p.lon-a.lon)*r*R*co,y=(p.lat-a.lat)*r*R,x2=(b.lon-a.lon)*r*R*co,y2=(b.lat-a.lat)*r*R,t=Math.max(0,Math.min(1,(x*x2+y*y2)/(x2*x2+y2*y2||1)));return Math.hypot(x-x2*t,y-y2*t)}
function parseMph(v,defaultUnit='mph'){
  if(v==null||v==='')return null;const s=String(v).trim();
  if(/^(none|signals|variable|walk|unposted|implicit)$/i.test(s))return null;
  const m=s.match(/(\d+(?:\.\d+)?)\s*(mph|mi\/h|km\/h|kph)?/i);if(!m)return null;
  let n=Number(m[1]),u=(m[2]||defaultUnit).toLowerCase();if(u==='km/h'||u==='kph')n*=0.621371;
  n=Math.round(n);return n>=5&&n<=90?n:null;
}
function validOfficialSpeed(v){const n=Number(v);return Number.isFinite(n)&&n>=5&&n<=85&&Math.abs(n/5-Math.round(n/5))<.01?Math.round(n):null}
function featureLines(feature){const g=feature.geometry;if(!g)return[];if(g.type==='LineString')return[g.coordinates];if(g.type==='MultiLineString')return g.coordinates;return[]}
function geoToRoads(fc,source,mapper){const out=[];(fc.features||[]).forEach(f=>featureLines(f).forEach((coords,i)=>{if(coords.length<2)return;const m=mapper(f.properties||{});out.push({...m,id:`${source}:${m.objectId??f.id??i}:${i}`,source,points:coords.map(([lon,lat])=>({lat,lon}))})}));return out}
function osmWayToRoad(w){const tags=w.tags||{},g=w.geometry||[];if(g.length<2)return null;const bad=new Set(['footway','path','cycleway','steps','pedestrian','bridleway','corridor','construction','proposed']);if(bad.has(tags.highway))return null;return{id:`osm:${w.id}`,objectId:w.id,source:'osm',name:tags.name||tags.ref||'',roadClass:tags.highway||'',oneWay:tags.oneway||'',owner:'',speed:osmDirectionalSpeed(tags,null,null),tags,points:g.map(x=>({lat:x.lat,lon:x.lon}))}}
function osmDirectionalSpeed(tags,heading,segBearing){let base=parseMph(tags.maxspeed,'km/h'),f=parseMph(tags['maxspeed:forward'],'km/h'),b=parseMph(tags['maxspeed:backward'],'km/h');if(heading==null||segBearing==null)return base;if(f!=null||b!=null)return angleDiff(heading,segBearing)<=angleDiff(heading,(segBearing+180)%360)?(f??base):(b??base);return base}
function timeoutFetch(url,opts={},ms=8000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);return fetch(url,{...opts,signal:c.signal}).finally(()=>clearTimeout(t))}
function arcgisUrl(base,lat,lon,fields){const p=new URLSearchParams({where:'1=1',geometry:`${lon},${lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:String(CFG.queryRadiusM),units:'esriSRUnit_Meter',outFields:fields,returnGeometry:'true',outSR:'4326',f:'geojson'});return `${base}?${p}`}
