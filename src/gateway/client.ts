import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { ulid } from 'ulid';
import net from 'net';
import { db } from '../db/index.js';
import { eventBus } from '../server.js';
import { isInferredEvent, loadPolicy } from '../retention/policy.js';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
const GATEWAY_PASSWORD = process.env.GATEWAY_PASSWORD || '';
const INGEST_MODE = (process.env.OBSERVECLAW_INGEST_MODE || 'gateway').toLowerCase();

const ROOT = path.join(os.homedir(), '.openclaw', 'agents');
const execFileAsync = promisify(execFile);
let insertNormStmt: any;
let insertRawStmt: any;
let gatewayClient: any = null;
let gatewayPollTimer: any = null;
let sessionPollTimer: any = null;
const fileOffsets = new Map<string, number>();
let directGatewayCall: ((opts: any) => Promise<any>) | null = null;
let ingestRuntimeStatus: { mode: string; reason: string; updatedAt: string; gatewayUrl: string; modulePath: string | null } = {
  mode: INGEST_MODE === 'fallback' ? 'fallback' : 'starting',
  reason: INGEST_MODE === 'fallback' ? 'forced fallback mode' : 'initializing',
  updatedAt: new Date().toISOString(),
  gatewayUrl: GATEWAY_URL,
  modulePath: null
};

const DROP_UNKNOWN_SESSION_STATE = process.env.OBSERVECLAW_DROP_UNKNOWN_SESSION_STATE !== '0';
const SNAPSHOT_MIN_INTERVAL_SEC = Number(process.env.OBSERVECLAW_SNAPSHOT_MIN_INTERVAL_SEC || '60');
const HEALTH_MIN_INTERVAL_SEC = Number(process.env.OBSERVECLAW_HEALTH_MIN_INTERVAL_SEC || '3600');
const MODEL_USAGE_MIN_INTERVAL_SEC = Number(process.env.OBSERVECLAW_MODEL_USAGE_MIN_INTERVAL_SEC || '180');
const MODEL_USAGE_MIN_TOKEN_DELTA = Number(process.env.OBSERVECLAW_MODEL_USAGE_MIN_TOKEN_DELTA || '3000');
const MODEL_USAGE_MAX_INTERVAL_SEC = Number(process.env.OBSERVECLAW_MODEL_USAGE_MAX_INTERVAL_SEC || '21600');

const eventStoreDefaults: Record<string, boolean> = {
  'tool.invoke': true,
  'tool.complete': true,
  'message.queued': true,
  'message.processed': true,
  'webhook.received': true,
  'model.usage': true,
  'health': true,
  'network.connect': true,
  'network.request': true,
  'access.credential.use': true,
  'session.state': true,
  'sessions.snapshot': false,
  'channels.snapshot': false,
  'gateway.hello': false,
  'gateway.observe.subscribed': false,
  'gateway.observe.subscribe_failed': true,
  'gateway.seq_gap': true,
  'gateway.poll.error': true
};

const snapshotCache = new Map<string, { hash: string; lastStoredAt: number }>();
const healthCache = new Map<string, { lastStoredAt: number }>();
const modelUsageCache = new Map<string, { lastStoredAt: number; lastTokens: number }>();
const knownModelByAgent = new Map<string, { model?: string; provider?: string; updatedAtMs: number }>();
const knownModelBySession = new Map<string, { model?: string; provider?: string; updatedAtMs: number }>();
const KNOWN_MODEL_CACHE_LIMIT = 2000;
const policyStats = {
  stored: 0,
  dropped: 0,
  droppedByReason: new Map<string, number>(),
  storedByType: new Map<string, number>(),
  droppedByType: new Map<string, number>()
};

export function getIngestStatus() {
  return {
    ...ingestRuntimeStatus,
    hasGatewayClient: !!gatewayClient,
    hasGatewayPollTimer: !!gatewayPollTimer,
    hasSessionPollTimer: !!sessionPollTimer,
    configuredMode: INGEST_MODE
  };
}

export function getIngestPolicyStats() {
  const mapToObj = (m: Map<string, number>) => Object.fromEntries(Array.from(m.entries()).sort((a, b) => b[1] - a[1]));
  return {
    stored: policyStats.stored,
    dropped: policyStats.dropped,
    droppedByReason: mapToObj(policyStats.droppedByReason),
    storedByType: mapToObj(policyStats.storedByType),
    droppedByType: mapToObj(policyStats.droppedByType),
    config: {
      dropUnknownSessionState: DROP_UNKNOWN_SESSION_STATE,
      snapshotMinIntervalSec: SNAPSHOT_MIN_INTERVAL_SEC,
      healthMinIntervalSec: HEALTH_MIN_INTERVAL_SEC,
      modelUsageMinIntervalSec: MODEL_USAGE_MIN_INTERVAL_SEC,
      modelUsageMinTokenDelta: MODEL_USAGE_MIN_TOKEN_DELTA,
      modelUsageMaxIntervalSec: MODEL_USAGE_MAX_INTERVAL_SEC
    }
  };
}

export async function connectToGateway() {
  if (!insertNormStmt || !insertRawStmt) {
    insertRawStmt = db.prepare(`
      INSERT INTO raw_events (id, source, sourceEventType, sourceSeq, sourceKey, ingestedAt, payload)
      VALUES (@id, @source, @sourceEventType, @sourceSeq, @sourceKey, @ingestedAt, @payload)
    `);

    insertNormStmt = db.prepare(`
      INSERT INTO normalized_events (id, rawEventId, timestamp, domain, type, severity, agentId, sessionKey, channel, summary, data)
      VALUES (@id, @rawEventId, @timestamp, @domain, @type, @severity, @agentId, @sessionKey, @channel, @summary, @data)
    `);
  }

  if (INGEST_MODE === 'fallback') {
    ingestRuntimeStatus = { ...ingestRuntimeStatus, mode: 'fallback', reason: 'forced fallback mode', updatedAt: new Date().toISOString() };
    startFallbackIngest('forced fallback mode');
    return;
  }

  try {
    await startGatewayClient();
  } catch (err: any) {
    console.error(`❌ Gateway ingest bootstrap failed: ${err?.message || err}`);
    startFallbackIngest('gateway bootstrap failed');
  }
}

