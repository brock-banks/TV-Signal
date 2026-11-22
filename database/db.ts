import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { defaults } from '../shared-types/core.ts';
export const SCHEMA_VERSION=2;
export function openDatabase(dir:string){
 fs.mkdirSync(dir,{recursive:true}); const db=new DatabaseSync(path.join(dir,'signage.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 const version=(db.prepare('PRAGMA user_version').get() as any).user_version;
 if(version>SCHEMA_VERSION){db.close();throw new Error('Database is newer than this application');}
 if(version<1){db.exec(`BEGIN;
 CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK(id=1), password TEXT NOT NULL);
 CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
 CREATE TABLE media (id TEXT PRIMARY KEY, title TEXT NOT NULL, original TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, duration REAL DEFAULT 0, animated INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, created INTEGER NOT NULL);
 CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE entries (playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE, position INTEGER, media_id TEXT REFERENCES media(id), duration REAL NOT NULL DEFAULT 10, PRIMARY KEY(playlist_id,position));
 CREATE TABLE screens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL, config TEXT NOT NULL, token_hash TEXT, pair_hash TEXT, pair_expires INTEGER, last_seen INTEGER, current_media TEXT, diagnostics TEXT, revision INTEGER NOT NULL DEFAULT 1, immediate INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE commands (id INTEGER PRIMARY KEY AUTOINCREMENT, screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE, action TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT);
 PRAGMA user_version=1; COMMIT;`);
 const seed=db.prepare('INSERT INTO screens(name,config) VALUES (?,?)');for(let i=1;i<=3;i++)seed.run('TV '+i,JSON.stringify(defaults));
 }
 // v2: activity log, display groups, day-part schedules, player snapshots. Transactional; rolls back on failure.
 if((db.prepare('PRAGMA user_version').get() as any).user_version<2){
  db.exec('BEGIN');
  try{db.exec(`
   CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, level TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, screen_id INTEGER);
   CREATE INDEX activity_time ON activity(time);
   CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL);
   ALTER TABLE screens ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL;
   ALTER TABLE screens ADD COLUMN snapshot_at INTEGER;
   CREATE TABLE schedules (id TEXT PRIMARY KEY, screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE, position INTEGER NOT NULL, playlist_id TEXT NOT NULL REFERENCES playlists(id), days INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
   CREATE INDEX schedules_screen ON schedules(screen_id,position);
   PRAGMA user_version=2;`);db.exec('COMMIT');}
  catch(e){db.exec('ROLLBACK');throw e;}
 }
 db.prepare("UPDATE media SET status='error', error='Processing interrupted by server restart. Retry conversion.' WHERE status='processing'").run();
 db.prepare("UPDATE commands SET status='expired',result='Server restarted before acknowledgment' WHERE status='pending'").run();
 return db;
}
