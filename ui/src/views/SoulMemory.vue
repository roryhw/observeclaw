<template>
  <div class="soul-page">
    <header class="soul-header">
      <div class="agent-toggle-grid">
        <button
          v-for="a in agents"
          :key="a.id"
          class="agent-toggle-btn"
          :class="{ active: selectedAgent === a.id }"
          @click="selectAgent(a.id)"
        >
          {{ a.id.toUpperCase() }}
        </button>
      </div>
    </header>

    <div class="alerts-segmented oc-card" style="margin-bottom: 12px; padding:10px;">
      <button class="seg-btn" :class="{active: activeTab==='soul'}" @click="activeTab='soul'">SOUL</button>
      <button class="seg-btn" :class="{active: activeTab==='memory'}" @click="activeTab='memory'">MEMORY</button>
      <button class="seg-btn" :class="{active: activeTab==='identity'}" @click="activeTab='identity'" :disabled="!identityExists">IDENTITY</button>
    </div>

    <div class="grid">
      <div class="oc-card panel" v-if="activeTab==='soul'">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 class="text-magenta">SOUL.md</h3>
          <button class="neon-button" :disabled="savingSoul" @click="saveSoul">{{ savingSoul ? 'Saving...' : 'Save' }}</button>
        </div>
        <textarea v-model="soulText" class="editor"></textarea>
      </div>

      <div class="oc-card panel" v-if="activeTab==='memory'">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 class="text-cyan">MEMORY.md</h3>
          <button class="neon-button" :disabled="savingMemory" @click="saveMemory">{{ savingMemory ? 'Saving...' : 'Save' }}</button>
        </div>
        <textarea v-model="memoryText" class="editor"></textarea>
      </div>

      <div v-if="identityExists && activeTab==='identity'" class="oc-card panel">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 class="text-green">IDENTITY.md</h3>
          <button class="neon-button" :disabled="savingIdentity" @click="saveIdentity">{{ savingIdentity ? 'Saving...' : 'Save' }}</button>
        </div>
        <textarea v-model="identityText" class="editor"></textarea>
      </div>
    </div>

    <div v-if="status" class="status-line">{{ status }}</div>
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

const authPassword = inject('authPassword') as Ref<string>
const agents = ref<Array<{ id: string; name: string; workspace: string }>>([])
const selectedAgent = ref(localStorage.getItem('oc.soulMemory.agent') || 'main')
const activeTab = ref<'soul'|'memory'|'identity'>((localStorage.getItem('oc.soulMemory.tab') as any) || 'soul')

const soulText = ref('')
const memoryText = ref('')
const identityText = ref('')
const identityExists = ref(false)

const savingSoul = ref(false)
const savingMemory = ref(false)
const savingIdentity = ref(false)
const status = ref('')

const headers = () => ({ 'x-observeclaw-password': authPassword.value || '', 'content-type': 'application/json' })

async function getFile(path: string) {
  const res = await fetch(`/api/file?agent=${encodeURIComponent(selectedAgent.value)}&path=${encodeURIComponent(path)}`, { headers: headers() })
  if (!res.ok) return { exists: false, content: '' }
  const j = await res.json()
  return { exists: Boolean(j.exists), content: String(j.content || '') }
}

async function loadAgents() {
  const res = await fetch('/api/agents', { headers: headers() })
  if (!res.ok) return
  const json = await res.json()
  agents.value = json.data || []
  if (!agents.value.find(a => a.id === selectedAgent.value) && agents.value.length) {
    const first = agents.value[0]
    if (first) selectedAgent.value = first.id
  }
}

async function loadFiles() {
  const [soul, mem, ident] = await Promise.all([
    getFile('SOUL.md'),
    getFile('MEMORY.md'),
    getFile('IDENTITY.md')
  ])

  soulText.value = soul.content
  memoryText.value = mem.content
  identityText.value = ident.content
  identityExists.value = ident.exists
  if (!identityExists.value && activeTab.value === 'identity') activeTab.value = 'soul'

  status.value = ''
}

async function selectAgent(id: string) {
  if (selectedAgent.value === id) return
  selectedAgent.value = id
  await loadFiles()
}

async function postFile(path: string, content: string) {
  const res = await fetch('/api/file', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agent: selectedAgent.value, path, content })
  })
  return res.ok
}

async function saveSoul() {
  savingSoul.value = true
  try {
    const ok = await postFile('SOUL.md', soulText.value)
    status.value = ok ? 'SOUL.md saved' : 'Failed to save SOUL.md'
  } finally {
    savingSoul.value = false
  }
}

async function saveMemory() {
  savingMemory.value = true
  try {
    const ok = await postFile('MEMORY.md', memoryText.value)
    status.value = ok ? 'MEMORY.md saved' : 'Failed to save MEMORY.md'
  } finally {
    savingMemory.value = false
  }
}

async function saveIdentity() {
  savingIdentity.value = true
  try {
    const ok = await postFile('IDENTITY.md', identityText.value)
    status.value = ok ? 'IDENTITY.md saved' : 'Failed to save IDENTITY.md'
  } finally {
    savingIdentity.value = false
  }
}

onMounted(async () => {
  await loadAgents()
  await loadFiles()
})

watch(selectedAgent, (v) => {
  localStorage.setItem('oc.soulMemory.agent', v)
})

watch(activeTab, (v) => {
  localStorage.setItem('oc.soulMemory.tab', v)
})
</script>

<style scoped>
.soul-page {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.soul-header {
  margin-bottom: 8px;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.agent-toggle-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.agent-toggle-btn {
  min-height: 34px;
  border: 1px solid rgba(168,179,199,0.2);
  background: rgba(255,255,255,0.02);
  color: rgba(168,179,199,0.85);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: .72rem;
  font-weight: 700;
}
.agent-toggle-btn.active {
  border-color: rgba(73,166,255,.55);
  color: #e8f5ff;
  background: rgba(73,166,255,.14);
  box-shadow: 0 0 10px rgba(73,166,255,.24);
}
.grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1;
}
.panel {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.alerts-segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  padding: 4px !important;
  border: 1px solid rgba(168,179,199,0.2);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(14,18,26,0.96), rgba(12,16,22,0.96));
  overflow: hidden;
}

.seg-btn {
  min-height: 36px;
  border: none;
  border-radius: 0;
  border-right: 1px solid rgba(168,179,199,0.12);
  background: transparent;
  color: rgba(168,179,199,0.72);
  font-family: var(--font-sans);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  font-weight: 800;
  text-transform: uppercase;
  position: relative;
}

.seg-btn:last-child {
  border-right: none;
}

.seg-btn.active {
  color: #f4f8ff;
  background: rgba(255,255,255,0.01);
}

.seg-btn.active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: #49a6ff;
  box-shadow: 0 0 10px rgba(73,166,255,0.45);
}
.editor {
  width: 100%;
  flex: 1;
  min-height: 0;
  height: 100%;
  background: #07090c;
  color: #d8f7ff;
  border: 1px solid rgba(168,179,199,0.22);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.9rem;
  padding: 10px;
  resize: none;
}
.status-line {
  margin-top: 8px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
@media (max-width: 768px) {
  .alerts-segmented {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .seg-btn {
    min-height: 34px;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
  }
  .soul-header {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .agent-toggle-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .soul-page {
    padding-bottom: 0;
  }
  .grid {
    padding-bottom: 8px;
  }
  .editor {
    font-size: 0.82rem;
  }
}
</style>