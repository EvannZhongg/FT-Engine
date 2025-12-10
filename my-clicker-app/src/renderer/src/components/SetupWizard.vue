<template>
  <div class="setup-wizard">
    <div class="steps-header">
      <div :class="['step', { active: currentStep >= 1 }]">{{ $t('wiz_step_proj') }}</div>
      <div class="divider"></div>
      <div v-if="form.mode === 'TOURNAMENT'" :class="['step', { active: currentStep >= 2 }]">{{ $t('wiz_step_group') }}</div>
      <div v-if="form.mode === 'TOURNAMENT'" class="divider"></div>
      <div :class="['step', { active: currentStep === 3 }]">
        {{ form.mode === 'TOURNAMENT' ? '3. ' + $t('wiz_step_dev') : '2. ' + $t('wiz_step_dev') }}
      </div>
    </div>

    <div v-if="currentStep === 1" class="step-content">
      <h2>{{ $t('wiz_s1_title') }}</h2>
      <div class="form-group">
        <label>{{ $t('wiz_proj_name') }}</label>
        <input v-model="form.projectName" type="text" placeholder="Enter match name..." />
      </div>

      <div class="form-group">
        <label>{{ $t('wiz_mode') }}</label>
        <div class="radio-group">
          <label :class="{ checked: form.mode === 'FREE' }">
            <input type="radio" v-model="form.mode" value="FREE" /> {{ $t('wiz_mode_free') }}
          </label>
          <label :class="{ checked: form.mode === 'TOURNAMENT' }">
            <input type="radio" v-model="form.mode" value="TOURNAMENT" /> {{ $t('wiz_mode_tourn') }}
          </label>
        </div>
      </div>

      <div class="form-group" v-if="form.mode === 'FREE'">
        <label>{{ $t('wiz_ref_count') }}</label>
        <input type="number" v-model.number="form.refereeCount" min="1" max="10" />
      </div>

      <div class="actions">
        <button class="btn-secondary" @click="$emit('cancel')">{{ $t('btn_cancel') }}</button>
        <button class="btn-primary" @click="handleStep1Next">{{ $t('btn_next') }}</button>
      </div>
    </div>

    <div v-if="currentStep === 2 && form.mode === 'TOURNAMENT'" class="step-content group-manager">
      <h2>{{ $t('wiz_s2_title') }}</h2>

      <div class="manager-layout">
        <div class="sidebar">
          <div class="list-header">{{ $t('wiz_list_title') }}</div>
          <div class="group-list">
            <div
              v-for="(group, idx) in groups"
              :key="idx"
              class="group-item"
              :class="{ active: currentEditGroup === group }"
              @click="currentEditGroup = group"
            >
              {{ group.name }}
            </div>
          </div>
          <button class="btn-add-group" @click="addNewGroup">{{ $t('btn_add_group') }}</button>
        </div>

        <div class="main-edit" v-if="currentEditGroup">

          <div class="edit-header">
            <span class="edit-title">CONFIGURATION</span>
            <button
              class="btn-delete-group"
              @click="deleteCurrentGroup"
              v-if="groups.length > 1"
              :title="$t('btn_del_group')"
            >
              <Trash2 :size="16" /> {{ $t('btn_del_group') }}
            </button>
          </div>

          <div class="form-group">
            <label>{{ $t('wiz_lbl_grp_name') }}</label>
            <input v-model="currentEditGroup.name" type="text" />
          </div>

          <div class="form-group">
            <label>{{ $t('wiz_lbl_grp_ref') }}</label>
            <input type="number" v-model.number="currentEditGroup.refCount" min="1" max="10" />
            <small class="hint">{{ $t('wiz_hint_ref') }}</small>
          </div>

          <div class="form-group">
            <label>{{ $t('wiz_lbl_player') }}</label>
            <textarea
              v-model="currentEditGroup.rawPlayers"
              rows="6"
              :placeholder="$t('wiz_ph_player')"
              style="resize: vertical; min-height: 100px;"
            ></textarea>
          </div>

          </div>
      </div>

      <div class="actions">
        <button class="btn-secondary" @click="currentStep = 1">{{ $t('btn_back') }}</button>
        <button class="btn-primary" @click="handleStep2Next">{{ $t('btn_save_next') }}</button>
      </div>
    </div>

    <div v-if="currentStep === 3" class="step-content">
      <div class="scan-bar">
        <h2>{{ form.mode === 'TOURNAMENT' ? 'Step 3: ' : 'Step 2: ' }}{{ $t('wiz_s3_title') }}</h2>

        <div v-if="form.mode === 'TOURNAMENT'" class="target-group-select">
          <label>{{ $t('wiz_target_group') }}</label>
          <select v-model="selectedGroupToRun" @change="refreshBindingSlots">
            <option v-for="g in groups" :key="g.name" :value="g">{{ g.name }} ({{ g.refCount }} Refs)</option>
          </select>
        </div>

        <div class="scan-controls">
          <span v-if="isScanning" class="status scanning">{{ $t('status_scanning') }}</span>
          <span v-else class="status">{{ $t('status_found', { count: scannedDevices.length }) }}</span>
          <button class="btn-scan" @click="startScan(true)" :disabled="isScanning">{{ $t('btn_scan') }}</button>
        </div>
      </div>

      <div class="device-list-container">
        <div v-for="(bind, index) in bindings" :key="index" class="ref-card">
          <div class="card-header">
            {{ $t('lbl_referee') }} {{ bind.index }}
            <input v-model="bind.name" class="ref-name-input" :placeholder="$t('ph_judge_name')" />
          </div>
          <div class="card-body">
            <div class="row">
              <label>{{ $t('lbl_mode') }}</label>
              <select v-model="bind.mode" @change="onModeChange(bind)">
                <option value="SINGLE">{{ $t('opt_single') }}</option>
                <option value="DUAL">{{ $t('opt_dual') }}</option>
              </select>
            </div>
            <div class="row">
              <label>{{ $t('lbl_pri') }}</label>
              <select v-model="bind.pri_addr">
                <option value="">-- Select --</option>
                <option v-for="d in getAvailableDevices(index, 'pri')" :key="d.address" :value="d.address">
                  {{ d.name }} ({{ d.address }})
                </option>
              </select>
            </div>
            <div class="row" v-if="bind.mode === 'DUAL'">
              <label>{{ $t('lbl_sec') }}</label>
              <select v-model="bind.sec_addr">
                <option value="">-- Select --</option>
                <option v-for="d in getAvailableDevices(index, 'sec')" :key="d.address" :value="d.address">
                  {{ d.name }} ({{ d.address }})
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="btn-secondary" @click="goBackFromStep3">{{ $t('btn_back') }}</button>
        <button class="btn-success" @click="finishSetup">{{ $t('btn_start') }}</button>
      </div>
    </div>

    <div v-if="isConnecting" class="overlay">
      <div class="connect-dialog">
        <h3>{{ $t('dialog_conn_title') }}</h3>
        <div class="status-list">
          <div v-for="b in bindings" :key="b.index" class="status-row">
            <span>{{ b.name }}</span>
            <div class="tags">
              <span class="tag" :class="getRefStatus(b.index, 'pri')">{{ $t('lbl_pri') }}</span>
              <span v-if="b.mode==='DUAL'" class="tag" :class="getRefStatus(b.index, 'sec')">{{ $t('lbl_sec') }}</span>
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <div v-if="showForceEntry">
            <p class="warn">{{ $t('msg_timeout') }}</p>
            <button class="btn-secondary" @click="cancelConnect">{{ $t('btn_cancel') }}</button>
            <button class="btn-primary" @click="confirmForceEnter">{{ $t('btn_force') }}</button>
          </div>
          <div v-else>
            <p>{{ $t('status_waiting') }}...</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'
