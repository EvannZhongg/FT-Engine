<template>
  <div class="setup-wizard">
    <input
      type="file"
      ref="fileInput"
      style="display: none"
      accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
      @change="handleFileImport"
    />

    <p v-if="setupNotice" class="setup-notice" role="status">{{ setupNotice }}</p>

    <div class="steps-header">
      <div :class="['step', { active: currentStep >= 1 }]">{{ $t('wiz_step_proj') }}</div>
      <div class="divider"></div>
      <div :class="['step', { active: currentStep >= 2 }]">
        {{ $t('wiz_step_stage') }}
      </div>
      <div class="divider"></div>
      <div :class="['step', { active: currentStep === 3 }]">
        {{ '3. ' + $t('wiz_step_dev') }}
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
            <input type="radio" v-model="form.mode" value="FREE" :disabled="isResuming && !canEditStageStructure" /> {{ $t('wiz_mode_free') }}
          </label>
          <label :class="{ checked: form.mode === 'TOURNAMENT' }">
            <input type="radio" v-model="form.mode" value="TOURNAMENT" :disabled="isResuming && !canEditStageStructure" /> {{ $t('wiz_mode_tourn') }}
          </label>
        </div>
      </div>

      <p v-if="setupError" class="setup-error" role="alert">{{ setupError }}</p>
      <div class="actions">
        <button class="btn-secondary" @click="$emit('cancel')">{{ $t('btn_cancel') }}</button>
        <button class="btn-primary" @click="handleStep1Next">{{ $t('btn_next') }}</button>
      </div>
    </div>

    <div v-if="currentStep === 2" class="step-content stage-manager">
      <div class="section-heading">
        <h2>{{ $t('wiz_s2_title') }}</h2>
        <button v-if="currentEditStage?.status === 'active'" class="btn-complete-stage" type="button" @click="completeCurrentStage">
          <Check :size="15" /> {{ $t('btn_complete_stage') }}
        </button>
      </div>

      <div class="manager-layout">
        <aside class="stage-sidebar">
          <div class="list-header">{{ $t('wiz_stage_list_title') }}</div>
          <div class="entity-list">
            <button v-for="stage in stageDrafts" :key="stage.id" type="button" class="stage-item" :class="{ active: currentEditStage?.id === stage.id }" @click="selectStageForEditing(stage)">
              <span>{{ stage.name }}</span>
              <small>{{ $t(`stage_status_${stage.status}`) }}</small>
            </button>
          </div>
          <div class="stage-list-actions">
            <button type="button" :title="$t('btn_add_stage')" :disabled="!canEditStageStructure" @click="addNewStage"><Plus :size="16" /></button>
            <button type="button" :title="$t('btn_move_stage_up')" :disabled="!canEditStageStructure || currentStageIndex <= 0" @click="moveCurrentStage(-1)"><ChevronUp :size="16" /></button>
            <button type="button" :title="$t('btn_move_stage_down')" :disabled="!canEditStageStructure || currentStageIndex < 0 || currentStageIndex >= stageDrafts.length - 1" @click="moveCurrentStage(1)"><ChevronDown :size="16" /></button>
            <button type="button" class="danger-icon" :title="$t('btn_del_stage')" :disabled="!canEditStageStructure || stageDrafts.length <= 1 || currentEditStage?.status !== 'draft'" @click="deleteCurrentStage"><Trash2 :size="16" /></button>
          </div>
        </aside>

        <aside v-if="currentEditStage" class="group-sidebar">
          <div class="list-header">{{ $t('wiz_list_title') }}</div>
          <div class="entity-list">
            <button v-for="group in currentEditStage.groups" :key="group.name" type="button" class="group-item" :class="{ active: currentEditGroup === group }" @click="currentEditGroup = group">
              {{ group.name }}
            </button>
          </div>
          <button class="btn-add-group" type="button" :disabled="!canEditCurrentStage" @click="addNewGroup"><Plus :size="15" /> {{ $t('btn_add_group') }}</button>
        </aside>

        <div v-if="currentEditStage && currentEditGroup" class="main-edit">
          <div class="stage-fields">
            <div class="form-group">
              <label>{{ $t('wiz_lbl_stage_name') }}</label>
              <input v-model="currentEditStage.name" type="text" :disabled="!canEditCurrentStage" />
            </div>
            <div class="form-group attempts-field">
              <label>{{ $t('wiz_lbl_attempts') }}</label>
              <input v-model.number="currentEditStage.attempts" type="number" min="1" max="20" :disabled="!canEditCurrentStage" />
            </div>
          </div>
          <div class="edit-header">
            <span class="edit-title">{{ $t('wiz_config_title') }}</span>
            <button v-if="currentEditStage.groups.length > 1" class="btn-delete-group" type="button" :disabled="!canEditCurrentStage" @click="deleteCurrentGroup"><Trash2 :size="16" /> {{ $t('btn_del_group') }}</button>
          </div>
          <div class="form-group"><label>{{ $t('wiz_lbl_grp_name') }}</label><input v-model="currentEditGroup.name" type="text" :disabled="!canEditCurrentStage" /></div>
          <div class="form-group"><label>{{ $t('wiz_lbl_grp_ref') }}</label><input v-model.number="currentEditGroup.refCount" type="number" min="1" max="10" :disabled="!canEditCurrentStage" /></div>
          <div class="form-group">
            <div class="label-row">
              <label>{{ $t('wiz_lbl_player') }}</label>
              <button class="btn-import-mini" type="button" :disabled="!canEditCurrentStage" @click="triggerFileImport" :title="$t('title_import_csv')"><Upload :size="14" /> {{ $t('btn_import_list') }}</button>
            </div>
            <textarea v-model="currentEditGroup.rawPlayers" rows="6" :disabled="!canEditCurrentStage" :placeholder="$t('wiz_ph_player')"></textarea>
          </div>
        </div>
      </div>
      <p v-if="setupError" class="setup-error" role="alert">{{ setupError }}</p>
      <div class="actions">
        <button class="btn-secondary" @click="currentStep = 1">{{ $t('btn_back') }}</button>
        <button class="btn-primary" :disabled="isSavingStages" @click="handleStep2Next">{{ isSavingStages ? $t('status_saving') : $t('btn_save_next') }}</button>
      </div>
    </div>

    <div v-if="currentStep === 3" class="step-content">
      <div class="scan-bar">
        <h2>{{ $t('wiz_step_prefix') }} 3: {{ $t('wiz_s3_title') }}</h2>
        <div class="run-context-selectors">
          <label><span>{{ $t('wiz_target_stage') }}</span><select v-model="selectedStageIdToRun" @change="handleRunStageChange"><option v-for="stage in runnableStages" :key="stage.id" :value="stage.id">{{ stage.name }}</option></select></label>
          <label><span>{{ $t('wiz_target_group') }}</span><select v-model="selectedGroupNameToRun" @change="refreshBindingSlots"><option v-for="group in selectedStageToRun?.groups || []" :key="group.name" :value="group.name">{{ group.name }} ({{ group.refCount }} {{ $t('wiz_suffix_refs') }})</option></select></label>
          <label><span>{{ $t('wiz_target_attempt') }}</span><select v-model.number="selectedAttemptToRun"><option v-for="attempt in attemptOptions" :key="attempt" :value="attempt">{{ $t('attempt_label', { number: attempt }) }}</option></select></label>
        </div>
        <div class="scan-controls">
          <span v-if="isScanning" class="status scanning">{{ $t('status_scanning') }}</span>
          <span v-else class="status">{{ $t('status_found', { count: scannedDevices.length }) }}</span>

          <button
            v-if="workerRetryAvailable"
            class="btn-worker-retry"
            type="button"
            :disabled="isScanning || isRetryingWorker"
            @click="retryPlatformWorker"
          >
            <RotateCcw :size="15" :class="{ spinning: isRetryingWorker }" />
            <span>{{ $t(isRetryingWorker ? 'status_retrying_worker' : 'btn_retry_worker') }}</span>
          </button>

          <button class="btn-alias" @click="openAliasModal" :disabled="isScanning || isRetryingWorker" :title="$t('title_device_remarks')">
            <Tag :size="16" />
          </button>

          <button class="btn-scan" @click="startScan(true)" :disabled="isScanning || isRetryingWorker">{{ $t('btn_scan') }}</button>
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
              <select v-model="bind.primaryDeviceId">
                <option value="">{{ $t('opt_select_default') }}</option>
                <option v-for="d in getAvailableDevices(index, 'pri')" :key="d.address" :value="d.address">
                  {{ getDeviceDisplayName(d) }}
                </option>
              </select>
            </div>
            <div class="row" v-if="bind.mode === 'DUAL'">
              <label>{{ $t('lbl_sec') }}</label>
              <select v-model="bind.secondaryDeviceId">
                <option value="">{{ $t('opt_select_default') }}</option>
                <option v-for="d in getAvailableDevices(index, 'sec')" :key="d.address" :value="d.address">
                  {{ getDeviceDisplayName(d) }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <p v-if="setupError" class="setup-error" role="alert">{{ setupError }}</p>
      <div class="actions">
        <button class="btn-secondary" @click="currentStep = 2">{{ $t('btn_back') }}</button>
        <button class="btn-success" :disabled="!canStartMatch" @click="finishSetup">{{ $t('btn_start') }}</button>
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

    <div v-if="showRenameModal" class="overlay">
      <div class="import-dialog alias-dialog rename-dialog">
        <h3>{{ $t('title_device_rename_confirm') }}</h3>
        <p class="sub-text">{{ $t('msg_device_rename_confirm') }}</p>

        <div class="column-list custom-scroll">
          <div v-for="item in renameCandidates" :key="item.address" class="rename-item">
            <label class="rename-check">
              <input
                type="checkbox"
                :checked="!!selectedRenameDevices[item.address]"
                :disabled="isApplyingRename"
                @change="selectedRenameDevices[item.address] = $event.target.checked"
              />
              <span class="checkbox-mark"></span>
            </label>
            <div class="dev-info">
              <div class="dev-name">{{ item.currentName }}</div>
              <div class="dev-addr">{{ item.address }}</div>
            </div>
            <div class="rename-target">
              <div class="target-label">{{ $t('lbl_rename_to') }}</div>
              <div class="target-name">{{ item.targetName }}</div>
            </div>
          </div>
        </div>

        <div class="dialog-actions">
          <button class="btn-secondary" @click="dismissRenameModal" :disabled="isApplyingRename">{{ $t('btn_skip') }}</button>
          <button
            class="btn-primary"
            @click="confirmPermanentRename"
            :disabled="isApplyingRename || selectedRenameCount === 0"
          >
            {{ isApplyingRename ? $t('status_scanning') : $t('btn_apply_rename') }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useCompetitionStore } from '../stores/competitionStore'
import { useDeviceStore } from '../stores/deviceStore'
import { useMatchStore } from '../stores/matchStore'
import { useSettingsStore } from '../stores/settingsStore'
import { Check, ChevronDown, ChevronUp, Plus, RotateCcw, Tag, Trash2, Upload } from 'lucide-vue-next'
import { read, utils } from 'xlsx'
import { useI18n } from 'vue-i18n'
import { clampAttempt, createGroupDraft, toStageDraft, toStageInput } from '../features/competitions/stageDrafts.mjs'

const { t } = useI18n()
const emit = defineEmits(['cancel', 'finished'])
const store = useCompetitionStore()
const deviceStore = useDeviceStore()
const matchStore = useMatchStore()
const settingsStore = useSettingsStore()
const currentStep = ref(1)
const isScanning = ref(false)
const isRetryingWorker = ref(false)
const workerRetryAvailable = ref(false)
const scannedDevices = ref([])
const form = reactive({ projectName: 'New Match', mode: 'FREE' })
const stageDrafts = ref([])
const currentEditStage = ref(null)
const currentEditGroup = ref(null)
const selectedStageIdToRun = ref('')
const selectedGroupNameToRun = ref('')
const selectedAttemptToRun = ref(1)
const bindings = ref([])
const isConnecting = ref(false)
const showForceEntry = ref(false)
const isSavingStages = ref(false)
const setupError = ref('')
const setupNotice = ref('')
let connectTimer = null
const isResuming = computed(() => !!store.projectConfig.createdAt)
const currentStageIndex = computed(() => stageDrafts.value.findIndex(stage => stage.id === currentEditStage.value?.id))
const canEditStageStructure = computed(() => stageDrafts.value.length > 0 && stageDrafts.value.every(stage => stage.status === 'draft'))
const canEditCurrentStage = computed(() => canEditStageStructure.value && currentEditStage.value?.status === 'draft')
const runnableStages = computed(() => stageDrafts.value.filter(stage => stage.status !== 'completed'))
const selectedStageToRun = computed(() => stageDrafts.value.find(stage => stage.id === selectedStageIdToRun.value))
const selectedGroupToRun = computed(() => selectedStageToRun.value?.groups.find(group => group.name === selectedGroupNameToRun.value))
const attemptOptions = computed(() => Array.from({ length: selectedStageToRun.value?.attempts || 1 }, (_, index) => index + 1))
const canStartMatch = computed(() => Boolean(selectedStageToRun.value && selectedGroupToRun.value?.players?.length) && !isConnecting.value)

// --- 导入功能相关状态 ---
const fileInput = ref(null)
const showImportModal = ref(false)
const importCandidates = ref([])
const selectedColumnIdx = ref(0)

// --- 【新增】设备备注相关状态 ---
const showAliasModal = ref(false)
const tempRemarks = reactive({}) // 暂存编辑中的备注 { "MAC": "Remark" }
const showRenameModal = ref(false)
const renameCandidates = ref([])
const selectedRenameDevices = reactive({})
const isApplyingRename = ref(false)
const selectedRenameCount = computed(() => renameCandidates.value.filter(item => selectedRenameDevices[item.address]).length)

onMounted(async () => {
  if (isResuming.value) {
    form.projectName = store.projectConfig.name
    form.mode = store.projectConfig.mode
    await loadStageDrafts()
    currentStep.value = 1
  }
  // 确保配置已加载，以便读取 device_remarks
  await settingsStore.fetchSettings()
})

const loadStageDrafts = async (preferredStageId = '') => {
  const stages = await store.fetchStages()
  stageDrafts.value = stages.map(stage => toStageDraft(stage, form.mode))
  const selected = stageDrafts.value.find(stage => stage.id === preferredStageId) || stageDrafts.value[0] || null
  selectStageForEditing(selected)
}

const selectStageForEditing = (stage) => {
  currentEditStage.value = stage || null
  currentEditGroup.value = stage?.groups?.[0] || null
}

// --- 导入功能逻辑 ---
const triggerFileImport = () => { fileInput.value.click() }
const handleFileImport = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
        const data = await file.arrayBuffer(); const workbook = read(data); const firstSheetName = workbook.SheetNames[0]; const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = utils.sheet_to_json(worksheet, { header: 1 });
        if (!jsonData || jsonData.length === 0) { setupError.value = t('msg_file_empty'); return; }
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
        if (candidates.length === 0) { setupError.value = t('msg_no_valid_data'); return; }
        importCandidates.value = candidates; selectedColumnIdx.value = 0; showImportModal.value = true;
    } catch (err) { console.error(err); setupError.value = t('msg_read_fail'); } finally { e.target.value = ''; }
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
  setupError.value = ''
  try {
    if (!isResuming.value) await store.createProject(form.projectName, form.mode)
    if (stageDrafts.value.length === 0) await loadStageDrafts()
    currentStep.value = 2
  } catch (error) {
    console.error('Step 1 Error:', error)
    setupError.value = t('msg_create_fail')
  }
}

