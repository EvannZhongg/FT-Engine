<template>
  <div class="score-board">
    <div class="header">
      <div class="left-actions">
        <button class="btn-stop" @click="$emit('stop')">← Stop Match</button>
      </div>
      <h2>Live Scoreboard</h2>
      <button class="btn-reset" @click="store.resetAll">⚠ RESET ALL</button>
    </div>

    <div class="panels-container">
      <div
        v-for="(ref, index) in store.referees"
        :key="index"
        class="score-card"
      >
        <div class="ref-name">Referee {{ index }}</div>
        <div class="score-main">{{ ref.total }}</div>
        <div class="score-detail">
          <span class="plus">+{{ ref.plus }}</span>
          <span class="divider">/</span>
          <span class="minus">-{{ ref.minus }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'

const store = useRefereeStore()

onMounted(() => {
  store.connectWebSocket()
})
</script>

<style scoped lang="scss">
.score-board {
  padding: 20px;
  color: white;
  background-color: #2b2b2b;
  height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.btn-reset {
  background: #c0392b;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  &:hover { background: #e74c3c; }
}

.panels-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
}

.score-card {
  background: #ecf0f1;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  color: #2c3e50;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);

  .ref-name {
    font-size: 1.2rem;
    font-weight: bold;
    margin-bottom: 10px;
  }

  .score-main {
    font-size: 5rem;
    font-weight: bold;
    line-height: 1;
    margin: 10px 0;
  }

  .score-detail {
    font-size: 1rem;
    color: #7f8c8d;
    .plus { color: #27ae60; }
    .minus { color: #c0392b; }
  }
}
</style>
