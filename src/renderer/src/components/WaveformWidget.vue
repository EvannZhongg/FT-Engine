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
      ticks: {
        color: '#888',
        maxRotation: 0,
        // 【核心修复】强制每隔 5 或 10 个单位（秒）画一个刻度
        stepSize: 5,
        autoSkip: true
      }
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

  // 【逻辑保留】重置时清除手动设置的 min/max，恢复初始状态
  if (chartRef.value && chartRef.value.chart) {
    const chart = chartRef.value.chart
    delete chart.options.scales.x.min
    delete chart.options.scales.x.max
    chart.update('none')
  }

  const allZero = Object.values(store.referees).every(r => r.total === 0)
  waitForZero.value = !allZero

  initDatasets()
}

watch(
  () => store.referees,
  (newRefs) => {
    // 【新增逻辑】定义严格的“系统重置”状态
    // 当所有裁判的 total/plus/minus 全部为 0 时，视为触发了 Reset 操作
    const isStrictReset = Object.values(newRefs).every(r =>
      r.total === 0 && r.plus === 0 && r.minus === 0
    )

    // 如果当前正在记录，且检测到系统重置：
    // 立即清空图表，停止记录，不再绘制“跌零”曲线
    if (isRecording.value && isStrictReset) {
      resetChart()
      return
    }

    const allZeroTotal = Object.values(newRefs).every(r => r.total === 0)

    if (waitForZero.value) {
      if (allZeroTotal) {
        waitForZero.value = false
      }
      return
    }

    if (!isRecording.value) {
      // 只有当出现非 0 分数时才开始记录
      if (!allZeroTotal) {
        isRecording.value = true
        startTime.value = Date.now()
      } else {
        return
      }
    }

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
      const chart = chartRef.value.chart

      // 【逻辑保留】动态计算滑动窗口
      const WINDOW_DURATION = 60
      const RIGHT_PADDING = 2

      const newMax = timePoint + RIGHT_PADDING
      const newMin = Math.max(0, newMax - WINDOW_DURATION)

      chart.options.scales.x.min = newMin
      chart.options.scales.x.max = newMax

      chart.update('none')
    }
  },
  { deep: true }
)

watch(() => store.currentContext.contestantName, (n, o) => {
  if (n !== o) resetChart()
})

onMounted(() => {
  initDatasets()
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
