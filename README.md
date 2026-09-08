# RoadLimit

RoadLimit is an iPhone-oriented PWA that displays the best available speed-limit estimate for the road currently being driven.

## Accuracy stack

1. User-verified corrections saved after a drive.
2. Spartanburg County official street-centerline `SpeedLimit` data.
3. SCDOT statewide `Speed_Limits` regulatory road layer.
4. Future ESP32 hardware input.
5. OpenStreetMap `maxspeed`, including direction-specific tags.
6. `~35` only when no reliable speed value is available. The tilde means **estimated/unknown**, not a legal default.

The matcher uses GPS accuracy, road geometry, travel heading, road continuity, and source priority. Poor GPS fixes are held rather than allowed to force a road switch.

## Major improvements in this build

- Queries **all nearby drivable OSM roads**, not only roads that already have `maxspeed`. This fixes a major map-matching blind spot in earlier prototypes.
- Adds the official **Spartanburg County SpeedLimit** street dataset, which includes local/private road geometry, one-way information, ownership, and coded 5–80 MPH values.
- Adds the official statewide **SCDOT Speed Limits** layer as an independent source.
- Queries the three road-data sources in parallel and caches geographic tiles for smooth updates.
- Uses a direction/continuity-aware road matcher instead of a simple nearest-road lookup.
- Filters weak GPS fixes before they can switch roads.
- Uses IndexedDB for road-tile cache and recorded drives.
- Records the route, speed-limit transitions, source, confidence and road identity.
- Interactive post-drive route review with speed-limit transition markers.
- Lets the user confirm or correct detected limits; corrections become the highest-priority source on later drives.
- Searches for OSM-mapped physical maxspeed signs near the completed drive for verification.
- Primes iOS speech on the Start button and debounces announcements.
- Adds an ESP32 protocol/bridge without forcing a hardware transport yet.

## Install on iPhone

This repository is designed for GitHub Pages.

1. GitHub repository → **Settings → Pages**.
2. Deploy from `main`, root folder.
3. Open the HTTPS Pages URL in Safari on the iPhone.
4. Allow precise location while using the site.
5. Safari Share → **Add to Home Screen**.
6. Launch RoadLimit and tap **Start Driving**.

If an old version appears after an update, close and reopen the Home Screen app. The service worker is versioned and uses network-first navigation so new GitHub Pages deployments are picked up instead of being permanently stuck on an old cached HTML file.

## Data and safety

RoadLimit is a prototype. Road databases can be stale or incomplete. A physical regulatory sign can change before any digital source updates. Always follow posted signs and traffic laws.

South Carolina statutory limits are context-dependent; `~35` is intentionally only a user-requested unknown estimate and is not presented as a legal default.

See `ESP32_PROTOCOL.md` for future hardware integration.
