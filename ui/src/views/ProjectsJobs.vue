<template>
  <div class="pj-page">
    <div class="header-row">
      <button class="neon-button" @click="loadAll" :disabled="loading">Refresh</button>
    </div>

    <div v-if="loadError" class="oc-card error-card">{{ loadError }}</div>

    <div class="oc-card">
      <div class="section-head">Scheduled Jobs</div>
      <div v-if="loading && jobs.length===0" class="oc-muted">Loading jobs...</div>
      <div v-else-if="jobs.length===0" class="oc-muted">No scheduled jobs</div>
      <div v-else class="grid jobs-grid">
        <div v-for="j in jobs" :key="j.id" class="job-card">
          <div class="card-top">
            <div class="title-wrap">
              <span class="status-dot" :class="j.enabled ? 'on' : 'off'"></span>
              <strong>{{ j.name }}</strong>
            </div>
            <span class="oc-muted mono">{{ formatSchedule(j.schedule) }}</span>
          </div>
          <div class="oc-muted mono one-line">{{ payloadPreview(j.payload) }}</div>
          <div class="meta-row mono">
            <span>{{ relTime(j.nextRunAt, true) }}</span>
            <span>{{ relTime(j.lastRunAt, false) }}</span>
          </div>
          <div class="actions">
            <button class="neon-button small" @click="runNow(j)" :disabled="!!busyRun[j.id]">Run now</button>
            <label class="switch">
              <input type="checkbox" :checked="j.enabled" @change="toggleJob(j, ($event.target as HTMLInputElement).checked)" :disabled="!!busyToggle[j.id]"/>
              <span>{{ j.enabled ? 'Enabled' : 'Disabled' }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div class="oc-card">
      <div class="section-head">Projects by Workspace</div>
      <div v-if="loading && projects.length===0" class="oc-muted">Loading projects...</div>
      <div v-else-if="groupNames.length===0" class="oc-muted">No projects found</div>
      <div v-else class="group-stack">
        <div v-for="name in groupNames" :key="name" class="group-block">
          <div class="group-title">{{ name }}</div>
          <div class="grid projects-grid">
            <div v-for="p in grouped[name]" :key="p.path" class="project-card">
              <div class="card-top">
                <div class="title-wrap">
                  <span class="status-dot" :class="p.isRunning ? 'run' : (p.cronJob?.enabled ? 'on' : 'off')"></span>
                  <strong>{{ p.name }}</strong>
                </div>
              </div>
              <div class="oc-muted one-line">{{ p.description || 'Project workspace' }}</div>
              <div class="tags">
                <span class="tag" v-for="c in (p.capabilities || [])" :key="c">{{ c }}</span>
              </div>
              <div v-if="p.cronJob" class="actions">
                <button class="neon-button small" @click="runNow({id:p.cronJob.id})" :disabled="!!busyRun[p.cronJob.id]">Run now</button>
                <label class="switch">
                  <input type="checkbox" :checked="p.cronJob.enabled" @change="toggleProjectCron(p, ($event.target as HTMLInputElement).checked)" :disabled="!!busyToggle[p.cronJob.id]"/>
                  <span>{{ p.cronJob.enabled ? 'Enabled' : 'Disabled' }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, onMounted, watch } from 'vue'
import type { Ref } from 'vue'

const authPassword = inject('authPassword') as Ref<string>
const loading = ref(false)
const loadError = ref('')
const jobs = ref<any[]>([])
const projects = ref<any[]>([])
const busyToggle = ref<Record<string, boolean>>({})
const busyRun = ref<Record<string, boolean>>({})

const headers = () => ({ 'x-observeclaw-password': authPassword.value || '' })

const groupNames = computed(() => Object.keys(grouped.value).sort())
const grouped = computed(() => {
  const out: Record<string, any[]> = {}
  for (const p of projects.value) {
    const key = p.workspaceName || 'Main Workspace'
    if (!out[key]) out[key] = []
    out[key].push(p)
  }
  return out
})

const payloadPreview = (payload: any) => {
  if (!payload) return 'Scheduled task'
  const msg = payload?.message || payload?.text || JSON.stringify(payload)
  return String(msg).replace(/\s+/g, ' ').slice(0, 120)
}

const formatSchedule = (schedule: any) => {
  if (!schedule) return 'Unknown'
  if (schedule.kind === 'cron') return schedule.expr || 'cron'
  if (schedule.kind === 'every') {
    const ms = Number(schedule.everyMs || 0)
    if (ms >= 86400000) return `Every ${Math.round(ms / 86400000)}d`
    if (ms >= 3600000) return `Every ${Math.round(ms / 3600000)}h`
    if (ms >= 60000) return `Every ${Math.round(ms / 60000)}m`
    return `Every ${Math.round(ms / 1000)}s`
  }
  if (schedule.kind === 'at') return 'One-time'
  return 'Custom'
}

const relTime = (iso: string | null, future: boolean) => {
  if (!iso) return future ? 'next: n/a' : 'last: never'
  const now = Date.now()
  const t = new Date(iso).getTime()
  const diff = t - now
  const abs = Math.abs(diff)
  const m = 60000
  const h = 3600000
  const d = 86400000
  let v = 0
  let u = 'm'
  if (abs >= d) { v = Math.round(abs / d); u = 'd' }
  else if (abs >= h) { v = Math.round(abs / h); u = 'h' }
  else { v = Math.max(1, Math.round(abs / m)); u = 'm' }
  return future ? (diff >= 0 ? `next: in ${v}${u}` : `next: ${v}${u} ago`) : (diff < 0 ? `last: ${v}${u} ago` : `last: in ${v}${u}`)
}

const loadAll = async () => {
  if (!authPassword?.value) return
  loading.value = true
  loadError.value = ''
  try {
    const [jRes, pRes] = await Promise.all([
      fetch('/api/workspaces/cron', { headers: headers() }),
      fetch('/api/workspaces/projects', { headers: headers() })
    ])

    if (!jRes.ok || !pRes.ok) {
      const code = `${jRes.status}/${pRes.status}`
      loadError.value = `Failed to load data (HTTP ${code}).`
      return
    }

    const j = await jRes.json()
    const p = await pRes.json()
    jobs.value = j.data || []
    projects.value = p.data || []
  } catch {
    loadError.value = 'Failed to load projects/jobs data.'
  } finally {
    loading.value = false
  }
}

const toggleJob = async (job: any, enabled: boolean) => {
  const id = job.id
  const prev = job.enabled
  job.enabled = enabled
  busyToggle.value[id] = true
  try {
    const res = await fetch(`/api/workspaces/cron/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })
    if (!res.ok) throw new Error('toggle failed')
  } catch {
    job.enabled = prev
  } finally {
    busyToggle.value[id] = false
  }
}

const toggleProjectCron = async (project: any, enabled: boolean) => {
  const cj = project.cronJob
  if (!cj?.id) return
  const prev = cj.enabled
  cj.enabled = enabled
  busyToggle.value[cj.id] = true
  try {
    const res = await fetch(`/api/workspaces/cron/${encodeURIComponent(cj.id)}/toggle`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })
    if (!res.ok) throw new Error('toggle failed')
  } catch {
    cj.enabled = prev
  } finally {
    busyToggle.value[cj.id] = false
  }
}

const runNow = async (job: any) => {
  const id = job.id
  if (!id) return
  busyRun.value[id] = true
  try {
    await fetch(`/api/workspaces/cron/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      headers: headers()
    })
  } finally {
    busyRun.value[id] = false
  }
}

