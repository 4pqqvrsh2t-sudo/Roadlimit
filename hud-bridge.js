(()=>{
  'use strict';

  const SERVICE_UUID='c6f50001-46bb-4bb5-a8dd-000000000001';
  const DATA_UUID='c6f50002-46bb-4bb5-a8dd-000000000001';

  let device=null;
  let characteristic=null;
  let connected=false;
  let busy=false;
  let pending=null;
  let lastFix=null;
  const encoder=new TextEncoder();

  const mphFromMps=mps=>mps*2.2369362920544;

  function status(text){
    const el=document.getElementById('hudStatus');
    if(el)el.textContent=text;
  }

  function refreshUI(){
    const btn=document.getElementById('hudBtn');
    if(btn)btn.textContent=connected?'HUD connected':'Connect HUD';
    if(!connected&&(!navigator.bluetooth))status('HUD BLE unavailable in this browser');
  }

  function supported(){
    return Boolean(navigator.bluetooth);
  }

  async function connect(){
    if(!supported()){
      status('Use a Web Bluetooth browser on iPhone to connect the HUD');
      throw new Error('Web Bluetooth is unavailable');
    }

    status('Searching for RoadLimit HUD…');

    device=await navigator.bluetooth.requestDevice({
      filters:[{namePrefix:'RoadLimit HUD'}],
      optionalServices:[SERVICE_UUID]
    });

    device.addEventListener('gattserverdisconnected',()=>{
      connected=false;
      characteristic=null;
      status('HUD disconnected');
      refreshUI();
    });

    status('Connecting…');
    const server=await device.gatt.connect();
    const service=await server.getPrimaryService(SERVICE_UUID);
    characteristic=await service.getCharacteristic(DATA_UUID);
    connected=true;
    status('HUD connected');
    refreshUI();
  }

  function disconnect(){
    if(device?.gatt?.connected)device.gatt.disconnect();
    connected=false;
    characteristic=null;
    status('HUD disconnected');
    refreshUI();
  }

  function derivedSpeedMps(raw){
    if(Number.isFinite(raw?.speed)&&raw.speed>=0){
      lastFix=raw;
      return raw.speed;
    }

    let result=0;
    if(lastFix&&Number.isFinite(raw?.lat)&&Number.isFinite(raw?.lon)){
      const dt=((raw.t||Date.now())-(lastFix.t||0))/1000;
      if(dt>0.25&&dt<8){
        const d=meters(lastFix.lat,lastFix.lon,raw.lat,raw.lon);
        result=d/dt;
      }
    }
    lastFix=raw;
    return Math.max(0,result);
  }

  async function flush(){
    if(!connected||!characteristic||busy||!pending)return;

    const packet=pending;
    pending=null;
    busy=true;

    try{
      const bytes=encoder.encode(packet);
      if(characteristic.properties.writeWithoutResponse&&characteristic.writeValueWithoutResponse){
        await characteristic.writeValueWithoutResponse(bytes);
      }else{
        await characteristic.writeValue(bytes);
      }
    }catch(err){
      console.warn('HUD write failed',err);
      status('HUD connection lost');
      connected=false;
      characteristic=null;
      refreshUI();
    }finally{
      busy=false;
      if(pending)queueMicrotask(flush);
    }
  }

  function sendFix(raw,limitMph){
    if(!connected)return;

    let speedMph=mphFromMps(derivedSpeedMps(raw));
    if(!Number.isFinite(speedMph))speedMph=0;
    speedMph=Math.max(0,Math.min(180,speedMph));
    if(speedMph<0.7)speedMph=0;

    const limit=Number.isFinite(limitMph)?Math.round(limitMph):-1;
    pending=`${speedMph.toFixed(1)},${limit}\n`;
    flush();
  }

  window.RoadLimitHUD={
    connect,
    disconnect,
    sendFix,
    refreshUI,
    get connected(){return connected},
    get supported(){return supported()}
  };

  setTimeout(refreshUI,0);
})();
