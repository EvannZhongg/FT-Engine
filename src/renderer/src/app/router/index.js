import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '../../features/dashboard/DashboardView.vue'
import CompetitionListView from '../../features/competitions/CompetitionListView.vue'
import CompetitionSetupPage from '../../features/competitions/CompetitionSetupPage.vue'
import ScoringPage from '../../features/scoring/ScoringPage.vue'
import ReplayView from '../../components/ReplayView.vue'
import ReportPage from '../../features/replay/ReportPage.vue'
import SettingsView from '../../features/settings/SettingsView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/competitions', name: 'competitions', component: CompetitionListView },
    { path: '/competitions/setup', name: 'competition-setup', component: CompetitionSetupPage },
    { path: '/scoring', name: 'scoring', component: ScoringPage },
    { path: '/replay', name: 'replay', component: ReplayView },
    {
      path: '/competitions/:competitionId/report',
      name: 'report',
      component: ReportPage,
      props: true
    },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
  ],
  scrollBehavior: () => ({ top: 0 })
})
