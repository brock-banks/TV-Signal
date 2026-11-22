# Signal — local digital signage

Browser-based signage for three LG webOS TVs, with more screens supported. One Windows PC hosts the dashboard, SQLite database, originals and prepared display media. No cloud runtime, CDN, paid service, casting or store application is required. Internet is needed for installation only.

**Physical LG acceptance is UNVERIFIED.** This repository implements the browser route and a real hardware test procedure; it does not promise kiosk mode, suppression of browser chrome/screensavers, autostart after power-on, remote power control or synchronized video walls. First run [the compatibility checklist](docs/TV-CHECKLIST.md). Day-part schedules are implemented but, like everything else, must be validated on your TVs before unattended use.

## Windows installation

1. Install **Node.js 24 LTS or newer**, with npm, on 64-bit Windows. Keep this project outside a web-served Apache directory if other devices can access Apache: source, `.env` and `data` must not be publicly served. The Node server is the intended server, independent of XAMPP.
2. Run `install.bat` from this folder. It installs locked dependencies, builds the dashboard/server and generates four PNG and four H.264/AAC MP4 calibration files. FFmpeg/ffprobe are npm-managed local binaries; nothing is fetched at runtime. If binary downloads are blocked, provide binaries via `FFMPEG_PATH`/`FFPROBE_PATH` and use the manual setup below.
3. Optionally edit `.env` before first use. Set `DATA_DIR` to a durable local path such as `C:/SignageData` (avoid network shares for SQLite), `PORT=3000`, and `HOST=0.0.0.0`. Changing DATA_DIR later requires stopping the server and moving the entire data directory. The initial setup page reports binary readiness; the help page shows the active path.
4. Run `start.bat`. Open **http://localhost:3000/admin/** on the host PC. Create an administrator password of at least 12 characters. There is no default password, and first-account creation is restricted to loopback.
5. Run `ipconfig`. Find the IPv4 address of the adapter connected to the TVs' router. Configure a DHCP reservation in that router for this PC. Optional `PUBLIC_URL=http://192.168.1.20:3000` controls the dashboard's suggested address.
6. In elevated PowerShell, after confirming your network is Private, allow the port:

```powershell
New-NetFirewallRule -DisplayName "Local Signage TCP 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private -RemoteAddress LocalSubnet
```

Use the selected port if changed. Do not forward it on the router or expose it to the Internet. Keep the PC awake during operating hours. Guest networks or AP isolation can prevent TV access; Ethernet on the PC and Wi-Fi on the TVs is fine on the same LAN.

7. On each TV open `/compat` by the PC's LAN address. Run the checklist before installing screens permanently.
8. In Overview choose **Pair display** for TV 1. On the TV open `http://PC-IP:3000/tv/1` and enter the single-use code within ten minutes. Repeat `/tv/2` and `/tv/3`. Tokens survive a server restart and are stored in the TV browser where supported. Revoking or replacing a token requires pairing again.
9. Upload files to Media library, wait for Ready, create/edit a playlist and Publish. In Display settings assign it to a screen. Repeat with independent playlists or reuse one. Changes require no server restart. Conversion progress is represented as queued/processing/ready/error, not an estimated percent; upload has byte progress.