const addNewStage = async () => {
  if (!canEditStageStructure.value) return
  setupError.value = ''
  try {
    const names = new Set(stageDrafts.value.map(stage => stage.name))
    let number = stageDrafts.value.length + 1
    while (names.has(`Stage ${number}`)) number += 1
    const created = await store.createStage({ name: `Stage ${number}`, attempts: 1, groups: [] })
    const draft = toStageDraft(created, form.mode)
    stageDrafts.value.push(draft)
    selectStageForEditing(draft)
  } catch (error) {
    console.error('Create Stage failed:', error)
    setupError.value = t('msg_stage_save_fail')
  }
}

const deleteCurrentStage = async () => {
  if (!currentEditStage.value || stageDrafts.value.length <= 1 || !canEditStageStructure.value) return
  setupError.value = ''
  try {
    const deletedId = currentEditStage.value.id
    await store.deleteStage(deletedId)
    stageDrafts.value = stageDrafts.value.filter(stage => stage.id !== deletedId)
    selectStageForEditing(stageDrafts.value[0] || null)
  } catch (error) {
    console.error('Delete Stage failed:', error)
    setupError.value = t('msg_stage_delete_fail')
  }
}

const moveCurrentStage = (delta) => {
  if (!canEditStageStructure.value) return
  const from = currentStageIndex.value
  const to = from + delta
  if (from < 0 || to < 0 || to >= stageDrafts.value.length) return
  const next = [...stageDrafts.value]
  const [stage] = next.splice(from, 1)
  next.splice(to, 0, stage)
  stageDrafts.value = next
}