async function startGatewayClient() {
  const modulePath = findOpenClawClientModule();
  let activeTransport = modulePath;
  ingestRuntimeStatus = { ...ingestRuntimeStatus, mode: 'gateway-starting', reason: 'locating gateway client module', updatedAt: new Date().toISOString(), modulePath };

  let GatewayClient: any = null;
  if (modulePath) {
    const mod = await import(pathToFileURL(modulePath).href);
    GatewayClient =
      (mod as any).GatewayClient ||
      Object.values(mod as any).find((v: any) => typeof v === 'function' && v.prototype && typeof v.prototype.start === 'function' && typeof v.prototype.request === 'function');
  }
  if (!GatewayClient) {
    const loaded = await loadDirectGatewayCall();
    if (loaded) {
      activeTransport = 'openclaw direct gateway rpc';
      ingestRuntimeStatus = { ...ingestRuntimeStatus, mode: 'gateway-starting', reason: 'using direct gateway rpc transport', updatedAt: new Date().toISOString(), modulePath: activeTransport };
      GatewayClient = DirectGatewayClient;
    }
  }
  if (!GatewayClient) {
    console.warn('⚠️ GatewayClient module unavailable; using openclaw gateway call transport');
    activeTransport = 'openclaw gateway call';
    ingestRuntimeStatus = { ...ingestRuntimeStatus, mode: 'gateway-starting', reason: 'using gateway CLI transport', updatedAt: new Date().toISOString(), modulePath: activeTransport };
    GatewayClient = CliGatewayClient;
  }

  console.log(`🔌 ObserveClaw gateway mode: connecting to ${GATEWAY_URL}`);

  gatewayClient = new GatewayClient({
    url: GATEWAY_URL,
    token: GATEWAY_TOKEN || undefined,
    password: GATEWAY_PASSWORD || undefined,
    clientName: 'gateway-client',
    mode: 'backend',
    role: 'operator',
    scopes: ['operator.read', 'operator.admin'],
    onHelloOk: (hello: any) => {
      ingestRuntimeStatus = { ...ingestRuntimeStatus, mode: 'gateway', reason: 'connected', updatedAt: new Date().toISOString(), modulePath: activeTransport };
      emitNormalized({
        type: 'gateway.hello',
        domain: 'system',
        severity: 'info',
        summary: `Gateway connected (protocol ${hello?.protocol ?? 'n/a'})`,
        data: hello
      });
      console.log(`✅ ObserveClaw connected via ${activeTransport || 'gateway transport'}`);

      // Optional explicit subscription for diagnostic/event streams.
      gatewayClient
        .request('observe.subscribe', {
          domains: ['agent', 'tool', 'channel', 'session', 'access', 'system'],
          minSeverity: 'info'
        })
        .then(() => {
          emitNormalized({
            type: 'gateway.observe.subscribed',
            domain: 'system',
            severity: 'info',
            summary: 'Subscribed to observe event stream',
            data: {}
          });
        })
        .catch((err: any) => {
          emitNormalized({
            type: 'gateway.observe.subscribe_failed',
            domain: 'system',
            severity: 'warning',
            summary: `Observe subscribe unavailable: ${String(err?.message || err)}`,
            data: { error: String(err?.message || err) }
          });
        });

      startGatewayPollers();
      startSessionEnrichment('gateway-hybrid');
    },
    onConnectError: (err: any) => {
      console.error(`❌ Gateway connect error: ${String(err?.message || err)}`);
    },
    onClose: (code: number, reason: string) => {
      console.warn(`⚠️ Gateway closed (${code}): ${reason}`);
    },
    onGap: (gap: any) => {
      emitNormalized({
        type: 'gateway.seq_gap',
        domain: 'system',
        severity: 'warning',
        summary: `Event gap expected=${gap?.expected} received=${gap?.received}`,
        data: gap
      });
    },
    onEvent: (evt: any) => {
      handleGatewayEvent(evt);
    }
  });

  gatewayClient.start();
}

function maybeEmitSessionOutputFromGateway(eventName: string, payload: any, frame: any) {
  const agentId = payload?.agentId || payload?.agent || null;
  const sessionKey = payload?.sessionKey || payload?.session || null;
  const channel = payload?.channel || null;
  const ts = payload?.timestamp || new Date().toISOString();

  const emitSynthetic = (why: string, model?: string | null) => {
    emitNormalized({
      timestamp: ts,
      type: 'session.output',
      domain: 'session',
      severity: 'info',
      agentId,
      sessionKey,
      channel,
      summary: 'Session output (inferred)',
      data: {
        inferred: true,
        sourceEvent: eventName,
        reason: why,
        state: 'THINKING',
        model: model || null
      },
      _meta: {
        source: 'gateway',
        sourceEventType: 'session.output',
        sourceSeq: typeof frame?.seq === 'number' ? frame.seq : null,
        sourceKey: `gateway:session.output:inferred:${eventName}:${frame?.seq ?? ''}:${sessionKey || ''}:${agentId || ''}:${ts}`
      }
    });
  };

  if (eventName === 'chat') {
    const state = String(payload?.state || '').toLowerCase();
    const role = String(payload?.message?.role || '').toLowerCase();
    if (state === 'delta' && role === 'assistant') {
      emitSynthetic('chat.assistant.delta', typeof payload?.message?.model === 'string' ? payload.message.model : null);
      return;
    }
  }

  if (eventName === 'agent') {
    const stream = String(payload?.stream || '').toLowerCase();
    const hasAssistantText = typeof payload?.data?.text === 'string' && payload.data.text.length > 0;
    if (stream === 'assistant' && hasAssistantText) {
      emitSynthetic('agent.assistant.stream', typeof payload?.model === 'string' ? payload.model : null);
      return;
    }
  }
}

