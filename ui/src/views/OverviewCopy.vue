<template>
  <div class="overview-page" :class="{ 'overview-next-page': isOverviewNext }">
    <div class="overview-shell">
      <div class="overview-top-stack">

        <!-- System Pulse — Hybrid: D gradient fade + A left edge + C breathing glow -->
        <div class="pulse-hero oc-card" :class="heroStateClass">
          <div class="pulse-hero-row1">
            <div class="pulse-hero-icon" :class="heroStateClass">
              <svg v-if="heroState === 'IDLE'" viewBox="0 0 24 24" class="pulse-hero-svg"><path d="M7 12h10M9 8h6M9 16h6"/></svg>
              <svg v-else-if="heroState === 'THINKING'" viewBox="0 0 24 24" class="pulse-hero-svg"><path d="M12 4a6 6 0 0 0-6 6c0 2.3 1.2 3.9 2.6 5.1.7.6 1.4 1.6 1.4 2.9h4c0-1.3.7-2.3 1.4-2.9C17.8 13.9 19 12.3 19 10a6 6 0 0 0-7-6z"/><path d="M10 21h4"/></svg>
              <svg v-else-if="heroState === 'BUILDING'" viewBox="0 0 24 24" class="pulse-hero-svg"><path d="M14 5l5 5-9 9H5v-5z"/><path d="M13 6l5 5"/></svg>
              <svg v-else-if="heroState === 'DEGRADED'" viewBox="0 0 24 24" class="pulse-hero-svg"><path d="M12 3l9 16H3z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>
              <svg v-else-if="heroState === 'DISCONNECTED'" viewBox="0 0 24 24" class="pulse-hero-svg"><path d="M10 13a3 3 0 0 1 0-4l2-2a3 3 0 0 1 4 4l-1 1"/><path d="M14 11a3 3 0 0 1 0 4l-2 2a3 3 0 1 1-4-4l1-1"/><path d="M3 21L21 3"/></svg>
              <svg v-else viewBox="0 0 24 24" class="pulse-hero-svg"><path d="M8 10h8M8 14h5"/><path d="M6 6h12a2 2 0 0 1 2 2v8l-3-2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>
            </div>
            <div class="pulse-hero-info">
              <div class="pulse-hero-state" :class="heroStateClass">{{ heroState }}</div>
              <div class="pulse-hero-activity">{{ heroActivity }}</div>
            </div>
            <div class="pulse-hero-kicker">SYSTEM PULSE</div>
          </div>
          <div class="pulse-hero-row2">
            <span class="heartbeat-chip">{{ heroAgent }}</span>
            <span class="heartbeat-chip chip-channel">{{ heroChannel }}</span>
            <span class="heartbeat-chip chip-model">{{ heroModelDisplay }}</span>
          </div>
        </div>
      </div>

      <div v-if="!glanceLoaded" class="glance-grid skeleton-grid">
        <div v-for="i in 6" :key="'skel-'+i" class="oc-card glance-card skeleton-card">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-body">
            <div class="skeleton-line skeleton-wide"></div>
            <div class="skeleton-line skeleton-medium"></div>
            <div class="skeleton-line skeleton-narrow"></div>
          </div>
        </div>
      </div>

      <div v-show="glanceLoaded" ref="glanceGridRef" class="glance-grid">
        <div v-for="cardId in cardOrder" :key="cardId" :data-card-id="cardId" class="glance-card-slot">

        <div v-if="cardId === 'alerts'" class="oc-card glance-card alerts-card" @click="openAlertsPage">
          <div class="alerts-header">
            <div class="alerts-header-left">
              <svg class="alerts-icon-shield" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2z" :fill="alertShieldFill" opacity="0.15" />
                <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2z" :stroke="alertShieldStroke" stroke-width="1.5" fill="none" />
              </svg>
              <div>
                <h3 class="oc-card-title">ALERTS</h3>
                <span class="alerts-status-text" :class="alertStatusChipClass">{{ alertStatusText }}</span>
              </div>
            </div>
            <div class="alerts-header-right">
              <svg class="alerts-header-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
                <polyline :points="alertSparklinePoints" class="sparkline-line" />
              </svg>
              <div class="alerts-header-count" :class="alertStatusChipClass">{{ glance.alerts.totalOpen }}</div>
            </div>
          </div>
          <div class="alerts-signal-list" v-if="glance.alerts.recent.length">
            <div v-for="(row, idx) in glance.alerts.recent.slice(0, 5)" :key="row.id"
              class="alert-signal-row" :class="`sev-${String(row.severity || 'info').toLowerCase()}`"
              :style="{ opacity: 1 - idx * 0.1 }">
              <div class="alert-signal-icon-wrap" :class="`sev-${String(row.severity || 'info').toLowerCase()}`">
                <!-- Error: octagon X -->
                <svg v-if="String(row.severity || '').toLowerCase() === 'error'" viewBox="0 0 20 20" fill="none">
                  <polygon points="6,1 14,1 19,6 19,14 14,19 6,19 1,14 1,6" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1" />
                  <line x1="7" y1="7" x2="13" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <line x1="13" y1="7" x2="7" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <!-- Warning: triangle ! -->
                <svg v-else-if="String(row.severity || '').toLowerCase() === 'warning'" viewBox="0 0 20 20" fill="none">
                  <polygon points="10,2 19,18 1,18" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
                  <line x1="10" y1="8" x2="10" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <circle cx="10" cy="15" r="0.8" fill="currentColor" />
                </svg>
                <!-- Info: circle i -->
                <svg v-else viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8.5" fill="currentColor" opacity="0.12" stroke="currentColor" stroke-width="1" />
                  <line x1="10" y1="9" x2="10" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <circle cx="10" cy="6.5" r="0.8" fill="currentColor" />
                </svg>
              </div>
              <div class="alert-signal-content">
                <span class="alert-signal-title">{{ row.title || 'Alert' }}</span>
                <span class="alert-signal-sub">{{ String(row.severity || 'info').toUpperCase() }} · {{ relativeTime(row.timestamp) }}</span>
              </div>
              <span class="alert-signal-age" :class="`sev-${String(row.severity || 'info').toLowerCase()}`">{{ relativeTime(row.timestamp) }}</span>
            </div>
          </div>
          <div v-else class="alerts-clear">
            <svg class="alerts-clear-shield" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2z" fill="rgba(86,217,125,0.08)" stroke="rgba(86,217,125,0.4)" stroke-width="1.5" />
              <polyline points="8,12.5 11,15.5 16,9.5" stroke="rgba(86,217,125,0.8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
            </svg>
            <div class="alerts-clear-text">
              <span class="alerts-clear-title">All Clear</span>
              <span class="alerts-clear-sub">No active alerts</span>
            </div>
          </div>
        </div>

        <div v-else-if="cardId === 'external-connections'" class="oc-card glance-card external-card external-card-clickable" @click="openExternalLog">
          <div class="card-topline">
            <h3 class="oc-card-title">EXTERNAL CONNECTIONS</h3>
          </div>
          <div class="ext-hero-row">
            <div class="ext-hero-stat">
              <span class="ext-hero-number">{{ glance.externalConnections.today }}</span>
              <span class="ext-hero-unit">today</span>
            </div>
            <div class="ext-hero-divider"></div>
            <div class="ext-hero-stat">
              <span class="ext-hero-number dim">{{ glance.externalConnections.totalWeek }}</span>
              <span class="ext-hero-unit">this week</span>
            </div>
          </div>
          <div class="external-chart-wrap">
            <svg class="external-chart" :viewBox="`0 0 ${extViewW} 50`">
              <defs>
                <linearGradient id="extAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="rgba(255,106,106,0.25)" />
                  <stop offset="100%" stop-color="rgba(255,106,106,0)" />
                </linearGradient>
                <linearGradient id="extLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="rgba(255,160,100,0.8)" />
                  <stop offset="50%" stop-color="rgba(255,60,60,1)" />
                  <stop offset="100%" stop-color="rgba(255,100,160,0.8)" />
                </linearGradient>
                <filter id="dotGlow">
                  <feGaussianBlur stdDeviation="1.5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <line v-for="gy in [12, 22, 32]" :key="gy" x1="0" :x2="extViewW" :y1="gy" :y2="gy" class="ext-grid-line" />
              <polygon :points="extAreaPoints" fill="url(#extAreaGrad)" />
              <polyline :points="externalChartPolyline" class="ext-chart-line" fill="none" />
              <g v-for="(pt, idx) in externalChartData" :key="idx">
                <circle :cx="pt.x" :cy="pt.y" r="6" class="ext-peak-glow" />
                <circle
                  :cx="pt.x"
                  :cy="pt.y"
                  r="4.6"
                  class="ext-chart-dot"
                  :class="{ peak: pt.isPeak, today: pt.isToday }"
                  fill="rgba(0, 0, 0, 0.92)"
                  :stroke="pt.isPeak || pt.isToday ? 'rgba(255, 92, 122, 1)' : 'rgba(255, 92, 122, 0.92)'"
                  stroke-width="1"
                />
                <text :x="pt.x" :y="pt.y + 0.5" class="ext-chart-dot-value">{{ pt.total }}</text>
                <text :x="pt.x" :y="47" class="ext-chart-day-label" :class="{ active: pt.isToday }">{{ pt.label }}</text>
              </g>
            </svg>
          </div>
          <div class="external-footer" v-if="glance.externalConnections.topConnection">
            <div class="ext-footer-inner">
              <div class="ext-footer-icon">⬡</div>
              <div class="ext-footer-text">
                <span class="ext-footer-host">{{ glance.externalConnections.topConnection.label }}</span>
                <span class="ext-footer-meta">{{ glance.externalConnections.topConnection.count }} connections · top destination</span>
              </div>
            </div>
          </div>
          <div class="external-footer" v-else>
            <div class="empty-line">No external connections recorded.</div>
          </div>
        </div>

        <button v-else-if="cardId === 'cron-jobs'" class="oc-card glance-card cron-option-card cron-opt-a cron-option-preview" @click="openProjectsJobsPage">
          <div class="card-topline">
            <h3 class="oc-card-title">CRON AUTOMATIONS</h3>
            <span class="status-chip neutral">{{ glance.cron.total }} TOTAL</span>
          </div>
          <div class="cron-opt-hero cron-opt-hero-centered-groups cron-opt-hero-tight">
            <div class="cron-opt-group">
              <span class="cron-opt-number cron-opt-number-active">{{ glance.cron.enabled }}</span>
              <span class="cron-opt-unit cron-opt-unit-small">ACTIVE</span>
            </div>
            <div class="cron-opt-group">
              <span class="cron-opt-number cron-opt-number-paused">{{ glance.cron.total - glance.cron.enabled }}</span>
              <span class="cron-opt-unit cron-opt-unit-small">PAUSED</span>
            </div>
          </div>
          <div class="cron-schedule-stack">
            <div class="cron-beans-preview cron-schedule-row">
              <div class="cron-bean-preview cron-bean-schedule cron-bean-schedule-cyan">
                <span class="cron-bean-time">SCHEDULE:</span>
              </div>
            </div>
            <div class="cron-beans-preview cron-beans-preview-grid">
            <template v-for="(job, idx) in cronPreviewJobsLimited" :key="`live-preview-${job.id}`">
              <div
                v-if="!job.isOverflow"
                class="cron-bean-preview"
                :class="{ enabled: job.enabled, disabled: !job.enabled, 'tooltip-right': isRightAlignedBean(idx) }"
                :title="`${job.name} · ${job.nextRunLabel} · ${job.enabled ? 'enabled' : 'paused'}`"
              >
                <span v-if="job.enabled" class="cron-bean-time">{{ job.timeLabel }}</span>
                <span v-else class="cron-bean-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" fill="none">
                    <rect x="4" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                    <rect x="9.5" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                  </svg>
                </span>
                <div class="cron-bean-tooltip">
                  <div class="cron-bean-tooltip-name">{{ job.name }}</div>
                  <div>{{ job.enabled ? 'Enabled' : 'Paused' }}</div>
                  <div>Next: {{ job.nextRunLabel }}</div>
                  <div v-if="job.lastRunLabel">Last: {{ job.lastRunLabel }}</div>
                  <div v-if="job.schedule">{{ job.schedule }}</div>
                </div>
              </div>
              <div v-else class="cron-bean-preview cron-bean-overflow">
                <span class="cron-bean-time">+{{ job.overflowCount }}</span>
              </div>
            </template>
            </div>
          </div>
        </button>

        <div v-else-if="cardId === 'resource-pressure'" class="oc-card glance-card pressure-option-card">
          <div class="card-topline"><h3 class="oc-card-title">RESOURCE PRESSURE</h3></div>
          <div class="pressure-towers-wrap pressure-towers-wide-wrap">
            <div class="pressure-tower-card pressure-wide-card">
              <div class="pressure-wide-meta">
                <svg class="pressure-meta-icon mem-icon" viewBox="0 0 32 32" fill="none">
                  <rect x="5" y="9" width="22" height="14" rx="3" stroke="currentColor" stroke-width="1.8" fill="rgba(39,213,255,0.08)" />
                  <rect x="9" y="13" width="14" height="6" rx="1.5" fill="currentColor" opacity="0.24" />
                  <path d="M10 6v3M14 6v3M18 6v3M22 6v3M10 23v3M14 23v3M18 23v3M22 23v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <div class="pressure-meta-copy">
                  <div class="pressure-tower-value">{{ formatBytes(glance.memory.total) }}</div>
                  <div class="pressure-tower-label">MEMORY</div>
                </div>
              </div>
              <div class="pressure-tower pressure-tower-data-inner pressure-tower-wide">
                <div class="pressure-tower-fill mem-fill pressure-tower-fill-data" :style="{ height: `${100 - glance.memory.percentUsed}%` }">
                  <div class="pressure-fill-copy">
                    <strong>{{ 100 - glance.memory.percentUsed }}%</strong>
                    <span>{{ formatBytes(glance.memory.total - glance.memory.used) }} free</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="pressure-tower-card pressure-wide-card">
              <div class="pressure-wide-meta">
                <svg class="pressure-meta-icon storage-icon" viewBox="0 0 32 32" fill="none">
                  <ellipse cx="16" cy="8" rx="9" ry="4" stroke="currentColor" stroke-width="1.8" fill="rgba(157,109,255,0.08)" />
                  <path d="M7 8v11c0 2.2 4 4 9 4s9-1.8 9-4V8" stroke="currentColor" stroke-width="1.8" fill="rgba(157,109,255,0.05)" />
                  <path d="M7 13c0 2.2 4 4 9 4s9-1.8 9-4" stroke="currentColor" stroke-width="1.4" opacity="0.7" />
                </svg>
                <div class="pressure-meta-copy">
                  <div class="pressure-tower-value">{{ formatBytes(glance.storage.total) }}</div>
                  <div class="pressure-tower-label">STORAGE</div>
                </div>
              </div>
              <div class="pressure-tower pressure-tower-data-inner pressure-tower-wide">
                <div class="pressure-tower-fill storage-fill pressure-tower-fill-data" :style="{ height: `${100 - glance.storage.percentUsed}%` }">
                  <div class="pressure-fill-copy">
                    <strong>{{ 100 - glance.storage.percentUsed }}%</strong>
                    <span>{{ formatBytes(glance.storage.free) }} free</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="cardId === 'uptime'" class="oc-card glance-card uptime-rows-card">
          <div class="card-topline uptime-topline">
            <h3 class="oc-card-title">HOST RUNTIME</h3>
            <div class="uptime-topline-right">
              <span v-if="hostHostnameLine" class="status-chip neutral uptime-top-chip">{{ hostHostnameLine }}</span>
              <span v-if="hostIpLine" class="status-chip neutral uptime-top-chip">{{ hostIpLine }}</span>
            </div>
          </div>
          <div class="uptime-rows-wrap">
            <div class="uptime-row host-row">
              <div class="uptime-row-head">
                <svg class="uptime-row-icon host-color" viewBox="0 0 32 32" fill="none">
                  <rect x="3" y="5" width="26" height="16" rx="3" stroke="currentColor" stroke-width="1.6" fill="rgba(39,213,255,0.06)" />
                  <line x1="3" y1="11" x2="29" y2="11" stroke="rgba(39,213,255,0.3)" stroke-width="0.8" />
                  <circle cx="7" cy="8" r="1.1" fill="currentColor" />
                  <circle cx="10.5" cy="8" r="1.1" fill="rgba(39,213,255,0.55)" />
                  <circle cx="14" cy="8" r="1.1" fill="rgba(39,213,255,0.35)" />
                  <line x1="16" y1="21" x2="10" y2="26" stroke="rgba(39,213,255,0.45)" stroke-width="1.3" stroke-linecap="round" />
                  <line x1="16" y1="21" x2="22" y2="26" stroke="rgba(39,213,255,0.45)" stroke-width="1.3" stroke-linecap="round" />
                  <line x1="8" y1="26" x2="24" y2="26" stroke="rgba(39,213,255,0.45)" stroke-width="1.3" stroke-linecap="round" />
                </svg>
                <div class="uptime-row-labels">
                  <span class="uptime-row-name host-color">HOST</span>
                  <span class="uptime-row-sub">{{ hostOsLabel }}</span>
                </div>
              </div>
              <div class="uptime-row-time host-glow">{{ uptimeHostParts.days }}d {{ uptimeHostParts.hours }}h {{ uptimeHostParts.mins }}m</div>
              <div class="uptime-row-heat">
                <div v-for="n in 16" :key="`host-heat-${n}`" class="uptime-strip-cell host-strip on"></div>
              </div>
            </div>

            <div class="uptime-row oc-row">
              <div class="uptime-row-head">
                <svg class="uptime-row-icon oc-color" viewBox="0 0 32 32" fill="none">
                  <path d="M8,10 C4,7 1,12 4,16.5 C6.5,20.5 10,18 10,16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="rgba(255,140,90,0.08)"/>
                  <path d="M24,10 C28,7 31,12 28,16.5 C25.5,20.5 22,18 22,16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="rgba(255,140,90,0.08)"/>
                  <path d="M10,16 Q12,21 16,23 Q20,21 22,16" stroke="rgba(255,140,90,0.65)" stroke-width="1.6" stroke-linecap="round" fill="rgba(255,140,90,0.05)"/>
                  <circle cx="12" cy="13" r="1.5" fill="currentColor"/>
                  <circle cx="20" cy="13" r="1.5" fill="currentColor"/>
                  <path d="M13,27 L16,23 L19,27" stroke="rgba(255,140,90,0.45)" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
                <div class="uptime-row-labels">
                  <span class="uptime-row-name oc-color">OPENCLAW</span>
                  <span class="uptime-row-sub">{{ openclawPidLine || 'PID —' }}</span>
                </div>
              </div>
              <div class="uptime-row-time oc-glow">{{ uptimeOcParts.days }}d {{ uptimeOcParts.hours }}h {{ uptimeOcParts.mins }}m</div>
              <div class="uptime-row-heat">
                <div
                  v-for="n in 16"
                  :key="`oc-heat-${n}`"
                  class="uptime-strip-cell oc-strip"
                  :class="{ on: n <= Math.max(2, Math.round(uptimeOcPercent / 6.25)) }"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="cardId === 'models'" class="oc-card glance-card models-option-card models-matrix-card">
          <div class="card-topline"><h3 class="oc-card-title">MODELS</h3></div>
          <div class="models-table-wrap">
            <div class="models-table-head">
              <div class="models-col-model">MODEL</div>
              <div class="models-col-agent">DOT</div>
              <div class="models-col-agent">O2</div>
              <div class="models-col-agent">SWE</div>
            </div>
            <div v-for="model in configuredModels" :key="`table-${model.id}`" class="models-table-row">
              <div class="models-col-model">
                <div class="models-table-name">{{ model.label }}</div>
                <div class="models-table-sub">{{ [model.alias || model.provider, ...model.chips.filter(c => c === 'DEFAULT' || c === 'HEARTBEAT')].join(' · ') }}</div>
              </div>
              <div class="models-col-agent"><span class="models-dot" :class="{ active: model.chips.includes('DOT') }"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="currentColor" /></svg></span></div>
              <div class="models-col-agent"><span class="models-dot" :class="{ active: model.chips.includes('O2') }"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="currentColor" /></svg></span></div>
              <div class="models-col-agent"><span class="models-dot" :class="{ active: model.chips.includes('SWE') }"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="currentColor" /></svg></span></div>
            </div>
          </div>
        </div>

        <div v-else-if="cardId === 'capabilities-options'" class="oc-card glance-card capabilities-review-card capabilities-matrix-review-card">
          <div class="card-topline"><h3 class="oc-card-title">CAPABILITIES</h3></div>
          <div class="cap-directory-grid">
            <div class="cap-directory-col">
              <div class="cap-review-matrix-head cap-review-matrix-row cap-directory-head">
                <div class="cap-review-matrix-name">SKILL</div>
                <div v-for="col in capabilityDirectoryColumns" :key="`skill-${col}`" class="cap-review-matrix-cell head">{{ col }}</div>
              </div>
              <div v-for="skill in capabilitySkillMatrixRows" :key="skill.name" class="cap-review-matrix-row cap-directory-row">
                <div class="cap-review-matrix-name">
                  <span class="cap-live-dot" :class="`accent-dot-${skill.accent}`"></span>
                  <span>{{ skill.name }}</span>
                </div>
                <div v-for="col in capabilityDirectoryColumns" :key="`${skill.name}-${col}`" class="cap-review-matrix-cell">
                  <span v-if="skill.cols.includes(col)" class="cap-review-matrix-on"></span>
                  <span v-else class="cap-review-matrix-off"></span>
                </div>
              </div>
            </div>
            <div class="cap-directory-col">
              <div class="cap-review-matrix-head cap-review-matrix-row cap-directory-head">
                <div class="cap-review-matrix-name">PLUGIN</div>
                <div v-for="col in capabilityDirectoryColumns" :key="`plugin-${col}`" class="cap-review-matrix-cell head">{{ col }}</div>
              </div>
              <div v-for="plugin in capabilityPluginMatrixRows" :key="plugin.name" class="cap-review-matrix-row cap-directory-row">
                <div class="cap-review-matrix-name">
                  <span class="cap-live-dot" :class="`accent-dot-${plugin.accent}`"></span>
                  <span>{{ plugin.name }}</span>
                </div>
                <div v-for="col in capabilityDirectoryColumns" :key="`${plugin.name}-${col}`" class="cap-review-matrix-cell">
                  <span v-if="plugin.cols.includes(col)" class="cap-review-matrix-on"></span>
                  <span v-else class="cap-review-matrix-off"></span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="cardId === 'work-output'" class="oc-card glance-card work-card">
          <div class="card-topline">
            <h3 class="oc-card-title">WORK OUTPUT</h3>
          </div>
          <div class="hg-table">
            <div v-for="(row, ri) in heatGridData" :key="'e-'+ri" class="hg-row hg-row-clickable" @click="openWorkLog(row.metric)">
              <div class="hg-row-icon-wrap">
                <svg viewBox="0 0 24 24" class="hg-row-icon" :style="{ color: row.color }">
                  <!-- Shell: terminal prompt -->
                  <template v-if="row.metric === 'shellCmds'">
                    <rect x="2" y="3" width="20" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <polyline points="6,10 10,13 6,16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <line x1="13" y1="16" x2="18" y2="16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  </template>
                  <!-- Files: document with pencil -->
                  <template v-if="row.metric === 'fileMutations'">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <polyline points="14,2 14,8 20,8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                    <line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                  </template>
                  <!-- Web: globe -->
                  <template v-if="row.metric === 'webResearch'">
                    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <ellipse cx="12" cy="12" rx="4" ry="9.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
                    <line x1="2.5" y1="12" x2="21.5" y2="12" stroke="currentColor" stroke-width="1.2"/>
                    <path d="M4,7.5 Q12,9 20,7.5" fill="none" stroke="currentColor" stroke-width="1"/>
                    <path d="M4,16.5 Q12,15 20,16.5" fill="none" stroke="currentColor" stroke-width="1"/>
                  </template>
                  <!-- Browser: window/compass -->
                  <template v-if="row.metric === 'browserActions'">
                    <rect x="2" y="3" width="20" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="2" y1="9" x2="22" y2="9" stroke="currentColor" stroke-width="1.3"/>
                    <circle cx="5.5" cy="6" r="1" fill="currentColor"/>
                    <circle cx="8.5" cy="6" r="1" fill="currentColor"/>
                    <circle cx="11.5" cy="6" r="1" fill="currentColor"/>
                    <rect x="6" y="12" width="12" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>
                  </template>
                </svg>
                <span class="hg-row-label" :style="{ color: row.color }">{{ row.label }}</span>
              </div>
              <div v-for="(cell, ci) in row.cells" :key="ci" class="hge-cell">
                <div class="hge-fill"
                  :style="{
                    width: Math.max(cell.intensity > 0 ? 20 : 0, cell.intensity * 100) + '%',
                    height: Math.max(cell.intensity > 0 ? 20 : 0, cell.intensity * 100) + '%',
                    background: 'transparent',
                    border: cell.intensity > 0 ? `2px solid rgba(255, 92, 122, ${0.22 + cell.intensity * 0.55})` : '2px solid rgba(255,255,255,0.08)',
                    boxShadow: cell.intensity > 0 ? `0 0 4px rgba(255, 92, 122, ${0.08 + cell.intensity * 0.18})` : 'none'
                  }">
                </div>
                <span v-if="cell.value" class="hge-value">{{ cell.value }}</span>
              </div>
            </div>
            <div class="hg-day-row">
              <div class="hg-row-icon-wrap"></div>
              <div v-for="(cell, ci) in (heatGridData[0]?.cells || [])" :key="ci" class="hg-day-label" :class="{ active: cell.isToday }">{{ cell.dayLabel }}</div>
            </div>
          </div>
        </div>

        </div><!-- /glance-card-slot v-for -->
      </div>


    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Sortable from 'sortablejs'
