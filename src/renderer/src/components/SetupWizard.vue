<template>
  <div class="setup-wizard">
    <input
      type="file"
      ref="fileInput"
      style="display: none"
      accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
      @change="handleFileImport"
    />

    <div class="steps-header">
      <div :class="['step', { active: currentStep >= 1 }]">{{ $t('wiz_step_proj') }}</div>
      <div class="divider"></div>
      <div v-if="form.mode === 'TOURNAMENT'" :class="['step', { active: currentStep >= 2 }]">
        {{ $t('wiz_step_group') }}
      </div>
      <div v-if="form.mode === 'TOURNAMENT'" class="divider"></div>
      <div :class="['step', { active: currentStep === 3 }]">
        {{ form.mode === 'TOURNAMENT' ? '3. ' + $t('wiz_step_dev') : '2. ' + $t('wiz_step_dev') }}
      </div>
    </div>

    <div v-if="currentStep === 1" class="step-content">
      <h2>{{ $t('wiz_s1_title') }}</h2>
      <div class="form-group">
        <label>{{ $t('wiz_proj_name') }}</label>
        <input v-model="form.projectName" type="text" :placeholder="$t('wiz_ph_proj_name')" />
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
            <span class="edit-title">{{ $t('wiz_config_title') }}</span>
            <button class="btn-delete-group" @click="deleteCurrentGroup" v-if="groups.length > 1">
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
          </div>
          <div class="form-group">
            <div class="label-row">
              <label>{{ $t('wiz_lbl_player') }}</label>
              <button class="btn-import-mini" @click="triggerFileImport" :title="$t('title_import_csv')">
                <Upload :size="14" style="margin-right:4px"/> {{ $t('btn_import_list') }}
              </button>
            </div>
            <textarea
              v-model="currentEditGroup.rawPlayers"
              rows="6"
              style="resize: vertical; min-height: 100px;"
              :placeholder="$t('wiz_ph_player')"
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
        <h2>
          {{ $t('wiz_step_prefix') }} {{ form.mode === 'TOURNAMENT' ? '3' : '2' }}: {{ $t('wiz_s3_title') }}
        </h2>
        <div v-if="form.mode === 'TOURNAMENT'" class="target-group-select">
          <label>{{ $t('wiz_target_group') }}</label>
          <select v-model="selectedGroupToRun" @change="refreshBindingSlots">
            <option v-for="g in groups" :key="g.name" :value="g">
              {{ g.name }} ({{ g.refCount }} {{ $t('wiz_suffix_refs') }})
            </option>
          </select>
        </div>
        <div class="scan-controls">
          <span v-if="isScanning" class="status scanning">{{ $t('status_scanning') }}</span>
          <span v-else class="status">{{ $t('status_found', { count: scannedDevices.length }) }}</span>

          <button class="btn-alias" @click="openAliasModal" :disabled="isScanning" :title="$t('title_device_remarks')">
            <Tag :size="16" />
          </button>

          <button class="btn-scan" @click="startScan(true)" :disabled="isScanning">{{ $t('btn_scan') }}</button>
        </div>
      </div>

      <div class="device-list-container">
        <div v-for="(bind, index) in bindings" :key="index" class="ref-card">
          <div class="card-header">
            <span>{{ $t('lbl_referee') }} {{ bind.index }}</span>
            <input
              v-model="bind.name"
              class="ref-name-input"
              :placeholder="$t('ph_judge_name')"
            />
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
                <option value="">{{ $t('opt_select_default') }}</option>
                <option v-for="d in getAvailableDevices(index, 'pri')" :key="d.address" :value="d.address">
                  {{ getDeviceDisplayName(d) }}
                </option>
              </select>
            </div>
            <div class="row" v-if="bind.mode === 'DUAL'">
              <label>{{ $t('lbl_sec') }}</label>
              <select v-model="bind.sec_addr">
                <option value="">{{ $t('opt_select_default') }}</option>
                <option v-for="d in getAvailableDevices(index, 'sec')" :key="d.address" :value="d.address">
                  {{ getDeviceDisplayName(d) }}
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
              <span v-if="b.mode === 'DUAL'" class="tag" :class="getRefStatus(b.index, 'sec')">{{ $t('lbl_sec') }}</span>
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

    <div v-if="showImportModal" class="overlay">
      <div class="import-dialog">
        <h3>{{ $t('dialog_import_title') }}</h3>
        <p class="sub-text">{{ $t('dialog_import_subtitle') }}</p>

        <div class="column-list">
          <div
            v-for="(col, idx) in importCandidates"
            :key="idx"
            class="column-item"
            :class="{ active: selectedColumnIdx === idx }"
            @click="selectedColumnIdx = idx"
          >
            <div class="col-header">{{ $t('lbl_column') }} {{ idx + 1 }}</div>
            <div class="col-preview">{{ col.preview }}</div>
            <div class="col-count">({{ col.data.length }} {{ $t('lbl_rows') }})</div>
          </div>
        </div>

        <div class="dialog-actions">
          <button class="btn-secondary" @click="showImportModal = false">{{ $t('btn_cancel') }}</button>
          <button class="btn-primary" @click="confirmImport">{{ $t('btn_confirm_import') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showAliasModal" class="overlay">
      <div class="import-dialog alias-dialog">
        <h3>{{ $t('title_device_remarks') }}</h3>
        <p class="sub-text">{{ $t('msg_device_remarks') }}</p>

        <div class="column-list custom-scroll">
          <div v-if="scannedDevices.length === 0" class="no-data">
            {{ $t('msg_no_devices') }}
          </div>
          <div v-else v-for="dev in scannedDevices" :key="dev.address" class="alias-item">
            <div class="dev-info">
              <div class="dev-name">{{ dev.name }}</div>
              <div class="dev-addr">{{ dev.address }}</div>
            </div>
            <input
              type="text"
              class="alias-input"
              v-model="tempRemarks[dev.address]"
              :placeholder="$t('ph_add_remark')"
            />
          </div>
        </div>

        <div class="dialog-actions">
          <button class="btn-secondary" @click="showAliasModal = false">{{ $t('btn_cancel') }}</button>
          <button class="btn-primary" @click="saveAliases">{{ $t('btn_save') }}</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'
import { Trash2, Upload, Tag } from 'lucide-vue-next'
import { read, utils } from 'xlsx'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const emit = defineEmits(['cancel', 'finished'])
const store = useRefereeStore()
const currentStep = ref(1)
const isScanning = ref(false)
const scannedDevices = ref([])
const form = reactive({ projectName: 'New Match', mode: 'FREE', refereeCount: 1 })
const groups = ref([])
const currentEditGroup = ref(null)
const selectedGroupToRun = ref(null)
const bindings = ref([])
const isConnecting = ref(false)
const showForceEntry = ref(false)
let connectTimer = null
const isResuming = computed(() => !!store.projectConfig.created_at)

// --- 导入功能相关状态 ---
const fileInput = ref(null)
const showImportModal = ref(false)
const importCandidates = ref([])
const selectedColumnIdx = ref(0)

// --- 【新增】设备备注相关状态 ---
const showAliasModal = ref(false)
const tempRemarks = reactive({}) // 暂存编辑中的备注 { "MAC": "Remark" }

onMounted(async () => {
  if (isResuming.value) {
    form.projectName = store.projectConfig.project_name
    form.mode = store.projectConfig.mode
    if (store.projectConfig.groups && store.projectConfig.groups.length > 0) {
      groups.value = store.projectConfig.groups.map(g => ({ ...g, rawPlayers: (g.players || []).join('\n') }))
      currentEditGroup.value = groups.value[0]
      selectedGroupToRun.value = groups.value[0]
    }
    if (form.mode === 'FREE' && groups.value[0]) form.refereeCount = groups.value[0].refCount
    currentStep.value = 1
  }
  // 确保配置已加载，以便读取 device_remarks
  await store.fetchSettings()
})

// --- 导入功能逻辑 ---
const triggerFileImport = () => { fileInput.value.click() }
const handleFileImport = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
        const data = await file.arrayBuffer(); const workbook = read(data); const firstSheetName = workbook.SheetNames[0]; const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = utils.sheet_to_json(worksheet, { header: 1 });
        if (!jsonData || jsonData.length === 0) { alert(t('msg_file_empty')); return; }
        let maxCols = 0; jsonData.forEach(row => { if (row.length > maxCols) maxCols = row.length });
        const candidates = [];
        for (let c = 0; c < maxCols; c++) {
            const colData = [];
            for (let r = 0; r < jsonData.length; r++) { const cell = jsonData[r][c]; if (cell !== undefined && cell !== null && String(cell).trim() !== '') { colData.push(String(cell).trim()); } }
            if (colData.length > 0) {
                const preview = colData.slice(0, 3).join(', ') + (colData.length > 3 ? '...' : '');
                candidates.push({ index: c, header: `列 ${c + 1}`, preview: preview, data: colData });
            }
        }
        if (candidates.length === 0) { alert(t('msg_no_valid_data')); return; }
        importCandidates.value = candidates; selectedColumnIdx.value = 0; showImportModal.value = true;
    } catch (err) { console.error(err); alert(t('msg_read_fail')); } finally { e.target.value = ''; }
}
const confirmImport = () => {
  if (!currentEditGroup.value) return
  const selectedCandidate = importCandidates.value[selectedColumnIdx.value]
  if (selectedCandidate) {
    const newPlayers = selectedCandidate.data.join('\n')
    if (currentEditGroup.value.rawPlayers && currentEditGroup.value.rawPlayers.trim()) {
      currentEditGroup.value.rawPlayers += '\n' + newPlayers
    } else {
      currentEditGroup.value.rawPlayers = newPlayers
    }
  }
  showImportModal.value = false
}

