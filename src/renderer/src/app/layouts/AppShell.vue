<template>
  <div class="desktop-shell">
    <aside class="app-sidebar">
      <div class="sidebar-brand">
        <img src="../../assets/icon.png" alt="" />
        <span>FT Engine</span>
      </div>

      <nav class="sidebar-nav" :aria-label="$t('shell_primary_navigation')">
        <RouterLink v-for="item in navigation" :key="item.to" :to="item.to" :title="$t(item.label)">
          <component :is="item.icon" :size="19" />
          <span>{{ $t(item.label) }}</span>
        </RouterLink>
      </nav>

      <RouterLink class="sidebar-user" to="/settings" :title="$t('shell_local_user')">
        <span class="user-avatar"><UserRound :size="17" /></span>
        <span class="user-copy">
          <strong>{{ $t('shell_local_user') }}</strong>
          <small>{{ $t('shell_offline_ready') }}</small>
        </span>
      </RouterLink>
    </aside>

    <section class="shell-workspace">
      <NavBar />

      <div v-if="updateReady" class="shell-notice" role="status">
        <span>{{ $t('update_ready_message') }}</span>
        <button type="button" @click="restartForUpdate">
          <RefreshCw :size="15" />
          {{ $t('update_restart_action') }}
        </button>
      </div>

      <main class="route-workspace">
        <RouterView />
      </main>
    </section>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import {
  Clapperboard,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Trophy,
  UserRound
} from 'lucide-vue-next'
import NavBar from '../../components/NavBar.vue'

const navigation = [
  { to: '/dashboard', label: 'nav_dashboard', icon: LayoutDashboard },
  { to: '/competitions', label: 'nav_competitions', icon: Trophy },
  { to: '/replay', label: 'nav_replay', icon: Clapperboard },
  { to: '/settings', label: 'nav_settings', icon: Settings }
]

const updateReady = ref(false)
let removeUpdateAvailableListener = () => {}
let removeUpdateDownloadedListener = () => {}

onMounted(() => {
  if (!window.ftEngine?.app) return
  removeUpdateAvailableListener = window.ftEngine.app.onUpdateAvailable(() => {})
  removeUpdateDownloadedListener = window.ftEngine.app.onUpdateDownloaded(() => {
    updateReady.value = true
  })
})

onUnmounted(() => {
  removeUpdateAvailableListener()
  removeUpdateDownloadedListener()
})

const restartForUpdate = () => window.ftEngine?.app.restartForUpdate()
</script>

<style scoped>
.desktop-shell {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  background: var(--app-bg);
  color: var(--text-primary);
}
.app-sidebar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--sidebar-bg);
  -webkit-app-region: drag;
}
.sidebar-brand {
  height: 60px;
  flex: 0 0 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  color: var(--text-primary);
  font-size: 0.95rem;
  font-weight: 700;
}
.sidebar-brand img {
  width: 26px;
  height: 26px;
}
.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 10px;
  -webkit-app-region: no-drag;
}
.sidebar-nav a {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 12px;
  border-radius: 6px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.86rem;
  font-weight: 600;
}
.sidebar-nav a:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.sidebar-nav a.router-link-active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.sidebar-user {
  min-width: 0;
  margin: auto 10px 12px;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-top: 1px solid var(--border);
  color: var(--text-primary);
  text-decoration: none;
  -webkit-app-region: no-drag;
}
.user-avatar {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--surface-muted);
  color: var(--text-secondary);
}
.user-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.user-copy strong,
.user-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-copy strong {
  font-size: 0.78rem;
}
.user-copy small {
  color: var(--text-muted);
  font-size: 0.68rem;
}
.shell-workspace {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--workspace-bg);
}
.route-workspace {
  min-height: 0;
  flex: 1;
  overflow: auto;
}
.shell-notice {
  min-height: 38px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 6px 18px;
  border-bottom: 1px solid var(--warning-border);
  background: var(--warning-soft);
  color: var(--warning-text);
  font-size: 0.78rem;
}
.shell-notice button {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--warning-border);
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
@media (max-width: 1080px) {
  .desktop-shell {
    grid-template-columns: 72px minmax(0, 1fr);
  }
  .sidebar-brand {
    justify-content: center;
    padding: 0;
  }
  .sidebar-brand span,
  .sidebar-nav a span,
  .user-copy {
    display: none;
  }
  .sidebar-nav a {
    justify-content: center;
    padding: 0;
  }
  .sidebar-user {
    justify-content: center;
    padding: 0;
  }
}
</style>
