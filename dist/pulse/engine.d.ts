import { type PulseConfig, type PulseEvent, type PulseSnapshot, type PulseTransition } from './types.js';
export declare class PulseEngine {
    private readonly cfg;
    private readonly agents;
    private readonly listeners;
    private system;
    constructor(config?: Partial<PulseConfig>);
    subscribe(listener: (transition: PulseTransition) => void): () => void;
    ingestEvent(evt: PulseEvent): void;
    setRuntimeConnected(agentId: string, connected: boolean, at?: string | number | Date): void;
    setRuntimeCounters(agentId: string, counters: {
        activeToolCalls?: number;
        toolQueueDepth?: number;
        activeModelRequests?: number;
    }, at?: string | number | Date): void;
    tick(nowInput?: string | number | Date): void;
    getSnapshot(nowInput?: string | number | Date): PulseSnapshot;
    private readSessionState;
    private bumpQueueDepth;
    private getOrCreateAgent;
    private evaluate;
    private healStaleInFlightCounters;
    private updateSystem;
    private toAgentSnapshot;
    private emit;
}
//# sourceMappingURL=engine.d.ts.map