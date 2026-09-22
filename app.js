'use strict';

const SERVICE_UUID='c6f50001-46bb-4bb5-a8dd-000000000001';
const DATA_UUID='c6f50002-46bb-4bb5-a8dd-000000000001';

const $=id=>document.getElementById(id);
const MPH_PER_MPS=2.2369362920544;

let bleDevice=null;
let bleCharacteristic=null;
let bleConnected=false;
let bleBusy=false;
let blePending=null;

let watchId=null;
let tracking=false;
let previousFix=null;
let smoothedSpeed=null;
let currentLimit=null;
let currentRoad='';
let lastHereQueryAt=0;
let lastHerePoint=null;
let hereBusy=false;
let hereQueued=null;

const encoder=new TextEncoder();

function setText(id,value){$(id).textContent=value}

function meters(a,b){
  if(!a||!b)return Infinity;
  const R=6371000;
  const p=Math.PI/180;
  const x=(b.lon-a.lon)*p*Math.cos((a.lat+b.lat)*p/2);
  const y=(b.lat-a.lat)*p;
  return Math.hypot(x,y)*R;
}

function speedColor(speed,limit){
  if(!Number.isFinite(limit))return '#ffffff';
  const diff=speed-limit;
  if(diff>=10)return '#ff1f1f';
  if(diff>5)return mixHex('#ff8500','#ff1f1f',(diff-5)/5);
  if(diff>-5)return '#ff8500';
  if(diff>-10)return mixHex('#008cff','#aa00ff',(-diff-5)/5);
  return '#aa00ff';
}

