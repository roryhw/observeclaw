<template>
  <div class="app-container">
    <header class="activity-header" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
      <h1 class="oc-page-title">ACTIVITY</h1>
      <div class="activity-actions oc-toolbar" style="display:flex; gap:10px; align-items:center;">
        <span :class="pageStatusClass" style="font-family:var(--font-mono); font-size:0.78rem;">● {{ pageStatusText }}</span>
        <span class="oc-muted">
          {{ paused ? `FROZEN @ ${freezeTimeText}` : `LIVE AGE ${liveAgeSec}s` }}
        </span>
        <button class="pause-icon-btn" @click="togglePause" :aria-label="paused ? 'Resume stream' : 'Pause stream'" :title="paused ? 'Resume' : 'Pause'">
          <svg v-if="paused" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
        </button>
        <button class="neon-button mobile-only" @click="showFilters = !showFilters">{{ showFilters ? 'Hide Filters' : 'Filters' }}</button>
        <button class="neon-button reset-btn" @click="resetFilters">Reset Filters</button>
      </div>
    </header>

    <div class="activity-stats-row">
      <div class="a-stat"><strong>{{ stats.today }}</strong><span>TODAY</span></div>
      <div class="a-stat"><strong>{{ stats.message }}</strong><span>MSG</span></div>
      <div class="a-stat"><strong>{{ stats.file }}</strong><span>FILE</span></div>
      <div class="a-stat"><strong>{{ stats.web }}</strong><span>WEB</span></div>
      <div class="a-stat"><strong>{{ stats.system }}</strong><span>SYS</span></div>
    </div>

    <div v-if="pickerOpen" class="dd-backdrop" @click="closePicker"></div>

    <div class="oc-card filters-card" v-show="showFilters || !isMobile">
      <div class="activity-filters">
        <input v-model="query" class="neon-input" placeholder="Filter by type/summary/session..." />
        <div class="filter-inline">
          <button class="neon-input dd-btn" type="button" @click="openPicker('domain')">{{ isMobile ? 'D' : 'Domain' }}: {{ domainLabel }}</button>
          <button class="neon-input dd-btn" type="button" @click="openPicker('severity')">{{ isMobile ? 'S' : 'Severity' }}: {{ severityLabel }}</button>
          <button class="neon-input dd-btn" type="button" @click="openPicker('type')">{{ isMobile ? 'T' : 'Type' }}: {{ typeLabel }}</button>
          <button class="neon-input dd-btn" type="button" :class="{ 'neon-active': includeInferred }" @click="includeInferred = !includeInferred">
            {{ isMobile ? 'INF' : 'Inferred' }}: {{ includeInferred ? 'ON' : 'OFF' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="pickerOpen" class="picker-sheet" @click.stop>
      <div class="picker-title">{{ pickerType === 'domain' ? 'Select Domains' : (pickerType === 'severity' ? 'Select Severity' : 'Select Types') }}</div>
      <div class="picker-options">
        <label class="picker-option">
          <input type="checkbox" :checked="pickerSelection.length===0" @change="pickerSelectAll" />
          <span>ALL</span>
        </label>
        <label v-for="opt in pickerOptions" :key="opt" class="picker-option">
          <input type="checkbox" :checked="pickerSelection.includes(opt)" @change="pickerToggle(opt)" />
          <span>{{ opt.toUpperCase() }}</span>
        </label>
      </div>
      <div class="picker-actions">
        <button class="neon-button" @click="closePicker">Cancel</button>
        <button class="neon-button" @click="applyPicker">Apply</button>
      </div>
    </div>

    <div class="timeline-flat" style="display: block;">
      <div class="timeline-topbar">
        <span class="text-secondary" style="font-family:var(--font-mono); font-size:0.72rem;">{{ paused ? `FROZEN @ ${freezeTimeText}` : `LIVE AGE ${liveAgeSec}s` }}</span>
        <button class="pause-icon-btn" @click="togglePause" :aria-label="paused ? 'Resume stream' : 'Pause stream'" :title="paused ? 'Resume' : 'Pause'">
          <svg v-if="paused" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
        </button>
      </div>
      <div class="timeline-body">
        <div class="timeline-rail"></div>

        <div v-for="evt in visibleEvents" :key="evt.id" class="tl-item" :class="`cat-${inferCategory(evt)}`" :style="{ background: pinnedId===evt.id ? 'rgba(210,77,255,0.08)' : '' }">
          <div class="tl-dot"></div>

          <div class="tl-left" @click="toggleExpanded(evt.id)">
            <div class="tl-row">
              <span class="tl-title">{{ evt.summary || evt.type }}</span>
            </div>
            <div class="tl-tags">
              <span class="tl-tag">{{ evt.agentId ? evt.agentId.toUpperCase() : 'SYS' }}</span>
              <span class="tl-tag" v-if="evt.channel">{{ evt.channel }}</span>
              <span class="tl-event-type">{{ evt.type }}</span>
            </div>
          </div>

          <div class="tl-mid" v-if="!isMobile">
            <div class="tl-raw">{{ rawDataPreview(evt.data) }}</div>
          </div>

          <div class="tl-right">
            <span class="tl-time">{{ formatTime(evt.timestamp) }}</span>
            <div class="tl-icon-actions">
              <button class="expand-icon-btn" :class="{ active: expandedId===evt.id }" @click.stop="toggleExpanded(evt.id)" :aria-label="expandedId===evt.id ? 'Collapse event details' : 'Expand event details'" :title="expandedId===evt.id ? 'Collapse' : 'Expand'">
                <svg v-if="expandedId===evt.id" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5z"/></svg>
                <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>
              </button>
              <button class="pin-icon-btn" :class="{ active: pinnedId===evt.id }" @click.stop="togglePin(evt.id)" :aria-label="pinnedId===evt.id ? 'Unpin event' : 'Pin event'" :title="pinnedId===evt.id ? 'Unpin' : 'Pin'">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 3h8l-1.5 5 3 3v1H13v7l-1 2-1-2v-7H6.5v-1l3-3L8 3z"/>
                </svg>
              </button>
            </div>
          </div>

          <div v-if="expandedId === evt.id" class="activity-details">
            <pre>{{ sanitizeData(evt.data) }}</pre>
          </div>
        </div>

        <div v-if="filteredEvents.length === 0" class="timeline-empty">No events match current filters.</div>
        <div ref="scrollSentinel" style="height: 1px;"></div>
        <div v-if="historyLoading" class="timeline-empty" style="margin-top:8px;">Loading older events...</div>
        <div v-else-if="historyDone && attemptedOlderLoad" class="timeline-empty" style="margin-top:8px;">No older events.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

const events = inject('events') as Ref<any[]>
const loadOlderEvents = inject('loadOlderEvents') as ((opts?: { before?: string; domain?: string }) => Promise<void>)
const historyLoading = inject('historyLoading') as Ref<boolean>
const historyDone = inject('historyDone') as Ref<boolean>
const pageStatusText = inject('pageStatusText') as Ref<string>
const pageStatusClass = inject('pageStatusClass') as Ref<string>
const query = ref(localStorage.getItem('oc.activity.query') || '')
const debouncedQuery = ref(query.value)
const parseMulti = (key: string, fallback: string[]) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback

    // Back-compat: legacy storage could be
    // - single value: "tool"
    // - CSV string: "agent,tool,channel"
    if (!raw.trim().startsWith('[')) {
      const normalized = raw
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)

      if (!normalized.length || normalized.includes('all')) return []
      return Array.from(new Set(normalized))
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return fallback
    const clean = parsed.map((x: any) => String(x).toLowerCase().trim()).filter(Boolean)
    return clean.includes('all') ? [] : Array.from(new Set(clean))
  } catch {
    return fallback
  }
}

