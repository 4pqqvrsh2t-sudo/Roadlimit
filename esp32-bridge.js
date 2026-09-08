(()=>{
  const handlers=new Set();
  let ws=null,retryTimer=null,retryMs=1000;
  function valid(payload){return payload&&payload.v===1&&typeof payload.type==='string'}
  function emit(payload){if(!valid(payload))return false;for(const h of handlers){try{h(payload)}catch(e){console.warn('ESP32 handler',e)}};window.dispatchEvent(new CustomEvent('roadlimit-esp32',{detail:payload}));return true}
  function ingest(payload){if(typeof payload==='string'){try{payload=JSON.parse(payload)}catch{return false}}return emit(payload)}
  function connectWebSocket(url){
    if(location.protocol==='https:'&&!/^wss:\/\//i.test(url))throw new Error('RoadLimit requires wss:// from an HTTPS page');
    disconnect(); localStorage.setItem('roadlimitEsp32Ws',url);
    const open=()=>{ws=new WebSocket(url);ws.onopen=()=>{retryMs=1000};ws.onmessage=e=>ingest(e.data);ws.onclose=()=>{retryTimer=setTimeout(open,retryMs);retryMs=Math.min(30000,retryMs*2)};ws.onerror=()=>{try{ws.close()}catch{}}};open();
  }
  function disconnect(){if(retryTimer)clearTimeout(retryTimer);retryTimer=null;if(ws){ws.onclose=null;try{ws.close()}catch{}ws=null}}
  window.RoadLimitESP32={
    ingest,
    onMessage(fn){handlers.add(fn);return()=>handlers.delete(fn)},
    connectWebSocket,disconnect,
    get savedWebSocket(){return localStorage.getItem('roadlimitEsp32Ws')||''}
  };
})();
