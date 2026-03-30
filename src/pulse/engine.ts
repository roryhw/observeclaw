import {
  type AgentPulseInternal,
  type AgentPulseSnapshot,
  type PulseConfig,
  type PulseEvent,
  type PulseReason,
  type PulseSnapshot,
  type PulseState,
  type PulseTransition
} from './types.js';

const DEFAULT_CONFIG: PulseConfig = {
  staleWarnMs: 10_000,
  disconnectTimeoutMs: 30_000,
  collaborationHoldMs: 2_000,
  minActiveDwellMs: 1_500
};

const STATE_PRIORITY: Record<PulseState, number> = {
  DISCONNECTED: 6,
  DEGRADED: 5,
  BUILDING: 4,
  THINKING: 3,
  COLLABORATING: 2,
  IDLE: 1
};

function tsMs(input?: string | number | Date): number {
  if (!input) return Date.now();
  if (typeof input === 'number') return Number.isFinite(input) ? input : Date.now();
  if (input instanceof Date) return input.getTime();
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function inferAgentId(evt: PulseEvent): string {
  if (evt.agentId) return String(evt.agentId);
  const sk = String(evt.sessionKey || '');
  const m = sk.match(/^agent:([^:]+):/);
  return m?.[1] || 'main';
}

function inferState(agent: AgentPulseInternal, nowMs: number, cfg: PulseConfig): { state: PulseState; reason: PulseReason } {
  const staleMs = nowMs - Math.max(agent.lastReliableAtMs, agent.lastEventAtMs);
  const hasInFlightWork = agent.activeToolCalls > 0 || agent.toolQueueDepth > 0 || agent.activeModelRequests > 0;

  if (!agent.runtimeConnected) {
    return { state: 'DISCONNECTED', reason: 'runtime_unreachable' };
  }

  // Important: do not degrade/disconnect a naturally idle system just because it's quiet.
  // Staleness is only actionable when we expect live telemetry for in-flight work.
  if (hasInFlightWork && staleMs > cfg.disconnectTimeoutMs) {
    return { state: 'DISCONNECTED', reason: 'runtime_unreachable' };
  }

  if (hasInFlightWork && staleMs > cfg.staleWarnMs) {
    return { state: 'DEGRADED', reason: 'telemetry_stale' };
  }

  if (agent.activeToolCalls > 0 || agent.toolQueueDepth > 0) {
    return { state: 'BUILDING', reason: 'tool_activity' };
  }

  if (agent.activeModelRequests > 0) {
    return { state: 'THINKING', reason: 'model_active' };
  }

  if (agent.lastCollabAtMs > 0 && nowMs - agent.lastCollabAtMs <= cfg.collaborationHoldMs) {
    return { state: 'COLLABORATING', reason: 'message_flow' };
  }

  return { state: 'IDLE', reason: 'no_active_work' };
}

function cloneSystemDefault(nowMs: number): AgentPulseInternal {
  return {
    id: 'system',
    runtimeConnected: true,
    activeToolCalls: 0,
    toolQueueDepth: 0,
    activeModelRequests: 0,
    model: null,
    provider: null,
    modelUpdatedAtMs: null,
    lastEventAtMs: nowMs,
    lastReliableAtMs: nowMs,
    lastCollabAtMs: 0,
    lastToolEventAtMs: nowMs,
    lastModelEventAtMs: nowMs,
    state: 'IDLE',
    stateSinceMs: nowMs,
    reason: 'no_active_work'
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function setAgentModel(agent: AgentPulseInternal, data: unknown, nowMs: number): void {
  const payload = asRecord(data);
  if (!payload) return;

  const rawModel = payload.model;
  if (typeof rawModel === 'string' && rawModel.trim()) {
    agent.model = rawModel.trim();
    agent.modelUpdatedAtMs = nowMs;
  }

  const rawProvider = payload.provider;
  if (typeof rawProvider === 'string' && rawProvider.trim()) {
    agent.provider = rawProvider.trim();
    if (agent.modelUpdatedAtMs == null) agent.modelUpdatedAtMs = nowMs;
  }
}

export class PulseEngine {
  private readonly cfg: PulseConfig;
  private readonly agents = new Map<string, AgentPulseInternal>();
  private readonly listeners = new Set<(transition: PulseTransition) => void>();
  private system: AgentPulseInternal = cloneSystemDefault(Date.now());

  constructor(config?: Partial<PulseConfig>) {
    this.cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  subscribe(listener: (transition: PulseTransition) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ingestEvent(evt: PulseEvent): void {
    const nowMs = tsMs(evt.timestamp);
    const agentId = inferAgentId(evt);
    const agent = this.getOrCreateAgent(agentId, nowMs);

    agent.lastEventAtMs = nowMs;
    agent.lastReliableAtMs = nowMs;

    const type = String(evt.type || '').toLowerCase();
    setAgentModel(agent, evt.data, nowMs);

    if (type === 'tool.invoke') {
      agent.lastToolEventAtMs = nowMs;
      agent.activeToolCalls += 1;
      this.bumpQueueDepth(agent);
    } else if (type === 'tool.complete') {
      agent.lastToolEventAtMs = nowMs;
      agent.activeToolCalls = Math.max(0, agent.activeToolCalls - 1);
      this.bumpQueueDepth(agent);
    } else if (type === 'message.queued' || type === 'webhook.received') {
      agent.lastCollabAtMs = nowMs;
    } else if (type === 'session.output') {
      agent.lastModelEventAtMs = nowMs;
      agent.activeModelRequests = Math.max(1, agent.activeModelRequests);
    } else if (type === 'message.processed' || type === 'channel.send.complete') {
      agent.lastCollabAtMs = nowMs;
      agent.lastModelEventAtMs = nowMs;
      agent.activeModelRequests = Math.max(0, agent.activeModelRequests - 1);
    } else if (type === 'session.state') {
      const state = this.readSessionState(evt);
      if (state === 'BUILDING') {
        agent.lastToolEventAtMs = nowMs;
        agent.activeToolCalls = Math.max(1, agent.activeToolCalls);
      } else if (state === 'THINKING') {
        agent.lastModelEventAtMs = nowMs;
        agent.activeModelRequests = Math.max(1, agent.activeModelRequests);
      } else if (state === 'COLLABORATING') {
        agent.lastCollabAtMs = nowMs;
      } else if (state === 'IDLE') {
        agent.lastToolEventAtMs = nowMs;
        agent.lastModelEventAtMs = nowMs;
        agent.activeToolCalls = 0;
        agent.toolQueueDepth = 0;
        agent.activeModelRequests = 0;
      }
    }

    this.evaluate(nowMs);
  }

  setRuntimeConnected(agentId: string, connected: boolean, at?: string | number | Date): void {
    const nowMs = tsMs(at);
    const agent = this.getOrCreateAgent(agentId, nowMs);
    agent.runtimeConnected = connected;
    if (connected) agent.lastReliableAtMs = nowMs;
    this.evaluate(nowMs);
  }

  setRuntimeCounters(
    agentId: string,
    counters: { activeToolCalls?: number; toolQueueDepth?: number; activeModelRequests?: number },
    at?: string | number | Date
  ): void {
    const nowMs = tsMs(at);
    const agent = this.getOrCreateAgent(agentId, nowMs);

    if (typeof counters.activeToolCalls === 'number') agent.activeToolCalls = Math.max(0, Math.floor(counters.activeToolCalls));
    if (typeof counters.toolQueueDepth === 'number') agent.toolQueueDepth = Math.max(0, Math.floor(counters.toolQueueDepth));
    if (typeof counters.activeModelRequests === 'number') agent.activeModelRequests = Math.max(0, Math.floor(counters.activeModelRequests));

    agent.lastReliableAtMs = nowMs;
    this.evaluate(nowMs);
  }

  tick(nowInput?: string | number | Date): void {
    this.evaluate(tsMs(nowInput));
  }

  getSnapshot(nowInput?: string | number | Date): PulseSnapshot {
    const nowMs = tsMs(nowInput);
    this.evaluate(nowMs);

    const agents = [...this.agents.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((a) => this.toAgentSnapshot(a, nowMs));

    return {
      version: 1,
      computedAt: new Date(nowMs).toISOString(),
      system: {
        state: this.system.state,
        stateSince: new Date(this.system.stateSinceMs).toISOString(),
        reason: this.system.reason,
        freshnessMs: Math.max(0, nowMs - Math.max(this.system.lastReliableAtMs, this.system.lastEventAtMs)),
        stale: this.system.state === 'DEGRADED' || this.system.state === 'DISCONNECTED'
      },
      agents
    };
  }

  private readSessionState(evt: PulseEvent): PulseState | null {
    const payload = evt.data;
    if (!payload || typeof payload !== 'object') return null;
    const raw = String((payload as Record<string, unknown>).state || '').toUpperCase();
    if (raw === 'IDLE' || raw === 'COLLABORATING' || raw === 'THINKING' || raw === 'BUILDING' || raw === 'DEGRADED' || raw === 'DISCONNECTED') {
      return raw;
    }
    return null;
  }

  private bumpQueueDepth(agent: AgentPulseInternal): void {
    agent.toolQueueDepth = Math.max(agent.toolQueueDepth, agent.activeToolCalls);
    if (agent.activeToolCalls === 0) agent.toolQueueDepth = 0;
  }

  private getOrCreateAgent(agentId: string, nowMs: number): AgentPulseInternal {
    const existing = this.agents.get(agentId);
    if (existing) return existing;

    const created: AgentPulseInternal = {
      id: agentId,
      runtimeConnected: true,
      activeToolCalls: 0,
      toolQueueDepth: 0,
      activeModelRequests: 0,
      model: null,
      provider: null,
      modelUpdatedAtMs: null,
      lastEventAtMs: nowMs,
      lastReliableAtMs: nowMs,
      lastCollabAtMs: 0,
      lastToolEventAtMs: nowMs,
      lastModelEventAtMs: nowMs,
      state: 'IDLE',
      stateSinceMs: nowMs,
      reason: 'no_active_work'
    };

    this.agents.set(agentId, created);
    return created;
  }

  private evaluate(nowMs: number): void {
    for (const agent of this.agents.values()) {
      this.healStaleInFlightCounters(agent, nowMs);
      const next = inferState(agent, nowMs, this.cfg);

      let resolvedState = next.state;
      let resolvedReason = next.reason;

      // Keep non-idle states visible briefly so fast invoke/complete cycles are perceptible.
      if (
        next.state === 'IDLE' &&
        agent.state !== 'IDLE' &&
        nowMs - agent.stateSinceMs < this.cfg.minActiveDwellMs
      ) {
        resolvedState = agent.state;
        resolvedReason = agent.reason;
      }

      if (resolvedState !== agent.state || resolvedReason !== agent.reason) {
        agent.state = resolvedState;
        agent.reason = resolvedReason;
        agent.stateSinceMs = nowMs;
        this.emit({
          scope: 'agent',
          agentId: agent.id,
          state: agent.state,
          stateSince: new Date(agent.stateSinceMs).toISOString(),
          reason: agent.reason
        });
      }
    }

    this.updateSystem(nowMs);
  }

  private healStaleInFlightCounters(agent: AgentPulseInternal, nowMs: number): void {
    // Defensive healing: event streams can miss tool.complete / model-finish markers.
    // If an in-flight counter has no corroborating activity for longer than disconnect timeout,
    // treat it as drift and clear it to avoid sticky DEGRADED/DISCONNECTED states.
    if (agent.activeToolCalls > 0 && nowMs - agent.lastToolEventAtMs > this.cfg.disconnectTimeoutMs) {
      agent.activeToolCalls = 0;
      agent.toolQueueDepth = 0;
    }

    if (agent.activeModelRequests > 0 && nowMs - agent.lastModelEventAtMs > this.cfg.disconnectTimeoutMs) {
      agent.activeModelRequests = 0;
    }
  }

  private updateSystem(nowMs: number): void {
    const all = [...this.agents.values()];
    if (all.length === 0) {
      this.system = cloneSystemDefault(nowMs);
      return;
    }

    const best = all
      .slice()
      .sort((a, b) => {
        const pa = STATE_PRIORITY[a.state];
        const pb = STATE_PRIORITY[b.state];
        if (pa !== pb) return pb - pa;
        return a.stateSinceMs - b.stateSinceMs;
      })[0];

    if (!best) return;

    const candidates = all.filter((a) => a.state === best.state);
    const minSince = Math.min(...candidates.map((a) => a.stateSinceMs));
    const maxReliable = Math.max(...all.map((a) => a.lastReliableAtMs));
    const maxEvent = Math.max(...all.map((a) => a.lastEventAtMs));

    const changed = this.system.state !== best.state || this.system.reason !== best.reason;

    this.system.state = best.state;
    this.system.reason = best.reason;
    this.system.stateSinceMs = Number.isFinite(minSince) ? minSince : nowMs;
    this.system.lastReliableAtMs = Number.isFinite(maxReliable) ? maxReliable : nowMs;
    this.system.lastEventAtMs = Number.isFinite(maxEvent) ? maxEvent : nowMs;

    if (changed) {
      this.emit({
        scope: 'system',
        state: this.system.state,
        stateSince: new Date(this.system.stateSinceMs).toISOString(),
        reason: this.system.reason
      });
    }
  }

  private toAgentSnapshot(agent: AgentPulseInternal, nowMs: number): AgentPulseSnapshot {
    const freshnessMs = Math.max(0, nowMs - Math.max(agent.lastReliableAtMs, agent.lastEventAtMs));
    return {
      id: agent.id,
      state: agent.state,
      stateSince: new Date(agent.stateSinceMs).toISOString(),
      reason: agent.reason,
      activeToolCalls: agent.activeToolCalls,
      toolQueueDepth: agent.toolQueueDepth,
      activeModelRequests: agent.activeModelRequests,
      model: agent.model,
      provider: agent.provider,
      modelUpdatedAt: agent.modelUpdatedAtMs ? new Date(agent.modelUpdatedAtMs).toISOString() : null,
      lastEventAt: agent.lastEventAtMs ? new Date(agent.lastEventAtMs).toISOString() : null,
      freshnessMs,
      stale: agent.state === 'DEGRADED' || agent.state === 'DISCONNECTED'
    };
  }

  private emit(transition: PulseTransition): void {
    for (const listener of this.listeners) listener(transition);
  }
}
