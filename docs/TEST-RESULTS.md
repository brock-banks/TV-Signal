# Verification record

Executed on the Windows development PC with Node.js 24.15.0.

| Check | Result |
|---|---|
| Dependency installation and lockfile | PASS |
| TypeScript strict check and production React/Express build | PASS |
| Playlist sequencing, looping, empty list and duration bounds | PASS |
| 0/90/180/270 clockwise geometry and fit-before-rotation | PASS |
| Local API integration: admin setup/login, CSRF/cross-origin rejection, pairing, single-use code, screen isolation, revocation | PASS |
| Assignments, input validation, publication, per-entry durations, used-media deletion protection | PASS |
| Actual media decoding validation, invalid upload rejection, prepared file HTTP 206 byte ranges | PASS |
| Heartbeats and command acknowledgments | PASS |
| SQLite close/reopen retains assignments and playlist entries | PASS |
| Real FFmpeg: H.264/AAC normalization, four landscape video rotation variants | PASS |
| Image output dimensions and actual corner-color mapping for all rotations | PASS |
| Animated GIF retains multiple frames after 90° pixel rotation | PASS |
| Chromium smoke: create account, dashboard, upload, playlist, pairing, decoded image playback, reload with stored token, pause acknowledgment, no JS errors | PASS |
| Desktop dashboard screenshot inspected at 1440×1000 | PASS |
| Calibration generation: four 1920×1080 PNGs and four 8-second H.264/AAC MP4 files | PASS |
| Compatibility page: Chromium decodes and plays the 90° 1920×1080 MP4 muted with looping enabled | PASS |
| Production server on 0.0.0.0:3000, first-run readiness, FFmpeg and ffprobe available | PASS |
| Physical LG TVs, codecs on each model, browser toolbar, Fullscreen API, screensaver/dimming, portrait hardware rendering | UNVERIFIED |
| Three simultaneous actual TV streams, Wi-Fi recovery and disconnected WAN on hardware | UNVERIFIED |
| 8-hour/24-hour real-TV soak and power-cycle/browser relaunch | UNVERIFIED |
| Windows firewall rule and startup task on the deployment account | NOT APPLIED — scripts/instructions provided |

The automated suite contains six test cases with multiple assertions, including real media conversion and HTTP server integration. The separate browser smoke script uses Chromium and an isolated temporary database. The initial restricted shell blocked loopback/network access, so integration and browser checks were rerun successfully through the available local runtime. Hardware rows are not inferred from desktop results.

Reproduce with `npm run build`, `npm test`, `npx playwright install chromium`, `npm run test:browser`, `npm run fixtures`. Follow TV-CHECKLIST.md to record model-specific acceptance.
