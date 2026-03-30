<template>
  <div class="app-container">
    <header class="alerts-header" style="margin-bottom: 16px; display:flex; justify-content:space-between; align-items:center;">
      <h1 class="oc-page-title">ALERTS</h1>
      <div class="alerts-actions oc-toolbar" style="display:flex; gap:10px; align-items:center;">
        <span :class="pageStatusClass" style="font-family:var(--font-mono);">● {{ pageStatusText }}</span>
        <span class="text-secondary" style="font-family:var(--font-mono);">Role: {{ role }}</span>
        <button class="neon-button" @click="refreshAll">Refresh</button>
      </div>
    </header>

    <div class="alerts-switcher-wrap">
      <div class="alerts-switcher" role="tablist" aria-label="Alerts page sections">
        <button
          class="alerts-switcher-btn"
          :class="{ 'is-active': activeTab==='open' }"
          @click="activeTab='open'"
          role="tab"
          :aria-selected="activeTab==='open'"
        >
          OPEN ALERTS
        </button>
        <button
          class="alerts-switcher-btn"
          :class="{ 'is-active': activeTab==='rules' }"
          @click="activeTab='rules'"
          role="tab"
          :aria-selected="activeTab==='rules'"
        >
          RULES
        </button>
        <button
          class="alerts-switcher-btn"
          :class="{ 'is-active': activeTab==='create' }"
          @click="activeTab='create'"
          role="tab"
          :aria-selected="activeTab==='create'"
        >
          CREATE RULE
        </button>
      </div>
    </div>

    <div class="oc-card" style="margin-bottom: 12px;" v-show="activeTab==='create'">
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:8px; align-items:center;">
        <input class="neon-input" v-model="newRule.name" placeholder="Rule name" />
        <select class="neon-input" v-model="newRule.kind">
          <option value="error_burst">error_burst</option>
          <option value="event_rate">event_rate</option>
          <option value="absence">absence</option>
          <option value="network_connection_rate">network_connection_rate</option>
          <option value="network_domain_match">network_domain_match</option>
        </select>
        <input class="neon-input" type="number" min="1" v-model.number="newRule.threshold" placeholder="threshold" />
        <input class="neon-input" type="number" min="10" step="10" v-model.number="newRule.windowSec" placeholder="window sec" />
        <input class="neon-input" type="number" min="30" step="30" v-model.number="newRule.dedupeSec" placeholder="dedupe sec" />
        <input class="neon-input" v-model="newRule.domain" placeholder="domain/host pattern (optional)" />
        <input class="neon-input" v-model="newRule.type" placeholder="type/protocol (optional)" />
      </div>
      <button class="neon-button" style="margin-top:10px;"  @click="createRule">Create Rule</button>
    </div>

    <div class="alerts-stack">
      <div class="oc-card panel-actions" v-if="activeTab==='open' || activeTab==='rules'">
        <span class="notifier-status" :class="systemStatus.telegramNotifierConfigured ? 'ok' : 'bad'">
          {{ systemStatus.telegramNotifierConfigured ? 'Telegram notifier configured' : 'Telegram notifier missing credentials' }}
        </span>
        <select v-model="openOnly" class="neon-input" style="width:130px;" v-if="activeTab==='open'">
          <option :value="true">Open Only</option>
          <option :value="false">All</option>
        </select>
        <select v-model="severityFilter" class="neon-input" style="width:130px;" v-if="activeTab==='open'">
          <option value="all">All Sev</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
        <button class="neon-button" @click="refreshAll">Refresh</button>
        <button v-if="activeTab==='open' && alerts.length" class="neon-button" @click="ackAll">Ack All</button>
      </div>

      <div class="oc-card" v-if="activeTab==='open'">
        <div v-if="alerts.length===0" class="text-green">No alerts found.</div>
        <div class="open-alert-grid" v-else>
          <div v-for="a in alerts" :key="a.id" class="open-alert-card" :class="`sev-${a.severity||'warning'}`">
            <div class="open-alert-title">{{ a.title }}</div>
            <div class="open-alert-meta">{{ fmt(a.timestamp) }}</div>
            <div class="open-alert-detail">{{ alertSummary(a) }}</div>
            <div style="display:flex; justify-content:flex-end; margin-top:8px;">
              <button class="neon-button" style="padding:4px 8px;" @click="ack(a.id)">Ack</button>
            </div>
          </div>
        </div>
      </div>

      <div class="alerts-rules-view" v-if="activeTab==='rules'">
        <div class="oc-card rules-card">
          <div v-for="r in rules" :key="r.id" class="rule-card">
            <div class="rule-head" @click="expandedRuleId = expandedRuleId === r.id ? null : r.id">
              <div>
                <div class="text-primary">{{ r.name }}</div>
                <div class="text-secondary" style="font-size:0.8em;">kind={{ r.kind }} · threshold={{ r.threshold }} · window={{ r.windowSec }}s</div>
              </div>
              <div style="display:flex; gap:8px; align-items:center;">
                <span class="text-secondary" style="font-size:0.78em;">{{ expandedRuleId===r.id ? 'Collapse' : 'Expand' }}</span>
              </div>
            </div>

            <div class="rule-controls" v-if="expandedRuleId===r.id">
              <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <label class="text-secondary">Enabled</label>
                <input type="checkbox" :checked="!!r.enabled"  @change="toggleRule(r)" />
                <button class="neon-button" style="padding:4px 8px;"  @click="confirmDeleteRule(r.id)">Delete</button>
              </div>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <input class="neon-input" style="width:120px;" type="number" min="1" :value="ruleDrafts[r.id]?.threshold ?? r.threshold" @input="(e:any)=>updateDraftThreshold(r, Number(e.target.value))" />
                <input class="neon-input" style="width:140px;" type="number" min="10" step="10" :value="ruleDrafts[r.id]?.windowSec ?? r.windowSec" @input="(e:any)=>updateDraftWindow(r, Number(e.target.value))" />
                <input class="neon-input" style="width:140px;" type="number" min="30" step="30" :value="ruleDrafts[r.id]?.dedupeSec ?? r.dedupeSec" @input="(e:any)=>updateDraftDedupe(r, Number(e.target.value))" />
                <label class="text-secondary">Notify</label>
                <input type="checkbox" :checked="ruleDrafts[r.id]?.notifyEnabled ?? !!r.notifyEnabled"  @change="(e:any)=>updateDraftNotifyEnabled(r, !!e.target.checked)" />
                <select class="neon-input" style="width:140px;" :value="ruleDrafts[r.id]?.notifyChannel ?? (r.notifyChannel || 'telegram')" @change="(e:any)=>updateDraftNotifyChannel(r, e.target.value)">
                  <option value="telegram">telegram</option>
                  <option value="signal">signal</option>
                  <option value="discord">discord</option>
                </select>
                <input class="neon-input" style="width:150px;" type="number" min="30" step="30" :value="ruleDrafts[r.id]?.notifyCooldownSec ?? (r.notifyCooldownSec || 900)" @input="(e:any)=>updateDraftNotifyCooldown(r, Number(e.target.value))" />
                <button class="neon-button" style="padding:4px 8px;"  @click="saveRule(r)">Save</button>
              </div>
            </div>
          </div>
        </div>

        <div class="oc-card outbox-card">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
            <h3 class="text-cyan">NOTIFICATION OUTBOX</h3>
            <div style="display:flex; gap:8px;">
              <button class="neon-button" style="padding:4px 8px;" @click="clearOutboxView">Clear View</button>
              <button v-if="outboxClearedAt" class="neon-button" style="padding:4px 8px;" @click="resetOutboxView">Show All</button>
            </div>
          </div>
          <div v-if="outbox.length===0" class="text-secondary">No queued notifications.</div>
          <div v-for="n in outbox.slice(0,30)" :key="n.id" style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-family:var(--font-mono);">
            <div>
              <div class="text-primary">{{ n.channel }} · {{ n.status }}</div>
              <div class="text-secondary" style="font-size:0.8em;">{{ fmt(n.timestamp) }}</div>
              <div v-if="n.error" class="text-red" style="font-size:0.75em;">{{ n.error }}</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="neon-button" style="padding:4px 8px;" :disabled="n.status==='sent'" @click="markSent(n.id)">Mark Sent</button>
              <button class="neon-button" style="padding:4px 8px;"  @click="retryOutbox(n.id)">Retry</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