import type { Ref } from 'vue'

const DEFAULT_CARD_ORDER = [
  'work-output',
  'external-connections',
  'alerts',
  'cron-jobs',
  'resource-pressure',
  'uptime',
  'models',
  'capabilities-options'
] as const

const route = useRoute()
const isOverviewNext = computed(() => route.path.startsWith('/overview-next'))
const cardOrderStorageKey = computed(() => isOverviewNext.value ? 'glance-card-order-overview-next' : 'glance-card-order')

function loadCardOrder(storageKey: string): string[] {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      // Validate: must contain exactly the same IDs
      const defaultSet = new Set(DEFAULT_CARD_ORDER)
      const storedSet = new Set(parsed)
      if (defaultSet.size === storedSet.size && [...defaultSet].every(id => storedSet.has(id))) {
        return parsed
      }
    }
  } catch { /* ignore */ }
  return [...DEFAULT_CARD_ORDER]
}

const cardOrder = ref<string[]>(loadCardOrder(cardOrderStorageKey.value))
watch(cardOrderStorageKey, (nextKey) => {
  cardOrder.value = loadCardOrder(nextKey)
})
const glanceGridRef = ref<HTMLElement | null>(null)
let sortableInstance: Sortable | null = null

const events = inject('events') as Ref<any[]>
const activeAgents = inject('activeAgents') as Ref<Record<string, any>>
const authPassword = inject('authPassword') as Ref<string>
const wsConnected = inject('wsConnected') as Ref<boolean>
const router = useRouter()

