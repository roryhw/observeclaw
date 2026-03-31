<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, provide, watch } from 'vue'
import { useRoute } from 'vue-router'

const password = ref('')
const authSession = ref('')
const connected = ref(false)
const connectionStatus = ref('DISCONNECTED')
const authError = ref('')
const authorized = ref(false)
const mobileMenuOpen = ref(localStorage.getItem('oc.mobile.menuOpen') === '1')
const route = useRoute()
const systemPulseState = ref('IDLE')
const versionInfo = ref<{ current: string; latest: string | null; status: string } | null>(null)
const versionInfoLoading = ref(false)
const sidebarMeta = ref<{ hostname: string; observeclawVersion: string; openclawVersion: string }>({ hostname: '', observeclawVersion: '', openclawVersion: '' })

const currentPageTitle = computed(() => {
  const p = route.path
  if (p === '/') return 'System Overview'
  if (p.startsWith('/activity')) return 'Activity Stream'
  if (p.startsWith('/alerts')) return 'Alerts'
  if (p.startsWith('/agents')) return 'Agents'
  if (p.startsWith('/log-explorer')) return 'Log Explorer'
  if (p.startsWith('/projects-jobs')) return 'Projects & Jobs'
  if (p.startsWith('/conversations')) return 'Conversations'
  if (p.startsWith('/file-viewer')) return 'File Viewer'
  if (p.startsWith('/sessions')) return 'Sessions'
  if (p.startsWith('/soul-memory')) return 'Soul & Memory'
  if (p.startsWith('/audit')) return 'Audit Log'
  if (p.startsWith('/retention')) return 'Retention Policy'
  return 'ObserveClaw'
})

const isGlanceRoute = computed(() => route.path === '/')

const pageStatusText = computed(() => {
  const conn = String(connectionStatus.value || 'DISCONNECTED')
  if (conn !== 'ONLINE') return conn
  if (isGlanceRoute.value) return ''
  const pulse = String(systemPulseState.value || '').toUpperCase().trim()
  return pulse ? `ONLINE | ${pulse}` : 'ONLINE'
})

const pageStatusClass = computed(() => {
  const conn = String(connectionStatus.value || 'DISCONNECTED')
  if (conn !== 'ONLINE') return 'text-red'
  const pulse = String(systemPulseState.value || '').toUpperCase().trim()
  if (!pulse || pulse === 'IDLE') return 'text-green'
  if (pulse === 'BUILDING' || pulse === 'THINKING' || pulse === 'COLLABORATING') return 'text-cyan'
  if (pulse === 'DEGRADED') return 'text-orange'
  if (pulse === 'DISCONNECTED') return 'text-red'
  return 'text-green'
})
const wsConnected = computed(() => String(connectionStatus.value || '') === 'ONLINE')
const navVersionChipText = computed(() => {
  if (versionInfoLoading.value && !versionInfo.value) return 'CHECKING…'
  if (!versionInfo.value) return 'CHECKING…'
  if (versionInfo.value.status === 'update-available') return versionInfo.value.latest ? `${versionInfo.value.latest} AVAILABLE` : 'UPDATE AVAILABLE'
  if (versionInfo.value.status === 'current') return 'UP TO DATE'
  return 'STATUS UNKNOWN'
})

const navGroups = [
  {
    label: 'PRIMARY',
    items: [
      { to: '/', label: 'SYSTEM OVERVIEW', icon: ['M4 5h7v7H4z','M13 5h7v4h-7z','M13 11h7v8h-7z','M4 14h7v5H4z'], exact: true },
      { to: '/activity', label: 'ACTIVITY', icon: ['M3 13h4l2-6 4 12 2-6h6'] },
      { to: '/alerts', label: 'ALERTS', icon: ['M12 3l9 16H3z','M12 9v5','M12 17h.01'] },
      { to: '/agents', label: 'AGENTS', icon: ['M12 12a4 4 0 100-8 4 4 0 000 8z','M4 20a8 8 0 0116 0'] },
      { to: '/soul-memory', label: 'SOUL & MEMORY', icon: ['M5 4h10a4 4 0 014 4v12H9a4 4 0 00-4 4z','M9 4v16'] }
    ]
  },
  {
    label: 'MORE',
    items: [
      { to: '/log-explorer', label: 'LOG EXPLORER', icon: ['M5 4h14v16H5z','M8 8h8','M8 12h8','M8 16h5'] },
      { to: '/projects-jobs', label: 'PROJECTS & JOBS', icon: ['M5 6h6v4H5z','M13 14h6v4h-6z','M8 10v4h8'] },
      { to: '/conversations', label: 'CONVERSATIONS', icon: ['M6 7h12a2 2 0 012 2v7l-4-2H6a2 2 0 01-2-2V9a2 2 0 012-2z'] },
      { to: '/file-viewer', label: 'FILE VIEWER', icon: ['M7 3h7l5 5v13H7z','M14 3v5h5','M9 13h8','M9 17h6'] },
      { to: '/audit', label: 'AUDIT', icon: ['M12 3l7 3v6c0 4.5-3 7-7 9-4-2-7-4.5-7-9V6z','M9 12l2 2 4-4'] },
      { to: '/retention', label: 'RETENTION', icon: ['M12 8v5l3 2','M21 12a9 9 0 11-3-6.7','M21 3v6h-6'] }
    ]
  }
]