// --- Step 1 & 2 Logic ---
const handleStep1Next = async () => {
    try {
        if (!isResuming.value) { await store.createProject(form.projectName, form.mode) } else { store.projectConfig.mode = form.mode; store.projectConfig.project_name = form.projectName; }
        if (groups.value.length === 0) {
            if (form.mode === 'TOURNAMENT') { addNewGroup() } else { const freeGroup = { name: 'Free Mode', refCount: form.refereeCount, rawPlayers: 'Player 1', players: ['Player 1'], referees: [] }; groups.value = [freeGroup] }
        } else { if (isResuming.value && form.mode === 'FREE') { groups.value[0].refCount = form.refereeCount } }
        if (form.mode === 'TOURNAMENT') { currentStep.value = 2 } else { await store.updateGroups(groups.value); selectedGroupToRun.value = groups.value[0]; refreshBindingSlots(); currentStep.value = 3; if (scannedDevices.value.length === 0) { startScan(false) } }
    } catch (error) { console.error("Step 1 Error:", error); alert(t('msg_create_fail') || "Failed to create project.") }
}
const addNewGroup = () => { const newG = { name: `Group ${groups.value.length + 1}`, refCount: 3, rawPlayers: '', players: [], referees: [] }; groups.value.push(newG); currentEditGroup.value = newG }
const deleteCurrentGroup = () => { const idx = groups.value.indexOf(currentEditGroup.value); if (idx > -1) { groups.value.splice(idx, 1); currentEditGroup.value = groups.value[0] || null } }
const handleStep2Next = async () => { groups.value.forEach(g => { g.players = g.rawPlayers.split('\n').map(p => p.trim()).filter(p => p !== '') }); await store.updateGroups(groups.value); if (currentEditGroup.value) selectedGroupToRun.value = currentEditGroup.value; else if (groups.value.length > 0) selectedGroupToRun.value = groups.value[0]; refreshBindingSlots(); currentStep.value = 3; if (scannedDevices.value.length === 0) startScan(false) }

