<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h1>{{ $t('nav_competitions') }}</h1>
        <p>{{ $t('competitions_subtitle') }}</p>
      </div>
      <button class="button-primary" type="button" @click="createCompetition">
        <Plus :size="16" />
        {{ $t('btn_new_match') }}
      </button>
    </header>
    <section class="page-section">
      <CompetitionTable />
    </section>
  </div>
</template>

<script setup>
import { Plus } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import CompetitionTable from './CompetitionTable.vue'
import { useCompetitionStore } from '../../stores/competitionStore'
import { useMatchStore } from '../../stores/matchStore'

const competitionStore = useCompetitionStore()
const matchStore = useMatchStore()
const router = useRouter()

const createCompetition = () => {
  competitionStore.clearLocalConfig()
  matchStore.clearLocalState()
  router.push('/competitions/setup')
}
</script>
