# Hardware compatibility gate — ALL physical-TV results UNVERIFIED

Run `npm run fixtures`, then start the server. On each TV open `http://PC-IP:3000/compat`. Generated PNG/MP4 calibration files contain readable TOP, BOTTOM, colored corners and border marks. No login is needed for these synthetic files. Test fixtures are the only public media.

Record model, firmware/webOS, user agent, viewport, mounting direction, network and date separately for TV 1, TV 2 and TV 3. Mark PASS/FAIL with observations; never infer a pass from a desktop browser.

1. Load /compat by LAN IP. If unreachable check private firewall rule, PC sleep and router client isolation.
2. Select 0, Image. Hide panel. All four white border edges must be visible without scrollbars. OK/Enter restores controls.
3. Select Loop MP4. Confirm H.264 picture, repeated 8-second playback, muted initial playback. Try playback by remote if blocked. Check sound separately after enrollment with Unmute.
4. Request fullscreen by remote. Record API success AND actual browser toolbar behavior. Check LG browser's own full-screen menu. Neither is guaranteed. Exit/reopen to check persistence.
5. For each of 0/90/180/270 select both image and MP4. Content rotation is CLOCKWISE relative to native TV coordinates. Physically rotate in the opposite direction (only if mounting/ventilation permits). TOP must point upward and text be readable. 270 is rotation, not mirror. Inspect all corners. Try a portrait photo and portrait video in production with each fit mode.
6. Test CSS video rotation separately. Record black video, clipping, overlay misalignment or ignored transform. Production uses pixel-rotated landscape frames, not this experimental path.
7. With *Keep screen awake* on (Display settings shows the reported mode: wake lock or keep-awake clip), and the TV’s own auto power-off/energy timers disabled, run image-only, video-only and mixed playlists for at least 8 hours; then a 24-hour soak. Record dimming/screensaver timing, heat, memory errors and interruptions. Do not disable OLED safeguards. Rotate content, avoid persistent bright logos, use manufacturer-approved brightness and operating hours.
8. Disconnect Wi-Fi 2 minutes, restore, confirm recovery. Disconnect WAN while retaining LAN: playback and edits must still work. Restart server; verify assignments and tokens survive. Close/relaunch TV browser; power-cycle TV; record whether manual browser reopening is required. Autostart is NOT promised.
9. Run three different 1080p playlists concurrently. Publish normally during a video (switch at end), then Apply immediately. Test next, pause/resume, reload, mute/unmute and command acknowledgments.
10. Test broken media, empty playlists, expired pairing, token revocation and IP change. Verify fallback and recovery; update URL after an IP change. Reserve PC DHCP address to prevent it.

## Result sheet (copy once per TV)
Model / firmware / viewport / mounting / date:

| Check | Result | Evidence / notes |
|---|---|---|
| LAN and offline WAN | UNVERIFIED | |
| MP4 loop / autoplay / audio | UNVERIFIED | |
| Image edges / fit modes | UNVERIFIED | |
| Fullscreen API / browser toolbar | UNVERIFIED | |
| 0 / 90 / 180 / 270 image + video | UNVERIFIED | |
| CSS video experiment | UNVERIFIED | |
| 8h / 24h screensaver and stability | UNVERIFIED | |
| Wi-Fi / server recovery | UNVERIFIED | |
| Relaunch / power cycle | UNVERIFIED | |
| Three simultaneous streams | UNVERIFIED | |

If browser chrome, screensaver or relaunch behavior fails a must-have, evaluate a model-compatible native webOS application (its own deployment/lifecycle constraints require testing), commercial signage display or compatible external player. Browser remains the default; no kiosk guarantee, remote power control or frame synchronization is claimed.

Sources checked: https://webostv.developer.lge.com/develop/specifications/video-audio-260 , https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine , https://webostv.developer.lge.com/faq , https://webostv.developer.lge.com/develop/guides/screensaver , https://www.lg.com/us/support/help-library/lg-tv-how-to-use-the-web-browser--20153257222107 . Native app APIs do not establish permissions available to the built-in browser. The webOS 26 codec list is not a guarantee for older models.
