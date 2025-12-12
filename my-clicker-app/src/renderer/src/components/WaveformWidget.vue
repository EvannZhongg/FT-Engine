<template>
  <div class="waveform-widget-container">
    <div class="chart-wrapper">
      <Line ref="chartRef" :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, shallowRef } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { useRefereeStore } from '../stores/refereeStore'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

const store = useRefereeStore()
const chartRef = ref(null)
const isRecording = ref(false)
const startTime = ref(null)
// 等待归零锁：防止上一个选手的残留数据干扰，要求必须先收到0才能开始
const waitForZero = ref(false)

const COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22']

const rawDatasets = shallowRef([])
const chartData = shallowRef({ datasets: [] })

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  spanGaps: true,
  normalized: true,
  parsing: false,
  scales: {
    x: {
      type: 'linear',
      display: true,
      grid: { color: '#444', drawBorder: false },
      ticks: { color: '#888', maxRotation: 0, autoSkip: true }
    },
    y: {
      position: 'right',
      beginAtZero: true,
      grid: { color: '#444', drawBorder: false },
      ticks: { color: '#888', stepSize: 1, precision: 0 }
    }
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index',
      intersect: false,
      backgroundColor: 'rgba(0,0,0,0.8)',
      titleColor: '#fff',
      bodyColor: '#fff'
    }
  },
  elements: {
    line: {
      tension: 0,
      stepped: false,
      borderWidth: 2
    },
    point: { radius: 0, hitRadius: 10 }
  },
  layout: {
    padding: 0
  }
}

const initDatasets = () => {
  rawDatasets.value = Object.keys(store.referees).map((key, index) => ({
    label: store.referees[key].name || `Ref ${key}`,
    borderColor: COLORS[index % COLORS.length],
    backgroundColor: COLORS[index % COLORS.length],
    data: [{ x: 0, y: 0 }],
    fill: false
  }))
  chartData.value = { datasets: rawDatasets.value }
}

const resetChart = () => {
  isRecording.value = false
  startTime.value = null

  // 【关键修复】检查当前状态是否已经是归零状态
  // 如果当前已经是全0（通常因为切换选手时触发了resetAll），则不需要等待归零信号
  // 直接解锁，准备接收第一个非零信号
  const allZero = Object.values(store.referees).every(r => r.total === 0)
  waitForZero.value = !allZero

  initDatasets()
}

watch(
  () => store.referees,
  (newRefs) => {
    // 检查是否所有分数都是 0
    const allZero = Object.values(newRefs).every(r => r.total === 0)

    // 1. 如果处于“等待归零”状态
    if (waitForZero.value) {
      if (allZero) {
        // 收到全0信号，解锁，准备开始
        waitForZero.value = false
      }
      // 只要还在等待归零，无论数据是什么，都忽略，不绘图
      return
    }

    // 2. 如果未开始录制，等待第一个非0信号
    if (!isRecording.value) {
      if (!allZero) {
        // 第一个非0信号来了，开始录制
        isRecording.value = true
        startTime.value = Date.now()
      } else {
        return
      }
    }

    // 3. 正常录制流程
    const now = Date.now()
    const timePoint = parseFloat(((now - startTime.value) / 1000).toFixed(1))

    if (rawDatasets.value.length !== Object.keys(newRefs).length) {
      initDatasets()
    }

    let hasUpdate = false

    Object.keys(newRefs).forEach((key, index) => {
      if (!rawDatasets.value[index]) return

      const currentScore = newRefs[key].total

      rawDatasets.value[index].data.push({
        x: timePoint,
        y: currentScore
      })
      hasUpdate = true
    })

    if (hasUpdate && chartRef.value && chartRef.value.chart) {
      chartRef.value.chart.update('none')
    }
  },
  { deep: true }
)

// 切换选手 -> 重置图表
watch(() => store.currentContext.contestantName, (n, o) => {
  if (n !== o) resetChart()
})

onMounted(() => {
  initDatasets()
  // 挂载时初始检查
  const allZero = Object.values(store.referees).every(r => r.total === 0)
  waitForZero.value = !allZero
})
</script>

<style scoped>
.waveform-widget-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.chart-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
</style>
