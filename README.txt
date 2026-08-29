ROADLIMIT GO-ALL-OUT PROTOTYPE

Upload index.html, manifest.json and sw.js to a PUBLIC GitHub repository.
Settings -> Pages -> Deploy from branch -> main -> / (root).
Open the GitHub Pages HTTPS URL in Safari on the iPhone, allow Location, then Share -> Add to Home Screen.

Features:
- high accuracy GPS
- position + heading + road continuity matching
- OSM maxspeed plus directional maxspeed tags
- cached nearby road data
- speaks first confirmed limit and confirmed changes
- ~35 MPH estimate when no reliable mapped limit exists
- records GPS points locally
- after Finish, searches OSM for mapped maxspeed signs near the recorded route
- lets you mark mapped signs Verified/Wrong/Skip
- verified signs are stored locally as corrections for future development

Important: this is a prototype. Map data can be missing or wrong. Posted signs and official limits always take priority.

Research note: SCDOT publishes a statewide Speed_Limits FeatureServer, but its public layer currently exposes fields such as route, milepoint and Regulatory rather than a plainly named speed-limit value. It should be decoded before being used as a legal speed source instead of guessing from the Regulatory code.
