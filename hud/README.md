# RoadLimit windshield HUD

This folder contains the ESP32 firmware for the RoadLimit windshield HUD.

## What it does

- Receives current GPS speed and the matched road speed limit from the RoadLimit iPhone web app.
- Shows only current speed on the HUD.
- Pre-mirrors the digits so they read correctly after reflecting off the windshield.
- Uses a pure black display background.
- Speed color rules:
  - 10+ MPH over: red.
  - 5 to 10 MPH over: orange fades toward red.
  - More than 5 MPH under through 5 MPH over: orange.
  - 5 MPH under: blue.
  - 5 to 10 MPH under: blue fades toward purple.
  - 10+ MPH under: purple.
  - Unknown speed limit: white.
- Smoothly fades between speed colors.
- Left turn signal: the leftmost 6 pixels glow green while the left-turn input is active.
- Right turn signal: the rightmost 6 pixels glow green while the right-turn input is active.
- If phone data stops for 5 seconds, the speed disappears so stale speed is never left frozen.

## Hardware

- ESP32 ESP-WROOM-32 development board.
- 2.0-inch 240x320 ST7789 SPI TFT with GND, VCC, SCL, SDA, RES/RST, DC, CS and BL/BLK.
- 2.54 mm female headers if you want the ESP32 removable.
- Perfboard.

## TFT wiring

| TFT | ESP32 |
| --- | --- |
| GND | GND |
| VCC | 3.3 V |
| SCL | GPIO 18 |
| SDA | GPIO 23 |
| RES/RST | GPIO 17 |
| DC | GPIO 16 |
| CS | GPIO 5 |
| BL/BLK | 3.3 V for initial testing |

The firmware uses GPIO 32 for left-turn logic and GPIO 33 for right-turn logic.

## Arduino libraries

Install:
- Adafruit GFX Library
- Adafruit ST7735 and ST7789 Library

ESP32 BLE support comes with the ESP32 Arduino core.

## Phone connection

RoadLimit sends a compact BLE packet such as:

`54.2,45`

That means 54.2 MPH current speed and a 45 MPH matched speed limit. A limit of `-1` means no reliable posted limit is currently available.

On iPhone, open the HTTPS RoadLimit page in a browser that supports Web Bluetooth, tap **Connect HUD**, choose **RoadLimit HUD**, then tap **Start Driving**.

The phone handles GPS speed, road matching, and speed-limit data. The ESP32 handles HUD rendering and turn-signal display inputs.
