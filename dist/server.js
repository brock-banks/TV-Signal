// server/app.ts
import express from "express";
import multer from "multer";
import crypto2 from "node:crypto";
import fs3 from "node:fs";
import fsp from "node:fs/promises";
import path3 from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { z } from "zod";

// database/db.ts
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// shared-types/core.ts
var defaults = { rotation: 0, fit: "contain", background: "#000000", width: 1920, height: 1080, mirrorX: false, mirrorY: false, keepAwake: true };
function logicalSize(d) {
  return d.rotation === 90 || d.rotation === 270 ? [d.height, d.width] : [d.width, d.height];
}
function rotationFilters(rotation) {
  return rotation === 90 ? ["transpose=clock"] : rotation === 270 ? ["transpose=cclock"] : rotation === 180 ? ["hflip", "vflip"] : [];
}
function videoFilters(d) {
  const [w, h] = logicalSize(d);
  const bg = d.background.replace("#", "0x");
  const size = d.fit === "stretch" ? [`scale=${w}:${h}`] : d.fit === "cover" ? [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`] : [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bg}`];
  return [...size, ...d.mirrorX ? ["hflip"] : [], ...d.mirrorY ? ["vflip"] : [], ...rotationFilters(d.rotation), "setsar=1", "format=yuv420p"].join(",");
}
function activeRule(rules, date) {
  const day = date.getDay(), minute = date.getHours() * 60 + date.getMinutes(), on = (r, d) => (r.days & 1 << d) !== 0;
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.start === r.end) {
      if (on(r, day)) return r;
      continue;
    }
    if (r.start < r.end) {
      if (on(r, day) && minute >= r.start && minute < r.end) return r;
      continue;
    }
    if (on(r, day) && minute >= r.start) return r;
    if (on(r, (day + 6) % 7) && minute < r.end) return r;
  }
  return null;
}

// database/db.ts
var SCHEMA_VERSION = 2;
function openDatabase(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "signage.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error("Database is newer than this application");
  }
  if (version < 1) {
    db.exec(`BEGIN;
 CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK(id=1), password TEXT NOT NULL);
 CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
 CREATE TABLE media (id TEXT PRIMARY KEY, title TEXT NOT NULL, original TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, duration REAL DEFAULT 0, animated INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, created INTEGER NOT NULL);
 CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE entries (playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE, position INTEGER, media_id TEXT REFERENCES media(id), duration REAL NOT NULL DEFAULT 10, PRIMARY KEY(playlist_id,position));
 CREATE TABLE screens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL, config TEXT NOT NULL, token_hash TEXT, pair_hash TEXT, pair_expires INTEGER, last_seen INTEGER, current_media TEXT, diagnostics TEXT, revision INTEGER NOT NULL DEFAULT 1, immediate INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE commands (id INTEGER PRIMARY KEY AUTOINCREMENT, screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE, action TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT);
 PRAGMA user_version=1; COMMIT;`);
    const seed = db.prepare("INSERT INTO screens(name,config) VALUES (?,?)");
    for (let i = 1; i <= 3; i++) seed.run("TV " + i, JSON.stringify(defaults));
  }
  if (db.prepare("PRAGMA user_version").get().user_version < 2) {
    db.exec("BEGIN");
    try {
      db.exec(`
   CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, level TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, screen_id INTEGER);
   CREATE INDEX activity_time ON activity(time);
   CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL);
   ALTER TABLE screens ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL;
   ALTER TABLE screens ADD COLUMN snapshot_at INTEGER;
   CREATE TABLE schedules (id TEXT PRIMARY KEY, screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE, position INTEGER NOT NULL, playlist_id TEXT NOT NULL REFERENCES playlists(id), days INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
   CREATE INDEX schedules_screen ON schedules(screen_id,position);
   PRAGMA user_version=2;`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  db.prepare("UPDATE media SET status='error', error='Processing interrupted by server restart. Retry conversion.' WHERE status='processing'").run();
  db.prepare("UPDATE commands SET status='expired',result='Server restarted before acknowledgment' WHERE status='pending'").run();
  return db;
}

// media-processing/library.ts
import fs2 from "node:fs/promises";
import path2 from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

// media-processing/process.ts
import { spawn } from "node:child_process";
import ffmpegBinary from "ffmpeg-static";
import ffprobeBinary from "ffprobe-static";
var ffmpeg = process.env.FFMPEG_PATH || ffmpegBinary;
var ffprobe = process.env.FFPROBE_PATH || ffprobeBinary.path;
function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Media processing exceeded 30 minutes"));
    }, 18e5);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.length > 4e6) child.kill();
    });
    child.stderr.on("data", (d) => {
      err = (err + d.toString()).slice(-6e3);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(err || "Media processor failed"));
    });
  });
}