const addNewGroup = () => {
  if (!currentEditStage.value || !canEditCurrentStage.value) return
  const group = createGroupDraft(currentEditStage.value.groups.length, form.mode)
  currentEditStage.value.groups.push(group)
  currentEditGroup.value = group
}

const deleteCurrentGroup = () => {
  if (!currentEditStage.value || !currentEditGroup.value || !canEditCurrentStage.value) return
  const groups = currentEditStage.value.groups
  const index = groups.indexOf(currentEditGroup.value)
  if (index >= 0 && groups.length > 1) {
    groups.splice(index, 1)
    currentEditGroup.value = groups[0]
  }
}

const saveStageDrafts = async () => {
  const inputs = new Map(stageDrafts.value.map(stage => [stage.id, toStageInput(stage)]))
  const storedFirstStageId = store.stages[0]?.id
  if (canEditStageStructure.value) {
    for (const stage of stageDrafts.value) await store.updateStage(stage.id, inputs.get(stage.id))
  }
  await store.updateProjectDetails(form.projectName, form.mode, inputs.get(storedFirstStageId)?.groups)
  if (canEditStageStructure.value) await store.reorderStages(stageDrafts.value.map(stage => stage.id))
}

const handleStep2Next = async () => {
  if (isSavingStages.value) return
  setupError.value = ''
  isSavingStages.value = true
  try {
    await saveStageDrafts()
    await loadStageDrafts(currentEditStage.value?.id)
    const target = stageDrafts.value.find(stage => stage.status === 'active') || runnableStages.value[0]
    selectedStageIdToRun.value = target?.id || ''
    handleRunStageChange()
    currentStep.value = 3
    if (scannedDevices.value.length === 0) void startScan(false)
  } catch (error) {
    console.error('Save Stage configuration failed:', error)
    setupError.value = t('msg_stage_save_fail')
  } finally {
    isSavingStages.value = false
  }
}

