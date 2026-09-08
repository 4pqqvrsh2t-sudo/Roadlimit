async function querySpartanburg(lat,lon){const r=await timeoutFetch(arcgisUrl(URLS.spartanburg,lat,lon,'OBJECTID,FullName,SpeedLimit,OwnedBy,MaintResp,OneWay,PZOClass,HighwayNum,NGUID'));if(!r.ok)throw Error(`Spartanburg ${r.status}`);const fc=await r.json();return geoToRoads(fc,'spartanburg',p=>({objectId:p.OBJECTID,name:p.FullName||p.HighwayNum||'',speed:validOfficialSpeed(p.SpeedLimit),owner:p.OwnedBy||'',maint:p.MaintResp||'',oneWay:p.OneWay||'',roadClass:p.PZOClass||'',meta:p}))}
async function querySCDOT(lat,lon){const r=await timeoutFetch(arcgisUrl(URLS.scdot,lat,lon,'OBJECTID,CountyName,RouteTypeN,RouteNumbe,Regulatory,RouteLRS,Status1'));if(!r.ok)throw Error(`SCDOT ${r.status}`);const fc=await r.json();return geoToRoads(fc,'scdot',p=>({objectId:p.OBJECTID,name:[p.RouteTypeN,p.RouteNumbe].filter(Boolean).join(' ')||p.RouteLRS||'',speed:validOfficialSpeed(p.Regulatory),owner:'SCDOT',oneWay:'',roadClass:p.RouteTypeN||'',meta:p}))}
async function queryOSM(lat,lon){const d=CFG.queryRadiusM/111320,cos=Math.max(.2,Math.cos(lat*Math.PI/180)),dl=d/cos,b=`${lat-d},${lon-dl},${lat+d},${lon+dl}`;const q=`[out:json][timeout:12];(way["highway"](${b}););out tags geom;`;let err;for(const ep of URLS.overpass){try{const r=await timeoutFetch(ep,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:q},12000);if(!r.ok)throw Error(`Overpass ${r.status}`);const j=await r.json();return(j.elements||[]).map(osmWayToRoad).filter(Boolean)}catch(e){err=e}}throw err||Error('Overpass failed')}
function tileCenter(lat,lon){const s=CFG.tileDeg,la=Math.round(lat/s)*s,lo=Math.round(lon/s)*s;return{key:`${la.toFixed(3)},${lo.toFixed(3)}`,lat:la,lon:lo}}
async function loadTile(lat,lon){
 const t=tileCenter(lat,lon);
 if(memTiles.has(t.key)){state.tile=memTiles.get(t.key);return state.tile}
 // Keep matching from the previous overlapping tile while the next tile refreshes.
 if(state.tile&&meters(state.tile.lat,state.tile.lon,lat,lon)<CFG.queryRadiusM-90){refreshTile(t).catch(()=>{});return state.tile}
 const cached=await dbGet('tiles',t.key).catch(()=>null);
 if(cached&&Date.now()-cached.fetchedAt<CFG.cacheMs){state.tile=cached;memTiles.set(t.key,cached);refreshTile(t).catch(()=>{});return cached}
 return refreshTile(t)
}
async function refreshTile(t){
 if(tilePromises.has(t.key))return tilePromises.get(t.key);
 const job=(async()=>{const results=await Promise.allSettled([querySpartanburg(t.lat,t.lon),querySCDOT(t.lat,t.lon),queryOSM(t.lat,t.lon)]);const names=['Spartanburg County','SCDOT','OpenStreetMap'];let roads=[];results.forEach((r,i)=>{state.sourceHealth[names[i]]=r.status==='fulfilled'?`OK (${r.value.length})`:`ERROR: ${r.reason?.message||'failed'}`;if(r.status==='fulfilled')roads.push(...r.value)});const tile={key:t.key,lat:t.lat,lon:t.lon,fetchedAt:Date.now(),roads};memTiles.set(t.key,tile);state.tile=tile;await dbPut('tiles',tile).catch(()=>{});updateDiagnostics();return tile})();
 tilePromises.set(t.key,job);try{return await job}finally{tilePromises.delete(t.key)}
}
