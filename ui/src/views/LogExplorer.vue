<template>
  <div class="app-container">
    <div class="picker-bar">
      <header class="log-header">
        <div class="meta">{{ total.toLocaleString() }} rows • page {{ page }}</div>
      </header>

      <div class="oc-card controls">
        <div class="row compact favorites-top-row">
          <button class="neon-button fav-btn" @click="saveFavorite">Save current</button>
          <button class="neon-button fav-btn" v-for="f in favorites" :key="f.id" @click="applyFavorite(f)">{{ f.name }}<span v-if="f.isDefault"> ★</span></button>
        </div>

        <div class="row compact">
          <button class="neon-button" @click="setRange(1)">1D</button>
          <button class="neon-button" @click="setRange(7)">7D</button>
          <button class="neon-button" @click="setRange(30)">30D</button>
          <button class="neon-button" @click="setRange(90)">90D</button>

          <div class="date-mini start">
            <input class="neon-input" type="date" v-model="fromDate" @focus="openNativePicker($event)" @click="openNativePicker($event)" />
          </div>
          <div class="date-mini end">
            <input class="neon-input" type="date" v-model="toDate" @focus="openNativePicker($event)" @click="openNativePicker($event)" />
          </div>

          <input class="neon-input search" placeholder="Search summary/type/data..." v-model="q" @keyup.enter="apply" />
          <label class="deep-toggle"><input type="checkbox" v-model="qExclude" /> Exclude</label>

          <button class="neon-button" @click="apply">Apply</button>
          <button class="neon-button" @click="clearAll">Clear</button>

          <div class="export-menu-wrap">
            <button class="neon-button" @click="showExport = !showExport">Export ▾</button>
            <div v-if="showExport" class="export-menu">
              <button class="neon-button" @click="exportCsv('page'); showExport=false">Export Page CSV</button>
              <button class="neon-button" @click="exportCsv('full'); showExport=false">Export Filtered CSV</button>
            </div>
          </div>

          <button class="neon-button" @click="refreshSinceLastQuery">Refresh</button>
          <div class="result-badge">{{ lastQueryAt ? `last query ${lastQueryAt}` : 'not queried' }}</div>
        </div>

        <div class="advanced-grid">
          <select class="neon-input" v-model="domain"><option value="">All Domain</option><option v-for="v in facets.domains" :key="`d-${v}`" :value="v">{{ v }}</option></select>
          <select class="neon-input" v-model="type"><option value="">All Type</option><option v-for="v in facets.types" :key="`t-${v}`" :value="v">{{ v }}</option></select>
          <select class="neon-input" v-model="severity"><option value="">All Severity</option><option v-for="v in facets.severities" :key="`s-${v}`" :value="v">{{ v }}</option></select>
          <select class="neon-input" v-model="agentId"><option value="">All Agent</option><option v-for="v in facets.agents" :key="`a-${v}`" :value="v">{{ v }}</option></select>
          <select class="neon-input" v-model="sessionKey"><option value="">All Session</option><option v-for="v in facets.sessions" :key="`k-${v}`" :value="v">{{ v }}</option></select>
          <select class="neon-input" v-model="channel"><option value="">All Channel</option><option v-for="v in facets.channels" :key="`c-${v}`" :value="v">{{ v }}</option></select>
          <label class="deep-toggle"><input type="checkbox" v-model="deep" /> Deep search</label>
        </div>

        <div class="chips" v-if="activeChips.length">
          <button class="chip" v-for="c in activeChips" :key="c.key" @click="removeChip(c.key)">{{ c.label }} ×</button>
        </div>
      </div>
    </div>

    <div class="oc-card table-wrap">
      <table class="log-table">
        <thead>
          <tr>
            <th class="sortable" @click="toggleSort('timestamp')">Timestamp <span class="sort-indicator">{{ sortIndicator('timestamp') }}</span></th>
            <th class="sortable" @click="toggleSort('domain')">Domain <span class="sort-indicator">{{ sortIndicator('domain') }}</span></th>
            <th class="sortable" @click="toggleSort('type')">Type <span class="sort-indicator">{{ sortIndicator('type') }}</span></th>
            <th class="sortable" @click="toggleSort('severity')">Severity <span class="sort-indicator">{{ sortIndicator('severity') }}</span></th>
            <th class="sortable" @click="toggleSort('summary')">Summary <span class="sort-indicator">{{ sortIndicator('summary') }}</span></th>
            <th class="sortable" @click="toggleSort('agentId')">Agent <span class="sort-indicator">{{ sortIndicator('agentId') }}</span></th>
            <th class="sortable" @click="toggleSort('sessionKey')">Session <span class="sort-indicator">{{ sortIndicator('sessionKey') }}</span></th>
            <th class="sortable" @click="toggleSort('channel')">Channel <span class="sort-indicator">{{ sortIndicator('channel') }}</span></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in sortedRows" :key="r.id" @click="openRow(r)">
            <td>{{ fmt(r.timestamp) }}</td>
            <td>{{ r.domain }}</td>
            <td>{{ r.type }}</td>
            <td><span class="sev" :class="r.severity">{{ r.severity }}</span></td>
            <td>{{ displaySummary(r) }}</td>
            <td>{{ r.agentId || '—' }}</td>
            <td>{{ r.sessionKey || '—' }}</td>
            <td>{{ r.channel || '—' }}</td>
            <td><button class="neon-button" @click.stop="openRow(r)">View</button></td>
          </tr>
        </tbody>
      </table>

      <div class="pager">
        <div>
          Rows per page:
          <select class="neon-input" v-model.number="pageSize" @change="apply">
            <option :value="100">100</option>
            <option :value="250">250</option>
            <option :value="500">500</option>
            <option :value="1000">1000</option>
          </select>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="neon-button" :disabled="page<=1" @click="page--; fetchRows()">Prev</button>
          <span class="meta">{{ page }}</span>
          <button class="neon-button" :disabled="page*pageSize>=total" @click="page++; fetchRows()">Next</button>
        </div>
      </div>
    </div>

    <div v-if="selected" class="modal-backdrop" @click="selected=null"></div>
    <div v-if="selected" class="modal" @click.stop>
      <div class="modal-head">
        <h3 class="text-cyan">LOG ENTRY DETAIL</h3>
        <button class="neon-button" @click="selected=null">Close</button>
      </div>
      <pre class="json">{{ prettySelected }}</pre>
      <div class="modal-actions">
        <button class="neon-button" @click="copySelected">Copy JSON</button>
        <button class="neon-button" v-if="selected.rawEventId" @click="loadRaw">Load Raw Payload</button>
      </div>
      <pre class="json" v-if="rawPayload">{{ rawPayload }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { Ref } from 'vue'

const route = useRoute()
const authPassword = inject('authPassword') as Ref<string>

const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(100)
const fromDate = ref('')
const toDate = ref('')
const domain = ref('')
const type = ref('')
const severity = ref('')
const agentId = ref('')
const sessionKey = ref('')
const channel = ref('')
const q = ref('')
const qExclude = ref(false)
const deep = ref(false)
const selected = ref<any>(null)
const rawPayload = ref('')
const showExport = ref(false)
const lastQueryAt = ref('')
const sortKey = ref<'timestamp'|'domain'|'type'|'severity'|'summary'|'agentId'|'sessionKey'|'channel'>('timestamp')
const sortDir = ref<'asc'|'desc'>('desc')
const favorites = ref<any[]>([])

const facets = ref<any>({ domains: [], types: [], severities: [], agents: [], sessions: [], channels: [] })

const fmt = (t: string) => t ? new Date(t).toLocaleString() : '—'

const displaySummary = (r: any) => {
  const base = String(r?.summary || r?.type || 'event')
  if (r?.domain !== 'network') return base
  try {
    const d = typeof r?.data === 'string' ? JSON.parse(r.data || '{}') : (r?.data || {})
    const dir = String(d?.direction || '').toLowerCase()
    const host = d?.host || d?.remoteHost
    const port = d?.port || d?.remotePort
    const reason = d?.excludeReason

    const bits: string[] = []
    if (dir) bits.push(dir)
    if (host) bits.push(`${host}${port ? `:${port}` : ''}`)
    if (reason) bits.push(`excluded:${reason}`)
    return bits.length ? `${base} [${bits.join(' · ')}]` : base
  } catch {
    return base
  }
}
const isoDate = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10)