// --- Step 3 Logic ---
const refreshBindingSlots = () => {
  if (!selectedGroupToRun.value) return
  const targetGroup = selectedGroupToRun.value
  const count = targetGroup.refCount
  if (targetGroup.referees && targetGroup.referees.length > 0) {
    bindings.value = JSON.parse(JSON.stringify(targetGroup.referees))
    if (bindings.value.length < count) {
      for (let i = bindings.value.length; i < count; i++) bindings.value.push({ index: i + 1, name: `Referee ${i + 1}`, mode: 'SINGLE', pri_addr: '', sec_addr: '' })
    }
    if (bindings.value.length > count) bindings.value = bindings.value.slice(0, count)
  } else {
    bindings.value = Array.from({ length: count }, (_, i) => ({ index: i + 1, name: `Referee ${i + 1}`, mode: 'SINGLE', pri_addr: '', sec_addr: '' }))
  }
}

const startScan = async (isRefresh = true) => {
  isScanning.value = true
  try {
    const allDevices = await store.scanDevices(isRefresh)
    scannedDevices.value = allDevices
  } catch (e) {
    console.error("Scan error", e)
    const msg = e.message || ''
    if (msg.includes('Bluetooth') || msg.includes('powered off')) {
        alert(t('msg_bt_off') || "Bluetooth off.")
    } else {
        alert("Scan failed: " + msg)
    }
  }
  finally { isScanning.value = false }
}

const getAvailableDevices = (currentIndex, currentType) => {
  const used = new Set()
  bindings.value.forEach((b, idx) => {
    if (b.pri_addr && (idx !== currentIndex || currentType !== 'pri')) used.add(b.pri_addr)
    if (b.mode === 'DUAL' && b.sec_addr && (idx !== currentIndex || currentType !== 'sec')) used.add(b.sec_addr)
  })
  return scannedDevices.value.filter(d => !used.has(d.address))
}

