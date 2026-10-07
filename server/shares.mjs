import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createShareTokenVault } from './shareTokens.mjs';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export class ShareValidationError extends Error {}

export function createShareStore(db, dataDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_shares (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      comments_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS page_shares_page ON page_shares(page_id, created_at DESC);
  `);
  if (
    !db
      .prepare('PRAGMA table_info(page_shares)')
      .all()
      .some((column) => column.name === 'comments_enabled')
  )
    db.exec('ALTER TABLE page_shares ADD COLUMN comments_enabled INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(page_shares)').all().some(column=>column.name==='token_cipher'))
    db.exec('ALTER TABLE page_shares ADD COLUMN token_cipher TEXT');
  const vault=createShareTokenVault(dataDir,()=>Boolean(db.prepare('SELECT 1 FROM page_shares WHERE token_cipher IS NOT NULL LIMIT 1').get()));
  const summary = (row) =>
    row && {
      id: row.id,
      pageId: row.pageId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      commentsEnabled: !!row.commentsEnabled,
      linkAvailable: !!row.tokenCipher,
    };
  return {
    listPageShares(pageId) {
      if (!this.getPage(pageId)) return null;
      return db
        .prepare(
          `SELECT id, page_id AS pageId, created_at AS createdAt, expires_at AS expiresAt,
        revoked_at AS revokedAt, comments_enabled AS commentsEnabled, token_cipher AS tokenCipher FROM page_shares WHERE page_id = ? ORDER BY created_at DESC`,
        )
        .all(pageId)
        .map(summary);
    },
    getPageShareToken(pageId, shareId) {
      if (!this.getPage(pageId)) return null;
      const row=db.prepare(`SELECT token_hash, token_cipher FROM page_shares WHERE page_id=? AND id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)`).get(pageId,shareId,new Date().toISOString());
      if (!row?.token_cipher) return null;
      const token=vault.decrypt(row.token_cipher,pageId+':'+shareId);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token) || hashToken(token)!==row.token_hash) throw Error('공유 링크를 읽지 못했어요.');
      return token;
    },
    createPageShare(pageId, { expiresInDays = 30, commentsEnabled = false } = {}) {
      if (!this.getPage(pageId)) return null;
      if (expiresInDays !== null && ![1, 7, 30, 90].includes(expiresInDays))
        throw new ShareValidationError('공유 기간이 올바르지 않아요.');
      if (typeof commentsEnabled !== 'boolean')
        throw new ShareValidationError('댓글 허용 설정을 확인해 주세요.');
      const token = randomBytes(32).toString('base64url');
      const id = randomUUID();
      const tokenCipher = vault.encrypt(token, pageId+':'+id);
      const now = new Date();
      const expiresAt =
        expiresInDays === null
          ? null
          : new Date(now.getTime() + expiresInDays * 86400000).toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          'UPDATE page_shares SET revoked_at = ?, token_cipher = NULL WHERE page_id = ? AND revoked_at IS NULL',
        ).run(now.toISOString(), pageId);
        db.prepare(
          `INSERT INTO page_shares (id, page_id, token_hash, created_at, expires_at, comments_enabled)
          VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, pageId, hashToken(token), now.toISOString(), expiresAt, Number(commentsEnabled));
        db.prepare('UPDATE page_shares SET token_cipher=? WHERE id=?').run(tokenCipher,id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return {
        item: {
          id,
          pageId,
          createdAt: now.toISOString(),
          expiresAt,
          revokedAt: null,
          commentsEnabled,
          linkAvailable: true,
        },
        token,
      };
    },
    updatePageShare(pageId, shareId, { commentsEnabled } = {}) {
      if (typeof commentsEnabled !== 'boolean')
        throw new ShareValidationError('댓글 허용 설정을 확인해 주세요.');
      if (!this.getPage(pageId)) return null;
      const result = db
        .prepare(
          `UPDATE page_shares SET comments_enabled=? WHERE page_id=? AND id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)`,
        )
        .run(Number(commentsEnabled), pageId, shareId, new Date().toISOString());
      if (!result.changes) return null;
      return this.listPageShares(pageId).find((item) => item.id === shareId);
    },
    revokePageShare(pageId, shareId) {
      if (!this.getPage(pageId)) return false;
      const result = db
        .prepare(
          'UPDATE page_shares SET revoked_at = ?, token_cipher = NULL WHERE page_id = ? AND id = ? AND revoked_at IS NULL',
        )
        .run(new Date().toISOString(), pageId, shareId);
      return Boolean(result.changes);
    },
  };
}

export function lookupSharedPage(db, token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = db
    .prepare(
      `SELECT p.id, p.title, p.icon, p.document, p.updated_at AS updatedAt, s.comments_enabled AS commentsEnabled
    FROM page_shares s JOIN pages p ON p.id = s.page_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at > ?)
      AND p.deleted_at IS NULL`,
    )
    .get(hashToken(token), new Date().toISOString());
  return row
    ? { ...row, commentsEnabled: !!row.commentsEnabled, document: JSON.parse(row.document) }
    : null;
}
