<template>
  <div class="agents-page">
    <div class="agents-grid">
      <div v-for="agent in (Object.values(activeAgents) as any[])" :key="agent.id" class="oc-card">
        <h3 :class="agent.state === 'IDLE' ? 'text-green' : 'text-cyan'" style="margin-bottom: 8px;">
          ● AGENT: {{ agent.id.toUpperCase() }}
        </h3>
        <div :style="{ height: '1px', backgroundColor: agent.state === 'IDLE' ? 'var(--accent-green)' : 'var(--accent-cyan)', marginBottom: '16px' }"></div>

        <p class="text-orange" style="font-family: var(--font-mono); font-weight: bold; margin-bottom: 4px;">
          STATUS: {{ agent.state }}
        </p>
        <p class="text-secondary agent-task" style="margin-bottom: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          {{ agent.currentTask }}
        </p>

        <ul style="list-style: none; font-family: var(--font-mono); font-size: 0.9em; line-height: 1.8;">
          <li><span class="text-muted">CHL:</span> {{ agent.channel }}</li>
          <li><span class="text-muted">MDL:</span> {{ agent.model }}</li>
          <li><span class="text-muted">TOK:</span> <span class="text-cyan">{{ Number(agent.tokensUsed || 0).toLocaleString() }}</span></li>
          <li><span class="text-muted">QDEPTH:</span> {{ agent.queueDepth || 0 }}</li>
          <li><span class="text-muted">TOOLS:</span> {{ agent.toolInvokes || 0 }}/{{ agent.toolCompletes || 0 }}</li>
          <li><span class="text-muted">LAST:</span> {{ formatTime(agent.lastActivity) }}</li>
          <li><span class="text-muted">RUN:</span> {{ formatDuration(agent.lastStateChange, agent.lastActivity) }}</li>
          <li><span class="text-muted">RECENT:</span> {{ recentCompletedSummary(agent.id) }}</li>
          <li><span class="text-muted">LAST3:</span> {{ lastThreeTools(agent.id) }}</li>
          <li><span class="text-muted">ERR_BURST:</span> <span :class="errorBurst(agent.id) ? 'text-red' : 'text-green'">{{ errorBurst(agent.id) ? 'YES' : 'NO' }}</span></li>
          <li><span class="text-muted">HEALTH:</span> <span :class="healthScore(agent.id) >= 80 ? 'text-green' : healthScore(agent.id) >= 50 ? 'text-orange' : 'text-red'">{{ healthScore(agent.id) }}</span></li>
          <li><span class="text-muted">TREND:</span> <span style="color:var(--accent-magenta)">{{ tokenSparkline(agent.id) }}</span></li>
        </ul>
      </div>

      <div v-if="Object.keys(activeAgents).length === 0" class="oc-card" style="display: flex; justify-content: center; align-items: center; min-height: 150px;">
        <p class="text-muted" style="font-family: var(--font-mono);">No active agents detected yet.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { Ref } from 'vue'

const events = inject('events') as Ref<any[]>
const activeAgents = inject('activeAgents') as Ref<Record<string, any>>

const formatTime = (isoString: string) => {
  if (!isoString) return ''
  const d = new Date(isoString)
  return d.toLocaleTimeString([], { hour12: false })
}

const formatDuration = (from: string, to: string) => {
  if (!from || !to) return 'n/a'
  const ms = Math.max(0, new Date(to).getTime() - new Date(from).getTime())
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${r}s`
}

const recentCompletedSummary = (agentId: string) => {
  const recent = events.value.find((e: any) => e.agentId === agentId && e.type === 'tool.complete')
  if (!recent) return 'No recent completes'
  return recent.summary
}

const lastThreeTools = (agentId: string) => {
  const tools = events.value
    .filter((e: any) => e.agentId === agentId && e.type === 'tool.complete')
    .slice(0, 3)
    .map((e: any) => e.summary.replace('Tool complete: ', ''))
  return tools.length ? tools.join(' | ') : 'n/a'
}

const errorBurst = (agentId: string) => {
  const recent = events.value
    .filter((e: any) => e.agentId === agentId)
    .slice(0, 25)
  const errs = recent.filter((e: any) => e.severity === 'error' || String(e.type).includes('error'))
  return errs.length >= 3
}

const healthScore = (agentId: string) => {
  const recent = events.value.filter((e: any) => e.agentId === agentId).slice(0, 40)
  if (!recent.length) return 50
  const errCount = recent.filter((e: any) => e.severity === 'error' || String(e.type).includes('error')).length
  const warnCount = recent.filter((e: any) => e.severity === 'warning').length
  const toolComplete = recent.filter((e: any) => e.type === 'tool.complete').length
  const score = 100 - errCount * 18 - warnCount * 7 + Math.min(20, toolComplete * 2)
  return Math.max(0, Math.min(100, score))
}

const tokenSparkline = (agentId: string) => {
  const vals = events.value
    .filter((e: any) => e.agentId === agentId && e.type === 'model.usage')
    .slice(0, 8)
    .map((e: any) => {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
        return Number(d?.tokens?.total || 0)
      } catch {
        return 0
      }
    })
    .reverse()
  if (!vals.length) return '······'
  const max = Math.max(...vals, 1)
  const blocks = ['▁','▂','▃','▄','▅','▆','▇','█']
  return vals.map(v => blocks[Math.min(7, Math.floor((v / max) * 7))]).join('')
}
</script>

<style scoped>
.agents-page {
  min-height: 100%;
  height: auto;
  display: flex;
  flex-direction: column;
  overflow: visible;
}
.agents-header { margin-bottom: 12px; display:flex; flex-direction:column; gap:2px; }
.overview-online { font-family: var(--font-mono); color: var(--accent-green); font-size: 0.78rem; letter-spacing: 0.04em; font-weight: 700; }
.agents-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:24px; min-width:0; }
@media (max-width: 768px) {
  .agent-task { white-space: normal !important; }
  .agents-page {
    padding-bottom: calc(360px + env(safe-area-inset-bottom));
  }
  .agents-grid {
    padding-bottom: 80px;
  }
  .agents-grid::after {
    content: '';
    display: block;
    height: calc(180px + env(safe-area-inset-bottom));
  }
}
</style>
