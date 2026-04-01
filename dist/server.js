import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { ulid } from 'ulid';
import { execSync, execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFileCb);
import crypto from 'crypto';
import net from 'net';
import { db, initDB } from './db/index.js';
import { connectToGateway, getIngestPolicyStats, getIngestStatus } from './gateway/client.js';
import { redactObject, containsSecretLikeString } from './security/redaction.js';
import { PulseEngine } from './pulse/engine.js';
import { evaluateNetworkPolicy, loadNetworkPolicyConfig } from './network/policy.js';
import { loadPolicy as loadRetentionPolicy, savePolicy as saveRetentionPolicy, retentionPreview, runRetention } from './retention/policy.js';
function loadEnvFromFile(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return;
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const t = line.trim();
            if (!t || t.startsWith('#'))
                continue;
            const idx = t.indexOf('=');
            if (idx <= 0)
                continue;
            const k = t.slice(0, idx).trim();
            const v = t.slice(idx + 1).trim();
            if (!process.env[k])
                process.env[k] = v;
        }
    }
    catch { }
}
// Load env files in priority order (first wins per variable):
// 1. cwd/.env (project directory — standard for cloned repos)
// 2. ~/.openclaw/observeclaw.env (user-level config)
loadEnvFromFile(path.join(process.cwd(), '.env'));
loadEnvFromFile(path.join(os.homedir(), '.openclaw', 'observeclaw.env'));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const server = Fastify({
    logger: true
});
server.register(cors, {
    origin: true
});
server.register(fastifyWebsocket);
server.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'ui', 'dist'),
    prefix: '/'
});
// SPA fallback so deep-link refreshes (/activity, /alerts, etc.) serve index.html
server.setNotFoundHandler((request, reply) => {
    const url = String(request.url || '');
    if (request.method === 'GET' && !url.startsWith('/api') && !url.startsWith('/ws')) {
        return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ message: `Route ${request.method}:${url} not found`, error: 'Not Found', statusCode: 404 });
});
const API_PASSWORD = process.env.OBSERVECLAW_API_PASSWORD || process.env.GATEWAY_PASSWORD || '';
const OPERATOR_PASSWORD = process.env.OBSERVECLAW_OPERATOR_PASSWORD || API_PASSWORD;
const SESSION_COOKIE_NAME = 'observeclaw_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = Number(process.env.OBSERVECLAW_SESSION_MAX_AGE_SECONDS || 60 * 60 * 24 * 365);
const SESSION_SECRET = process.env.OBSERVECLAW_SESSION_SECRET || crypto.createHash('sha256').update(`observeclaw:${OPERATOR_PASSWORD}:${os.hostname()}`).digest('hex');
function b64url(input) {
    return Buffer.from(input).toString('base64url');
}
function parseCookies(raw) {
    const out = {};
    for (const part of String(raw || '').split(';')) {
        const trimmed = part.trim();
        if (!trimmed)
            continue;
        const idx = trimmed.indexOf('=');
        if (idx <= 0)
            continue;
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
    }
    return out;
}
function signSessionPayload(payload) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function createSessionToken() {
    const payload = b64url(JSON.stringify({ v: 1, iat: Date.now() }));
    const sig = signSessionPayload(payload);
    return `${payload}.${sig}`;
}
function verifySessionToken(token) {
    if (!token)
        return false;
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig)
        return false;
    const expected = signSessionPayload(payload);
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
            return false;
    }
    catch {
        return false;
    }
    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return Number(decoded?.v || 0) === 1;
    }
    catch {
        return false;
    }
}
function buildSessionCookie(token, secure = false) {
    const maxAge = Number.isFinite(SESSION_COOKIE_MAX_AGE_SECONDS) && SESSION_COOKIE_MAX_AGE_SECONDS > 0
        ? Math.floor(SESSION_COOKIE_MAX_AGE_SECONDS)
        : 60 * 60 * 24 * 365;
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function buildExpiredSessionCookie(secure = false) {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
function requestHasValidSessionCookie(request) {
    const cookies = parseCookies(request?.headers?.cookie || '');
    return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}
const REDACTION_MODE = (process.env.OBSERVECLAW_REDACTION_MODE || 'best-effort');
const TELEGRAM_BOT_TOKEN = process.env.OBSERVECLAW_TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.OBSERVECLAW_TELEGRAM_CHAT_ID || '';
const telegramNotifierConfigured = () => !!TELEGRAM_BOT_TOKEN && !!TELEGRAM_CHAT_ID;
const OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const MAIN_WORKSPACE = path.join(OPENCLAW_HOME, 'workspace');
const IMAGE_MIME_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif'
};
function getArtifactMimeType(filePath) {
    return IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}
function resolveAgentRoots(agentId) {
    const id = (agentId || 'main').trim() || 'main';
    const roots = [];
    if (id === 'main') {
        roots.push(MAIN_WORKSPACE);
    }
    else {
        // Preferred dedicated workspace pattern used by this setup
        roots.push(path.join(OPENCLAW_HOME, `workspace-${id}`));
        // Legacy/alternate layouts
        roots.push(path.join(OPENCLAW_HOME, 'agents', id, 'workspace'));
        roots.push(path.join(OPENCLAW_HOME, 'agents', id));
        // Last-resort fallback
        roots.push(MAIN_WORKSPACE);
    }
    const uniq = Array.from(new Set(roots));
    return uniq.filter((p) => fs.existsSync(p));
}
function listAgents() {
    const out = [];
    const seen = new Set();
    const add = (id, name) => {
        if (seen.has(id))
            return;
        const roots = resolveAgentRoots(id);
        const ws = roots[0] || MAIN_WORKSPACE;
        out.push({ id, name: name || id.toUpperCase(), workspace: ws });
        seen.add(id);
    };
    add('main', 'Dot');
    const agentsDir = path.join(OPENCLAW_HOME, 'agents');
    if (fs.existsSync(agentsDir)) {
        for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            add(entry.name);
        }
    }
    // also detect from sessions paths across system to avoid missing discovered agents
    try {
        const sessionsRoot = path.join(OPENCLAW_HOME, 'agents');
        if (fs.existsSync(sessionsRoot)) {
            for (const a of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
                if (a.isDirectory())
                    add(a.name);
            }
        }
    }
    catch { }
    // detect workspace-* style agent workspaces (e.g. workspace-o2)
    try {
        for (const e of fs.readdirSync(OPENCLAW_HOME, { withFileTypes: true })) {
            if (!e.isDirectory())
                continue;
            const m = e.name.match(/^workspace-(.+)$/);
            if (!m)
                continue;
            const id = m[1];
            if (id)
                add(id);
        }
    }
    catch { }
    return out;
}
function resolveAgentWorkspace(agentId) {
    const roots = resolveAgentRoots(agentId);
    return roots[0] || MAIN_WORKSPACE;
}
function sanitizeSoulPath(inputPath) {
    const p = String(inputPath || '').trim();
    const allowed = new Set(['SOUL.md', 'MEMORY.md', 'IDENTITY.md']);
    if (!allowed.has(p))
        throw new Error('Path not allowed');
    return p;
}
function readOpenClawConfig() {
    try {
        const cfgPath = path.join(OPENCLAW_HOME, 'openclaw.json');
        if (!fs.existsSync(cfgPath))
            return {};
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
    catch {
        return {};
    }
}
function safeExecJson(cmd, timeoutMs = 8000) {
    try {
        const out = execSync(cmd, { encoding: 'utf8', timeout: timeoutMs });
        return JSON.parse(out);
    }
    catch {
        return null;
    }
}
function safeExecText(cmd, timeoutMs = 8000) {
    try {
        return String(execSync(cmd, { encoding: 'utf8', timeout: timeoutMs }) || '');
    }
    catch {
        return '';
    }
}
function parseReadySkillsFromCliTable(text) {
    const out = new Set();
    for (const raw of String(text || '').split('\n')) {
        const line = String(raw || '');
        if (!line.includes('│'))
            continue;
        if (!line.includes('✓ ready'))
            continue;
        const parts = line.split('│').map(s => s.trim()).filter(Boolean);
        if (parts.length < 2)
            continue;
        const skillCell = parts[1] || '';
        const skillName = skillCell.replace(/^[^a-zA-Z0-9]+/, '').trim();
        if (skillName)
            out.add(skillName);
    }
    return [...out];
}
function getRuntimeConfigSummary() {
    const config = readOpenClawConfig();
    const status = safeExecJson('openclaw status --json', 6000) || {};
    const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    const aliases = config?.agents?.defaults?.models || {};
    const defaultModel = String(config?.agents?.defaults?.model?.primary || '').trim();
    const heartbeatModel = String(config?.agents?.defaults?.heartbeat?.model || '').trim();
    const modelMap = new Map();
    const ensureModel = (id) => {
        const key = String(id || '').trim();
        if (!key)
            return null;
        if (!modelMap.has(key)) {
            const alias = aliases?.[key]?.alias ? String(aliases[key].alias) : null;
            const providerRaw = key.split('/')[0] || '';
            const provider = providerRaw === 'google' ? 'Google'
                : providerRaw === 'anthropic' ? 'Anthropic'
                    : providerRaw.startsWith('openai') ? 'OpenAI'
                        : providerRaw || 'Unknown';
            const short = key.split('/')[1] || key;
            const label = short
                .replace(/^gpt-/, 'GPT-')
                .replace(/^gemini-/, 'Gemini ')
                .replace(/^claude-/, 'Claude ')
                .replace(/-/g, ' ')
                .replace(/\b\w/g, (m) => m.toUpperCase());
            modelMap.set(key, { id: key, alias, provider, label, agentIds: [], flags: [] });
        }
        return modelMap.get(key);
    };
    ensureModel(defaultModel);
    ensureModel(heartbeatModel);
    // Ensure ALL models from the aliases/models config are registered,
    // not just those actively assigned to an agent
    if (aliases && typeof aliases === 'object') {
        for (const modelKey of Object.keys(aliases)) {
            ensureModel(modelKey);
        }
    }
    // Also pick up the image generation model if configured
    const imageGenModel = String(config?.agents?.defaults?.imageGenerationModel?.primary || '').trim();
    if (imageGenModel) {
        const imgEntry = ensureModel(imageGenModel);
        if (imgEntry)
            imgEntry.flags.push('IMAGE_GEN');
    }
    for (const agent of agents) {
        const modelId = String(agent?.model?.primary || defaultModel || '').trim();
        const entry = ensureModel(modelId);
        if (entry && agent?.id)
            entry.agentIds.push(String(agent.id));
    }
    for (const entry of modelMap.values()) {
        if (entry.id === defaultModel)
            entry.flags.push('DEFAULT');
        if (entry.id === heartbeatModel)
            entry.flags.push('HEARTBEAT');
    }
    const skillsText = safeExecText('openclaw skills list', 10000);
    const readySkills = parseReadySkillsFromCliTable(skillsText);
    const channels = config?.channels || {};
    const plugins = [];
    if (channels?.telegram?.enabled)
        plugins.push({ name: 'Telegram', meta: 'configured', enabled: true });
    if (status?.memoryPlugin?.enabled)
        plugins.push({ name: 'Memory', meta: 'enabled', enabled: true });
    if ((status?.agents?.agents || []).length > 0)
        plugins.push({ name: 'Sessions', meta: `${(status?.agents?.agents || []).length} agents`, enabled: true });
    if (status?.gateway?.reachable)
        plugins.push({ name: 'Gateway', meta: 'reachable', enabled: true });
    if (fs.existsSync(path.join(OPENCLAW_HOME, 'browser')))
        plugins.push({ name: 'Browser', meta: 'available', enabled: true });
    if (fs.existsSync(path.join(OPENCLAW_HOME, 'canvas')))
        plugins.push({ name: 'Canvas', meta: 'available', enabled: true });
    if (config?.agents?.defaults?.imageModel || config?.agents?.defaults?.imageGenerationModel)
        plugins.push({ name: 'Image/PDF', meta: 'configured', enabled: true });
    return {
        agents: agents.map((a) => ({ id: String(a.id || ''), name: String(a.name || a.id || '') })),
        models: [...modelMap.values()],
        skills: readySkills,
        plugins
    };
}
function detectCapabilities(files) {
    const caps = [];
    if (files.includes('SKILL.md'))
        caps.push('Skill');
    if (files.includes('package.json'))
        caps.push('Node');
    if (files.some(f => f.endsWith('.py')))
        caps.push('Python');
    if (files.some(f => f.toLowerCase().includes('cron')))
        caps.push('Scheduled');
    return caps;
}
function analyzeProject(projectPath) {
    const info = {
        name: path.basename(projectPath),
        path: projectPath,
        description: 'Project workspace',
        capabilities: [],
        isRunning: false,
        workspaceName: 'Main Workspace'
    };
    try {
        const files = fs.readdirSync(projectPath);
        info.capabilities = detectCapabilities(files);
        const pkgPath = path.join(projectPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                if (pkg.name)
                    info.name = pkg.name;
                if (pkg.description)
                    info.description = pkg.description;
            }
            catch { }
        }
        const status = safeExecJson('openclaw status --json', 6000);
        const statusText = JSON.stringify(status || {});
        if (statusText.includes(path.basename(projectPath)))
            info.isRunning = true;
    }
    catch { }
    return info;
}
function getWorkspaceRoots() {
    const roots = new Set();
    const config = readOpenClawConfig();
    try {
        if (config?.agents?.defaults?.workspace)
            roots.add(config.agents.defaults.workspace);
        if (Array.isArray(config?.agents?.list)) {
            for (const a of config.agents.list) {
                if (a?.workspace)
                    roots.add(String(a.workspace));
            }
        }
    }
    catch { }
    roots.add(MAIN_WORKSPACE);
    try {
        if (fs.existsSync(OPENCLAW_HOME)) {
            for (const item of fs.readdirSync(OPENCLAW_HOME, { withFileTypes: true })) {
                if (item.isDirectory() && item.name.startsWith('workspace')) {
                    roots.add(path.join(OPENCLAW_HOME, item.name));
                }
            }
        }
    }
    catch { }
    return Array.from(roots).filter((r) => fs.existsSync(r));
}
function writeAudit(action, target, status, details, actor) {
    try {
        db.prepare(`
      INSERT INTO audit_events (id, timestamp, actor, action, target, status, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ulid(), new Date().toISOString(), actor || null, action, target, status, JSON.stringify(details || {}));
    }
    catch {
        // no-op
    }
}
const networkSeen = new Map();
let canUseLsof = null;
let canUseSs = null;
const NETWORK_SCOPE = String(process.env.OBSERVECLAW_NETWORK_SCOPE || 'openclaw').toLowerCase();
const NETWORK_SCOPE_REFRESH_MS = Number(process.env.OBSERVECLAW_NETWORK_SCOPE_REFRESH_MS || '30000');
const NETWORK_CONNECTION_SAMPLE_MS = Number(process.env.OBSERVECLAW_NETWORK_CONNECTION_SAMPLE_MS || (process.platform === 'linux' ? '120000' : '60000'));
const PULSE_SYNC_MS = Number(process.env.OBSERVECLAW_PULSE_SYNC_MS || '5000');
const RETENTION_CRON_POLL_MS = Number(process.env.OBSERVECLAW_RETENTION_CRON_POLL_MS || '15000');
const NETWORK_POLICY = loadNetworkPolicyConfig(process.env);
const trackedNetworkPids = new Set();
const networkPolicyDrops = new Map();
const pulseEngine = new PulseEngine({
    staleWarnMs: 10_000,
    disconnectTimeoutMs: 30_000,
    collaborationHoldMs: 1_000,
    minActiveDwellMs: 3_000
});
let pulseLastRowId = 0;
let retentionCronLastRowId = 0;
const pulseSeenEventIds = [];
const pulseSeenEventSet = new Set();
const retentionTriggerSeen = new Set();
const PULSE_DEBUG = process.env.OBSERVECLAW_PULSE_DEBUG === '1';
const jobRunLocks = new Set();
async function runJobIfIdle(name, fn) {
    if (jobRunLocks.has(name))
        return false;
    jobRunLocks.add(name);
    try {
        await fn();
        return true;
    }
    catch (err) {
        writeAudit('job.interval', name, 'error', { error: String(err?.message || err) }, 'system');
        return false;
    }
    finally {
        jobRunLocks.delete(name);
    }
}
function markPulseSeen(eventId) {
    const id = String(eventId || '');
    if (!id || pulseSeenEventSet.has(id))
        return;
    pulseSeenEventSet.add(id);
    pulseSeenEventIds.push(id);
    if (pulseSeenEventIds.length > 50000) {
        const drop = pulseSeenEventIds.shift();
        if (drop)
            pulseSeenEventSet.delete(drop);
    }
}
function hasPulseSeen(eventId) {
    const id = String(eventId || '');
    return !!id && pulseSeenEventSet.has(id);
}
function maybeHandleRetentionTrigger(row) {
    const id = String(row?.id || '');
    if (!id || retentionTriggerSeen.has(id))
        return;
    if (String(row?.type || '') !== 'cron')
        return;
    const ts = Date.parse(String(row?.timestamp || ''));
    if (Number.isFinite(ts)) {
        const ageMs = Date.now() - ts;
        if (ageMs > 3 * 60 * 1000) {
            retentionTriggerSeen.add(id);
            return;
        }
    }
    let data = {};
    try {
        data = typeof row?.data === 'string' ? JSON.parse(row.data) : (row?.data || {});
    }
    catch { }
    const action = String(data?.action || '').toLowerCase();
    if (action && action !== 'finished')
        return;
    const marker = [
        String(data?.event || ''),
        String(data?.systemEvent || ''),
        String(data?.payload || ''),
        String(data?.summary || ''),
        String(row?.summary || '')
    ].join(' ');
    if (!marker.includes('OBSERVECLAW_RETENTION_RUN'))
        return;
    retentionTriggerSeen.add(id);
    writeAudit('retention.trigger', 'cron', 'ok', { id, marker: marker.slice(0, 120) }, 'system');
    runRetentionSweep('interval');
}
function pollRetentionCronTriggers() {
    try {
        const rows = db.prepare(`
      SELECT rowid as _rowid, id, timestamp, type, summary, data
      FROM normalized_events
      WHERE type = 'cron' AND rowid > ?
      ORDER BY rowid ASC
      LIMIT 200
    `).all(retentionCronLastRowId);
        if (!rows.length)
            return;
        for (const r of rows) {
            maybeHandleRetentionTrigger(r);
            const rid = Number(r?._rowid || 0);
            if (rid > retentionCronLastRowId)
                retentionCronLastRowId = rid;
        }
    }
    catch { }
}
function normalizeHost(host) {
    return String(host || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}
function bumpNetworkPolicyDrop(reason) {
    networkPolicyDrops.set(reason, (networkPolicyDrops.get(reason) || 0) + 1);
}
function getNetworkPolicyStats() {
    const dropReasons = Object.fromEntries(Array.from(networkPolicyDrops.entries()).sort((a, b) => b[1] - a[1]));
    const summary = db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'network.connect' AND lower(COALESCE(json_extract(data, '$.direction'), 'outbound')) = 'outbound' THEN 1 ELSE 0 END) AS outbound,
      SUM(CASE WHEN type = 'network.inbound' OR (type = 'network.connect' AND lower(COALESCE(json_extract(data, '$.direction'), '')) = 'inbound') THEN 1 ELSE 0 END) AS inbound,
      SUM(CASE WHEN type IN ('network.connect','network.inbound') THEN 1 ELSE 0 END) AS total
    FROM normalized_events
    WHERE domain = 'network'
  `).get();
    return {
        config: {
            logIncoming: NETWORK_POLICY.logIncoming,
            excludeLocalhost: NETWORK_POLICY.excludeLocalhost,
            excludeModelHosts: NETWORK_POLICY.excludeModelHosts,
            excludeChannelHosts: NETWORK_POLICY.excludeChannelHosts,
            denyHosts: NETWORK_POLICY.denyHosts,
            denyCidrs: NETWORK_POLICY.denyCidrs,
            modelHosts: NETWORK_POLICY.modelHosts,
            modelCidrs: NETWORK_POLICY.modelCidrs,
            channelHosts: NETWORK_POLICY.channelHosts,
            channelCidrs: NETWORK_POLICY.channelCidrs
        },
        droppedByReason: dropReasons,
        logged: {
            outbound: Number(summary?.outbound || 0),
            inbound: Number(summary?.inbound || 0),
            total: Number(summary?.total || 0)
        }
    };
}
function parseHostPort(raw) {
    const s = String(raw || '').trim().replace(/\s+\([^)]*\)$/, '');
    if (!s)
        return null;
    // IPv6 in brackets: [addr]:port
    const ipv6 = s.match(/^\[(.+)\]:(\d+)$/);
    if (ipv6) {
        return { host: normalizeHost(ipv6[1] || ''), port: Number(ipv6[2] || 0) };
    }
    const idx = s.lastIndexOf(':');
    if (idx <= 0)
        return null;
    const host = normalizeHost(s.slice(0, idx));
    const port = Number(s.slice(idx + 1));
    if (!host || !Number.isFinite(port) || port <= 0)
        return null;
    return { host, port };
}
async function getListeningPortsByPidLsof() {
    const out = new Map();
    const { stdout: raw } = await execFileAsync('lsof', ['-n', '-P', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 8000 });
    const lines = raw.split('\n').slice(1).filter(Boolean);
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9)
            continue;
        const pid = Number(parts[1] || 0);
        if (!Number.isFinite(pid) || pid <= 0)
            continue;
        const name = parts.slice(8).join(' ');
        const hp = parseHostPort(name.split('->')[0] || name);
        if (!hp)
            continue;
        if (!out.has(pid))
            out.set(pid, new Set());
        out.get(pid).add(hp.port);
    }
    return out;
}
async function getListeningPortsByPidSs() {
    const out = new Map();
    // On Linux, NEVER use -p flag — it forces full /proc/*/fd/ traversal causing dcache lock contention
    const isLinux = process.platform === 'linux';
    const args = isLinux ? ['-tln'] : ['-tlnp'];
    const { stdout: raw } = await execFileAsync('ss', args, { encoding: 'utf8', timeout: 8000 });
    const lines = raw.split('\n').slice(1).filter(Boolean);
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4)
            continue;
        const localAddr = parts[3] || '';
        const portMatch = localAddr.match(/:(\d+)$/);
        if (!portMatch)
            continue;
        const port = Number(portMatch[1]);
        if (!Number.isFinite(port) || port <= 0)
            continue;
        if (!isLinux) {
            // Non-Linux: extract PID from process info
            const pidMatch = line.match(/pid=(\d+)/);
            if (!pidMatch)
                continue;
            const pid = Number(pidMatch[1]);
            if (pid > 0) {
                if (!out.has(pid))
                    out.set(pid, new Set());
                out.get(pid).add(port);
            }
        }
        else {
            // Linux: store port with pid=0 — PID resolution happens via tracked port matching
            if (!out.has(0))
                out.set(0, new Set());
            out.get(0).add(port);
        }
    }
    return out;
}
async function getListeningPortsByPid() {
    try {
        if (process.platform === 'linux') {
            // Linux: ONLY use ss without -p to avoid /proc traversal
            if (canUseSs !== false)
                return await getListeningPortsByPidSs();
            return new Map();
        }
        // macOS/other: lsof is safe (uses Mach APIs, no /proc contention)
        if (canUseLsof === true || (canUseLsof === null && process.platform === 'darwin')) {
            return await getListeningPortsByPidLsof();
        }
        if (canUseSs === true) {
            return await getListeningPortsByPidSs();
        }
        try {
            return await getListeningPortsByPidLsof();
        }
        catch {
            return await getListeningPortsByPidSs();
        }
    }
    catch {
        // best effort
    }
    return new Map();
}
function isPublicHost(host) {
    const h = normalizeHost(host);
    if (!h)
        return false;
    if (h === 'localhost' || h === '::1' || h === '0.0.0.0')
        return false;
    if (h.startsWith('127.'))
        return false;
    const ipType = net.isIP(h);
    if (ipType === 4) {
        if (h.startsWith('10.'))
            return false;
        if (h.startsWith('192.168.'))
            return false;
        if (h.startsWith('169.254.'))
            return false;
        const m = h.match(/^172\.(\d+)\./);
        if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31)
            return false;
        return true;
    }
    if (ipType === 6) {
        if (h.startsWith('fe80:'))
            return false; // link-local
        if (h.startsWith('fc') || h.startsWith('fd'))
            return false; // unique-local
        return true;
    }
    return true; // hostname/FQDN assumed external
}
async function refreshTrackedNetworkPids() {
    if (NETWORK_SCOPE !== 'openclaw')
        return;
    try {
        const { stdout: out } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 8000 });
        const rows = out.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
            const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
            if (!m)
                return null;
            return { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] };
        }).filter(Boolean);
        const roots = new Set([process.pid]);
        const rootRe = /(openclaw-gateway|workspace\/observeclaw\/src\/server\.ts|workspace\/echo|\/echo-ai\b|\becho\s+ai\b)/i;
        for (const r of rows) {
            if (rootRe.test(r.cmd || ''))
                roots.add(r.pid);
        }
        const children = new Map();
        for (const r of rows) {
            if (!children.has(r.ppid))
                children.set(r.ppid, []);
            children.get(r.ppid).push(r.pid);
        }
        const seen = new Set();
        const stack = Array.from(roots);
        while (stack.length) {
            const pid = stack.pop();
            if (seen.has(pid))
                continue;
            seen.add(pid);
            const kids = children.get(pid) || [];
            for (const k of kids)
                stack.push(k);
        }
        trackedNetworkPids.clear();
        for (const p of seen)
            trackedNetworkPids.add(p);
    }
    catch { }
}
function emitNetworkEvent(evt) {
    const id = ulid();
    const ts = new Date().toISOString();
    db.prepare(`
    INSERT INTO normalized_events (id, rawEventId, timestamp, domain, type, severity, agentId, sessionKey, channel, summary, data)
    VALUES (?, NULL, ?, 'network', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ts, evt.type || 'network.connect', evt.severity || 'info', evt.agentId || null, evt.sessionKey || null, null, evt.summary || 'Network connection observed', JSON.stringify(evt));
    eventBus.broadcast({
        id,
        timestamp: ts,
        domain: 'network',
        type: evt.type || 'network.connect',
        severity: evt.severity || 'info',
        agentId: evt.agentId || null,
        sessionKey: evt.sessionKey || null,
        channel: null,
        summary: evt.summary || 'Network connection observed',
        data: JSON.stringify(evt)
    });
}
function detectNetworkTools() {
    if (canUseLsof !== null || canUseSs !== null)
        return;
    try {
        execSync('command -v lsof', { stdio: 'ignore' });
        canUseLsof = true;
    }
    catch {
        canUseLsof = false;
    }
    try {
        execSync('command -v ss', { stdio: 'ignore' });
        canUseSs = true;
    }
    catch {
        canUseSs = false;
    }
    if (!canUseLsof && !canUseSs) {
        writeAudit('network.sample', 'init', 'warning', { error: 'Neither lsof nor ss available; relying on inferred network events' }, 'system');
    }
}
async function getEstablishedConnectionsLsof() {
    const { stdout: out } = await execFileAsync('lsof', ['-n', '-P', '-iTCP', '-sTCP:ESTABLISHED'], { encoding: 'utf8', timeout: 8000 });
    const lines = out.split('\n').slice(1).filter(Boolean);
    const results = [];
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9)
            continue;
        const command = parts[0] || '';
        const pid = Number(parts[1] || 0);
        const name = parts.slice(8).join(' ');
        const m = name.match(/(.+)->(.+)/);
        if (!m)
            continue;
        const local = parseHostPort(m[1] || '');
        const remote = parseHostPort(m[2] || '');
        if (!local || !remote)
            continue;
        results.push({ command, pid, local, remote });
    }
    return results;
}
async function getEstablishedConnectionsSs() {
    // On Linux, NEVER use -p flag — it forces full /proc/*/fd/ traversal causing dcache lock contention
    const isLinux = process.platform === 'linux';
    const args = isLinux ? ['-tnH'] : ['-tnpH'];
    const { stdout: out } = await execFileAsync('ss', args, { encoding: 'utf8', timeout: 8000 });
    const lines = out.split('\n').filter(Boolean);
    const results = [];
    for (const line of lines) {
        if (!line.includes('ESTAB'))
            continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5)
            continue;
        const localAddr = parts[3] || '';
        const peerAddr = parts[4] || '';
        const local = parseHostPort(localAddr);
        const remote = parseHostPort(peerAddr);
        if (!local || !remote)
            continue;
        if (isLinux) {
            // No PID info available — will be inferred via port matching in sampleNetworkConnections
            results.push({ command: 'unknown', pid: 0, local, remote });
        }
        else {
            const processInfo = parts.slice(5).join(' ');
            const pidMatch = processInfo.match(/pid=(\d+)/);
            const cmdMatch = processInfo.match(/\("([^"]+)"/);
            const pid = pidMatch ? Number(pidMatch[1]) : 0;
            const command = cmdMatch?.[1] ?? 'unknown';
            if (pid <= 0)
                continue;
            results.push({ command, pid, local, remote });
        }
    }
    return results;
}
async function getEstablishedConnections() {
    if (process.platform === 'linux') {
        // Linux: ONLY use ss without -p to avoid /proc traversal
        if (canUseSs !== false)
            return await getEstablishedConnectionsSs();
        return [];
    }
    // macOS/other: lsof is safe
    if (canUseLsof)
        return await getEstablishedConnectionsLsof();
    if (canUseSs)
        return await getEstablishedConnectionsSs();
    return [];
}
async function sampleNetworkConnections() {
    try {
        detectNetworkTools();
        if (!canUseLsof && !canUseSs)
            return;
        if (NETWORK_SCOPE === 'openclaw' && trackedNetworkPids.size === 0)
            return;
        const listeningPortsByPid = await getListeningPortsByPid();
        const connections = await getEstablishedConnections();
        const now = Date.now();
        // Build a reverse map: port → pid set (for Linux port-based inference)
        const portToPids = new Map();
        for (const [pid, ports] of listeningPortsByPid) {
            for (const port of ports) {
                if (!portToPids.has(port))
                    portToPids.set(port, new Set());
                portToPids.get(port).add(pid);
            }
        }
        // Build set of all listening ports owned by tracked PIDs (for Linux port-based scope filtering)
        const trackedListeningPorts = new Set();
        if (process.platform === 'linux' && NETWORK_SCOPE === 'openclaw') {
            for (const pid of trackedNetworkPids) {
                const ports = listeningPortsByPid.get(pid);
                if (ports)
                    for (const p of ports)
                        trackedListeningPorts.add(p);
            }
            // On Linux without -p, also include all known listening ports (pid=0 bucket)
            const unknownPorts = listeningPortsByPid.get(0);
            if (unknownPorts)
                for (const p of unknownPorts)
                    trackedListeningPorts.add(p);
        }
        for (const conn of connections) {
            const { command, pid: pidNum, local, remote } = conn;
            if (NETWORK_SCOPE === 'openclaw') {
                if (process.platform === 'linux') {
                    // Linux: no PID from ss, so infer ownership via port matching
                    // A connection belongs to us if its local port matches a tracked listening port,
                    // or if it originates from our known service ports
                    const isTrackedInbound = trackedListeningPorts.has(local.port);
                    const isTrackedOutbound = trackedListeningPorts.has(local.port) || trackedNetworkPids.size > 0;
                    if (!isTrackedInbound && !isTrackedOutbound)
                        continue;
                }
                else {
                    if (!Number.isFinite(pidNum) || !trackedNetworkPids.has(pidNum))
                        continue;
                    // Narrow to OpenClaw service/runtime processes; exclude browser/system helpers.
                    if (!/(openclaw-gateway|^node$|^openclaw$|echo)/i.test(command))
                        continue;
                }
            }
            const listenSet = pidNum > 0 ? listeningPortsByPid.get(pidNum) : null;
            // On Linux (pid=0), check all listening ports for direction inference
            const allListenPorts = process.platform === 'linux' ? (listeningPortsByPid.get(0) || new Set()) : new Set();
            const inferredDirection = (listenSet?.has(local.port) || allListenPorts.has(local.port)) ? 'inbound' : 'outbound';
            if (inferredDirection === 'inbound' && !NETWORK_POLICY.logIncoming)
                continue;
            const policy = evaluateNetworkPolicy(NETWORK_POLICY, inferredDirection, remote.host);
            if (!policy.allow && policy.reason) {
                bumpNetworkPolicyDrop(policy.reason);
                continue;
            }
            const eventType = inferredDirection === 'inbound' ? 'network.inbound' : 'network.connect';
            const key = `${eventType}:${pidNum}:${remote.host}:${remote.port}`;
            const last = networkSeen.get(key) || 0;
            const dedupeMs = eventType === 'network.connect' ? 300000 : 120000;
            if (now - last < dedupeMs)
                continue;
            networkSeen.set(key, now);
            const remoteIp = net.isIP(remote.host) ? remote.host : null;
            emitNetworkEvent({
                type: eventType,
                severity: 'info',
                process: command,
                pid: pidNum,
                direction: inferredDirection,
                host: remote.host,
                port: remote.port,
                localHost: local.host,
                localPort: local.port,
                remoteHost: remote.host,
                remotePort: remote.port,
                remoteIp,
                resolvedIp: remoteIp,
                source: 'socket-observed',
                sourceType: 'socket-observed',
                inferred: true,
                commandClass: 'socket-flow',
                attributionConfidence: remoteIp ? 'medium' : 'low',
                protocol: 'tcp',
                isPublic: isPublicHost(remote.host),
                excludedByPolicy: 0,
                excludeReason: null,
                policyVersion: 1,
                summary: inferredDirection === 'inbound'
                    ? `${command} accepted inbound from ${remote.host}:${remote.port}`
                    : `${command} connected to ${remote.host}:${remote.port}`
            });
        }
        // cleanup stale dedupe entries
        for (const [k, t] of networkSeen.entries()) {
            if (now - t > 30 * 60 * 1000)
                networkSeen.delete(k);
        }
    }
    catch (err) {
        writeAudit('network.sample', 'network', 'error', { error: String(err?.message || err) }, 'system');
    }
}
const QUIET_AUTH_ROUTES = new Set([
    '/api/pulse',
    '/api/alerts',
    '/api/ingest-policy/stats',
    '/api/auth/status'
]);
const PUBLIC_AUTH_ROUTES = new Set([
    '/api/auth/login',
    '/api/auth/logout'
]);
server.addHook('preHandler', async (request, reply) => {
    if (!String(request.url).startsWith('/api'))
        return;
    const rawPath = String(request.url || '').split('?')[0] || '';
    const routePath = String(request.routerPath || request.routeOptions?.url || rawPath || '').split('?')[0] || '';
    const authPath = routePath || rawPath;
    if (PUBLIC_AUTH_ROUTES.has(authPath))
        return;
    const shouldAuditAllowedAuth = !(request.method === 'GET' && QUIET_AUTH_ROUTES.has(authPath));
    // No password configured = open mode (no auth required)
    if (!OPERATOR_PASSWORD) {
        request.ocAuthorized = true;
        request.ocAuthMode = 'open';
        return;
    }
    const provided = String(request.headers['x-observeclaw-password'] || '');
    const sessionAuthorized = requestHasValidSessionCookie(request);
    const headerAuthorized = !!provided && provided === OPERATOR_PASSWORD;
    const authorized = sessionAuthorized || headerAuthorized;
    if (!authorized) {
        writeAudit('auth.api', request.url, 'denied', { method: request.method }, String(request.ip));
        return reply.code(401).send({ error: 'Unauthorized' });
    }
    request.ocAuthorized = true;
    request.ocAuthMode = sessionAuthorized ? 'session' : 'header';
    if (shouldAuditAllowedAuth) {
        writeAudit('auth.api', authPath || request.url, 'allowed', { method: request.method, authorized: true, mode: request.ocAuthMode }, String(request.ip));
    }
});
// Basic Health Check
server.get('/health', async (request, reply) => {
    return { status: 'ok', time: new Date().toISOString(), telegramNotifierConfigured: telegramNotifierConfigured() };
});
const getOpenClawVersion = (() => {
    let cached = '';
    let fetchedAt = 0;
    return () => {
        const now = Date.now();
        if (cached && now - fetchedAt < 5 * 60 * 1000)
            return cached;
        try {
            cached = String(execSync('openclaw --version', { encoding: 'utf8', timeout: 5000 }) || '').trim();
            fetchedAt = now;
            return cached;
        }
        catch {
            return cached || 'Unknown';
        }
    };
})();
const getObserveClawVersion = (() => {
    let cached = '';
    let fetchedAt = 0;
    return () => {
        const now = Date.now();
        if (cached && now - fetchedAt < 60 * 1000)
            return cached;
        try {
            const pkgPath = path.join(__dirname, '..', 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            cached = String(pkg?.version || '').trim() || 'Unknown';
            fetchedAt = now;
            return cached;
        }
        catch {
            return cached || 'Unknown';
        }
    };
})();
const extractVersionNumber = (input) => {
    const match = String(input || '').match(/(\d+\.\d+\.\d+)/);
    return match?.[1] || null;
};
const compareDottedVersions = (a, b) => {
    if (!a || !b)
        return 0;
    const ap = a.split('.').map((n) => parseInt(n, 10));
    const bp = b.split('.').map((n) => parseInt(n, 10));
    const len = Math.max(ap.length, bp.length);
    for (let i = 0; i < len; i++) {
        const av = ap[i] || 0;
        const bv = bp[i] || 0;
        if (av > bv)
            return 1;
        if (av < bv)
            return -1;
    }
    return 0;
};
const todayLocalDate = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
async function fetchLatestOpenClawVersion() {
    const res = await fetch('https://registry.npmjs.org/openclaw/latest');
    if (!res.ok)
        throw new Error(`npm registry responded ${res.status}`);
    const json = await res.json();
    const latest = String(json?.version || '').trim();
    if (!latest)
        throw new Error('latest version missing from npm response');
    return { latest, source: 'npm' };
}
async function getPersistedOpenClawVersionStatus() {
    const installedDisplay = getOpenClawVersion();
    const installedVersion = extractVersionNumber(installedDisplay) || installedDisplay || 'Unknown';
    const checkDate = todayLocalDate();
    const existing = db.prepare('SELECT * FROM version_checks WHERE checkDate = ?').get(checkDate);
    if (existing && String(existing.installedVersion || '') === String(installedVersion || '')) {
        return {
            current: installedDisplay,
            installed: installedVersion,
            latest: existing.latestVersion || null,
            updateAvailable: !!existing.updateAvailable,
            status: existing.status || 'unknown',
            source: existing.source || null,
            checkedAt: existing.checkedAt || null,
            error: existing.error || null
        };
    }
    try {
        const { latest, source } = await fetchLatestOpenClawVersion();
        const updateAvailable = compareDottedVersions(installedVersion, latest) < 0;
        const checkedAt = new Date().toISOString();
        db.prepare(`
      INSERT INTO version_checks (checkDate, installedVersion, installedDisplay, latestVersion, updateAvailable, status, source, checkedAt, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(checkDate) DO UPDATE SET
        installedVersion = excluded.installedVersion,
        installedDisplay = excluded.installedDisplay,
        latestVersion = excluded.latestVersion,
        updateAvailable = excluded.updateAvailable,
        status = excluded.status,
        source = excluded.source,
        checkedAt = excluded.checkedAt,
        error = excluded.error
    `).run(checkDate, installedVersion, installedDisplay, latest, updateAvailable ? 1 : 0, updateAvailable ? 'update-available' : 'current', source, checkedAt);
        return { current: installedDisplay, installed: installedVersion, latest, updateAvailable, status: updateAvailable ? 'update-available' : 'current', source, checkedAt, error: null };
    }
    catch (err) {
        const checkedAt = new Date().toISOString();
        const error = String(err?.message || err || 'unknown error');
        db.prepare(`
      INSERT INTO version_checks (checkDate, installedVersion, installedDisplay, latestVersion, updateAvailable, status, source, checkedAt, error)
      VALUES (?, ?, ?, NULL, 0, 'unknown', NULL, ?, ?)
      ON CONFLICT(checkDate) DO UPDATE SET
        installedVersion = excluded.installedVersion,
        installedDisplay = excluded.installedDisplay,
        latestVersion = excluded.latestVersion,
        updateAvailable = excluded.updateAvailable,
        status = excluded.status,
        source = excluded.source,
        checkedAt = excluded.checkedAt,
        error = excluded.error
    `).run(checkDate, installedVersion, installedDisplay, checkedAt, error);
        return { current: installedDisplay, installed: installedVersion, latest: null, updateAvailable: false, status: 'unknown', source: null, checkedAt, error };
    }
}
const getMemoryStatus = () => {
    const total = os.totalmem();
    // macOS os.freemem() only counts truly free pages, not inactive/purgeable.
    // Use vm_stat to get accurate "app memory" (wired + active + compressed).
    if (process.platform === 'darwin') {
        try {
            const vm = execSync('vm_stat', { timeout: 2000 }).toString();
            // Parse page size from vm_stat header ("Mach Virtual Memory Statistics: (page size of NNNNN bytes)")
            const pageSizeMatch = vm.match(/page size of (\d+) bytes/);
            const pageSize = pageSizeMatch?.[1] ? parseInt(pageSizeMatch[1], 10) : 16384;
            const get = (label) => {
                const m = vm.match(new RegExp(label + ':\\s+(\\d+)'));
                return m?.[1] ? parseInt(m[1], 10) * pageSize : 0;
            };
            const used = get('Pages wired down') + get('Pages active') + get('Pages occupied by compressor');
            return { free: Math.max(0, total - used), total, used, percentUsed: total > 0 ? Math.round((used / total) * 100) : 0 };
        }
        catch { /* fall through */ }
    }
    // Linux: /proc/meminfo gives accurate available memory (includes reclaimable buffers/cache).
    if (process.platform === 'linux') {
        try {
            const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
            const get = (key) => {
                const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
                return m?.[1] ? parseInt(m[1], 10) * 1024 : 0; // /proc/meminfo reports in kB
            };
            const memAvailable = get('MemAvailable');
            if (memAvailable > 0) {
                const used = Math.max(0, total - memAvailable);
                return { free: memAvailable, total, used, percentUsed: total > 0 ? Math.round((used / total) * 100) : 0 };
            }
        }
        catch { /* fall through */ }
    }
    const free = os.freemem();
    const used = total - free;
    return { free, total, used, percentUsed: total > 0 ? Math.round((used / total) * 100) : 0 };
};
const getOpenClawGatewayProcessInfo = () => {
    try {
        // Use full command line (args) so we can match both the 'openclaw-gateway' binary name
        // and node processes running openclaw (e.g. 'node /path/to/openclaw gateway start')
        const psFormat = process.platform === 'linux' ? 'pid=,args=,lstart=' : 'pid=,comm=,lstart=';
        const lines = execSync(`ps axo ${psFormat}`, { encoding: 'utf8', timeout: 2000 }).split('\n');
        let best = null;
        for (const rawLine of lines) {
            const line = String(rawLine || '').trim();
            if (!line)
                continue;
            const match = line.match(/^(\d+)\s+(\S+(?:\s+\S+)*?)\s{2,}(.+)$/);
            if (!match)
                continue;
            const pid = Number(match[1]);
            const cmdOrArgs = String(match[2] || '').trim();
            const started = new Date(String(match[3] || '').trim());
            // Match: binary named 'openclaw-gateway', or any command containing 'openclaw' with 'gateway'
            const isGateway = cmdOrArgs === 'openclaw-gateway'
                || (cmdOrArgs.includes('openclaw') && cmdOrArgs.includes('gateway'));
            if (!isGateway)
                continue;
            if (!Number.isFinite(pid) || pid <= 0)
                continue;
            if (isNaN(started.getTime())) {
                if (!best)
                    best = { pid, uptimeSeconds: Math.round(process.uptime()), startedMs: Number.POSITIVE_INFINITY };
                continue;
            }
            const startedMs = started.getTime();
            const uptimeSeconds = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
            if (!best || startedMs < best.startedMs) {
                best = { pid, uptimeSeconds, startedMs };
            }
        }
        if (best)
            return { pid: best.pid, uptimeSeconds: best.uptimeSeconds };
    }
    catch { /* fall through */ }
    return { pid: null, uptimeSeconds: Math.round(process.uptime()) };
};
const getOpenClawGatewayUptime = () => getOpenClawGatewayProcessInfo().uptimeSeconds;
const getPrimaryLocalIp = () => {
    try {
        const interfaces = os.networkInterfaces();
        for (const entries of Object.values(interfaces)) {
            for (const entry of entries || []) {
                if (!entry || entry.internal)
                    continue;
                if (entry.family === 'IPv4' && entry.address)
                    return entry.address;
            }
        }
    }
    catch { /* fall through */ }
    return null;
};
let _storageCache = null;
const STORAGE_CACHE_MS = 30_000; // refresh every 30s
const getStorageStatus = () => {
    if (_storageCache && Date.now() - _storageCache.ts < STORAGE_CACHE_MS)
        return _storageCache.result;
    // On macOS APFS, fs.statfsSync reports container-level totals which differ
    // from what Finder/df show (purgeable space, snapshots, etc).
    // volumeAvailableCapacityForImportantUsage includes purgeable — matches Finder.
    if (process.platform === 'darwin') {
        try {
            const out = execSync(`swift -e 'import Foundation; let u = try! FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false); let v = try! u.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey]); print(v.volumeTotalCapacity ?? 0); print(v.volumeAvailableCapacityForImportantUsage ?? 0)'`, { encoding: 'utf8', timeout: 5000 }).trim().split('\n');
            const total = parseInt(String(out[0] || '0'), 10);
            const free = parseInt(String(out[1] || '0'), 10);
            const used = Math.max(0, total - free);
            const result = { free, total, used, percentUsed: total > 0 ? Math.round((used / total) * 100) : 0 };
            _storageCache = { ts: Date.now(), result };
            return result;
        }
        catch { /* fall through */ }
    }
    try {
        const stats = fs.statfsSync(process.cwd());
        const total = Number(stats.bsize) * Number(stats.blocks);
        const free = Number(stats.bsize) * Number(stats.bavail);
        const used = Math.max(0, total - free);
        return { free, total, used, percentUsed: total > 0 ? Math.round((used / total) * 100) : 0 };
    }
    catch {
        return { free: 0, total: 0, used: 0, percentUsed: 0 };
    }
};
server.get('/api/system/status', async () => {
    const load = os.loadavg();
    const uptime = os.uptime();
    const gateway = getOpenClawGatewayProcessInfo();
    return {
        authorized: true,
        telegramNotifierConfigured: telegramNotifierConfigured(),
        memory: getMemoryStatus(),
        storage: getStorageStatus(),
        openclawVersion: getOpenClawVersion(),
        openclawUptime: gateway.uptimeSeconds,
        openclawPid: gateway.pid,
        hostname: os.hostname(),
        localIp: getPrimaryLocalIp(),
        load,
        uptime,
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length
    };
});
server.get('/api/openclaw/version-status', async () => {
    return await getPersistedOpenClawVersionStatus();
});
server.get('/api/system/config-summary', async () => {
    return getRuntimeConfigSummary();
});
server.get('/api/system/sidebar-meta', async () => {
    return {
        hostname: os.hostname(),
        observeclawVersion: getObserveClawVersion(),
        openclawVersion: getOpenClawVersion()
    };
});
server.get('/api/glance', async (request) => {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startSevenDays = new Date(now);
    startSevenDays.setHours(0, 0, 0, 0);
    startSevenDays.setDate(startSevenDays.getDate() - 6);
    const dayStarts = [6, 5, 4, 3, 2, 1, 0].map((daysAgo) => {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - daysAgo);
        return d;
    });
    const openAlerts = db.prepare('SELECT COUNT(*) as c FROM alerts WHERE acknowledged = 0').get()?.c || 0;
    const recentAlerts = db.prepare(`
    SELECT id, title, severity, timestamp
    FROM alerts
    WHERE acknowledged = 0
    ORDER BY timestamp DESC
    LIMIT 3
  `).all();
    const cronData = safeExecJson('openclaw cron list --json --all', 8000);
    const cronJobs = Array.isArray(cronData?.jobs) ? cronData.jobs : [];
    const cronEnabled = cronJobs.filter((job) => !!job?.enabled).length;
    const enabledCronJobs = cronJobs.filter((job) => !!job?.enabled);
    const nextCronRunMs = enabledCronJobs
        .map((job) => Number(job?.state?.nextRunAtMs || 0))
        .filter((ms) => Number.isFinite(ms) && ms > 0)
        .sort((a, b) => a - b)[0] || null;
    const externalRows = db.prepare(`
    SELECT timestamp, type, domain, summary, data
    FROM normalized_events
    WHERE timestamp >= ?
      AND type IN ('network.request', 'network.connect')
    ORDER BY timestamp ASC
  `).all(startSevenDays.toISOString());
    const parseExternalLabel = (row) => {
        let payload = null;
        try {
            payload = typeof row?.data === 'string' ? JSON.parse(row.data) : row?.data;
        }
        catch { }
        const candidates = [
            payload?.host,
            payload?.remoteHost,
            payload?.url,
            payload?.resolvedIp,
            payload?.remoteIp,
            row?.summary
        ].map((v) => String(v || '').trim()).filter(Boolean);
        for (const candidate of candidates) {
            if (!candidate)
                continue;
            if (candidate === 'network')
                continue;
            return candidate.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        }
        return '';
    };
    const isExternalLabel = (label) => {
        const v = String(label || '').toLowerCase();
        if (!v)
            return false;
        if (v === 'localhost' || v === '127.0.0.1' || v === '::1')
            return false;
        if (v.startsWith('192.168.') || v.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(v))
            return false;
        return true;
    };
    const normalizedExternalRows = externalRows.map((row) => ({ ...row, _label: parseExternalLabel(row) })).filter((row) => isExternalLabel(row._label));
    const perDay = dayStarts.map((start, idx) => {
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const items = normalizedExternalRows.filter((row) => row.timestamp >= start.toISOString() && row.timestamp < end.toISOString());
        const destinations = new Set(items.map((row) => String(row._label || '').trim()).filter(Boolean));
        return {
            label: idx === 6 ? 'TODAY' : start.toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
            shortLabel: idx === 6 ? 'TODAY' : start.toLocaleDateString([], { weekday: 'short' }).slice(0, 3).toUpperCase(),
            total: items.length,
            destinations: destinations.size
        };
    });
    const todayExternal = perDay[6] || { total: 0, destinations: 0 };
    const totalSevenDays = perDay.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const destinationCounts = new Map();
    for (const row of normalizedExternalRows) {
        const key = String(row?._label || '').trim();
        if (!key)
            continue;
        destinationCounts.set(key, Number(destinationCounts.get(key) || 0) + 1);
    }
    const topDestinationEntry = Array.from(destinationCounts.entries()).sort((a, b) => b[1] - a[1])[0] || null;
    // Activity stacked bar data (last 7 days)
    const activityDaily = dayStarts.map((start, idx) => {
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const toolCalls = db.prepare('SELECT COUNT(*) as c FROM normalized_events WHERE type = ? AND timestamp >= ? AND timestamp < ?').get('tool.invoke', startIso, endIso)?.c || 0;
        const modelCalls = db.prepare('SELECT COUNT(*) as c FROM normalized_events WHERE type = ? AND timestamp >= ? AND timestamp < ?').get('model.usage', startIso, endIso)?.c || 0;
        const conversationTurns = db.prepare('SELECT COUNT(*) as c FROM normalized_events WHERE type = ? AND timestamp >= ? AND timestamp < ?').get('message.processed', startIso, endIso)?.c || 0;
        const shellCmds = db.prepare("SELECT COUNT(*) as c FROM normalized_events WHERE type = 'tool.invoke' AND json_extract(data, '$.tool') = 'exec' AND timestamp >= ? AND timestamp < ?").get(startIso, endIso)?.c || 0;
        const fileMutations = db.prepare("SELECT COUNT(*) as c FROM normalized_events WHERE type = 'tool.invoke' AND json_extract(data, '$.tool') IN ('edit', 'write') AND timestamp >= ? AND timestamp < ?").get(startIso, endIso)?.c || 0;
        const webResearch = db.prepare("SELECT COUNT(*) as c FROM normalized_events WHERE type = 'tool.invoke' AND json_extract(data, '$.tool') IN ('web_search', 'web_fetch') AND timestamp >= ? AND timestamp < ?").get(startIso, endIso)?.c || 0;
        const browserActions = db.prepare("SELECT COUNT(*) as c FROM normalized_events WHERE type = 'tool.invoke' AND json_extract(data, '$.tool') = 'browser' AND timestamp >= ? AND timestamp < ?").get(startIso, endIso)?.c || 0;
        return {
            label: idx === 6 ? 'TODAY' : start.toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
            shortLabel: idx === 6 ? 'TODAY' : start.toLocaleDateString([], { weekday: 'short' }).slice(0, 3).toUpperCase(),
            toolCalls,
            modelCalls,
            conversationTurns,
            shellCmds,
            fileMutations,
            webResearch,
            browserActions
        };
    });
    const gateway = getOpenClawGatewayProcessInfo();
    const systemStatus = {
        memory: getMemoryStatus(),
        storage: getStorageStatus(),
        hostUptime: Math.round(os.uptime()),
        openclawUptime: gateway.uptimeSeconds,
        openclawPid: gateway.pid,
        openclawVersion: getOpenClawVersion(),
        hostname: os.hostname(),
        localIp: getPrimaryLocalIp()
    };
    const response = {
        alerts: {
            totalOpen: Number(openAlerts || 0),
            recent: recentAlerts
        },
        version: {
            current: systemStatus.openclawVersion,
            installed: extractVersionNumber(systemStatus.openclawVersion) || systemStatus.openclawVersion,
            updateAvailable: null,
            latest: null,
            status: 'pending',
            checkedAt: null
        },
        cron: {
            total: cronJobs.length,
            enabled: cronEnabled,
            nextRunAt: nextCronRunMs ? new Date(nextCronRunMs).toISOString() : null
        },
        externalConnections: {
            today: Number(todayExternal.total || 0),
            totalWeek: totalSevenDays,
            daily: perDay,
            topConnection: topDestinationEntry ? { label: topDestinationEntry[0], count: topDestinationEntry[1] } : null
        },
        memory: systemStatus.memory,
        storage: systemStatus.storage,
        uptime: {
            hostSeconds: systemStatus.hostUptime,
            openclawSeconds: systemStatus.openclawUptime,
            hostname: systemStatus.hostname,
            localIp: systemStatus.localIp,
            openclawPid: systemStatus.openclawPid,
            platform: os.platform(),
            arch: os.arch()
        },
        activity: {
            daily: activityDaily
        }
    };
    writeAudit('read.glance', '/api/glance', 'ok', {
        openAlerts: response.alerts.totalOpen,
        cronTotal: response.cron.total,
        externalToday: response.externalConnections.today,
        externalWeek: response.externalConnections.totalWeek
    }, String(request.ip));
    return response;
});
// API endpoint to fetch recent events
server.get('/api/events', async (request, reply) => {
    const queryObj = request.query;
    const requestedLimit = queryObj.limit ? parseInt(queryObj.limit) : 50;
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 300));
    const domain = queryObj.domain;
    const agentId = queryObj.agentId;
    const before = queryObj.before;
    let query = 'SELECT * FROM events';
    const params = [];
    const conditions = [];
    if (domain) {
        conditions.push('domain = ?');
        params.push(domain);
    }
    if (agentId) {
        conditions.push('agentId = ?');
        params.push(agentId);
    }
    if (before) {
        conditions.push('timestamp < ?');
        params.push(before);
    }
    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    const sanitized = rows.map((r) => {
        let parsed = {};
        try {
            parsed = JSON.parse(r.data || '{}');
        }
        catch { }
        return { ...r, data: JSON.stringify(redactObject(parsed, REDACTION_MODE)) };
    });
    writeAudit('read.events', '/api/events', 'ok', { limit, domain, agentId, before, count: sanitized.length }, String(request.ip));
    return { data: sanitized };
});
server.get('/api/coverage', async (request) => {
    const requiredDomains = ['agent', 'tool', 'channel', 'session', 'access', 'system'];
    const requiredTypes = [
        'model.usage',
        'tool.invoke',
        'tool.complete',
        'message.queued',
        'message.processed',
        'session.state',
        'webhook.received',
        'access.credential.use'
    ];
    const domainRows = db.prepare(`SELECT domain, COUNT(*) as count FROM normalized_events GROUP BY domain`).all();
    const typeRows = db.prepare(`SELECT type, COUNT(*) as count FROM normalized_events GROUP BY type`).all();
    const domainMap = Object.fromEntries(domainRows.map((r) => [r.domain, Number(r.count)]));
    const typeMap = Object.fromEntries(typeRows.map((r) => [r.type, Number(r.count)]));
    const response = {
        totals: {
            rawEvents: db.prepare('SELECT COUNT(*) as c FROM raw_events').get()?.c || 0,
            normalizedEvents: db.prepare('SELECT COUNT(*) as c FROM normalized_events').get()?.c || 0
        },
        domains: requiredDomains.map((d) => ({ domain: d, count: domainMap[d] || 0, covered: (domainMap[d] || 0) > 0 })),
        types: requiredTypes.map((t) => ({ type: t, count: typeMap[t] || 0, covered: (typeMap[t] || 0) > 0 })),
        extraTypes: typeRows
    };
    writeAudit('read.coverage', '/api/coverage', 'ok', { normalizedEvents: response.totals.normalizedEvents }, String(request.ip));
    return response;
});
server.get('/api/ingest-policy/stats', async () => {
    const stats = getIngestPolicyStats();
    const networkPolicy = getNetworkPolicyStats();
    return {
        ...stats,
        networkPolicy
    };
});
server.get('/api/log-explorer/facets', async (request) => {
    const distinct = (col, limit = 200) => db.prepare(`SELECT ${col} as v FROM normalized_events WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY ${col} ORDER BY COUNT(*) DESC LIMIT ?`).all(limit).map((r) => r.v);
    const facets = {
        domains: distinct('domain', 50),
        types: distinct('type', 500),
        severities: distinct('severity', 10),
        agents: distinct('agentId', 100),
        sessions: distinct('sessionKey', 300),
        channels: distinct('channel', 30)
    };
    writeAudit('read.log_explorer_facets', '/api/log-explorer/facets', 'ok', {}, String(request.ip));
    return { data: facets };
});
server.get('/api/log-explorer/favorites', async (request) => {
    const rows = db.prepare('SELECT * FROM log_explorer_favorites ORDER BY position ASC, updatedAt DESC').all();
    return { data: rows.map((r) => ({ ...r, query: (() => { try {
                return JSON.parse(r.queryJson || '{}');
            }
            catch {
                return {};
            } })() })) };
});
server.post('/api/log-explorer/favorites', async (request, reply) => {
    const body = request.body || {};
    const name = String(body.name || '').trim().slice(0, 48);
    const query = body.query || {};
    if (!name)
        return reply.code(400).send({ error: 'Name required' });
    const count = db.prepare('SELECT COUNT(*) as c FROM log_explorer_favorites').get()?.c || 0;
    if (count >= 5)
        return reply.code(400).send({ error: 'Max 5 favorites' });
    const now = new Date().toISOString();
    const id = ulid();
    const pos = Number(body.position);
    const position = Number.isFinite(pos) ? Math.max(0, Math.min(4, pos)) : count;
    const isDefault = body.isDefault ? 1 : 0;
    if (isDefault)
        db.prepare('UPDATE log_explorer_favorites SET isDefault = 0').run();
    db.prepare('INSERT INTO log_explorer_favorites (id,name,queryJson,position,isDefault,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)')
        .run(id, name, JSON.stringify(query || {}), position, isDefault, now, now);
    return { ok: true, id };
});
server.patch('/api/log-explorer/favorites/:id', async (request, reply) => {
    const id = String(request.params?.id || '');
    const body = request.body || {};
    const row = db.prepare('SELECT * FROM log_explorer_favorites WHERE id = ?').get(id);
    if (!row)
        return reply.code(404).send({ error: 'Not found' });
    const name = body.name != null ? String(body.name).trim().slice(0, 48) : row.name;
    const queryJson = body.query != null ? JSON.stringify(body.query || {}) : row.queryJson;
    const position = body.position != null ? Math.max(0, Math.min(4, Number(body.position) || 0)) : row.position;
    const isDefault = body.isDefault != null ? (body.isDefault ? 1 : 0) : row.isDefault;
    if (isDefault)
        db.prepare('UPDATE log_explorer_favorites SET isDefault = 0').run();
    db.prepare('UPDATE log_explorer_favorites SET name=?, queryJson=?, position=?, isDefault=?, updatedAt=? WHERE id=?')
        .run(name, queryJson, position, isDefault, new Date().toISOString(), id);
    return { ok: true };
});
server.delete('/api/log-explorer/favorites/:id', async (request, reply) => {
    const id = String(request.params?.id || '');
    db.prepare('DELETE FROM log_explorer_favorites WHERE id = ?').run(id);
    return { ok: true };
});
server.get('/api/log-explorer', async (request) => {
    const q = request.query || {};
    const from = q.from ? String(q.from) : null;
    const to = q.to ? String(q.to) : null;
    const domain = q.domain ? String(q.domain) : null;
    const type = q.type ? String(q.type) : null;
    const severity = q.severity ? String(q.severity) : null;
    const agentId = q.agentId ? String(q.agentId) : null;
    const sessionKey = q.sessionKey ? String(q.sessionKey) : null;
    const channel = q.channel ? String(q.channel) : null;
    const query = q.q ? String(q.q) : '';
    const qExclude = String(q.qExclude || '0') === '1';
    const deep = String(q.deep || '0') === '1';
    const page = Math.max(1, Number(q.page || 1));
    const pageSize = Math.min(1000, Math.max(1, Number(q.pageSize || 100)));
    const offset = (page - 1) * pageSize;
    const where = [];
    const params = [];
    if (from) {
        where.push('timestamp >= ?');
        params.push(from);
    }
    if (to) {
        where.push('timestamp <= ?');
        params.push(to);
    }
    if (domain) {
        where.push('domain = ?');
        params.push(domain);
    }
    if (type) {
        where.push('type = ?');
        params.push(type);
    }
    if (severity) {
        where.push('severity = ?');
        params.push(severity);
    }
    if (agentId) {
        where.push('agentId = ?');
        params.push(agentId);
    }
    if (sessionKey) {
        where.push('sessionKey = ?');
        params.push(sessionKey);
    }
    if (channel) {
        where.push('channel = ?');
        params.push(channel);
    }
    if (query) {
        // Support comma-separated OR terms: "edit,write" matches either
        const terms = query.includes(',') ? query.split(',').map(t => t.trim()).filter(Boolean) : [query];
        const clauses = [];
        for (const term of terms) {
            if (deep) {
                clauses.push('(summary LIKE ? OR type LIKE ? OR data LIKE ?)');
                params.push(`%${term}%`, `%${term}%`, `%${term}%`);
            }
            else {
                clauses.push('(summary LIKE ? OR type LIKE ?)');
                params.push(`%${term}%`, `%${term}%`);
            }
        }
        const combined = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
        where.push(qExclude ? `NOT ${combined}` : combined);
    }
    let base = ' FROM normalized_events';
    if (where.length)
        base += ' WHERE ' + where.join(' AND ');
    const total = db.prepare('SELECT COUNT(*) as c' + base).get(...params)?.c || 0;
    const rows = db.prepare('SELECT *' + base + ' ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(...params, pageSize, offset);
    const sanitized = rows.map((r) => {
        let parsed = {};
        try {
            parsed = JSON.parse(r.data || '{}');
        }
        catch { }
        return { ...r, data: JSON.stringify(redactObject(parsed, REDACTION_MODE)) };
    });
    writeAudit('read.log_explorer', '/api/log-explorer', 'ok', { page, pageSize, total }, String(request.ip));
    return { data: sanitized, page, pageSize, total };
});
server.get('/api/log-explorer/raw/:rawEventId', async (request, reply) => {
    const rawEventId = String(request.params?.rawEventId || '');
    if (!rawEventId)
        return reply.code(400).send({ error: 'rawEventId required' });
    const row = db.prepare('SELECT * FROM raw_events WHERE id = ?').get(rawEventId);
    if (!row)
        return reply.code(404).send({ error: 'Not found' });
    let payload = {};
    try {
        payload = JSON.parse(row.payload || '{}');
    }
    catch { }
    const redacted = redactObject(payload, REDACTION_MODE);
    writeAudit('read.log_explorer_raw', '/api/log-explorer/raw/:id', 'ok', { rawEventId }, String(request.ip));
    return { data: { ...row, payload: redacted } };
});
server.get('/api/log-explorer/export.csv', async (request, reply) => {
    const q = request.query || {};
    const mode = String(q.mode || 'page');
    const page = Math.max(1, Number(q.page || 1));
    const pageSize = Math.min(1000, Math.max(1, Number(q.pageSize || 100)));
    const maxRows = mode === 'full' ? 50000 : pageSize;
    const where = [];
    const params = [];
    const addEq = (k, col) => { if (q[k]) {
        where.push(`${col} = ?`);
        params.push(String(q[k]));
    } };
    if (q.from) {
        where.push('timestamp >= ?');
        params.push(String(q.from));
    }
    if (q.to) {
        where.push('timestamp <= ?');
        params.push(String(q.to));
    }
    addEq('domain', 'domain');
    addEq('type', 'type');
    addEq('severity', 'severity');
    addEq('agentId', 'agentId');
    addEq('sessionKey', 'sessionKey');
    addEq('channel', 'channel');
    if (q.q) {
        const deep = String(q.deep || '0') === '1';
        const qExclude = String(q.qExclude || '0') === '1';
        if (deep) {
            where.push(qExclude ? 'NOT (summary LIKE ? OR type LIKE ? OR data LIKE ?)' : '(summary LIKE ? OR type LIKE ? OR data LIKE ?)');
            params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
        }
        else {
            where.push(qExclude ? 'NOT (summary LIKE ? OR type LIKE ?)' : '(summary LIKE ? OR type LIKE ?)');
            params.push(`%${q.q}%`, `%${q.q}%`);
        }
    }
    let sql = 'SELECT timestamp, domain, type, severity, agentId, sessionKey, channel, summary FROM normalized_events';
    if (where.length)
        sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY timestamp DESC';
    if (mode === 'page')
        sql += ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    else
        sql += ` LIMIT ${maxRows}`;
    const rows = db.prepare(sql).all(...params);
    const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const header = ['timestamp', 'domain', 'type', 'severity', 'agentId', 'sessionKey', 'channel', 'summary'];
    const lines = [header.join(',')].concat(rows.map((r) => header.map((h) => esc(r[h])).join(',')));
    const csv = lines.join('\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="log-explorer-${mode}.csv"`);
    return reply.send(csv);
});
server.get('/api/audit', async (request) => {
    const q = request.query;
    const limit = q.limit ? Math.min(500, parseInt(q.limit)) : 100;
    const rows = db.prepare('SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT ?').all(limit);
    writeAudit('read.audit', '/api/audit', 'ok', { limit }, String(request.ip));
    return { data: rows };
});
server.post('/api/auth/login', async (request, reply) => {
    if (!OPERATOR_PASSWORD)
        return { authorized: true, session: false, mode: 'open' };
    const rawBody = typeof request.body === 'string' ? (() => { try {
        return JSON.parse(request.body);
    }
    catch {
        return {};
    } })() : (request.body || {});
    const provided = String(rawBody?.password || request.headers['x-observeclaw-password'] || '');
    if (!provided || provided !== OPERATOR_PASSWORD) {
        writeAudit('auth.login', '/api/auth/login', 'denied', {}, String(request.ip));
        return reply.code(401).send({ error: 'Unauthorized' });
    }
    const token = createSessionToken();
    reply.header('Set-Cookie', buildSessionCookie(token, !!request.protocol && String(request.protocol).toLowerCase() === 'https'));
    writeAudit('auth.login', '/api/auth/login', 'allowed', { mode: 'session' }, String(request.ip));
    return { authorized: true, session: true };
});
server.post('/api/auth/logout', async (request, reply) => {
    reply.header('Set-Cookie', buildExpiredSessionCookie(!!request.protocol && String(request.protocol).toLowerCase() === 'https'));
    writeAudit('auth.logout', '/api/auth/logout', 'ok', {}, String(request.ip));
    return { ok: true };
});
server.get('/api/auth/status', async (request) => {
    return { authorized: !!request.ocAuthorized, mode: request.ocAuthMode || null };
});
server.get('/api/retention/policy', async (request) => {
    const policy = loadRetentionPolicy(db);
    writeAudit('read.retention_policy', '/api/retention/policy', 'ok', { enabled: policy.enabled }, String(request.ip));
    return { data: policy };
});
server.put('/api/retention/policy', async (request, reply) => {
    try {
        const body = request.body || {};
        const policy = saveRetentionPolicy(db, {
            name: body.name,
            enabled: body.enabled,
            timezone: body.timezone,
            scheduleCron: body.scheduleCron,
            includeInferred: body.includeInferred,
            chatRetentionDays: body.chatRetentionDays,
            defaultRetentionDays: body.defaultRetentionDays,
            auditRetentionDays: body.auditRetentionDays,
            notifyOnFailureOnly: body.notifyOnFailureOnly,
            rules: Array.isArray(body.rules) ? body.rules : undefined
        });
        writeAudit('write.retention_policy', '/api/retention/policy', 'ok', { enabled: policy.enabled }, String(request.ip));
        return { ok: true, data: policy };
    }
    catch (err) {
        writeAudit('write.retention_policy', '/api/retention/policy', 'error', { error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to save retention policy' });
    }
});
server.post('/api/retention/dry-run', async (request, reply) => {
    try {
        const policy = loadRetentionPolicy(db);
        const out = retentionPreview(db, policy);
        writeAudit('run.retention_dry_run', '/api/retention/dry-run', 'ok', { purgeNormalized: out.purgeNormalized, purgeAudit: out.purgeAudit }, String(request.ip));
        return { ok: true, data: out };
    }
    catch (err) {
        writeAudit('run.retention_dry_run', '/api/retention/dry-run', 'error', { error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to run retention dry-run' });
    }
});
server.post('/api/retention/run', async (request, reply) => {
    const runId = ulid();
    const startedAt = new Date().toISOString();
    db.prepare('INSERT INTO retention_runs (id, startedAt, status, dryRun, trigger) VALUES (?, ?, ?, ?, ?)').run(runId, startedAt, 'running', 0, 'manual');
    try {
        const policy = loadRetentionPolicy(db);
        const runVacuum = !!request.body?.runVacuum;
        const runCheckpoint = request.body?.runCheckpoint !== false;
        const out = runRetention(db, policy, { dryRun: false, runVacuum, runCheckpoint });
        const endedAt = new Date().toISOString();
        db.prepare('UPDATE retention_runs SET endedAt = ?, status = ?, summaryJson = ? WHERE id = ?').run(endedAt, 'ok', JSON.stringify(out), runId);
        writeAudit('run.retention', '/api/retention/run', 'ok', { normalizedDeleted: out.normalizedDeleted, auditDeleted: out.auditDeleted, rawDeleted: out.rawDeleted }, String(request.ip));
        return { ok: true, data: out };
    }
    catch (err) {
        const endedAt = new Date().toISOString();
        db.prepare('UPDATE retention_runs SET endedAt = ?, status = ?, error = ? WHERE id = ?').run(endedAt, 'error', String(err?.message || err), runId);
        writeAudit('run.retention', '/api/retention/run', 'error', { error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to run retention' });
    }
});
server.get('/api/retention/runs', async (request) => {
    const limit = Math.min(200, Number(request.query?.limit || 50));
    const rows = db.prepare('SELECT * FROM retention_runs ORDER BY startedAt DESC LIMIT ?').all(limit);
    writeAudit('read.retention_runs', '/api/retention/runs', 'ok', { limit, count: rows.length }, String(request.ip));
    return { data: rows };
});
server.post('/api/retention/schedule', async (request, reply) => {
    const policy = loadRetentionPolicy(db);
    const cronExpr = String(request.body?.scheduleCron || policy.scheduleCron || '10 3 * * *').trim();
    const tz = String(request.body?.timezone || policy.timezone || 'America/Los_Angeles').trim();
    try {
        const list = safeExecJson('openclaw cron list --json --all', 8000);
        const jobs = list?.jobs || [];
        const existing = jobs.find((j) => String(j?.name || '') === 'observeclaw-retention');
        if (existing?.id) {
            execSync(`openclaw cron edit ${JSON.stringify(String(existing.id))} --name observeclaw-retention --cron ${JSON.stringify(cronExpr)} --tz ${JSON.stringify(tz)} --system-event ${JSON.stringify('OBSERVECLAW_RETENTION_RUN')}`, { encoding: 'utf8', timeout: 10000 });
        }
        else {
            execSync(`openclaw cron add --name observeclaw-retention --cron ${JSON.stringify(cronExpr)} --tz ${JSON.stringify(tz)} --system-event ${JSON.stringify('OBSERVECLAW_RETENTION_RUN')}`, { encoding: 'utf8', timeout: 10000 });
        }
        const updated = saveRetentionPolicy(db, { scheduleCron: cronExpr, timezone: tz });
        writeAudit('write.retention_schedule', '/api/retention/schedule', 'ok', { cronExpr, tz }, String(request.ip));
        return { ok: true, data: updated };
    }
    catch (err) {
        writeAudit('write.retention_schedule', '/api/retention/schedule', 'error', { error: String(err?.message || err), cronExpr, tz }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to configure retention schedule' });
    }
});
server.get('/api/pulse', async () => {
    return pulseEngine.getSnapshot();
});
server.get('/api/agents', async (request) => {
    const agents = listAgents();
    writeAudit('read.agents', '/api/agents', 'ok', { count: agents.length }, String(request.ip));
    return { data: agents };
});
server.get('/api/workspaces/cron', async (request) => {
    const data = safeExecJson('openclaw cron list --json --all', 8000);
    const jobs = (data?.jobs || []).map((job) => ({
        id: job.id,
        name: job.name || String(job.id || '').slice(0, 8),
        enabled: !!job.enabled,
        schedule: job.schedule,
        payload: job.payload,
        sessionTarget: job.sessionTarget,
        lastRunAt: job.state?.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : null,
        nextRunAt: job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : null
    }));
    jobs.sort((a, b) => {
        if (a.enabled !== b.enabled)
            return Number(b.enabled) - Number(a.enabled);
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
    writeAudit('read.workspaces.cron', '/api/workspaces/cron', 'ok', { count: jobs.length }, String(request.ip));
    return { data: jobs };
});
server.post('/api/workspaces/cron/:id/toggle', async (request, reply) => {
    const id = String(request.params?.id || '');
    const enabled = !!request.body?.enabled;
    try {
        const cmd = `openclaw cron ${enabled ? 'enable' : 'disable'} ${JSON.stringify(id)}`;
        execSync(cmd, { encoding: 'utf8', timeout: 7000 });
        writeAudit('write.workspaces.cron.toggle', '/api/workspaces/cron/:id/toggle', 'ok', { id, enabled }, String(request.ip));
        return { ok: true };
    }
    catch (err) {
        writeAudit('write.workspaces.cron.toggle', '/api/workspaces/cron/:id/toggle', 'error', { id, enabled, error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to toggle cron job' });
    }
});
server.post('/api/workspaces/cron/:id/run', async (request, reply) => {
    const id = String(request.params?.id || '');
    try {
        execSync(`openclaw cron run ${JSON.stringify(id)}`, { encoding: 'utf8', timeout: 12000 });
        writeAudit('write.workspaces.cron.run', '/api/workspaces/cron/:id/run', 'ok', { id }, String(request.ip));
        return { ok: true };
    }
    catch (err) {
        writeAudit('write.workspaces.cron.run', '/api/workspaces/cron/:id/run', 'error', { id, error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to run cron job' });
    }
});
server.get('/api/workspaces/projects', async (request) => {
    const workspaceRoots = getWorkspaceRoots();
    const cronData = safeExecJson('openclaw cron list --json --all', 8000);
    const cronJobs = cronData?.jobs || [];
    const projects = [];
    for (const wsPath of workspaceRoots) {
        let workspaceName = path.basename(wsPath);
        if (workspaceName === 'workspace')
            workspaceName = 'Main Workspace';
        else if (workspaceName.startsWith('workspace-')) {
            const suffix = workspaceName.slice(10);
            workspaceName = `${suffix.charAt(0).toUpperCase()}${suffix.slice(1)} Workspace`;
        }
        try {
            const dirEntries = fs.readdirSync(wsPath, { withFileTypes: true });
            const scanDirs = [wsPath, ...dirEntries.filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && d.name !== 'logs' && d.name !== 'backups').map((d) => path.join(wsPath, d.name))];
            for (const pth of scanDirs) {
                try {
                    const files = fs.readdirSync(pth);
                    const hasCode = files.some((f) => ['package.json', 'server.js', 'index.js', 'main.js', 'SKILL.md'].includes(f) || f.endsWith('.py'));
                    if (!hasCode)
                        continue;
                    const info = analyzeProject(pth);
                    info.workspaceName = workspaceName;
                    const pthName = path.basename(pth);
                    const matchedCron = cronJobs.find((job) => {
                        const payload = JSON.stringify(job?.payload || {});
                        return payload.includes(pth) || payload.includes(pthName);
                    });
                    if (matchedCron) {
                        info.cronJob = {
                            id: matchedCron.id,
                            name: matchedCron.name,
                            enabled: !!matchedCron.enabled,
                            schedule: matchedCron.schedule,
                            lastRunAt: matchedCron.state?.lastRunAtMs ? new Date(matchedCron.state.lastRunAtMs).toISOString() : null,
                            nextRunAt: matchedCron.state?.nextRunAtMs ? new Date(matchedCron.state.nextRunAtMs).toISOString() : null
                        };
                        if (!info.capabilities.includes('Scheduled'))
                            info.capabilities.unshift('Scheduled');
                    }
                    projects.push(info);
                }
                catch { }
            }
        }
        catch { }
    }
    const dedup = new Map();
    for (const p of projects) {
        const k = `${p.workspaceName}::${p.path}`;
        if (!dedup.has(k))
            dedup.set(k, p);
    }
    const out = Array.from(dedup.values()).sort((a, b) => {
        if (a.workspaceName !== b.workspaceName)
            return String(a.workspaceName).localeCompare(String(b.workspaceName));
        if (!!a.isRunning !== !!b.isRunning)
            return Number(!!b.isRunning) - Number(!!a.isRunning);
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
    writeAudit('read.workspaces.projects', '/api/workspaces/projects', 'ok', { count: out.length, roots: workspaceRoots.length }, String(request.ip));
    return { data: out };
});
function getAgentSessionsDir(agentId) {
    const id = String(agentId || 'main').trim() || 'main';
    const direct = path.join(OPENCLAW_HOME, 'agents', id, 'sessions');
    if (fs.existsSync(direct))
        return direct;
    return path.join(OPENCLAW_HOME, 'agents', 'main', 'sessions');
}
function getSessionTypeInfo(sessionKey) {
    const key = String(sessionKey || '');
    if (key.endsWith(':main') && !key.includes(':cron:') && !key.includes(':subagent:') && !key.includes(':spawn:'))
        return 'main';
    if (key.includes(':cron:'))
        return 'cron';
    if (key.includes(':subagent:') || key.includes(':spawn:'))
        return 'subagent';
    return 'other';
}
server.get('/api/conversations', async (request, reply) => {
    const q = request.query || {};
    const agentId = String(q.agent || 'main');
    const channel = String(q.channel || '').trim().toLowerCase();
    const type = String(q.type || '').trim().toLowerCase();
    const query = String(q.q || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(2000, Number(q.limit || 500)));
    try {
        const sessionsDir = getAgentSessionsDir(agentId);
        const indexPath = path.join(sessionsDir, 'sessions.json');
        if (!fs.existsSync(indexPath))
            return { data: [] };
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) || {};
        const items = [];
        for (const [key, s] of Object.entries(index)) {
            const sess = s || {};
            const sessionId = String(sess.sessionId || '').trim();
            if (!sessionId)
                continue;
            const filePath = String(sess.sessionFile || path.join(sessionsDir, `${sessionId}.jsonl`));
            let fileSize = 0;
            try {
                fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
            }
            catch { }
            const typeInfo = getSessionTypeInfo(String(key));
            const row = {
                key,
                sessionId,
                label: sess.origin?.label || key,
                channel: String(sess.lastChannel || sess.origin?.provider || 'unknown'),
                chatType: String(sess.chatType || sess.origin?.chatType || 'direct'),
                updatedAt: sess.updatedAt ? new Date(Number(sess.updatedAt)).toISOString() : null,
                updatedAtMs: Number(sess.updatedAt || 0),
                fileSize,
                messageCount: Math.max(1, Math.floor(fileSize / 500)),
                sessionType: typeInfo
            };
            if (channel && String(row.channel).toLowerCase() !== channel)
                continue;
            if (type && String(typeInfo) !== type)
                continue;
            if (query) {
                const hay = `${row.key} ${row.label} ${row.channel}`.toLowerCase();
                if (!hay.includes(query))
                    continue;
            }
            items.push(row);
        }
        items.sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0));
        writeAudit('read.conversations', '/api/conversations', 'ok', { agentId, count: items.length, channel, type, q: query }, String(request.ip));
        return { data: items.slice(0, limit) };
    }
    catch (err) {
        writeAudit('read.conversations', '/api/conversations', 'error', { agentId, error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to load conversations' });
    }
});
server.get('/api/conversations/:sessionId', async (request, reply) => {
    const agentId = String(request.query?.agent || 'main');
    const sessionId = String(request.params?.sessionId || '');
    const limit = Math.max(1, Math.min(2000, Number(request.query?.limit || 500)));
    const offset = Math.max(0, Number(request.query?.offset || 0));
    try {
        const sessionsDir = getAgentSessionsDir(agentId);
        const filePath = path.join(sessionsDir, `${sessionId}.jsonl`);
        if (!fs.existsSync(filePath))
            return reply.code(404).send({ error: 'Session not found' });
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        const messages = [];
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                const ts = entry?.timestamp || null;
                if (entry?.type === 'message' && entry?.message) {
                    const msg = entry.message;
                    const role = String(msg.role || '');
                    if (role === 'user' || role === 'assistant' || role === 'system') {
                        let text = '';
                        if (typeof msg.content === 'string')
                            text = msg.content;
                        else if (Array.isArray(msg.content)) {
                            text = msg.content.filter((c) => c?.type === 'text' && c?.text).map((c) => c.text).join('\n');
                        }
                        if (text)
                            messages.push({ role, content: String(text).slice(0, 20000), timestamp: ts, collapsed: role === 'system' });
                    }
                }
                else if (entry?.type === 'summary' || entry?.summary) {
                    const txt = String(entry?.summary || entry?.text || '').trim();
                    if (txt)
                        messages.push({ role: 'system', content: txt.slice(0, 20000), timestamp: ts, collapsed: true });
                }
            }
            catch { }
        }
        const total = messages.length;
        const windowed = messages.slice(Math.max(0, total - offset - limit), Math.max(0, total - offset));
        writeAudit('read.conversation', '/api/conversations/:sessionId', 'ok', { agentId, sessionId, limit, offset, total }, String(request.ip));
        return { data: windowed, total, truncated: total > windowed.length, offset, limit };
    }
    catch (err) {
        writeAudit('read.conversation', '/api/conversations/:sessionId', 'error', { agentId, sessionId, error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to load conversation' });
    }
});
server.get('/api/artifacts/files', async (request, reply) => {
    const q = request.query || {};
    const agentId = String(q.agent || 'main');
    const showHidden = String(q.showHidden || '0') === '1';
    const relDir = String(q.dir || '').trim();
    try {
        const wsRoot = resolveAgentWorkspace(agentId);
        const target = path.resolve(wsRoot, relDir || '.');
        if (!target.startsWith(path.resolve(wsRoot))) {
            return reply.code(400).send({ error: 'Invalid path' });
        }
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
            return reply.code(404).send({ error: 'Directory not found' });
        }
        let entries = fs.readdirSync(target, { withFileTypes: true });
        if (!showHidden)
            entries = entries.filter((e) => !e.name.startsWith('.'));
        const items = entries.map((e) => {
            const full = path.join(target, e.name);
            const st = fs.statSync(full);
            return {
                name: e.name,
                type: e.isDirectory() ? 'dir' : 'file',
                relativePath: path.relative(wsRoot, full),
                size: e.isDirectory() ? null : st.size,
                updatedAt: new Date(st.mtimeMs).toISOString()
            };
        }).sort((a, b) => {
            if (a.type !== b.type)
                return a.type === 'dir' ? -1 : 1;
            return String(a.name).localeCompare(String(b.name));
        });
        const relativePath = path.relative(wsRoot, target) || '/';
        writeAudit('read.artifacts.files', '/api/artifacts/files', 'ok', { agentId, relativePath, count: items.length, showHidden }, String(request.ip));
        return { data: items, workspaceRoot: wsRoot, relativePath };
    }
    catch (err) {
        writeAudit('read.artifacts.files', '/api/artifacts/files', 'error', { agentId, dir: relDir, error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to list files' });
    }
});
server.get('/api/artifacts/file', async (request, reply) => {
    const q = request.query || {};
    const agentId = String(q.agent || 'main');
    const relPath = String(q.path || '').trim();
    const maxBytes = 200 * 1024;
    if (!relPath)
        return reply.code(400).send({ error: 'Path required' });
    try {
        const wsRoot = resolveAgentWorkspace(agentId);
        const full = path.resolve(wsRoot, relPath);
        if (!full.startsWith(path.resolve(wsRoot))) {
            return reply.code(400).send({ error: 'Invalid path' });
        }
        if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
            return reply.code(404).send({ error: 'File not found' });
        }
        const st = fs.statSync(full);
        const clipped = st.size > maxBytes;
        const buf = fs.readFileSync(full);
        const slice = clipped ? buf.subarray(0, maxBytes) : buf;
        const hasNull = slice.includes(0);
        const mimeType = getArtifactMimeType(full);
        if (hasNull) {
            return { data: { content: '', isBinary: true, clipped, size: st.size, path: relPath, mimeType } };
        }
        const content = slice.toString('utf8');
        writeAudit('read.artifacts.file', '/api/artifacts/file', 'ok', { agentId, path: relPath, size: st.size, clipped }, String(request.ip));
        return { data: { content, isBinary: false, clipped, size: st.size, path: relPath, mimeType } };
    }
    catch (err) {
        writeAudit('read.artifacts.file', '/api/artifacts/file', 'error', { agentId, path: relPath, error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to read file' });
    }
});
server.get('/api/artifacts/file/raw', async (request, reply) => {
    const q = request.query || {};
    const agentId = String(q.agent || 'main');
    const relPath = String(q.path || '').trim();
    if (!relPath)
        return reply.code(400).send({ error: 'Path required' });
    try {
        const wsRoot = resolveAgentWorkspace(agentId);
        const full = path.resolve(wsRoot, relPath);
        if (!full.startsWith(path.resolve(wsRoot))) {
            return reply.code(400).send({ error: 'Invalid path' });
        }
        if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
            return reply.code(404).send({ error: 'File not found' });
        }
        const mimeType = getArtifactMimeType(full);
        const st = fs.statSync(full);
        writeAudit('read.artifacts.file.raw', '/api/artifacts/file/raw', 'ok', { agentId, path: relPath, size: st.size, mimeType }, String(request.ip));
        return reply
            .header('Content-Type', mimeType)
            .header('Cache-Control', 'no-store')
            .send(fs.createReadStream(full));
    }
    catch (err) {
        writeAudit('read.artifacts.file.raw', '/api/artifacts/file/raw', 'error', { agentId, path: relPath, error: String(err?.message || err) }, String(request.ip));
        return reply.code(500).send({ error: 'Failed to read file' });
    }
});
server.get('/api/file', async (request, reply) => {
    const q = request.query || {};
    const agentId = String(q.agent || 'main');
    let relPath = String(q.path || '');
    try {
        relPath = sanitizeSoulPath(relPath);
        const roots = resolveAgentRoots(agentId);
        const candidates = roots.map((r) => path.join(r, relPath));
        const existing = candidates.find((p) => fs.existsSync(p));
        const chosenRoot = roots[0] || MAIN_WORKSPACE;
        const chosen = existing || path.join(chosenRoot, relPath);
        if (!chosen.startsWith(chosenRoot) && !roots.some((r) => chosen.startsWith(r))) {
            return reply.code(400).send({ error: 'Invalid path' });
        }
        const exists = fs.existsSync(chosen);
        const content = exists ? fs.readFileSync(chosen, 'utf8') : '';
        writeAudit('read.file', '/api/file', 'ok', { agentId, path: relPath, exists, bytes: content.length, chosen }, String(request.ip));
        return { path: relPath, exists, content };
    }
    catch (err) {
        writeAudit('read.file', '/api/file', 'error', { agentId, path: relPath, error: String(err?.message || err) }, String(request.ip));
        return reply.code(400).send({ error: String(err?.message || err) });
    }
});
server.post('/api/file', async (request, reply) => {
    const body = request.body || {};
    const agentId = String(body.agent || 'main');
    let relPath = String(body.path || '');
    const content = String(body.content || '');
    try {
        relPath = sanitizeSoulPath(relPath);
        const roots = resolveAgentRoots(agentId);
        const ws = roots[0] || MAIN_WORKSPACE;
        const full = path.join(ws, relPath);
        if (!full.startsWith(ws))
            return reply.code(400).send({ error: 'Invalid path' });
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        writeAudit('write.file', '/api/file', 'ok', { agentId, path: relPath, bytes: content.length, full }, String(request.ip));
        return { ok: true, path: relPath, bytes: content.length };
    }
    catch (err) {
        writeAudit('write.file', '/api/file', 'error', { agentId, path: relPath, error: String(err?.message || err) }, String(request.ip));
        return reply.code(400).send({ error: String(err?.message || err) });
    }
});
server.get('/api/audit/export', async (request, reply) => {
    const q = request.query;
    const since = String(q.since || '');
    const limit = q.limit ? Math.min(5000, parseInt(q.limit)) : 2000;
    let rows;
    if (since) {
        rows = db.prepare('SELECT * FROM audit_events WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?').all(since, limit);
    }
    else {
        rows = db.prepare('SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT ?').all(limit);
    }
    writeAudit('export.audit', '/api/audit/export', 'ok', { limit, since: since || null }, String(request.ip));
    reply.header('content-type', 'application/json');
    return { exportedAt: new Date().toISOString(), count: rows.length, data: rows };
});
server.get('/api/security/redaction-check', async (request) => {
    const sampleRows = db.prepare('SELECT data FROM normalized_events ORDER BY timestamp DESC LIMIT 250').all();
    let scanned = 0;
    let suspect = 0;
    const examples = [];
    for (const row of sampleRows) {
        scanned += 1;
        const raw = String(row?.data || '');
        const redacted = JSON.stringify(redactObject((() => { try {
            return JSON.parse(raw);
        }
        catch {
            return raw;
        } })(), REDACTION_MODE));
        if (containsSecretLikeString(redacted)) {
            suspect += 1;
            if (examples.length < 5)
                examples.push(redacted.slice(0, 160));
        }
    }
    const response = { ok: suspect === 0, mode: REDACTION_MODE, scanned, suspect, examples };
    writeAudit('security.redaction_check', '/api/security/redaction-check', response.ok ? 'ok' : 'warning', response, String(request.ip));
    return response;
});
server.get('/api/rules', async (request) => {
    const rows = db.prepare('SELECT * FROM alert_rules ORDER BY createdAt DESC').all();
    writeAudit('read.rules', '/api/rules', 'ok', { count: rows.length }, String(request.ip));
    return { data: rows };
});
server.get('/api/rules/diagnostics', async (request) => {
    const rows = Array.from(ruleEvalDiagnostics.values()).sort((a, b) => String(b.evaluatedAt || '').localeCompare(String(a.evaluatedAt || '')));
    writeAudit('read.rules.diagnostics', '/api/rules/diagnostics', 'ok', { count: rows.length }, String(request.ip));
    return { data: rows };
});
server.get('/api/system/ingest-status', async (request) => {
    const data = {
        ingest: getIngestStatus(),
        policy: getIngestPolicyStats()
    };
    writeAudit('read.system.ingest_status', '/api/system/ingest-status', 'ok', { mode: data.ingest.mode }, String(request.ip));
    return data;
});
server.post('/api/rules', async (request, reply) => {
    const body = (request.body || {});
    const id = ulid();
    const name = String(body.name || '').trim();
    const kind = String(body.kind || '').trim();
    if (!name || !kind)
        return reply.code(400).send({ error: 'name and kind are required' });
    const threshold = body.threshold != null ? Number(body.threshold) : null;
    const windowSec = body.windowSec != null ? Number(body.windowSec) : 300;
    const dedupeSec = body.dedupeSec != null ? Number(body.dedupeSec) : 600;
    const notifyEnabled = body.notifyEnabled ? 1 : 0;
    const notifyChannel = body.notifyChannel != null ? String(body.notifyChannel) : 'telegram';
    const notifyCooldownSec = body.notifyCooldownSec != null ? Number(body.notifyCooldownSec) : 900;
    const domain = body.domain != null ? String(body.domain) : null;
    const type = body.type != null ? String(body.type) : null;
    db.prepare(`
    INSERT INTO alert_rules (id, name, enabled, kind, threshold, windowSec, dedupeSec, notifyEnabled, notifyChannel, notifyCooldownSec, domain, type, createdAt)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, kind, threshold, windowSec, dedupeSec, notifyEnabled, notifyChannel, notifyCooldownSec, domain, type, new Date().toISOString());
    writeAudit('create.rule', '/api/rules', 'ok', { id, name, kind }, String(request.ip));
    return { ok: true, id };
});
server.patch('/api/rules/:id', async (request, reply) => {
    const id = String(request.params?.id || '');
    const body = (request.body || {});
    const fields = [];
    const params = [];
    if (typeof body.enabled === 'boolean') {
        fields.push('enabled = ?');
        params.push(body.enabled ? 1 : 0);
    }
    if (typeof body.threshold === 'number') {
        fields.push('threshold = ?');
        params.push(body.threshold);
    }
    if (typeof body.windowSec === 'number') {
        fields.push('windowSec = ?');
        params.push(body.windowSec);
    }
    if (typeof body.dedupeSec === 'number') {
        fields.push('dedupeSec = ?');
        params.push(body.dedupeSec);
    }
    if (typeof body.notifyEnabled === 'boolean') {
        fields.push('notifyEnabled = ?');
        params.push(body.notifyEnabled ? 1 : 0);
    }
    if (typeof body.notifyChannel === 'string') {
        fields.push('notifyChannel = ?');
        params.push(body.notifyChannel);
    }
    if (typeof body.notifyCooldownSec === 'number') {
        fields.push('notifyCooldownSec = ?');
        params.push(body.notifyCooldownSec);
    }
    if (typeof body.name === 'string' && body.name.trim()) {
        fields.push('name = ?');
        params.push(body.name.trim());
    }
    if (typeof body.domain === 'string') {
        fields.push('domain = ?');
        params.push(body.domain);
    }
    if (typeof body.type === 'string') {
        fields.push('type = ?');
        params.push(body.type);
    }
    if (typeof body.kind === 'string' && body.kind.trim()) {
        fields.push('kind = ?');
        params.push(body.kind.trim());
    }
    if (!fields.length)
        return { ok: true, changes: 0 };
    params.push(id);
    const q = `UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ?`;
    const res = db.prepare(q).run(...params);
    writeAudit('update.rule', `/api/rules/${id}`, 'ok', { changes: res.changes, body }, String(request.ip));
    return { ok: true, changes: res.changes };
});
server.delete('/api/rules/:id', async (request, reply) => {
    const id = String(request.params?.id || '');
    try {
        const tx = db.transaction((ruleId) => {
            const alertsRes = db.prepare('DELETE FROM alerts WHERE ruleId = ?').run(ruleId);
            const outboxRes = db.prepare('DELETE FROM notifications_outbox WHERE ruleId = ?').run(ruleId);
            const ruleRes = db.prepare('DELETE FROM alert_rules WHERE id = ?').run(ruleId);
            return { alertsDeleted: alertsRes.changes, outboxDeleted: outboxRes.changes, changes: ruleRes.changes };
        });
        const result = tx(id);
        writeAudit('delete.rule', `/api/rules/${id}`, 'ok', result, String(request.ip));
        return { ok: true, ...result };
    }
    catch (err) {
        const msg = String(err?.message || err);
        writeAudit('delete.rule', `/api/rules/${id}`, 'error', { error: msg }, String(request.ip));
        return reply.code(500).send({ error: msg });
    }
});
server.get('/api/alerts', async (request) => {
    const q = request.query || {};
    const limit = q.limit ? Math.min(500, parseInt(q.limit)) : 100;
    const onlyOpen = String(q.open || '1') === '1';
    const severity = String(q.severity || 'all');
    let sql = 'SELECT * FROM alerts';
    const cond = [];
    const params = [];
    if (onlyOpen)
        cond.push('acknowledged = 0');
    if (severity !== 'all') {
        cond.push('severity = ?');
        params.push(severity);
    }
    if (cond.length)
        sql += ' WHERE ' + cond.join(' AND ');
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return { data: rows };
});
server.post('/api/alerts/:id/ack', async (request, reply) => {
    const id = String(request.params?.id || '');
    const res = db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(id);
    writeAudit('ack.alert', `/api/alerts/${id}/ack`, 'ok', { changes: res.changes }, String(request.ip));
    return { ok: true, changes: res.changes };
});
server.post('/api/alerts/ack-all', async (request, reply) => {
    const res = db.prepare('UPDATE alerts SET acknowledged = 1 WHERE acknowledged = 0').run();
    writeAudit('ack.alerts.all', '/api/alerts/ack-all', 'ok', { changes: res.changes }, String(request.ip));
    return { ok: true, changes: res.changes };
});
server.get('/api/notifications/outbox', async (request) => {
    const q = request.query || {};
    const limit = q.limit ? Math.min(500, parseInt(q.limit)) : 100;
    const rows = db.prepare('SELECT * FROM notifications_outbox ORDER BY timestamp DESC LIMIT ?').all(limit);
    writeAudit('read.notifications_outbox', '/api/notifications/outbox', 'ok', { count: rows.length }, String(request.ip));
    return { data: rows };
});
server.post('/api/notifications/:id/mark-sent', async (request, reply) => {
    const id = String(request.params?.id || '');
    const res = db.prepare("UPDATE notifications_outbox SET status='sent', sentAt=? WHERE id=?").run(new Date().toISOString(), id);
    writeAudit('notify.mark_sent', `/api/notifications/${id}/mark-sent`, 'ok', { changes: res.changes }, String(request.ip));
    return { ok: true, changes: res.changes };
});
server.post('/api/notifications/:id/retry', async (request, reply) => {
    const id = String(request.params?.id || '');
    const res = db.prepare("UPDATE notifications_outbox SET status='pending', error=NULL WHERE id=?").run(id);
    writeAudit('notify.retry', `/api/notifications/${id}/retry`, 'ok', { changes: res.changes }, String(request.ip));
    return { ok: true, changes: res.changes };
});
// Global Event Bus
export const eventBus = {
    clients: new Set(),
    ingestPulse(event) {
        try {
            ingestEventIntoPulse({
                id: event?.id,
                timestamp: event?.timestamp,
                type: event?.type,
                agentId: event?.agentId,
                sessionKey: event?.sessionKey,
                data: event?.data
            });
        }
        catch { }
    },
    broadcastRaw(event) {
        for (const client of this.clients) {
            if (client.readyState === 1) {
                client.send(JSON.stringify(event));
            }
        }
    },
    broadcast(event) {
        this.ingestPulse(event);
        this.broadcastRaw(event);
    }
};
pulseEngine.subscribe((transition) => {
    if (PULSE_DEBUG) {
        console.log('[pulse:update]', JSON.stringify({
            ts: new Date().toISOString(),
            scope: transition.scope,
            agentId: transition.agentId || null,
            state: transition.state,
            reason: transition.reason,
            stateSince: transition.stateSince
        }));
    }
    eventBus.broadcastRaw({
        type: 'pulse.update',
        timestamp: new Date().toISOString(),
        domain: 'system',
        severity: transition.state === 'DISCONNECTED' ? 'warning' : 'info',
        summary: transition.scope === 'system'
            ? `System pulse -> ${transition.state}`
            : `Agent ${transition.agentId || 'unknown'} pulse -> ${transition.state}`,
        data: transition
    });
});
server.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (connection, req) => {
        const headerPass = String(req.headers['x-observeclaw-password'] || '');
        const wsUrl = new URL(req.url || '/ws', 'http://localhost');
        const queryPass = String(wsUrl.searchParams.get('p') || '');
        const provided = headerPass || queryPass;
        const cookieAllowed = requestHasValidSessionCookie({ headers: req.headers });
        const passwordAllowed = !!OPERATOR_PASSWORD && !!provided && provided === OPERATOR_PASSWORD;
        const openMode = !OPERATOR_PASSWORD;
        const wsAllowed = openMode || cookieAllowed || passwordAllowed;
        if (!wsAllowed) {
            writeAudit('auth.ws', '/ws', 'denied', { reason: 'bad-session-or-password' }, String(req.socket.remoteAddress || 'unknown'));
            connection.close();
            return;
        }
        writeAudit('auth.ws', '/ws', 'allowed', { mode: openMode ? 'open' : cookieAllowed ? 'session' : 'header' }, String(req.socket.remoteAddress || 'unknown'));
        eventBus.clients.add(connection);
        try {
            connection.send(JSON.stringify({
                type: 'pulse.snapshot',
                timestamp: new Date().toISOString(),
                domain: 'system',
                severity: 'info',
                summary: 'Current pulse snapshot',
                data: pulseEngine.getSnapshot()
            }));
        }
        catch { }
        connection.on('close', () => {
            eventBus.clients.delete(connection);
            writeAudit('ws.disconnect', '/ws', 'ok', {}, String(req.socket.remoteAddress || 'unknown'));
        });
    });
});
function seedDefaultRules() {
    const existing = db.prepare('SELECT COUNT(*) as c FROM alert_rules').get()?.c || 0;
    if (existing > 0)
        return;
    const now = new Date().toISOString();
    const insert = db.prepare(`
    INSERT INTO alert_rules (id, name, enabled, kind, threshold, windowSec, dedupeSec, domain, type, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertNotify = db.prepare(`
    INSERT INTO alert_rules (id, name, enabled, kind, threshold, windowSec, dedupeSec, notifyEnabled, notifyChannel, notifyCooldownSec, domain, type, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    insert.run(ulid(), 'Error Burst (5m >= 3)', 1, 'error_burst', 3, 300, 600, null, null, now);
    insert.run(ulid(), 'Queue Growth (5m >= 20 session.state)', 1, 'event_rate', 20, 300, 600, 'session', 'session.state', now);
    insert.run(ulid(), 'No Message Processed (10m)', 1, 'absence', 1, 600, 600, 'channel', 'message.processed', now);
    insertNotify.run(ulid(), 'External Outbound Request (Novel Host, 1m >= 1)', 1, 'network_connection_rate', 1, 60, 120, 1, 'telegram', 300, 'semantic', 'https', now);
    insertNotify.run(ulid(), 'External Outbound Connect (Novel Host, 1m >= 1)', 1, 'network_connect_rate', 1, 60, 300, 1, 'telegram', 300, 'any', null, now);
    insert.run(ulid(), 'Connection to Non-Local Host (pattern %)', 0, 'network_domain_match', 1, 60, 120, '%', null, now);
    writeAudit('rules.seed', 'alert_rules', 'ok', { count: 6 }, 'system');
}
function ensureExternalOutboundRule() {
    try {
        const existing = db.prepare("SELECT id FROM alert_rules WHERE kind = 'network_connection_rate' LIMIT 1").get();
        if (existing?.id) {
            db.prepare(`
        UPDATE alert_rules
        SET name = ?, enabled = ?, threshold = ?, windowSec = ?, dedupeSec = ?, notifyEnabled = ?, notifyChannel = ?, notifyCooldownSec = ?, domain = ?, type = ?
        WHERE id = ?
      `).run('External Outbound Request (Novel Host, 1m >= 1)', 1, 1, 60, 120, 1, 'telegram', 300, 'semantic', 'https', existing.id);
            writeAudit('rules.ensure_external_outbound', 'alert_rules', 'ok', { created: false, updated: true }, 'system');
            return;
        }
        db.prepare(`
      INSERT INTO alert_rules (id, name, enabled, kind, threshold, windowSec, dedupeSec, notifyEnabled, notifyChannel, notifyCooldownSec, domain, type, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ulid(), 'External Outbound Request (Novel Host, 1m >= 1)', 1, 'network_connection_rate', 1, 60, 120, 1, 'telegram', 300, 'semantic', 'https', new Date().toISOString());
        writeAudit('rules.ensure_external_outbound', 'alert_rules', 'ok', { created: true, updated: false }, 'system');
    }
    catch (err) {
        writeAudit('rules.ensure_external_outbound', 'alert_rules', 'error', { error: String(err?.message || err) }, 'system');
    }
}
function ensureStrictNetworkRule() {
    try {
        const existing = db.prepare("SELECT id FROM alert_rules WHERE kind = 'network_strict_violation' LIMIT 1").get();
        if (existing?.id)
            return;
        db.prepare(`
      INSERT INTO alert_rules (id, name, enabled, kind, threshold, windowSec, dedupeSec, notifyEnabled, notifyChannel, notifyCooldownSec, domain, type, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ulid(), 'Network Strict Violation (port/TLS)', 1, 'network_strict_violation', 1, 60, 60, 1, 'telegram', 120, 'semantic', null, new Date().toISOString());
        writeAudit('rules.ensure_strict_network', 'alert_rules', 'ok', { created: true }, 'system');
    }
    catch (err) {
        writeAudit('rules.ensure_strict_network', 'alert_rules', 'error', { error: String(err?.message || err) }, 'system');
    }
}
function cleanupLegacyNetworkRules() {
    try {
        const res = db.prepare(`
      DELETE FROM alert_rules
      WHERE kind = 'network_connection_rate'
        AND COALESCE(domain, '') = ''
        AND name = 'External Outbound Connection (Novel Host, 1m >= 1)'
    `).run();
        writeAudit('rules.cleanup_legacy_network_rules', 'alert_rules', 'ok', { deleted: res.changes }, 'system');
    }
    catch (err) {
        writeAudit('rules.cleanup_legacy_network_rules', 'alert_rules', 'error', { error: String(err?.message || err) }, 'system');
    }
}
function ensureSocketConnectRule() {
    try {
        const existing = db.prepare("SELECT id FROM alert_rules WHERE kind = 'network_connect_rate' LIMIT 1").get();
        if (existing?.id) {
            db.prepare(`
        UPDATE alert_rules
        SET name = ?, threshold = ?, windowSec = ?, dedupeSec = ?, notifyEnabled = ?, notifyChannel = ?, notifyCooldownSec = ?, domain = ?, type = ?
        WHERE id = ?
      `).run('External Outbound Connect (Novel Host, 1m >= 1)', 1, 60, 300, 1, 'telegram', 300, 'any', null, existing.id);
            writeAudit('rules.ensure_socket_connect', 'alert_rules', 'ok', { created: false, updated: true }, 'system');
            return;
        }
        db.prepare(`
      INSERT INTO alert_rules (id, name, enabled, kind, threshold, windowSec, dedupeSec, notifyEnabled, notifyChannel, notifyCooldownSec, domain, type, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ulid(), 'External Outbound Connect (Novel Host, 1m >= 1)', 1, 'network_connect_rate', 1, 60, 300, 1, 'telegram', 300, 'any', null, new Date().toISOString());
        writeAudit('rules.ensure_socket_connect', 'alert_rules', 'ok', { created: true, updated: false }, 'system');
    }
    catch (err) {
        writeAudit('rules.ensure_socket_connect', 'alert_rules', 'error', { error: String(err?.message || err) }, 'system');
    }
}
function upsertAlert(ruleId, severity, title, details, dedupeKey, dedupeSec = 600) {
    const existing = db.prepare('SELECT id FROM alerts WHERE dedupeKey = ? AND timestamp >= ?').get(dedupeKey, new Date(Date.now() - Math.max(30, dedupeSec) * 1000).toISOString());
    if (existing?.id)
        return { alertId: null, deduped: true };
    const alertId = ulid();
    db.prepare(`
    INSERT INTO alerts (id, timestamp, ruleId, severity, title, details, dedupeKey, acknowledged)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(alertId, new Date().toISOString(), ruleId, severity, title, JSON.stringify(details || {}), dedupeKey);
    writeAudit('alert.raise', 'alerts', 'ok', { ruleId, title, dedupeKey }, 'system');
    return { alertId, deduped: false };
}
function buildNotificationBody(title, severity, details) {
    const lines = [];
    const sourceType = String(details?.sourceType || 'unknown');
    const sampleSourceClass = String(details?.samples?.[0]?.sourceClass || '').toLowerCase();
    const derivedAttribution = sourceType === 'network.connect'
        ? (sampleSourceClass === 'socket' ? 'socket-observed' : 'network-connect')
        : (sourceType === 'network.request' ? 'tool-context' : 'unknown');
    const attribution = String(details?.attribution || derivedAttribution);
    lines.push(`severity=${severity}`);
    lines.push(`attribution=${attribution}`);
    if (details?.count != null && details?.windowSec != null)
        lines.push(`count=${details.count} in ${details.windowSec}s`);
    if (Array.isArray(details?.topHosts) && details.topHosts.length) {
        const top = details.topHosts.slice(0, 3).map((h) => `${h.host}(${h.count})`).join(', ');
        lines.push(`top hosts: ${top}`);
    }
    if (Array.isArray(details?.topPorts) && details.topPorts.length) {
        const ports = details.topPorts.slice(0, 3).map((p) => `${p.port}(${p.count})`).join(', ');
        lines.push(`top ports: ${ports}`);
    }
    if (Array.isArray(details?.agents) && details.agents.length)
        lines.push(`agents: ${details.agents.join(', ')}`);
    if (details?.sourceType)
        lines.push(`sourceType=${details.sourceType}`);
    if (details?.sourceFilter)
        lines.push(`sourceFilter=${details.sourceFilter}`);
    if (details?.confidenceCounts && typeof details.confidenceCounts === 'object') {
        lines.push(`confidence=${Object.entries(details.confidenceCounts).map(([k, v]) => `${k}:${v}`).join(', ')}`);
    }
    if (Array.isArray(details?.samples) && details.samples.length) {
        const s = details.samples[0];
        const parts = [
            `host=${s?.host || '?'}`,
            `port=${s?.port || '?'}`,
            s?.protocol ? `protocol=${s.protocol}` : null,
            s?.sourceClass ? `source=${s.sourceClass}` : null,
            s?.confidence ? `confidence=${s.confidence}` : null,
            s?.remoteIp ? `ip=${s.remoteIp}` : null,
            s?.agentId ? `agent=${s.agentId}` : null,
            s?.sessionKey ? `session=${s.sessionKey}` : null
        ].filter(Boolean);
        lines.push(`sample: ${parts.join(' ')}`);
    }
    return `${title}\n${lines.join('\n')}`;
}
function queueNotificationIfNeeded(rule, alertId, severity, title, details) {
    if (!rule?.notifyEnabled)
        return { queued: false, reason: 'notify-disabled' };
    const cooldownSec = Number(rule.notifyCooldownSec || 900);
    const last = rule.lastNotifiedAt ? new Date(rule.lastNotifiedAt).getTime() : 0;
    const now = Date.now();
    if (last && now - last < cooldownSec * 1000)
        return { queued: false, reason: 'notify-cooldown' };
    const channel = String(rule.notifyChannel || 'telegram');
    const payload = {
        title: `ObserveClaw Alert: ${title}`,
        body: buildNotificationBody(title, severity, details),
        details
    };
    db.prepare(`
    INSERT INTO notifications_outbox (id, timestamp, ruleId, alertId, channel, payload, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(ulid(), new Date().toISOString(), rule.id, alertId, channel, JSON.stringify(payload));
    db.prepare('UPDATE alert_rules SET lastNotifiedAt = ? WHERE id = ?').run(new Date().toISOString(), rule.id);
    writeAudit('notify.queue', 'notifications_outbox', 'ok', { ruleId: rule.id, alertId, channel }, 'system');
    return { queued: true, reason: 'queued', channel };
}
async function deliverTelegram(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        return { ok: false, error: 'telegram credentials not configured' };
    }
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
        });
        if (!res.ok) {
            const t = await res.text();
            return { ok: false, error: `telegram http ${res.status}: ${t.slice(0, 200)}` };
        }
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: String(err?.message || err) };
    }
}
async function processNotificationOutbox() {
    const rows = db.prepare("SELECT * FROM notifications_outbox WHERE status='pending' ORDER BY timestamp ASC LIMIT 10").all();
    for (const row of rows) {
        let payload = {};
        try {
            payload = JSON.parse(row.payload || '{}');
        }
        catch { }
        let result = { ok: false, error: 'unsupported channel' };
        if (row.channel === 'telegram') {
            const text = `🚨 ${payload?.title || 'ObserveClaw Alert'}\n${payload?.body || ''}`.trim();
            result = await deliverTelegram(text);
        }
        if (result.ok) {
            db.prepare("UPDATE notifications_outbox SET status='sent', sentAt=?, error=NULL WHERE id=?").run(new Date().toISOString(), row.id);
            writeAudit('notify.sent', '/notifications/outbox', 'ok', { id: row.id, channel: row.channel }, 'system');
        }
        else {
            db.prepare("UPDATE notifications_outbox SET status='error', error=? WHERE id=?").run(result.error || 'send failed', row.id);
            writeAudit('notify.error', '/notifications/outbox', 'error', { id: row.id, channel: row.channel, error: result.error }, 'system');
        }
    }
}
function sqlLikeMatch(value, likePattern) {
    const escaped = String(likePattern || '')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(String(value || ''));
}
function normalizeNetworkSourceClass(data) {
    const source = String(data?.source || '').toLowerCase();
    if (source.includes('socket') || data?.sourceType === 'socket-observed')
        return 'socket';
    if (data?.tool || source.includes('tool') || source.includes('semantic') || source.includes('exec'))
        return 'semantic';
    return 'unknown';
}
function getFilteredNetworkRows(since, eventType, opts) {
    const rows = db.prepare(`
    SELECT timestamp, agentId, sessionKey, data
    FROM normalized_events
    WHERE timestamp >= ?
      AND domain = 'network'
      AND type = ?
    ORDER BY timestamp DESC
  `).all(since, eventType);
    const protocol = String(opts?.proto || '').toLowerCase();
    const hostLikePattern = String(opts?.hostLikePattern || '%');
    const sourceClass = opts?.sourceClass || 'any';
    return rows.map((row) => {
        try {
            const d = JSON.parse(row.data || '{}');
            const host = normalizeHost(d.host || d.remoteHost || '');
            const confidence = String(d.attributionConfidence || (d.inferred ? 'medium' : 'high')).toLowerCase();
            return {
                timestamp: row.timestamp,
                agentId: row.agentId,
                sessionKey: row.sessionKey,
                host,
                port: Number(d.port || d.remotePort || 0),
                protocol: String(d.protocol || '').toLowerCase(),
                tlsError: d.tlsError == null ? null : String(d.tlsError),
                certValid: d.certValid == null ? null : !!d.certValid,
                sourceClass: normalizeNetworkSourceClass(d),
                source: d.source || null,
                confidence,
                remoteIp: d.remoteIp || d.resolvedIp || (net.isIP(host) ? host : null),
                resolvedIp: d.resolvedIp || null
            };
        }
        catch {
            return null;
        }
    }).filter((row) => {
        if (!row?.host)
            return false;
        if (!isPublicHost(row.host))
            return false;
        if (protocol && row.protocol !== protocol)
            return false;
        if (!sqlLikeMatch(row.host, hostLikePattern))
            return false;
        if (sourceClass !== 'any' && row.sourceClass !== sourceClass)
            return false;
        const policy = evaluateNetworkPolicy(NETWORK_POLICY, 'outbound', row.host);
        return policy.allow;
    });
}
function getNetworkNoveltyKeys(row) {
    const keys = new Set();
    const host = normalizeHost(row?.host || row?.remoteHost || '');
    const remoteIp = normalizeHost(row?.remoteIp || row?.resolvedIp || '');
    const resolvedIp = normalizeHost(row?.resolvedIp || '');
    if (host)
        keys.add(host);
    if (remoteIp)
        keys.add(remoteIp);
    if (resolvedIp)
        keys.add(resolvedIp);
    return Array.from(keys);
}
function getSeenHostsBefore(windowStartIso, noveltyDays, eventType) {
    const lookbackStartIso = new Date(new Date(windowStartIso).getTime() - Math.max(1, noveltyDays) * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
    SELECT data
    FROM normalized_events
    WHERE timestamp >= ?
      AND timestamp < ?
      AND domain = 'network'
      AND type = ?
  `).all(lookbackStartIso, windowStartIso, eventType);
    const out = new Set();
    for (const r of rows) {
        try {
            const d = JSON.parse(r.data || '{}');
            for (const key of getNetworkNoveltyKeys(d))
                out.add(key);
        }
        catch { }
    }
    return out;
}
function summarizeNetworkRows(rows, since, windowSec, extra = {}) {
    const hostCounts = new Map();
    const portCounts = new Map();
    const agentCounts = new Map();
    const sourceCounts = new Map();
    const confidenceCounts = new Map();
    for (const row of rows) {
        hostCounts.set(row.host, (hostCounts.get(row.host) || 0) + 1);
        if (Number.isFinite(row.port) && row.port > 0)
            portCounts.set(row.port, (portCounts.get(row.port) || 0) + 1);
        if (row.agentId)
            agentCounts.set(row.agentId, (agentCounts.get(row.agentId) || 0) + 1);
        sourceCounts.set(String(row.sourceClass || 'unknown'), (sourceCounts.get(String(row.sourceClass || 'unknown')) || 0) + 1);
        confidenceCounts.set(String(row.confidence || 'unknown'), (confidenceCounts.get(String(row.confidence || 'unknown')) || 0) + 1);
    }
    const topHosts = Array.from(hostCounts.entries()).map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count).slice(0, 5);
    const topPorts = Array.from(portCounts.entries()).map(([port, count]) => ({ port, count })).sort((a, b) => b.count - a.count).slice(0, 5);
    const agents = Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1]).map(([agentId]) => agentId).slice(0, 5);
    const samples = rows.slice(0, 5).map((r) => ({
        timestamp: r.timestamp,
        agentId: r.agentId,
        sessionKey: r.sessionKey,
        host: r.host,
        remoteIp: r.remoteIp || null,
        port: r.port,
        protocol: r.protocol,
        source: r.source,
        sourceClass: r.sourceClass,
        confidence: r.confidence
    }));
    const primaryHost = topHosts[0]?.host || null;
    const primaryPort = topPorts[0]?.port || null;
    return {
        count: rows.length,
        since,
        windowSec,
        host: primaryHost,
        port: primaryPort,
        topHosts,
        topPorts,
        agents,
        sourceCounts: Object.fromEntries(sourceCounts),
        confidenceCounts: Object.fromEntries(confidenceCounts),
        samples,
        ...extra
    };
}
const ruleEvalDiagnostics = new Map();
function resolveRuleNetworkSourceFilter(rule, fallback = 'any') {
    const raw = String(rule?.domain || '').trim().toLowerCase();
    if (raw === 'semantic' || raw === 'socket' || raw === 'any')
        return raw;
    return fallback;
}
function evaluateRules() {
    const rules = db.prepare('SELECT * FROM alert_rules WHERE enabled = 1').all();
    const now = Date.now();
    for (const r of rules) {
        const windowSec = Number(r.windowSec || 300);
        const dedupeSec = Number(r.dedupeSec || 600);
        const since = new Date(now - windowSec * 1000).toISOString();
        const bucket = Math.floor(now / (Math.max(30, dedupeSec) * 1000));
        let triggered = false;
        let reason = 'threshold-not-met';
        let details = { since, windowSec };
        if (r.kind === 'error_burst') {
            const count = db.prepare(`SELECT COUNT(*) as c FROM normalized_events WHERE timestamp >= ? AND (severity = 'error' OR type LIKE '%error%')`).get(since)?.c || 0;
            details = { count, since };
            if (count >= (r.threshold || 3)) {
                const alertResult = upsertAlert(r.id, 'warning', r.name, details, `rule:${r.id}:bucket:${bucket}`, dedupeSec);
                details.deduped = alertResult.deduped;
                if (alertResult.alertId)
                    details.notification = queueNotificationIfNeeded(r, alertResult.alertId, 'warning', r.name, details);
                triggered = true;
            }
        }
        else if (r.kind === 'event_rate') {
            const count = db.prepare(`SELECT COUNT(*) as c FROM normalized_events WHERE timestamp >= ? AND domain = ? AND type = ?`).get(since, r.domain, r.type)?.c || 0;
            details = { count, since, domain: r.domain, type: r.type };
            if (count >= (r.threshold || 20)) {
                const alertResult = upsertAlert(r.id, 'info', r.name, details, `rule:${r.id}:bucket:${bucket}`, dedupeSec);
                details.deduped = alertResult.deduped;
                if (alertResult.alertId)
                    details.notification = queueNotificationIfNeeded(r, alertResult.alertId, 'info', r.name, details);
                triggered = true;
            }
        }
        else if (r.kind === 'absence') {
            const count = db.prepare(`SELECT COUNT(*) as c FROM normalized_events WHERE timestamp >= ? AND domain = ? AND type = ?`).get(since, r.domain, r.type)?.c || 0;
            details = { count, since, domain: r.domain, type: r.type };
            if (count < (r.threshold || 1)) {
                const alertResult = upsertAlert(r.id, 'warning', r.name, details, `rule:${r.id}:bucket:${bucket}`, dedupeSec);
                details.deduped = alertResult.deduped;
                if (alertResult.alertId)
                    details.notification = queueNotificationIfNeeded(r, alertResult.alertId, 'warning', r.name, details);
                triggered = true;
            }
        }
        else if (r.kind === 'network_domain_match') {
            const pattern = String(r.domain || '%');
            const rows = getFilteredNetworkRows(since, 'network.request', { hostLikePattern: pattern, sourceClass: 'semantic' });
            details = summarizeNetworkRows(rows, since, windowSec, { hostPattern: pattern, sourceType: 'network.request', sourceFilter: 'semantic' });
            details.eventCount = rows.length;
            details.matched = rows.length >= (r.threshold || 1);
            if (rows.length >= (r.threshold || 1)) {
                const alertResult = upsertAlert(r.id, 'warning', r.name, details, `rule:${r.id}:bucket:${bucket}`, dedupeSec);
                details.deduped = alertResult.deduped;
                if (alertResult.alertId) {
                    details.alertId = alertResult.alertId;
                    details.notification = queueNotificationIfNeeded(r, alertResult.alertId, 'warning', r.name, details);
                }
                else {
                    details.notification = { queued: false, reason: 'alert-deduped' };
                }
                triggered = true;
            }
        }
        else if (r.kind === 'network_request_rate' || r.kind === 'network_connection_rate' || r.kind === 'network_connect_rate') {
            const isConnectRule = r.kind === 'network_connect_rate';
            const eventType = isConnectRule ? 'network.connect' : 'network.request';
            const defaultSource = isConnectRule ? 'any' : 'semantic';
            const sourceFilter = resolveRuleNetworkSourceFilter(r, defaultSource);
            const proto = String(r.type || '');
            const rows = getFilteredNetworkRows(since, eventType, { proto, sourceClass: sourceFilter });
            const noveltyDays = Math.max(1, Number(process.env.OBSERVECLAW_NETWORK_NOVELTY_DAYS || '7'));
            const seenHosts = getSeenHostsBefore(since, noveltyDays, eventType);
            const novelRows = rows.filter((row) => getNetworkNoveltyKeys(row).every((key) => !seenHosts.has(key)));
            const connectSampleSourceClass = String(novelRows[0]?.sourceClass || '').toLowerCase();
            details = summarizeNetworkRows(novelRows, since, windowSec, {
                protocol: proto || 'any',
                sourceType: eventType,
                sourceFilter,
                noveltyDays,
                attribution: isConnectRule
                    ? (connectSampleSourceClass === 'socket' ? 'socket-observed' : 'network-connect')
                    : 'tool-context',
                novelHosts: Array.from(new Set(novelRows.map((x) => x.host))).slice(0, 20)
            });
            details.host = details.host || details.topHosts?.[0]?.host || null;
            details.port = details.port || details.topPorts?.[0]?.port || null;
            details.eventCount = rows.length;
            details.novelCount = novelRows.length;
            details.matched = novelRows.length >= (r.threshold || 1);
            if (novelRows.length >= (r.threshold || 1)) {
                const lead = novelRows[0] || {};
                const dedupeKey = isConnectRule
                    ? `rule:${r.id}:host:${lead.host || 'unknown'}:port:${lead.port || 0}:proto:${lead.protocol || proto || 'any'}:bucket:${bucket}`
                    : `rule:${r.id}:bucket:${bucket}`;
                const alertResult = upsertAlert(r.id, 'warning', r.name, details, dedupeKey, dedupeSec);
                details.dedupeKey = dedupeKey;
                details.deduped = alertResult.deduped;
                if (alertResult.alertId) {
                    details.alertId = alertResult.alertId;
                    details.notification = queueNotificationIfNeeded(r, alertResult.alertId, 'warning', r.name, details);
                }
                else {
                    details.notification = { queued: false, reason: 'alert-deduped' };
                }
                triggered = true;
            }
        }
        else if (r.kind === 'network_strict_violation') {
            const sourceFilter = resolveRuleNetworkSourceFilter(r, 'semantic');
            const rows = getFilteredNetworkRows(since, 'network.request', { sourceClass: sourceFilter });
            const strictRows = rows.filter((row) => {
                const nonStandardPort = Number(row.port || 0) > 0 && Number(row.port) !== 443;
                const tlsError = !!row.tlsError;
                const badCert = row.certValid === false;
                return nonStandardPort || tlsError || badCert;
            });
            details = summarizeNetworkRows(strictRows, since, windowSec, {
                sourceType: 'network.request',
                sourceFilter,
                strictPolicy: 'always-alert',
                reasons: {
                    non443: strictRows.filter((r) => Number(r.port || 0) > 0 && Number(r.port) !== 443).length,
                    tlsError: strictRows.filter((r) => !!r.tlsError).length,
                    badCert: strictRows.filter((r) => r.certValid === false).length
                }
            });
            details.eventCount = rows.length;
            details.strictCount = strictRows.length;
            details.matched = strictRows.length >= (r.threshold || 1);
            if (strictRows.length >= (r.threshold || 1)) {
                const alertResult = upsertAlert(r.id, 'critical', r.name, details, `rule:${r.id}:bucket:${bucket}`, dedupeSec);
                details.deduped = alertResult.deduped;
                if (alertResult.alertId) {
                    details.alertId = alertResult.alertId;
                    details.notification = queueNotificationIfNeeded(r, alertResult.alertId, 'critical', r.name, details);
                }
                else {
                    details.notification = { queued: false, reason: 'alert-deduped' };
                }
                triggered = true;
            }
        }
        else {
            reason = 'unknown-kind';
        }
        if (triggered)
            reason = 'triggered';
        ruleEvalDiagnostics.set(String(r.id), { ruleId: r.id, name: r.name, kind: r.kind, reason, triggered, evaluatedAt: new Date().toISOString(), details });
        if (ruleEvalDiagnostics.size > 200) {
            const oldest = ruleEvalDiagnostics.keys().next().value;
            if (oldest)
                ruleEvalDiagnostics.delete(oldest);
        }
    }
}
function ingestEventIntoPulse(row) {
    try {
        const eventId = String(row?.id || '');
        if (hasPulseSeen(eventId))
            return;
        const type = String(row?.type || '');
        const data = typeof row?.data === 'string' ? (() => { try {
            return JSON.parse(row.data);
        }
        catch {
            return {};
        } })() : (row?.data || {});
        if (PULSE_DEBUG && (type === 'tool.invoke' || type === 'tool.complete' || type === 'session.output' || type === 'session.state' || type === 'message.queued' || type === 'message.processed' || type === 'model.usage')) {
            const stateHint = typeof data?.state === 'string' ? data.state : null;
            const modelHint = typeof data?.model === 'string' ? data.model : null;
            console.log('[pulse:ingest]', JSON.stringify({
                id: eventId,
                ts: row?.timestamp,
                type,
                agentId: row?.agentId || null,
                sessionKey: row?.sessionKey || null,
                stateHint,
                modelHint
            }));
        }
        pulseEngine.ingestEvent({
            type,
            timestamp: row?.timestamp,
            agentId: row?.agentId || null,
            sessionKey: row?.sessionKey || null,
            data
        });
        markPulseSeen(eventId);
    }
    catch { }
}
function hydratePulseFromDatabase() {
    try {
        const rows = db.prepare(`
      SELECT rowid as _rowid, id, timestamp, type, agentId, sessionKey, data
      FROM normalized_events
      ORDER BY rowid DESC
      LIMIT 500
    `).all();
        const inOrder = rows.slice().reverse();
        for (const r of inOrder)
            ingestEventIntoPulse(r);
        const max = db.prepare('SELECT COALESCE(MAX(rowid), 0) as m FROM normalized_events').get()?.m || 0;
        pulseLastRowId = Number(max) || 0;
        retentionCronLastRowId = Number(max) || 0;
    }
    catch { }
}
function syncPulseFromDatabase() {
    try {
        const rows = db.prepare(`
      SELECT rowid as _rowid, id, timestamp, type, agentId, sessionKey, data
      FROM normalized_events
      WHERE rowid > ?
      ORDER BY rowid ASC
      LIMIT 1000
    `).all(pulseLastRowId);
        if (!rows.length)
            return;
        for (const r of rows) {
            ingestEventIntoPulse(r);
            maybeHandleRetentionTrigger(r);
            const rid = Number(r?._rowid || 0);
            if (rid > pulseLastRowId)
                pulseLastRowId = rid;
        }
    }
    catch { }
}
function runRetentionSweep(trigger = 'interval') {
    try {
        const policy = loadRetentionPolicy(db);
        if (!policy.enabled)
            return;
        const startedAt = new Date().toISOString();
        const runId = ulid();
        db.prepare('INSERT INTO retention_runs (id, startedAt, status, dryRun, trigger) VALUES (?, ?, ?, ?, ?)').run(runId, startedAt, 'running', 0, trigger);
        const day = new Date().getDay();
        const runVacuum = day === 0; // weekly on Sunday
        const out = runRetention(db, policy, { dryRun: false, runCheckpoint: true, runVacuum });
        db.prepare('UPDATE retention_runs SET endedAt = ?, status = ?, summaryJson = ? WHERE id = ?').run(new Date().toISOString(), 'ok', JSON.stringify(out), runId);
        writeAudit('retention.sweep', 'db', 'ok', {
            trigger,
            normalizedDeleted: out.normalizedDeleted,
            auditDeleted: out.auditDeleted,
            rawDeleted: out.rawDeleted,
            checkpointRan: out.checkpointRan,
            vacuumRan: out.vacuumRan
        }, 'system');
    }
    catch (err) {
        const error = String(err?.message || err);
        writeAudit('retention.sweep', 'db', 'error', { trigger, error }, 'system');
        const policy = loadRetentionPolicy(db);
        if (policy.notifyOnFailureOnly) {
            db.prepare(`
        INSERT INTO notifications_outbox (id, timestamp, ruleId, alertId, channel, payload, status)
        VALUES (?, ?, NULL, NULL, 'telegram', ?, 'pending')
      `).run(ulid(), new Date().toISOString(), JSON.stringify({ title: 'ObserveClaw Retention Failed', body: `trigger=${trigger}\nerror=${error}` }));
        }
    }
}
const start = async () => {
    try {
        initDB();
        seedDefaultRules();
        ensureExternalOutboundRule();
        ensureSocketConnectRule();
        cleanupLegacyNetworkRules();
        ensureStrictNetworkRule();
        hydratePulseFromDatabase();
        runRetentionSweep('startup');
        evaluateRules();
        await processNotificationOutbox();
        refreshTrackedNetworkPids();
        sampleNetworkConnections();
        setInterval(() => { void runJobIfIdle('evaluateRules', () => evaluateRules()); }, 30 * 1000); // every 30s
        setInterval(() => { void runJobIfIdle('processNotificationOutbox', () => processNotificationOutbox()); }, 10 * 1000); // every 10s
        setInterval(() => { void runJobIfIdle('syncPulseFromDatabase', () => syncPulseFromDatabase()); }, PULSE_SYNC_MS); // incremental pulse sync from ingested events
        setInterval(() => { void runJobIfIdle('pollRetentionCronTriggers', () => pollRetentionCronTriggers()); }, RETENTION_CRON_POLL_MS); // incremental retention trigger polling
        setInterval(() => { void runJobIfIdle('refreshTrackedNetworkPids', () => refreshTrackedNetworkPids()); }, Math.max(10000, NETWORK_SCOPE_REFRESH_MS));
        setInterval(() => { void runJobIfIdle('sampleNetworkConnections', () => sampleNetworkConnections()); }, NETWORK_CONNECTION_SAMPLE_MS); // adaptive network sampling
        setInterval(() => { pulseEngine.tick(); }, 1000); // pulse decay/staleness tick
        connectToGateway();
        if (!telegramNotifierConfigured()) {
            console.warn('⚠️ ObserveClaw notifier: telegram credentials missing (OBSERVECLAW_TELEGRAM_BOT_TOKEN / OBSERVECLAW_TELEGRAM_CHAT_ID).');
        }
        const port = Number(process.env.OBSERVECLAW_PORT || process.env.PORT || 3001);
        const host = process.env.OBSERVECLAW_HOST || '0.0.0.0';
        await server.listen({ port, host });
        console.log(`ObserveClaw server listening on ${host}:${port}`);
        if (!OPERATOR_PASSWORD) {
            console.warn('⚠️  No OBSERVECLAW_OPERATOR_PASSWORD set — dashboard is running in OPEN mode (no auth).');
            console.warn('   Set OBSERVECLAW_OPERATOR_PASSWORD in .env or ~/.openclaw/observeclaw.env to enable auth.');
        }
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=server.js.map