const completeCurrentStage = async () => {
  if (!currentEditStage.value) return
  setupError.value = ''
  try {
    const stageId = currentEditStage.value.id
    await store.completeStage(stageId)
    await loadStageDrafts(stageId)
  } catch (error) {
    console.error('Complete Stage failed:', error)
    setupError.value = t('msg_stage_complete_fail')
  }
}

// --- Step 3 Logic ---
const handleRunStageChange = () => {
  const stage = selectedStageToRun.value
  selectedGroupNameToRun.value = stage?.groups?.[0]?.name || ''
  selectedAttemptToRun.value = clampAttempt(selectedAttemptToRun.value, stage?.attempts)
  refreshBindingSlots()
}

const refreshBindingSlots = () => {
  if (!selectedGroupToRun.value) return
  const targetGroup = selectedGroupToRun.value
  const count = targetGroup.refCount
  if (targetGroup.referees && targetGroup.referees.length > 0) {
    bindings.value = JSON.parse(JSON.stringify(targetGroup.referees))
    if (bindings.value.length < count) {
      for (let i = bindings.value.length; i < count; i++) bindings.value.push({ index: i + 1, name: `Referee ${i + 1}`, mode: 'SINGLE', primaryDeviceId: '', secondaryDeviceId: '' })
    }
    if (bindings.value.length > count) bindings.value = bindings.value.slice(0, count)
  } else {
    bindings.value = Array.from({ length: count }, (_, i) => ({ index: i + 1, name: `Referee ${i + 1}`, mode: 'SINGLE', primaryDeviceId: '', secondaryDeviceId: '' }))
  }
}

