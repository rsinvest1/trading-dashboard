import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const LOOKBACK_DAYS = 7;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!match) return NaN;
  const [, year, month, day] = match.map(Number);
  return Date.UTC(year, month - 1, day);
}

function isWithinLastDays(dateKey, days) {
  const dateMs = parseDateKey(dateKey);
  if (!Number.isFinite(dateMs)) return false;
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const oldestMs = todayMs - (days - 1) * 24 * 60 * 60 * 1000;
  return dateMs >= oldestMs && dateMs <= todayMs;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function findMetadataFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findMetadataFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'metadata.json') {
      files.push(fullPath);
    }
  }
  return files;
}

async function readJournalPackage(root, filePath, projectRoot) {
  const rel = path.relative(root, filePath).split(path.sep);
  const [date, packageSlug] = rel;
  if (!date || !packageSlug || !isWithinLastDays(date, LOOKBACK_DAYS)) return null;

  try {
    const metadata = JSON.parse(await readFile(filePath, 'utf8'));
    const slugParts = packageSlug.split('_');
    const slug = slugParts.length > 2 ? slugParts.slice(2).join('_') : packageSlug;
    return {
      date,
      slug,
      releaseKey: metadata.releaseKey || '',
      releaseName: metadata.releaseName || metadata.releaseKey || packageSlug,
      releaseId: metadata.releaseId || '',
      path: toPosixPath(path.relative(projectRoot, filePath))
    };
  } catch {
    return null;
  }
}

function devJournalDiscoveryPlugin() {
  return {
    name: 'dev-journal-discovery',
    configureServer(server) {
      const projectRoot = server.config.root;
      const journalRoots = [
        path.resolve(projectRoot, '..', 'release-journal-worker', 'journal-data'),
        path.resolve(projectRoot, 'release-journal-worker', 'journal-data')
      ];

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/dev/journals')) return next();

        const url = new URL(req.url, 'http://localhost');

        if (req.method === 'GET' && url.pathname === '/api/dev/journals') {
          const packages = [];
          for (const root of journalRoots) {
            const files = await findMetadataFiles(root);
            for (const file of files) {
              const item = await readJournalPackage(root, file, projectRoot);
              if (item) packages.push(item);
            }
          }

          const seen = new Set();
          const newestFirst = packages
            .filter(pkg => {
              const key = pkg.releaseId || pkg.path;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .sort((a, b) =>
              b.date.localeCompare(a.date) ||
              path.dirname(b.path).localeCompare(path.dirname(a.path)) ||
              b.slug.localeCompare(a.slug)
            );

          return sendJson(res, 200, newestFirst);
        }

        if (req.method === 'GET' && url.pathname === '/api/dev/journals/metadata') {
          const requestedPath = url.searchParams.get('path');
          if (!requestedPath) return sendJson(res, 400, { error: 'Missing path' });

          const filePath = path.resolve(projectRoot, requestedPath);
          const allowed = path.basename(filePath) === 'metadata.json' &&
            journalRoots.some(root => isInside(root, filePath));

          if (!allowed) return sendJson(res, 403, { error: 'Path is outside journal-data' });

          try {
            const metadata = JSON.parse(await readFile(filePath, 'utf8'));
            return sendJson(res, 200, metadata);
          } catch (error) {
            return sendJson(res, 404, { error: error.message || 'Metadata not found' });
          }
        }

        return next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), devJournalDiscoveryPlugin()],
  // strictPort: never silently fall forward onto 5174 (the Macro Release Monitor)
  // -- that origin split is what makes trades "disappear" (localStorage is per-port).
  server: { port: 5173, strictPort: true, open: true }
});
