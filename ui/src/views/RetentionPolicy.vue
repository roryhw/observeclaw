<template>
  <div class="retention-page">
    <header class="header-row">
      <div :class="pageStatusClass" style="font-family:var(--font-mono);">● {{ pageStatusText }}</div>
      <div class="actions">
        <button class="neon-button" @click="loadAll" :disabled="loading">Refresh</button>
        <button class="neon-button" @click="runDryRun" :disabled="loading">Dry Run</button>
        <button class="neon-button" @click="runNow" :disabled="running">Run Now</button>
      </div>
    </header>

    <div class="oc-card hero-grid">
      <div><span class="label">POLICY</span><strong>{{ policy.name }}</strong></div>
      <div><span class="label">INFERRED STORAGE</span><strong class="chip ok">EXCLUDED</strong></div>
      <div><span class="label">CHAT RETENTION</span><strong>{{ policy.chatRetentionDays }}d</strong></div>
      <div><span class="label">SCHEDULE</span><strong>{{ policy.scheduleCron }} ({{ policy.timezone }})</strong></div>
      <div><span class="label">LAST RUN</span><strong>{{ runs[0]?.startedAt || 'n/a' }}</strong></div>
      <div><span class="label">LAST STATUS</span><strong :class="['chip', runs[0]?.status === 'ok' ? 'ok' : 'err']">{{ (runs[0]?.status || 'n/a').toUpperCase() }}</strong></div>
    </div>

    <div class="oc-card">
      <div class="section-head">Core Settings</div>
      <div class="grid two">
        <label class="field">
          <span>Default retention (days)</span>
          <input class="neon-input" type="number" v-model.number="policy.defaultRetentionDays" min="1" />
        </label>
        <label class="field">
          <span>Audit retention (days)</span>
          <input class="neon-input" type="number" v-model.number="policy.auditRetentionDays" min="1" />
        </label>
        <label class="field">
          <span>Chat retention (days)</span>
          <input class="neon-input" type="number" v-model.number="policy.chatRetentionDays" min="1" />
        </label>
        <label class="field">
          <span>Schedule cron</span>
          <input class="neon-input" type="text" v-model="policy.scheduleCron" placeholder="10 3 * * *" />
        </label>
        <label class="field">
          <span>Timezone</span>
          <input class="neon-input" type="text" v-model="policy.timezone" placeholder="America/Los_Angeles" />
        </label>
      </div>
      <div class="toolbar">
        <label class="switch"><input type="checkbox" v-model="policy.enabled" /> Enabled</label>
        <label class="switch"><input type="checkbox" v-model="policy.notifyOnFailureOnly" /> Notify failure only</label>
        <label class="switch"><input type="checkbox" v-model="policy.includeInferred" disabled /> Exclude inferred from storage (locked)</label>
      </div>
      <div class="actions">
        <button class="neon-button" @click="applyPreset('balanced')" :disabled="saving">Preset: Balanced</button>
        <button class="neon-button" @click="applyPreset('lean')" :disabled="saving">Preset: Lean</button>
        <button class="neon-button" @click="savePolicy" :disabled="saving">Save Policy</button>
        <button class="neon-button" @click="saveSchedule" :disabled="saving">Save Schedule</button>
      </div>
    </div>

    <div class="oc-card">
      <div class="section-head">Type Rules</div>
      <div class="rules" v-if="policy.rules?.length">
        <div class="rule-row" v-for="(r, idx) in policy.rules" :key="idx">
          <input class="neon-input" v-model="r.pattern" />
          <input class="neon-input" type="number" min="1" v-model.number="r.days" />
          <label class="switch"><input type="checkbox" v-model="r.enabled" /> enabled</label>
        </div>
      </div>
    </div>

    <div class="oc-card" v-if="preview">
      <div class="section-head">Dry Run Preview</div>
      <div class="oc-muted mono">Normalized to purge: {{ preview.purgeNormalized }} · Audit to purge: {{ preview.purgeAudit }}</div>
      <div class="preview-list">
        <div class="preview-row" v-for="row in preview.byType.slice(0, 20)" :key="row.type">
          <span>{{ row.type }}</span>
          <span>{{ row.purge }} purge / {{ row.total }} total ({{ row.keepDays }}d)</span>
        </div>
      </div>
    </div>

    <div class="oc-card">
      <div class="section-head">Recent Runs</div>
      <div v-if="runs.length===0" class="oc-muted">No retention runs logged yet.</div>
      <div v-else class="preview-list">
        <div class="preview-row" v-for="r in runs" :key="r.id">
          <span>{{ r.startedAt }}</span>
          <span>{{ r.status }}</span>
        </div>
      </div>
    </div>

    <div v-if="error" class="oc-card error-card">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

const authPassword = inject('authPassword') as Ref<string>
const pageStatusText = inject('pageStatusText') as Ref<string>
const pageStatusClass = inject('pageStatusClass') as Ref<string>
const headers = () => ({ 'x-observeclaw-password': authPassword.value || '', 'Content-Type': 'application/json' })

const loading = ref(false)
const saving = ref(false)
const running = ref(false)
const error = ref('')
const preview = ref<any | null>(null)
const runs = ref<any[]>([])

const policy = ref<any>({
  name: 'Global Retention Policy',
  enabled: true,
  includeInferred: false,
  chatRetentionDays: 3650,
  defaultRetentionDays: 30,
  auditRetentionDays: 14,
  scheduleCron: '10 3 * * *',
  timezone: 'America/Los_Angeles',
  notifyOnFailureOnly: true,
  rules: []
})

