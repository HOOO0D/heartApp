import * as echarts from '../../ec-canvas/echarts'
import { designNotchFilter, applyIIRFilter } from '../../utils/filter' // 修改为你自己的路径

let chart = null;

// 采样率配置（根据 BLE 数据推送频率）
const fs = 360;    // 假设 BLE 每 200ms 推送一次，即 5Hz
const f0 = 50;   // 要滤除的工频干扰
const Q = 30;
const { b, a } = designNotchFilter(fs, f0, Q);

function initChart(canvas, width, height, dpr) {
  chart = echarts.init(canvas, null, {
    width,
    height,
    devicePixelRatio: dpr
  });
  canvas.setChart(chart);

  const option = {
    title: {
      text: '实时 Diff 值对比（原始 vs 滤波）'
    },
    tooltip: {
      trigger: 'axis'
    },
    legend: {
      data: ['原始值', '滤波值']
    },
    xAxis: {
      type: 'category',
      data: []
    },
    yAxis: {
      type: 'value',
      min: -20,
      max: 500
    },
    series: [
      {
        name: '原始值',
        type: 'line',
        data: [],
        showSymbol: false,
        smooth: true,
        lineStyle: { color: '#d14a61' }
      },
      {
        name: '滤波值',
        type: 'line',
        data: [],
        showSymbol: false,
        smooth: true,
        lineStyle: { color: '#3fb1e3' }
      }
    ]
  };

  chart.setOption(option);
  return chart;
}

Page({
  data: {
    ec: {
      onInit: initChart
    },
    rawValues: [],
    filteredValues: [],
    times: []
  },

  onLoad() {
    this.timer = setInterval(() => {
      const app = getApp();
      const rawDiffs = app.globalData.bleDiffValues || [];

      if (!chart || rawDiffs.length < 3) return; // 至少 3 点才能滤波

      const now = new Date();
      const label = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
      const latestRaw = rawDiffs[rawDiffs.length - 1];

      // 滤波处理整个序列，取最后一个作为当前展示值
      const filtered = applyIIRFilter(rawDiffs, b, a);
      const latestFiltered = filtered[filtered.length - 1];

      // 更新图表数据
      const rawValues = this.data.rawValues.slice();
      const filteredValues = this.data.filteredValues.slice();
      const times = this.data.times.slice();

      rawValues.push(latestRaw);
      filteredValues.push(latestFiltered);
      times.push(label);

      if (rawValues.length > 20) {
        rawValues.shift();
        filteredValues.shift();
        times.shift();
      }

      this.setData({ rawValues, filteredValues, times });

      chart.setOption({
        xAxis: {
          data: times
        },
        series: [
          { data: rawValues },
          { data: filteredValues }
        ]
      });
    }, 1000);
  },

  onUnload() {
    clearInterval(this.timer);
  }
});