Manual installation:

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run build
npm.cmd run fixtures
npm.cmd start
```

`npm run fixtures` honors DATA_DIR from the environment; its npm script loads `.env`. Keep fixtures in the active data directory.

## Playback, orientation and operator workflow

- Image durations default to ten seconds and can be edited per entry. Videos play to their natural end; playlists loop. GIF animations remain animated. Reorder by drag-and-drop or arrow buttons; Duplicate adds an independent entry.
- All input videos in MP4 containers are validated with ffprobe and converted to baseline H.264/yuv420p with AAC audio. Non-MP4 containers are rejected with an actionable message. Renamed executable/nonmedia files are rejected by decoding/probing, independent of extension. Originals are stored using UUID filenames, outside static routes.
- Display variants are generated serially and cached on disk. Fit/crop/stretch happens in the intended upright content space first, then pixels are rotated clockwise into the native landscape output. The `<video>` itself is never CSS-rotated. Images follow the same sizing sequence. Horizontal/vertical mirrors are separate settings in the upright content space.
- Rotation 90 means clockwise pixels; mount the physical TV 90 counterclockwise for upright text. Rotation 270 is counterclockwise pixels, not mirroring. Use the arrow/corner calibration patterns to confirm; do not infer direction from ambiguous stand labels.
- Native output defaults to 1920×1080, independently configurable per screen up to 3840×2160 with even dimensions. Portrait logical content is 1080×1920 for the default native frame. Choose dimensions matching the TV browser viewport/aspect ratio. The production element fills the viewport, and fit/crop/padding is baked into the file. Lower resolution is usually preferable for older hardware.
- Normal publications become active at the current image/video boundary. Apply immediately interrupts once all needed variants are ready. Expensive conversion never runs on the TV; it may take minutes on the PC. The existing manifest remains available during preparation. The UI reports failures; retry failed conversions from the media library.
- Commands are queued, delivered through heartbeat polling (SSE requests a prompt poll), then acknowledged as success/failure by the player. Pending commands expire after 60 seconds. “Queued” is not proof of playback. Audio can still require a physical remote gesture.
- Preview shows expected native landscape output in the desktop browser, not live screen capture. Display cards show a **player snapshot**: about every 30 seconds (and shortly after each item starts) the TV browser draws its current image/video frame into a small canvas and uploads it; the server re-encodes it to a bounded JPEG. It shows what the browser player renders, not a camera view of the panel, and older browsers that cannot draw video frames simply send none. On the actual TV append `?diagnostics=1` for diagnostics, or press D with a keyboard. The dashboard also shows the latest heartbeat details. A host browser visiting a TV diagnostics URL must pair separately; it does not inherit the TV's token.

## Protected distribution and activation (moving to another PC)

Customers never receive this source folder. You give them a **protected release**: a self-contained Windows package whose application code and web assets are encrypted, and which only runs on a PC you have activated.

**One-time (you, the vendor)**

```powershell
npm.cmd run license -- init
```

This creates `license-vault/` with your Ed25519 signing key and the master content key. **Back it up offline** (for example an encrypted USB drive). Never commit, email or ship it. It is git-ignored. If you lose it, you cannot issue codes for releases built with it. If it leaks, anyone can make codes and decrypt your releases, so re-run `init --force` and ship a new release.

**Build a release**

```powershell
npm.cmd run release
```

This produces `release/Signal-<version>/` and `release/Signal-<version>-windows-x64.zip` (about 100 MB zipped). The release contains:

- a bundled Node.js runtime, so the customer installs nothing else;
- `app.dat`, the encrypted application (AES-256-GCM);
- `signal.cjs`, the loader, which holds only licensing logic and your public key;
- the sharp and FFmpeg/ffprobe binaries for Windows x64;
- `Setup.cmd`, `start.bat`, `activate.bat`, `status.bat`, `register-startup.ps1` and `INSTALL.txt`.

**Install and activate (customer PC)**

1. Unzip and run `Setup.cmd`. Running it as administrator also offers the private-network firewall rule. It installs to `C:\Signal` by default (or `Setup.cmd D:\Signal`) and shows the PC's **Machine ID**, for example `L9ZQD-BW42Z-EN2SB-2C964`.
2. The customer sends you the Machine ID. You run:

   ```powershell
   npm.cmd run license -- issue --machine L9ZQD-BW42Z-EN2SB-2C964 --customer "Acme Ltd" --days 365 --note "Lobby PC"
   ```

   Leave out `--days`/`--expires YYYY-MM-DD` for no expiry. Every code is logged in `license-vault/issued.csv` and saved under `license-vault/codes/`.
3. The customer starts Signal, opens `http://localhost:3000` on that PC and pastes the code (or runs `activate.bat <code>`). Activation is only accepted from the PC itself. Until then, TVs and other devices see "waiting for activation".

**What the protection does**

- **Locked to one PC:** a code works only on the PC whose Machine ID it was issued for. Copying the install folder, or `license.key`, to another PC shows the activation page again.
- **No readable files:** without a valid code the application cannot start, and its code and web files cannot be read. They exist only encrypted on disk and are decrypted in memory.
- **Only you can make codes:** codes are signed with your private key, so they cannot be forged, and editing one (for example to remove the expiry) breaks its signature.
- **Expiry:** an expiring code switches the server back to the activation page on the expiry date. Setup & help shows who it is licensed to and when it expires.
- **Updates:** reinstalling a newer release into the same folder keeps the activation, `.env` and data. Reinstalling Windows changes the Machine ID, so a new code is needed.

**Limits (stated plainly)**

- Software that has to decrypt itself to run can be extracted by a determined person with administrator access to an activated PC. This stops unauthorised installs, copying to other PCs and casual inspection; it is not protection against expert reverse engineering.
- There is no online revocation, because the system is fully offline. Use expiring codes if you need to be able to stop a site.
- Customer media and settings in `DATA_DIR` are not encrypted.

Release checks: `npm.cmd test` (includes licensing) and `npm.cmd run test:release` (installs the latest release into a temp folder and exercises activation end to end).

## Operator features

