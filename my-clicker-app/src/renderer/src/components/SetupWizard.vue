<template>
  <div class="setup-wizard">
    <div class="steps-header">
      <div :class="['step', { active: currentStep === 1 }]">
        {{ $t('wiz_step1') }}
      </div>
      <div class="divider"></div>
      <div :class="['step', { active: currentStep === 2 }]">
        {{ $t('wiz_step2') }}
      </div>
    </div>

    <div v-if="currentStep === 1" class="step-content">
      <h2>{{ $t('wiz_step1') }}</h2>
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
        <input type="number" v-model.number="form.refereeCount" min="1" max="5" />
      </div>

      <div class="actions">
        <button class="btn-secondary" @click="$emit('cancel')">Cancel</button>
        <button class="btn-primary" @click="goToStep2">{{ $t('btn_next') }} >></button>
      </div>
    </div>

    <div v-else class="step-content">
      <div class="scan-bar">
        <h2>{{ $t('wiz_step2') }}</h2>
        <div class="scan-controls">
          <span v-if="isScanning" class="status scanning">
            <Loader2 class="spin" :size="16"/> {{ $t('status_scanning') }}
          </span>
          <span v-else class="status">
            {{ $t('status_found', { count: scannedDevices.length }) }}
          </span>

          <button class="btn-scan" @click="startScan" :disabled="isScanning">
            <RefreshCw :size="16" /> {{ $t('btn_scan') }}
          </button>
        </div>
      </div>

      <div class="device-list-container">
        <div v-for="i in form.refereeCount" :key="i" class="ref-card">
          <div class="card-header">Referee {{ i }}</div>
          <div class="card-body">
            <div class="row">
              <label>Mode</label>
              <select v-model="bindings[i-1].mode">
                <option value="SINGLE">Single Device (单机)</option>
                <option value="DUAL">Dual Device (双机)</option>
              </select>
            </div>

            <div class="row">
              <label>Primary Device</label>
              <select v-model="bindings[i-1].pri_addr">
                <option value="">-- Select Device --</option>
                <option v-for="d in scannedDevices" :key="d.address" :value="d.address">
                  {{ d.name }} ({{ d.address }})
                </option>
              </select>
            </div>

            <div class="row" v-if="bindings[i-1].mode === 'DUAL'">
              <label>Secondary Device</label>
              <select v-model="bindings[i-1].sec_addr">
                <option value="">-- Select Device --</option>
                <option v-for="d in scannedDevices" :key="d.address" :value="d.address">
                  {{ d.name }} ({{ d.address }})
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="btn-secondary" @click="currentStep = 1">&lt;&lt; Back</button>
        <button class="btn-success" @click="finishSetup">{{ $t('btn_start') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
// 【修正点】移除了未使用的 onMounted
import { ref, reactive } from 'vue'
import { useRefereeStore } from '../stores/refereeStore'
import { Loader2, RefreshCw } from 'lucide-vue-next'

const emit = defineEmits(['cancel', 'finished'])
const store = useRefereeStore()

const currentStep = ref(1)
const isScanning = ref(false)
const scannedDevices = ref([])

// 表单数据
const form = reactive({
  projectName: 'New Match',
  mode: 'FREE',
  refereeCount: 1
})

// 绑定数据
const bindings = ref([])

const goToStep2 = () => {
  if (bindings.value.length !== form.refereeCount) {
    bindings.value = Array.from({ length: form.refereeCount }, (_, index) => ({
      index: index + 1,
      name: `Referee ${index + 1}`,
      mode: 'SINGLE',
      pri_addr: '',
      sec_addr: ''
    }))
  }
  currentStep.value = 2
  // 如果之前没扫过，进入页面自动扫一次
  if (scannedDevices.value.length === 0) {
    startScan()
  }
}

const startScan = async () => {
  isScanning.value = true
  try {
    const allDevices = await store.scanDevices()
    console.log("Frontend received:", allDevices)
    scannedDevices.value = allDevices
  } catch (e) {
    console.error("Scan failed", e)
  } finally {
    isScanning.value = false
  }
}

const finishSetup = async () => {
  const config = {
    referees: bindings.value
  }
  await store.setupReferees(config)
  emit('finished')
}
</script>

<style scoped lang="scss">
.setup-wizard {
  padding: 30px;
  color: white;
  max-width: 800px;
  margin: 0 auto;
}

.steps-header {
  display: flex;
  align-items: center;
  margin-bottom: 30px;

  .step {
    font-size: 1.2rem;
    color: #555;
    font-weight: bold;
    &.active { color: #3498db; }
  }
  .divider { flex: 1; height: 1px; background: #333; margin: 0 20px; }
}

.form-group {
  margin-bottom: 20px;
  label { display: block; margin-bottom: 8px; color: #ccc; }
  input[type="text"], input[type="number"] {
    width: 100%; padding: 10px; background: #252526;
    border: 1px solid #3d3d3d; color: white; border-radius: 4px;
    outline: none;
    &:focus { border-color: #3498db; }
  }
}

.radio-group {
  display: flex; gap: 20px;
  label {
    cursor: pointer; padding: 10px 20px; background: #252526;
    border: 1px solid #3d3d3d; border-radius: 4px;
    transition: all 0.2s;
    &.checked { background: #3498db; color: white; border-color: #3498db; }
    input { display: none; }
  }
}

.scan-bar {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;
  .scan-controls { display: flex; align-items: center; gap: 15px; }
  .status { color: #888; display: flex; align-items: center; gap: 5px;}
  .spin { animation: spin 1s linear infinite; }
}

@keyframes spin { 100% { transform: rotate(360deg); } }

.device-list-container {
  display: grid; gap: 20px; margin-bottom: 30px;
}

.ref-card {
  background: #252526; border: 1px solid #3d3d3d; border-radius: 8px; overflow: hidden;
  .card-header { background: #333; padding: 10px 15px; font-weight: bold; }
  .card-body { padding: 15px; }
  .row { margin-bottom: 10px; label { font-size: 0.9rem; color: #888; } }
  select { width: 100%; padding: 8px; background: #1e1e1e; color: white; border: 1px solid #444; border-radius: 4px; outline: none; }
}

.actions {
  display: flex; justify-content: flex-end; gap: 15px; margin-top: 30px;
  button { padding: 10px 25px; border-radius: 4px; font-weight: bold; cursor: pointer; border: none; display: flex; align-items: center; gap: 8px; transition: opacity 0.2s; }
  button:hover { opacity: 0.9; }
  .btn-secondary { background: #555; color: white; }
  .btn-primary { background: #3498db; color: white; }
  .btn-success { background: #2ecc71; color: white; }
  .btn-scan { background: #e67e22; color: white; font-size: 0.9rem; padding: 6px 12px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