const domainFilter = ref<string[]>(parseMulti('oc.activity.domain', ['agent','tool','channel','session','access','network']))
const severityFilter = ref<string[]>(parseMulti('oc.activity.severity', []))
const typeFilter = ref<string[]>(parseMulti('oc.activity.type', []))
const includeInferred = ref(localStorage.getItem('oc.activity.includeInferred') === '1')

if (!localStorage.getItem('oc.activity.domain')) {
  localStorage.setItem('oc.activity.domain', JSON.stringify(['agent','tool','channel','session','access','network']))
}
if (!localStorage.getItem('oc.activity.severity')) {
  localStorage.setItem('oc.activity.severity', JSON.stringify([]))
}
if (!localStorage.getItem('oc.activity.type')) {
  localStorage.setItem('oc.activity.type', JSON.stringify([]))
}
const showFilters = ref(localStorage.getItem('oc.activity.showFilters') !== '0')
const isMobile = ref(window.innerWidth <= 768)
const expandedId = ref<string | null>(null)
const domainOptions = ['agent','tool','channel','session','access','system','network']
const severityOptions = ['info','warning','error']
const typeOptions = computed(() => Array.from(new Set((events.value || []).map((e: any) => String(e?.type || '').trim().toLowerCase()).filter(Boolean))).sort())
const pickerType = ref<'domain'|'severity'|'type'>('domain')
const pickerOpen = ref(false)
const pickerSelection = ref<string[]>([])
const pinnedId = ref<string | null>(null)
const paused = ref(false)
const pausedSnapshot = ref<any[]>([])
const freezeTime = ref<number | null>(null)
const nowTs = ref(Date.now())