const loadAll = async () => {
  if (!authPassword?.value) return
  loading.value = true
  error.value = ''
  try {
    const [pRes, rRes] = await Promise.all([
      fetch('/api/retention/policy', { headers: { 'x-observeclaw-password': authPassword.value || '' } }),
      fetch('/api/retention/runs?limit=10', { headers: { 'x-observeclaw-password': authPassword.value || '' } })
    ])
    if (!pRes.ok || !rRes.ok) throw new Error('Failed to load retention data')
    const p = await pRes.json()
    const r = await rRes.json()
    policy.value = { ...policy.value, ...(p.data || {}) }
    policy.value.includeInferred = false // locked by Rory decision
    runs.value = r.data || []
  } catch (e: any) {
    error.value = String(e?.message || e)
  } finally {
    loading.value = false
  }
}

const savePolicy = async () => {
  if (!confirm('Save retention policy changes?')) return
  saving.value = true
  error.value = ''
  try {
    const body = { ...policy.value, includeInferred: false }
    const res = await fetch('/api/retention/policy', { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
    if (!res.ok) throw new Error('Failed to save policy')
    const out = await res.json()
    policy.value = out.data || policy.value
    policy.value.includeInferred = false
  } catch (e: any) {
    error.value = String(e?.message || e)
  } finally {
    saving.value = false
  }
}

const saveSchedule = async () => {
  saving.value = true
  error.value = ''
  try {
    const res = await fetch('/api/retention/schedule', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ scheduleCron: policy.value.scheduleCron, timezone: policy.value.timezone })
    })
    if (!res.ok) throw new Error('Failed to save schedule')
  } catch (e: any) {
    error.value = String(e?.message || e)
  } finally {
    saving.value = false
  }
}

const runDryRun = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/retention/dry-run', { method: 'POST', headers: { 'x-observeclaw-password': authPassword.value || '' } })
    if (!res.ok) throw new Error('Dry run failed')
    const out = await res.json()
    preview.value = out.data
  } catch (e: any) {
    error.value = String(e?.message || e)
  } finally {
    loading.value = false
  }
}

const applyPreset = (kind: 'balanced' | 'lean') => {
  if (kind === 'balanced') {
    policy.value.defaultRetentionDays = 30
    policy.value.auditRetentionDays = 14
    policy.value.chatRetentionDays = Math.max(3650, Number(policy.value.chatRetentionDays || 3650))
    for (const r of policy.value.rules || []) {
      if (r.pattern === 'model.usage' || r.pattern === 'health' || r.pattern === 'presence' || r.pattern === 'heartbeat') r.days = 14
      if (r.pattern === 'agent') r.days = 3
      if (r.pattern === 'session.output' || r.pattern === 'access.credential.use') r.days = 1
    }
    return
  }

  policy.value.defaultRetentionDays = 14
  policy.value.auditRetentionDays = 7
  policy.value.chatRetentionDays = Math.max(3650, Number(policy.value.chatRetentionDays || 3650))
  for (const r of policy.value.rules || []) {
    if (r.pattern === 'tool.*' || r.pattern === 'network.*' || r.pattern === 'message.*') r.days = 14
    if (r.pattern === 'model.usage' || r.pattern === 'health' || r.pattern === 'presence' || r.pattern === 'heartbeat') r.days = 7
    if (r.pattern === 'agent') r.days = 2
    if (r.pattern === 'session.output' || r.pattern === 'access.credential.use') r.days = 1
  }
}

const runNow = async () => {
  if (!confirm('Run retention now? This will permanently delete old records by policy.')) return
  running.value = true
  error.value = ''
  try {
    const res = await fetch('/api/retention/run', { method: 'POST', headers: headers(), body: JSON.stringify({ runCheckpoint: true }) })
    if (!res.ok) throw new Error('Run failed')
    await loadAll()
  } catch (e: any) {
    error.value = String(e?.message || e)
  } finally {
    running.value = false
  }
}

onMounted(() => {
  if (authPassword?.value) loadAll()
})

watch(() => authPassword?.value, (v) => {
  if (v) loadAll()
})
</script>

<style scoped>
.retention-page { display:flex; flex-direction:column; gap:10px; padding-bottom:20px; }
.header-row { display:flex; justify-content:space-between; gap:10px; align-items:center; }
.actions { display:flex; gap:8px; }
.hero-grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:8px; }
.label { display:block; font-size:.62rem; color:var(--text-secondary); font-family:var(--font-mono); }
.chip { display:inline-block; padding:2px 8px; border-radius:999px; font-size:.68rem; font-family:var(--font-mono); border:1px solid rgba(255,255,255,.2); }
.chip.ok { color: var(--accent-green); border-color: rgba(70,232,124,.6); }
.chip.err { color: var(--accent-red); border-color: rgba(255,90,122,.6); }
.section-head { font-family: var(--font-sans); font-weight:800; margin-bottom:10px; }
.grid.two { display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap:8px; }
.field { display:flex; flex-direction:column; gap:6px; font-size:.76rem; }
.toolbar { margin-top:10px; display:flex; gap:14px; flex-wrap:wrap; }
.switch { display:inline-flex; align-items:center; gap:6px; font-family:var(--font-mono); font-size:.68rem; color:var(--text-secondary); }
.rules { display:grid; gap:6px; }
.rule-row { display:grid; grid-template-columns: minmax(180px,1fr) 120px 120px; gap:8px; align-items:center; }
.preview-list { margin-top:8px; display:grid; gap:4px; }
.preview-row { display:flex; justify-content:space-between; font-family:var(--font-mono); font-size:.68rem; border-bottom:1px solid rgba(255,255,255,.06); padding:4px 0; }
.error-card { border-color: rgba(255,92,122,.35); color: #ffb3c2; font-family: var(--font-mono); }
@media (max-width: 900px) {
  .hero-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .grid.two { grid-template-columns: 1fr; }
  .rule-row { grid-template-columns: 1fr 100px 110px; }
}
</style>
