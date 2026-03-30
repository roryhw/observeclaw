import assert from 'node:assert/strict';
import { PulseEngine } from './engine.js';
function runPulseEngineTests() {
    const base = Date.parse('2026-03-05T00:00:00.000Z');
    const at = (ms) => new Date(base + ms).toISOString();
    // tool activity => BUILDING => IDLE
    {
        const e = new PulseEngine({ staleWarnMs: 10_000, disconnectTimeoutMs: 30_000, collaborationHoldMs: 2_000 });
        e.ingestEvent({ type: 'tool.invoke', agentId: 'main', timestamp: at(0) });
        let snap = e.getSnapshot(at(100));
        assert.equal(snap.system.state, 'BUILDING');
        e.ingestEvent({ type: 'tool.complete', agentId: 'main', timestamp: at(1_000) });
        snap = e.getSnapshot(at(1_700));
        assert.equal(snap.system.state, 'IDLE');
    }
    // fast invoke/complete should still show active state briefly (minimum dwell)
    {
        const e = new PulseEngine({ staleWarnMs: 10_000, disconnectTimeoutMs: 30_000, collaborationHoldMs: 2_000, minActiveDwellMs: 1_500 });
        e.ingestEvent({ type: 'tool.invoke', agentId: 'main', timestamp: at(0) });
        e.ingestEvent({ type: 'tool.complete', agentId: 'main', timestamp: at(50) });
        let snap = e.getSnapshot(at(500));
        assert.equal(snap.system.state, 'BUILDING');
        snap = e.getSnapshot(at(1_700));
        assert.equal(snap.system.state, 'IDLE');
    }
    // collaboration hold => COLLABORATING => IDLE after hold
    {
        const e = new PulseEngine({ staleWarnMs: 10_000, disconnectTimeoutMs: 30_000, collaborationHoldMs: 2_000 });
        e.ingestEvent({ type: 'message.queued', agentId: 'main', timestamp: at(0) });
        let snap = e.getSnapshot(at(1_000));
        assert.equal(snap.system.state, 'COLLABORATING');
        snap = e.getSnapshot(at(2_500));
        assert.equal(snap.system.state, 'IDLE');
    }
    // quiet idle system should remain IDLE (no idle<->degraded flapping)
    {
        const e = new PulseEngine({ staleWarnMs: 10_000, disconnectTimeoutMs: 30_000, collaborationHoldMs: 2_000 });
        e.ingestEvent({ type: 'message.processed', agentId: 'main', timestamp: at(0) });
        const snap = e.getSnapshot(at(35_000));
        assert.equal(snap.system.state, 'IDLE');
    }
    // in-flight work with stale telemetry should degrade, then self-heal to IDLE if no corroborating activity.
    {
        const e = new PulseEngine({ staleWarnMs: 10_000, disconnectTimeoutMs: 30_000, collaborationHoldMs: 2_000 });
        e.ingestEvent({ type: 'tool.invoke', agentId: 'main', timestamp: at(0) });
        let snap = e.getSnapshot(at(15_000));
        assert.equal(snap.system.state, 'DEGRADED');
        snap = e.getSnapshot(at(35_000));
        assert.equal(snap.system.state, 'IDLE');
    }
    // priority across agents: BUILDING beats THINKING
    {
        const e = new PulseEngine();
        e.ingestEvent({ type: 'session.output', agentId: 'a1', timestamp: at(0) });
        e.ingestEvent({ type: 'tool.invoke', agentId: 'a2', timestamp: at(100) });
        const snap = e.getSnapshot(at(200));
        assert.equal(snap.system.state, 'BUILDING');
    }
    // model/provider should be captured and persist through idle
    {
        const e = new PulseEngine();
        e.ingestEvent({
            type: 'model.usage',
            agentId: 'main',
            timestamp: at(0),
            data: { model: 'gpt-5.3-codex', provider: 'openai-codex' }
        });
        let snap = e.getSnapshot(at(10));
        const agent = snap.agents.find((a) => a.id === 'main');
        assert.equal(agent?.model, 'gpt-5.3-codex');
        assert.equal(agent?.provider, 'openai-codex');
        // Later idle tick should not clear known model
        snap = e.getSnapshot(at(10_000));
        const agentLater = snap.agents.find((a) => a.id === 'main');
        assert.equal(agentLater?.state, 'IDLE');
        assert.equal(agentLater?.model, 'gpt-5.3-codex');
    }
    console.log('PulseEngine tests passed');
}
runPulseEngineTests();
//# sourceMappingURL=engine.test.js.map