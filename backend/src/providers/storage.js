// StorageProvider contract:
//   put({ bucket, path, buffer, mime }), get({ bucket, path }) -> Buffer, remove({ bucket, path })
// Files are always private. They are streamed to the user only after the API has verified ownership,
// so no public or long-lived signed URL ever exists for KYC documents.
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';

export class SupabaseStorageProvider {
  name = 'supabase';
  constructor() {
    this.clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(config.supabase.url, config.supabase.serviceRoleKey, { auth: { persistSession: false } }));
  }
  async put({ bucket, path: p, buffer, mime }) {
    const c = await this.clientPromise;
    const { error } = await c.storage.from(bucket).upload(p, buffer, { contentType: mime, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return { path: p };
  }
  async get({ bucket, path: p }) {
    const c = await this.clientPromise;
    const { data, error } = await c.storage.from(bucket).download(p);
    if (error) throw new Error(`Storage download failed: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async remove({ bucket, path: p }) {
    const c = await this.clientPromise;
    await c.storage.from(bucket).remove([p]);
  }
}

export class LocalStorageProvider {
  name = 'local';
  resolve(bucket, p) {
    const full = path.resolve(config.upload.localDir, bucket, p);
    const root = path.resolve(config.upload.localDir, bucket);
    if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage path');
    return full;
  }
  async put({ bucket, path: p, buffer }) {
    const full = this.resolve(bucket, p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
    return { path: p };
  }
  get({ bucket, path: p }) {
    return fs.readFile(this.resolve(bucket, p));
  }
  async remove({ bucket, path: p }) {
    await fs.rm(this.resolve(bucket, p), { force: true });
  }
}

export class MemoryStorageProvider {
  name = 'memory';
  files = new Map();
  async put({ bucket, path: p, buffer }) { this.files.set(`${bucket}/${p}`, buffer); return { path: p }; }
  async get({ bucket, path: p }) {
    const f = this.files.get(`${bucket}/${p}`);
    if (!f) throw new Error('not found');
    return f;
  }
  async remove({ bucket, path: p }) { this.files.delete(`${bucket}/${p}`); }
}

export function createStorageProvider() {
  if (config.supabase.url && config.supabase.serviceRoleKey) return new SupabaseStorageProvider();
  return config.isTest ? new MemoryStorageProvider() : new LocalStorageProvider();
}

// Validate by magic bytes, never by the client-declared MIME type or extension.
export function sniffMime(buf) {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/webp': 'webp' };