const authPassword = inject('authPassword') as Ref<string>
const pageStatusText = inject('pageStatusText') as Ref<string>
const pageStatusClass = inject('pageStatusClass') as Ref<string>
const alerts = ref<any[]>([])
const rules = ref<any[]>([])
const outbox = ref<any[]>([])
const outboxClearedAt = ref(localStorage.getItem('oc.alerts.outboxClearedAt') || '')
const role = ref('authorized')
const systemStatus = ref<any>({ telegramNotifierConfigured: false })
const openOnly = ref(localStorage.getItem('oc.alerts.openOnly') !== '0')
const severityFilter = ref(localStorage.getItem('oc.alerts.severity') || 'all')
const activeTab = ref<'open'|'rules'|'create'>((localStorage.getItem('oc.alerts.tab') as any) || 'open')
const expandedRuleId = ref<string | null>(null)
const ruleDrafts = ref<Record<string, { threshold: number, windowSec: number, dedupeSec: number, notifyEnabled: boolean, notifyChannel: string, notifyCooldownSec: number }>>({})
const newRule = ref({
  name: '',
  kind: 'error_burst',
  threshold: 3,
  windowSec: 300,
  dedupeSec: 600,
  domain: '',
  type: ''
})

const authHeaders = () => ({ 'x-observeclaw-password': authPassword.value || '' })
const jsonHeaders = () => ({ ...authHeaders(), 'content-type': 'application/json' })