function handleGatewayEvent(frame: any) {
  const eventName = frame?.event;
  const payload = frame?.payload || {};
  if (!eventName || eventName === 'tick' || eventName === 'connect.challenge') return;

  const { type, domain, severity, agentId, sessionKey, channel, summary } = normalizeGatewayFrame(eventName, payload);
  emitNormalized({
    type,
    domain,
    severity,
    agentId,
    sessionKey,
    channel,
    summary,
    data: payload,
    _meta: {
      source: 'gateway',
      sourceEventType: eventName,
      sourceSeq: typeof frame?.seq === 'number' ? frame.seq : null,
      sourceKey: `gateway:${eventName}:${frame?.seq ?? ''}:${payload?.sessionKey ?? payload?.session ?? ''}:${payload?.agentId ?? payload?.agent ?? ''}:${payload?.timestamp ?? ''}`
    }
  });

  maybeEmitSessionOutputFromGateway(eventName, payload, frame);
}

function startGatewayPollers() {
  if (gatewayPollTimer) clearInterval(gatewayPollTimer);

  const run = async () => {
    if (!gatewayClient) return;
    try {
      const sessions = await gatewayClient.request('sessions.list', { limit: 80 });
      const list = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
      emitNormalized({
        type: 'sessions.snapshot',
        domain: 'session',
        severity: 'info',
        summary: `Active sessions: ${list.length}`,
        data: { count: list.length }
      });

      for (const s of list.slice(0, 30)) {
        emitNormalized({
          type: 'session.state',
          domain: 'session',
          severity: 'info',
          agentId: s?.agentId || null,
          sessionKey: s?.key || null,
          channel: s?.channel || null,
          summary: `Session ${s?.key || 'unknown'} (${s?.kind || 'unknown'})`,
          data: {
            state: s?.state || 'unknown',
            kind: s?.kind,
            updatedAt: s?.updatedAt,
            model: s?.model,
            label: s?.label
          }
        });
      }

      const channels = await gatewayClient.request('channels.status', {});
      const channelCount = Array.isArray(channels?.channels) ? channels.channels.length : 0;
      emitNormalized({
        type: 'channels.snapshot',
        domain: 'channel',
        severity: 'info',
        summary: `Connected channels: ${channelCount}`,
        data: channels || {}
      });

      const usage = await gatewayClient.request('sessions.usage', { limit: 200 });
      const usageSessions = Array.isArray(usage?.sessions) ? usage.sessions : [];
      let totalTokens = 0;
      let totalCost = 0;
      for (const us of usageSessions.slice(0, 100)) {
        const tokens = us?.usage?.totalTokens || 0;
        const cost = us?.usage?.totalCost || 0;
        totalTokens += tokens;
        totalCost += cost;
      }
      emitNormalized({
        type: 'model.usage',
        domain: 'agent',
        severity: 'info',
        summary: `Aggregated usage: ${totalTokens} tokens`,
        data: {
          tokens: { total: totalTokens },
          cost: { total: totalCost },
          sessions: usageSessions.length
        }
      });
    } catch (err: any) {
      emitNormalized({
        type: 'gateway.poll.error',
        domain: 'system',
        severity: 'warning',
        summary: `Polling error: ${String(err?.message || err)}`,
        data: { error: String(err?.message || err) }
      });
    }
  };

  run();
  gatewayPollTimer = setInterval(run, 300000);
}

function normalizeGatewayFrame(eventName: string, payload: any) {
  const type = eventName;
  let domain: string = 'system';
  let severity: string = 'info';
  let summary = `Event: ${eventName}`;

  if (eventName.startsWith('model.') || eventName.startsWith('agent.')) domain = 'agent';
  else if (eventName.startsWith('tool.')) domain = 'tool';
  else if (eventName.startsWith('message.') || eventName.startsWith('webhook.') || eventName.startsWith('channel.')) domain = 'channel';
  else if (eventName.startsWith('session.') || eventName.startsWith('queue.lane.')) domain = 'session';
  else if (eventName.startsWith('access.')) domain = 'access';

  if (eventName.includes('error') || payload?.level === 'error') severity = 'error';
  if (eventName.includes('warn') || payload?.level === 'warn') severity = 'warning';

  switch (eventName) {
    case 'model.usage':
      summary = `Tokens used: ${payload?.tokens?.total ?? payload?.usage?.totalTokens ?? 'unknown'}`;
      break;
    case 'message.queued':
      summary = `Message queued${payload?.channel ? ` on ${payload.channel}` : ''}`;
      break;
    case 'message.processed':
      summary = `Message processed${payload?.channel ? ` on ${payload.channel}` : ''}`;
      break;
    case 'webhook.received':
      summary = `Webhook received${payload?.channel ? ` on ${payload.channel}` : ''}`;
      break;
    case 'session.state':
      summary = `Session state: ${payload?.state ?? 'unknown'}`;
      break;
    case 'queue.lane.active':
      summary = `Queue lane active`;
      break;
  }

  return {
    type,
    domain,
    severity,
    summary,
    agentId: payload?.agentId || payload?.agent || null,
    sessionKey: payload?.sessionKey || payload?.session || null,
    channel: payload?.channel || null
  };
}

