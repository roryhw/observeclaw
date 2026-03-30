import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', '..', 'observeclaw.db');
type BetterSqliteDatabase = InstanceType<typeof Database>;

export const db: BetterSqliteDatabase = new Database(dbPath, {
  // verbose: console.log
});

db.pragma('journal_mode = WAL'); // Better performance for concurrent reads/writes
db.pragma('synchronous = NORMAL');

// Initialize schema
export function initDB() {
  const initSchema = `
    CREATE TABLE IF NOT EXISTS raw_events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      sourceEventType TEXT,
      sourceSeq INTEGER,
      sourceKey TEXT UNIQUE,
      ingestedAt TEXT NOT NULL,
      payload JSON NOT NULL
    );

    CREATE TABLE IF NOT EXISTS normalized_events (
      id TEXT PRIMARY KEY,
      rawEventId TEXT,
      timestamp TEXT NOT NULL,
      domain TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      agentId TEXT,
      sessionKey TEXT,
      channel TEXT,
      summary TEXT NOT NULL,
      data JSON,
      actor JSON,
      target JSON,
      resources JSON,
      FOREIGN KEY(rawEventId) REFERENCES raw_events(id)
    );

    -- Back-compat table alias for older queries
    CREATE VIEW IF NOT EXISTS events AS
      SELECT id, timestamp, domain, type, severity, agentId, sessionKey, channel, summary, data, actor, target, resources
      FROM normalized_events;

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT,
      action TEXT NOT NULL,
      target TEXT,
      status TEXT NOT NULL,
      details JSON
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL,
      threshold INTEGER,
      windowSec INTEGER,
      dedupeSec INTEGER NOT NULL DEFAULT 600,
      notifyEnabled INTEGER NOT NULL DEFAULT 0,
      notifyChannel TEXT,
      notifyCooldownSec INTEGER NOT NULL DEFAULT 900,
      lastNotifiedAt TEXT,
      domain TEXT,
      type TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications_outbox (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      ruleId TEXT,
      alertId TEXT,
      channel TEXT NOT NULL,
      payload JSON NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sentAt TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      ruleId TEXT,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      details JSON,
      dedupeKey TEXT,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(ruleId) REFERENCES alert_rules(id)
    );

    CREATE TABLE IF NOT EXISTS log_explorer_favorites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      queryJson TEXT NOT NULL,
      position INTEGER NOT NULL,
      isDefault INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS retention_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      timezone TEXT,
      scheduleCron TEXT,
      includeInferred INTEGER NOT NULL DEFAULT 0,
      chatRetentionDays INTEGER,
      defaultRetentionDays INTEGER NOT NULL DEFAULT 30,
      auditRetentionDays INTEGER NOT NULL DEFAULT 14,
      rulesJson TEXT NOT NULL,
      notifyOnFailureOnly INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS retention_runs (
      id TEXT PRIMARY KEY,
      startedAt TEXT NOT NULL,
      endedAt TEXT,
      status TEXT NOT NULL,
      dryRun INTEGER NOT NULL DEFAULT 0,
      trigger TEXT,
      summaryJson TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS version_checks (
      checkDate TEXT PRIMARY KEY,
      installedVersion TEXT,
      installedDisplay TEXT,
      latestVersion TEXT,
      updateAvailable INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      source TEXT,
      checkedAt TEXT NOT NULL,
      error TEXT
    );

    -- Indexes for fast querying
    CREATE INDEX IF NOT EXISTS idx_norm_timestamp ON normalized_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_norm_domain ON normalized_events(domain);
    CREATE INDEX IF NOT EXISTS idx_norm_agentId ON normalized_events(agentId);
    CREATE INDEX IF NOT EXISTS idx_norm_type ON normalized_events(type);
    CREATE INDEX IF NOT EXISTS idx_norm_timestamp_type ON normalized_events(timestamp, type);
    CREATE INDEX IF NOT EXISTS idx_norm_domain_type_timestamp ON normalized_events(domain, type, timestamp);
    CREATE INDEX IF NOT EXISTS idx_raw_sourceKey ON raw_events(sourceKey);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);
    CREATE INDEX IF NOT EXISTS idx_audit_action_status_timestamp ON audit_events(action, status, timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_dedupe ON alerts(dedupeKey);
    CREATE INDEX IF NOT EXISTS idx_rules_enabled ON alert_rules(enabled);
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON notifications_outbox(status);
    CREATE INDEX IF NOT EXISTS idx_outbox_status_timestamp ON notifications_outbox(status, timestamp);
  `;
  
  db.exec(initSchema);

  // Lightweight migrations
  try { db.exec('ALTER TABLE alert_rules ADD COLUMN dedupeSec INTEGER NOT NULL DEFAULT 600;'); } catch {}
  try { db.exec('ALTER TABLE alert_rules ADD COLUMN notifyEnabled INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { db.exec('ALTER TABLE alert_rules ADD COLUMN notifyChannel TEXT;'); } catch {}
  try { db.exec('ALTER TABLE alert_rules ADD COLUMN notifyCooldownSec INTEGER NOT NULL DEFAULT 900;'); } catch {}
  try { db.exec('ALTER TABLE alert_rules ADD COLUMN lastNotifiedAt TEXT;'); } catch {}

  console.log('Database initialized at:', dbPath);
}