const loadAlerts = async () => {
  const q = new URLSearchParams({
    open: openOnly.value ? '1' : '0',
    severity: severityFilter.value,
    limit: '200'
  })
  const res = await fetch(`/api/alerts?${q.toString()}`, { headers: authHeaders() })
  if (!res.ok) return
  const json = await res.json()
  alerts.value = json.data || []
}

const loadRules = async () => {
  const res = await fetch('/api/rules', { headers: authHeaders() })
  if (!res.ok) return
  const json = await res.json()
  rules.value = json.data || []
  const next: Record<string, { threshold: number, windowSec: number, dedupeSec: number, notifyEnabled: boolean, notifyChannel: string, notifyCooldownSec: number }> = {}
  for (const r of rules.value) {
    next[r.id] = {
      threshold: Number(r.threshold || 1),
      windowSec: Number(r.windowSec || 60),
      dedupeSec: Number(r.dedupeSec || 600),
      notifyEnabled: Boolean(r.notifyEnabled),
      notifyChannel: String(r.notifyChannel || 'telegram'),
      notifyCooldownSec: Number(r.notifyCooldownSec || 900)
    }
  }
  ruleDrafts.value = next
}

const loadRole = async () => {
  const res = await fetch('/api/auth/status', { headers: authHeaders() })
  if (!res.ok) { role.value = 'unauthorized'; return }
  const json = await res.json()
  role.value = json?.authorized ? 'authorized' : 'unauthorized'
}

const loadSystemStatus = async () => {
  const res = await fetch('/api/system/status', { headers: authHeaders() })
  if (!res.ok) return
  const json = await res.json()
  systemStatus.value = { telegramNotifierConfigured: !!json.telegramNotifierConfigured }
}

const loadOutbox = async () => {
  const res = await fetch('/api/notifications/outbox?limit=200', { headers: authHeaders() })
  if (!res.ok) return
  const json = await res.json()
  const rows = Array.isArray(json.data) ? json.data : []
  if (!outboxClearedAt.value) {
    outbox.value = rows
    return
  }

  const cutoff = new Date(outboxClearedAt.value).getTime()
  outbox.value = rows.filter((r: any) => new Date(r?.timestamp || 0).getTime() > cutoff)
}

const markSent = async (id: string) => {
  await fetch(`/api/notifications/${id}/mark-sent`, { method: 'POST', headers: authHeaders() })
  await loadOutbox()
}

const retryOutbox = async (id: string) => {
  await fetch(`/api/notifications/${id}/retry`, { method: 'POST', headers: authHeaders() })
  await loadOutbox()
}

const clearOutboxView = async () => {
  outboxClearedAt.value = new Date().toISOString()
  localStorage.setItem('oc.alerts.outboxClearedAt', outboxClearedAt.value)
  await loadOutbox()
}

const resetOutboxView = async () => {
  outboxClearedAt.value = ''
  localStorage.removeItem('oc.alerts.outboxClearedAt')
  await loadOutbox()
}

const refreshAll = async () => {
  await Promise.all([loadRole(), loadSystemStatus(), loadAlerts(), loadRules(), loadOutbox()])
}

const ensureOperator = async () => {
  await loadRole()
  if (role.value !== 'authorized') {
    window.alert('Action requires valid ObserveClaw password. Use Switch Password in the sidebar, then log in again.')
    return false
  }
  return true
}

const ack = async (id: string) => {
  if (!(await ensureOperator())) return
  const res = await fetch(`/api/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) {
    let msg = `Ack failed (${res.status})`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {
      try { msg = await res.text() } catch {}
    }
    window.alert(msg)
    await loadRole()
    return
  }
  await loadAlerts()
}

const ackAll = async () => {
  if (!(await ensureOperator())) return
  const res = await fetch('/api/alerts/ack-all', { method: 'POST', headers: authHeaders() })
  if (!res.ok) {
    let msg = `Ack all failed (${res.status})`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {
      try { msg = await res.text() } catch {}
    }
    window.alert(msg)
    await loadRole()
    return
  }
  await loadAlerts()
}

const toggleRule = async (rule: any) => {
  const enabled = !Boolean(rule.enabled)
  await fetch(`/api/rules/${rule.id}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify({ enabled })
  })
  await loadRules()
}

