<template>
  <div class="app-container">
    <header class="audit-header" style="margin-bottom: 16px; display:flex; justify-content:space-between; align-items:center;">
      <h1 class="oc-page-title">AUDIT</h1>
      <div style="display:flex; gap:10px; align-items:center;">
        <div :class="pageStatusClass" style="font-family:var(--font-mono);">● {{ pageStatusText }}</div>
        <div class="oc-muted">Role: {{ role }}</div>
      </div>
    </header>

    <div class="oc-card" style="margin-bottom:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <button class="neon-button" @click="loadAudit">Refresh</button>
      <button class="neon-button" @click="exportAudit" >Export</button>
      <button class="neon-button" @click="runRedactionCheck" >Redaction Check</button>
      <span class="text-secondary" style="font-family:var(--font-mono);">{{ status }}</span>
    </div>
    <div v-if="redactionResult" class="oc-card" style="margin-bottom:12px;">
      <div style="font-family:var(--font-mono); font-size:0.85em;">
        <div :class="redactionResult.ok ? 'text-green' : 'text-orange'">
          Redaction: {{ redactionResult.ok ? 'PASS' : 'WARN' }} | mode={{ redactionResult.mode }} | scanned={{ redactionResult.scanned }} | suspect={{ redactionResult.suspect }}
        </div>
      </div>
    </div>

    <div class="oc-card" style="flex:1; overflow:auto;">
      <div class="audit-cards">
        <div v-for="row in rows" :key="row.id" class="audit-card">
          <div class="audit-time text-secondary">{{ fmt(row.timestamp) }}</div>
          <div class="audit-action text-cyan">{{ row.action }}</div>
          <div class="audit-target">{{ row.target }}</div>
          <div :class="row.status==='ok' || row.status==='allowed' ? 'text-green' : row.status==='denied' || row.status==='forbidden' ? 'text-red' : 'text-orange'">{{ row.status }}</div>
          <div class="audit-actor">{{ row.actor || 'system' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import type { Ref } from 'vue'

const authPassword = inject('authPassword') as Ref<string>
const pageStatusText = inject('pageStatusText') as Ref<string>
const pageStatusClass = inject('pageStatusClass') as Ref<string>
const rows = ref<any[]>([])
const role = ref('authorized')
const status = ref('idle')
const redactionResult = ref<any | null>(null)

const headers = () => ({ 'x-observeclaw-password': authPassword.value || '' })

const loadAudit = async () => {
  status.value = 'loading audit...'
  const res = await fetch('/api/audit?limit=300', { headers: headers() })
  if (res.status === 401) { status.value = 'unauthorized'; return }
  const json = await res.json()
  rows.value = json.data || []
  status.value = `loaded ${rows.value.length}`
}

const loadRole = async () => {
  const res = await fetch('/api/auth/status', { headers: headers() })
  if (!res.ok) { role.value = 'unauthorized'; return }
  const json = await res.json()
  role.value = json?.authorized ? 'authorized' : 'unauthorized'
}

const exportAudit = async () => {
  status.value = 'exporting...'
  const res = await fetch('/api/audit/export?limit=1000', { headers: headers() })
    if (!res.ok) { status.value = 'export failed'; return }
  const json = await res.json()
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `observeclaw-audit-${new Date().toISOString().replace(/[:.]/g,'-')}.json`
  a.click()
  URL.revokeObjectURL(url)
  status.value = `exported ${json.count || 0} rows`
}

const runRedactionCheck = async () => {
  status.value = 'running redaction check...'
  const res = await fetch('/api/security/redaction-check', { headers: headers() })
    const json = await res.json()
  redactionResult.value = json
  status.value = json.ok ? 'redaction check passed' : 'redaction check warned'
}

const fmt = (s: string) => s ? new Date(s).toLocaleString() : ''

onMounted(async () => {
  await loadRole()
  await loadAudit()
})
</script>

<style scoped>
.app-container { height:100%; display:flex; flex-direction:column; }
.audit-card {
  border: 1px solid rgba(168,179,199,0.18);
  border-radius: var(--radius-sm);
  padding: 10px;
  margin-bottom: 8px;
  font-family: var(--font-mono);
  font-size: 0.82rem;
  background: rgba(255,255,255,0.01);
}
.audit-action { font-weight: 700; margin: 3px 0; }
.audit-target { color: var(--text-primary); margin-bottom: 3px; word-break: break-word; }
.audit-actor { color: var(--text-secondary); }

@media (max-width: 768px) {
  .audit-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>