const setRange = (days: number) => {
  const end = new Date()
  const start = new Date(Date.now() - days*24*60*60*1000)
  fromDate.value = isoDate(start)
  toDate.value = isoDate(end)
  apply()
}

const params = () => {
  const p = new URLSearchParams()
  if (fromDate.value) p.set('from', new Date(`${fromDate.value}T00:00:00`).toISOString())
  if (toDate.value) p.set('to', new Date(`${toDate.value}T23:59:59`).toISOString())
  if (domain.value) p.set('domain', domain.value)
  if (type.value) p.set('type', type.value)
  if (severity.value) p.set('severity', severity.value)
  if (agentId.value) p.set('agentId', agentId.value)
  if (sessionKey.value) p.set('sessionKey', sessionKey.value)
  if (channel.value) p.set('channel', channel.value)
  if (q.value.trim()) p.set('q', q.value.trim())
  if (qExclude.value) p.set('qExclude', '1')
  if (deep.value) p.set('deep', '1')
  p.set('page', String(page.value))
  p.set('pageSize', String(pageSize.value))
  return p
}

const fetchRows = async () => {
  const res = await fetch(`/api/log-explorer?${params().toString()}`, { headers: { 'x-observeclaw-password': authPassword.value || '' } })
  if (!res.ok) return
  const j = await res.json()
  rows.value = j.data || []
  total.value = Number(j.total || 0)
  lastQueryAt.value = new Date().toLocaleTimeString()
}

