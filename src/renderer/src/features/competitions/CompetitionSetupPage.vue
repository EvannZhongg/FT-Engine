<template>
  <div class="competition-setup-page">
    <div v-if="loading" class="route-loading">{{ $t('competition_loading') }}</div>
    <SetupWizard
      v-else
      @cancel="router.push('/competitions')"
      @finished="router.push('/scoring')"
    />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SetupWizard from '../../components/SetupWizard.vue'
import { useCompetitionStore } from '../../stores/competitionStore'

const competitionStore = useCompetitionStore()
const route = useRoute()
const router = useRouter()
const loading = ref(
  Boolean(route.query.competition && competitionStore.projectConfig.id !== route.query.competition)
)

onMounted(async () => {
  const competitionId = String(route.query.competition || '')
  if (competitionId && competitionStore.projectConfig.id !== competitionId) {
    const loaded = await competitionStore.loadProject(competitionId)
    if (!loaded) {
      await router.replace('/competitions')
      return
    }
  }
  loading.value = false
})
</script>

<style scoped>
.competition-setup-page {
  min-height: 100%;
  background: #1e1e1e;
}
</style>