function mixHex(a,b,t){
  t=Math.max(0,Math.min(1,t));
  const av=parseInt(a.slice(1),16),bv=parseInt(b.slice(1),16);
  const ar=(av>>16)&255,ag=(av>>8)&255,ab=av&255;
  const br=(bv>>16)&255,bg=(bv>>8)&255,bb=bv&255;
  const r=Math.round(ar+(br-ar)*t);
  const g=Math.round(ag+(bg-ag)*t);
  const bl=Math.round(ab+(bb-ab)*t);
  return '#'+[r,g,bl].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function render(speed){
  const shown=Math.max(0,Math.round(speed||0));
  setText('speed',shown);
  setText('limit',Number.isFinite(currentLimit)?Math.round(currentLimit):'--');
  setText('road',currentRoad||'Speed limit unavailable');
  $('speed').style.color=speedColor(speed,currentLimit);
}

function deriveSpeed(pos){
  const c=pos.coords;
  let mph=Number.isFinite(c.speed)&&c.speed>=0?c.speed*MPH_PER_MPS:null;

  const fix={
    lat:c.latitude,
    lon:c.longitude,
    t:pos.timestamp||Date.now()
  };

  if(mph==null&&previousFix){
    const dt=(fix.t-previousFix.t)/1000;
    if(dt>.25&&dt<8)mph=(meters(previousFix,fix)/dt)*MPH_PER_MPS;
  }
  previousFix=fix;

  if(!Number.isFinite(mph))mph=0;
  mph=Math.max(0,Math.min(180,mph));
  if(mph<.8)mph=0;

  if(smoothedSpeed==null)smoothedSpeed=mph;
  else if(mph===0)smoothedSpeed=0;
  else smoothedSpeed=smoothedSpeed*.55+mph*.45;

  return smoothedSpeed;
}

function headingToCompass(deg){
  if(!Number.isFinite(deg))return null;
  const dirs=['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(((deg%360)+360)%360/45)%8];
}

function pickLimit(limits,heading){
  if(!Array.isArray(limits)||!limits.length)return null;
  const compass=headingToCompass(heading);
  let chosen=null;

  if(compass){
    chosen=limits.find(x=>String(x.direction||'').toUpperCase()===compass);
  }
  chosen=chosen||limits[0];

  let mph=Number(chosen.maxSpeed);
  if(!Number.isFinite(mph))return null;

  const unit=String(chosen.speedUnit||'').toLowerCase();
  if(unit.includes('km'))mph*=0.621371192237334;

  return Math.round(mph);
}

async function queryHere(point,heading){
  const key=$('apiKey').value.trim();
  if(!key){
    setText('limitStatus','NO KEY');
    currentLimit=null;
    currentRoad='';
    return;
  }

  if(hereBusy){
    hereQueued={point,heading};
    return;
  }

  hereBusy=true;
  setText('limitStatus','LOOKUP');

  try{
    const url=new URL('https://revgeocode.search.hereapi.com/v1/revgeocode');
    url.searchParams.set('at',point.lat+','+point.lon);
    url.searchParams.set('showNavAttributes','speedLimits');
    url.searchParams.set('apiKey',key);

    const response=await fetch(url);
    if(!response.ok)throw new Error('HERE '+response.status);

    const data=await response.json();
    const item=(data.items||[]).find(x=>x.navigationAttributes?.speedLimits?.length)||(data.items||[])[0];

    if(!item){
      currentLimit=null;
      currentRoad='';
      setText('limitStatus','NO DATA');
    }else{
      currentRoad=item.address?.street||item.title||'';
      currentLimit=pickLimit(item.navigationAttributes?.speedLimits,heading);
      setText('limitStatus',Number.isFinite(currentLimit)?'LIVE':'NO LIMIT');
    }
  }catch(err){
    console.warn(err);
    setText('limitStatus','ERROR');
  }finally{
    hereBusy=false;
    if(hereQueued){
      const q=hereQueued;
      hereQueued=null;
      queryHere(q.point,q.heading);
    }
  }
}

function maybeUpdateLimit(pos){
  const c=pos.coords;
  const point={lat:c.latitude,lon:c.longitude};
  const now=Date.now();
  const moved=meters(lastHerePoint,point);

  const moving=Number.isFinite(smoothedSpeed)?smoothedSpeed>2: false;
  const minGap=moving?2500:10000;
  const minMove=moving?22:8;

  if(lastHerePoint&&now-lastHereQueryAt<minGap)return;
  if(lastHerePoint&&moved<minMove&&now-lastHereQueryAt<15000)return;

  lastHereQueryAt=now;
  lastHerePoint=point;
  queryHere(point,c.heading);
}

async function flushBle(){
  if(!bleConnected||!bleCharacteristic||bleBusy||!blePending)return;

  const packet=blePending;
  blePending=null;
  bleBusy=true;

  try{
    const bytes=encoder.encode(packet);
    if(bleCharacteristic.properties.writeWithoutResponse&&bleCharacteristic.writeValueWithoutResponse){
      await bleCharacteristic.writeValueWithoutResponse(bytes);
    }else{
      await bleCharacteristic.writeValue(bytes);
    }
  }catch(err){
    console.warn(err);
    bleConnected=false;
    bleCharacteristic=null;
    setText('bleStatus','LOST');
  }finally{
    bleBusy=false;
    if(blePending)queueMicrotask(flushBle);
  }
}

function sendHud(speed){
  if(!bleConnected)return;
  const limit=Number.isFinite(currentLimit)?Math.round(currentLimit):-1;
  blePending=speed.toFixed(1)+','+limit+'\n';
  flushBle();
}

async function connectHud(){
  if(!navigator.bluetooth){
    setText('bleStatus','UNSUPPORTED');
    alert('This browser does not expose Web Bluetooth. On iPhone, open Car-HUD in a Web Bluetooth browser such as Bluefy.');
    return;
  }

  setText('bleStatus','SEARCH');
  bleDevice=await navigator.bluetooth.requestDevice({
    filters:[{services:[SERVICE_UUID]}],
    optionalServices:[SERVICE_UUID]
  });

  bleDevice.addEventListener('gattserverdisconnected',()=>{
    bleConnected=false;
    bleCharacteristic=null;
    setText('bleStatus','OFF');
    $('connectBtn').textContent='Connect HUD';
  });

  setText('bleStatus','CONNECT');
  const server=await bleDevice.gatt.connect();
  const service=await server.getPrimaryService(SERVICE_UUID);
  bleCharacteristic=await service.getCharacteristic(DATA_UUID);
  bleConnected=true;
  setText('bleStatus','LIVE');
  $('connectBtn').textContent='HUD Connected';
}

function onPosition(pos){
  const c=pos.coords;
  setText('gpsStatus','±'+Math.round(c.accuracy||0)+'m');

  const speed=deriveSpeed(pos);
  render(speed);
  sendHud(speed);

  if((c.accuracy||999)<=50)maybeUpdateLimit(pos);
}

function onGeoError(err){
  setText('gpsStatus','ERROR');
  console.warn(err);
}

function start(){
  if(tracking){
    if(watchId!=null)navigator.geolocation.clearWatch(watchId);
    watchId=null;
    tracking=false;
    $('startBtn').textContent='Start';
    setText('gpsStatus','OFF');
    return;
  }

  const key=$('apiKey').value.trim();
  if(key)localStorage.setItem('carHudHereKey',key);

  if(!navigator.geolocation){
    alert('Geolocation is not available in this browser.');
    return;
  }

  previousFix=null;
  smoothedSpeed=null;
  tracking=true;
  $('startBtn').textContent='Stop';

  watchId=navigator.geolocation.watchPosition(
    onPosition,
    onGeoError,
    {enableHighAccuracy:true,maximumAge:0,timeout:10000}
  );
}

$('connectBtn').addEventListener('click',()=>connectHud().catch(err=>{
  console.warn(err);
  setText('bleStatus','ERROR');
}));

$('startBtn').addEventListener('click',start);

$('apiKey').value=localStorage.getItem('carHudHereKey')||'';
$('apiKey').addEventListener('change',()=>{
  const key=$('apiKey').value.trim();
  if(key)localStorage.setItem('carHudHereKey',key);
  else localStorage.removeItem('carHudHereKey');
});

if('serviceWorker'in navigator){
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{});
}

render(0);