const fetchFacets = async () => {
  const res = await fetch('/api/log-explorer/facets', { headers: { 'x-observeclaw-password': authPassword.value || '' } })
  if (!res.ok) return
  const j = await res.json()
  facets.value = j.data || facets.value
}

const apply = () => { page.value = 1; fetchRows() }
const refreshSinceLastQuery = () => { page.value = 1; fetchRows() }
const clearAll = () => { fromDate.value='';toDate.value='';domain.value='';type.value='';severity.value='';agentId.value='';sessionKey.value='';channel.value='';q.value='';qExclude.value=false;deep.value=false; apply() }
const exportCsv = (mode: 'page'|'full') => {
  const p = params(); p.set('mode', mode)
  window.open(`/api/log-explorer/export.csv?${p.toString()}`, '_blank')
}

const openRow = (r: any) => { selected.value = r; rawPayload.value = '' }
const prettySelected = computed(() => selected.value ? JSON.stringify(selected.value, null, 2) : '')
const copySelected = async () => { if (!selected.value) return; await navigator.clipboard.writeText(prettySelected.value) }
const loadRaw = async () => {
  if (!selected.value?.rawEventId) return
  const res = await fetch(`/api/log-explorer/raw/${encodeURIComponent(selected.value.rawEventId)}`, { headers: { 'x-observeclaw-password': authPassword.value || '' } })
  if (!res.ok) return
  const j = await res.json()
  rawPayload.value = JSON.stringify(j.data?.payload ?? j.data, null, 2)
}

const openNativePicker = (evt: Event) => {
  const el = evt.target as HTMLInputElement & { showPicker?: () => void }
  if (el && typeof el.showPicker === 'function') {
    try { el.showPicker() } catch {}
  }
}

const activeChips = computed(() => {
  const chips:any[]=[]
  const push=(key:string,label:string,val:string)=>{ if(val) chips.push({key,label:`${label}: ${val}`}) }
  push('from','From',fromDate.value); push('to','To',toDate.value); push('domain','Domain',domain.value); push('type','Type',type.value); push('severity','Severity',severity.value); push('agent','Agent',agentId.value); push('session','Session',sessionKey.value); push('channel','Channel',channel.value); if(q.value) chips.push({key:'q',label:`Search: ${q.value}`}); if(qExclude.value) chips.push({key:'qExclude',label:'Exclude: ON'}); if(deep.value) chips.push({key:'deep',label:'Deep: ON'})
  return chips
})
const removeChip = (k:string) => { if(k==='from') fromDate.value=''; else if(k==='to') toDate.value=''; else if(k==='domain') domain.value=''; else if(k==='type') type.value=''; else if(k==='severity') severity.value=''; else if(k==='agent') agentId.value=''; else if(k==='session') sessionKey.value=''; else if(k==='channel') channel.value=''; else if(k==='q') q.value=''; else if(k==='qExclude') qExclude.value=false; else if(k==='deep') deep.value=false; apply() }

