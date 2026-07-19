<template>
  <ReportView :project-dir="competitionId" @back="router.push('/competitions')" />
</template>

<script setup>
import { useRouter } from 'vue-router'
import ReportView from '../../components/ReportView.vue'

defineProps({ competitionId: { type: String, required: true } })
const router = useRouter()
</script>
