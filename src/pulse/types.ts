export type PulseState =
  | 'IDLE'
  | 'COLLABORATING'
  | 'THINKING'
  | 'BUILDING'
  | 'DEGRADED'
  | 'DISCONNECTED';

export type PulseReason =
  | 'runtime_unreachable'
  | 'telemetry_stale'
  | 'tool_activity'
  | 'model_active'
  | 'message_flow'
  | 'no_active_work';

export interface PulseConfig {
  staleWarnMs: number;
  disconnectTimeoutMs: number;
  collaborationHoldMs: number;
  minActiveDwellMs: number;
}

export interface PulseEvent {
  type: string;
  timestamp?: string | number | Date;
  agentId?: string | null;
  sessionKey?: string | null;
  data?: unknown;
}

export interface AgentPulseSnapshot {
  id: string;
  state: PulseState;
  stateSince: string;
  reason: PulseReason;
  activeToolCalls: number;
  toolQueueDepth: number;
  activeModelRequests: number;
  model: string | null;
  provider: string | null;
  modelUpdatedAt: string | null;
  lastEventAt: string | null;
  freshnessMs: number;
  stale: boolean;
}

export interface PulseSnapshot {
  version: number;
  computedAt: string;
  system: {
    state: PulseState;
    stateSince: string;
    reason: PulseReason;
    freshnessMs: number;
    stale: boolean;
  };
  agents: AgentPulseSnapshot[];
}

export interface PulseTransition {
  scope: 'system' | 'agent';
  state: PulseState;
  stateSince: string;
  reason: PulseReason;
  agentId?: string;
}

export interface AgentPulseInternal {
  id: string;
  runtimeConnected: boolean;
  activeToolCalls: number;
  toolQueueDepth: number;
  activeModelRequests: number;
  model: string | null;
  provider: string | null;
  modelUpdatedAtMs: number | null;
  lastEventAtMs: number;
  lastReliableAtMs: number;
  lastCollabAtMs: number;
  lastToolEventAtMs: number;
  lastModelEventAtMs: number;
  state: PulseState;
  stateSinceMs: number;
  reason: PulseReason;
}