onMounted(() => {
  if (authPassword?.value) loadAll()
})

watch(() => authPassword?.value, (v) => {
  if (v && !loading.value && jobs.value.length === 0 && projects.value.length === 0) {
    loadAll()
  }
})
</script>

<style scoped>
.pj-page {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  overflow: auto;
  padding-right: 2px;
  padding-bottom: 20px;
}
.header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
.section-head { font-family: var(--font-sans); font-weight: 800; margin-bottom: 10px; }
.error-card { border-color: rgba(255,92,122,.35); color: #ffb3c2; font-family: var(--font-mono); }
.grid { display: grid; gap: 8px; }
.jobs-grid { grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); }
.projects-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.group-stack { display: grid; gap: 12px; }
.group-title { font-family: var(--font-mono); color: #bfe8ff; font-size: .78rem; margin-bottom: 6px; }
.job-card, .project-card { border: 1px solid rgba(168,179,199,.18); background: rgba(255,255,255,.02); border-radius: 8px; padding: 10px; }
.card-top { display:flex; justify-content: space-between; gap:8px; align-items:center; margin-bottom:6px; }
.title-wrap { display:flex; align-items:center; gap:6px; min-width:0; }
.title-wrap strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .84rem; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); }
.status-dot.on { background: var(--accent-cyan); border-color: rgba(39,213,255,.7); }
.status-dot.off { background: rgba(168,179,199,.4); }
.status-dot.run { background: var(--accent-green); border-color: rgba(70,232,124,.75); }
.mono { font-family: var(--font-mono); font-size: .68rem; }
.one-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta-row { display:flex; justify-content: space-between; margin-top: 8px; color: var(--text-secondary); }
.actions { margin-top: 8px; display:flex; justify-content: space-between; align-items:center; gap:8px; }
.small { min-height: 30px; padding: 4px 8px; font-size: .72rem; }
.switch { display:inline-flex; align-items:center; gap:6px; font-family: var(--font-mono); font-size: .68rem; color: var(--text-secondary); }
.tags { display:flex; flex-wrap:wrap; gap:5px; margin-top: 8px; }
.tag { border: 1px solid rgba(39,213,255,.28); background: rgba(39,213,255,.08); color: #dff7ff; padding: 2px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: .64rem; }

@media (max-width: 768px) {
  .pj-page {
    padding-bottom: calc(140px + env(safe-area-inset-bottom));
    scroll-padding-bottom: calc(140px + env(safe-area-inset-bottom));
  }
  .group-stack::after {
    content: '';
    display: block;
    height: 28px;
  }
}
</style>
