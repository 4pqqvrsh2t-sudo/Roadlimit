# ESP32 firmware

Flash `Car_HUD.ino` to the ESP32.

## Display wiring

| ST7789 | ESP32 |
| --- | --- |
| GND | GND |
| VCC | 3.3 V |
| SCL | GPIO 18 |
| SDA | GPIO 23 |
| RES / RST | GPIO 17 |
| DC | GPIO 16 |
| CS | GPIO 5 |
| BL / BLK | 3.3 V for initial testing |

The screen is configured as 240x320 and rotated to 320x240 landscape.

## Turn-signal inputs

- GPIO 32 = left turn logic input.
- GPIO 33 = right turn logic input.

These GPIOs must receive safe 3.3 V logic. Do not connect the truck's 12 V lighting wiring directly to the ESP32. Use an automotive-safe isolation/input-conditioning circuit.

The firmware follows the physical pulse:

- left input HIGH -> green strip on left edge.
- right input HIGH -> green strip on right edge.
- both HIGH -> both edges green.

## Arduino libraries

Install:

- Adafruit GFX Library
- Adafruit ST7735 and ST7789 Library

BLE support is provided by the ESP32 Arduino core.

## BLE packet

The phone writes one compact line:

`speed_mph,speed_limit_mph`

Example:

`54.2,45`

If the phone has no reliable speed limit, it sends `-1` for the limit.

If no phone packet arrives for 5 seconds, the displayed speed is replaced with two gray dashes instead of leaving a stale value on the windshield.
