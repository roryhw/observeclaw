import { ulid } from 'ulid';
const DEFAULT_RULES = [
    { pattern: 'tool.*', days: 30, enabled: true },
    { pattern: 'network.*', days: 14, enabled: true },
    { pattern: 'message.*', days: 30, enabled: true },
    { pattern: 'webhook.received', days: 30, enabled: true },
    { pattern: 'exec.approval.requested', days: 30, enabled: true },
    { pattern: 'shutdown', days: 30, enabled: true },
    { pattern: 'gateway.observe.subscribe_failed', days: 14, enabled: true },
    { pattern: 'gateway.poll.error', days: 14, enabled: true },
    { pattern: 'cron', days: 14, enabled: true },
    { pattern: 'model.usage', days: 14, enabled: true },
    { pattern: 'health', days: 14, enabled: true },
    { pattern: 'presence', days: 14, enabled: true },
    { pattern: 'heartbeat', days: 14, enabled: true },
    { pattern: 'pulse.*', days: 3, enabled: true },
    { pattern: 'agent', days: 3, enabled: true },
    { pattern: 'chat', days: 3650, enabled: true },
    { pattern: 'session.output', days: 1, enabled: true },
    { pattern: 'access.credential.use', days: 1, enabled: true }
];
export function isInferredEvent(type, data, summary) {
    if (type === 'pulse.update' || type === 'pulse.snapshot')
        return true;
    if (data && typeof data === 'object' && data.inferred)
        return true;
    return String(summary || '').toLowerCase().includes('inferred');
}
export function defaultPolicy(nowIso = new Date().toISOString()) {
    return {
        id: ulid(),
        name: 'Global Retention Policy',
        enabled: true,
        timezone: 'America/Los_Angeles',
        scheduleCron: '10 3 * * *',
        includeInferred: false,
        chatRetentionDays: 3650,
        defaultRetentionDays: 30,
        auditRetentionDays: 7,
        notifyOnFailureOnly: true,
        rules: DEFAULT_RULES,
        createdAt: nowIso,
        updatedAt: nowIso
    };
}
export function loadPolicy(db) {
    const row = db.prepare('SELECT * FROM retention_policies ORDER BY updatedAt DESC LIMIT 1').get();
    if (!row) {
        const base = defaultPolicy();
        db.prepare(`
      INSERT INTO retention_policies (
        id, name, enabled, timezone, scheduleCron, includeInferred, chatRetentionDays,
        defaultRetentionDays, auditRetentionDays, rulesJson, notifyOnFailureOnly, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(base.id, base.name, base.enabled ? 1 : 0, base.timezone, base.scheduleCron, base.includeInferred ? 1 : 0, base.chatRetentionDays, base.defaultRetentionDays, base.auditRetentionDays, JSON.stringify(base.rules || []), base.notifyOnFailureOnly ? 1 : 0, base.createdAt, base.updatedAt);
        return base;
    }
    let rules = DEFAULT_RULES;
    try {
        const parsed = JSON.parse(String(row.rulesJson || '[]'));
        if (Array.isArray(parsed))
            rules = parsed;
    }
    catch { }
    return {
        id: String(row.id),
        name: String(row.name || 'Global Retention Policy'),
        enabled: !!row.enabled,
        timezone: String(row.timezone || 'America/Los_Angeles'),
        scheduleCron: String(row.scheduleCron || '10 3 * * *'),
        includeInferred: false,
        chatRetentionDays: Number(row.chatRetentionDays || 3650),
        defaultRetentionDays: Number(row.defaultRetentionDays || 30),
        auditRetentionDays: Number(row.auditRetentionDays || 7),
        notifyOnFailureOnly: row.notifyOnFailureOnly !== 0,
        rules,
        createdAt: String(row.createdAt || new Date().toISOString()),
        updatedAt: String(row.updatedAt || new Date().toISOString())
    };
}
export function savePolicy(db, input) {
    const prev = loadPolicy(db);
    const now = new Date().toISOString();
    const requestedChatDays = Number(input.chatRetentionDays ?? prev.chatRetentionDays);
    const chatRetentionDays = Number.isFinite(requestedChatDays) ? Math.max(3650, requestedChatDays) : prev.chatRetentionDays;
    const next = {
        ...prev,
        ...input,
        id: prev.id,
        includeInferred: false, // locked per product policy
        notifyOnFailureOnly: true,
        chatRetentionDays,
        rules: Array.isArray(input.rules) ? input.rules : prev.rules,
        updatedAt: now
    };
    db.prepare(`
    INSERT INTO retention_policies (
      id, name, enabled, timezone, scheduleCron, includeInferred, chatRetentionDays,
      defaultRetentionDays, auditRetentionDays, rulesJson, notifyOnFailureOnly, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      enabled=excluded.enabled,
      timezone=excluded.timezone,
      scheduleCron=excluded.scheduleCron,
      includeInferred=excluded.includeInferred,
      chatRetentionDays=excluded.chatRetentionDays,
      defaultRetentionDays=excluded.defaultRetentionDays,
      auditRetentionDays=excluded.auditRetentionDays,
      rulesJson=excluded.rulesJson,
      notifyOnFailureOnly=excluded.notifyOnFailureOnly,
      updatedAt=excluded.updatedAt
  `).run(next.id, next.name, next.enabled ? 1 : 0, next.timezone, next.scheduleCron, next.includeInferred ? 1 : 0, next.chatRetentionDays, next.defaultRetentionDays, next.auditRetentionDays, JSON.stringify(next.rules || []), next.notifyOnFailureOnly ? 1 : 0, next.createdAt, next.updatedAt);
    return next;
}
function ruleDaysForType(type, policy) {
    if (type === 'chat')
        return policy.chatRetentionDays;
    const candidates = (policy.rules || []).filter((r) => r && r.enabled !== false);
    const exact = candidates.find((r) => r.pattern === type);
    if (exact)
        return Number(exact.days || policy.defaultRetentionDays);
    const wildcard = candidates.find((r) => r.pattern.endsWith('.*') && type.startsWith(r.pattern.slice(0, -1)));
    if (wildcard)
        return Number(wildcard.days || policy.defaultRetentionDays);
    return Number(policy.defaultRetentionDays || 30);
}
export function retentionPreview(db, policy, nowMs = Date.now()) {
    const rows = db.prepare('SELECT type, COUNT(*) as n FROM normalized_events GROUP BY type').all();
    const byType = rows.map((r) => {
        const type = String(r.type || 'unknown.event');
        const days = ruleDaysForType(type, policy);
        const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
        const purge = db.prepare('SELECT COUNT(*) as c FROM normalized_events WHERE type = ? AND timestamp < ?').get(type, cutoff)?.c || 0;
        return { type, keepDays: days, total: Number(r.n || 0), purge: Number(purge || 0) };
    }).sort((a, b) => b.purge - a.purge);
    const purgeNormalized = byType.reduce((s, r) => s + r.purge, 0);
    const auditCutoff = new Date(nowMs - Number(policy.auditRetentionDays || 14) * 24 * 60 * 60 * 1000).toISOString();
    const purgeAudit = db.prepare('SELECT COUNT(*) as c FROM audit_events WHERE timestamp < ?').get(auditCutoff)?.c || 0;
    return { byType, purgeNormalized, purgeAudit, auditCutoff };
}
export function runRetention(db, policy, opts) {
    const dryRun = !!opts?.dryRun;
    const nowMs = Date.now();
    const preview = retentionPreview(db, policy, nowMs);
    const noisyAuditCutoff = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();
    const noisyAuditActions = ['read.pulse', 'read.alerts', 'read.ingest_policy_stats'];
    if (dryRun) {
        return {
            ...preview,
            noisyAuditCutoff,
            normalizedDeleted: 0,
            auditDeleted: 0,
            noisyAuditDeleted: 0,
            rawDeleted: 0,
            checkpointRan: false,
            vacuumRan: false
        };
    }
    let normalizedDeleted = 0;
    const deletedByType = [];
    for (const row of preview.byType) {
        if (row.purge <= 0)
            continue;
        const cutoff = new Date(nowMs - row.keepDays * 24 * 60 * 60 * 1000).toISOString();
        const res = db.prepare('DELETE FROM normalized_events WHERE type = ? AND timestamp < ?').run(row.type, cutoff);
        const deleted = Number(res?.changes || 0);
        normalizedDeleted += deleted;
        deletedByType.push({ type: row.type, deleted, keepDays: row.keepDays });
    }
    let noisyAuditDeleted = 0;
    for (const action of noisyAuditActions) {
        noisyAuditDeleted += Number(db.prepare('DELETE FROM audit_events WHERE action = ? AND timestamp < ?').run(action, noisyAuditCutoff)?.changes || 0);
    }
    noisyAuditDeleted += Number(db.prepare("DELETE FROM audit_events WHERE action = 'auth.api' AND status = 'allowed' AND target IN ('/api/pulse', '/api/alerts', '/api/ingest-policy/stats', '/api/auth/status') AND timestamp < ?").run(noisyAuditCutoff)?.changes || 0);
    const auditDeleted = Number(db.prepare('DELETE FROM audit_events WHERE timestamp < ?').run(preview.auditCutoff)?.changes || 0) + noisyAuditDeleted;
    const rawDeleted = Number(db.prepare(`DELETE FROM raw_events WHERE id NOT IN (SELECT DISTINCT rawEventId FROM normalized_events WHERE rawEventId IS NOT NULL)`).run()?.changes || 0);
    let checkpointRan = false;
    let vacuumRan = false;
    if (opts?.runCheckpoint) {
        db.pragma('wal_checkpoint(TRUNCATE)');
        checkpointRan = true;
    }
    if (opts?.runVacuum) {
        db.exec('VACUUM');
        vacuumRan = true;
    }
    return {
        ...preview,
        noisyAuditCutoff,
        deletedByType,
        normalizedDeleted,
        auditDeleted,
        noisyAuditDeleted,
        rawDeleted,
        checkpointRan,
        vacuumRan
    };
}
//# sourceMappingURL=policy.js.map