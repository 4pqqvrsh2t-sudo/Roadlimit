# Car-HUD

Car-HUD is a small windshield-reflection speed display built around an ESP32 and a 2.0-inch ST7789 TFT.

The phone does the data work:

- GPS provides current vehicle speed.
- HERE Geocoding & Search provides the posted speed limit for the current road.
- Bluetooth Low Energy sends current speed + speed limit to the ESP32.
- The ESP32 only renders the HUD and reads the two physical turn-signal inputs.

There is no custom road database in this repository.

## HUD behavior

The display shows only the current speed on a black background.

Color logic:

- 10 MPH or more over the limit: red.
- 5 to 10 MPH over: fade orange -> red.
- Less than 5 MPH over through less than 5 MPH under: orange.
- Exactly 5 MPH under: blue.
- 5 to 10 MPH under: fade blue -> purple.
- 10 MPH or more under: purple.
- Unknown speed limit: white.

The digits are pre-mirrored in firmware so the windshield reflection reads normally.

Turn signals are intentionally minimal:

- left turn signal active: last 6 pixels on the left edge glow green.
- right turn signal active: last 6 pixels on the right edge glow green.
- hazards: both edges glow green.
- the ESP32 follows the truck's real blink pulse instead of inventing a software blink rate.

## Phone app

The root of this repository is a GitHub Pages-compatible phone app.

1. Open the page on the iPhone.
2. Enter a HERE API key once. It is stored only in local browser storage.
3. Tap **Connect HUD** and select the ESP32.
4. Tap **Start** and allow precise location.
5. Keep the phone app open while driving.

The app uses HERE reverse geocoding with the `speedLimits` navigation attribute. If the speed-limit service is unavailable or returns no speed limit, the HUD keeps showing current speed in white instead of guessing.

### iPhone Bluetooth note

Safari does not expose Web Bluetooth. Use an iOS browser that supports Web Bluetooth, such as Bluefy, for the direct BLE connection.

## Firmware

Flash:

`firmware/Car_HUD.ino`

Target hardware:

- ESP32 ESP-WROOM-32 development board.
- 2.0-inch 240x320 ST7789 SPI TFT.
- TFT pins: GND, VCC, SCL, SDA, RES/RST, DC, CS, BL/BLK.

See `firmware/README.md` for the exact pin map.

## Safety

Do not connect a 12 V vehicle turn-signal wire directly to an ESP32 GPIO. Use a proper automotive input-conditioning or isolation circuit so the ESP32 receives safe 3.3 V logic.

For first power-up, bench-test the ESP32 and display from USB before connecting anything to vehicle power.
