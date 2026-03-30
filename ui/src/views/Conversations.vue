<template>
  <div class="conv-page">
    <div class="top-controls oc-card">
      <div class="row">
        <select v-model="agentId" class="neon-input">
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name || a.id }}</option>
        </select>
        <input v-model="q" class="neon-input" placeholder="Search sessions..." />
        <select v-model="typeFilter" class="neon-input">
          <option value="">All Types</option>
          <option value="main">Main</option>
          <option value="cron">Cron</option>
          <option value="subagent">Subagent</option>
          <option value="other">Other</option>
        </select>
        <select v-model="channelFilter" class="neon-input">
          <option value="">All Channels</option>
          <option v-for="c in channelOptions" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
    </div>

    <div class="layout">
      <div class="oc-card list-pane">
        <div class="pane-title">Sessions</div>
        <div v-if="listLoading" class="oc-muted">Loading...</div>
        <div v-else-if="sessions.length===0" class="oc-muted">No conversations found</div>
        <button v-for="s in sessions" :key="s.sessionId" class="session-item" :class="{active:selectedSessionId===s.sessionId}" @click="selectSession(s)">
          <div class="si-top">
            <span class="badge" :class="`type-${s.sessionType}`">{{ s.sessionType }}</span>
            <span class="channel">{{ s.channel }}</span>
          </div>
          <div class="si-label">{{ cleanLabel(s.label) }}</div>
          <div class="si-meta">{{ relTime(s.updatedAt) }} · {{ fileSize(s.fileSize) }}</div>
        </button>
      </div>

      <div class="oc-card thread-pane">
        <div class="pane-title">{{ selectedHeader }}</div>
        <div v-if="!selectedSessionId" class="oc-muted">Select a conversation</div>
        <template v-else>
          <div class="thread" ref="threadEl">
            <div v-for="(m, idx) in messages" :key="idx" class="msg" :class="m.role">
              <div v-if="m.role==='system'" class="msg-system-head" @click="toggleSystem(idx)">
                <span>{{ systemCollapsed[idx] ? '▶' : '▼' }} system</span>
                <span class="time">{{ msgTime(m.timestamp) }}</span>
              </div>
              <template v-if="m.role!=='system' || !systemCollapsed[idx]">
                <pre class="content">{{ m.content }}</pre>
                <div v-if="m.role!=='system'" class="time">{{ msgTime(m.timestamp) }}</div>
              </template>
            </div>
          </div>
          <div class="thread-actions">
            <button class="neon-button" @click="loadMore" :disabled="threadLoading || loadedAll">{{ loadedAll ? 'No more messages' : 'Load more' }}</button>
            <span class="oc-muted mono">showing {{ messages.length }} / {{ totalMessages }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

const authPassword = inject('authPassword') as Ref<string>

const agents = ref<any[]>([])
const sessions = ref<any[]>([])
const messages = ref<any[]>([])
const systemCollapsed = ref<Record<number, boolean>>({})

const agentId = ref('main')
const q = ref('')
const typeFilter = ref('')
const channelFilter = ref('')

const selectedSessionId = ref('')
const selectedSessionLabel = ref('')
const listLoading = ref(false)
const threadLoading = ref(false)
const offset = ref(0)
const totalMessages = ref(0)
const loadedAll = ref(false)
const threadEl = ref<HTMLElement | null>(null)

const headers = () => ({ 'x-observeclaw-password': authPassword.value || '' })

const channelOptions = computed(() => Array.from(new Set(sessions.value.map((s:any)=>String(s.channel||'').toLowerCase()).filter(Boolean))).sort())
const selectedHeader = computed(() => selectedSessionId.value ? `Conversation · ${selectedSessionLabel.value || selectedSessionId.value}` : 'Select a conversation')

const cleanLabel = (l: string) => String(l || '').replace(/\s+id:\S+$/i, '')

const relTime = (iso: string) => {
  if (!iso) return 'unknown'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.max(1, Math.round(Math.abs(diff) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h/24)}d ago`
}

const fileSize = (bytes: number) => {
  const b = Number(bytes || 0)
  if (b >= 1024*1024) return `${(b/1024/1024).toFixed(1)} MB`
  return `${Math.max(0.1, b/1024).toFixed(1)} KB`
}

const msgTime = (t: string) => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

const loadAgents = async () => {
  const res = await fetch('/api/agents', { headers: headers() })
  if (!res.ok) return
  const j = await res.json()
  agents.value = j.data || []
  if (!agents.value.find((a:any)=>a.id===agentId.value) && agents.value[0]) agentId.value = agents.value[0].id
}

const loadSessions = async () => {
  listLoading.value = true
  try {
    const p = new URLSearchParams()
    p.set('agent', agentId.value)
    p.set('limit', '500')
    if (q.value.trim()) p.set('q', q.value.trim())
    if (typeFilter.value) p.set('type', typeFilter.value)
    if (channelFilter.value) p.set('channel', channelFilter.value)
    const res = await fetch(`/api/conversations?${p.toString()}`, { headers: headers() })
    if (!res.ok) return
    const j = await res.json()
    sessions.value = j.data || []
  } finally { listLoading.value = false }
}

const selectSession = async (s: any) => {
  selectedSessionId.value = s.sessionId
  selectedSessionLabel.value = cleanLabel(s.label)
  messages.value = []
  systemCollapsed.value = {}
  offset.value = 0
  totalMessages.value = 0
  loadedAll.value = false
  await loadThreadChunk()
  await nextTick()
  if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
}

const loadThreadChunk = async () => {
  if (!selectedSessionId.value || threadLoading.value || loadedAll.value) return
  threadLoading.value = true
  try {
    const p = new URLSearchParams({ agent: agentId.value, limit: '500', offset: String(offset.value) })
    const res = await fetch(`/api/conversations/${encodeURIComponent(selectedSessionId.value)}?${p.toString()}`, { headers: headers() })
    if (!res.ok) return
    const j = await res.json()
    const chunk = Array.isArray(j.data) ? j.data : []
    if (chunk.length === 0) { loadedAll.value = true; return }

    messages.value = [...chunk, ...messages.value]
    const start = messages.value.length - chunk.length
    chunk.forEach((m: any, i: number) => {
      if (m.role === 'system') systemCollapsed.value[start + i] = true
    })

    totalMessages.value = Number(j.total || messages.value.length)
    offset.value += chunk.length
    if (messages.value.length >= totalMessages.value) loadedAll.value = true
  } finally { threadLoading.value = false }
}

const loadMore = async () => { await loadThreadChunk() }
const toggleSystem = (idx: number) => { systemCollapsed.value[idx] = !systemCollapsed.value[idx] }

watch([agentId, q, typeFilter, channelFilter], async () => {
  selectedSessionId.value = ''
  selectedSessionLabel.value = ''
  messages.value = []
  await loadSessions()
})

onMounted(async () => {
  await loadAgents()
  await loadSessions()
})
</script>

<style scoped>
.conv-page { min-height: 100%; display: flex; flex-direction: column; gap: 10px; }
.top-controls .row { display:grid; grid-template-columns: 160px 1fr 140px 150px; gap:8px; }
.layout { display:grid; grid-template-columns: 340px 1fr; gap: 10px; min-height: 0; flex: 1; }
.list-pane, .thread-pane { min-height: 0; display:flex; flex-direction: column; }
.list-pane { overflow:auto; }
.thread-pane { overflow:hidden; }
.pane-title { font-family: var(--font-sans); font-weight: 800; margin-bottom: 8px; }
.session-item { width:100%; text-align:left; background: rgba(255,255,255,.02); border:1px solid rgba(168,179,199,.2); border-radius:8px; padding:8px; margin-bottom:6px; color:inherit; }
.session-item.active { border-color: rgba(39,213,255,.55); background: rgba(39,213,255,.09); }
.si-top { display:flex; justify-content: space-between; align-items: center; margin-bottom:4px; }
.badge { font-family:var(--font-mono); font-size:.62rem; text-transform:uppercase; border:1px solid rgba(255,255,255,.25); border-radius:3px; padding:1px 5px; }
.badge.type-main { border-color: rgba(39,213,255,.6); color:#bfe8ff; }
.badge.type-cron { border-color: rgba(255,179,71,.6); color:#ffd7a3; }
.badge.type-subagent { border-color: rgba(167,139,250,.6); color:#d8c7ff; }
.badge.type-other { color:#b9c5d8; }
.channel, .si-meta { font-family: var(--font-mono); font-size:.66rem; color: var(--text-secondary); }
.si-label { font-weight:700; font-size:.78rem; margin-bottom:3px; }
.thread { flex:1; overflow:auto; padding-right:2px; display:flex; flex-direction:column; gap:8px; }
.msg { border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:8px; }
.msg.user { border-color: rgba(39,213,255,.42); background: rgba(39,213,255,.08); }
.msg.assistant { border-color: rgba(73,166,255,.65); background: rgba(73,166,255,.16); }
.msg.system { border-color: rgba(255,255,255,.18); background: rgba(255,255,255,.03); }
.msg-system-head { display:flex; justify-content:space-between; align-items:center; cursor:pointer; font-family:var(--font-mono); font-size:.68rem; color:var(--text-secondary); }
.content { white-space: pre-wrap; margin: 4px 0 0 0; font-family: var(--font-mono); font-size: .74rem; }
.time { font-family: var(--font-mono); font-size: .62rem; color: var(--text-secondary); margin-top:4px; }
.thread-actions { margin-top: 8px; display:flex; justify-content:space-between; align-items:center; }
.mono { font-family: var(--font-mono); font-size:.68rem; }
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .top-controls .row { grid-template-columns: 1fr 1fr; }
}
</style>