- **Live dashboard:** the dashboard keeps a server-sent-events connection (`/api/admin/events`) and refreshes when anything changes (commands acknowledged, uploads converted, displays connecting). Polling continues every 20 s as a fallback, or every 4 s while the stream is down. The sidebar shows whether live updates are connected.
- **Command palette:** <kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>/</kbd>) searches displays, playlists, groups and media and runs actions such as *Pause all displays*, *Pair TV 2* or *Upload media*.
- **Display groups:** create groups (e.g. “Lobby”), choose a display’s group in its settings, then assign a playlist to the whole group or play/pause it from the group header.
- **Day-part schedules:** in a display’s settings, add time slots (days, start/end, playlist). The first matching enabled slot overrides the display’s default playlist; outside every slot the default plays. End before start runs overnight; equal start and end means all day. Times follow the host PC’s clock and time zone, checked every 10 seconds; the switch happens at the next item boundary like a normal publish.
- **Bulk actions:** select media to add to a playlist, retry failed conversions or delete. Overview’s ⋮ menu sends play/pause/next/reload to every online display.
- **Upload queue:** each file uploads separately (two at a time) with its own progress, cancel/retry, and conversion status. The browser warns before closing the tab during an upload.
- **Activity log and alerts:** sign-ins (including failed ones, with source address), pairing/revocation, publishing, uploads/conversions, commands, schedule switches and displays going offline/online are recorded for 90 days. Warnings and errors appear under the bell with an unread count and as a toast; desktop notifications can be enabled where the browser allows them (localhost or HTTPS). The Activity page filters by category and exports CSV.
- **Keep screen awake (per display, on by default):** TV browsers often dim, show a screensaver or sleep when no video is playing, which hits image-only slideshows. The player first asks for a Screen Wake Lock (only allowed on HTTPS or localhost); otherwise it loops a 3 KB silent black H.264 clip in a 2-pixel corner element *only while images are on screen*. During video items the clip is fully unloaded so it never competes with content for the TV’s often single hardware decoder. The dashboard shows the mode the player reports (wake lock, clip, blocked). This cannot override TV-level power timers: on each LG TV also turn off energy-saving “Auto Power Off”/“No signal power off” and similar timers in the TV’s own settings, and validate with the 8-hour image-only soak.
- **Quick preview:** in Media library (or the command palette) play a video or image straight from this computer without uploading it, and simulate how it would look upright on a chosen display (rotation, fit, background, mirroring). *Upload to library* then hands the same file to the upload queue. Playback uses your desktop browser’s codecs; the TV gets the server’s converted file.
- **Confirmations explain consequences:** deleting media or playlists shows where they are used and blocks the action until they are unassigned.

## Architecture

| Module | Responsibility |
|---|---|
| `server/` | Express APIs, hashed password/session auth, single-use pairing, SSE, range-enabled file serving |
| `database/` | Node SQLite, WAL, schema version/migration, seed TV 1–3 |
| `media-processing/` | ffprobe validation, FFmpeg H.264/AAC conversion, Sharp images, serial variant queue |
| `dashboard/` | React/TypeScript/Vite, all assets bundled locally |
| `tv-player/` | Small ES5-style player, XHR, optional EventSource, no framework or transform-dependent video |
| `shared-types/` | Orientation geometry, sequencing and duration helpers |
| `scripts/` | Calibration generation, Windows startup, browser smoke test |
| `tests/` | Geometry/sequencing, API integration/security, media behavior |

Data persists under DATA_DIR: `signage.sqlite` (+ WAL/SHM), `originals`, `normalized`, `thumbs`, `variants`, `fixtures`. No upload folders are served statically. Express `sendFile` streams with range requests, MIME types and private caching. Screen requests authorize each file against prepared screen manifests. Default three 5 Mbps streams need roughly 15 Mbps sustained LAN throughput plus overhead; allow room for uploads and prefetch. Video bitrate is configurable; transcoding is serialized to limit PC load. Variants are disk-cached until media deletion; monitor disk capacity when changing many display configurations.

Player reconnect uses XHR polling and bounded retry backoff plus SSE where available. Media errors/timeouts skip to another entry rather than sticking forever. Browser HTTP cache and one following image preload are best-effort and bounded in application intent; the browser controls actual eviction. No full offline-TV playback guarantee or unlimited Cache Storage is assumed. On plain HTTP LAN addresses Service Workers are often unavailable; the PC must remain reachable for uncached files. WAN connectivity is not required after installation.

## Security and operations