const toggleExpanded = (id: string) => {
  expandedId.value = expandedId.value === id ? null : id
}

const togglePin = (id: string) => {
  pinnedId.value = pinnedId.value === id ? null : id
}

const togglePause = () => {
  paused.value = !paused.value
  if (paused.value) {
    freezeTime.value = Date.now()
  } else {
    freezeTime.value = null
  }
}

const resetFilters = () => {
  query.value = ''
  debouncedQuery.value = ''
  domainFilter.value = []
  severityFilter.value = []
  typeFilter.value = []
  includeInferred.value = false
  pinnedId.value = null
  expandedId.value = null
  paused.value = false
  pausedSnapshot.value = []
  freezeTime.value = null
}

const openPicker = (type: 'domain'|'severity'|'type') => {
  pickerType.value = type
  pickerSelection.value = [...(type === 'domain' ? domainFilter.value : (type === 'severity' ? severityFilter.value : typeFilter.value))]
  pickerOpen.value = true
}
const closePicker = () => { pickerOpen.value = false }
const pickerToggle = (v: string) => {
  if (pickerSelection.value.includes(v)) pickerSelection.value = pickerSelection.value.filter(x => x !== v)
  else pickerSelection.value = [...pickerSelection.value, v]
}
const pickerSelectAll = () => { pickerSelection.value = [] }
const applyPicker = () => {
  if (pickerType.value === 'domain') domainFilter.value = [...pickerSelection.value]
  else if (pickerType.value === 'severity') severityFilter.value = [...pickerSelection.value]
  else typeFilter.value = [...pickerSelection.value]
  pickerOpen.value = false
}

const pickerOptions = computed(() => {
  if (pickerType.value === 'domain') return domainOptions
  if (pickerType.value === 'severity') return severityOptions
  return typeOptions.value
})
const compactLabel = (values: string[]) => {
  if (!values.length) return 'ALL'
  const joined = values.map(v => v.toUpperCase()).join(', ')
  return joined.length > 22 ? `${values.length} selected` : joined
}
const domainLabel = computed(() => compactLabel(domainFilter.value))
const severityLabel = computed(() => compactLabel(severityFilter.value))
const typeLabel = computed(() => compactLabel(typeFilter.value))

const sourceEvents = computed(() => {
  if (paused.value) {
    if (pausedSnapshot.value.length === 0) pausedSnapshot.value = [...events.value]
    return pausedSnapshot.value
  }
  pausedSnapshot.value = []
  return events.value
})

const liveAgeSec = computed(() => {
  const top = events.value[0]
  if (!top?.timestamp) return 0
  return Math.max(0, Math.floor((nowTs.value - new Date(top.timestamp).getTime()) / 1000))
})