const pulseStates = new Set(['IDLE', 'THINKING', 'BUILDING', 'COLLABORATING', 'DEGRADED', 'DISCONNECTED'])
const pulseSnapshot = ref<any>(null)
const lastKnownHeroModel = ref('')
const lastKnownHeroProvider = ref('')
const lastActiveHeroAgentId = ref('')
const lastActiveHeroChannel = ref('')
const lastActiveContext = ref<{ agentId: string; channel: string; model: string }>({ agentId: '', channel: '', model: '' })

const glance = ref({
  alerts: { totalOpen: 0, recent: [] as any[] },
  version: { current: 'Unknown', installed: 'Unknown', updateAvailable: null as boolean | null, latest: null as string | null, status: 'pending', checkedAt: null as string | null },
  cron: { total: 0, enabled: 0, nextRunAt: null as string | null },
  externalConnections: { today: 0, totalWeek: 0, daily: [] as Array<{ label: string; shortLabel?: string; total: number; destinations: number }>, topConnection: null as null | { label: string; count: number } },
  memory: { used: 0, total: 0, percentUsed: 0 },
  storage: { free: 0, total: 0, used: 0, percentUsed: 0 },
  uptime: { hostSeconds: 0, openclawSeconds: 0, hostname: '', localIp: '', openclawPid: null as number | null },
  activity: { daily: [] as Array<{ label: string; shortLabel?: string; toolCalls: number; modelCalls: number; conversationTurns: number; shellCmds: number; fileMutations: number; webResearch: number; browserActions: number }> }
})

const glanceLoaded = ref(false)
const versionStatus = ref<{ current: string; installed: string; latest: string | null; updateAvailable: boolean | null; status: string; checkedAt: string | null; source?: string | null; error?: string | null } | null>(null)
const cronJobsPreview = ref<Array<{ id: string; name: string; enabled: boolean; schedule?: string | null; lastRunAt?: string | null; nextRunAt?: string | null }>>([])
const versionStatusLoading = ref(false)
const memoryTrend = ref<number[]>([])
const storageTrend = ref<number[]>([])
const alertTrend = ref<number[]>([])

const humanizeReason = (r: string) => {
  const m: Record<string, string> = {
    runtime_unreachable: 'Runtime unreachable',
    telemetry_stale: 'Telemetry stale',
    tool_activity: 'Executing tool work',
    model_active: 'Model is generating',
    message_flow: 'Message flow active',
    no_active_work: 'No active work'
  }
  return m[String(r || '')] || 'No active work'
}

const applyPulseEvent = (evt: any) => {
  if (!evt) return
  if (evt.type === 'pulse.snapshot') {
    const d = typeof evt.data === 'string' ? (() => { try { return JSON.parse(evt.data) } catch { return null } })() : evt.data
    if (d && typeof d === 'object') pulseSnapshot.value = d
    return
  }
  if (evt.type === 'pulse.update') {
    const d = typeof evt.data === 'string' ? (() => { try { return JSON.parse(evt.data) } catch { return null } })() : evt.data
    if (!d || typeof d !== 'object') return
    const snap = pulseSnapshot.value
    if (!snap || typeof snap !== 'object') return

    if (d.scope === 'system' && snap.system) {
      pulseSnapshot.value = {
        ...snap,
        system: {
          ...snap.system,
          state: d.state || snap.system.state,
          reason: d.reason || snap.system.reason,
          stateSince: d.stateSince || snap.system.stateSince
        },
        computedAt: evt.timestamp || new Date().toISOString()
      }
    } else if (d.scope === 'agent' && Array.isArray(snap.agents) && d.agentId) {
      pulseSnapshot.value = {
        ...snap,
        agents: snap.agents.map((a: any) => String(a?.id) !== String(d.agentId) ? a : ({ ...a, state: d.state || a.state, reason: d.reason || a.reason, stateSince: d.stateSince || a.stateSince })),
        computedAt: evt.timestamp || new Date().toISOString()
      }
    }
  }
}

const fetchPulse = async () => {
  try {
    const res = await fetch('/api/pulse', { headers: { 'x-observeclaw-password': authPassword.value || '' } })
    if (!res.ok) return
    pulseSnapshot.value = await res.json()
  } catch {}
}

const heroState = computed(() => {
  const raw = String(pulseSnapshot.value?.system?.state || 'IDLE').toUpperCase()
  return pulseStates.has(raw) ? raw : 'IDLE'
})
const heroStateClass = computed(() => `state-${heroState.value.toLowerCase()}`)
const heroActivity = computed(() => humanizeReason(String(pulseSnapshot.value?.system?.reason || 'no_active_work')))

const heroAgent = computed(() => {
  const agents = Array.isArray(pulseSnapshot.value?.agents) ? pulseSnapshot.value.agents : []
  const preferred = lastActiveHeroAgentId.value
  const active = agents.find((a: any) => String(a?.id || '') === preferred) || agents.find((a: any) => String(a?.state || '').toUpperCase() !== 'IDLE') || agents[0]
  return String(active?.label || active?.id || 'NO AGENT')
})

const heroChannel = computed(() => {
  const contextChannel = String(lastActiveContext.value?.channel || lastActiveHeroChannel.value || '')
  return contextChannel ? contextChannel.toUpperCase() : 'NO CHANNEL'
})

const heroModelDisplay = computed(() => {
  const model = String(lastActiveContext.value?.model || lastKnownHeroModel.value || '')
  const provider = String(lastKnownHeroProvider.value || '')
  if (model && provider) return `${provider}/${model}`
  if (model) return model
  return 'NO MODEL'
})

const seenPulseEventKeys: string[] = []
const seenPulseEventSet = new Set<string>()
const pulseEventKey = (evt: any) => {
  const id = String(evt?.id || '')
  if (id) return `id:${id}`
  return `anon:${String(evt?.type || '')}:${String(evt?.timestamp || '')}:${String(evt?.summary || '')}`
}
const markPulseSeen = (evt: any) => {
  const key = pulseEventKey(evt)
  if (!key || seenPulseEventSet.has(key)) return false
  seenPulseEventSet.add(key)
  seenPulseEventKeys.push(key)
  if (seenPulseEventKeys.length > 600) {
    const drop = seenPulseEventKeys.shift()
    if (drop) seenPulseEventSet.delete(drop)
  }
  return true
}

watch(() => events.value.length, (len, oldLen) => {
  const nextLen = Number(len || 0)
  const prevLen = Number(oldLen || 0)
  if (nextLen <= 0) return
  const delta = prevLen > 0 ? Math.max(1, nextLen - prevLen) : Math.min(nextLen, 200)
  const batch = (events.value || []).slice(0, Math.min(delta, 250)).reverse()
  for (const evt of batch) {
    const type = String(evt?.type || '')
    if (type !== 'pulse.snapshot' && type !== 'pulse.update') continue
    if (!markPulseSeen(evt)) continue
    applyPulseEvent(evt)
  }
})

watch(() => activeAgents.value, (next) => {
  const list = Object.values(next || {}) as any[]
  const active = list.find((a: any) => String(a?.state || '').toUpperCase() !== 'IDLE') || list[0]
  if (!active) return
  if (active.id) lastActiveHeroAgentId.value = String(active.id)
  if (active.channel) lastActiveHeroChannel.value = String(active.channel)
  if (active.model) lastKnownHeroModel.value = String(active.model)
  if (active.provider) lastKnownHeroProvider.value = String(active.provider)
  lastActiveContext.value = {
    agentId: String(active.id || ''),
    channel: String(active.channel || ''),
    model: String(active.model || '')
  }
}, { deep: true })

const pushTrend = (bucket: Ref<number[]>, value: number, limit = 24) => {
  bucket.value = [...bucket.value, Number(value || 0)].slice(-limit)
}

const fetchGlance = async () => {
  try {
    const res = await fetch('/api/glance', { headers: { 'x-observeclaw-password': authPassword.value || '' } })
    if (!res.ok) return
    const json = await res.json()
    const priorInstalled = String(glance.value?.version?.installed || glance.value?.version?.current || '')
    glance.value = json
    glanceLoaded.value = true
    pushTrend(memoryTrend, json?.memory?.percentUsed || 0)
    pushTrend(storageTrend, json?.storage?.percentUsed || 0)
    pushTrend(alertTrend, json?.alerts?.totalOpen || 0)
    const nextInstalled = String(json?.version?.installed || json?.version?.current || '')
    if (!versionStatus.value || (priorInstalled && nextInstalled && priorInstalled !== nextInstalled)) {
      void fetchVersionStatus()
    }
  } catch {}
}

const fetchVersionStatus = async () => {
  if (versionStatusLoading.value) return
  versionStatusLoading.value = true
  try {
    const res = await fetch('/api/openclaw/version-status')
    if (!res.ok) return
    versionStatus.value = await res.json()
  } catch {} finally {
    versionStatusLoading.value = false
  }
}


const alertStatusText = computed(() => {
  const items = glance.value.alerts.recent || []
  const hasCritical = items.some((row: any) => String(row?.severity || '').toLowerCase() === 'error')
  if (glance.value.alerts.totalOpen <= 0) return 'CLEAR'
  if (hasCritical) return 'CRITICAL'
  return 'WATCH'
})
const alertStatusChipClass = computed(() => alertStatusText.value === 'CRITICAL' ? 'danger' : alertStatusText.value === 'WATCH' ? 'warn' : 'ok')
const alertShieldFill = computed(() => alertStatusChipClass.value === 'danger' ? 'rgba(255,92,122,0.9)' : alertStatusChipClass.value === 'warn' ? 'rgba(255,179,71,0.9)' : 'rgba(86,217,125,0.9)')
const alertShieldStroke = computed(() => alertStatusChipClass.value === 'danger' ? 'rgba(255,92,122,0.8)' : alertStatusChipClass.value === 'warn' ? 'rgba(255,179,71,0.7)' : 'rgba(86,217,125,0.6)')
const formatCronRelative = (iso?: string | null, short = false) => {
  if (!iso) return short ? '—' : 'unknown'
  const diffMs = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(diffMs)) return short ? '—' : 'unknown'
  const absMins = Math.round(Math.abs(diffMs) / 60000)
  if (diffMs <= 0) return short ? 'now' : 'now'
  if (absMins < 60) return short ? `${absMins}m` : `in ${absMins} mins`
  const hours = Math.round(absMins / 60)
  if (hours < 48) return short ? `${hours}h` : `in ${hours} hrs`
  const days = Math.round(hours / 24)
  return short ? `${days}d` : `in ${days} days`
}

