import { createRouter, createWebHistory } from 'vue-router'
import Overview from '../views/Overview.vue'
import ActivityStreamV2 from '../views/ActivityStreamV2.vue'
import Audit from '../views/Audit.vue'
import Alerts from '../views/Alerts.vue'
import SoulMemory from '../views/SoulMemory.vue'
import Agents from '../views/Agents.vue'
import LogExplorer from '../views/LogExplorer.vue'
import ProjectsJobs from '../views/ProjectsJobs.vue'
import Conversations from '../views/Conversations.vue'
import FileViewer from '../views/FileViewer.vue'
import RetentionPolicy from '../views/RetentionPolicy.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'overview',
      component: Overview
    },
    {
      path: '/activity',
      name: 'activity',
      component: ActivityStreamV2
    },

    {
      path: '/audit',
      name: 'audit',
      component: Audit
    },
    {
      path: '/retention',
      name: 'retention',
      component: RetentionPolicy
    },
    {
      path: '/alerts',
      name: 'alerts',
      component: Alerts
    },
    {
      path: '/agents',
      name: 'agents',
      component: Agents
    },
    {
      path: '/log-explorer',
      name: 'log-explorer',
      component: LogExplorer
    },
    {
      path: '/projects-jobs',
      name: 'projects-jobs',
      component: ProjectsJobs
    },
    {
      path: '/conversations',
      name: 'conversations',
      component: Conversations
    },
    {
      path: '/file-viewer',
      name: 'file-viewer',
      component: FileViewer
    },
    {
      path: '/soul-memory',
      name: 'soul-memory',
      component: SoulMemory
    }
  ]
})

export default router