- Passwords use scrypt with random salt. Session and screen tokens are cryptographically random and stored as hashes in SQLite. Sessions expire after 12 hours, with HttpOnly/SameSite=Strict cookies.
- Mutations require a custom request header; cross-origin writes are rejected, no CORS is enabled. Login/pairing/setup are rate-limited. Inputs use schemas and parameterized SQL. Screen APIs cannot mutate playlists or administrator settings. Public access is limited to player assets, first-run readiness and synthetic compatibility fixtures.
- LAN HTTP is not encrypted. A device observing traffic can steal credentials/tokens. Use a trusted isolated LAN; if hostile devices must share it, configure local HTTPS with certificates trusted by the TVs. Do not claim LAN-only is transport security. Tokens appear in media/SSE query strings because older media elements cannot set custom headers; no request-URL logging is enabled, and referrers are suppressed.
- Bundled FFmpeg binaries have their own license obligations. Review the installed binary/package license before redistributing; keep copyright/license notices. Keep dependencies updated and media parsers patched.
- Stop the server before backing up the entire DATA_DIR. Restore it with the same or newer compatible application version. Startup checks `PRAGMA user_version`; schema v1 creates tables and seeds screens only on a new database. Schema v2 (transactional upgrade from v1) adds the activity log, display groups, schedules and snapshot timestamps. Future migrations must be transactional and increment the version; databases from newer versions are rejected rather than overwritten. Player snapshots live in `DATA_DIR/snapshots` and are removed when a display is revoked or deleted.
- Conversion interrupted by restart is marked Error with Retry available. Existing completed files and assignments persist. Player resumes its playlist from the beginning after reload; exact playback position is not persisted. Pending commands expire on restart instead of unexpectedly replaying.
- Logs go to the console with media-processing errors and API failures; player errors appear in the dashboard diagnostics. Logs never include admin passwords or screen tokens.
- To reset a forgotten password, stop the server, back up DATA_DIR, then run `node scripts/reset-admin.mjs` from the project directory. It deletes only the administrator and sessions; create a new password on localhost. Keep filesystem access restricted.

## Start at Windows sign-in

Run `powershell -ExecutionPolicy Bypass -File scripts/register-startup.ps1` in a PowerShell context allowed to register scheduled tasks for your user. The task launches Node directly in the project folder, with a restart policy and no time limit. This is **at user sign-in**, not before Windows sign-in. For unattended boot-before-login, configure a Windows Task Scheduler task using a dedicated service account, “Run whether user is logged on or not,” the same Node executable/arguments and Start in directory, with access to DATA_DIR. Enter credentials through Windows UI, not source files. Do not run two instances on the same port. Unregister with `Unregister-ScheduledTask -TaskName 'Local Digital Signage'`.

## Verification

```powershell
npm.cmd run build
npm.cmd test
npx.cmd playwright install chromium
npm.cmd run test:browser
npm.cmd run test:ui
npm.cmd run test:features
npm.cmd run test:keepawake
```

`test:features` drives a real server, TV player page and browser through live updates, player snapshots, the command palette, schedules, groups, bulk actions, confirmations, the upload queue, alerts and the activity log. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome instead of Playwright's Chromium.

See [TEST-RESULTS.md](docs/TEST-RESULTS.md) for checks actually executed in the implementation environment and [TV-CHECKLIST.md](docs/TV-CHECKLIST.md) for the hardware gate. Browser smoke testing uses an isolated temporary database, not your operational account/media.

## Troubleshooting

| Symptom | Action |
|---|---|
| TV cannot open page | Confirm PC IPv4/port, Node listening on 0.0.0.0, Private firewall rule, same LAN, no guest/client isolation, PC awake |
| Changed PC IP | Reserve DHCP address, reopen the new host URL on TVs; storage is per origin, so pairing may be needed again |
| Black video | Open `/compat`, test 0° H.264 then pre-rotated files; wait for processing Ready; inspect diagnostics; use 1920×1080 or lower, lower bitrate; compare actual TV codec support |
| Upload rejected | Decode-valid JPG/PNG/WebP/GIF or MP4 required, max size configurable; remux/convert other video containers to MP4, then upload |
| Failed conversion | Check disk space, FFmpeg paths and console error; retry in library; unsupported/corrupt streams may need manual repair |
| Autoplay/audio blocked | Start muted, press the displayed start button with remote; unmute only after interaction where allowed |
| Toolbar visible | Try browser fullscreen UI and compatibility Fullscreen API button; if it persists, this model fails true kiosk requirements |
| Screensaver/dimming | Check *Keep screen awake* is on for the display and what mode Display settings reports. “Blocked” means press OK on the remote once. Turn off the TV’s own auto power-off/energy timers. Record timing by content type during the soak; if the TV still sleeps, assess a native app or external player |
| Wi-Fi lost | Current cached media may continue; missing files fall back and retry; restore LAN and inspect heartbeat |
| Display settings slow | Wait for queued variants; repeated full-length video conversions can take time. Existing playback stays active while a new manifest is built |
| Browser closes after power-off | Reopen stable URL manually; browser autostart is not guaranteed |
| OLED retention risk | Avoid static bright logos, rotate content, use recommended brightness/duty cycle; respect manufacturer mounting/heat guidance |

Synchronized video walls and remote power control remain outside this project. Never treat native webOS app API documentation as proof of built-in browser permissions.