// 【新增】获取设备显示名称（带备注）
const getDeviceDisplayName = (device) => {
  if (device.remark) {
    return `${device.remark} (${device.name})`
  }
  return `${device.name} (${device.address})`
}

// 【新增】打开备注管理弹窗
const openAliasModal = () => {
  scannedDevices.value.forEach(d => {
    tempRemarks[d.address] = d.remark || (store.appSettings.device_remarks ? store.appSettings.device_remarks[d.address] : '') || ''
  })
  showAliasModal.value = true
}

// 【新增】保存备注
const saveAliases = async () => {
  for (const mac in tempRemarks) {
    const val = tempRemarks[mac]
    await store.saveDeviceRemark(mac, val)

    // 手动更新当前扫描列表中的显示
    const dev = scannedDevices.value.find(d => d.address === mac)
    if (dev) {
      dev.remark = val
    }
  }
  showAliasModal.value = false
}

const onModeChange = (binding) => { if (binding.mode === 'SINGLE') binding.sec_addr = '' }
const goBackFromStep3 = () => { if (form.mode === 'TOURNAMENT') currentStep.value = 2; else currentStep.value = 1 }
const finishSetup = async () => {
  if (selectedGroupToRun.value) { selectedGroupToRun.value.referees = JSON.parse(JSON.stringify(bindings.value)); await store.updateGroups(groups.value) }
  const groupName = selectedGroupToRun.value.name; await store.setMatchContext(groupName, ""); await store.startMatch({ referees: bindings.value }); isConnecting.value = true; showForceEntry.value = false;
  const timeout = setTimeout(() => { showForceEntry.value = true }, 8000);
  connectTimer = setInterval(async () => { if (checkAllConnected()) { clearTimeout(timeout); clearInterval(connectTimer); await store.resetAll(); isConnecting.value = false; emit('finished') } else if (checkAnyError()) showForceEntry.value = true }, 500)
}

const getRefStatus = (index, role) => { const r = store.referees[index]; if (!r || !r.status) return 'waiting'; return r.status[role] }
const checkAllConnected = () => { for (const b of bindings.value) { const status = store.referees[b.index]?.status; if (!status) return false; if (b.pri_addr && status.pri !== 'connected') return false; if (b.mode === 'DUAL' && b.sec_addr && status.sec !== 'connected') return false } return true }
const checkAnyError = () => { for (const b of bindings.value) { const status = store.referees[b.index]?.status; if (status && (status.pri === 'error' || status.sec === 'error')) return true } return false }
const cancelConnect = () => { clearInterval(connectTimer); isConnecting.value = false; store.stopMatch() }
const confirmForceEnter = async () => { clearInterval(connectTimer); await store.resetAll(); isConnecting.value = false; emit('finished') }
</script>