const startScan = async (isRefresh = true) => {
  if (isScanning.value) return false
  isScanning.value = true
  setupError.value = ''
  try {
    const allDevices = await deviceStore.scanDevices(isRefresh)
    scannedDevices.value = allDevices
    workerRetryAvailable.value = false
    return true
  } catch (e) {
    console.error("Scan error", e)
    const msg = e instanceof Error ? e.message : String(e)
    workerRetryAvailable.value = msg.includes('WORKER_')
    if (msg.includes('Bluetooth') || msg.includes('powered off')) {
      setupError.value = t('msg_bt_off')
    } else if (workerRetryAvailable.value) {
      setupError.value = t('msg_worker_unavailable')
    } else {
      setupError.value = t('msg_scan_failed', { message: msg })
    }
    return false
  }
  finally { isScanning.value = false }
}

const retryPlatformWorker = async () => {
  if (isRetryingWorker.value) return
  isRetryingWorker.value = true
  setupError.value = ''
  try {
    await deviceStore.retryPlatformWorker()
    workerRetryAvailable.value = false
    await startScan(true)
  } catch (error) {
    console.error('Platform Worker retry failed:', error)
    workerRetryAvailable.value = true
    setupError.value = t('msg_worker_retry_failed')
  } finally {
    isRetryingWorker.value = false
  }
}

