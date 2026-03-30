<template>
  <div class="app-container">
    <header class="sessions-header" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
      <h1 class="oc-page-title">SESSIONS</h1>
      <div style="display:flex; gap:10px; align-items:center;">
        <div :class="pageStatusClass" style="font-family:var(--font-mono);">● {{ pageStatusText }}</div>
        <div class="oc-muted">Total: {{ sessions.length }}</div>
      </div>
    </header>

    <div class="oc-card" style="margin-bottom: 12px;">
      <div class="sessions-filters" style="display:grid; grid-template-columns: 1fr 170px 170px; gap: 10px;">
        <input v-model="sessionQuery" class="neon-input" placeholder="Filter by session/agent..." />
        <select v-model="sortBy" class="neon-input">
          <option value="last">Sort: Last Update</option>
          <option value="events">Sort: Event Count</option>
          <option value="tokens">Sort: Tokens</option>
        </select>
        <select v-model="timelineDomain" class="neon-input">
          <option value="all">Timeline: All Domains</option>
          <option value="agent">Agent</option>
          <option value="tool">Tool</option>
          <option value="channel">Channel</option>
          <option value="session">Session</option>
          <option value="access">Access</option>
          <option value="system">System</option>
          <option value="network">Network</option>
        </select>
      </div>
    </div>

    <div class="sessions-grid" style="display:grid;grid-template-columns: 1fr 1fr; gap:16px; flex:1; min-height:0;">
      <div class="oc-card" style="overflow: auto;">
        <div class="sessions-cards">
          <div v-for="s in filteredSessions" :key="s.sessionKey" class="session-card" @click="selectedSession=s.sessionKey" :style="{background:selectedSession===s.sessionKey?'rgba(0,255,255,0.08)':'transparent'}">
            <div class="session-title text-cyan">{{ s.sessionKey }}</div>
            <div class="session-meta">Agent: {{ s.agentId || 'unknown' }} · Events: {{ s.count }} · Tools: {{ s.toolInvokes }}</div>
            <div class="session-meta">Tokens: {{ s.tokens.toLocaleString() }} · Last: {{ formatTime(s.lastTimestamp) }}</div>
          </div>
        </div>
      </div>

      <div class="oc-card" style="overflow:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:10px; flex-wrap:wrap;">
          <h3 class="text-cyan" style="margin:0;">SESSION_TIMELINE {{ selectedSession ? `(${selectedSession})` : '' }}</h3>
          <div style="display:flex; gap:8px; align-items:center; font-family:var(--font-mono);">
            <label class="text-secondary">Window</label>
            <select v-model="windowSize" class="neon-input" style="width:90px;">
              <option :value="50">50</option>
              <option :value="100">100</option>
              <option :value="150">150</option>
              <option :value="250">250</option>
            </select>
            <button class="neon-button" @click="prevPage" :disabled="page===0">Prev</button>
            <span class="text-secondary">{{ page+1 }}/{{ totalPages }}</span>
            <button class="neon-button" @click="nextPage" :disabled="page>=totalPages-1">Next</button>
          </div>
        </div>
        <div v-if="!selectedSession" class="text-muted">Select a session on the left.</div>
        <div v-else>
          <div v-for="evt in pagedTimeline" :key="evt.id" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-family:var(--font-mono);font-size:0.85em;">
            <div style="cursor:pointer;" @click="toggleEventDetail(evt.id)">
              <span class="text-secondary">{{ formatTime(evt.timestamp) }}</span>
              | <span class="text-cyan">{{ evt.type }}</span>
              | {{ evt.summary }}
              <span style="float:right;color:var(--text-muted)">{{ timelineExpandedId === evt.id ? '[-]' : '[+]' }}</span>
            </div>
            <div v-if="timelineExpandedId === evt.id" style="margin-top:6px; padding:8px; border:1px solid rgba(255,255,255,0.08); color:var(--text-secondary);">
              <pre style="white-space:pre-wrap; margin:0; font-family:var(--font-mono);">{{ prettyData(evt.data) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import type { Ref } from 'vue'

const events = inject('events') as Ref<any[]>
const pageStatusText = inject('pageStatusText') as Ref<string>
const pageStatusClass = inject('pageStatusClass') as Ref<string>
const selectedSession = ref<string | null>(localStorage.getItem('oc.sessions.selected') || null)
const timelineExpandedId = ref<string | null>(null)
const sessionQuery = ref(localStorage.getItem('oc.sessions.query') || '')
const sortBy = ref<'last' | 'events' | 'tokens'>((localStorage.getItem('oc.sessions.sort') as any) || 'last')
const timelineDomain = ref(localStorage.getItem('oc.sessions.domain') || 'all')
const windowSize = ref(Number(localStorage.getItem('oc.sessions.window') || '100'))
const page = ref(0)

const sessions = computed(() => {
  const map: Record<string, any> = {}
  for (const evt of events.value) {
    const key = evt.sessionKey || 'no-session'
    if (!map[key]) {
      map[key] = {
        sessionKey: key,
        agentId: evt.agentId || null,
        count: 0,
        toolInvokes: 0,
        tokens: 0,
        lastTimestamp: evt.timestamp
      }
    }
    const s = map[key]
    s.count += 1
    s.lastTimestamp = evt.timestamp > s.lastTimestamp ? evt.timestamp : s.lastTimestamp
    if (evt.type === 'tool.invoke') s.toolInvokes += 1
    if (evt.type === 'model.usage') {
      try {
        const d = JSON.parse(evt.data)
        s.tokens += d?.tokens?.total || 0
      } catch {}
    }
  }
  return Object.values(map).sort((a: any, b: any) => (a.lastTimestamp < b.lastTimestamp ? 1 : -1))
})

const filteredSessions = computed(() => {
  let list = [...sessions.value]
  if (sessionQuery.value.trim()) {
    const q = sessionQuery.value.toLowerCase()
    list = list.filter((s: any) => `${s.sessionKey} ${s.agentId || ''}`.toLowerCase().includes(q))
  }
  if (sortBy.value === 'events') list.sort((a: any, b: any) => b.count - a.count)
  else if (sortBy.value === 'tokens') list.sort((a: any, b: any) => b.tokens - a.tokens)
  else list.sort((a: any, b: any) => (a.lastTimestamp < b.lastTimestamp ? 1 : -1))
  return list
})

const selectedTimeline = computed(() => {
  if (!selectedSession.value) return []
  return events.value
    .filter((e: any) => e.sessionKey === selectedSession.value)
    .filter((e: any) => timelineDomain.value === 'all' || e.domain === timelineDomain.value)
})

const totalPages = computed(() => Math.max(1, Math.ceil(selectedTimeline.value.length / windowSize.value)))

const pagedTimeline = computed(() => {
  const start = page.value * windowSize.value
  return selectedTimeline.value.slice(start, start + windowSize.value)
})

const prevPage = () => {
  page.value = Math.max(0, page.value - 1)
}
const nextPage = () => {
  page.value = Math.min(totalPages.value - 1, page.value + 1)
}

watch([selectedSession, timelineDomain, windowSize], () => {
  page.value = 0
})

watch(selectedSession, (v) => {
  if (v) localStorage.setItem('oc.sessions.selected', v)
  else localStorage.removeItem('oc.sessions.selected')
})
watch(sessionQuery, (v) => localStorage.setItem('oc.sessions.query', v))
watch(sortBy, (v) => localStorage.setItem('oc.sessions.sort', v))
watch(timelineDomain, (v) => localStorage.setItem('oc.sessions.domain', v))
watch(windowSize, (v) => localStorage.setItem('oc.sessions.window', String(v)))

const toggleEventDetail = (id: string) => {
  timelineExpandedId.value = timelineExpandedId.value === id ? null : id
}

const prettyData = (data: any) => {
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data
    if (obj?.token) obj.token = '***REDACTED***'
    if (obj?.apiKey) obj.apiKey = '***REDACTED***'
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(data)
  }
}

const formatTime = (iso: string) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString()
}
</script>

<style scoped>
.app-container { height: 100%; display: flex; flex-direction: column; min-width:0; }
.session-card {
  border: 1px solid rgba(168,179,199,0.18);
  border-radius: var(--radius-sm);
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  background: rgba(255,255,255,0.01);
}
.session-title {
  font-family: var(--font-mono);
  font-size: 0.9rem;
  margin-bottom: 4px;
  word-break: break-all;
}
.session-meta {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-secondary);
}

@media (max-width: 1200px) {
  .sessions-grid {
    grid-template-columns: 1fr !important;
  }
  .sessions-filters {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 768px) {
  .sessions-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>