const cronPreviewJobs = computed(() => {
  const sorted = [...cronJobsPreview.value].sort((a, b) => {
    if (a.enabled !== b.enabled) return Number(b.enabled) - Number(a.enabled)
    const aNext = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Number.MAX_SAFE_INTEGER
    const bNext = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Number.MAX_SAFE_INTEGER
    return aNext - bNext
  })
  return sorted.map(job => ({
    ...job,
    timeLabel: formatCronRelative(job.nextRunAt, true),
    nextRunLabel: formatCronRelative(job.nextRunAt, false),
    lastRunLabel: job.lastRunAt ? formatCronRelative(job.lastRunAt, false).replace(/^in /, '') : '',
    isOverflow: false,
    overflowCount: 0
  }))
})

const cronPreviewJobsLimited = computed(() => {
  const maxBeans = 18
  if (cronPreviewJobs.value.length <= maxBeans) return cronPreviewJobs.value
  const visible = cronPreviewJobs.value.slice(0, maxBeans - 1)
  return [
    ...visible,
    {
      id: 'overflow',
      name: 'Overflow',
      enabled: false,
      schedule: null,
      lastRunAt: null,
      nextRunAt: null,
      timeLabel: '',
      nextRunLabel: '',
      lastRunLabel: '',
      isOverflow: true,
      overflowCount: cronPreviewJobs.value.length - visible.length
    }
  ]
})

const isRightAlignedBean = (idx: number) => idx % 6 >= 4

const sparklinePoints = (values: number[]) => {
  const list = values.length ? values : [0, 0, 0, 0]
  const max = Math.max(...list, 1)
  return list.map((v, i) => `${(i / Math.max(1, list.length - 1)) * 100},${28 - ((v / max) * 24 + 2)}`).join(' ')
}
const alertSparklinePoints = computed(() => sparklinePoints(alertTrend.value))

// Aligned external connection chart data
const dayColors = [
  'rgba(255, 100, 130, 0.95)',  // Sun — rose
  'rgba(255, 160, 80, 0.95)',   // Mon — orange
  'rgba(255, 220, 70, 0.95)',   // Tue — gold
  'rgba(100, 220, 140, 0.95)',  // Wed — green
  'rgba(80, 180, 255, 0.95)',   // Thu — blue
  'rgba(160, 120, 255, 0.95)',  // Fri — purple
  'rgba(255, 130, 200, 0.95)'   // Sat — pink
]
const externalChartData = computed(() => {
  const daily = glance.value.externalConnections.daily || []
  const vals = daily.map((r: any) => Number(r.total || 0))
  const max = Math.max(...vals, 1)
  const peakVal = Math.max(...vals)
  const colW = 24
  return vals.map((v, i) => {
    const labelMap: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, TODAY: new Date().getDay() }
    const rawLabel = (daily[i]?.shortLabel || daily[i]?.label || '').toUpperCase()
    const row = daily[i] as any
    const dayOfWeek = row?.dayOfWeek ?? labelMap[rawLabel] ?? new Date(row?.date || Date.now()).getDay()
    return {
      x: colW / 2 + i * colW,
      y: 34 - ((v / max) * 26 + 2),
      total: v,
      label: daily[i]?.shortLabel || daily[i]?.label || '',
      isPeak: v === peakVal && peakVal > 0,
      isToday: i === vals.length - 1,
      color: dayColors[dayOfWeek] || dayColors[0]
    }
  })
})
const extViewW = computed(() => externalChartData.value.length * 24)
const externalChartPolyline = computed(() => externalChartData.value.map(p => `${p.x},${p.y}`).join(' '))
const extAreaPoints = computed(() => {
  const pts = externalChartData.value
  if (!pts.length) return ''
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  return `${first.x},36 ${pts.map(p => `${p.x},${p.y}`).join(' ')} ${last.x},36`
})