const currentQuery = () => ({ fromDate: fromDate.value, toDate: toDate.value, domain: domain.value, type: type.value, severity: severity.value, agentId: agentId.value, sessionKey: sessionKey.value, channel: channel.value, q: q.value, qExclude: qExclude.value, deep: deep.value, pageSize: pageSize.value })

const loadFavorites = async () => {
  const res = await fetch('/api/log-explorer/favorites', { headers: { 'x-observeclaw-password': authPassword.value || '' } })
  if (!res.ok) return
  const j = await res.json()
  favorites.value = j.data || []
}

const applyFavorite = (f: any) => {
  const v = f?.query || {}
  fromDate.value = v.fromDate || ''
  toDate.value = v.toDate || ''
  domain.value = v.domain || ''
  type.value = v.type || ''
  severity.value = v.severity || ''
  agentId.value = v.agentId || ''
  sessionKey.value = v.sessionKey || ''
  channel.value = v.channel || ''
  q.value = v.q || ''
  qExclude.value = !!v.qExclude
  deep.value = !!v.deep
  if (v.pageSize) pageSize.value = Number(v.pageSize)
  page.value = 1
  fetchRows()
}

const saveFavorite = async () => {
  const existing = favorites.value.length
  if (existing >= 5) {
    const pick = prompt('Max 5 favorites. Enter favorite name to overwrite exactly:')
    if (!pick) return
    const hit = favorites.value.find((f) => f.name === pick)
    if (!hit) return
    await fetch(`/api/log-explorer/favorites/${encodeURIComponent(hit.id)}`, {
      method: 'PATCH',
      headers: { 'x-observeclaw-password': authPassword.value || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: currentQuery() })
    })
    await loadFavorites(); return
  }
  const name = prompt('Favorite name?')
  if (!name) return
  const isDefault = confirm('Set as default?')
  await fetch('/api/log-explorer/favorites', {
    method: 'POST',
    headers: { 'x-observeclaw-password': authPassword.value || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, query: currentQuery(), isDefault })
  })
  await loadFavorites()
}

const toggleSort = (key: typeof sortKey.value) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'timestamp' ? 'desc' : 'asc'
  }
}

const sortIndicator = (key: typeof sortKey.value) => {
  if (sortKey.value !== key) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const sortedRows = computed(() => {
  const list = [...rows.value]
  const dir = sortDir.value === 'asc' ? 1 : -1
  const key = sortKey.value

  return list.sort((a: any, b: any) => {
    if (key === 'timestamp') {
      const av = a?.timestamp ? new Date(a.timestamp).getTime() : 0
      const bv = b?.timestamp ? new Date(b.timestamp).getTime() : 0
      return (av - bv) * dir
    }

    const av = String(a?.[key] ?? '').toLowerCase()
    const bv = String(b?.[key] ?? '').toLowerCase()
    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })
})

onMounted(async () => {
  setRange(7)
  await loadFavorites()

  // Seed filters from URL query params (e.g. from Work Output card click)
  const rq = route.query
  const hasQueryParams = rq.type || rq.q || rq.domain || rq.severity || rq.agentId
  if (hasQueryParams) {
    if (rq.type) type.value = String(rq.type)
    if (rq.q) q.value = String(rq.q)
    if (rq.domain) domain.value = String(rq.domain)
    if (rq.severity) severity.value = String(rq.severity)
    if (rq.agentId) agentId.value = String(rq.agentId)
    if (rq.deep === 'true') deep.value = true
  } else {
    const def = favorites.value.find((f:any) => f.isDefault)
    if (def) applyFavorite(def)
  }

  await fetchFacets()
  fetchRows()
})
</script>

<style scoped>
/* ── Layout: page fills parent, only the table scrolls ── */
.app-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;          /* allow flex child to shrink below content size */
  min-width: 0;
  height: 100%;
  overflow: hidden;        /* page itself never scrolls */
}