<style scoped lang="scss">
/* 基本样式 */
.setup-wizard { padding: 30px; color: white; max-width: 900px; margin: 0 auto; }
.steps-header { display: flex; align-items: center; margin-bottom: 30px; .step { font-size: 1.1rem; color: #666; font-weight: bold; &.active { color: #3498db; } } .divider { flex: 1; height: 1px; background: #333; margin: 0 15px; } }
.step-content { animation: fadeIn 0.3s; h2 { margin-bottom: 20px; color: #eee; } }
.form-group { margin-bottom: 20px; label { display: block; margin-bottom: 8px; color: #ccc; } input, textarea, select { width: 100%; padding: 10px; background: #252526; border: 1px solid #3d3d3d; color: white; border-radius: 4px; outline: none; &:focus { border-color: #3498db; } } .hint { color: #888; font-size: 0.8rem; margin-top: 4px; display: block; } }
.radio-group { display: flex; gap: 20px; label { cursor: pointer; padding: 10px 20px; background: #252526; border: 1px solid #3d3d3d; border-radius: 4px; transition: all 0.2s; &.checked { background: #3498db; border-color: #3498db; } input { display: none; } } }
.group-manager { .manager-layout { display: flex; gap: 20px; height: 400px; } .sidebar { width: 200px; background: #252526; border: 1px solid #3d3d3d; display: flex; flex-direction: column; .list-header { padding: 10px; background: #333; font-weight: bold; text-align: center; } .group-list { flex: 1; overflow-y: auto; } .group-item { padding: 10px; cursor: pointer; border-bottom: 1px solid #333; &:hover { background: #2f2f2f; } &.active { background: #3498db; color: white; } } .btn-add-group { padding: 10px; background: #2ecc71; border: none; color: white; cursor: pointer; font-weight: bold; &:hover { background: #27ae60; } } } .main-edit { flex: 1; background: #252526; padding: 20px; border: 1px solid #3d3d3d; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; } }
.edit-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #3d3d3d; }
.label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; label { margin-bottom: 0; } }
.btn-import-mini { background: #252526; border: 1px solid #3498db; color: #3498db; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer; display: flex; align-items: center; transition: all 0.2s; &:hover { background: #3498db; color: white; } }
.scan-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; .target-group-select { display: flex; align-items: center; gap: 10px; select { width: 200px; padding: 5px; } } }
.scan-controls { display: flex; align-items: center; gap: 10px; .status { margin-right: 10px; color: #aaa; font-size: 0.9rem; &.scanning { color: #f39c12; animation: blink 1s infinite; } } }
.device-list-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; margin-bottom: 20px; max-height: 400px; overflow-y: auto; }
.ref-card { background: #252526; border: 1px solid #3d3d3d; border-radius: 6px; .card-header { background: #333; padding: 8px 12px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; .ref-name-input { background: #333; border: 1px solid #555; color: white; padding: 4px 8px; border-radius: 4px; margin-left: 8px; width: 140px; font-size: 0.9rem; &:focus { border-color: #3498db; outline: none; } } } .card-body { padding: 10px; } .row { margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; label { width: 70px; font-size: 0.85rem; color: #888; margin: 0; } select { width: 180px; padding: 4px; font-size: 0.9rem; } } }
.actions { display: flex; justify-content: flex-end; gap: 15px; margin-top: 20px; padding-top: 15px; border-top: 1px solid #333; button { padding: 8px 20px; border-radius: 4px; border: none; cursor: pointer; font-weight: bold; &.btn-primary { background: #3498db; color: white; &:hover { background: #2980b9; } } &.btn-secondary { background: #555; color: white; &:hover { background: #666; } } &.btn-success { background: #2ecc71; color: white; &:hover { background: #27ae60; } } &.btn-scan { background: #f39c12; color: white; &:hover { background: #d35400; } } &:disabled { opacity: 0.5; cursor: not-allowed; } } }
.overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); display: flex; justify-content: center; align-items: center; z-index: 1000; }
.connect-dialog { background: #252526; padding: 20px; width: 350px; border-radius: 8px; text-align: center; }
.status-row { display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 4px; .tag { font-size: 0.8rem; padding: 2px 6px; border-radius: 3px; margin-left: 5px; &.connected { background: #27ae60; } &.connecting { background: #f39c12; } &.error { background: #c0392b; } &.waiting { background: #555; } } }
.dialog-actions { margin-top: 15px; button { margin: 0 5px; } }
.import-dialog { background: #252526; padding: 20px; width: 500px; border-radius: 8px; display: flex; flex-direction: column; max-height: 80vh; h3 { margin-top: 0; margin-bottom: 10px; color: white; } .sub-text { color: #aaa; font-size: 0.9rem; margin-bottom: 15px; } .column-list { flex: 1; overflow-y: auto; border: 1px solid #3d3d3d; border-radius: 4px; margin-bottom: 20px; } .column-item { display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #333; cursor: pointer; transition: background 0.2s; &:last-child { border-bottom: none; } &:hover { background: #2f2f2f; } &.active { background: rgba(52, 152, 219, 0.2); border-left: 3px solid #3498db; } .col-header { width: 80px; font-weight: bold; color: #ddd; } .col-preview { flex: 1; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0 10px; } .col-count { font-size: 0.8rem; color: #666; } } }

/* 【新增】Alias 按钮与弹窗样式 */
.btn-alias {
  background: #252526;
  border: 1px solid #555;
  color: #ccc;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  &:hover { background: #333; color: white; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.alias-dialog {
  width: 550px;
  .alias-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px;
    border-bottom: 1px solid #333;
    &:last-child { border-bottom: none; }

    .dev-info {
      flex: 1;
      .dev-name { font-weight: bold; color: #eee; }
      .dev-addr { font-size: 0.8rem; color: #888; }
    }

    .alias-input {
      width: 180px;
      padding: 6px;
      background: #111;
      border: 1px solid #444;
      color: white;
      border-radius: 4px;
      margin-left: 10px;
      font-size: 0.9rem;
      &:focus { border-color: #3498db; }
    }
  }
  .no-data {
    text-align: center;
    padding: 20px;
    color: #888;
  }
}

@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes blink { 50% { opacity: 0.5; } }
</style>