const getAvailableDevices = (currentIndex, currentType) => {
  const used = new Set()
  bindings.value.forEach((b, idx) => {
    if (b.primaryDeviceId && (idx !== currentIndex || currentType !== 'pri')) used.add(b.primaryDeviceId)
    if (b.mode === 'DUAL' && b.secondaryDeviceId && (idx !== currentIndex || currentType !== 'sec')) used.add(b.secondaryDeviceId)
  })
  return scannedDevices.value.filter(d => !used.has(d.address))
}

// 【新增】获取设备显示名称（带备注）
const getDeviceDisplayName = (device) => {
  const transport = device.transport ? `[${device.transport}] ` : ''
  const suffix = device.transport === 'USB' && device.path ? device.path : device.address
  if (device.remark) {
    return `${transport}${device.remark} (${device.name})`
  }
  return `${transport}${device.name} (${suffix})`
}

// 【新增】打开备注管理弹窗
const openAliasModal = () => {
  scannedDevices.value.forEach(d => {
    tempRemarks[d.address] = d.remark || settingsStore.appSettings.device_remarks?.[d.address] || ''
  })
  showAliasModal.value = true
}

const openRenameModal = (candidates) => {
  renameCandidates.value = candidates
  Object.keys(selectedRenameDevices).forEach(key => delete selectedRenameDevices[key])
  candidates.forEach(item => {
    selectedRenameDevices[item.address] = true
  })
  showRenameModal.value = true
}

const resetRenameModal = () => {
  showRenameModal.value = false
  renameCandidates.value = []
  Object.keys(selectedRenameDevices).forEach(key => delete selectedRenameDevices[key])
}

const dismissRenameModal = () => {
  if (isApplyingRename.value) return
  resetRenameModal()
}

// 【新增】保存备注
const saveAliases = async () => {
  const changedRenameCandidates = scannedDevices.value
    .map(dev => {
      const nextRemark = (tempRemarks[dev.address] || '').trim()
      const prevRemark = (settingsStore.appSettings.device_remarks?.[dev.address] || '').trim()
      if (!nextRemark || nextRemark === prevRemark) return null
      return {
        address: dev.address,
        currentName: dev.name,
        targetName: nextRemark
      }
    })
    .filter(Boolean)

  for (const dev of scannedDevices.value) {
    const val = (tempRemarks[dev.address] || '').trim()
    await settingsStore.saveDeviceRemark(dev.address, val)

    // 手动更新当前扫描列表中的显示
    dev.remark = val
  }
  showAliasModal.value = false

  if (changedRenameCandidates.length > 0) {
    openRenameModal(changedRenameCandidates)
  }
}

const confirmPermanentRename = async () => {
  const targets = renameCandidates.value.filter(item => selectedRenameDevices[item.address])
  if (targets.length === 0) {
    dismissRenameModal()
    return
  }

  isApplyingRename.value = true
  try {
    const results = await deviceStore.renameDevices(targets.map(item => ({
      address: item.address,
      name: item.targetName
    })))
    const failed = results.filter(item => item.status !== 'ok')

    resetRenameModal()
    try {
      await startScan(true)
    } catch (scanError) {
      console.error("Scan refresh after rename failed", scanError)
    }

    if (failed.length === 0) {
      setupNotice.value = t('msg_device_rename_success', { count: results.length })
    } else {
      setupNotice.value = t('msg_device_rename_partial', {
        success: results.length - failed.length,
        failed: failed.length
      })
    }
  } catch (e) {
    console.error("Permanent rename failed", e)
    resetRenameModal()
    setupError.value = t('msg_device_rename_fail')
  } finally {
    isApplyingRename.value = false
  }
}