/* ── Picker bar: sits at top, never scrolls, shrinks to content ── */
.picker-bar {
  flex-shrink: 0;
  margin-bottom: 3px;     /* 3px gap between picker and table */
}
.log-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
.meta { font-family: var(--font-mono); font-size: .72rem; color: #b8c7da; }

.controls {
  margin-bottom: 0 !important;  /* override oc-card default margin */
}
.controls .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.favorites-top-row { margin-bottom: 10px; }
.controls .row.compact { align-items: center; }
.search { min-width: 220px; flex: 1; }
.fav-btn { white-space: nowrap; }

.date-mini { position: relative; min-width: 140px; }
.date-mini input { width: 100%; height: 34px; font-size: .74rem; padding-top: 10px; }
.date-mini::before {
  position: absolute;
  top: 2px;
  left: 8px;
  font-family: var(--font-mono);
  font-size: .56rem;
  color: rgba(168,179,199,.8);
  pointer-events: none;
}
.date-mini.start::before { content: 'FROM'; }
.date-mini.end::before { content: 'TO'; }

.result-badge { margin-left: auto; font-family: var(--font-mono); font-size: .72rem; color:#bfe8ff; border:1px solid rgba(73,166,255,.4); padding:4px 8px; border-radius:3px; }

.advanced-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  align-items: center;
}
.advanced-grid .neon-input { min-width: 0; height: 34px; font-size: .74rem; padding: 4px 8px; }
.deep-toggle { font-family: var(--font-mono); font-size: .72rem; color: #b8c7da; display: flex; align-items: center; gap: 6px; }

.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.chip { border: 1px solid rgba(39,213,255,.35); background: rgba(39,213,255,.1); color: #dff7ff; padding: 4px 8px; border-radius: 3px; font-family: var(--font-mono); font-size: .72rem; }

.export-menu-wrap { position: relative; }
.export-menu { position: absolute; right: 0; top: calc(100% + 4px); display: grid; gap: 6px; background: #0d1118; border: 1px solid rgba(168,179,199,.3); padding: 8px; border-radius: 4px; z-index: 40; }

/* ── Table area: fills all remaining space, scrolls both axes ── */
.table-wrap {
  flex: 1;
  min-height: 0;          /* critical: allow shrink in flex column */
  min-width: 0;
  width: 100%;
  overflow: auto;
  padding: 0 !important;
  margin-bottom: 0 !important;
  display: flex;
  flex-direction: column;
}
.log-table { width: 100%; border-collapse: collapse; border-spacing: 0; margin: 0; font-family: var(--font-mono); font-size: .78rem; }
.log-table th,
.log-table td { border-bottom: 1px solid rgba(255,255,255,.08); padding: 8px; text-align: left; vertical-align: top; }
.log-table th {
  white-space: nowrap;
}
.log-table thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: linear-gradient(180deg, rgba(39,213,255,.10), rgba(39,213,255,.06));
  color: rgba(232,245,255,.92);
  border-bottom: 1px solid rgba(39,213,255,.22);
}
.log-table thead th.sortable {
  cursor: pointer;
  user-select: none;
  transition: background-color .15s ease;
  white-space: nowrap;
}
.log-table thead th.sortable:hover {
  background: linear-gradient(180deg, rgba(39,213,255,.14), rgba(39,213,255,.08));
}
.sort-indicator {
  display: inline-flex;
  min-width: 14px;
  margin-left: 3px;
  color: rgba(142,223,255,.85);
  font-size: .72rem;
  white-space: nowrap;
}

.sev { border: 1px solid rgba(255,255,255,.2); padding: 2px 6px; border-radius: 3px; font-size: .66rem; text-transform: uppercase; }
.sev.info { color: #8edfff; border-color: rgba(39,213,255,.45); }
.sev.warning { color: #ffd199; border-color: rgba(255,179,71,.45); }
.sev.error { color: #ffb3c2; border-color: rgba(255,92,122,.5); }

.pager {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0 4px;
  border-top: 1px solid rgba(255,255,255,.08);
}

/* ── Modal ── */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 3000; }
.modal { position: fixed; left: 8%; right: 8%; top: 8%; bottom: 8%; background: #0d1118; border: 1px solid rgba(168,179,199,.3); z-index: 3001; border-radius: 6px; padding: 12px; overflow: auto; }
.modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.modal-actions { margin-top: 8px; display: flex; gap: 8px; }
.json { white-space: pre-wrap; font-family: var(--font-mono); font-size: .78rem; color: #dce8f8; }

/* ── Responsive: filters wrap on narrower widths ── */
@media (max-width: 1600px) { .advanced-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 1200px) { .advanced-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 768px) { .advanced-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