// State
const events = ref<any[]>([])
const activeAgents = ref<Record<string, any>>({})
const historyLoading = ref(false)
const historyDone = ref(false)

provide('events', events)
provide('activeAgents', activeAgents)
provide('authPassword', authSession)
provide('loadOlderEvents', loadOlderEvents)
provide('historyLoading', historyLoading)
provide('historyDone', historyDone)
provide('pageStatusText', pageStatusText)
provide('pageStatusClass', pageStatusClass)
provide('wsConnected', wsConnected)

const beginAuthorizedSession = async () => {
  authSession.value = 'session'
  connected.value = true
  authError.value = ''
  connectWebSocket()
  await Promise.allSettled([fetchInitialEvents(), fetchAuthStatus(), fetchPulseSnapshot(), fetchVersionInfo(), fetchSidebarMeta()])
}

const login = async () => {
  if (!password.value) return
  authError.value = ''
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value })
    })
    if (!res.ok) {
      authError.value = res.status === 401 ? 'API auth failed. Check password.' : 'Login failed.'
      connected.value = false
      authorized.value = false
      authSession.value = ''
      return
    }
    password.value = ''
    await beginAuthorizedSession()
  } catch {
    authError.value = 'Login failed.'
    connected.value = false
    authorized.value = false
    authSession.value = ''
  }
}

const relogin = async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } catch {}
  if (ws) {
    try { ws.close() } catch {}
    ws = null
  }
  connected.value = false
  connectionStatus.value = 'DISCONNECTED'
  authorized.value = false
  authError.value = ''
  authSession.value = ''
  events.value = []
  activeAgents.value = {}
  versionInfo.value = null
}

let ws: WebSocket | null = null