function isEventTypeEnabled(type: string): boolean {
  const key = String(type || 'unknown.event');
  const envKey = `OBSERVECLAW_STORE_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const envVal = process.env[envKey];
  if (envVal === '1') return true;
  if (envVal === '0') return false;
  return eventStoreDefaults[key] ?? true;
}

function trimToString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next ? next : null;
}

function trimModelCache(map: Map<string, { model?: string; provider?: string; updatedAtMs: number }>) {
  while (map.size > KNOWN_MODEL_CACHE_LIMIT) {
    const first = map.keys().next().value;
    if (!first) break;
    map.delete(first);
  }
}

function buildKnownModelEntry(model: string | null | undefined, provider: string | null | undefined, updatedAtMs: number) {
  const entry: { model?: string; provider?: string; updatedAtMs: number } = { updatedAtMs };
  if (model) entry.model = model;
  if (provider) entry.provider = provider;
  return entry;
}

function cacheKnownModelFromEvent(e: any, nowMs: number): void {
  const payload = e?.data;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  const model = trimToString(payload.model);
  const provider = trimToString(payload.provider);
  if (!model && !provider) return;

  const currentByAgent = knownModelByAgent.get(String(e?.agentId || ''));
  const currentBySession = knownModelBySession.get(String(e?.sessionKey || ''));

  if (e?.agentId) {
    knownModelByAgent.set(
      String(e.agentId),
      buildKnownModelEntry(model ?? currentByAgent?.model, provider ?? currentByAgent?.provider, nowMs)
    );
    trimModelCache(knownModelByAgent);
  }

  if (e?.sessionKey) {
    knownModelBySession.set(
      String(e.sessionKey),
      buildKnownModelEntry(model ?? currentBySession?.model, provider ?? currentBySession?.provider, nowMs)
    );
    trimModelCache(knownModelBySession);
  }
}

function enrichEventWithKnownModel(e: any): any {
  const payload = e?.data;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return e;

  const hasModel = Boolean(trimToString(payload.model));
  const hasProvider = Boolean(trimToString(payload.provider));
  if (hasModel && hasProvider) return e;

  const fromSession = e?.sessionKey ? knownModelBySession.get(String(e.sessionKey)) : null;
  const fromAgent = e?.agentId ? knownModelByAgent.get(String(e.agentId)) : null;
  const known = fromSession || fromAgent;
  if (!known) return e;

  const nextPayload: Record<string, unknown> = { ...payload };
  if (!hasModel && known.model) nextPayload.model = known.model;
  if (!hasProvider && known.provider) nextPayload.provider = known.provider;
  return { ...e, data: nextPayload };
}

function countMapInc(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function policyDrop(reason: string, type: string) {
  policyStats.dropped += 1;
  countMapInc(policyStats.droppedByReason, reason);
  countMapInc(policyStats.droppedByType, type);
}

function policyStore(type: string) {
  policyStats.stored += 1;
  countMapInc(policyStats.storedByType, type);
}

function shouldStoreNormalized(e: any, nowMs: number): { store: boolean; reason?: string } {
  const type = String(e?.type || 'unknown.event');

  if (!isEventTypeEnabled(type)) return { store: false, reason: 'disabled-by-toggle' };

  try {
    const policy = loadPolicy(db);
    const inferred = isInferredEvent(type, e?.data, e?.summary);
    const keepInferredNetwork = inferred && (type === 'network.request' || type === 'network.connect');
    if (!policy.includeInferred && inferred && !keepInferredNetwork) {
      return { store: false, reason: 'inferred-excluded' };
    }
  } catch {
    // best-effort: default to excluding inferred, except for network evidence used by alerting
    const inferred = isInferredEvent(type, e?.data, e?.summary);
    const keepInferredNetwork = inferred && (type === 'network.request' || type === 'network.connect');
    if (inferred && !keepInferredNetwork) {
      return { store: false, reason: 'inferred-excluded' };
    }
  }

  if (type === 'session.state' && DROP_UNKNOWN_SESSION_STATE) {
    const st = String(e?.data?.state ?? '').toLowerCase();
    if (!st || st === 'unknown' || st === 'null' || st === 'undefined') {
      return { store: false, reason: 'unknown-session-state' };
    }
  }

  if ((type === 'sessions.snapshot' || type === 'channels.snapshot') && SNAPSHOT_MIN_INTERVAL_SEC > 0) {
    let hash = '';
    try {
      hash = JSON.stringify(e?.data ?? {});
    } catch {
      hash = String(e?.summary || '');
    }
    const prev = snapshotCache.get(type);
    const minMs = SNAPSHOT_MIN_INTERVAL_SEC * 1000;
    if (prev && prev.hash === hash && nowMs - prev.lastStoredAt < minMs) {
      return { store: false, reason: 'snapshot-throttled' };
    }
    snapshotCache.set(type, { hash, lastStoredAt: nowMs });
  }

  if (type === 'health') {
    const key = String(e?.agentId || e?.sessionKey || 'global');
    const prev = healthCache.get(key);
    const minMs = Math.max(0, HEALTH_MIN_INTERVAL_SEC) * 1000;
    if (prev && minMs > 0 && (nowMs - prev.lastStoredAt < minMs)) {
      return { store: false, reason: 'health-throttled' };
    }
    healthCache.set(key, { lastStoredAt: nowMs });
  }

  if (type === 'model.usage') {
    const key = String(e?.agentId || e?.sessionKey || 'global');
    const tokens = Number(e?.data?.tokens?.total || e?.data?.usage?.totalTokens || 0);
    const prev = modelUsageCache.get(key);

    if (prev) {
      const tokenDelta = Math.abs(tokens - prev.lastTokens);
      const minMs = Math.max(0, MODEL_USAGE_MIN_INTERVAL_SEC) * 1000;
      const maxMs = Math.max(0, MODEL_USAGE_MAX_INTERVAL_SEC) * 1000;
      const elapsed = nowMs - prev.lastStoredAt;
      const tooSoon = minMs > 0 && elapsed < minMs;
      const overMax = maxMs > 0 && elapsed >= maxMs;
      const hasBigDelta = MODEL_USAGE_MIN_TOKEN_DELTA <= 0 || tokenDelta >= MODEL_USAGE_MIN_TOKEN_DELTA;

      if ((tooSoon || !hasBigDelta) && !overMax) {
        return { store: false, reason: 'model-usage-throttled' };
      }
    }

    modelUsageCache.set(key, { lastStoredAt: nowMs, lastTokens: tokens });
  }

  return { store: true };
}

function emitNormalized(e: any) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const enriched = enrichEventWithKnownModel(e);
  cacheKnownModelFromEvent(enriched, nowMs);

  const rawId = ulid();
  const normId = ulid();

  const meta = enriched._meta || {};
  const sourceKey = meta.sourceKey || `observeclaw:${enriched.type}:${enriched.sessionKey || ''}:${enriched.agentId || ''}:${enriched.timestamp || now}`;

  const rawObj = {
    id: rawId,
    source: meta.source || 'observeclaw',
    sourceEventType: meta.sourceEventType || enriched.type || 'unknown.event',
    sourceSeq: meta.sourceSeq ?? null,
    sourceKey,
    ingestedAt: now,
    payload: JSON.stringify(enriched.data || {})
  };

  const normObj = {
    id: normId,
    rawEventId: rawId,
    timestamp: enriched.timestamp || now,
    domain: enriched.domain || 'system',
    type: enriched.type || 'unknown.event',
    severity: enriched.severity || 'info',
    agentId: enriched.agentId || null,
    sessionKey: enriched.sessionKey || null,
    channel: enriched.channel || null,
    summary: enriched.summary || enriched.type || 'event',
    data: JSON.stringify(enriched.data || {})
  };

  const decision = shouldStoreNormalized({ ...enriched, type: normObj.type }, nowMs);

  try {
    if (decision.store) {
      const tx = db.transaction(() => {
        insertRawStmt.run(rawObj);
        insertNormStmt.run(normObj);
      });
      tx();
      policyStore(normObj.type);
      eventBus.broadcast(normObj);
    } else {
      policyDrop(decision.reason || 'dropped', normObj.type);
      // Keep pulse state accurate even when storage policy drops an event
      // (e.g., inferred tool.complete/session.output exclusions).
      if (decision.reason === 'inferred-excluded') {
        eventBus.ingestPulse({
          id: normObj.id,
          timestamp: normObj.timestamp,
          type: normObj.type,
          agentId: normObj.agentId,
          sessionKey: normObj.sessionKey,
          data: normObj.data
        });
      }
    }
  } catch {
    // Ignore duplicates and transient insert errors
  }
}

async function callGatewayCli(method: string, params: any = {}) {
  const args = ['gateway', 'call', method, '--json', '--timeout', '10000', '--params', JSON.stringify(params || {})];
  if (GATEWAY_TOKEN) args.push('--token', GATEWAY_TOKEN);
  if (GATEWAY_PASSWORD) args.push('--password', GATEWAY_PASSWORD);
  const { stdout } = await execFileAsync('openclaw', args, { maxBuffer: 8 * 1024 * 1024 });
  const text = String(stdout || '').trim();
  return text ? JSON.parse(text) : null;
}

function resolveOpenClawDistDir(): string | null {
  // Prefer explicit env override
  if (process.env.OPENCLAW_DIST_DIR && fs.existsSync(process.env.OPENCLAW_DIST_DIR)) {
    return process.env.OPENCLAW_DIST_DIR;
  }
  // Try to resolve via the openclaw binary symlink
  try {
    const bin = execSync('which openclaw', { encoding: 'utf8', timeout: 3000 }).trim();
    if (bin) {
      // Follow symlinks to find the real path, then navigate to dist/
      const realBin = fs.realpathSync(bin);
      // Typical layout: .../node_modules/openclaw/bin/openclaw.js -> dist is at ../dist
      const candidate = path.join(path.dirname(realBin), '..', 'dist');
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
      // Also check: .../node_modules/openclaw/dist (bin might be at package root)
      const candidate2 = path.join(path.dirname(realBin), 'dist');
      if (fs.existsSync(candidate2)) return fs.realpathSync(candidate2);
    }
  } catch { /* fall through */ }
  // Try common global install locations
  const candidates = [
    '/opt/homebrew/lib/node_modules/openclaw/dist',        // macOS Homebrew ARM
    '/usr/local/lib/node_modules/openclaw/dist',           // macOS Homebrew Intel / global npm
    '/usr/lib/node_modules/openclaw/dist',                 // Linux global npm
    path.join(os.homedir(), '.npm-global/lib/node_modules/openclaw/dist'), // npm custom prefix
  ];
  // Also try npm root -g
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 3000 }).trim();
    if (npmRoot) candidates.unshift(path.join(npmRoot, 'openclaw', 'dist'));
  } catch { /* ignore */ }
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

let _resolvedDistDir: string | null | undefined;
function getOpenClawDistDir(): string | null {
  if (_resolvedDistDir !== undefined) return _resolvedDistDir;
  _resolvedDistDir = resolveOpenClawDistDir();
  return _resolvedDistDir;
}

async function loadDirectGatewayCall(): Promise<boolean> {
  if (directGatewayCall) return true;
  try {
    const distDir = getOpenClawDistDir();
    if (!distDir) return false;
    const files = fs.readdirSync(distDir)
      .filter((name) => /^auth-profiles-.*\.js$/.test(name))
      .sort((a, b) => a.localeCompare(b));
    for (const file of files.reverse()) {
      try {
        const mod = await import(pathToFileURL(path.join(distDir, file)).href);
        const fn = (mod as any).KO;
        if (typeof fn === 'function') {
          directGatewayCall = fn;
          return true;
        }
      } catch {
        // ignore and continue
      }
    }
  } catch {
    // ignore and keep CLI fallback available
  }
  return false;
}

async function callGatewayDirect(method: string, params: any = {}) {
  if (!(await loadDirectGatewayCall()) || !directGatewayCall) {
    throw new Error('Direct gateway call unavailable');
  }
  const token = GATEWAY_TOKEN || undefined;
  const password = GATEWAY_PASSWORD || undefined;
  const opts: any = {
    method,
    params,
    timeoutMs: 10000
  };
  if (token) opts.token = token;
  if (password) opts.password = password;
  if ((token || password) && GATEWAY_URL) opts.url = GATEWAY_URL;
  return await directGatewayCall(opts);
}

class DirectGatewayClient {
  private opts: any;

  constructor(opts: any) {
    this.opts = opts || {};
  }

  async start() {
    const hello = await callGatewayDirect('health', {});
    this.opts?.onHelloOk?.({ protocol: 3, transport: 'gateway-rpc-direct', healthOk: !!hello?.ok });
  }

  async request(method: string, params: any = {}) {
    return await callGatewayDirect(method, params);
  }
}

class CliGatewayClient {
  private opts: any;

  constructor(opts: any) {
    this.opts = opts || {};
  }

  async start() {
    const hello = await callGatewayCli('health', {});
    this.opts?.onHelloOk?.({ protocol: 3, transport: 'gateway-cli', healthOk: !!hello?.ok });
  }

  async request(method: string, params: any = {}) {
    return await callGatewayCli(method, params);
  }
}

function findOpenClawClientModule(): string | null {
  const distDir = getOpenClawDistDir();
  if (!distDir) return null;

  const entries = fs.readdirSync(distDir)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b));

  const preferredNamePatterns = [/^client-.*\.js$/, /^call-.*\.js$/];

  const candidates = [
    ...entries.filter((name) => preferredNamePatterns.some((pattern) => pattern.test(name))),
    ...entries.filter((name) => !preferredNamePatterns.some((pattern) => pattern.test(name))),
  ];

  for (const entry of candidates) {
    const modulePath = path.join(distDir, entry);
    try {
      const source = fs.readFileSync(modulePath, 'utf8');
      if (!source.includes('GatewayClient')) continue;
      const looksLikeGatewayClient =
        (source.includes('onHelloOk') && source.includes('onEvent')) ||
        source.includes('observe.subscribe') ||
        source.includes('queueConnect');
      if (!looksLikeGatewayClient) continue;
      return modulePath;
    } catch {
      // Ignore unreadable candidates and continue scanning.
    }
  }

  return null;
}

function startFallbackIngest(reason: string) {
  ingestRuntimeStatus = { ...ingestRuntimeStatus, mode: 'fallback', reason, updatedAt: new Date().toISOString() };
  console.warn(`⚠️ ObserveClaw fallback ingest enabled (${reason})`);
  startSessionEnrichment('fallback');
}

function startSessionEnrichment(mode: 'fallback' | 'gateway-hybrid') {
  if (sessionPollTimer) return;
  if (mode === 'gateway-hybrid') {
    console.log('🧩 Session enrichment enabled (tool/message/access inference)');
  }
  backfillRecent();
  sessionPollTimer = setInterval(pollFiles, 1500);
}

function backfillRecent() {
  const files = getRecentSessionFiles();
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split('\n').filter(Boolean);
      const recent = lines.slice(-300);
      for (const line of recent) processLine(file, line, { inferThinking: false });
      fileOffsets.set(file, Buffer.byteLength(text, 'utf8'));
    } catch {
      // ignore
    }
  }
}

function pollFiles() {
  const files = getRecentSessionFiles();
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      const prev = fileOffsets.get(file) ?? 0;
      if (stat.size <= prev) continue;
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(stat.size - prev);
      fs.readSync(fd, buf, 0, stat.size - prev, prev);
      fs.closeSync(fd);

      const chunk = buf.toString('utf8');
      const lines = chunk.split('\n').filter(Boolean);
      for (const line of lines) processLine(file, line, { inferThinking: true });

      fileOffsets.set(file, stat.size);
    } catch {
      // ignore
    }
  }
}

function listAgentIds(): string[] {
  try {
    if (!fs.existsSync(ROOT)) return [];
    return fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => !!name && !name.startsWith('.'));
  } catch {
    return [];
  }
}

function getRecentSessionFiles(): string[] {
  const out: string[] = [];
  for (const agent of listAgentIds()) {
    const dir = path.join(ROOT, agent, 'sessions');
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .filter((f) => !f.includes('.deleted.') && !f.includes('.reset.') && !f.endsWith('.lock'))
      .map((f) => ({ f, p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, 6)
      .map((x) => x.p);
    out.push(...files);
  }
  return out;
}

function isPublicHost(host: string): boolean {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return false;
  if (h.startsWith('127.')) return false;

  const ipType = net.isIP(h);
  if (ipType === 4) {
    if (h.startsWith('10.')) return false;
    if (h.startsWith('192.168.')) return false;
    if (h.startsWith('169.254.')) return false;
    const m = h.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
    return true;
  }

  if (ipType === 6) {
    if (h.startsWith('fe80:')) return false;
    if (h.startsWith('fc') || h.startsWith('fd')) return false;
    return true;
  }

  return true;
}

type InferredNetworkTarget = {
  url: string;
  host: string;
  port: number | null;
  protocol: string;
  commandClass?: string;
  inferred?: boolean;
  attributionConfidence?: 'low' | 'medium' | 'high';
  remoteIp?: string | null;
  resolvedIp?: string | null;
};

function inferNetworkTargets(obj: any): InferredNetworkTarget[] {
  const found: InferredNetworkTarget[] = [];
  const seen = new Set<string>();

  const walk = (v: any) => {
    if (v == null) return;
    if (typeof v === 'string') {
      const m = v.match(/https?:\/\/[^\s"'<>]+/g);
      if (m) {
        for (const u of m) {
          try {
            const p = new URL(u);
            const key = `${p.protocol}//${p.host}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const host = p.hostname;
            const remoteIp = net.isIP(host) ? host : null;
            found.push({
              url: u,
              host,
              port: p.port ? Number(p.port) : (p.protocol === 'https:' ? 443 : 80),
              protocol: p.protocol.replace(':', ''),
              commandClass: 'tool-argument',
              inferred: true,
              attributionConfidence: remoteIp ? 'high' : 'medium',
              remoteIp,
              resolvedIp: remoteIp
            });
          } catch {}
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === 'object') {
      for (const x of Object.values(v)) walk(x);
    }
  };

  walk(obj);
  return found;
}