const saveRule = async (rule: any) => {
  const d = ruleDrafts.value[rule.id]
  if (!d) return
  await fetch(`/api/rules/${rule.id}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify({
      threshold: Number(d.threshold),
      windowSec: Number(d.windowSec),
      dedupeSec: Number(d.dedupeSec),
      notifyEnabled: Boolean(d.notifyEnabled),
      notifyChannel: d.notifyChannel,
      notifyCooldownSec: Number(d.notifyCooldownSec)
    })
  })
  await loadRules()
}

const createRule = async () => {
  if (!newRule.value.name.trim()) return
  await fetch('/api/rules', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      name: newRule.value.name,
      kind: newRule.value.kind,
      threshold: Number(newRule.value.threshold),
      windowSec: Number(newRule.value.windowSec),
      dedupeSec: Number(newRule.value.dedupeSec),
      notifyEnabled: false,
      notifyChannel: 'telegram',
      notifyCooldownSec: 900,
      domain: newRule.value.domain || null,
      type: newRule.value.type || null
    })
  })
  newRule.value.name = ''
  newRule.value.domain = ''
  newRule.value.type = ''
  await loadRules()
}

const deleteRule = async (id: string) => {
  if (!(await ensureOperator())) return
  const res = await fetch(`/api/rules/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) {
    let msg = `Delete failed (${res.status})`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {
      try { msg = await res.text() } catch {}
    }
    window.alert(msg)
    await loadRole()
    return
  }
  await loadRules()
}

const confirmDeleteRule = async (id: string) => {
  if (!window.confirm('Delete this rule? This will also remove related alerts/outbox records.')) return
  await deleteRule(id)
}

const ensureDraft = (rule: any): { threshold: number, windowSec: number, dedupeSec: number, notifyEnabled: boolean, notifyChannel: string, notifyCooldownSec: number } => {
  if (!ruleDrafts.value[rule.id]) {
    ruleDrafts.value[rule.id] = {
      threshold: Number(rule.threshold || 1),
      windowSec: Number(rule.windowSec || 60),
      dedupeSec: Number(rule.dedupeSec || 600),
      notifyEnabled: Boolean(rule.notifyEnabled),
      notifyChannel: String(rule.notifyChannel || 'telegram'),
      notifyCooldownSec: Number(rule.notifyCooldownSec || 900)
    }
  }
  return ruleDrafts.value[rule.id]!
}

const updateDraftThreshold = (rule: any, val: number) => {
  const d = ensureDraft(rule)
  d.threshold = Number.isFinite(val) ? val : d.threshold
}

const updateDraftWindow = (rule: any, val: number) => {
  const d = ensureDraft(rule)
  d.windowSec = Number.isFinite(val) ? val : d.windowSec
}

const updateDraftDedupe = (rule: any, val: number) => {
  const d = ensureDraft(rule)
  d.dedupeSec = Number.isFinite(val) ? val : d.dedupeSec
}

const updateDraftNotifyEnabled = (rule: any, val: boolean) => {
  const d = ensureDraft(rule)
  d.notifyEnabled = val
}

const updateDraftNotifyChannel = (rule: any, val: string) => {
  const d = ensureDraft(rule)
  d.notifyChannel = val || 'telegram'
}

const updateDraftNotifyCooldown = (rule: any, val: number) => {
  const d = ensureDraft(rule)
  d.notifyCooldownSec = Number.isFinite(val) ? val : d.notifyCooldownSec
}

const alertSummary = (a: any) => {
  try {
    const d = typeof a.details === 'string' ? JSON.parse(a.details) : a.details
    const host = Array.isArray(d?.topHosts) && d.topHosts.length ? d.topHosts[0]?.host : null
    const count = d?.count
    const win = d?.windowSec
    const proto = d?.protocol
    const parts = []
    if (host) parts.push(`host=${host}`)
    if (proto) parts.push(`proto=${proto}`)
    if (count != null && win != null) parts.push(`count=${count}/${win}s`)
    return parts.join(' · ') || 'no detail'
  } catch {
    return 'no detail'
  }
}

const fmt = (s: string) => s ? new Date(s).toLocaleString() : ''

watch([openOnly, severityFilter], () => {
  localStorage.setItem('oc.alerts.openOnly', openOnly.value ? '1' : '0')
  localStorage.setItem('oc.alerts.severity', severityFilter.value)
  loadAlerts()
})

