// The public share server never opens the personal DB. The private app writes what an active
// share may show into a separate folder: <sha256(token)>.json plus assets/<assetId> copies.
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { referencedAssetIds } from './publicPage.mjs';
import { publicPlanTaskProjection } from './planConnections.mjs';

/** PUBLIC_SHARES_DIR, or <data>/public-shares (which a share container mounting /data:ro also sees). */
export const shareSnapshotDir = (dataDir) => process.env.PUBLIC_SHARES_DIR || join(dataDir, 'public-shares');

export function createShareSnapshots(db, dataDir, dir) {
  const written = new Map(); // hash -> last JSON, so unchanged shares are not rewritten
  const assetsDir = join(dir, 'assets');
  const asset = db.prepare('SELECT id, storage_key AS key, name, mime, size FROM assets WHERE id = ?');
  function copyAsset(row) {
    const target = join(assetsDir, row.id);
    if (existsSync(target)) return true; // asset bytes never change for an id
    const source = join(dataDir, 'blobs', row.key);
    if (!existsSync(source)) return false;
    const temp = target + '.tmp';
    try {
      linkSync(source, temp);
    } catch {
      copyFileSync(source, temp);
    }
    renameSync(temp, target);
    return true;
  }
  return function publishShareSnapshots() {
    mkdirSync(assetsDir, { recursive: true });
    const rows = db
      .prepare(
        `SELECT s.token_hash AS hash, s.expires_at AS expiresAt, s.comments_enabled AS commentsEnabled,
          p.id, p.title, p.icon, p.document, p.updated_at AS updatedAt
        FROM page_shares s JOIN pages p ON p.id = s.page_id
        WHERE s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?) AND p.deleted_at IS NULL`,
      )
      .all(new Date().toISOString());
    const keep = new Set(), keepAssets = new Set();
    for (const row of rows) {
      const page = { id: row.id, title: row.title, icon: row.icon, document: JSON.parse(row.document), updatedAt: row.updatedAt };
      const assets = [];
      for (const id of referencedAssetIds(page.document)) {
        const found = asset.get(id);
        if (found && copyAsset(found)) {
          keepAssets.add(id);
          assets.push({ id, name: found.name, mime: found.mime, size: found.size });
        }
      }
      const json = JSON.stringify({
        page,
        commentsEnabled: !!row.commentsEnabled,
        expiresAt: row.expiresAt,
        assets,
        planTasks: publicPlanTaskProjection(db, page),
      });
      keep.add(row.hash + '.json');
      if (written.get(row.hash) === json && existsSync(join(dir, row.hash + '.json'))) continue;
      writeFileSync(join(dir, row.hash + '.tmp'), json);
      renameSync(join(dir, row.hash + '.tmp'), join(dir, row.hash + '.json'));
      written.set(row.hash, json);
    }
    // Revoked, expired, trashed or deleted shares disappear from the public folder.
    for (const name of readdirSync(dir))
      if (name.endsWith('.json') && !keep.has(name)) {
        rmSync(join(dir, name), { force: true });
        written.delete(name.slice(0, -5));
      }
    for (const name of readdirSync(assetsDir))
      if (!keepAssets.has(name)) rmSync(join(assetsDir, name), { force: true });
  };
}
