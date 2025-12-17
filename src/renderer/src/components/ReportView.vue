<template>
  <div class="report-view">
    <div class="sidebar">
      <div class="sidebar-header">{{ $t('rpt_lbl_groups') }}</div>
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
      <button class="btn-back" @click="$emit('back')">{{ $t('rpt_btn_back') }}</button>
    </div>

    <div class="main-content" v-if="currentGroup">
      <div class="top-bar">
        <div class="bar-left">
          <div v-if="viewMode === 'SCALED'" class="settings-inline">
            <label>{{ $t('rpt_lbl_ratio') }}</label>
            <input type="number" v-model.number="scaleRatio" min="1" max="100">
          </div>
        </div>

        <div class="bar-right">
          <button class="btn-export-details" @click="openExportModal">
            {{ $t('rpt_btn_details') }}
          </button>

          <button class="btn-export-csv" @click="exportCSV" :title="$t('rpt_btn_csv')">
            {{ $t('rpt_btn_csv') }}
          </button>

          <div class="view-switcher">
            <button :class="{ active: viewMode === 'SCALED' }" @click="viewMode = 'SCALED'">{{ $t('rpt_view_scaled') }}</button>
            <button :class="{ active: viewMode === 'RAW' }" @click="viewMode = 'RAW'">{{ $t('rpt_view_raw') }}</button>
          </div>
        </div>
      </div>

      <div v-if="viewMode === 'SCALED'" class="table-container">
        <table class="striped-table">
          <thead>
            <tr>
              <th width="60">{{ $t('rpt_col_rank') }}</th>
              <th>{{ $t('rpt_col_contestant') }}</th>
              <th v-for="i in currentGroup.refCount" :key="i">
                {{ getRefName(i) }}
              </th>
              <th>{{ $t('rpt_col_final') }}</th>
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

      <div v-if="viewMode === 'RAW'" class="table-container">
        <table class="striped-table">
          <thead>
            <tr>
              <th>{{ $t('rpt_col_contestant') }}</th>
              <th v-for="i in currentGroup.refCount" :key="i">
                 {{ getRefName(i) }}
              </th>
              <th>{{ $t('rpt_col_avg') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="player in currentGroup.players" :key="player">
              <td class="fixed-col">{{ player }}</td>
              <td v-for="i in currentGroup.refCount" :key="i">
                <div class="score-cell">
                  <div class="main-score">{{ getRawDetail(player, i).total }}</div>
                  <div class="sub-score">
                    <span class="plus">+{{ getRawDetail(player, i).plus }}</span> /
                    <span class="minus">{{ getRawDetail(player, i).minus }}</span>
                  </div>
                </div>
              </td>
              <td class="highlight">{{ getRawAverage(player).toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="showExportModal" class="modal-overlay" @click.self="showExportModal = false">
         <div class="modal-content export-modal">
            <h3>{{ $t('rpt_title_export') }}</h3>
             <div class="modal-body-layout">
                <div class="section-players">
                   <div class="section-header">
                      <span>{{ $t('rpt_lbl_sel_players') }} ({{ selectedPlayers.length }})</span>
                      <label class="select-all-label">
                      <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll"> {{ $t('rpt_lbl_all') }}
                      </label>
                   </div>
                   <div class="player-scroll-list">
                      <label v-for="p in currentGroup?.players" :key="p" class="player-item-row">
                      <input type="checkbox" v-model="selectedPlayers" :value="p">
                      <span class="p-name">{{ p }}</span>
                      </label>
                   </div>
                </div>
                <div class="section-options">
                   <h4>{{ $t('rpt_lbl_fmt') }}</h4>
                   <div class="options-grid">
                      <label class="opt-row">
                      <input type="checkbox" v-model="exportOpts.txt">
                      <span>{{ $t('rpt_opt_txt') }}</span>
                      </label>
                      <label class="opt-row">
                      <input type="checkbox" v-model="exportOpts.srt">
                      <span>{{ $t('rpt_opt_srt') }}</span>
                      </label>
                      <div class="sub-opts" v-if="exportOpts.srt">
                         <label>{{ $t('rpt_lbl_srt_mode') }}</label>
                         <select v-model="exportOpts.srt_mode">
                            <option value="TOTAL">{{ $t('rpt_srt_total') }}</option>
                            <option value="SPLIT">{{ $t('rpt_srt_split') }}</option>
                            <option value="REALTIME">{{ $t('rpt_srt_burst') }}</option>
                         </select>
                      </div>
                   </div>
                </div>
             </div>
             <div class="modal-actions">
                <button class="btn-cancel" @click="showExportModal = false">{{ $t('btn_cancel') }}</button>
                <button class="btn-confirm" @click="confirmBatchExport" :disabled="selectedPlayers.length === 0">
                {{ $t('rpt_btn_dl_zip') }}
                </button>
             </div>
         </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'
import { useI18n } from 'vue-i18n'

const props = defineProps(['projectDir'])
const emit = defineEmits(['back'])
const store = useRefereeStore()
const { t } = useI18n()

const groups = ref([])
const currentGroup = ref(null)
const scoresData = ref({})
const viewMode = ref('SCALED')
const scaleRatio = ref(60)

// 导出相关状态
const selectedPlayers = ref([])
const showExportModal = ref(false)
const exportOpts = ref({
  txt: true,
  srt: true,
  srt_mode: 'REALTIME'
})

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

// --- 新增：获取裁判名称的方法 ---
const getRefName = (index) => {
  // 检查当前组别是否有 referees 配置信息
  if (currentGroup.value && Array.isArray(currentGroup.value.referees)) {
    // 查找对应 index 的裁判配置
    const refConfig = currentGroup.value.referees.find(r => r.index === index)
    // 如果找到了且有名字，返回名字
    if (refConfig && refConfig.name) {
      return refConfig.name
    }
  }
  // 降级显示：Ref 1, Ref 2...
  return `${t('rpt_col_ref')} ${index}`
}

// --- Helper Functions ---
const getRawScoreObj = (player, refIdx) => {
  if (!currentGroup.value) return null
  const gName = currentGroup.value.name
  return scoresData.value[gName]?.[player]?.[refIdx]
}

const getRawDetail = (player, refIdx) => {
  const obj = getRawScoreObj(player, refIdx)
  if (!obj) return { total: '-', plus: '-', minus: '-' }
  return { total: obj.total, plus: obj.plus, minus: obj.minus }
}

const getRawAverage = (player) => {
  if (!currentGroup.value) return 0
  let sum = 0
  for (let i = 1; i <= currentGroup.value.refCount; i++) {
    const obj = getRawScoreObj(player, i)
    if (obj) sum += obj.total
  }
  return sum / currentGroup.value.refCount
}

// --- 计算逻辑 ---
const sortedScaledRows = computed(() => {
  if (!currentGroup.value) return []
  const players = currentGroup.value.players
  const refCount = currentGroup.value.refCount
  const gName = currentGroup.value.name
  const maxScores = {}

  for (let i = 1; i <= refCount; i++) {
    let max = 0
    players.forEach(p => {
      const s = scoresData.value[gName]?.[p]?.[i]?.total || 0
      if (s > max) max = s
    })
    maxScores[i] = max
  }

  const rows = players.map(p => {
    const scaledScores = {}
    let sumScaled = 0
    let validRefs = 0
    for (let i = 1; i <= refCount; i++) {
      const raw = scoresData.value[gName]?.[p]?.[i]?.total || 0
      const max = maxScores[i]
      let scaled = 0
      if (max > 0) scaled = (raw / max) * scaleRatio.value
      scaledScores[i] = scaled
      sumScaled += scaled
      validRefs++
    }
    const finalScore = validRefs > 0 ? (sumScaled / validRefs) : 0
    return { player: p, scaledScores, finalScore }
  })
  return rows.sort((a, b) => b.finalScore - a.finalScore)
})

// --- 导出逻辑 (Modal) ---
const openExportModal = () => {
  if (currentGroup.value) {
    selectedPlayers.value = [...currentGroup.value.players]
  }
  showExportModal.value = true
}

const isAllSelected = computed(() => {
  if (!currentGroup.value) return false
  return selectedPlayers.value.length === currentGroup.value.players.length && currentGroup.value.players.length > 0
})

const toggleSelectAll = (e) => {
  if (e.target.checked) {
    selectedPlayers.value = [...currentGroup.value.players]
  } else {
    selectedPlayers.value = []
  }
}

const confirmBatchExport = async () => {
  if (selectedPlayers.value.length === 0) return

  const success = await store.exportScoreDetails(
    currentGroup.value.name,
    selectedPlayers.value,
    exportOpts.value
  )

  if (success) {
    showExportModal.value = false
  } else {
    alert(t('rpt_msg_fail'))
  }
}

// --- CSV 导出逻辑 (修改为使用真实名字) ---
const exportCSV = () => {
  if (!currentGroup.value) return

  let csvContent = "data:text/csv;charset=utf-8,\uFEFF"
  const refCount = currentGroup.value.refCount

  if (viewMode.value === 'SCALED') {
    let header = ['Rank', 'Contestant']
    // 修改：使用真实名字
    for(let i=1; i<=refCount; i++) header.push(`${getRefName(i)} (Scaled)`)
    header.push('Final Score')
    csvContent += header.join(',') + "\n"

    sortedScaledRows.value.forEach((row, idx) => {
      let line = [idx + 1, row.player]
      for(let i=1; i<=refCount; i++) line.push(row.scaledScores[i].toFixed(2))
      line.push(row.finalScore.toFixed(2))
      csvContent += line.join(',') + "\n"
    })

  } else {
    let header = ['Contestant']
    // 修改：使用真实名字
    for(let i=1; i<=refCount; i++) {
      header.push(getRefName(i))
    }
    header.push('Average Score')
    csvContent += header.join(',') + "\n"

    currentGroup.value.players.forEach(player => {
      let line = [player]
      for(let i=1; i<=refCount; i++) {
        const d = getRawDetail(player, i)
        const t = d.total === '-' ? 0 : d.total
        line.push(t)
      }
      line.push(getRawAverage(player).toFixed(2))
      csvContent += line.join(',') + "\n"
    })
  }

  const encodedUri = encodeURI(csvContent)
  const link = document.createElement("a")
  link.setAttribute("href", encodedUri)
  const safeName = currentGroup.value.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  link.setAttribute("download", `${safeName}_${viewMode.value.toLowerCase()}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

</script>

<style scoped lang="scss">
.report-view { display: flex; height: 100%; color: white; background: #1e1e1e; }

.sidebar {
  width: 250px;
  background: #252526;
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;

  .sidebar-header {
    padding: 20px;
    font-weight: bold;
    font-size: 1.2rem;
    border-bottom: 1px solid #333;
  }

  .group-list {
    flex: 1;
    overflow-y: auto;
  }

  .group-item {
    padding: 15px 20px;
    cursor: pointer;
    border-bottom: 1px solid #2d2d2d;

    &:hover { background: #2d2d2d; }
    &.active { background: #3498db; color: white; }
  }

  .btn-back {
    margin: 20px;
    padding: 10px;
    background: #444;
    border: none;
    color: #ccc;
    cursor: pointer;
    border-radius: 4px;
    &:hover { background: #555; }
  }
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px;
  overflow: hidden;
}

/* 顶部工具栏样式优化 */
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  background: #252526;
  padding: 12px 20px; /* 增加内边距 */
  border-radius: 6px;
  border: 1px solid #333;
  min-height: 50px;

  .bar-left {
    display: flex;
    align-items: center;
    /* 移除了之前的 h2 样式 */

    .settings-inline {
      display: flex;
      align-items: center;
      background: #333;
      padding: 6px 12px;
      border-radius: 4px;

      label {
        margin-right: 10px;
        font-size: 0.9rem;
        color: #ccc;
      }

      input {
        background: #111;
        border: 1px solid #555;
        color: white;
        padding: 4px 8px;
        width: 60px;
        border-radius: 3px;
        text-align: center;
      }
    }
  }

  .bar-right {
    display: flex;
    align-items: center;
    gap: 20px; /* 增加按钮间距，使布局更均衡 */

    button.btn-export-details {
      background: #e67e22;
      color: white;
      border: none;
      padding: 8px 16px; /* 增加按钮填充 */
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      &:hover { background: #d35400; }
    }

    button.btn-export-csv {
      background: #27ae60;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      &:hover { background: #219150; }
    }

    .view-switcher {
      display: flex;
      background: #333;
      border-radius: 4px;
      padding: 3px;

      button {
        background: transparent;
        border: none;
        color: #aaa;
        padding: 6px 18px; /* 增加点击区域 */
        cursor: pointer;
        border-radius: 4px;
        font-weight: bold;

        &.active {
          background: #3498db;
          color: white;
        }
      }
    }
  }
}

.table-container { flex: 1; overflow: auto; background: #252526; border-radius: 8px; padding: 10px; box-shadow: inset 0 0 20px rgba(0,0,0,0.2); }
table { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 600px; }
th, td { text-align: center; padding: 12px 10px; border-bottom: 1px solid #333; }
th { background: #333; position: sticky; top: 0; z-index: 10; color: #eee; }
.striped-table tbody tr:nth-child(odd) { background-color: rgba(52, 152, 219, 0.08); &:hover { background-color: rgba(52, 152, 219, 0.15); } }
.striped-table tbody tr:nth-child(even) { background-color: rgba(231, 76, 60, 0.08); &:hover { background-color: rgba(231, 76, 60, 0.15); } }
.fixed-col { text-align: left; font-weight: bold; color: #ddd; border-right: 1px solid #333; background: inherit; }
.highlight { color: #2ecc71; font-weight: bold; font-size: 1.1rem; }
.score-cell { display: flex; flex-direction: column; align-items: center; .main-score { font-size: 1.1rem; font-weight: bold; color: white; } .sub-score { font-size: 0.8rem; color: #aaa; margin-top: 2px; } .plus { color: #aaa; } .minus { color: #e74c3c; } }

.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 2000; }
.modal-content.export-modal { background: #2b2b2b; padding: 25px; border-radius: 8px; width: 550px; color: white; display: flex; flex-direction: column; h3 { margin-top: 0; border-bottom: 1px solid #444; padding-bottom: 10px; } .modal-body-layout { display: flex; gap: 20px; height: 300px; } .section-players { flex: 1; display: flex; flex-direction: column; border-right: 1px solid #444; padding-right: 15px; .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 0.9rem; color: #aaa; } .select-all-label { display: flex; align-items: center; gap: 5px; cursor: pointer; color: #3498db; font-weight: bold; } .player-scroll-list { flex: 1; overflow-y: auto; background: #222; border: 1px solid #444; border-radius: 4px; padding: 5px; .player-item-row { display: flex; align-items: center; padding: 5px 8px; cursor: pointer; &:hover { background: #333; } } .p-name { margin-left: 8px; font-size: 0.9rem; } } } .section-options { width: 200px; padding-left: 5px; h4 { margin: 0 0 15px 0; color: #ccc; font-size: 0.95rem; } .options-grid { display: flex; flex-direction: column; gap: 15px; } .opt-row { display: flex; align-items: center; gap: 10px; cursor: pointer; input { width: 18px; height: 18px; } } .sub-opts { margin-left: 28px; display: flex; flex-direction: column; gap: 5px; select { background: #444; color: white; padding: 6px; border: 1px solid #666; border-radius: 4px; width: 100%; } } } .modal-actions { margin-top: 20px; border-top: 1px solid #444; padding-top: 15px; display: flex; justify-content: flex-end; gap: 10px; } .btn-confirm { background: #3498db; color: white; padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; &:disabled { background: #555; cursor: not-allowed; } } .btn-cancel { background: #555; color: white; padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; } }
</style>