// 【新增】引入图标
import { Trash2 } from 'lucide-vue-next'

const emit = defineEmits(['cancel', 'finished'])
const store = useRefereeStore()

const currentStep = ref(1)
const isScanning = ref(false)
const scannedDevices = ref([])
const form = reactive({
  projectName: 'New Match',
  mode: 'FREE',
  refereeCount: 1
})
const groups = ref([])
const currentEditGroup = ref(null)
const selectedGroupToRun = ref(null)
const bindings = ref([])
const isConnecting = ref(false)
const showForceEntry = ref(false)
let connectTimer = null

// --- Methods ---

const handleStep1Next = async () => {
  await store.createProject(form.projectName, form.mode)
  groups.value = []
  selectedGroupToRun.value = null

  if (form.mode === 'TOURNAMENT') {
    if (groups.value.length === 0) addNewGroup()
    currentStep.value = 2
  } else {
    const freeGroup = {
      name: 'Free Mode',
      refCount: form.refereeCount,
      rawPlayers: 'Player 1\nPlayer 2\nPlayer 3',
      players: ['Player 1', 'Player 2', 'Player 3'],
      referees: []
    }
    groups.value = [freeGroup]
    await store.updateGroups(groups.value)
    selectedGroupToRun.value = freeGroup
    refreshBindingSlots()
    currentStep.value = 3
    if (scannedDevices.value.length === 0) startScan(false)
  }
}

const addNewGroup = () => {
  const newG = {
    name: `Group ${groups.value.length + 1}`,
    refCount: 3,
    rawPlayers: '',
    players: [],
    referees: []
  }
  groups.value.push(newG)
  currentEditGroup.value = newG
}