const onModeChange = (binding) => { if (binding.mode === 'SINGLE') binding.secondaryDeviceId = '' }
const finishSetup = async () => {
  if (!selectedStageToRun.value || !selectedGroupToRun.value || isConnecting.value) return
  setupError.value = ''
  try {
    selectedGroupToRun.value.referees = JSON.parse(JSON.stringify(bindings.value))
    if (canEditStageStructure.value) {
      const updated = await store.updateStage(selectedStageToRun.value.id, toStageInput(selectedStageToRun.value))
      const index = stageDrafts.value.findIndex(stage => stage.id === updated.id)
      if (index >= 0) stageDrafts.value.splice(index, 1, toStageDraft(updated, form.mode))
    }
    store.selectStage(selectedStageToRun.value.id, selectedAttemptToRun.value)
    const groupName = selectedGroupToRun.value.name
    const contestantName = selectedGroupToRun.value.players?.[0] || ''
    await matchStore.setMatchContext(groupName, contestantName)
    isConnecting.value = true
    showForceEntry.value = false
    await matchStore.startMatch({ referees: bindings.value })
    const timeout = setTimeout(() => { showForceEntry.value = true }, 8000)
    connectTimer = setInterval(async () => {
      if (checkAllConnected()) {
        clearTimeout(timeout)
        clearInterval(connectTimer)
        await matchStore.resetAll()
        isConnecting.value = false
        emit('finished')
      } else if (checkAnyError()) showForceEntry.value = true
    }, 500)
  } catch (error) {
    isConnecting.value = false
    console.error('Start match failed:', error)
    setupError.value = t('msg_match_start_fail')
  }
}

const getRefStatus = (index, role) => { const r = matchStore.referees[index]; if (!r || !r.status) return 'waiting'; return r.status[role] }
const checkAllConnected = () => { for (const b of bindings.value) { const status = matchStore.referees[b.index]?.status; if (!status) return false; if (b.primaryDeviceId && status.pri !== 'connected') return false; if (b.mode === 'DUAL' && b.secondaryDeviceId && status.sec !== 'connected') return false } return true }
const checkAnyError = () => { for (const b of bindings.value) { const status = matchStore.referees[b.index]?.status; if (status && (status.pri === 'error' || status.sec === 'error')) return true } return false }
const cancelConnect = () => { clearInterval(connectTimer); isConnecting.value = false; matchStore.stopMatch() }
const confirmForceEnter = async () => { clearInterval(connectTimer); await matchStore.resetAll(); isConnecting.value = false; emit('finished') }
</script>