const freezeTimeText = computed(() => {
  if (!freezeTime.value) return '--:--:--'
  return new Date(freezeTime.value).toLocaleTimeString([], { hour12: false })
})

const inferDomain = (evt: any) => {
  const type = String(evt?.type || '').toLowerCase()
  const domain = String(evt?.domain || '').toLowerCase().trim()
  let tool = ''
  try {
    const d = typeof evt?.data === 'string' ? JSON.parse(evt.data) : evt?.data
    tool = String(d?.tool || '').toLowerCase()
  } catch {}

  // Canonical mapping aligned to filter options
  if (type.startsWith('tool.') || !!tool) return 'tool'
  if (domain === 'network' || type.startsWith('network.')) return 'network'
  if (domain === 'channel' || type.startsWith('message.') || type === 'webhook.received') return 'channel'
  if (domain === 'session' || type.startsWith('session.')) return 'session'
  if (domain === 'access' || type.startsWith('access.')) return 'access'
  if (domain === 'system' || type.startsWith('system.')) return 'system'
  if (domain === 'agent' || type.startsWith('agent.')) return 'agent'

  // fallback to prefix when possible
  const m = type.match(/^([a-z_]+)\./)
  return m?.[1] || domain || ''
}

const inferSeverity = (evt: any) => String(evt?.severity || 'info').toLowerCase().trim()

const isInferredEvent = (evt: any) => {
  const evtType = String(evt?.type || '').toLowerCase().trim()
  const summary = String(evt?.summary || '').toLowerCase()

  // Pulse transitions are synthesized by ObserveClaw's pulse engine.
  if (evtType === 'pulse.update' || evtType === 'pulse.snapshot') return true

  try {
    const d = typeof evt?.data === 'string' ? JSON.parse(evt.data) : evt?.data
    if (d?.inferred) return true
  } catch {}

  return summary.includes('inferred')
}

const filteredEvents = computed(() => {
  let base = sourceEvents.value
  if (pinnedId.value) {
    const pinnedSession = base.find((x: any) => x.id === pinnedId.value)?.sessionKey
    base = base.filter((e: any) => e.id === pinnedId.value || (pinnedSession && e.sessionKey === pinnedSession))
  }
    return base.filter((evt: any) => {
      const evtDomain = inferDomain(evt)
      const evtSeverity = inferSeverity(evt)
      const evtType = String(evt?.type || '').toLowerCase().trim()

      if (!includeInferred.value && isInferredEvent(evt)) return false

      if (domainFilter.value.length > 0 && !domainFilter.value.includes(evtDomain)) return false
    if (severityFilter.value.length > 0 && !severityFilter.value.includes(evtSeverity)) return false
    if (typeFilter.value.length > 0 && !typeFilter.value.includes(evtType)) return false
    if (debouncedQuery.value.trim()) {
      const q = debouncedQuery.value.toLowerCase()
      const hit = `${evt.type} ${evt.summary} ${evt.sessionKey || ''} ${evtDomain}`.toLowerCase().includes(q)
      if (!hit) return false
    }
    return true
  })
})

const INITIAL_VISIBLE = 100
const visibleCount = ref(INITIAL_VISIBLE)
const visibleEvents = computed(() => filteredEvents.value.slice(0, visibleCount.value))
const scrollSentinel = ref<HTMLElement | null>(null)
const attemptedOlderLoad = ref(false)
const backfillInProgress = ref(false)

const inferCategory = (evt: any) => {
  const type = String(evt?.type || '').toLowerCase()
  const d = String(evt?.domain || '').toLowerCase()
  let tool = ''
  try { const dd = typeof evt?.data === 'string' ? JSON.parse(evt.data) : evt?.data; tool = String(dd?.tool || '').toLowerCase() } catch {}
  if (type.startsWith('message.') || type === 'webhook.received' || d === 'channel') return 'message'
  if (/read|write|edit/.test(tool)) return 'file'
  if (/web|fetch|browser/.test(tool)) return 'web'
  return 'system'
}