// media-processing/library.ts
sharp.cache({ files: 0 });
var MediaProcessor = class {
  constructor(dir) {
    this.dir = dir;
  }
  tail = Promise.resolve();
  tasks = /* @__PURE__ */ new Map();
  queue(task) {
    const p = this.tail.then(task, task);
    this.tail = p.catch(() => {
    });
    return p;
  }
  async inspect(file) {
    try {
      const m = await sharp(file, { animated: true, limitInputPixels: 1e8 }).metadata();
      if (!["jpeg", "png", "webp", "gif"].includes(m.format || "")) throw new Error("Unsupported image");
      await sharp(file).resize(1, 1).toBuffer();
      return { kind: "image", width: m.width, height: m.pageHeight || m.height, duration: 0, animated: Number((m.pages || 1) > 1) };
    } catch {
    }
    const p = JSON.parse(await run(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]));
    const v = p.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
    if (!v || !p.format?.format_name?.split(",").includes("mp4") || !v.width || !v.height) throw new Error("Use JPG, PNG, WebP, GIF or an MP4 video. Other containers must be converted to MP4 first.");
    const duration = Number(p.format.duration);
    if (!Number.isFinite(duration) || duration <= 0 || v.width * v.height > 34e6) throw new Error("Invalid duration or excessive video dimensions");
    return { kind: "video", width: v.width, height: v.height, duration, animated: 0 };
  }
  async normalize(m) {
    const input = path2.join(this.dir, "originals", m.file);
    if (m.kind === "video") {
      await run(ffmpeg, ["-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-maxrate", process.env.VIDEO_BITRATE || "5000k", "-bufsize", "10000k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", path2.join(this.dir, "normalized", m.id + ".mp4")]);
      await run(ffmpeg, ["-y", "-i", path2.join(this.dir, "normalized", m.id + ".mp4"), "-frames:v", "1", "-vf", "scale=480:-2", path2.join(this.dir, "thumbs", m.id + ".jpg")]);
    } else await sharp(input).rotate().resize(480, 300, { fit: "inside" }).jpeg().toFile(path2.join(this.dir, "thumbs", m.id + ".jpg"));
  }
  // Only visual settings shape a variant; behavioural flags (keepAwake) must not invalidate the cache.
  key(m, d) {
    const { keepAwake: _ignored, ...visual } = d;
    return m.id + "-" + crypto.createHash("sha256").update(JSON.stringify(visual)).digest("hex").slice(0, 20) + (m.kind === "video" ? ".mp4" : m.animated ? ".gif" : ".jpg");
  }
  async variant(m, d) {
    const key = this.key(m, d), dest = path2.join(this.dir, "variants", key);
    try {
      await fs2.access(dest);
      return key;
    } catch {
    }
    if (this.tasks.has(key)) return this.tasks.get(key);
    const task = this.queue(async () => {
      const temp = dest + ".tmp" + path2.extname(dest);
      try {
        if (m.kind === "video") await run(ffmpeg, ["-y", "-i", path2.join(this.dir, "normalized", m.id + ".mp4"), "-vf", videoFilters(d), "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-maxrate", process.env.VIDEO_BITRATE || "5000k", "-bufsize", "10000k", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", temp]);
        else if (m.animated) {
          await run(ffmpeg, ["-y", "-i", path2.join(this.dir, "originals", m.file), "-vf", videoFilters(d), "-loop", "0", temp]);
        } else {
          const [w, h] = logicalSize(d);
          const input = path2.join(this.dir, "originals", m.file);
          const fitted = await sharp(input, { animated: true, limitInputPixels: 1e8 }).autoOrient().resize(w, h, { fit: d.fit === "stretch" ? "fill" : d.fit, background: d.background }).toBuffer();
          let img = sharp(fitted, { animated: true });
          if (d.mirrorX) img = img.flop();
          if (d.mirrorY) img = img.flip();
          await img.rotate(d.rotation, { background: d.background }).flatten({ background: d.background }).jpeg({ quality: 92 }).toFile(temp);
        }
        await fs2.rename(temp, dest);
        return key;
      } catch (e) {
        await fs2.rm(temp, { force: true });
        throw e;
      } finally {
        this.tasks.delete(key);
      }
    });
    this.tasks.set(key, task);
    return task;
  }
};

// server/app.ts
import sharp2 from "sharp";
var hash = (s) => crypto2.createHash("sha256").update(s).digest("hex");
var token = () => crypto2.randomBytes(32).toString("hex");
var scrypt = promisify(crypto2.scrypt);
var title = z.string().trim().min(1).max(120);
var display = z.object({ rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), fit: z.enum(["cover", "contain", "stretch"]), background: z.string().regex(/^#[0-9a-fA-F]{6}$/), width: z.number().int().min(320).max(3840).multipleOf(2), height: z.number().int().min(240).max(2160).multipleOf(2), mirrorX: z.boolean(), mirrorY: z.boolean(), keepAwake: z.boolean().default(true) });
function createApp(options = {}) {
  const root = options.root || process.cwd(), dir = path3.resolve(options.dataDir || process.env.DATA_DIR || "data");
  for (const folder of ["originals", "normalized", "thumbs", "variants", "fixtures", "tmp", "snapshots"]) fs3.mkdirSync(path3.join(dir, folder), { recursive: true });
  const db = openDatabase(dir), processor = new MediaProcessor(dir), app = express();
  const allowedHosts = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", os.hostname().toLowerCase(), ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map((x) => x.address.toLowerCase())]);
  if (process.env.PUBLIC_URL) allowedHosts.add(new URL(process.env.PUBLIC_URL).hostname.toLowerCase());
  const events = /* @__PURE__ */ new Map(), builds = /* @__PURE__ */ new Map(), prepared = /* @__PURE__ */ new Map(), previous = /* @__PURE__ */ new Map(), errors = /* @__PURE__ */ new Map();
  const row = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const mutate = (sql, ...args) => db.prepare(sql).run(...args);
  const adminClients = /* @__PURE__ */ new Set();
  let adminTimer = null;
  const notifyAdmins = () => {
    if (adminTimer) return;
    adminTimer = setTimeout(() => {
      adminTimer = null;
      for (const r of adminClients) r.write("data: state\n\n");
    }, 200);
    adminTimer.unref?.();
  };
  const notify = (id) => {
    for (const [screen, clients] of events) if (!id || id === screen) for (const res of clients) res.write("data: update\n\n");
    notifyAdmins();
  };
  const log = (level, kind, message, screenId = null) => {
    mutate("INSERT INTO activity(time,level,kind,message,screen_id) VALUES(?,?,?,?,?)", Date.now(), level, kind, message.slice(0, 300), screenId);
    notifyAdmins();
  };
  const screenName = (id) => row("SELECT name FROM screens WHERE id=?", id)?.name || "Display " + id;
  const playlistName = (id) => id ? row("SELECT name FROM playlists WHERE id=?", id)?.name || "a playlist" : "no playlist";
  const quote = (v) => "\u201C" + v + "\u201D";
  const wasOnline = /* @__PURE__ */ new Map(), lastEffective = /* @__PURE__ */ new Map();
  function admin(req) {
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)signage=([a-f0-9]{64})(?:;|$)/)?.[1];
    return !!cookie && !!row("SELECT hash FROM sessions WHERE hash=? AND expires>?", hash(cookie), Date.now());
  }
  function requireAdmin(req, res, next) {
    if (!admin(req)) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    next();
  }
  function screenAuth(req) {
    const id = Number(req.params.id), value = req.header("X-Screen-Token") || String(req.query.token || "");
    const s = row("SELECT * FROM screens WHERE id=?", id);
    return s && value && s.token_hash === hash(value) ? s : null;
  }
  function requireScreen(req, res, next) {
    const s = screenAuth(req);
    if (!s) {
      res.status(401).json({ error: "Screen is not paired. Pair again from the dashboard." });
      return;
    }
    req.screen = s;
    next();
  }
  const attempts = /* @__PURE__ */ new Map();
  function limit(req, res, next) {
    const key = req.ip + req.path, now = Date.now();
    let a = attempts.get(key);
    if (!a || a.until < now) {
      a = { n: 0, until: now + 6e4 };
      attempts.set(key, a);
    }
    if (++a.n > 15) {
      res.status(429).json({ error: "Too many attempts; wait one minute" });
      return;
    }
    next();
  }
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!allowedHosts.has(req.hostname.replace(/^\[|\]$/g, "").toLowerCase())) {
      res.status(403).json({ error: "Unrecognized host. Use the PC LAN IP or configured PUBLIC_URL." });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== req.headers.host) {
            res.status(403).json({ error: "Cross-origin writes are forbidden" });
            return;
          }
        } catch {
          res.status(403).end();
          return;
        }
      }
      if (req.header("X-Signage-Request") !== "1") {
        res.status(403).json({ error: "Required request header missing" });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/setup", (_req, res) => res.json({ needsSetup: !row("SELECT id FROM admin"), ffmpeg: fs3.existsSync(ffmpeg), ffprobe: fs3.existsSync(ffprobe) }));
  app.post("/api/setup", limit, async (req, res) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "")) {
      res.status(403).json({ error: "Create the first administrator on the host PC at localhost" });
      return;
    }
    const password = z.string().min(12).max(200).parse(req.body.password), salt = token();
    const key = await scrypt(password, salt, 64);
    if (row("SELECT id FROM admin")) {
      res.status(409).json({ error: "Setup already completed" });
      return;
    }
    mutate("INSERT INTO admin(id,password) VALUES(1,?)", salt + ":" + key.toString("hex"));
    res.json({ ok: true });
  });
  app.post("/api/login", limit, async (req, res) => {
    const password = z.string().max(200).parse(req.body.password), a = row("SELECT password FROM admin");
    const [salt, saved] = (a?.password || token() + ":" + "00".repeat(64)).split(":");
    const check = await scrypt(password, salt, 64);
    if (!a || !crypto2.timingSafeEqual(check, Buffer.from(saved, "hex"))) {
      if (a) log("warning", "security", "Failed sign-in attempt from " + (req.ip || "unknown address"));
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    const sid = token();
    mutate("INSERT INTO sessions VALUES (?,?)", hash(sid), Date.now() + 12 * 36e5);
    res.cookie("signage", sid, { httpOnly: true, sameSite: "strict", maxAge: 12 * 36e5, path: "/" });
    log("info", "security", "Administrator signed in from " + (req.ip || "unknown address"));
    res.json({ ok: true });
  });
  app.post("/api/logout", requireAdmin, (req, res) => {
    const sid = req.headers.cookie?.match(/signage=([a-f0-9]{64})/)?.[1];
    if (sid) mutate("DELETE FROM sessions WHERE hash=?", hash(sid));
    res.clearCookie("signage");
    res.json({ ok: true });
  });
  function getEntries(id) {
    return all("SELECT media_id as mediaId,duration FROM entries WHERE playlist_id=? ORDER BY position", id);
  }
  function rulesFor(id) {
    return all("SELECT id,playlist_id as playlistId,days,start,end,enabled FROM schedules WHERE screen_id=? ORDER BY position", id).map((r) => ({ ...r, enabled: !!r.enabled }));
  }
  function effective(s) {
    const rule = activeRule(rulesFor(s.id), /* @__PURE__ */ new Date());
    return { playlistId: rule ? rule.playlistId : s.playlist_id, rule };
  }
  function desired(s) {
    const e = effective(s);
    const p = e.playlistId ? row("SELECT * FROM playlists WHERE id=?", e.playlistId) : null;
    return s.revision + ":" + (e.playlistId || "-") + ":" + (p?.revision || 0);
  }
  function prepare(id) {
    if (builds.has(id)) return builds.get(id);
    const s = row("SELECT * FROM screens WHERE id=?", id);
    if (!s) return Promise.resolve(null);
    const revision = desired(s);
    if (prepared.get(id)?.revision === revision) return Promise.resolve(prepared.get(id));
    const job = Promise.resolve().then(async () => {
      try {
        const config = JSON.parse(s.config), eff = effective(s), entries = eff.playlistId ? getEntries(eff.playlistId) : [], items = [];
        for (const entry of entries) {
          const m = row("SELECT * FROM media WHERE id=?", entry.mediaId);
          if (m?.status === "ready") {
            const file = await processor.variant(m, config);
            items.push({ mediaId: m.id, title: m.title, kind: m.kind, duration: entry.duration, videoDuration: m.duration, file });
          }
        }
        const latest = row("SELECT * FROM screens WHERE id=?", id);
        if (!latest || desired(latest) !== revision) return null;
        const manifest = { id, name: s.name, revision, immediate: !!s.immediate, config, items };
        if (prepared.has(id)) previous.set(id, { manifest: prepared.get(id), until: Date.now() + 24 * 36e5 });
        prepared.set(id, manifest);
        errors.delete(id);
        notify(id);
        return manifest;
      } catch (e) {
        errors.set(id, e.message);
        console.error("Screen preparation", id, e.message);
        return null;
      } finally {
        builds.delete(id);
      }
    });
    builds.set(id, job);
    return job;
  }
  function prepareAll() {
    for (const s of all("SELECT id FROM screens")) void prepare(s.id);
  }
  function screens() {
    return all("SELECT * FROM screens").map((s) => ({ id: s.id, name: s.name, playlistId: s.playlist_id, config: JSON.parse(s.config), paired: !!s.token_hash, lastSeen: s.last_seen, online: !!s.last_seen && Date.now() - s.last_seen < 45e3, currentMedia: s.current_media, diagnostics: s.diagnostics ? JSON.parse(s.diagnostics) : null, preparing: builds.has(s.id), error: errors.get(s.id), groupId: s.group_id, snapshotAt: s.snapshot_at, schedules: rulesFor(s.id), ...((e) => ({ activePlaylistId: e.playlistId, activeScheduleId: e.rule?.id || null }))(effective(s)), commands: all("SELECT id,action,status,result,created FROM commands WHERE screen_id=? ORDER BY id DESC LIMIT 6", s.id) }));
  }
  app.get("/api/admin/state", requireAdmin, (_req, res) => {
    const port2 = process.env.PORT || "3000";
    const urls = Object.values(os.networkInterfaces()).flat().filter((x) => x?.family === "IPv4" && !x.internal).map((x) => `http://${x.address}:${port2}`);
    res.json({ screens: screens(), media: all("SELECT * FROM media ORDER BY created DESC").map(({ file, ...m }) => m), playlists: all("SELECT * FROM playlists").map((p) => ({ ...p, entries: getEntries(p.id) })), groups: all("SELECT * FROM groups ORDER BY name"), urls: process.env.PUBLIC_URL ? [process.env.PUBLIC_URL] : urls, dataDir: dir, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, uploadLimitMB: Number(process.env.MAX_UPLOAD_MB || 1024) });
  });
  app.post("/api/admin/screens", requireAdmin, (req, res) => {
    const name = title.parse(req.body.name);
    const r = mutate("INSERT INTO screens(name,config) VALUES(?,?)", name, JSON.stringify(defaults));
    log("info", "display", "Display " + quote(name) + " added", Number(r.lastInsertRowid));
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put("/api/admin/screens/:id", requireAdmin, (req, res) => {
    const body = z.object({ name: title, playlistId: z.string().nullable(), config: display, immediate: z.boolean().default(false), groupId: z.string().nullable().optional() }).parse(req.body), id = Number(req.params.id), before = row("SELECT * FROM screens WHERE id=?", id);
    if (body.groupId && !row("SELECT id FROM groups WHERE id=?", body.groupId)) {
      res.status(400).json({ error: "Group does not exist" });
      return;
    }
    if (body.playlistId && !row("SELECT id FROM playlists WHERE id=?", body.playlistId)) {
      res.status(400).json({ error: "Playlist does not exist" });
      return;
    }
    const r = mutate("UPDATE screens SET name=?,playlist_id=?,config=?,revision=revision+1,immediate=? WHERE id=?", body.name, body.playlistId, JSON.stringify(body.config), +body.immediate, id);
    if (!r.changes) {
      res.status(404).json({ error: "Screen not found" });
      return;
    }
    if (body.groupId !== void 0) mutate("UPDATE screens SET group_id=? WHERE id=?", body.groupId, id);
    if (before.playlist_id !== body.playlistId) log("info", "playlist", body.name + " now uses " + (body.playlistId ? quote(playlistName(body.playlistId)) : "no playlist"), id);
    if (before.name !== body.name) log("info", "display", "Display " + quote(before.name) + " renamed to " + quote(body.name), id);
    if (before.config !== JSON.stringify(body.config)) log("info", "display", "Display settings changed for " + body.name, id);
    void prepare(Number(req.params.id));
    notify(Number(req.params.id));
    res.json({ ok: true, message: "Saved. Media variants are prepared before player update." });
  });
  app.delete("/api/admin/screens/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id), name = screenName(id);
    mutate("DELETE FROM screens WHERE id=?", id);
    void fsp.rm(path3.join(dir, "snapshots", id + ".jpg"), { force: true });
    wasOnline.delete(id);
    log("warning", "display", "Display " + quote(name) + " removed");
    prepared.delete(id);
    notify(id);
    for (const client of events.get(id) || []) client.end();
    events.delete(id);
    res.json({ ok: true });
  });
  app.post("/api/admin/screens/:id/pair", requireAdmin, (req, res) => {
    const code = crypto2.randomBytes(5).toString("hex").toUpperCase(), expires = Date.now() + 10 * 6e4;
    mutate("UPDATE screens SET pair_hash=?,pair_expires=? WHERE id=?", hash(code), expires, Number(req.params.id));
    log("info", "security", "Pairing code created for " + screenName(Number(req.params.id)), Number(req.params.id));
    res.json({ code, expires });
  });
  app.post("/api/admin/screens/:id/revoke", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    mutate("UPDATE screens SET token_hash=NULL,pair_hash=NULL,last_seen=NULL,snapshot_at=NULL WHERE id=?", id);
    void fsp.rm(path3.join(dir, "snapshots", id + ".jpg"), { force: true });
    wasOnline.set(id, false);
    log("warning", "security", "Access revoked for " + screenName(id), id);
    notify(id);
    for (const client of events.get(id) || []) client.end();
    events.delete(id);
    res.json({ ok: true });
  });
  app.post("/api/screens/:id/pair", limit, (req, res) => {
    const code = z.string().max(20).parse(req.body.code).trim().toUpperCase(), id = Number(req.params.id);
    const s = row("SELECT * FROM screens WHERE id=? AND pair_hash=? AND pair_expires>?", id, hash(code), Date.now());
    if (!s) {
      res.status(403).json({ error: "Invalid or expired code" });
      return;
    }
    const value = token();
    mutate("UPDATE screens SET token_hash=?,pair_hash=NULL,pair_expires=NULL WHERE id=?", hash(value), id);
    log("success", "security", s.name + " paired", id);
    for (const client of events.get(id) || []) client.end();
    events.delete(id);
    res.json({ token: value });
  });
  app.post("/api/admin/playlists", requireAdmin, (req, res) => {
    const id = crypto2.randomUUID(), name = title.parse(req.body.name);
    mutate("INSERT INTO playlists(id,name) VALUES (?,?)", id, name);
    log("info", "playlist", "Playlist " + quote(name) + " created");
    res.json({ id });
  });
  app.put("/api/admin/playlists/:id", requireAdmin, (req, res) => {
    const p = z.object({ name: title, entries: z.array(z.object({ mediaId: z.string(), duration: z.number().min(1).max(86400) })).max(1e3), immediate: z.boolean().default(false) }).parse(req.body), id = String(req.params.id);
    if (!row("SELECT id FROM playlists WHERE id=?", id)) {
      res.status(404).json({ error: "Playlist not found" });
      return;
    }
    if (p.entries.some((e) => !row("SELECT id FROM media WHERE id=? AND status='ready'", e.mediaId))) {
      res.status(400).json({ error: "Every item must finish processing before publishing" });
      return;
    }
    db.exec("BEGIN");
    try {
      mutate("UPDATE playlists SET name=?,revision=revision+1 WHERE id=?", p.name, id);
      mutate("DELETE FROM entries WHERE playlist_id=?", id);
      p.entries.forEach((e, i) => mutate("INSERT INTO entries VALUES(?,?,?,?)", id, i, e.mediaId, e.duration));
      mutate("UPDATE screens SET immediate=? WHERE playlist_id=?", +p.immediate, id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    prepareAll();
    notify();
    log("success", "playlist", "Playlist " + quote(p.name) + " published (" + p.entries.length + " item" + (p.entries.length === 1 ? "" : "s") + ")");
    res.json({ ok: true });
  });
  app.delete("/api/admin/playlists/:id", requireAdmin, (req, res) => {
    const id = String(req.params.id);
    if (row("SELECT id FROM screens WHERE playlist_id=?", id)) {
      res.status(409).json({ error: "Unassign this playlist from all screens first" });
      return;
    }
    if (row("SELECT id FROM schedules WHERE playlist_id=?", id)) {
      res.status(409).json({ error: "Remove this playlist from display schedules first" });
      return;
    }
    const name = playlistName(id);
    mutate("DELETE FROM playlists WHERE id=?", id);
    log("warning", "playlist", "Playlist " + quote(name) + " deleted");
    res.json({ ok: true });
  });
  const upload = multer({ dest: path3.join(dir, "tmp"), limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 1024) * 1024 * 1024, files: 20 } });
  async function processMedia(id) {
    const m = row("SELECT * FROM media WHERE id=?", id);
    try {
      await processor.normalize(m);
      mutate("UPDATE media SET status='ready',error=NULL WHERE id=?", id);
      log("success", "content", quote(m.title) + " is ready");
      prepareAll();
    } catch (e) {
      mutate("UPDATE media SET status='error',error=? WHERE id=?", "Conversion failed: " + e.message, id);
      log("error", "content", "Conversion failed for " + quote(m.title) + ": " + e.message);
    }
  }
  app.post("/api/admin/media", requireAdmin, upload.array("files", 20), async (req, res) => {
    const results = [];
    for (const f of req.files) {
      const id = crypto2.randomUUID(), file = id + ".bin";
      try {
        const info = await processor.inspect(f.path);
        await fsp.rename(f.path, path3.join(dir, "originals", file));
        mutate("INSERT INTO media(id,title,original,kind,file,size,width,height,duration,animated,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, f.originalname.slice(0, 120), f.originalname.slice(0, 240), info.kind, file, f.size, info.width, info.height, info.duration, info.animated, "processing", Date.now());
        log("info", "content", quote(f.originalname.slice(0, 120)) + " uploaded");
        void processor.queue(() => processMedia(id));
        results.push({ id, name: f.originalname, status: "processing" });
      } catch (e) {
        await fsp.rm(f.path, { force: true });
        results.push({ name: f.originalname, error: e.message });
      }
    }
    res.json({ results });
  });
  app.post("/api/admin/media/:id/retry", requireAdmin, (req, res) => {
    const id = String(req.params.id);
    const m = row("SELECT * FROM media WHERE id=?", id);
    if (!m || m.status !== "error") {
      res.status(409).json({ error: "Only failed conversions can be retried" });
      return;
    }
    mutate("UPDATE media SET status='processing',error=NULL WHERE id=?", id);
    log("info", "content", "Retrying conversion of " + quote(m.title));
    void processor.queue(() => processMedia(id));
    res.json({ ok: true });
  });
  app.patch("/api/admin/media/:id", requireAdmin, (req, res) => {
    mutate("UPDATE media SET title=? WHERE id=?", title.parse(req.body.title), String(req.params.id));
    notifyAdmins();
    res.json({ ok: true });
  });
  app.delete("/api/admin/media/:id", requireAdmin, async (req, res) => {
    const id = String(req.params.id), m = row("SELECT * FROM media WHERE id=?", id);
    if (!m) {
      res.status(404).end();
      return;
    }
    if (m.status === "processing" || row("SELECT media_id FROM entries WHERE media_id=?", id)) {
      res.status(409).json({ error: "Remove this media from all playlists and wait for processing before deleting" });
      return;
    }
    mutate("DELETE FROM media WHERE id=?", id);
    log("warning", "content", quote(m.title) + " deleted");
    await fsp.rm(path3.join(dir, "originals", m.file), { force: true });
    for (const folder of ["normalized", "thumbs", "variants"]) for (const file of await fsp.readdir(path3.join(dir, folder))) if (file.startsWith(id)) await fsp.rm(path3.join(dir, folder, file), { force: true });
    res.json({ ok: true });
  });
  app.get("/api/admin/media/:id/thumbnail", requireAdmin, (req, res) => {
    const m = row("SELECT id FROM media WHERE id=?", String(req.params.id));
    if (!m) {
      res.status(404).end();
      return;
    }
    res.sendFile(path3.join(dir, "thumbs", m.id + ".jpg"));
  });
  app.get("/api/admin/media/:id/preview", requireAdmin, (req, res) => {
    const m = row("SELECT * FROM media WHERE id=?", String(req.params.id));
    if (!m || m.status !== "ready") {
      res.status(404).end();
      return;
    }
    res.sendFile(path3.join(dir, m.kind === "video" ? "normalized" : "originals", m.kind === "video" ? m.id + ".mp4" : m.file));
  });
  app.post("/api/admin/screens/:id/commands", requireAdmin, (req, res) => {
    const action = z.enum(["play", "pause", "next", "reload", "mute", "unmute"]).parse(req.body.action);
    if (!row("SELECT id FROM screens WHERE id=?", Number(req.params.id))) {
      res.status(404).end();
      return;
    }
    const r = mutate("INSERT INTO commands(screen_id,action,created) VALUES(?,?,?)", Number(req.params.id), action, Date.now());
    log("info", "command", action[0].toUpperCase() + action.slice(1) + " sent to " + screenName(Number(req.params.id)), Number(req.params.id));
    notify(Number(req.params.id));
    res.json({ id: Number(r.lastInsertRowid), status: "pending", message: "Queued; delivery is confirmed by the player acknowledgment." });
  });
  app.get("/api/screens/:id/manifest", requireScreen, (req, res) => {
    const id = Number(req.params.id);
    void prepare(id);
    const manifest = prepared.get(id);
    res.json(manifest || { id, revision: "pending", items: [], preparing: builds.has(id), error: errors.get(id), config: JSON.parse(req.screen.config) });
  });
  app.post("/api/screens/:id/heartbeat", requireScreen, (req, res) => {
    const b = z.object({ currentMedia: z.string().max(100).nullable().optional(), userAgent: z.string().max(1e3).optional(), viewport: z.string().max(40).optional(), errors: z.array(z.string().max(500)).max(15).optional(), state: z.string().max(100).optional(), muted: z.boolean().optional(), awake: z.string().max(40).optional(), ack: z.array(z.object({ id: z.number().int(), ok: z.boolean(), message: z.string().max(300) })).max(30).optional() }).parse(req.body), id = Number(req.params.id);
    const prev = req.screen, prevDiag = prev.diagnostics ? JSON.parse(prev.diagnostics) : {};
    mutate("UPDATE screens SET last_seen=?,current_media=?,diagnostics=? WHERE id=?", Date.now(), b.currentMedia || null, JSON.stringify({ ...b, ack: void 0 }), id);
    if (wasOnline.get(id) === false) log("success", "display", prev.name + " is back online", id);
    wasOnline.set(id, true);
    if (prev.current_media !== (b.currentMedia || null) || prevDiag.state !== b.state || prevDiag.muted !== b.muted || (b.ack || []).length) notifyAdmins();
    for (const ack of b.ack || []) {
      const r = mutate("UPDATE commands SET status=?,result=? WHERE id=? AND screen_id=? AND status='pending'", ack.ok ? "success" : "failed", ack.message, ack.id, id);
      if (r.changes && !ack.ok) log("warning", "command", prev.name + " could not run a command: " + ack.message, id);
    }
    mutate("UPDATE commands SET status='expired',result='No acknowledgment within 60 seconds' WHERE screen_id=? AND status='pending' AND created<?", id, Date.now() - 6e4);
    res.json({ commands: all("SELECT id,action FROM commands WHERE screen_id=? AND status='pending' ORDER BY id", id) });
  });
  app.get("/api/screens/:id/events", requireScreen, (req, res) => {
    const id = Number(req.params.id);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders();
    res.write("data: connected\n\n");
    if (!events.has(id)) events.set(id, /* @__PURE__ */ new Set());
    events.get(id).add(res);
    const timer = setInterval(() => res.write(": keepalive\n\n"), 15e3);
    req.on("close", () => {
      clearInterval(timer);
      events.get(id)?.delete(res);
    });
  });
  app.post("/api/screens/:id/snapshot", requireScreen, async (req, res) => {
    const b = z.object({ image: z.string().max(7e5).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/) }).parse(req.body), id = Number(req.params.id), s = req.screen;
    if (s.snapshot_at && Date.now() - s.snapshot_at < 5e3) {
      res.status(429).json({ error: "Snapshots are limited to one every 5 seconds" });
      return;
    }
    try {
      await sharp2(Buffer.from(b.image.slice(b.image.indexOf(",") + 1), "base64"), { limitInputPixels: 3840 * 2160 }).resize(480, 480, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toFile(path3.join(dir, "snapshots", id + ".jpg"));
    } catch {
      res.status(400).json({ error: "Invalid snapshot image" });
      return;
    }
    mutate("UPDATE screens SET snapshot_at=? WHERE id=?", Date.now(), id);
    notifyAdmins();
    res.json({ ok: true });
  });
  app.get("/api/admin/screens/:id/snapshot", requireAdmin, (req, res) => {
    const id = Number(req.params.id), s = row("SELECT snapshot_at FROM screens WHERE id=?", id), file = path3.join(dir, "snapshots", id + ".jpg");
    if (!s?.snapshot_at || !fs3.existsSync(file)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "private, no-cache");
    res.sendFile(file);
  });
  app.post("/api/admin/groups", requireAdmin, (req, res) => {
    const id = crypto2.randomUUID(), name = title.parse(req.body.name);
    mutate("INSERT INTO groups(id,name) VALUES(?,?)", id, name);
    log("info", "display", "Group " + quote(name) + " created");
    res.json({ id });
  });
  app.patch("/api/admin/groups/:id", requireAdmin, (req, res) => {
    const name = title.parse(req.body.name), r = mutate("UPDATE groups SET name=? WHERE id=?", name, String(req.params.id));
    if (!r.changes) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    notifyAdmins();
    res.json({ ok: true });
  });
  app.delete("/api/admin/groups/:id", requireAdmin, (req, res) => {
    const g = row("SELECT * FROM groups WHERE id=?", String(req.params.id));
    if (!g) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    mutate("UPDATE screens SET group_id=NULL WHERE group_id=?", g.id);
    mutate("DELETE FROM groups WHERE id=?", g.id);
    log("warning", "display", "Group " + quote(g.name) + " deleted; its displays are now ungrouped");
    res.json({ ok: true });
  });
  app.post("/api/admin/groups/:id/assign", requireAdmin, (req, res) => {
    const playlistId = z.object({ playlistId: z.string().nullable() }).parse(req.body).playlistId, g = row("SELECT * FROM groups WHERE id=?", String(req.params.id));
    if (!g) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    if (playlistId && !row("SELECT id FROM playlists WHERE id=?", playlistId)) {
      res.status(400).json({ error: "Playlist does not exist" });
      return;
    }
    const ids = all("SELECT id FROM screens WHERE group_id=?", g.id).map((s) => s.id);
    mutate("UPDATE screens SET playlist_id=?,revision=revision+1,immediate=0 WHERE group_id=?", playlistId, g.id);
    ids.forEach((id) => void prepare(id));
    notify();
    log("info", "playlist", "Group " + quote(g.name) + " (" + ids.length + " display" + (ids.length === 1 ? "" : "s") + ") now uses " + (playlistId ? quote(playlistName(playlistId)) : "no playlist"));
    res.json({ ok: true, count: ids.length });
  });
  const slot = z.object({ playlistId: z.string(), days: z.number().int().min(1).max(127), start: z.number().int().min(0).max(1439), end: z.number().int().min(0).max(1439), enabled: z.boolean().default(true) });
  app.put("/api/admin/screens/:id/schedules", requireAdmin, (req, res) => {
    const rules = z.object({ rules: z.array(slot).max(50) }).parse(req.body).rules, id = Number(req.params.id);
    if (!row("SELECT id FROM screens WHERE id=?", id)) {
      res.status(404).json({ error: "Screen not found" });
      return;
    }
    if (rules.some((r) => !row("SELECT id FROM playlists WHERE id=?", r.playlistId))) {
      res.status(400).json({ error: "Every time slot needs an existing playlist" });
      return;
    }
    db.exec("BEGIN");
    try {
      mutate("DELETE FROM schedules WHERE screen_id=?", id);
      rules.forEach((r, i) => mutate("INSERT INTO schedules(id,screen_id,position,playlist_id,days,start,end,enabled) VALUES(?,?,?,?,?,?,?,?)", crypto2.randomUUID(), id, i, r.playlistId, r.days, r.start, r.end, +r.enabled));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    lastEffective.set(id, effective(row("SELECT * FROM screens WHERE id=?", id)).playlistId);
    void prepare(id);
    notify(id);
    log("info", "schedule", "Schedule updated for " + screenName(id) + " (" + rules.length + " time slot" + (rules.length === 1 ? "" : "s") + ")", id);
    res.json({ ok: true });
  });
  app.get("/api/admin/activity", requireAdmin, (req, res) => {
    const q = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), level: z.enum(["all", "alert"]).default("all"), kind: z.enum(["display", "content", "playlist", "schedule", "command", "security"]).optional() }).parse(req.query);
    const where = ["1=1"], args = [];
    if (q.before) {
      where.push("id<?");
      args.push(q.before);
    }
    if (q.level === "alert") where.push("level IN ('warning','error')");
    if (q.kind) {
      where.push("kind=?");
      args.push(q.kind);
    }
    res.json({ items: all(`SELECT id,time,level,kind,message,screen_id as screenId FROM activity WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...args, q.limit), latest: row("SELECT MAX(id) as id FROM activity")?.id || 0 });
  });
  app.get("/api/admin/events", requireAdmin, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders();
    res.write("data: connected\n\n");
    adminClients.add(res);
    const timer = setInterval(() => res.write(": keepalive\n\n"), 15e3);
    req.on("close", () => {
      clearInterval(timer);
      adminClients.delete(res);
    });
  });
  function streamVariant(req, res, id, preview) {
    const key = String(req.params.file);
    const manifest = prepared.get(id), old = previous.get(id);
    const allowed = manifest?.items.some((item) => item.file === key) || old && old.until > Date.now() && old.manifest.items.some((item) => item.file === key);
    if (!/^[a-f0-9-]+\.(mp4|gif|jpg)$/.test(key) || !allowed) {
      res.status(403).end();
      return;
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(path3.join(dir, "variants", key));
  }
  app.get("/api/screens/:id/media/:file", requireScreen, (req, res) => streamVariant(req, res, Number(req.params.id), false));
  app.get("/api/admin/screens/:id/manifest", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    void prepare(id);
    res.json(prepared.get(id) || { id, revision: "pending", items: [], config: defaults });
  });
  app.get("/api/admin/screens/:id/media/:file", requireAdmin, (req, res) => streamVariant(req, res, Number(req.params.id), true));
  app.get("/compat", (_req, res) => res.sendFile(path3.join(root, "tv-player", "compat.html")));
  app.use("/fixtures", express.static(path3.join(dir, "fixtures"), { index: false, dotfiles: "deny" }));
  app.use("/player", express.static(path3.join(root, "tv-player"), { index: false }));
  app.get("/tv/:id", (_req, res) => res.sendFile(path3.join(root, "tv-player", "index.html")));
  app.use("/admin", express.static(path3.join(root, "dist", "dashboard")));
  app.get("/", (_req, res) => res.redirect("/admin/"));
  app.use((err, _req, res, _next) => {
    console.error((/* @__PURE__ */ new Date()).toISOString(), err.message);
    res.status(err instanceof z.ZodError ? 400 : err instanceof multer.MulterError ? 400 : 500).json({ error: err instanceof z.ZodError ? "Invalid input: " + err.issues.map((i) => i.path.join(".") + " " + i.message).join("; ") : err instanceof multer.MulterError ? err.message : "Request failed. Check server log." });
  });
  const cleanup = setInterval(() => {
    mutate("DELETE FROM sessions WHERE expires<?", Date.now());
    mutate("UPDATE commands SET status='expired',result='Player did not acknowledge in 60 seconds' WHERE status='pending' AND created<?", Date.now() - 6e4);
    mutate("DELETE FROM commands WHERE created<?", Date.now() - 7 * 864e5);
    for (const [key, value] of attempts) if (value.until < Date.now()) attempts.delete(key);
  }, 3e4);
  cleanup.unref();
  for (const s of all("SELECT * FROM screens")) {
    wasOnline.set(s.id, !!s.last_seen && Date.now() - s.last_seen < 45e3);
    lastEffective.set(s.id, effective(s).playlistId);
  }
  const ticker = setInterval(() => {
    for (const s of all("SELECT * FROM screens")) {
      const online = !!s.last_seen && Date.now() - s.last_seen < 45e3, was = wasOnline.get(s.id);
      if (was !== void 0 && was !== online) {
        if (online) log("success", "display", s.name + " is back online", s.id);
        else if (s.token_hash) log("warning", "display", s.name + " went offline (no heartbeat for 45 seconds)", s.id);
      }
      wasOnline.set(s.id, online);
      const e = effective(s).playlistId;
      if (lastEffective.has(s.id) && lastEffective.get(s.id) !== e) log("info", "schedule", "Schedule switched " + s.name + " to " + (e ? quote(playlistName(e)) : "no playlist"), s.id);
      lastEffective.set(s.id, e);
      if (prepared.get(s.id)?.revision !== desired(s) && !builds.has(s.id)) void prepare(s.id);
    }
    mutate("DELETE FROM activity WHERE time<?", Date.now() - 90 * 864e5);
  }, 1e4);
  ticker.unref();
  return { app, db, processor, prepare, close: () => {
    clearInterval(cleanup);
    clearInterval(ticker);
    if (adminTimer) clearTimeout(adminTimer);
    for (const r of adminClients) r.end();
    for (const clients of events.values()) for (const res of clients) res.end();
    db.close();
  } };
}

// server/index.ts
var service = createApp();
var port = Number(process.env.PORT || 3e3);
var host = process.env.HOST || "0.0.0.0";
var server = service.app.listen(port, host, () => console.log(`LAN Signage running on ${host}:${port}. Admin: http://localhost:${port}/admin/ | Compatibility: http://localhost:${port}/compat`));
function shutdown() {
  server.close(() => {
    service.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1e4).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
