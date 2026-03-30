<template>
  <div class="fv-page">
    <div class="oc-card fv-toolbar">
      <select v-model="agentId" class="neon-input agent-select">
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name || a.id }}</option>
      </select>
      <label class="hidden-toggle"><input type="checkbox" v-model="showHidden" /> Show hidden</label>
      <button class="neon-button" @click="goUp" :disabled="!canGoUp">Up</button>
      <button class="neon-button" @click="loadFiles(currentDir)">Refresh</button>
      <div class="path mono">/{{ currentDir === '/' ? '' : currentDir }}</div>
    </div>

    <div class="fv-layout">
      <div class="oc-card list-pane">
        <div v-if="loading" class="oc-muted">Loading…</div>
        <div v-else-if="items.length===0" class="oc-muted">Empty directory</div>
        <button v-for="i in items" :key="i.relativePath" class="item" @click="openItem(i)">
          <span class="name">{{ i.type==='dir' ? '📁' : '📄' }} {{ i.name }}</span>
          <span class="meta mono" v-if="i.type==='file'">{{ fileSize(i.size) }}</span>
        </button>
      </div>

      <div class="oc-card preview-pane">
        <div class="preview-head">
          <strong>{{ selectedPath || 'Select a file' }}</strong>
          <span class="oc-muted mono" v-if="selectedMeta">{{ selectedMeta }}</span>
        </div>
        <div v-if="previewLoading" class="oc-muted">Loading file…</div>
        <div v-else-if="imageUrl" class="image-preview-wrap">
          <img :src="imageUrl" :alt="selectedPath" class="image-preview" />
        </div>
        <div v-else-if="binary" class="oc-muted">Binary file preview not supported.</div>
        <pre v-else class="content">{{ content || 'Select a file to preview' }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

const authPassword = inject('authPassword') as Ref<string>
const headers = () => ({ 'x-observeclaw-password': authPassword.value || '' })

const agents = ref<any[]>([])
const agentId = ref('main')
const showHidden = ref(false)
const currentDir = ref('/')
const items = ref<any[]>([])
const loading = ref(false)

const selectedPath = ref('')
const selectedMeta = ref('')
const content = ref('')
const binary = ref(false)
const imageUrl = ref('')
const previewLoading = ref(false)

const imageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'image/avif'
])

const resetPreview = () => {
  selectedPath.value = ''
  selectedMeta.value = ''
  content.value = ''
  binary.value = false
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
}

const canGoUp = computed(() => currentDir.value !== '/' && currentDir.value !== '')

const fileSize = (n: number) => {
  const b = Number(n || 0)
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  if (b > 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${b} B`
}

const loadAgents = async () => {
  const res = await fetch('/api/agents', { headers: headers() })
  if (!res.ok) return
  const j = await res.json()
  agents.value = j.data || []
  if (!agents.value.find((a: any) => a.id === agentId.value) && agents.value[0]) agentId.value = agents.value[0].id
}

const loadFiles = async (dir = '/') => {
  loading.value = true
  try {
    const p = new URLSearchParams({ agent: agentId.value, dir: dir === '/' ? '' : dir, showHidden: showHidden.value ? '1' : '0' })
    const res = await fetch(`/api/artifacts/files?${p.toString()}`, { headers: headers() })
    if (!res.ok) return
    const j = await res.json()
    items.value = j.data || []
    currentDir.value = j.relativePath || '/'
  } finally { loading.value = false }
}

const openItem = async (i: any) => {
  if (i.type === 'dir') {
    await loadFiles(i.relativePath)
    return
  }
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
  selectedPath.value = i.relativePath
  selectedMeta.value = `${fileSize(i.size)} · ${new Date(i.updatedAt).toLocaleString()}`
  previewLoading.value = true
  try {
    const p = new URLSearchParams({ agent: agentId.value, path: i.relativePath })
    const res = await fetch(`/api/artifacts/file?${p.toString()}`, { headers: headers() })
    if (!res.ok) return
    const j = await res.json()
    const d = j.data || {}
    binary.value = !!d.isBinary
    content.value = d.content || ''
    const mimeType = String(d.mimeType || '')
    if (binary.value && imageMimeTypes.has(mimeType)) {
      const rawRes = await fetch(`/api/artifacts/file/raw?${p.toString()}`, { headers: headers() })
      if (rawRes.ok) {
        const blob = await rawRes.blob()
        imageUrl.value = URL.createObjectURL(blob)
      }
    }
    if (d.clipped && !binary.value) content.value += '\n\n[... preview clipped at 200KB ...]'
  } finally { previewLoading.value = false }
}

const goUp = async () => {
  if (!canGoUp.value) return
  const parts = currentDir.value.split('/').filter(Boolean)
  parts.pop()
  await loadFiles(parts.join('/'))
}

watch([agentId, showHidden], async () => {
  resetPreview()
  await loadFiles('/')
})

onMounted(async () => {
  await loadAgents()
  await loadFiles('/')
})
</script>

<style scoped>
.fv-page { min-height: 100%; display: flex; flex-direction: column; gap: 10px; }
.image-preview-wrap { display: flex; justify-content: center; align-items: flex-start; padding: 12px 0; }
.image-preview { max-width: 100%; max-height: 72vh; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.fv-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.agent-select { width: 180px; }
.hidden-toggle { font-family: var(--font-mono); font-size: .72rem; color: var(--text-secondary); display:flex; align-items:center; gap:6px; }
.path { margin-left: auto; color: #bfe8ff; font-size: .72rem; }
.fv-layout { display: grid; grid-template-columns: 360px 1fr; gap: 10px; min-height: 0; flex: 1; }
.list-pane, .preview-pane { min-height: 0; overflow: auto; }
.item { width: 100%; text-align: left; border: 1px solid rgba(168,179,199,.18); background: rgba(255,255,255,.02); color: var(--text-primary); border-radius: 6px; padding: 8px; margin-bottom: 6px; display:flex; justify-content: space-between; gap:8px; }
.item:hover { border-color: rgba(39,213,255,.35); background: rgba(39,213,255,.08); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: var(--text-secondary); font-size: .66rem; }
.preview-head { display:flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 8px; }
.content { white-space: pre-wrap; font-family: var(--font-mono); font-size: .74rem; color: #dce8f8; }
.mono { font-family: var(--font-mono); }
@media (max-width: 1100px) { .fv-layout { grid-template-columns: 1fr; } .path { width: 100%; margin-left: 0; } }
</style>
