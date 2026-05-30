// IndexedDB-backed image store.
//
// Why: charts and trade screenshots are base64 data URLs that can total tens of
// MB. localStorage (where the rest of the store persists) has a ~5MB quota, so
// keeping images there overflows it and breaks both saving and backup-import.
// Images now live in IndexedDB (no practical size cap); the Zustand store keeps
// only lightweight references (`chart.imageId`, `trade.screenshot_id`).
//
// Backups stay in the SAME on-disk JSON format as before: export re-inlines the
// data URLs (see `inlineImages`) and import pulls them back out into IDB (see
// `extractImages`). So older backups still import and new exports stay portable.

import { useEffect, useState } from 'react';

const DB_NAME = 'trading-dashboard-images';
const STORE   = 'images';

const uid = () => Math.random().toString(36).slice(2, 10);

// In-memory cache so repeated reads (and re-renders) don't hit IDB every time.
const cache = new Map(); // imageId -> dataUrl

// Tiny pub/sub: lets <useImage> components update when an image arrives later
// (e.g. flushed to IDB after a migration, or written by another component).
const listeners = new Set();
function notify(id) { listeners.forEach(fn => { try { fn(id); } catch {} }); }

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function withStore(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function putImage(id, dataUrl) {
  if (!id || !dataUrl) return id;
  cache.set(id, dataUrl);
  notify(id);
  try { await withStore('readwrite', s => s.put(dataUrl, id)); } catch {}
  return id;
}

export async function putImages(entries = []) {
  if (!entries.length) return;
  for (const e of entries) { if (e && e.id && e.dataUrl) { cache.set(e.id, e.dataUrl); notify(e.id); } }
  try {
    await withStore('readwrite', s => { for (const e of entries) if (e && e.id && e.dataUrl) s.put(e.dataUrl, e.id); });
  } catch {}
}

export async function getImage(id) {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  try {
    const db = await openDB();
    const dataUrl = await new Promise((resolve) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
    });
    if (dataUrl) cache.set(id, dataUrl);
    return dataUrl;
  } catch { return null; }
}

export async function deleteImage(id) {
  if (!id) return;
  cache.delete(id);
  try { await withStore('readwrite', s => s.delete(id)); } catch {}
}

export async function clearAllImages() {
  cache.clear();
  try { await withStore('readwrite', s => s.clear()); } catch {}
}

// ── React hook ──────────────────────────────────────────────────────────────

// Resolve an image id to its data URL (async, cached). Re-renders when the
// image is written later (migration / cross-component writes).
export function useImage(imageId) {
  const [url, setUrl] = useState(() => (imageId && cache.get(imageId)) || null);
  useEffect(() => {
    let alive = true;
    if (!imageId) { setUrl(null); return; }
    const cached = cache.get(imageId);
    if (cached) setUrl(cached);
    else getImage(imageId).then(u => { if (alive) setUrl(u); });
    const onPut = (putId) => { if (putId === imageId && alive) setUrl(cache.get(imageId) || null); };
    listeners.add(onPut);
    return () => { alive = false; listeners.delete(onPut); };
  }, [imageId]);
  return url;
}

// ── Backup (de)serialization helpers ─────────────────────────────────────────

// Pull inline data URLs out of a parsed backup / persisted state. Returns the
// image-free data (charts → `imageId`, trades → `screenshot_id`) plus the list
// of `{ id, dataUrl }` to write into IDB. Idempotent: already-referenced data
// (no inline `dataUrl` / data-URL `screenshot`) passes through untouched.
export function extractImages(data = {}) {
  const images = [];

  const playbooks = (data.playbooks || []).map(p => {
    if (!p || !Array.isArray(p.charts)) return p;
    const charts = p.charts.map(c => {
      if (c && typeof c.dataUrl === 'string' && c.dataUrl.startsWith('data:')) {
        const imageId = c.imageId || `img_${uid()}`;
        images.push({ id: imageId, dataUrl: c.dataUrl });
        const { dataUrl, ...rest } = c;
        return { ...rest, imageId };
      }
      return c;
    });
    return { ...p, charts };
  });

  const trades = (data.trades || []).map(t => {
    if (t && typeof t.screenshot === 'string' && t.screenshot.startsWith('data:')) {
      const imageId = t.screenshot_id || `img_${uid()}`;
      images.push({ id: imageId, dataUrl: t.screenshot });
      const { screenshot, ...rest } = t;
      return { ...rest, screenshot_id: imageId };
    }
    return t;
  });

  return { data: { ...data, playbooks, trades }, images };
}

// Inverse of extractImages: re-embed data URLs from IDB so an export is a
// single self-contained JSON in the legacy format (charts[].dataUrl,
// trade.screenshot). Missing images are simply dropped.
export async function inlineImages(state = {}) {
  const playbooks = await Promise.all((state.playbooks || []).map(async p => {
    if (!p || !Array.isArray(p.charts)) return p;
    const charts = await Promise.all(p.charts.map(async c => {
      if (c && c.imageId) {
        const dataUrl = await getImage(c.imageId);
        const { imageId, ...rest } = c;
        return dataUrl ? { ...rest, dataUrl } : rest;
      }
      return c;
    }));
    return { ...p, charts };
  }));

  const trades = await Promise.all((state.trades || []).map(async t => {
    if (t && t.screenshot_id) {
      const dataUrl = await getImage(t.screenshot_id);
      const { screenshot_id, ...rest } = t;
      return dataUrl ? { ...rest, screenshot: dataUrl } : rest;
    }
    return t;
  }));

  return { ...state, playbooks, trades };
}

export const newImageId = () => `img_${uid()}`;