const stats = computed(() => {
  const today = new Date().toDateString()
  const list = sourceEvents.value.filter((e: any) => {
    try { return new Date(e.timestamp).toDateString() === today } catch { return false }
  })
  const by = (c: string) => list.filter((e: any) => inferCategory(e) === c).length
  return { today: list.length, message: by('message'), file: by('file'), web: by('web'), system: by('system') }
})

const loadOlderForCurrentFilter = async () => {
  const oldestFiltered = filteredEvents.value[filteredEvents.value.length - 1]
  await loadOlderEvents({
    before: oldestFiltered?.timestamp,
    domain: domainFilter.value.length === 1 ? domainFilter.value[0] : undefined
  })
}

const ensureMoreVisible = async () => {
  const step = 80
  if (visibleCount.value < filteredEvents.value.length) {
    visibleCount.value = Math.min(filteredEvents.value.length, visibleCount.value + step)
    return
  }
  attemptedOlderLoad.value = true
  if (!historyLoading.value && !historyDone.value) {
    await loadOlderForCurrentFilter()
    visibleCount.value = Math.min(filteredEvents.value.length, visibleCount.value + step)
  }
}

const backfillForCurrentFilters = async () => {
  if (backfillInProgress.value) return
  if (filteredEvents.value.length > 0) return
  if (!sourceEvents.value.length) return
  if (historyDone.value || historyLoading.value) return

  backfillInProgress.value = true
  try {
    let tries = 0
    while (filteredEvents.value.length === 0 && !historyDone.value && tries < 4) {
      attemptedOlderLoad.value = true
      await loadOlderForCurrentFilter()
      tries += 1
    }
    visibleCount.value = INITIAL_VISIBLE
  } finally {
    backfillInProgress.value = false
  }
}

const formatTime = (isoString: string) => {
  if (!isoString) return ''
  const d = new Date(isoString)
  return d.toLocaleTimeString([], { hour12: false })
}

const sanitizeData = (dataStr: string) => {
  try {
    const obj = JSON.parse(dataStr);
    // basic redaction for display
    if(obj.apiKey) obj.apiKey = '***REDACTED***';
    if(obj.token) obj.token = '***REDACTED***';
    return JSON.stringify(obj, null, 2);
  } catch(e) {
    return dataStr;
  }
}

const rawDataPreview = (dataStr: any) => {
  if (!dataStr) return ''
  const raw = typeof dataStr === 'string' ? dataStr : JSON.stringify(dataStr)
  const normalized = raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  const max = isMobile.value ? 0 : (window.innerWidth <= 1024 ? 360 : 520)
  if (!max) return ''
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

let tick: any = null
let debounceTimer: any = null
let resizeHandler: any = null
let observer: IntersectionObserver | null = null
onMounted(() => {
  tick = setInterval(() => (nowTs.value = Date.now()), 1000)
  resizeHandler = () => {
    isMobile.value = window.innerWidth <= 768
    if (!isMobile.value) showFilters.value = true
  }
  window.addEventListener('resize', resizeHandler)
  observer = new IntersectionObserver(async (entries) => {
    if (entries.some(e => e.isIntersecting)) {
      await ensureMoreVisible()
    }
  }, { root: null, rootMargin: '600px 0px 600px 0px', threshold: 0.01 })

  if (scrollSentinel.value) observer.observe(scrollSentinel.value)
})

watch(query, (v) => {
  localStorage.setItem('oc.activity.query', v)
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedQuery.value = v
  }, 180)
})
watch(domainFilter, (v) => {
  localStorage.setItem('oc.activity.domain', JSON.stringify(v))
  // avoid stale pinned contexts hiding results when switching domains
  pinnedId.value = null
}, { deep: true })
watch(severityFilter, (v) => localStorage.setItem('oc.activity.severity', JSON.stringify(v)), { deep: true })
watch(typeFilter, (v) => localStorage.setItem('oc.activity.type', JSON.stringify(v)), { deep: true })
watch(includeInferred, (v) => localStorage.setItem('oc.activity.includeInferred', v ? '1' : '0'))
watch(showFilters, (v) => localStorage.setItem('oc.activity.showFilters', v ? '1' : '0'))

