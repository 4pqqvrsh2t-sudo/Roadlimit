# RoadLimit ESP32 bridge (future hardware entrance)

The current iPhone build is a PWA. Safari on iOS does not expose Web Bluetooth, so the browser build does **not** try to pair directly to an ESP32 over BLE. Instead the application already includes a transport-agnostic input interface in `esp32-bridge.js`.

## JavaScript ingestion interface

Any future native wrapper, Wi-Fi relay, WebSocket service, or development console can feed messages into the app:

```js
RoadLimitESP32.ingest({
  v: 1,
  type: "speed_limit",
  mph: 35,
  confidence: 0.95,
  ts: Date.now()
});
```

RoadLimit also supports a future secure WebSocket relay:

```js
RoadLimitESP32.connectWebSocket("wss://your-relay.example/ws");
```

The HTTPS PWA intentionally requires `wss://` rather than insecure `ws://`.

## Protocol v1

### Speed-limit observation
```json
{"v":1,"type":"speed_limit","mph":35,"confidence":0.95,"lat":34.9,"lon":-81.9,"ts":1788832800000}
```

### GPS observation (reserved for future use)
```json
{"v":1,"type":"gps","lat":34.9,"lon":-81.9,"accuracy":2.5,"heading":90,"speed_mps":15,"ts":1788832800000}
```

### Physical sign observation (reserved for future camera/sensor hardware)
```json
{"v":1,"type":"sign","mph":25,"confidence":0.98,"lat":34.9,"lon":-81.9,"heading":90,"ts":1788832800000}
```

The app currently consumes `speed_limit`; the other message types are reserved so hardware can be added without changing the protocol later.
