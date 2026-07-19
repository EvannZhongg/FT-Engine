<template>
  <ScoreBoard @stop="stopMatch" @invalidate="invalidateMatch" />
</template>

<script setup>
import { useRouter } from 'vue-router'
import ScoreBoard from '../../components/ScoreBoard.vue'
import { useMatchStore } from '../../stores/matchStore'

const matchStore = useMatchStore()
const router = useRouter()

const finalize = async (command) => {
  const result = await matchStore[command]()
  if (result.sessionFinalized !== false) await router.push('/dashboard')
}
const stopMatch = () => finalize('stopMatch')
const invalidateMatch = () => finalize('invalidateMatch')
</script>
