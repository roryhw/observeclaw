import {} from './types.js';
const DEFAULT_CONFIG = {
    staleWarnMs: 10_000,
    disconnectTimeoutMs: 30_000,
    collaborationHoldMs: 2_000,
    minActiveDwellMs: 1_500
};
const STATE_PRIORITY = {
    DISCONNECTED: 6,
    DEGRADED: 5,
    BUILDING: 4,
    THINKING: 3,
    COLLABORATING: 2,
    IDLE: 1
};
function tsMs(input) {
    if (!input)
        return Date.now();
    if (typeof input === 'number')
        return Number.isFinite(input) ? input : Date.now();
    if (input instanceof Date)
        return input.getTime();
    const parsed = Date.parse(input);
    return Number.isFinite(parsed) ? parsed : Date.now();
}
function inferAgentId(evt) {
    if (evt.agentId)
        return String(evt.agentId);
    const sk = String(evt.sessionKey || '');
    const m = sk.match(/^agent:([^:]+):/);
    return m?.[1] || 'main';
}
function inferState(agent, nowMs, cfg) {
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
function cloneSystemDefault(nowMs) {
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
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    return value;
}
function setAgentModel(agent, data, nowMs) {
    const payload = asRecord(data);
    if (!payload)
        return;
    const rawModel = payload.model;
    if (typeof rawModel === 'string' && rawModel.trim()) {
        agent.model = rawModel.trim();
        agent.modelUpdatedAtMs = nowMs;
    }
    const rawProvider = payload.provider;
    if (typeof rawProvider === 'string' && rawProvider.trim()) {
        agent.provider = rawProvider.trim();
        if (agent.modelUpdatedAtMs == null)
            agent.modelUpdatedAtMs = nowMs;
    }
}
export class PulseEngine {
    cfg;
    agents = new Map();
    listeners = new Set();
    system = cloneSystemDefault(Date.now());
    constructor(config) {
        this.cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    ingestEvent(evt) {
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
        }
        else if (type === 'tool.complete') {
            agent.lastToolEventAtMs = nowMs;
            agent.activeToolCalls = Math.max(0, agent.activeToolCalls - 1);
            this.bumpQueueDepth(agent);
        }
        else if (type === 'message.queued' || type === 'webhook.received') {
            agent.lastCollabAtMs = nowMs;
        }
        else if (type === 'session.output') {
            agent.lastModelEventAtMs = nowMs;
            agent.activeModelRequests = Math.max(1, agent.activeModelRequests);
        }
        else if (type === 'message.processed' || type === 'channel.send.complete') {
            agent.lastCollabAtMs = nowMs;
            agent.lastModelEventAtMs = nowMs;
            agent.activeModelRequests = Math.max(0, agent.activeModelRequests - 1);
        }
        else if (type === 'session.state') {
            const state = this.readSessionState(evt);
            if (state === 'BUILDING') {
                agent.lastToolEventAtMs = nowMs;
                agent.activeToolCalls = Math.max(1, agent.activeToolCalls);
            }
            else if (state === 'THINKING') {
                agent.lastModelEventAtMs = nowMs;
                agent.activeModelRequests = Math.max(1, agent.activeModelRequests);
            }
            else if (state === 'COLLABORATING') {
                agent.lastCollabAtMs = nowMs;
            }
            else if (state === 'IDLE') {
                agent.lastToolEventAtMs = nowMs;
                agent.lastModelEventAtMs = nowMs;
                agent.activeToolCalls = 0;
                agent.toolQueueDepth = 0;
                agent.activeModelRequests = 0;
            }
        }
        this.evaluate(nowMs);
    }
    setRuntimeConnected(agentId, connected, at) {
        const nowMs = tsMs(at);
        const agent = this.getOrCreateAgent(agentId, nowMs);
        agent.runtimeConnected = connected;
        if (connected)
            agent.lastReliableAtMs = nowMs;
        this.evaluate(nowMs);
    }
    setRuntimeCounters(agentId, counters, at) {
        const nowMs = tsMs(at);
        const agent = this.getOrCreateAgent(agentId, nowMs);
        if (typeof counters.activeToolCalls === 'number')
            agent.activeToolCalls = Math.max(0, Math.floor(counters.activeToolCalls));
        if (typeof counters.toolQueueDepth === 'number')
            agent.toolQueueDepth = Math.max(0, Math.floor(counters.toolQueueDepth));
        if (typeof counters.activeModelRequests === 'number')
            agent.activeModelRequests = Math.max(0, Math.floor(counters.activeModelRequests));
        agent.lastReliableAtMs = nowMs;
        this.evaluate(nowMs);
    }
    tick(nowInput) {
        this.evaluate(tsMs(nowInput));
    }
    getSnapshot(nowInput) {
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
    readSessionState(evt) {
        const payload = evt.data;
        if (!payload || typeof payload !== 'object')
            return null;
        const raw = String(payload.state || '').toUpperCase();
        if (raw === 'IDLE' || raw === 'COLLABORATING' || raw === 'THINKING' || raw === 'BUILDING' || raw === 'DEGRADED' || raw === 'DISCONNECTED') {
            return raw;
        }
        return null;
    }
    bumpQueueDepth(agent) {
        agent.toolQueueDepth = Math.max(agent.toolQueueDepth, agent.activeToolCalls);
        if (agent.activeToolCalls === 0)
            agent.toolQueueDepth = 0;
    }
    getOrCreateAgent(agentId, nowMs) {
        const existing = this.agents.get(agentId);
        if (existing)
            return existing;
        const created = {
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
    evaluate(nowMs) {
        for (const agent of this.agents.values()) {
            this.healStaleInFlightCounters(agent, nowMs);
            const next = inferState(agent, nowMs, this.cfg);
            let resolvedState = next.state;
            let resolvedReason = next.reason;
            // Keep non-idle states visible briefly so fast invoke/complete cycles are perceptible.
            if (next.state === 'IDLE' &&
                agent.state !== 'IDLE' &&
                nowMs - agent.stateSinceMs < this.cfg.minActiveDwellMs) {
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
    healStaleInFlightCounters(agent, nowMs) {
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
    updateSystem(nowMs) {
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
            if (pa !== pb)
                return pb - pa;
            return a.stateSinceMs - b.stateSinceMs;
        })[0];
        if (!best)
            return;
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
    toAgentSnapshot(agent, nowMs) {
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
    emit(transition) {
        for (const listener of this.listeners)
            listener(transition);
    }
}
//# sourceMappingURL=engine.js.map