function inferExecCommandTargets(args: any): InferredNetworkTarget[] {
  const command = String(args?.command || args?.cmd || '').trim();
  if (!command) return [];
  const lower = command.toLowerCase();

  let commandClass = '';
  if (/(^|\s)curl(\s|$)/.test(lower)) commandClass = 'curl';
  else if (/(^|\s)wget(\s|$)/.test(lower)) commandClass = 'wget';
  else if (/(^|\s)http(\s|$)/.test(lower)) commandClass = 'httpie';
  else if (/(^|\s)(python|python3)(\s|$)/.test(lower) && /(requests|urllib|httpx)/.test(lower)) commandClass = 'python-http';
  else if (/(^|\s)node(\s|$)/.test(lower) && /(fetch\s*\(|https?\.request\s*\()/.test(lower)) commandClass = 'node-http';

  if (!commandClass) return [];

  const fromCmd = inferNetworkTargets(command);
  return fromCmd.map((t) => ({
    ...t,
    commandClass,
    inferred: true,
    attributionConfidence: t.remoteIp ? 'high' : 'medium'
  }));
}

function inferAgentIdFromSessionPath(file: string): string {
  const normalized = file.split(path.sep).join('/');
  const m = normalized.match(/\/agents\/([^/]+)\/sessions\//);
  if (m?.[1]) return m[1];

  // fallback for unexpected paths
  const parts = normalized.split('/').filter(Boolean);
  const idx = parts.lastIndexOf('sessions');
  if (idx > 0) return parts[idx - 1] || 'main';
  return 'main';
}

function processLine(file: string, line: string, opts?: { inferThinking?: boolean }) {
  let row: any;
  try {
    row = JSON.parse(line);
  } catch {
    return;
  }

  const agentId = inferAgentIdFromSessionPath(file);
  const ts = row.timestamp || new Date().toISOString();
  const sessionKey = path.basename(file, '.jsonl');
  const messageId = row.id || row.message?.id || ulid();

  const inferThinking = opts?.inferThinking !== false;

  // Infer THINKING/session output from assistant streaming rows in session jsonl.
  if (inferThinking && row?.type === 'chat' && String(row?.state || '').toLowerCase() === 'delta' && String(row?.message?.role || '').toLowerCase() === 'assistant') {
    emitNormalized({
      timestamp: ts,
      domain: 'session',
      type: 'session.output',
      severity: 'info',
      agentId,
      sessionKey,
      summary: 'Session output (inferred)',
      data: {
        inferred: true,
        sourceEventType: 'chat',
        state: 'THINKING',
        model: row?.message?.model || null
      },
      _meta: {
        source: 'session-jsonl',
        sourceEventType: 'session.output',
        sourceKey: `jsonl:session.output:chat:${sessionKey}:${messageId}`
      }
    });
    return;
  }

  if (inferThinking && row?.type === 'agent' && String(row?.stream || '').toLowerCase() === 'assistant' && typeof row?.data?.text === 'string' && row.data.text.length > 0) {
    emitNormalized({
      timestamp: ts,
      domain: 'session',
      type: 'session.output',
      severity: 'info',
      agentId,
      sessionKey,
      summary: 'Session output (inferred)',
      data: {
        inferred: true,
        sourceEventType: 'agent',
        state: 'THINKING',
        model: row?.model || null
      },
      _meta: {
        source: 'session-jsonl',
        sourceEventType: 'session.output',
        sourceKey: `jsonl:session.output:agent:${sessionKey}:${messageId}`
      }
    });
    return;
  }

  if (row.type !== 'message' || !row.message) return;

  const contentParts = Array.isArray(row.message?.content) ? row.message.content : [];
  const textContent = contentParts.filter((part: any) => part?.type === 'text').map((part: any) => String(part?.text || '')).join('\n');
  if (textContent.includes('OBSERVECLAW_RETENTION_RUN')) {
    emitNormalized({
      timestamp: ts,
      domain: 'system',
      type: 'cron',
      severity: 'info',
      agentId,
      sessionKey,
      summary: 'OBSERVECLAW_RETENTION_RUN',
      data: { summary: 'OBSERVECLAW_RETENTION_RUN', event: 'cron', eventName: 'OBSERVECLAW_RETENTION_RUN' },
      _meta: {
        source: 'session-jsonl',
        sourceEventType: 'cron',
        sourceKey: `jsonl:cron:observeclaw-retention:${sessionKey}:${messageId}`
      }
    });
  }

  if (row.message.usage) {
    emitNormalized({
      timestamp: ts,
      domain: 'agent',
      type: 'model.usage',
      severity: 'info',
      agentId,
      sessionKey,
      summary: `Tokens used: ${row.message.usage.totalTokens ?? 'unknown'}`,
      data: {
        model: row.message.model,
        tokens: { total: row.message.usage.totalTokens, input: row.message.usage.input, output: row.message.usage.output },
        cost: row.message.usage.cost
      },
      _meta: {
        source: 'session-jsonl',
        sourceEventType: 'model.usage',
        sourceKey: `jsonl:model.usage:${sessionKey}:${messageId}`
      }
    });

    emitNormalized({
      timestamp: ts,
      domain: 'access',
      type: 'access.credential.use',
      severity: 'info',
      agentId,
      sessionKey,
      summary: `Credential use inferred for model provider`,
      data: { service: row.message?.provider || 'model-provider', inferred: true },
      _meta: {
        source: 'session-jsonl',
        sourceEventType: 'access.credential.use',
        sourceKey: `jsonl:access.credential.use:${sessionKey}:${messageId}`
      }
    });
  }

  const role = row.message?.role;
  if (role === 'user') {
    emitNormalized({
      timestamp: ts,
      domain: 'channel',
      type: 'message.queued',
      severity: 'info',
      agentId,
      sessionKey,
      channel: 'telegram',
      summary: 'Inbound message queued',
      data: { role },
      _meta: {
        source: 'session-jsonl',
        sourceEventType: 'message.queued',
        sourceKey: `jsonl:message.queued:${sessionKey}:${messageId}`
      }
    });

    emitNormalized({
      timestamp: ts,
      domain: 'channel',
      type: 'webhook.received',
      severity: 'info',
      agentId,
      sessionKey,
      channel: 'telegram',
      summary: 'Webhook received on telegram',
      data: { inferred: true },
      _meta: {
        source: 'session-jsonl',
        sourceEventType: 'webhook.received',
        sourceKey: `jsonl:webhook.received:${sessionKey}:${messageId}`
      }
    });
  }

  if (role === 'assistant') {
    const content = Array.isArray(row.message?.content) ? row.message.content : [];
    const hasAssistantText = content.some((part: any) => part?.type === 'text' && typeof part?.text === 'string' && part.text.trim().length > 0);

    // Emit inferred THINKING before message.processed so processed can naturally settle counters.
    if (inferThinking && hasAssistantText) {
      emitNormalized({
        timestamp: ts,
        domain: 'session',
        type: 'session.output',
        severity: 'info',
        agentId,
        sessionKey,
        summary: 'Session output (inferred)',
        data: {
          inferred: true,
          sourceEventType: 'message.assistant.text',
          state: 'THINKING',
          model: row.message?.model || null
        },
        _meta: {
          source: 'session-jsonl',
          sourceEventType: 'session.output',
          sourceKey: `jsonl:session.output:assistant-text:${sessionKey}:${messageId}`
        }
      });
    }

    emitNormalized({
      timestamp: ts,
      domain: 'channel',
      type: 'message.processed',
      severity: 'info',
      agentId,
      sessionKey,
      channel: 'telegram',
      summary: 'Message processed',
      data: { role },
      _meta: {
        source: 'session-jsonl',
        sourceEventType: 'message.processed',
        sourceKey: `jsonl:message.processed:${sessionKey}:${messageId}`
      }
    });

    for (const part of content) {
      if (part?.type === 'toolCall' && part?.name) {
        emitNormalized({
          timestamp: ts,
          domain: 'tool',
          type: 'tool.invoke',
          severity: 'info',
          agentId,
          sessionKey,
          summary: `Invoking tool: ${part.name}`,
          data: { tool: part.name, arguments: part.arguments || {} },
          _meta: {
            source: 'session-jsonl',
            sourceEventType: 'tool.invoke',
            sourceKey: `jsonl:tool.invoke:${sessionKey}:${messageId}:${part.name}`
          }
        });

        const baseTargets = inferNetworkTargets(part?.arguments || {});
        const execTargets = String(part.name) === 'exec' ? inferExecCommandTargets(part?.arguments || {}) : [];
        const targets = [...baseTargets, ...execTargets];
        for (const t of targets) {
          emitNormalized({
            timestamp: ts,
            domain: 'network',
            type: 'network.request',
            severity: 'info',
            agentId,
            sessionKey,
            summary: `${part.name} -> ${t.host}:${t.port ?? ''}`,
            data: {
              tool: part.name,
              url: t.url,
              host: t.host,
              remoteIp: t.remoteIp || null,
              resolvedIp: t.resolvedIp || null,
              port: t.port,
              protocol: t.protocol,
              commandClass: t.commandClass || (String(part.name) === 'exec' ? 'exec' : 'tool'),
              source: String(part.name) === 'exec' ? 'exec-command' : 'semantic-tool',
              sourceType: 'semantic',
              attributionConfidence: t.attributionConfidence || 'medium',
              isPublic: isPublicHost(t.host),
              inferred: t.inferred !== false
            },
            _meta: {
              source: 'session-jsonl',
              sourceEventType: 'network.request',
              sourceKey: `jsonl:network.request:${sessionKey}:${messageId}:${part.name}:${t.host}:${t.port ?? ''}`
            }
          });

          emitNormalized({
            timestamp: ts,
            domain: 'network',
            type: 'network.connect',
            severity: 'info',
            agentId,
            sessionKey,
            summary: `Connection ${t.protocol} ${t.host}:${t.port ?? ''}`,
            data: {
              host: t.host,
              remoteHost: t.host,
              remoteIp: t.remoteIp || null,
              resolvedIp: t.resolvedIp || null,
              port: t.port,
              protocol: t.protocol,
              source: String(part.name) === 'exec' ? 'exec-command' : String(part.name),
              sourceType: 'semantic',
              commandClass: t.commandClass || (String(part.name) === 'exec' ? 'exec' : 'tool'),
              attributionConfidence: t.attributionConfidence || 'medium',
              isPublic: isPublicHost(t.host),
              inferred: t.inferred !== false
            },
            _meta: {
              source: 'session-jsonl',
              sourceEventType: 'network.connect',
              sourceKey: `jsonl:network.connect:${sessionKey}:${messageId}:${t.host}:${t.port ?? ''}`
            }
          });
        }

        emitNormalized({
          timestamp: ts,
          domain: 'tool',
          type: 'tool.complete',
          severity: 'info',
          agentId,
          sessionKey,
          summary: `Tool complete: ${part.name}`,
          data: { tool: part.name, inferred: true },
          _meta: {
            source: 'session-jsonl',
            sourceEventType: 'tool.complete',
            sourceKey: `jsonl:tool.complete:${sessionKey}:${messageId}:${part.name}`
          }
        });
      }
    }
  }
}
