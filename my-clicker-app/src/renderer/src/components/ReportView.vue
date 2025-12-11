<template>
  <div class="report-view">
    <div class="sidebar">
      <div class="sidebar-header">Groups</div>
      <div class="group-list">
        <div
          v-for="group in groups"
          :key="group.name"
          class="group-item"
          :class="{ active: currentGroup?.name === group.name }"
          @click="currentGroup = group"
        >
          {{ group.name }}
        </div>
      </div>
      <button class="btn-back" @click="$emit('back')">← Back Home</button>
    </div>

    <div class="main-content" v-if="currentGroup">
      <div class="top-bar">
        <h2>{{ currentGroup.name }} - Report</h2>
        <div class="view-switcher">
          <button :class="{ active: viewMode === 'RAW' }" @click="viewMode = 'RAW'">Raw Scores</button>
          <button :class="{ active: viewMode === 'SCALED' }" @click="viewMode = 'SCALED'">Scaled Scores</button>
        </div>
      </div>

      <div v-if="viewMode === 'RAW'" class="table-container">
        <table>
          <thead>
            <tr>
              <th>Contestant</th>
              <th v-for="i in currentGroup.refCount" :key="i">Referee {{ i }} (Total)</th>
              <th>Sum</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="player in currentGroup.players" :key="player">
              <td class="fixed-col">{{ player }}</td>
              <td v-for="i in currentGroup.refCount" :key="i">
                {{ getRawScore(player, i) }}
              </td>
              <td class="highlight">{{ getRawSum(player) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="viewMode === 'SCALED'" class="table-container">
        <div class="settings-bar">
          <label>Scaling Ratio (%): </label>
          <input type="number" v-model.number="scaleRatio" min="1" max="100">
        </div>

        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Contestant</th>
              <th v-for="i in currentGroup.refCount" :key="i">Ref {{ i }} (Scaled)</th>
              <th>Final Score</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in sortedScaledRows" :key="row.player">
              <td>{{ idx + 1 }}</td>
              <td class="fixed-col">{{ row.player }}</td>
              <td v-for="i in currentGroup.refCount" :key="i">
                {{ row.scaledScores[i].toFixed(2) }}
              </td>
              <td class="highlight">{{ row.finalScore.toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'

const props = defineProps(['projectDir'])
const emit = defineEmits(['back'])
const store = useRefereeStore()

const groups = ref([])
const currentGroup = ref(null)
const scoresData = ref({}) // { GroupName: { PlayerName: { RefIndex: { total... } } } }
const viewMode = ref('RAW')
const scaleRatio = ref(60)

// 加载数据
onMounted(async () => {
  if (props.projectDir) {
    const data = await store.fetchReportData(props.projectDir)
    if (data) {
      groups.value = data.config.groups || []
      scoresData.value = data.scores || {}
      if (groups.value.length > 0) currentGroup.value = groups.value[0]
    }
  }
})

// --- Helper Functions ---

const getRawScoreObj = (player, refIdx) => {
  if (!currentGroup.value) return null
  const gName = currentGroup.value.name
  return scoresData.value[gName]?.[player]?.[refIdx]
}

const getRawScore = (player, refIdx) => {
  const obj = getRawScoreObj(player, refIdx)
  return obj ? obj.total : '-'
}

const getRawSum = (player) => {
  if (!currentGroup.value) return 0
  let sum = 0
  for (let i = 1; i <= currentGroup.value.refCount; i++) {
    const obj = getRawScoreObj(player, i)
    if (obj) sum += obj.total
  }
  return sum
}

// --- 比例分计算核心逻辑 ---

const sortedScaledRows = computed(() => {
  if (!currentGroup.value) return []

  const players = currentGroup.value.players
  const refCount = currentGroup.value.refCount
  const gName = currentGroup.value.name

  // 1. 找出每个裁判列的最高分 (MaxScore per Referee)
  const maxScores = {} // { 1: 20, 2: 30 ... }

  for (let i = 1; i <= refCount; i++) {
    let max = 0
    players.forEach(p => {
      const s = scoresData.value[gName]?.[p]?.[i]?.total || 0
      if (s > max) max = s
    })
    maxScores[i] = max
  }

  // 2. 计算每个选手的比例分和最终均分
  const rows = players.map(p => {
    const scaledScores = {}
    let sumScaled = 0
    let validRefs = 0

    for (let i = 1; i <= refCount; i++) {
      const raw = scoresData.value[gName]?.[p]?.[i]?.total || 0
      const max = maxScores[i]

      // 算法: (Raw / Max) * Ratio
      // 如果 Max 为 0 (该裁判没打分)，则比例分为 0
      let scaled = 0
      if (max > 0) {
        scaled = (raw / max) * scaleRatio.value
      }

      scaledScores[i] = scaled
      sumScaled += scaled
      validRefs++ // 即使是0分也算参与了
    }

    const finalScore = validRefs > 0 ? (sumScaled / validRefs) : 0

    return {
      player: p,
      scaledScores,
      finalScore
    }
  })

  // 3. 排序 (分数高到低)
  return rows.sort((a, b) => b.finalScore - a.finalScore)
})

</script>

<style scoped lang="scss">
.report-view { display: flex; height: 100%; color: white; background: #1e1e1e; }

.sidebar {
  width: 250px; background: #252526; border-right: 1px solid #333; display: flex; flex-direction: column;
  .sidebar-header { padding: 20px; font-weight: bold; font-size: 1.2rem; border-bottom: 1px solid #333; }
  .group-list { flex: 1; overflow-y: auto; }
  .group-item { padding: 15px 20px; cursor: pointer; border-bottom: 1px solid #2d2d2d; &:hover { background: #2d2d2d; } &.active { background: #3498db; color: white; } }
  .btn-back { margin: 20px; padding: 10px; background: #444; border: none; color: #ccc; cursor: pointer; border-radius: 4px; &:hover { background: #555; } }
}

.main-content { flex: 1; display: flex; flex-direction: column; padding: 20px; overflow: hidden; }

.top-bar {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;
  h2 { margin: 0; }
  .view-switcher {
    display: flex; background: #333; border-radius: 4px; padding: 2px;
    button {
      background: transparent; border: none; color: #aaa; padding: 6px 15px; cursor: pointer; border-radius: 4px;
      &.active { background: #3498db; color: white; }
    }
  }
}

.settings-bar { margin-bottom: 15px; padding: 10px; background: #2d2d2d; border-radius: 4px; display: inline-block; input { background: #111; border: 1px solid #444; color: white; padding: 4px; width: 60px; margin-left: 10px; } }

.table-container { flex: 1; overflow: auto; background: #252526; border-radius: 8px; padding: 10px; }

table { width: 100%; border-collapse: collapse; min-width: 600px; }
th, td { text-align: center; padding: 10px; border-bottom: 1px solid #333; }
th { background: #333; position: sticky; top: 0; }
.fixed-col { text-align: left; font-weight: bold; color: #ddd; border-right: 1px solid #333; }
.highlight { color: #2ecc71; font-weight: bold; }
</style>