watch([domainFilter, severityFilter, typeFilter, debouncedQuery, pinnedId, includeInferred], () => {
  visibleCount.value = INITIAL_VISIBLE
  attemptedOlderLoad.value = false
  setTimeout(() => { backfillForCurrentFilters() }, 0)
}, { deep: true })

watch(() => sourceEvents.value.length, () => {
  setTimeout(() => { backfillForCurrentFilters() }, 0)
})

onUnmounted(() => {
  if (tick) clearInterval(tick)
  if (debounceTimer) clearTimeout(debounceTimer)
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
  if (observer) observer.disconnect()
})
</script>

<style scoped>
.app-container {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.timeline-flat {
  position: relative;
}
.timeline-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.timeline-body {
  position: relative;
  background: transparent;
  border: none;
  border-radius: 0;
  overflow: visible;
  padding: 6px 0 6px 22px;
  min-height: 0;
}
.timeline-rail {
  position: absolute;
  left: 14px;
  top: 10px;
  bottom: 10px;
  width: 2px;
  background: rgba(39,213,255,0.22);
}
.tl-item {
  position: relative;
  display: grid;
  grid-template-columns: minmax(180px, 250px) minmax(260px, 1fr) 104px;
  gap: 10px;
  margin-bottom: 6px;
  padding: 8px 8px 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
}
.tl-item:nth-child(odd) {
  background: rgba(39, 213, 255, 0.085);
}
.tl-item:nth-child(even) {
  background: rgba(255, 255, 255, 0.035);
}
.tl-dot {
  position: absolute;
  left: -18px;
  top: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.5);
  background: #0f1218;
}
.tl-item.cat-message .tl-dot { border-color: var(--accent-cyan); }
.tl-item.cat-file .tl-dot { border-color: #a78bfa; }
.tl-item.cat-web .tl-dot { border-color: #60a5fa; }
.tl-item.cat-system .tl-dot { border-color: var(--accent-green); }

.tl-left { cursor: pointer; min-width: 0; max-width: 250px; }
.tl-row { display:flex; gap:8px; }
.tl-title {
  font-weight:700;
  font-size:0.84rem;
  color:#eef7ff;
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
  line-height: 1.2;
}
.tl-tags { display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; align-items:center; }
.tl-tag { font-size:0.62rem; font-family:var(--font-mono); border:1px solid rgba(255,255,255,0.12); border-radius:4px; padding:1px 5px; color:#b8c4d6; }
.tl-event-type {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl-mid {
  min-width: 0;
  display: flex;
  align-items: center;
  padding-left: 8px;
  border-left: 1px solid rgba(255,255,255,0.08);
}
.tl-raw {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  line-height: 1.22;
  color: rgba(188, 205, 224, 0.85);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.tl-right {
  width: 104px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-start;
  gap: 6px;
}
.tl-icon-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tl-time { font-family:var(--font-mono); font-size:0.68rem; color:var(--text-secondary); }
.expand-icon-btn,
.pin-icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  min-height: 24px;
  border: none;
  background: transparent;
  color: rgba(184, 196, 214, 0.85);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.expand-icon-btn svg,
.pin-icon-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}
.expand-icon-btn:hover,
.pin-icon-btn:hover {
  color: rgba(142, 223, 255, 0.95);
}
.expand-icon-btn.active,
.pin-icon-btn.active {
  color: var(--accent-cyan);
}
.pause-icon-btn {
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(184, 196, 214, 0.9);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.pause-icon-btn svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
}
.pause-icon-btn:hover {
  color: rgba(142, 223, 255, 0.98);
}
.activity-details {
  grid-column: 1 / -1;
  font-size: 0.78em;
  color: var(--text-muted);
}
.activity-details pre {
  white-space: pre-wrap;
  font-family: var(--font-mono);
  margin: 0;
}
.timeline-empty {
  text-align: center;
  margin-top: 24px;
  color: var(--text-secondary);
}
.activity-details {
  margin-left: 0;
  margin-top: 6px;
  padding: 8px;
  border: 1px solid rgba(255,255,255,0.08);
}

.mobile-only { display: none; }

.activity-stats-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0,1fr));
  gap: 6px;
  margin-bottom: 10px;
}
.a-stat {
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  padding: 5px;
  text-align: center;
  font-family: var(--font-mono);
}
.a-stat strong { display:block; font-size: 0.85rem; color:#dff7ff; }
.a-stat span { font-size:0.58rem; color: var(--text-secondary); }

.filters-card {
  margin-bottom: 10px !important;
  padding: 10px !important;
}

.activity-filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  gap: 6px;
  align-items: center;
}

.filter-inline {
  display: inline-grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.dd-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.32);
  z-index: 2500;
}
.dd-btn {
  width: 100%;
  text-align: left;
  min-height: 34px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.neon-active {
  border-color: var(--accent-cyan) !important;
  box-shadow: 0 0 8px rgba(39, 213, 255, 0.4);
  color: var(--accent-cyan) !important;
}
.picker-sheet {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 78px;
  z-index: 3001;
  border: 1px solid rgba(168,179,199,0.42);
  background: #0d1118;
  border-radius: 8px;
  box-shadow: 0 18px 36px rgba(0,0,0,0.55);
  padding: 10px;
}
.picker-title {
  font-family: var(--font-sans);
  font-size: 0.84rem;
  font-weight: 800;
  margin-bottom: 8px;
  color: #eaf5ff;
}
.picker-options {
  max-height: 44vh;
  overflow-y: auto;
  display: grid;
  gap: 6px;
}
.picker-option {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(168,179,199,0.18);
  background: rgba(255,255,255,0.02);
  border-radius: 3px;
  padding: 8px;
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: #dce8f8;
}
.picker-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.activity-filters .neon-input {
  min-height: 30px;
  height: 30px;
  font-size: 11px;
  padding: 3px 8px;
}

@media (max-width: 768px) {
  .mobile-only { display: inline-flex; }
  .activity-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 10px !important;
  }
  .activity-actions {
    width: 100%;
    display: grid !important;
    grid-template-columns: 1fr auto auto;
    gap: 6px;
    align-items: center;
  }
  .reset-btn { display: none; }
  .pause-icon-btn {
    width: 22px;
    height: 22px;
    min-height: 22px;
  }
  .pause-icon-btn svg {
    width: 14px;
    height: 14px;
  }

  .activity-stats-row {
    grid-template-columns: repeat(5, minmax(0,1fr));
    gap: 4px;
    margin-bottom: 8px;
  }
  .a-stat { padding: 3px; border-radius: 6px; }
  .a-stat strong { font-size: 0.68rem; }
  .a-stat span { font-size: 0.48rem; }

  .filters-card {
    padding: 8px !important;
    margin-bottom: 8px !important;
  }
  .activity-filters {
    grid-template-columns: 1fr !important;
    gap: 6px;
  }
  .filter-inline {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
  }
  .dd-btn {
    min-height: 32px;
    font-size: 0.66rem;
    padding: 6px 8px;
  }

  .timeline-body {
    min-height: 0;
    height: auto;
    padding: 6px 0 6px 20px;
  }
  .timeline-rail { left: 10px; }

  .tl-item {
    grid-template-columns: 1fr 86px;
    gap: 6px;
    margin-bottom: 8px;
    padding: 5px 0;
  }
  .tl-mid { display: none; }
  .tl-right {
    width: 86px;
    gap: 4px;
  }
  .tl-dot {
    left: -14px;
    top: 8px;
    width: 7px;
    height: 7px;
  }
  .tl-title {
    font-size: 0.78rem;
    line-height: 1.2;
  }
  .tl-time { font-size: 0.62rem; }
  .tl-detail { font-size: 0.66rem; }
  .tl-tags {
    margin-top: 3px;
    gap: 4px;
  }
  .tl-tag {
    font-size: 0.58rem;
    padding: 1px 4px;
  }
  .expand-icon-btn,
  .pin-icon-btn {
    width: 22px;
    height: 22px;
    min-height: 22px;
  }
  .expand-icon-btn svg,
  .pin-icon-btn svg {
    width: 14px;
    height: 14px;
  }
}
</style>