const deleteCurrentGroup = () => {
  const idx = groups.value.indexOf(currentEditGroup.value)
  if (idx > -1) {
    groups.value.splice(idx, 1)
    currentEditGroup.value = groups.value[0] || null
  }
}

const handleStep2Next = async () => {
  groups.value.forEach(g => {
    g.players = g.rawPlayers
      .split('\n')
      .map(p => p.trim())
      .filter(p => p !== '')
  })
  await store.updateGroups(groups.value)
  if (groups.value.length > 0) selectedGroupToRun.value = groups.value[0]

  refreshBindingSlots()
  currentStep.value = 3
  if (scannedDevices.value.length === 0) startScan(false)
}

const refreshBindingSlots = () => {
  if (!selectedGroupToRun.value) return
  const targetGroup = selectedGroupToRun.value
  const count = targetGroup.refCount

  if (targetGroup.referees && targetGroup.referees.length === count) {
    bindings.value = JSON.parse(JSON.stringify(targetGroup.referees))
  } else {
    bindings.value = Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      name: `Referee ${i + 1}`,
      mode: 'SINGLE',
      pri_addr: '',
      sec_addr: ''
    }))
  }
}

const startScan = async (isRefresh = true) => {
  isScanning.value = true
  try {
    const allDevices = await store.scanDevices(isRefresh)
    scannedDevices.value = allDevices
  } catch (e) {
    console.error("Scan error", e)
  } finally {
    isScanning.value = false
  }
}

const getAvailableDevices = (currentIndex, currentType) => {
  const used = new Set()
  bindings.value.forEach((b, idx) => {
    if (b.pri_addr && (idx !== currentIndex || currentType !== 'pri')) used.add(b.pri_addr)
    if (b.mode === 'DUAL' && b.sec_addr && (idx !== currentIndex || currentType !== 'sec')) used.add(b.sec_addr)
  })
  return scannedDevices.value.filter(d => !used.has(d.address))
}

const onModeChange = (binding) => {
  if (binding.mode === 'SINGLE') binding.sec_addr = ''
}

const goBackFromStep3 = () => {
  if (form.mode === 'TOURNAMENT') {
    currentStep.value = 2
  } else {
    groups.value = []
    selectedGroupToRun.value = null
    currentStep.value = 1
  }
}

const finishSetup = async () => {
  if (selectedGroupToRun.value) {
    selectedGroupToRun.value.referees = JSON.parse(JSON.stringify(bindings.value))
    await store.updateGroups(groups.value)
  }

  const groupName = selectedGroupToRun.value.name
  const firstPlayer = selectedGroupToRun.value.players[0] || "Player 1"
  await store.setMatchContext(groupName, firstPlayer)
  await store.startMatch({ referees: bindings.value })

  isConnecting.value = true
  showForceEntry.value = false

  const timeout = setTimeout(() => { showForceEntry.value = true }, 8000)

  connectTimer = setInterval(() => {
    if (checkAllConnected()) {
      clearTimeout(timeout)
      clearInterval(connectTimer)
      isConnecting.value = false
      emit('finished')
    } else if (checkAnyError()) {
      showForceEntry.value = true
    }
  }, 500)
}

const getRefStatus = (index, role) => {
  const r = store.referees[index]
  if (!r || !r.status) return 'waiting'
  return r.status[role]
}

const checkAllConnected = () => {
  for (const b of bindings.value) {
    const status = store.referees[b.index]?.status
    if (!status) return false
    if (b.pri_addr && status.pri !== 'connected') return false
    if (b.mode === 'DUAL' && b.sec_addr && status.sec !== 'connected') return false
  }
  return true
}

const checkAnyError = () => {
  for (const b of bindings.value) {
    const status = store.referees[b.index]?.status
    if (status && (status.pri === 'error' || status.sec === 'error')) return true
  }
  return false
}

const cancelConnect = () => {
  clearInterval(connectTimer)
  isConnecting.value = false
  store.stopMatch()
}

const confirmForceEnter = () => {
  clearInterval(connectTimer)
  isConnecting.value = false
  emit('finished')
}
</script>

<style scoped lang="scss">
.setup-wizard {
  padding: 30px;
  color: white;
  max-width: 900px;
  margin: 0 auto;
}

.steps-header {
  display: flex;
  align-items: center;
  margin-bottom: 30px;

  .step {
    font-size: 1.1rem;
    color: #666;
    font-weight: bold;

    &.active {
      color: #3498db;
    }
  }

  .divider {
    flex: 1;
    height: 1px;
    background: #333;
    margin: 0 15px;
  }
}

.step-content {
  animation: fadeIn 0.3s;

  h2 {
    margin-bottom: 20px;
    color: #eee;
  }
}