watch(activeTab, (v) => {
  localStorage.setItem('oc.alerts.tab', v)
})

onMounted(refreshAll)
</script>

<style scoped>
.app-container { height:100%; display:flex; flex-direction:column; min-width:0; overflow-y:auto; overflow-x:hidden; padding-right:2px; }

/* Neon Zero left-edge accents (Alerts page) */
.app-container .oc-card {
  position: relative;
  overflow: hidden;
}
.app-container .oc-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, rgba(73,166,255,0.92), rgba(39,213,255,0.88));
}
.alerts-switcher-wrap .alerts-switcher::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, rgba(157,109,255,0.9), rgba(73,166,255,0.88));
}
.alerts-switcher-wrap .alerts-switcher {
  position: relative;
}

.panel-actions::before { background: linear-gradient(180deg, rgba(73,166,255,0.95), rgba(39,213,255,0.9)); }
.open-alert-card::before { background: linear-gradient(180deg, rgba(255,92,122,0.95), rgba(255,179,71,0.9), rgba(73,166,255,0.92)); }
.rules-card::before { background: linear-gradient(180deg, rgba(73,166,255,0.95), rgba(39,213,255,0.92)); }
.outbox-card::before { background: linear-gradient(180deg, rgba(157,109,255,0.96), rgba(73,166,255,0.9)); }

.neon-input {
  min-height: 36px;
  font-size: 12px;
  padding: 6px 8px;
}

.alerts-switcher-wrap {
  margin-bottom: 12px;
}

.alerts-switcher {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid rgba(168,179,199,0.22);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(14,18,26,0.96), rgba(12,16,22,0.96));
  overflow: hidden;
}

.alerts-switcher-btn {
  appearance: none;
  border: 0;
  border-right: 1px solid rgba(168,179,199,0.14);
  background: transparent;
  color: rgba(168,179,199,0.82);
  min-height: 42px;
  padding: 0 8px;
  font-family: var(--font-sans);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  font-weight: 800;
  text-transform: uppercase;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.alerts-switcher-btn:last-child {
  border-right: none;
}

.alerts-switcher-btn.is-active {
  color: #f4f8ff;
  background: rgba(255,255,255,0.02);
}

.alerts-switcher-btn.is-active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: #49a6ff;
  box-shadow: 0 0 8px rgba(73,166,255,0.5);
}

.alerts-stack {
  display: block;
}

.panel-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.notifier-status {
  font-family: var(--font-mono);
  font-size: .68rem;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(168,179,199,.25);
}
.notifier-status.ok {
  color: #9de6b8;
  border-color: rgba(57,217,138,.45);
  background: rgba(57,217,138,.12);
}
.notifier-status.bad {
  color: #ffb3c2;
  border-color: rgba(255,92,122,.5);
  background: rgba(255,92,122,.12);
}

.open-alert-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
.open-alert-card {
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 10px;
  background: rgba(0,0,0,0.22);
}
.open-alert-card.sev-error { border-color: rgba(255,92,122,0.45); }
.open-alert-card.sev-warning { border-color: rgba(255,179,71,0.38); }
.open-alert-card.sev-info { border-color: rgba(39,213,255,0.38); }
.open-alert-title { color: #f5f8ff; font-weight: 700; }
.open-alert-meta { color: var(--text-secondary); font-size: 0.75rem; margin-top: 2px; }
.open-alert-detail { color: #b8c7da; font-family: var(--font-mono); font-size: 0.72rem; margin-top: 6px; }

.rule-card {
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 8px 0;
  font-family: var(--font-mono);
}
.rule-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.rule-controls {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  background: rgba(0,0,0,0.2);
}

.alerts-rules-view {
  display: grid;
  gap: 12px;
  position: relative;
  z-index: 1;
}

.rules-card,
.outbox-card {
  overflow: visible;
  max-height: none;
  position: relative;
  z-index: 1;
}

@media (max-width: 1200px) {
  .alerts-stack {
    min-height: 0 !important;
  }
}

@media (max-width: 768px) {
  .alerts-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .alerts-actions {
    width: 100%;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .alerts-stack .oc-card {
    max-height: none !important;
  }
  .panel-actions {
    padding: 8px;
  }
  .open-alert-grid {
    grid-template-columns: 1fr;
  }
  .rule-head {
    flex-direction: column;
    align-items: flex-start;
  }
  .outbox-card {
    margin-bottom: 14px;
  }
  .alerts-switcher-wrap {
    margin-top: 6px;
  }
  .alerts-switcher-btn {
    min-height: 44px;
    font-size: 0.66rem;
    letter-spacing: 0.02em;
    padding: 0 4px;
  }
}
</style>