const connectWebSocket = () => {
  if (!authSession.value) return
  connectionStatus.value = 'CONNECTING...'
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/ws`
  
  ws = new WebSocket(wsUrl)
  
  ws.onopen = () => {
    connectionStatus.value = 'ONLINE'
    authError.value = ''
  }
  
  ws.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data)
      events.value.unshift(event)
      if (events.value.length > 5000) events.value.pop()

      if (event?.type === 'pulse.update') {
        const d = typeof event?.data === 'string' ? JSON.parse(event.data) : (event?.data || {})
        if (String(d?.scope || '') === 'system' && d?.state) {
          systemPulseState.value = String(d.state).toUpperCase()
        }
      } else if (event?.type === 'pulse.snapshot') {
        const d = typeof event?.data === 'string' ? JSON.parse(event.data) : (event?.data || {})
        const s = d?.system?.state
        if (s) systemPulseState.value = String(s).toUpperCase()
      }

      updateAgentState(event)
    } catch (e) {
      console.error('Failed to parse WS message', e)
    }
  }
  
  ws.onerror = () => {
    if (connectionStatus.value !== 'ONLINE') {
      authError.value = 'WebSocket auth failed or connection rejected.'
    }
  }

  ws.onclose = () => {
    connectionStatus.value = 'OFFLINE'
    if (authSession.value) setTimeout(connectWebSocket, 3000)
  }
}

const fetchAuthStatus = async () => {
  try {
    const res = await fetch('/api/auth/status', {
      headers: {}
    })
    if (!res.ok) {
      authorized.value = false
      return
    }
    const json = await res.json()
    authorized.value = !!json?.authorized
  } catch {
    authorized.value = false
  }
}

const fetchPulseSnapshot = async () => {
  try {
    const res = await fetch('/api/pulse', {
      headers: {}
    })
    if (!res.ok) return
    const json = await res.json()
    const state = json?.system?.state
    if (state) systemPulseState.value = String(state).toUpperCase()
  } catch {}
}

const fetchVersionInfo = async () => {
  if (versionInfoLoading.value) return
  versionInfoLoading.value = true
  try {
    const res = await fetch('/api/openclaw/version-status', { headers: {} })
    if (!res.ok) return
    const json = await res.json()
    versionInfo.value = {
      current: String(json?.current || 'Unknown'),
      latest: json?.latest ? String(json.latest) : null,
      status: String(json?.status || 'unknown')
    }
  } catch {} finally {
    versionInfoLoading.value = false
  }
}

const fetchSidebarMeta = async () => {
  try {
    const res = await fetch('/api/system/sidebar-meta', { credentials: 'same-origin' })
    if (!res.ok) return
    const json = await res.json()
    sidebarMeta.value = {
      hostname: String(json?.hostname || ''),
      observeclawVersion: String(json?.observeclawVersion || ''),
      openclawVersion: String(json?.openclawVersion || '')
    }
  } catch {}
}

const INITIAL_EVENTS_LIMIT = 120
const OLDER_EVENTS_BATCH = 200

const fetchInitialEvents = async () => {
  historyDone.value = false
  try {
    const res = await fetch(`/api/events?limit=${INITIAL_EVENTS_LIMIT}`, {
      headers: {
        'Accept': 'application/json'
      }
    })
    if (res.status === 401) {
      authError.value = 'API auth failed. Check password.'
      connectionStatus.value = 'AUTH_FAILED'
      return
    }

    const json = await res.json()
    if (json.data) {
      events.value = json.data
      
      // Rebuild agent states from history
      json.data.reverse().forEach(updateAgentState)
      events.value = json.data.reverse() // Keep newest first
      if (json.data.length < INITIAL_EVENTS_LIMIT) historyDone.value = true
    }
  } catch (err) {
    console.error('Failed to fetch initial events', err)
  }
}

async function loadOlderEvents(opts?: { before?: string; domain?: string; agentId?: string }) {
  if (historyLoading.value || historyDone.value) return
  const oldest = events.value[events.value.length - 1]
  const beforeTs = opts?.before || oldest?.timestamp
  if (!beforeTs) {
    historyDone.value = true
    return
  }

  historyLoading.value = true
  try {
    const q = new URLSearchParams({ limit: String(OLDER_EVENTS_BATCH), before: beforeTs })
    if (opts?.domain && opts.domain !== 'all') q.set('domain', opts.domain)
    if (opts?.agentId) q.set('agentId', opts.agentId)

    const res = await fetch(`/api/events?${q.toString()}`, {
      headers: {}
    })
    if (!res.ok) return
    const json = await res.json()
    const batch = Array.isArray(json.data) ? json.data : []
    if (batch.length === 0) {
      historyDone.value = true
      return
    }

    const seen = new Set(events.value.map((e: any) => e.id))
    const unique = batch.filter((e: any) => !seen.has(e.id))
    events.value = [...events.value, ...unique]
    if (batch.length < OLDER_EVENTS_BATCH) historyDone.value = true
  } catch (err) {
    console.error('Failed to load older events', err)
  } finally {
    historyLoading.value = false
  }
}

const parseEventData = (event: any) => {
  try {
    return typeof event?.data === 'string' ? JSON.parse(event.data) : (event?.data || {})
  } catch {
    return {}
  }
}

const inferAgentId = (event: any) => {
  if (event?.agentId) return String(event.agentId)
  const sk = String(event?.sessionKey || '')
  const m = sk.match(/^agent:([^:]+):/)
  if (m?.[1]) return m[1]
  return null
}

const normalizeState = (s: any) => {
  const v = String(s || '').toUpperCase()
  if (v === 'IDLE') return 'IDLE'
  if (v === 'THINKING') return 'THINKING'
  if (v === 'BUILDING') return 'BUILDING'
  if (v === 'COLLABORATING') return 'COLLABORATING'
  return null
}

const PULSE_HOLD_MS = {
  BUILDING: 1000,
  THINKING: 1000,
  COLLABORATING: 1000
} as const

const updatePulseState = (agent: any, nowTs: number) => {
  const marks = agent.pulseMarks || {}
  const buildFresh = marks.buildAt && (nowTs - marks.buildAt <= PULSE_HOLD_MS.BUILDING || (agent.queueDepth || 0) > 0)
  const thinkFresh = marks.thinkAt && nowTs - marks.thinkAt <= PULSE_HOLD_MS.THINKING
  const collabFresh = marks.collabAt && nowTs - marks.collabAt <= PULSE_HOLD_MS.COLLABORATING

  let next = 'IDLE'
  if (buildFresh) next = 'BUILDING'
  else if (thinkFresh) next = 'THINKING'
  else if (collabFresh) next = 'COLLABORATING'

  if (agent.state !== next) {
    agent.state = next
    agent.lastStateChange = new Date(nowTs).toISOString()
  }
  if (next === 'IDLE') {
    agent.currentTask = 'Waiting for messages...'
  }
}

const markPulse = (agent: any, kind: 'buildAt'|'thinkAt'|'collabAt', ts: number, task?: string) => {
  if (!agent.pulseMarks) agent.pulseMarks = {}
  agent.pulseMarks[kind] = ts
  if (task) agent.currentTask = task
}

const updateAgentState = (event: any) => {
  const agentId = inferAgentId(event)
  if (!agentId) return

  const rawData = parseEventData(event)

  if (!activeAgents.value[agentId]) {
    activeAgents.value[agentId] = {
      id: agentId,
      state: 'IDLE',
      lastActivity: event.timestamp,
      model: 'unknown',
      channel: event.channel || 'unknown',
      tokensUsed: 0,
      costUsd: 0,
      currentTask: 'Waiting for messages...',
      toolInvokes: 0,
      toolCompletes: 0,
      queueDepth: 0,
      lastStateChange: event.timestamp,
      pulseMarks: { buildAt: 0, thinkAt: 0, collabAt: 0 }
    }
  }

  const agent = activeAgents.value[agentId]
  agent.lastActivity = event.timestamp
  if (event.channel) agent.channel = event.channel
  if (rawData?.channel) agent.channel = rawData.channel
  if (typeof rawData?.model === 'string' && rawData.model) agent.model = rawData.model

  const evtTs = new Date(event.timestamp || Date.now()).getTime()

  if (event.type === 'tool.invoke') {
    agent.toolInvokes += 1
    agent.queueDepth = Math.max(0, agent.toolInvokes - agent.toolCompletes)
    markPulse(agent, 'buildAt', evtTs, `Invoking tool: ${rawData.tool || 'unknown'}`)
  } else if (event.type === 'tool.complete') {
    agent.toolCompletes += 1
    agent.queueDepth = Math.max(0, agent.toolInvokes - agent.toolCompletes)
    markPulse(agent, 'buildAt', evtTs, `Completed tool: ${rawData.tool || 'unknown'}`)
  } else if (event.type === 'message.queued' || event.type === 'webhook.received') {
    markPulse(agent, 'collabAt', evtTs, event.summary || `Talking to model on ${event.channel || 'unknown'}`)
  } else if (event.type === 'session.output') {
    markPulse(agent, 'thinkAt', evtTs, event.summary || 'Generating response...')
  } else if (event.type === 'message.processed' || event.type === 'channel.send.complete') {
    // Completion should trend back to IDLE unless building is still active
    agent.currentTask = event.summary || 'Response sent.'
    if (agent.pulseMarks) {
      agent.pulseMarks.thinkAt = 0
      agent.pulseMarks.collabAt = 0
    }
  } else if (event.type === 'session.state') {
    // Use explicit states when available; ignore unknown snapshots
    const stateStr = normalizeState(rawData?.state)
    if (stateStr === 'BUILDING') markPulse(agent, 'buildAt', evtTs, 'Executing tool calls...')
    else if (stateStr === 'THINKING') markPulse(agent, 'thinkAt', evtTs, 'Reasoning about prompt...')
    else if (stateStr === 'COLLABORATING') markPulse(agent, 'collabAt', evtTs, 'Talking to model...')
  } else if (event.type === 'model.usage') {
    const tokenTotal = Number(rawData?.tokens?.total)
    const costTotal = Number(rawData?.cost?.total)
    if (Number.isFinite(tokenTotal) && tokenTotal > 0) agent.tokensUsed += tokenTotal
    if (Number.isFinite(costTotal) && costTotal > 0) agent.costUsd += costTotal
  } else if ((String(event.type || '').includes('thinking') || String(event.type || '').includes('reason')) && !String(event.type || '').includes('tool')) {
    markPulse(agent, 'thinkAt', evtTs, event.summary || 'Thinking...')
  } else if (event.summary && agent.state === 'IDLE') {
    agent.currentTask = event.summary
  }

  updatePulseState(agent, evtTs)
}

watch(() => route.fullPath, () => {
  mobileMenuOpen.value = false
})

watch(mobileMenuOpen, (v) => {
  localStorage.setItem('oc.mobile.menuOpen', v ? '1' : '0')
})

onMounted(async () => {
  await fetchAuthStatus()
  if (authorized.value) {
    await beginAuthorizedSession()
  }
})

onUnmounted(() => {
  if (ws) ws.close()
})
</script>

<template>
  <div v-if="!connected" class="app-container login-page">
    <svg class="login-bg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>

    <div class="login-card">
      <h1 class="login-title">OBSERVECLAW</h1>

      <input type="password" v-model="password" class="login-input" placeholder="ENTER PASSWORD" @keyup.enter="login" />
      <button @click="login" class="login-button">CONNECT →</button>
      <p v-if="authError" class="login-error">{{ authError }}</p>
    </div>
  </div>

  <div v-else class="app-container">
    <header class="mobile-topbar">
      <div class="mobile-topbar-center">
        <div class="mobile-page-title">{{ currentPageTitle }}</div>
        <div v-if="pageStatusText" :class="pageStatusClass" class="mobile-status">● {{ pageStatusText }}</div>
      </div>
      <button class="mobile-menu-btn" @click="mobileMenuOpen = !mobileMenuOpen" aria-label="Open menu">☰</button>
    </header>

    <div v-if="mobileMenuOpen" class="mobile-overlay" @click="mobileMenuOpen = false"></div>

    <nav class="sidebar" :class="{ 'mobile-open': mobileMenuOpen }">
      <div class="brand-block">
        <svg class="brand-bg-icon" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="27" cy="27" r="16" />
          <line x1="39" y1="39" x2="55" y2="55" />
        </svg>
        <div class="brand-title oc-page-title">OBSERVECLAW</div>
      </div>
      <div class="sidebar-nav-wrap">
        <template v-for="group in navGroups" :key="group.label">
          <router-link
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="nav-link"
            active-class="active"
            :exact-active-class="item.exact ? 'active' : undefined"
            @click="mobileMenuOpen = false"
          >
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path v-for="(segment, idx) in item.icon" :key="`${item.to}-${idx}`" :d="segment" />
            </svg>
            <span class="nav-label">{{ item.label }}</span>
            <span class="nav-active-rail" aria-hidden="true"></span>
          </router-link>
        </template>
        <button class="nav-link nav-link-button" @click="relogin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="nav-icon" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
          <span class="nav-label">LOGOUT</span>
          <span class="nav-active-rail" aria-hidden="true"></span>
        </button>
      </div>
      <div v-if="sidebarMeta.hostname" class="nav-host-inline">
        <span class="nav-host-label">HOST</span>
        <span class="nav-host-value">{{ sidebarMeta.hostname }}</span>
      </div>
      <div v-if="sidebarMeta.observeclawVersion" class="nav-host-inline nav-version-meta-inline">
        <span class="nav-host-label">VERSION</span>
        <span class="nav-host-value">{{ sidebarMeta.observeclawVersion }}</span>
      </div>
      <div class="nav-version-inline">
        <span class="nav-version-text">{{ versionInfo?.current || sidebarMeta.openclawVersion || 'Unknown' }}</span>
        <span class="status-chip neutral nav-version-chip">{{ navVersionChipText }}</span>
      </div>
    </nav>

    <main class="main-content">
      <router-view></router-view>
    </main>

    <nav class="mobile-bottom-nav">
      <router-link to="/" class="mobile-tab" active-class="active" exact-active-class="active">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v7H4z"/><path d="M13 5h7v4h-7z"/><path d="M13 11h7v8h-7z"/><path d="M4 14h7v5H4z"/></svg>
        <small>Overview</small>
      </router-link>
      <router-link to="/activity" class="mobile-tab" active-class="active">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h4l2-6 4 12 2-6h6"/></svg>
        <small>Activity</small>
      </router-link>
      <router-link to="/alerts" class="mobile-tab" active-class="active">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 16H3zm0 6v5m0 3h.01"/></svg>
        <small>Alerts</small>
      </router-link>
      <router-link to="/agents" class="mobile-tab" active-class="active">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0"/></svg>
        <small>Agents</small>
      </router-link>
      <router-link to="/soul-memory" class="mobile-tab" active-class="active">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10a4 4 0 014 4v12H9a4 4 0 00-4 4z"/><path d="M9 4v16"/></svg>
        <small>Soul</small>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.main-content {
  min-height: 100%;
  height: auto;
  overflow-y: auto;
}

.login-page {
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
  background: #050508;
}

.login-bg-icon {
  position: absolute;
  width: min(120vh, 120vw);
  height: min(120vh, 120vw);
  color: #ff4040;
  opacity: 0.16;
  right: -8vw;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  filter: drop-shadow(0 0 18px rgba(255, 64, 64, 0.14));
}

.login-card {
  width: min(460px, calc(100vw - 32px));
  background: rgba(10, 10, 14, 0.82);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 36px 24px 24px;
  text-align: center;
  backdrop-filter: blur(12px);
  position: relative;
  z-index: 1;
}

.login-title {
  font-family: var(--font-mono);
  font-weight: 900;
  font-size: clamp(2.2rem, 7.5vw, 3.4rem);
  letter-spacing: -0.02em;
  line-height: 0.95;
  margin-bottom: 24px;
  background: linear-gradient(90deg, #ffe3e3 0%, #ff8a8a 45%, #ff2b2b 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.login-input {
  width: 100%;
  min-height: 48px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.03);
  color: var(--text-primary);
  padding: 0 14px;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  text-transform: uppercase;
}

.login-input:focus {
  outline: none;
  border-color: #ff2b2b;
  box-shadow: 0 0 0 2px rgba(255,43,43,0.18);
}

.login-button {
  width: 100%;
  margin-top: 12px;
  min-height: 48px;
  border-radius: 4px;
  border: 1px solid #ff2b2b;
  background: rgba(255,43,43,0.07);
  color: #ffd9d9;
  font-family: var(--font-mono);
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.login-button:hover {
  background: rgba(255,43,43,0.18);
}

.login-error {
  margin-top: 10px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: #ff6b6b;
}
.brand-block {
  position: relative;
  padding: 20px 16px;
  border-bottom: none;
  overflow: hidden;
  height: 64px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-bg-icon {
  position: absolute;
  left: -8px;
  top: -12px;
  width: 84px;
  height: 84px;
  opacity: 0.28;
}
.brand-bg-icon circle,
.brand-bg-icon line {
  fill: none;
  stroke: #ff4040;
  stroke-width: 4;
  stroke-linecap: round;
}
.brand-title {
  position: relative;
  z-index: 1;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
  line-height: 1;
  background: linear-gradient(90deg, #ffe3e3 0%, #ff8a8a 45%, #ff2b2b 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.sidebar-nav-wrap {
  flex: 1;
  min-height: 0;
  padding: 14px 12px 8px;
  font-family: var(--font-mono);
  overflow-y: auto;
  overflow-x: hidden;
}
.nav-host-inline {
  margin-top: auto;
  padding: 0 22px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.nav-host-label {
  color: rgba(245, 248, 255, 0.35);
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.nav-host-value {
  color: rgba(245, 248, 255, 0.62);
  font-size: 0.68rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}
.nav-version-meta-inline {
  padding-top: 0;
}
.nav-version-inline {
  margin-top: 0;
  padding: 8px 22px 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  flex-shrink: 0;
}
.nav-version-text {
  color: rgba(245, 248, 255, 0.62);
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.nav-version-chip {
  margin-left: 0;
  font-size: 0.58rem;
  line-height: 1;
  padding: 5px 8px;
  white-space: nowrap;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: rgba(245, 248, 255, 0.88);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}
.nav-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 3px;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  min-height: 46px;
  padding: 10px 14px 10px 14px;
  border-radius: 0;
  font-family: var(--font-sans);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
  background: transparent;
  transition: color 0.18s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}
.nav-link:hover {
  color: #ff4040;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
.nav-link-button {
  width: 100%;
  appearance: none;
  -webkit-appearance: none;
  text-align: left;
}
.nav-link.active {
  color: #f5f9ff;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
.nav-icon {
  width: 25px;
  height: 25px;
  flex: 0 0 auto;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.92;
}
.nav-label {
  flex: 1;
  min-width: 0;
}
.nav-active-rail {
  width: 4px;
  align-self: stretch;
  border-radius: 0;
  background: #f5f9ff;
  opacity: 0;
  transform: scaleY(0.4);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.nav-link:hover .nav-active-rail,
.nav-link.active .nav-active-rail {
  opacity: 1;
  transform: scaleY(1);
}
.nav-link:hover .nav-active-rail {
  background: #ff4040;
}
.nav-group-label {
  color: var(--text-muted);
  font-size: 0.66rem;
  letter-spacing: 0.16em;
  margin: 12px 0 6px;
  padding: 0 6px;
  font-weight: 800;
}
.nav-group-label:first-child {
  margin-top: 0;
}

@media (max-width: 1024px) and (min-width: 769px) {
  .sidebar {
    width: 96px;
  }
  .brand-block {
    min-height: 56px;
    padding: 14px 10px;
  }
  .brand-bg-icon {
    position: static;
    width: 40px;
    height: 40px;
    opacity: 0.35;
  }
  .brand-title {
    display: none;
  }
  .sidebar-nav-wrap {
    padding: 12px 8px 16px;
  }
  .nav-link {
    justify-content: center;
    min-height: 40px;
    font-size: 0.66rem;
    margin-bottom: 8px;
    padding: 10px;
  }
  .nav-label {
    display: none;
  }
  .nav-icon {
    width: 18px;
    height: 18px;
  }
  .nav-active-rail {
    display: none;
  }
}

.mobile-topbar {
  display: flex;
  position: fixed;
  top: 0;
  left: 250px;
  right: 0;
  height: 64px;
  z-index: 1200;
  background: linear-gradient(180deg, #0a0f18 0%, #090d14 100%);
  border-bottom: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
}
.mobile-overlay {
  display: none;
}
.mobile-bottom-nav {
  display: none;
}

.main-content {
  padding-top: 74px !important;
}

.mobile-topbar-center {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  flex: 1;
  gap: 2px;
}

.mobile-status {
  font-family: var(--font-sans);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
}

.mobile-menu-btn {
  min-height: 44px;
  min-width: 44px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: #f3fbff;
  border-radius: 4px;
  box-shadow: none;
  font-size: 1.45rem;
  font-weight: 700;
  line-height: 1;
  display: none;
  margin-left: auto;
  text-shadow: 0 0 10px rgba(142,223,255,0.35);
}
.mobile-page-title {
  font-family: var(--font-sans);
  font-weight: 900;
  font-size: 1.5rem;
  line-height: 1;
  color: #f5f8ff;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  text-align: left;
  max-width: 72vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1024px) and (min-width: 769px) {
  .mobile-topbar {
    left: 84px;
  }
}

@media (max-width: 768px) {
  .mobile-topbar {
    left: 0;
  }
  .mobile-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .mobile-bottom-nav {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 66px;
    background: rgba(13,16,20,0.98);
    border-top: 1px solid rgba(168,179,199,0.2);
    border-left: none;
    border-right: none;
    border-bottom: none;
    border-radius: 0;
    z-index: 1200;
    backdrop-filter: blur(10px);
    box-shadow: 0 -6px 18px rgba(0,0,0,0.32);
  }

  .mobile-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.72rem;
    min-height: 44px;
    gap: 4px;
    border-radius: 14px;
    margin: 4px;
  }
  .mobile-tab > svg {
    width: 20px;
    height: 20px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .mobile-tab > small {
    font-size: 0.66rem;
    line-height: 1;
    letter-spacing: 0.15px;
    font-weight: 700;
  }

  .mobile-tab.active {
    color: var(--accent-cyan);
    background: rgba(39, 213, 255, 0.16);
    border: 1px solid rgba(39, 213, 255, 0.34);
  }


  .mobile-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.45);
    z-index: 1000;
  }


}
</style>