/* Form Styles */
.form-group {
  margin-bottom: 20px;

  label {
    display: block;
    margin-bottom: 8px;
    color: #ccc;
  }

  input, textarea, select {
    width: 100%;
    padding: 10px;
    background: #252526;
    border: 1px solid #3d3d3d;
    color: white;
    border-radius: 4px;
    outline: none;

    &:focus {
      border-color: #3498db;
    }
  }

  .hint {
    color: #666;
    font-size: 0.8rem;
    margin-top: 4px;
    display: block;
  }
}

.radio-group {
  display: flex;
  gap: 20px;

  label {
    cursor: pointer;
    padding: 10px 20px;
    background: #252526;
    border: 1px solid #3d3d3d;
    border-radius: 4px;
    transition: all 0.2s;

    &.checked {
      background: #3498db;
      border-color: #3498db;
    }

    input {
      display: none;
    }
  }
}

/* Group Manager Layout */
.group-manager {
  .manager-layout {
    display: flex;
    gap: 20px;
    height: 400px;
  }

  .sidebar {
    width: 200px;
    background: #252526;
    border: 1px solid #3d3d3d;
    display: flex;
    flex-direction: column;

    .list-header {
      padding: 10px;
      background: #333;
      font-weight: bold;
      text-align: center;
    }

    .group-list {
      flex: 1;
      overflow-y: auto;
    }

    .group-item {
      padding: 10px;
      cursor: pointer;
      border-bottom: 1px solid #333;

      &:hover {
        background: #2f2f2f;
      }

      &.active {
        background: #3498db;
        color: white;
      }
    }

    .btn-add-group {
      padding: 10px;
      background: #2ecc71;
      border: none;
      color: white;
      cursor: pointer;
      font-weight: bold;

      &:hover {
        background: #27ae60;
      }
    }
  }

.main-edit {
    flex: 1;
    background: #252526;
    padding: 20px;
    border: 1px solid #3d3d3d;
    display: flex;
    flex-direction: column;

    /* 【修改点 1】保持垂直滚动，强制隐藏水平滚动 */
    overflow-y: auto;
    overflow-x: hidden;
  }
}

/* 【新增】编辑区域 Header 样式 */
.edit-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #3d3d3d;
}

.edit-title {
  font-weight: bold;
  color: #888;
  font-size: 0.9rem;
  text-transform: uppercase;
}

.btn-delete-group {
  background: transparent;
  border: 1px solid #c0392b;
  color: #c0392b;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
  cursor: pointer;
}

.btn-delete-group:hover {
  background: #c0392b;
  color: white;
}

/* Device Binding Styles */
.scan-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;

  .target-group-select {
    display: flex;
    align-items: center;
    gap: 10px;

    select {
      width: 200px;
      padding: 5px;
    }
  }
}

.device-list-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
  max-height: 400px;
  overflow-y: auto;
}

.ref-card {
  background: #252526;
  border: 1px solid #3d3d3d;
  border-radius: 6px;

  .card-header {
    background: #333;
    padding: 8px 12px;
    font-weight: bold;
    display: flex;
    justify-content: space-between;
    align-items: center;

    .ref-name-input {
      width: 120px;
      padding: 2px 5px;
      font-size: 0.9rem;
      background: #222;
      border: 1px solid #444;
    }
  }

  .card-body {
    padding: 10px;
  }

  .row {
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;

    label {
      width: 70px;
      font-size: 0.85rem;
      color: #888;
      margin: 0;
    }

    select {
      width: 180px;
      padding: 4px;
      font-size: 0.9rem;
    }
  }
}

/* Action Buttons */
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 15px;
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #333;

  button {
    padding: 8px 20px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-weight: bold;

    &.btn-primary {
      background: #3498db;
      color: white;

      &:hover {
        background: #2980b9;
      }
    }

    &.btn-secondary {
      background: #555;
      color: white;

      &:hover {
        background: #666;
      }
    }

    &.btn-success {
      background: #2ecc71;
      color: white;

      &:hover {
        background: #27ae60;
      }
    }

    &.btn-scan {
      background: #f39c12;
      color: white;

      &:hover {
        background: #d35400;
      }
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

/* Overlay */
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.connect-dialog {
  background: #252526;
  padding: 20px;
  width: 350px;
  border-radius: 8px;
  text-align: center;
}

.status-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  border-bottom: 1px solid #333;
  padding-bottom: 4px;

  .tag {
    font-size: 0.8rem;
    padding: 2px 6px;
    border-radius: 3px;
    margin-left: 5px;

    &.connected {
      background: #27ae60;
    }

    &.connecting {
      background: #f39c12;
    }

    &.error {
      background: #c0392b;
    }

    &.waiting {
      background: #555;
    }
  }
}

.warn {
  color: #e74c3c;
  margin: 10px 0;
}

.dialog-actions {
  margin-top: 15px;

  button {
    margin: 0 5px;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
