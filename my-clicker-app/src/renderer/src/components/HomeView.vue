<template>
  <div class="home-view">
    <div class="hero-section">
      <h1>Welcome Back</h1>
      <p>Ready for the next match?</p>
    </div>

    <div class="cards-grid">
      <div class="card new-match" @click="$emit('navigate', 'setup')">
        <div class="icon-circle">
          <Plus :size="32" />
        </div>
        <h3>New Match</h3>
        <p>Start a new tournament or free mode session.</p>
      </div>

      <div class="card history">
        <div class="icon-circle">
          <History :size="32" />
        </div>
        <h3>History</h3>
        <p>View past results and reports.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Plus, History } from 'lucide-vue-next'
defineEmits(['navigate'])
</script>

<style scoped lang="scss">
.home-view {
  padding: 40px;
  color: white;
  animation: fadeIn 0.5s;
}

.hero-section {
  margin-bottom: 40px;
  h1 { font-size: 2.5rem; margin-bottom: 10px; }
  p { color: #888; font-size: 1.1rem; }
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 30px;
}

.card {
  background: #2b2b2b;
  border: 1px solid #3d3d3d;
  border-radius: 12px;
  padding: 30px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;

  &:hover {
    transform: translateY(-5px);
    background: #333;
    border-color: #3498db;
    box-shadow: 0 10px 20px rgba(0,0,0,0.2);
  }

  .icon-circle {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: #3d3d3d;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
    color: #3498db;
  }

  h3 { margin: 0 0 10px 0; font-size: 1.2rem; }
  p { margin: 0; color: #888; font-size: 0.9rem; }
}

.card.new-match .icon-circle { color: #2ecc71; background: rgba(46, 204, 113, 0.1); }
.card.history .icon-circle { color: #f39c12; background: rgba(243, 156, 18, 0.1); }

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
</style>