<style scoped lang="scss">
/* 基本样式 */
.setup-wizard { height: 100%; box-sizing: border-box; padding: 30px; color: white; background: #1e1e1e; max-width: 1120px; margin: 0 auto; overflow-y: auto; }
.steps-header { display: flex; align-items: center; margin-bottom: 30px; .step { font-size: 1.1rem; color: #666; font-weight: bold; &.active { color: #3498db; } } .divider { flex: 1; height: 1px; background: #333; margin: 0 15px; } }
.step-content { animation: fadeIn 0.3s; h2 { margin-bottom: 20px; color: #eee; } }
.form-group { min-width: 0; margin-bottom: 20px; label { display: block; margin-bottom: 8px; color: #ccc; } input, textarea, select { width: 100%; box-sizing: border-box; padding: 10px; background: #252526; border: 1px solid #3d3d3d; color: white; border-radius: 4px; outline: none; &:focus { border-color: #3498db; } &:disabled { color: #888; background: #202020; } } textarea { resize: vertical; min-height: 100px; } .hint { color: #888; font-size: 0.8rem; margin-top: 4px; display: block; } }
.radio-group { display: flex; gap: 20px; label { cursor: pointer; padding: 10px 20px; background: #252526; border: 1px solid #3d3d3d; border-radius: 4px; transition: all 0.2s; &.checked { background: #3498db; border-color: #3498db; } input { display: none; } } }
.section-heading { min-height: 42px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; h2 { margin-top: 0; } }
.btn-complete-stage { min-height: 34px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border: 1px solid #4d8a70; border-radius: 4px; background: #244737; color: #d8f3e6; cursor: pointer; }
.stage-manager .manager-layout { height: 430px; display: grid; grid-template-columns: 190px 170px minmax(330px, 1fr); gap: 12px; }
.stage-sidebar, .group-sidebar { min-width: 0; border: 1px solid #3d3d3d; background: #252526; display: flex; flex-direction: column; }
.list-header { padding: 10px; background: #333; color: #ddd; font-size: 0.82rem; font-weight: bold; text-align: center; }
.entity-list { min-height: 0; flex: 1; overflow-y: auto; }
.stage-item, .group-item { width: 100%; min-height: 42px; box-sizing: border-box; padding: 8px 10px; border: 0; border-bottom: 1px solid #333; background: transparent; color: #ddd; text-align: left; cursor: pointer; overflow: hidden; }
.stage-item { display: flex; flex-direction: column; justify-content: center; gap: 2px; span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: #858a90; font-size: 0.7rem; } }
.stage-item:hover, .group-item:hover { background: #2f2f2f; }
.stage-item.active, .group-item.active { background: #315c78; color: white; small { color: #d7e7f2; } }
.stage-list-actions { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid #3d3d3d; button { height: 38px; display: flex; align-items: center; justify-content: center; border: 0; border-right: 1px solid #3d3d3d; background: #292929; color: #ccc; cursor: pointer; &:last-child { border-right: 0; } &:hover:not(:disabled) { background: #383838; color: white; } &:disabled { opacity: 0.35; cursor: default; } &.danger-icon { color: #ef9a9a; } } }
.btn-add-group { min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; border: 0; border-top: 1px solid #3d3d3d; background: #2b6249; color: white; cursor: pointer; font-weight: bold; &:hover:not(:disabled) { background: #34785a; } &:disabled { opacity: 0.45; cursor: default; } }
.main-edit { min-width: 0; box-sizing: border-box; background: #252526; padding: 18px; border: 1px solid #3d3d3d; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
.stage-fields { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 12px; }
.attempts-field input { text-align: center; }
.edit-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #3d3d3d; }
.label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; label { margin-bottom: 0; } }
.btn-import-mini { background: #252526; border: 1px solid #3498db; color: #3498db; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s; &:hover:not(:disabled) { background: #3498db; color: white; } &:disabled { opacity: 0.45; cursor: default; } }
.setup-error { margin: 14px 0 0; padding: 9px 11px; border-left: 3px solid #d36b6b; background: #392425; color: #ffc3c3; font-size: 0.86rem; }
.setup-notice { margin: 0 0 14px; padding: 9px 11px; border-left: 3px solid #62a882; background: #21382d; color: #c7f0d8; font-size: 0.82rem; }
.scan-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 14px 20px; margin-bottom: 20px; h2 { width: 100%; margin: 0; } }
.run-context-selectors { min-width: 0; flex: 1; display: grid; grid-template-columns: repeat(3, minmax(130px, 1fr)); gap: 10px; label { min-width: 0; display: flex; flex-direction: column; gap: 5px; color: #aaa; font-size: 0.78rem; } select { width: 100%; min-width: 0; box-sizing: border-box; height: 34px; padding: 0 8px; } }
.scan-controls { display: flex; align-items: center; gap: 10px; .status { margin-right: 10px; color: #aaa; font-size: 0.9rem; &.scanning { color: #f39c12; animation: blink 1s infinite; } } }
.btn-scan, .btn-worker-retry { min-height: 34px; box-sizing: border-box; padding: 0 12px; border: 1px solid transparent; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; }
.btn-scan { background: #b46d13; &:hover:not(:disabled) { background: #d17b11; } }
.btn-worker-retry { min-width: 132px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; background: #7a3439; border-color: #a95158; &:hover:not(:disabled) { background: #914047; } .spinning { animation: worker-spin 0.8s linear infinite; } }
.btn-scan:disabled, .btn-worker-retry:disabled { opacity: 0.5; cursor: wait; }
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

.rename-dialog {
  width: 620px;

  .rename-item {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) 180px;
    gap: 12px;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid #333;

    &:last-child { border-bottom: none; }
  }

  .rename-check {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;

    input {
      position: absolute;
      opacity: 0;
      inset: 0;
      cursor: pointer;
    }

    .checkbox-mark {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1px solid #555;
      background: #111;
      display: inline-block;
      position: relative;
    }

    input:checked + .checkbox-mark {
      background: #3498db;
      border-color: #3498db;
    }

    input:checked + .checkbox-mark::after {
      content: '';
      position: absolute;
      left: 5px;
      top: 1px;
      width: 5px;
      height: 10px;
      border: solid white;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
  }

  .rename-target {
    text-align: right;

    .target-label {
      font-size: 0.75rem;
      color: #888;
      margin-bottom: 4px;
    }

    .target-name {
      color: #7fd0ff;
      font-weight: bold;
      word-break: break-word;
    }
  }
}

@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes blink { 50% { opacity: 0.5; } }
@keyframes worker-spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  .setup-wizard { padding: 22px; }
  .stage-manager .manager-layout { height: auto; min-height: 520px; grid-template-columns: 150px minmax(0, 1fr); }
  .main-edit { grid-column: 1 / -1; min-height: 330px; }
  .run-context-selectors { grid-template-columns: repeat(2, minmax(130px, 1fr)); }
  .scan-controls { width: 100%; flex-wrap: wrap; .status { flex: 1 0 100%; margin-right: 0; } }
}
</style>