const formatBytes = (n: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Number(n || 0)
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`
}

// Work metrics (4 self-normalized)
const workMetrics = ['shellCmds', 'fileMutations', 'webResearch', 'browserActions'] as const
const workLabels: Record<string, string> = { shellCmds: 'Shell', fileMutations: 'Files', webResearch: 'Web', browserActions: 'Browser' }
const workColors: Record<string, string> = {
  shellCmds: 'rgba(80, 180, 255, 0.9)',
  fileMutations: 'rgba(160, 120, 255, 0.9)',
  webResearch: 'rgba(255, 180, 60, 0.9)',
  browserActions: 'rgba(255, 100, 150, 0.9)'
}
// Heat grid: each metric row normalized to its own max
const heatGridData = computed(() => {
  const daily = glance.value.activity.daily || []
  return workMetrics.map(metric => {
    const vals = daily.map(d => (d as any)[metric] as number || 0)
    const max = Math.max(...vals, 1)
    return {
      metric,
      label: workLabels[metric],
      color: workColors[metric],
      cells: vals.map((v, i) => {
        const intensity = v / max
        const base = workColors[metric] || 'rgba(255,255,255,0.9)'
        const alpha = (0.08 + intensity * 0.82).toFixed(2)
        const bg = base.replace('0.9)', alpha + ')')
        const glow = intensity > 0.6 ? '0 0 8px ' + base.replace('0.9)', '0.25)') : 'none'
        return {
          value: v,
          intensity,
          dayLabel: daily[i]?.shortLabel || daily[i]?.label || '',
          isToday: i === daily.length - 1,
          bg,
          glow
        }
      })
    }
  })
})

// OC as percentage of host
const uptimeOcPercent = computed(() => {
  const host = Math.max(1, Number(glance.value.uptime.hostSeconds || 1))
  const oc = Math.max(0, Number(glance.value.uptime.openclawSeconds || 0))
  return Math.round(Math.min(100, (oc / host) * 100))
})

// Option C: split into padded day/hour/min parts
const uptimeParts = (seconds: number) => {
  let s = Math.max(0, Math.round(Number(seconds || 0)))
  const days = Math.floor(s / 86400); s %= 86400
  const hours = Math.floor(s / 3600); s %= 3600
  const mins = Math.floor(s / 60)
  return {
    days: String(days).padStart(2, '0'),
    hours: String(hours).padStart(2, '0'),
    mins: String(mins).padStart(2, '0')
  }
}
const uptimeHostParts = computed(() => uptimeParts(glance.value.uptime.hostSeconds))
const uptimeOcParts = computed(() => uptimeParts(glance.value.uptime.openclawSeconds))
const hostOsLabel = computed(() => 'macOS')
const hostHostnameLine = computed(() => String(glance.value.uptime.hostname || '').trim())
const hostIpLine = computed(() => String(glance.value.uptime.localIp || '').trim())
const openclawPidLine = computed(() => {
  const pid = glance.value.uptime.openclawPid
  return typeof pid === 'number' && Number.isFinite(pid) && pid > 0 ? `PID ${pid}` : ''
})

const configuredModels = computed(() => {
  const models = [
    { id: 'google/gemini-3-flash-preview', alias: 'gemini-flash', provider: 'Google', label: 'Gemini 3 Flash Preview', chips: ['DEFAULT', 'HEARTBEAT', 'DOT', 'O2'] },
    { id: 'google/gemini-3.1-pro-preview', alias: 'gemini-pro', provider: 'Google', label: 'Gemini 3.1 Pro Preview', chips: [] },
    { id: 'openai-codex/gpt-5.4', alias: 'codex', provider: 'OpenAI Codex', label: 'GPT-5.4', chips: [] },
    { id: 'openai-codex/gpt-5.3-codex', alias: null, provider: 'OpenAI Codex', label: 'GPT-5.3 Codex', chips: ['SWE'] },
    { id: 'anthropic/claude-opus-4-6', alias: 'opus', provider: 'Anthropic', label: 'Claude Opus 4.6', chips: [] }
  ]
  return models.map((m, idx) => ({ ...m, accent: ['cyan', 'violet', 'indigo', 'amber', 'rose'][idx % 5] }))
})

const capabilitySkills = [
  { name: '1password', accent: 'amber' },
  { name: 'gemini', accent: 'cyan' },
  { name: 'healthcheck', accent: 'rose' },
  { name: 'himalaya', accent: 'violet' },
  { name: 'node-connect', accent: 'indigo' },
  { name: 'skill-creator', accent: 'cyan' },
  { name: 'weather', accent: 'amber' }
]

const capabilityPlugins = [
  { name: 'Telegram', meta: 'live', accent: 'cyan' },
  { name: 'Browser', meta: 'enabled', accent: 'violet' },
  { name: 'Canvas', meta: 'enabled', accent: 'indigo' },
  { name: 'Memory', meta: 'enabled', accent: 'amber' },
  { name: 'Sessions', meta: 'enabled', accent: 'rose' },
  { name: 'Image/PDF', meta: 'enabled', accent: 'cyan' }
]

const capabilityDirectoryColumns = ['READ', 'ACT', 'LIVE']
const capabilitySkillMatrixRows = capabilitySkills.map((skill) => ({
  ...skill,
  cols: skill.name === 'weather'
    ? ['READ', 'ACT']
    : skill.name === 'skill-creator'
      ? ['READ', 'ACT']
      : ['READ']
}))
const capabilityPluginMatrixRows = capabilityPlugins.map((plugin) => ({
  ...plugin,
  cols: plugin.name === 'Memory'
    ? ['READ', 'LIVE']
    : plugin.name === 'Sessions'
      ? ['READ', 'ACT', 'LIVE']
      : plugin.name === 'Telegram'
        ? ['ACT', 'LIVE']
        : ['READ', 'ACT']
}))

const relativeTime = (iso: string) => {
  if (!iso) return '—'
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

const openAlertsPage = () => router.push('/alerts')
const openProjectsJobsPage = () => router.push('/projects-jobs')

const openExternalLog = () => {
  router.push({ path: '/log-explorer', query: { type: 'network.connect' } })
}

const workLogQueries: Record<string, string> = {
  shellCmds: 'exec',
  fileMutations: 'edit,write',
  webResearch: 'web_search,web_fetch',
  browserActions: 'browser'
}
const openWorkLog = (metric: string) => {
  router.push({
    path: '/log-explorer',
    query: { type: 'tool.invoke', q: workLogQueries[metric] || '', deep: 'true' }
  })
}

let glanceTimer: any = null
let pulseTimer: any = null
const glanceIntervalMs = 60000
const hiddenGlanceIntervalMs = 180000
const pulseFallbackIntervalMs = 15000
const hiddenPulseFallbackIntervalMs = 60000

const isDocumentHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
const clearTimers = () => {
  if (glanceTimer) clearInterval(glanceTimer)
  if (pulseTimer) clearInterval(pulseTimer)
  glanceTimer = null
  pulseTimer = null
}
const fetchCronPreview = async () => {
  try {
    const res = await fetch('/api/workspaces/cron')
    if (!res.ok) return
    const json = await res.json()
    cronJobsPreview.value = Array.isArray(json?.data) ? json.data : []
  } catch {}
}

const refreshOverview = async () => {
  await fetchGlance()
  void fetchCronPreview()
  if (!wsConnected?.value || isDocumentHidden()) await fetchPulse()
}
const schedulePolling = () => {
  clearTimers()
  const glanceMs = isDocumentHidden() ? hiddenGlanceIntervalMs : glanceIntervalMs
  glanceTimer = setInterval(() => { void fetchGlance() }, glanceMs)
  const shouldRunPulseFallback = !wsConnected?.value || isDocumentHidden()
  if (shouldRunPulseFallback) {
    const pulseMs = isDocumentHidden() ? hiddenPulseFallbackIntervalMs : pulseFallbackIntervalMs
    pulseTimer = setInterval(() => { void fetchPulse() }, pulseMs)
  }
}
const handleVisibilityChange = () => {
  void refreshOverview()
  schedulePolling()
}

watch(() => wsConnected?.value, () => schedulePolling())

onMounted(() => {
  try {
    const lastAgent = localStorage.getItem('oc.hero.lastAgentId') || ''
    const lastChannel = localStorage.getItem('oc.hero.lastChannel') || ''
    const lastModel = localStorage.getItem('oc.hero.lastModel') || ''
    const rawContext = localStorage.getItem('oc.hero.lastContext') || ''
    if (lastAgent) lastActiveHeroAgentId.value = lastAgent
    if (lastChannel) lastActiveHeroChannel.value = lastChannel
    if (lastModel) lastKnownHeroModel.value = lastModel
    if (rawContext) {
      try {
        const parsed = JSON.parse(rawContext)
        if (parsed && typeof parsed === 'object') {
          lastActiveContext.value = {
            agentId: String(parsed.agentId || lastAgent || ''),
            channel: String(parsed.channel || lastChannel || ''),
            model: String(parsed.model || lastModel || '')
          }
        }
      } catch {}
    }
  } catch {}
  void refreshOverview()
  nextTick(() => { setTimeout(() => { void fetchVersionStatus() }, 0) })
  schedulePolling()
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Init SortableJS for card reordering
  nextTick(() => {
    if (glanceGridRef.value) {
      sortableInstance = Sortable.create(glanceGridRef.value, {
        animation: 250,
        ghostClass: 'card-drag-ghost',
        chosenClass: 'card-drag-chosen',
        dragClass: 'card-drag-active',
        handle: '.glance-card-slot',
        delay: 200,
        delayOnTouchOnly: true,
        touchStartThreshold: 5,
        onEnd: (evt) => {
          if (evt.oldIndex != null && evt.newIndex != null && evt.oldIndex !== evt.newIndex) {
            const newOrder = [...cardOrder.value]
            const [moved] = newOrder.splice(evt.oldIndex, 1)
            if (moved) {
              newOrder.splice(evt.newIndex, 0, moved)
              cardOrder.value = newOrder
              localStorage.setItem(cardOrderStorageKey.value, JSON.stringify(newOrder))
            }
          }
        }
      })
    }
  })
})

onUnmounted(() => {
  if (sortableInstance) {
    sortableInstance.destroy()
    sortableInstance = null
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  clearTimers()
})
</script>

<style scoped>
.overview-page {
  display: flex;
  flex-direction: column;
}
.overview-next-page {
  --ovnext-type-title: 1.05rem;
  --ovnext-type-hero: 2rem;
  --ovnext-type-hero-secondary: 1.6rem;
  --ovnext-type-metric: 1.2rem;
  --ovnext-type-row-number: 1rem;
  --ovnext-type-name: 0.82rem;
  --ovnext-type-label: 0.72rem;
  --ovnext-type-meta: 0.66rem;
  --ovnext-type-dense: 0.6rem;
  --ovnext-type-dense-xs: 0.58rem;
}
.overview-next-page .cron-opt-number {
  font-size: var(--ovnext-type-hero);
}
.overview-next-page .cron-opt-unit,
.overview-next-page .cron-opt-unit-small,
.overview-next-page .pressure-tower-label,
.overview-next-page .pressure-panel-kicker,
.overview-next-page .pressure-heat-label,
.overview-next-page .pressure-meter-meta span,
.overview-next-page .ext-hero-unit,
.overview-next-page .uptime-row-name,
.overview-next-page .alert-signal-age,
.overview-next-page .cap-review-matrix-name {
  font-size: var(--ovnext-type-label);
}
.overview-next-page .alert-signal-title,
.overview-next-page .ext-footer-host,
.overview-next-page .pressure-tower-value,
.overview-next-page .model-row-name,
.overview-next-page .model-pill-title,
.overview-next-page .models-table-name,
.overview-next-page .hg-row-label {
  font-size: var(--ovnext-type-name);
}
.overview-next-page .alert-signal-sub,
.overview-next-page .ext-footer-meta,
.overview-next-page .pressure-fill-copy span,
.overview-next-page .uptime-row-sub,
.overview-next-page .model-pill-sub {
  font-size: var(--ovnext-type-meta);
}
.overview-next-page .ext-hero-number {
  font-size: var(--ovnext-type-hero);
}
.overview-next-page .ext-hero-number.dim {
  font-size: var(--ovnext-type-hero-secondary);
}
.overview-next-page .uptime-row-time,
.overview-next-page .pressure-tower-value,
.overview-next-page .pressure-meter-value,
.overview-next-page .pressure-panel-big {
  font-size: var(--ovnext-type-metric);
}
.overview-next-page .pressure-fill-copy strong {
  font-size: var(--ovnext-type-row-number);
}
.overview-next-page .models-table-head {
  font-size: var(--ovnext-type-dense);
}
.overview-next-page .models-table-sub,
.overview-next-page .hg-day-label,
.overview-next-page .cap-review-matrix-cell {
  font-size: var(--ovnext-type-dense-xs);
}

/* (old heartbeat-hero styles removed — using pulse-banner now) */

.heartbeat-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.28);
  background: rgba(0, 0, 0, 0.2);
  font-family: var(--font-mono);
  font-size: 0.69rem;
  letter-spacing: 0.02em;
  color: rgba(250, 252, 255, 0.96);
}

.heartbeat-chip.chip-model {
  border-color: rgba(255,255,255,0.4);
  background: rgba(0,0,0,0.26);
}

.heartbeat-chip.chip-channel {
  text-transform: lowercase;
  opacity: 0.92;
}

@keyframes hb-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.78; }
}
@keyframes hb-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* ═══ System Pulse — Hybrid (D fade + A left edge + C breathing glow) ═══ */
.pulse-hero {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 20px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 4px solid rgba(255,255,255,0.3);
  color: #f5f8ff;
  position: relative;
  overflow: hidden;
}
/* Left edge color per state (from A) */
.pulse-hero.state-idle { border-left-color: #39d98a; }
.pulse-hero.state-thinking { border-left-color: #45a8ff; }
.pulse-hero.state-building { border-left-color: #ffb347; }
.pulse-hero.state-collaborating { border-left-color: #9d6dff; }
.pulse-hero.state-degraded { border-left-color: #ff8a3d; }
.pulse-hero.state-disconnected { border-left-color: #ff4d6d; }
/* Gradient fade from left ~35% (from D) */
.pulse-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  right: 65%;
  pointer-events: none;
}
.pulse-hero::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(-35deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 8px);
}
.pulse-hero.state-idle::before { background: linear-gradient(90deg, rgba(57, 217, 138, 0.2) 0%, transparent 100%); }
.pulse-hero.state-thinking::before { background: linear-gradient(90deg, rgba(69, 168, 255, 0.2) 0%, transparent 100%); }
.pulse-hero.state-building::before { background: linear-gradient(90deg, rgba(255, 179, 71, 0.2) 0%, transparent 100%); }
.pulse-hero.state-collaborating::before { background: linear-gradient(90deg, rgba(157, 109, 255, 0.2) 0%, transparent 100%); }
.pulse-hero.state-degraded::before { background: linear-gradient(90deg, rgba(255, 138, 61, 0.2) 0%, transparent 100%); }
.pulse-hero.state-disconnected::before { background: linear-gradient(90deg, rgba(255, 77, 109, 0.2) 0%, transparent 100%); }

.pulse-hero-row1 {
  display: flex;
  align-items: center;
  gap: 14px;
  position: relative;
  z-index: 1;
}
/* Icon with breathing glow (from C) */
.pulse-hero-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.06);
  flex-shrink: 0;
  position: relative;
}
.pulse-hero-icon.state-idle { animation: ph-glow-idle 3s ease-in-out infinite; }
.pulse-hero-icon.state-thinking { animation: ph-glow-thinking 2.5s ease-in-out infinite; }
.pulse-hero-icon.state-building { animation: ph-glow-building 2s ease-in-out infinite; }
.pulse-hero-icon.state-collaborating { animation: ph-glow-collab 2.5s ease-in-out infinite; }
.pulse-hero-icon.state-degraded { animation: ph-glow-degraded 1.8s ease-in-out infinite; }
.pulse-hero-icon.state-disconnected { animation: ph-glow-disconnected 1.5s ease-in-out infinite; }
@keyframes ph-glow-idle {
  0%, 100% { box-shadow: 0 0 10px rgba(57,217,138,0.2); }
  50% { box-shadow: 0 0 22px rgba(57,217,138,0.5), 0 0 6px rgba(57,217,138,0.25); }
}
@keyframes ph-glow-thinking {
  0%, 100% { box-shadow: 0 0 10px rgba(69,168,255,0.2); }
  50% { box-shadow: 0 0 22px rgba(69,168,255,0.5), 0 0 6px rgba(69,168,255,0.25); }
}
@keyframes ph-glow-building {
  0%, 100% { box-shadow: 0 0 10px rgba(255,179,71,0.2); }
  50% { box-shadow: 0 0 22px rgba(255,179,71,0.5), 0 0 6px rgba(255,179,71,0.25); }
}
@keyframes ph-glow-collab {
  0%, 100% { box-shadow: 0 0 10px rgba(157,109,255,0.2); }
  50% { box-shadow: 0 0 22px rgba(157,109,255,0.5), 0 0 6px rgba(157,109,255,0.25); }
}
@keyframes ph-glow-degraded {
  0%, 100% { box-shadow: 0 0 10px rgba(255,138,61,0.2); }
  50% { box-shadow: 0 0 22px rgba(255,138,61,0.5), 0 0 6px rgba(255,138,61,0.25); }
}
@keyframes ph-glow-disconnected {
  0%, 100% { box-shadow: 0 0 10px rgba(255,77,109,0.2); }
  50% { box-shadow: 0 0 22px rgba(255,77,109,0.5), 0 0 6px rgba(255,77,109,0.25); }
}
.pulse-hero-svg {
  width: 22px; height: 22px;
  stroke: #fff; fill: none; stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round;
  position: relative; z-index: 1;
}
.pulse-hero-info { flex: 1; min-width: 0; }
.pulse-hero-state {
  font-size: 1.5rem; font-weight: 900; letter-spacing: -0.03em; line-height: 1; color: #fff;
}
.pulse-hero-activity {
  margin-top: 4px; font-size: 0.85rem; font-weight: 600;
  color: rgba(245,248,255,0.65);
}
.pulse-hero-kicker {
  font-family: var(--font-sans); font-weight: 800; font-size: 0.65rem;
  letter-spacing: 0.09em; color: rgba(245,248,255,0.35);
  align-self: flex-start; flex-shrink: 0;
}
.pulse-hero-row2 {
  display: flex; flex-wrap: wrap; gap: 6px;
  position: relative; z-index: 1;
}

.overview-header {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.overview-online {
  font-family: var(--font-mono);
  color: var(--accent-green);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  font-weight: 700;
}
.overview-shell {
  width: 100%;
  max-width: 1180px;
}
.overview-shell .oc-card {
  margin-bottom: 0;
}
.overview-top-stack {
  display: grid;
  gap: 12px;
  margin-bottom: 14px;
}
.glance-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  align-items: stretch;
}
.cron-options-section {
  margin-top: 18px;
}
.cron-options-header {
  margin-bottom: 10px;
}
.cron-options-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.cron-option-preview {
  width: 100%;
  text-align: left;
  overflow: visible;
}
.cron-option-card {
  min-height: 220px;
}
.cron-opt-hero {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 8px 0 4px;
}
.cron-opt-hero-centered-groups {
  justify-content: center;
  align-items: flex-end;
  gap: 25px;
}
.cron-opt-hero-tight {
  margin-bottom: 0;
}
.cron-opt-group {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.cron-opt-number {
  font-size: 2.3rem;
  font-weight: 800;
  line-height: 1;
  color: rgba(245,248,255,0.96);
}
.cron-opt-number-active {
  color: rgba(73, 166, 255, 0.98);
  text-shadow: 0 0 12px rgba(39, 213, 255, 0.2);
}
.cron-opt-number-paused {
  color: rgba(168, 179, 199, 0.92);
  text-shadow: 0 0 10px rgba(168, 179, 199, 0.12);
}
.cron-opt-unit {
  font-size: 0.92rem;
  color: rgba(245,248,255,0.66);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.cron-opt-unit-small {
  font-size: 0.78rem;
}
.cron-schedule-stack {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: -2px;
}
.cron-schedule-label {
  margin-top: 0;
  margin-bottom: 0;
  font-size: 0.92rem;
  color: rgba(245,248,255,0.66);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
}
.cron-opt-separator {
  font-size: 1.55rem;
  font-weight: 800;
  line-height: 1;
  color: rgba(245,248,255,0.9);
  margin: 0 2px;
}
.cron-pulse-strip {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 6px;
  margin-top: 16px;
}
.cron-pulse-strip-raised {
  margin-top: 8px;
}
.cron-bottom-subline {
  margin-top: 14px;
}
.cron-pulse-tick {
  height: 18px;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
}
.cron-pulse-tick.active {
  background: linear-gradient(180deg, rgba(86,217,125,0.55), rgba(86,217,125,0.95));
  box-shadow: 0 0 10px rgba(86,217,125,0.18);
}
.cron-opt-footer {
  margin-top: 14px;
  color: rgba(245,248,255,0.68);
  font-size: 0.8rem;
}
.cron-beans-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 0;
  overflow: visible;
  padding-top: 0;
}
.cron-beans-preview-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}
.cron-schedule-row {
  margin-bottom: 8px;
}
.cron-schedule-row .cron-bean-schedule {
  width: 100%;
}
.cron-visual-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin: 8px 0 12px;
}
.cron-visual-main,
.cron-visual-side {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.cron-visual-side {
  justify-content: flex-end;
}
.cron-visual-total {
  font-size: 1.4rem;
  font-weight: 800;
  color: rgba(245,248,255,0.86);
}
.cron-visual-total-label {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(245,248,255,0.54);
}
.cron-beans-visualized {
  margin-top: 8px;
}
.cron-bean-preview-large {
  min-width: 56px;
  height: 24px;
}
.cron-bean-preview.next {
  outline: 1px solid rgba(255,255,255,0.35);
  outline-offset: 1px;
}
.cron-graphic-caption {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
}
.cron-caption-large {
  margin-top: 8px;
}
.cron-graphic-subcaption {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  color: rgba(245,248,255,0.58);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.cron-graphic-subcaption-single {
  justify-content: center;
}
.cron-visual-total-large {
  font-size: 2rem;
}
.cron-micro-nodes {
  display: grid;
  grid-template-columns: repeat(4, 10px);
  gap: 7px;
}
.cron-micro-node {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.12);
}
.cron-micro-node.enabled {
  background: rgba(86,217,125,0.95);
  box-shadow: 0 0 8px rgba(86,217,125,0.18);
}
.cron-micro-node.next {
  outline: 1px solid rgba(255,255,255,0.45);
  outline-offset: 1px;
}
.cron-fraction-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 10px 0 6px;
}
.cron-fraction-top,
.cron-fraction-bottom {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
  color: rgba(245,248,255,0.95);
}
.cron-fraction-bar {
  width: 72px;
  height: 2px;
  background: rgba(255,255,255,0.32);
  border-radius: 999px;
}
.cron-matrix-grid {
  display: grid;
  grid-template-columns: repeat(4, 18px);
  justify-content: center;
  gap: 12px;
  margin: 20px 0 8px;
}
.cron-matrix-node,
.cron-ring-node,
.cron-rail-seg {
  background: rgba(255,255,255,0.12);
}
.cron-matrix-node {
  width: 18px;
  height: 18px;
  border-radius: 999px;
}
.cron-matrix-node.enabled,
.cron-ring-node.enabled,
.cron-rail-seg.enabled {
  background: rgba(86,217,125,0.95);
  box-shadow: 0 0 10px rgba(86,217,125,0.2);
}
.cron-matrix-node.next,
.cron-ring-node.next,
.cron-rail-seg.next {
  outline: 1px solid rgba(255,255,255,0.45);
  outline-offset: 2px;
}
.cron-ring-wrap {
  position: relative;
  width: 150px;
  height: 150px;
  margin: 8px auto 6px;
}
.cron-ring-center {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.cron-ring-node {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  transform: translate(-50%, -50%);
}
.cron-rail-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 8px;
  margin: 28px 0 14px;
}
.cron-rail-seg {
  height: 28px;
  border-radius: 999px;
}
.cron-bean-preview {
  position: relative;
  min-width: 52px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.95);
  cursor: pointer;
}
.cron-bean-preview.enabled {
  background: linear-gradient(180deg, rgba(73,166,255,0.52), rgba(39,213,255,0.92));
  box-shadow: 0 0 10px rgba(39,213,255,0.18);
}
.cron-bean-preview.disabled {
  background: rgba(168,179,199,0.14);
  border: 1px solid rgba(168,179,199,0.16);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
  color: rgba(168,179,199,0.86);
}
.cron-bean-overflow {
  background: rgba(255,255,255,0.10);
  color: rgba(245,248,255,0.92);
}
.cron-bean-schedule {
  grid-column: 1 / -1;
  justify-content: flex-start;
  color: rgba(245,248,255,0.9);
  font-weight: 800;
  letter-spacing: 0.08em;
}
.cron-bean-schedule-cyan {
  background: linear-gradient(90deg, rgba(73,166,255,0.16), rgba(39,213,255,0.24));
  border: 1px solid rgba(39,213,255,0.16);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
.cron-bean-time {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.03em;
}
.cron-bean-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: rgba(255,255,255,0.7);
}
.cron-bean-icon svg {
  display: block;
  width: 12px;
  height: 12px;
}
.cron-bean-tooltip {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  transform: translateX(0);
  min-width: 180px;
  max-width: 240px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(10,12,16,0.96);
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 10px 30px rgba(0,0,0,0.32);
  color: rgba(245,248,255,0.9);
  font-size: 0.74rem;
  line-height: 1.45;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
  z-index: 20;
}
.cron-bean-tooltip-name {
  font-weight: 800;
  margin-bottom: 4px;
}
.cron-bean-preview:hover .cron-bean-tooltip {
  opacity: 1;
  transform: translateY(-2px);
}
.cron-bean-preview.tooltip-right .cron-bean-tooltip {
  left: auto;
  right: 0;
}
.cron-runway-list {
  display: grid;
  gap: 10px;
  margin: 14px 0 12px;
}
.cron-runway-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  color: rgba(245,248,255,0.8);
  font-size: 0.86rem;
}
.cron-runway-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(255,140,90,0.95);
  box-shadow: 0 0 8px rgba(255,140,90,0.28);
}
.cron-split-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0 12px;
}
.cron-mini-value {
  font-size: 1.7rem;
}
.cron-constellation {
  position: relative;
  height: 118px;
  margin: 14px 0 10px;
  border-radius: 18px;
  background: radial-gradient(circle at center, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
  overflow: hidden;
}
.cron-node {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.12);
}
.cron-node.enabled {
  background: rgba(39,213,255,0.95);
  box-shadow: 0 0 10px rgba(39,213,255,0.28);
}
.cron-constellation-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.1rem;
  font-weight: 800;
  color: rgba(245,248,255,0.95);
}
.glance-card {
  min-height: 184px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: left;
  overflow: hidden;
  min-width: 0;
  justify-content: space-between;
}
.alerts-card {
  cursor: pointer;
  gap: 10px;
}
/* ── Alerts header ── */
.alerts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}
.alerts-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.alerts-icon-shield {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}
.alerts-status-text {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.alerts-status-text.ok { color: rgba(86, 217, 125, 0.7); }
.alerts-status-text.warn { color: rgba(255, 179, 71, 0.7); }
.alerts-status-text.danger { color: rgba(255, 92, 122, 0.8); }
.alerts-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.alerts-header-spark {
  width: 72px;
  height: 24px;
  opacity: 0.45;
}
.alerts-header-count {
  font-family: var(--font-mono);
  font-size: 1.8rem;
  font-weight: 900;
  line-height: 1;
  color: #f2f8ff;
}
.alerts-header-count.ok { color: rgba(86, 217, 125, 0.85); }
.alerts-header-count.warn { color: rgba(255, 179, 71, 0.9); }
.alerts-header-count.danger { color: rgba(255, 92, 122, 0.95); text-shadow: 0 0 14px rgba(255, 60, 80, 0.35); }
/* ── Signal list ── */
.alerts-signal-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.alert-signal-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: background 0.15s, border-color 0.15s;
  min-width: 0;
}
.alert-signal-row:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}
.alert-signal-row.sev-error { border-color: rgba(255, 92, 122, 0.15); background: rgba(255, 60, 80, 0.04); }
.alert-signal-row.sev-warning { border-color: rgba(255, 179, 71, 0.15); background: rgba(255, 160, 50, 0.04); }
.alert-signal-row.sev-info { border-color: rgba(73, 166, 255, 0.12); background: rgba(60, 140, 255, 0.03); }
/* ── Severity icon ── */
.alert-signal-icon-wrap {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}
.alert-signal-icon-wrap svg { width: 100%; height: 100%; }
.alert-signal-icon-wrap.sev-error { color: rgba(255, 110, 140, 0.9); }
.alert-signal-icon-wrap.sev-warning { color: rgba(255, 190, 90, 0.9); }
.alert-signal-icon-wrap.sev-info { color: rgba(110, 180, 255, 0.75); }
/* ── Content ── */
.alert-signal-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.alert-signal-title {
  color: rgba(235, 243, 255, 0.9);
  font-size: 0.78rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alert-signal-sub {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--text-secondary);
  letter-spacing: 0.03em;
}
.alert-signal-age {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  font-weight: 700;
  flex-shrink: 0;
}
.alert-signal-age.sev-error { color: rgba(255, 120, 150, 0.85); }
.alert-signal-age.sev-warning { color: rgba(255, 195, 110, 0.85); }
.alert-signal-age.sev-info { color: rgba(130, 190, 255, 0.7); }
/* ── Clear state ── */
.alerts-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex: 1;
  padding: 20px 0;
}
.alerts-clear-shield {
  width: 44px;
  height: 44px;
}
.alerts-clear-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.alerts-clear-title {
  color: rgba(86, 217, 125, 0.8);
  font-size: 0.92rem;
  font-weight: 700;
}
.alerts-clear-sub {
  color: var(--text-secondary);
  font-size: 0.72rem;
}
.card-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.uptime-topline {
  align-items: flex-start;
}
.uptime-topline-right {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 62%;
}
.uptime-top-chip {
  max-width: 100%;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
}
.status-chip.ok { color: #b9ffd3; border-color: rgba(86,217,125,0.35); background: rgba(86,217,125,0.12); }
.status-chip.warn { color: #ffd59a; border-color: rgba(255,179,71,0.35); background: rgba(255,179,71,0.12); }
.status-chip.danger { color: #ffb0bf; border-color: rgba(255,92,122,0.4); background: rgba(255,92,122,0.12); }
.status-chip.neutral { color: #cde6ff; border-color: rgba(73,166,255,0.35); background: rgba(73,166,255,0.12); }
.metric-row {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 10px;
}
.metric-row.compact { align-items: center; }
.metric-row.split-3 > div { flex: 1; }
.metric-kicker {
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
.metric-value {
  font-size: 2rem;
  line-height: 1;
  font-weight: 800;
  color: #f2f8ff;
}
.metric-value.version-value { font-size: 1.22rem; line-height: 1.2; }
.metric-value.uptime { font-size: 1.2rem; }
.metric-subline {
  color: var(--text-secondary);
  font-size: 0.76rem;
}
.metric-subline.right { text-align: right; }
.sparkline {
  width: 124px;
  height: 34px;
  opacity: 0.96;
}
.sparkline-line {
  fill: none;
  stroke: rgba(73,166,255,0.95);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.empty-line {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}
.version-track,
.stack-bar,
.pressure-bar {
  width: 100%;
  height: 12px;
  border-radius: 999px;
  background: rgba(255,255,255,0.07);
  overflow: hidden;
}
.resource-card {
  min-height: 200px;
}
.resource-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: center;
  flex: 1;
}
.resource-gauge-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  text-align: center;
}
.donut-gauge {
  width: 100%;
  max-width: 200px;
  aspect-ratio: 1;
}
.donut-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.07);
  stroke-width: 8;
}
.donut-fill {
  fill: none;
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dasharray 0.5s ease;
}
.donut-fill.ok { stroke: rgba(86, 217, 125, 0.92); }
.donut-fill.warn { stroke: rgba(255, 179, 71, 0.92); }
.donut-fill.danger { stroke: rgba(255, 92, 122, 0.92); }
.donut-percent {
  fill: #f2f8ff;
  font-size: 16px;
  font-weight: 800;
  font-family: var(--font-mono);
  text-anchor: middle;
  dominant-baseline: central;
}
.donut-label {
  fill: rgba(180, 195, 215, 0.65);
  font-size: 7.5px;
  font-family: var(--font-mono);
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: central;
  letter-spacing: 0.5px;
}
.resource-subline {
  color: var(--text-secondary);
  font-size: 0.72rem;
}
.version-track-fill,
.stack-bar-fill,
.pressure-fill {
  height: 100%;
  border-radius: 999px;
}
.version-track-fill { background: linear-gradient(90deg, rgba(255,120,120,0.9), rgba(255,57,57,0.95)); }
.stack-bar-fill.enabled { background: linear-gradient(90deg, rgba(73,166,255,0.9), rgba(39,213,255,0.9)); }
.pressure-fill.ok { background: linear-gradient(90deg, rgba(86,217,125,0.9), rgba(55,170,101,0.95)); }
.pressure-fill.warn { background: linear-gradient(90deg, rgba(255,179,71,0.92), rgba(255,128,32,0.92)); }
.pressure-fill.danger { background: linear-gradient(90deg, rgba(255,92,122,0.94), rgba(255,46,46,0.94)); }
/* ── External Connections Card ── */
.external-card {
  justify-content: space-between;
  gap: 10px;
}
.ext-hero-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
}
.ext-hero-stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.ext-hero-number {
  font-family: var(--font-mono);
  font-size: 2rem;
  font-weight: 800;
  color: #f2f8ff;
  line-height: 1;
}
.ext-hero-number.dim {
  color: rgba(200, 212, 230, 0.6);
  font-size: 1.6rem;
}
.ext-hero-unit {
  font-size: 0.7rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.ext-hero-divider {
  width: 1px;
  height: 28px;
  background: rgba(255, 255, 255, 0.1);
}
.external-chart-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.external-chart {
  width: 100%;
  flex: 1;
  min-height: 80px;
}
.ext-grid-line {
  stroke: rgba(255, 255, 255, 0.04);
  stroke-width: 0.3;
}
.ext-chart-line {
  stroke: url(#extLineGrad);
  stroke-width: 1.4;
  stroke-linejoin: round;
  stroke-linecap: round;
  filter: drop-shadow(0 0 2px rgba(255, 80, 80, 0.4));
}
.ext-chart-dot {
  filter: drop-shadow(0 0 4px rgba(255, 92, 122, 0.38));
  transition: r 0.3s ease, filter 0.3s ease;
}
.ext-chart-dot.peak,
.ext-chart-dot.today {
  filter: drop-shadow(0 0 6px rgba(255, 92, 122, 0.48));
}
.ext-peak-glow {
  fill: rgba(255, 70, 70, 0.1);
  animation: peakPulse 2.5s ease-in-out infinite;
}
@keyframes peakPulse {
  0%, 100% { r: 6; opacity: 0.2; }
  50% { r: 8; opacity: 0.05; }
}
.ext-chart-dot-value {
  fill: #ffffff;
  font-size: 4px;
  font-family: var(--font-mono);
  font-weight: 800;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}
.ext-chart-day-label {
  fill: var(--text-secondary);
  font-size: 3.4px;
  font-family: var(--font-mono);
  text-anchor: middle;
  dominant-baseline: auto;
  text-transform: uppercase;
  opacity: 0.6;
}
.ext-chart-day-label.active {
  fill: rgba(240,248,255,0.8);
  font-weight: 700;
  opacity: 1;
}
.external-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 10px;
}
.ext-footer-inner {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ext-footer-icon {
  font-size: 1.3rem;
  color: rgba(255, 106, 106, 0.7);
  line-height: 1;
}
.ext-footer-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.ext-footer-host {
  color: #eff6ff;
  font-size: 0.82rem;
  font-weight: 700;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ext-footer-meta {
  color: var(--text-secondary);
  font-size: 0.66rem;
}
/* ══ Card Drag & Drop ══ */
.glance-card-slot {
  cursor: grab;
  display: flex;
  min-width: 0;
}
.glance-card-slot > * {
  flex: 1;
}
.glance-card-slot:active {
  cursor: grabbing;
}
.card-drag-ghost {
  opacity: 0.3;
}
.card-drag-ghost > * {
  box-shadow: 0 0 0 2px rgba(80, 180, 255, 0.4) !important;
}
.card-drag-chosen > * {
  box-shadow: 0 0 20px rgba(80, 180, 255, 0.15) !important;
}
.card-drag-active {
  opacity: 0.9;
  transform: scale(1.02);
}

/* ══ Uptime: Twin Arcs ══ */
.uptime-rows-card {
  gap: 10px;
}
.uptime-rows-wrap {
  display: grid;
  gap: 10px;
}
.uptime-row {
  display: grid;
  grid-template-columns: minmax(0, 220px) auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  background: rgba(255,255,255,0.025);
}
.uptime-row-head {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.uptime-row-icon {
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
}
.uptime-row-labels {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.uptime-row-name {
  font-family: var(--font-mono);
  font-size: 0.92rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1.1;
}
.uptime-row-sub {
  font-size: 0.9rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.uptime-row-time {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.uptime-row-heat {
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  gap: 6px;
}
.uptime-strip-cell {
  height: 16px;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
}
.uptime-strip-cell.host-strip.on {
  background: linear-gradient(180deg, rgba(73,166,255,0.78), rgba(39,213,255,0.94));
  box-shadow: 0 0 10px rgba(39,213,255,0.16);
}
.uptime-strip-cell.oc-strip.on {
  background: linear-gradient(180deg, rgba(255,200,100,0.74), rgba(255,140,90,0.92));
  box-shadow: 0 0 10px rgba(255,140,90,0.14);
}
.host-color { color: rgba(39,213,255,0.85); }
.oc-color { color: rgba(255,140,90,0.85); }
.host-glow { color: rgba(39,213,255,0.95); text-shadow: 0 0 14px rgba(39,213,255,0.35); }
.oc-glow { color: rgba(255,140,90,0.95); text-shadow: 0 0 14px rgba(255,140,90,0.35); }

.pressure-options-grid,
.models-options-grid,
.models-pair-grid,
.capabilities-options-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.pressure-option-card {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pressure-bars-stack,
.pressure-heat-stack,
.pressure-meter-stack {
  display: grid;
  gap: 12px;
}
.pressure-bar-row,
.pressure-meter-row {
  display: grid;
  gap: 8px;
}
.pressure-bar-head,
.pressure-meter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.pressure-bar-track,
.pressure-meter-track {
  width: 100%;
  height: 12px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  overflow: hidden;
}
.pressure-bar-fill,
.pressure-meter-fill {
  height: 100%;
  border-radius: 999px;
}
.mem-fill { background: linear-gradient(90deg, rgba(73,166,255,0.92), rgba(39,213,255,0.92)); }
.storage-fill { background: linear-gradient(90deg, rgba(157,109,255,0.88), rgba(210,77,255,0.92)); }
.pressure-bar-sub,
.pressure-meter-meta small,
.pressure-panel-sub {
  font-size: 0.72rem;
  color: var(--text-secondary);
}
.pressure-towers-wrap {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: end;
  flex: 1;
}
.pressure-towers-wide-wrap {
  gap: 18px;
}
.pressure-tower-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.pressure-wide-card {
  display: grid;
  grid-template-columns: minmax(96px, auto) 1fr;
  gap: 8px;
  align-items: end;
}
.pressure-wide-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 4px;
  padding-bottom: 4px;
}
.pressure-meta-icon {
  width: 54px;
  height: 54px;
  display: block;
}
.mem-icon {
  color: rgba(39,213,255,0.9);
  filter: drop-shadow(0 0 10px rgba(39,213,255,0.16));
}
.storage-icon {
  color: rgba(182,118,255,0.92);
  filter: drop-shadow(0 0 10px rgba(182,118,255,0.16));
}
.pressure-meta-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}
.pressure-data-card {
  align-items: stretch;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  background: rgba(255,255,255,0.03);
  padding: 12px;
}
.pressure-data-top,
.pressure-data-bottom {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.pressure-data-inline {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.pressure-data-inline strong,
.pressure-data-bottom strong {
  font-family: var(--font-mono);
  font-size: 1rem;
  font-weight: 900;
}
.pressure-data-inline span,
.pressure-data-bottom span {
  font-size: 0.72rem;
  color: var(--text-secondary);
}
.pressure-tower-tall {
  max-width: none;
  height: 150px;
}
.pressure-tower {
  width: 100%;
  max-width: 90px;
  height: 120px;
  border-radius: 16px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  padding: 8px;
  display: flex;
  align-items: end;
}
.pressure-tower-wide {
  max-width: 100%;
  min-width: 140px;
  height: 160px;
}
.pressure-tower-fill {
  width: 100%;
  border-radius: 12px;
}
.pressure-tower-fill-data {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 8px;
  color: rgba(245,248,255,0.96);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
}
.pressure-fill-copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-align: center;
}
.pressure-fill-copy strong {
  font-family: var(--font-mono);
  font-size: 1rem;
  font-weight: 900;
  line-height: 1;
}
.pressure-fill-copy span {
  font-size: 0.68rem;
  line-height: 1.1;
  opacity: 0.92;
}
.pressure-tower-data-inner {
  overflow: hidden;
}
.pressure-tower-label,
.pressure-panel-kicker,
.pressure-heat-label,
.pressure-meter-meta span {
  font-family: var(--font-sans);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.pressure-tower-value,
.pressure-meter-value,
.pressure-panel-big {
  font-family: var(--font-mono);
  font-size: 1.2rem;
  font-weight: 900;
}
.pressure-tower-value {
  font-family: var(--font-sans);
  font-size: 0.95rem;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 0.01em;
  color: rgba(245,248,255,0.92);
}
.pressure-heat-row {
  display: grid;
  grid-template-columns: 70px 1fr auto;
  gap: 10px;
  align-items: center;
}
.pressure-heat-cells {
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  gap: 5px;
}
.pressure-heat-cell {
  height: 16px;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  opacity: 0.35;
}
.pressure-heat-cell.on { opacity: 1; box-shadow: 0 0 8px rgba(255,255,255,0.12); }
.pressure-meter-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 110px;
}
.pressure-panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.pressure-panel {
  min-height: 140px;
  border-radius: 16px;
  padding: 14px;
  border: 1px solid rgba(255,255,255,0.08);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.mem-panel { background: linear-gradient(180deg, rgba(39,213,255,0.08), rgba(73,166,255,0.14)); }
.storage-panel { background: linear-gradient(180deg, rgba(210,77,255,0.08), rgba(157,109,255,0.14)); }
.models-options-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.models-option-card {
  min-height: 240px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.models-list-stack,
.models-pill-stack,
.models-band-stack,
.models-matrix-stack,
.models-glow-stack {
  display: grid;
  gap: 10px;
}
.model-row-card,
.model-pill-row,
.model-band-row,
.model-matrix-row,
.model-glow-row {
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  padding: 12px;
}
.model-row-card {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}
.model-row-main,
.model-band-top,
.model-band-bottom,
.model-glow-head,
.model-glow-foot,
.model-matrix-row,
.model-pill-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}
.model-row-alias {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.7);
}
.model-row-name,
.model-pill-title {
  font-size: 0.92rem;
  font-weight: 800;
  color: rgba(245,248,255,0.96);
}
.model-pill-sub {
  font-size: 0.72rem;
  color: var(--text-secondary);
}
.model-row-chips,
.model-chip-grid {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.model-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.08);
  font-family: var(--font-mono);
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: rgba(245,248,255,0.88);
}
.model-chip-dim {
  opacity: 0.38;
}
.model-chip-dim.active {
  opacity: 1;
}
.model-band-row,
.model-glow-row {
  position: relative;
  overflow: hidden;
}
.models-glow-stack-compact {
  gap: 8px;
}
.model-glow-row-compact {
  padding: 9px 10px;
  border-radius: 12px;
}
.model-glow-head-compact {
  justify-content: flex-start;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
}
.model-glow-foot-compact {
  margin-top: 4px;
}
.model-chip-compact {
  height: 19px;
  padding: 0 6px;
  font-size: 0.58rem;
}
.model-band-row::before,
.model-glow-row::before,
.model-row-card::before,
.model-pill-row::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.9;
}
.accent-cyan::before { background: linear-gradient(90deg, rgba(39,213,255,0.10), transparent 55%); }
.accent-violet::before { background: linear-gradient(90deg, rgba(157,109,255,0.11), transparent 55%); }
.accent-indigo::before { background: linear-gradient(90deg, rgba(99,74,255,0.10), transparent 55%); }
.accent-amber::before { background: linear-gradient(90deg, rgba(255,180,60,0.11), transparent 55%); }
.accent-rose::before { background: linear-gradient(90deg, rgba(255,100,150,0.11), transparent 55%); }
.model-matrix-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.models-matrix-card {
  overflow: hidden;
}
.models-table-wrap {
  display: grid;
  gap: 6px;
}
.models-table-head,
.models-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px 42px 42px;
  gap: 8px;
  align-items: center;
}
.models-table-head {
  padding: 0 4px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
.models-table-row {
  padding: 8px 6px;
  border-radius: 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
}
.models-table-name {
  font-size: 0.84rem;
  font-weight: 800;
  color: rgba(245,248,255,0.96);
}
.models-table-sub {
  font-size: 0.68rem;
  color: var(--text-secondary);
}
.models-col-flags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.models-col-agent {
  display: flex;
  justify-content: center;
}
.models-dot {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.18);
}
.models-dot svg {
  width: 12px;
  height: 12px;
  display: block;
}
.models-dot.active {
  color: rgba(39,213,255,0.95);
  filter: drop-shadow(0 0 6px rgba(39,213,255,0.3));
}
.capabilities-card {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.capabilities-card-top {
  justify-content: flex-start;
}
.capabilities-card-wide {
  grid-column: 1 / -1;
}
.capabilities-review-card {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  gap: 12px;
}
.cap-pillars-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.cap-pillar {
  position: relative;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  overflow: hidden;
}
.cap-pillar-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.cap-pillar-title,
.cap-stack-title {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.cap-pillar-count {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  color: rgba(210,230,255,0.62);
}
.cap-pillar-sub,
.cap-stack-sub {
  margin-top: 4px;
  font-size: 0.72rem;
  line-height: 1.3;
  color: rgba(210,230,255,0.68);
}
.cap-pillar-items,
.cap-stack-right {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.cap-pillar-chip,
.cap-stack-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  color: rgba(230,240,255,0.92);
}
.cap-stack-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.cap-stack-layer {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  overflow: hidden;
}
.cap-stack-left {
  min-width: 112px;
}
.cap-review-matrix {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cap-directory-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  align-content: start;
  gap: 12px;
}
.cap-directory-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cap-directory-head,
.cap-directory-row {
  grid-template-columns: minmax(112px, 1.6fr) repeat(3, minmax(0, 1fr));
}
.cap-review-matrix-row {
  display: grid;
  grid-template-columns: minmax(110px, 1.4fr) repeat(5, minmax(0, 1fr));
  gap: 8px;
  align-items: center;
}
.cap-review-matrix-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.74rem;
  color: rgba(235,242,255,0.92);
}
.cap-review-matrix-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  border-radius: 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.05);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  color: rgba(210,230,255,0.62);
}
.cap-review-matrix-cell.head {
  background: transparent;
  border-color: transparent;
}
.cap-review-matrix-on,
.cap-review-matrix-off {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}
.cap-review-matrix-on {
  background: rgba(39,213,255,0.95);
  box-shadow: 0 0 10px rgba(39,213,255,0.35);
}
.cap-review-matrix-off {
  background: rgba(255,255,255,0.14);
}
.cap-section {
  display: grid;
  gap: 8px;
}
.cap-section-head,
.cap-count-strip {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}
.cap-count-strip {
  display: flex;
  justify-content: space-between;
}
.cap-pill-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cap-pill-wrap-tight {
  gap: 6px;
}
.cap-pill,
.cap-plugin-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  position: relative;
  overflow: hidden;
}
.cap-pill-plugin,
.cap-pill-constellation,
.cap-pill-compact {
  min-height: 22px;
  padding: 0 8px;
  font-size: 0.72rem;
}
.cap-live-dot,
.accent-dot-cyan,
.accent-dot-violet,
.accent-dot-indigo,
.accent-dot-amber,
.accent-dot-rose {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.6);
  box-shadow: 0 0 8px rgba(255,255,255,0.2);
  flex: 0 0 auto;
}
.accent-dot-cyan { background: rgba(39,213,255,0.95); }
.accent-dot-violet { background: rgba(210,77,255,0.95); }
.accent-dot-indigo { background: rgba(99,74,255,0.95); }
.accent-dot-amber { background: rgba(255,180,60,0.95); }
.accent-dot-rose { background: rgba(255,100,150,0.95); }
.cap-matrix-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.cap-matrix-grid-top {
  align-items: start;
}
.cap-matrix-col {
  display: grid;
  gap: 6px;
}
.cap-matrix-col-top {
  align-content: start;
}
.cap-mini-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  line-height: 1.05;
  font-size: 0.78rem;
}
.cap-plugin-beans {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
  margin-top: 2px;
}
.cap-plugin-bean {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.05);
  color: var(--text-primary);
  font-size: 0.76rem;
  line-height: 1;
  white-space: nowrap;
}
.cap-constellation-wrap {
  display: grid;
  gap: 12px;
}
.cap-plugin-node-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* ══ Work Output: Heat Grid ══ */
.work-card { gap: 12px; }
.hg-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  justify-content: center;
}
.hg-row, .hg-day-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.hg-row-icon-wrap {
  width: 44px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.hg-row-icon {
  width: 26px;
  height: 26px;
  filter: drop-shadow(0 0 4px currentColor);
}
.hg-row-label {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: center;
}
.external-card-clickable {
  cursor: pointer;
}

.hg-row-clickable {
  cursor: pointer;
  border-radius: 6px;
  padding: 4px 2px;
  margin: -4px -2px;
  transition: background 0.2s ease;
}
.hg-row-clickable:hover {
  background: rgba(255, 255, 255, 0.04);
}
.hg-row-clickable:active {
  background: rgba(255, 255, 255, 0.07);
}
.hg-day-label {
  flex: 1;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  color: var(--text-secondary);
  opacity: 0.6;
  text-transform: uppercase;
}
.hg-day-label.active { opacity: 1; font-weight: 700; color: rgba(240,248,255,0.8); }
.hge-cell {
  flex: 1;
  aspect-ratio: 1;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  min-width: 0;
}
.hge-fill {
  border-radius: 4px;
  transition: width 0.5s ease, height 0.5s ease, box-shadow 0.5s ease;
}
.hge-value {
  position: absolute;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  pointer-events: none;
}



/* ══ Skeleton Loading ══ */
.skeleton-grid {
  grid-template-columns: repeat(2, 1fr);
}
.skeleton-card {
  min-height: 200px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: skeletonPulse 1.5s ease-in-out infinite;
}
.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}
.skeleton-line {
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
}
.skeleton-title {
  height: 14px;
  width: 40%;
}
.skeleton-wide {
  height: 32px;
  width: 80%;
}
.skeleton-medium {
  height: 12px;
  width: 60%;
}
.skeleton-narrow {
  height: 12px;
  width: 35%;
}
@keyframes skeletonPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
@media (max-width: 980px) {
  .skeleton-grid {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 980px) {
  .glance-grid {
    grid-template-columns: 1fr !important;
  }
  .cron-options-grid {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 768px) {
  .overview-shell {
    padding-left: 12px;
    padding-right: 12px;
  }
  .glance-grid {
    gap: 12px;
  }
  .glance-card,
  .pulse-hero {
    padding: 14px;
    border-radius: 18px;
  }
  .card-topline {
    gap: 8px;
  }
  .oc-card-title {
    font-size: 1.05rem;
  }
  .status-chip {
    padding: 0 10px;
    min-height: 28px;
    font-size: 0.66rem;
  }
  .heartbeat-hero {
    max-width: 100%;
  }
  .heartbeat-hero-body {
    grid-template-columns: auto 1fr;
    gap: 10px;
  }
  .heartbeat-state-main {
    font-size: 1.7rem;
  }
  .heartbeat-icon-circle {
    width: 72px;
    height: 72px;
    justify-self: start;
  }
  .heartbeat-data-rail {
    gap: 6px;
  }
  .heartbeat-chip {
    min-height: 22px;
    padding: 0 8px;
    font-size: 0.66rem;
  }
  .alerts-header-count {
    font-size: 1.4rem;
  }
  .alerts-header-spark {
    width: 50px;
    height: 18px;
  }
  .alerts-icon-shield {
    width: 26px;
    height: 26px;
  }
  .alert-signal-icon-wrap {
    width: 22px;
    height: 22px;
  }
  .ext-hero-number {
    font-size: 1.6rem;
  }
  .ext-hero-number.dim {
    font-size: 1.3rem;
  }
  .up-icon {
    width: 30px;
    height: 30px;
  }
  .up-cell {
    font-size: 0.95rem;
    min-width: 24px;
    padding: 3px 5px;
  }
  .up-sep {
    font-size: 0.85rem;
  }
  .work-card {
    gap: 10px;
  }
  .hg-table {
    gap: 4px;
  }
  .hg-row-icon-wrap {
    width: 28px;
  }
  .hg-row-icon {
    width: 18px;
    height: 18px;
  }
  .hg-row-label {
    font-size: 0.48rem;
  }
  .hg-row, .hg-day-row {
    gap: 2px;
  }
  .hge-cell {
    aspect-ratio: 1;
    border-radius: 4px;
  }
  .hge-fill {
    border-radius: 3px;
  }
  .hge-value {
    font-size: 0.44rem;
  }
  .hg-day-label {
    font-size: 0.44rem;
  }
  .uptime-row {
    grid-template-columns: 1fr;
    align-items: stretch;
    gap: 8px;
  }
  .uptime-row-time {
    font-size: 0.92rem;
  }
  .uptime-row-heat {
    display: grid;
    grid-template-columns: repeat(16, minmax(0, 1fr));
    gap: 4px;
  }
  .uptime-strip-cell {
    height: 12px;
  }
  .pressure-panel-grid,
  .models-options-grid,
  .models-pair-grid,
  .capabilities-options-grid,
  .pressure-options-grid {
    grid-template-columns: 1fr;
  }
  .cap-directory-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .cap-directory-col {
    gap: 8px;
  }
  .cap-directory-head {
    display: grid;
    grid-template-columns: minmax(88px, 1fr) repeat(3, minmax(44px, auto));
    gap: 6px;
    align-items: center;
  }
  .cap-directory-row {
    display: grid;
    grid-template-columns: minmax(88px, 1fr) repeat(3, minmax(44px, auto));
    gap: 6px;
    align-items: center;
  }
  .cap-review-matrix-name {
    min-width: 0;
    font-size: 0.7rem;
  }
  .cap-review-matrix-cell {
    min-height: 20px;
    border-radius: 8px;
    font-size: 0.52rem;
    padding: 0 4px;
  }
  .cap-stack-layer {
    flex-direction: column;
  }
  .cap-stack-left {
    min-width: 0;
  }
  .pressure-towers-wrap {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pressure-wide-card {
    grid-template-columns: minmax(88px, auto) 1fr;
    gap: 8px;
    align-items: center;
  }
  .pressure-wide-meta {
    align-items: flex-end;
    padding-bottom: 0;
  }
  .pressure-tower-wide {
    min-width: 0;
    height: 140px;
  }
}

@media (max-width: 430px) {
  .overview-shell {
    padding-left: 10px;
    padding-right: 10px;
  }
  .glance-grid {
    gap: 10px;
  }
  .glance-card,
  .pulse-hero {
    padding: 12px;
    border-radius: 16px;
  }
  .oc-card-title {
    font-size: 0.98rem;
    letter-spacing: 0.05em;
  }
  .status-chip {
    padding: 0 8px;
    min-height: 24px;
    font-size: 0.6rem;
  }
  .hg-row-icon-wrap {
    width: 24px;
  }
  .hg-row-icon {
    width: 16px;
    height: 16px;
  }
  .hg-row-label {
    font-size: 0.42rem;
  }
  .hg-row, .hg-day-row {
    gap: 2px;
  }
  .hge-value {
    font-size: 0.4rem;
  }
  .hg-day-label {
    font-size: 0.4rem;
  }
  .external-chart-wrap {
    margin-left: -2px;
    margin-right: -2px;
  }
  .cap-directory-head,
  .cap-directory-row {
    grid-template-columns: minmax(78px, 1fr) repeat(3, minmax(36px, auto));
    gap: 4px;
  }
  .cap-review-matrix-name {
    gap: 6px;
    font-size: 0.66rem;
  }
  .cap-review-matrix-cell {
    min-height: 18px;
    font-size: 0.48rem;
    border-radius: 7px;
  }
}

</style>

