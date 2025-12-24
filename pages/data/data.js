// pages/data/data.js
import * as echarts from '../../ec-canvas/echarts';
const app = getApp();

// 统一的“refresh 风格”基础样式：左右对称，避免偏右
const BASE_OPTION = {
  grid: {
    left: 24,     // ✅ 左右对称，别再用 40/20
    right: 24,
    top: 16,
    bottom: 20,
    containLabel: true, // 保留也行，因为左右对称了不容易“看起来偏右”
  },
  xAxis: {
    type: 'value',
    min: 0,
    max: 200,
    splitLine: { show: false },
  },
  yAxis: {
    type: 'value',
    // 这里不强行写 min/max，让它更接近“refresh 默认风格”
    splitLine: { show: false },
    scale: true, // ✅ ECG 这类波形更建议 scale，避免被压扁
  },
  series: [{
    type: 'line',
    data: [],
    showSymbol: false,
    smooth: false,
    // 如果你想“完全跟 refresh 默认一样”，可以把下面两行删掉
    lineStyle: { width: 2, color: '#1890ff' },
    areaStyle: { color: 'rgba(24, 144, 255, 0.1)' },
  }],
};

function initChart(canvas, width, height, dpr) {
  const chart = echarts.init(canvas, null, {
    width,
    height,
    devicePixelRatio: dpr,
  });
  canvas.setChart(chart);

  // ✅ init 直接用“refresh 风格”的完整基础 option
  chart.setOption(BASE_OPTION, true);

  const page = getCurrentPages().pop();
  if (page) page.chart = chart;

  return chart;
}

Page({
  data: {
    ec: { onInit: initChart },
    xCounter: 0,
  },

  chartData: [],          // [[x,y], ...]
  _pendingRecords: [],
  _lastFlushTs: 0,
  _chartHandler: null,

  onShow() {
    this._chartHandler = (record) => this.enqueueRecord(record);
    app.bleChartUpdateHandler = this._chartHandler;
  },

  onHide() {
    if (app.bleChartUpdateHandler === this._chartHandler) {
      app.bleChartUpdateHandler = null;
    }
  },

  onUnload() {
    if (app.bleChartUpdateHandler === this._chartHandler) {
      app.bleChartUpdateHandler = null;
    }
  },

  enqueueRecord(record) {
    if (!record) return;
    this._pendingRecords.push(record);

    if (!this.chart) return;

    const now = Date.now();
    const INTERVAL = 100;
    if (now - this._lastFlushTs >= INTERVAL) {
      this._lastFlushTs = now;
      this.flushPending();
    }
  },

  flushPending() {
    if (!this.chart || this._pendingRecords.length === 0) return;

    const records = this._pendingRecords.slice();
    this._pendingRecords.length = 0;

    let xCounter = this.data.xCounter;
    const newPoints = [];

    records.forEach((record) => {
      if (!record) return;

      // ✅ 新格式：samples = 16个点
      let values = [];
      if (Array.isArray(record.samples) && record.samples.length) {
        values = record.samples;
      } else {
        // 兼容旧格式：val1..val4
        const { val1, val2, val3, val4 } = record;
        values = [val1, val2, val3, val4];
      }

      values
        .filter(v => typeof v === 'number' && !isNaN(v))
        .forEach((v) => {
          newPoints.push([xCounter, v]);
          xCounter += 1;
        });
    });

    this.setData({ xCounter });

    if (!newPoints.length) return;

    // 更新滑动窗口
    this.chartData = this.chartData.concat(newPoints);
    const MAX_POINTS = 200;
    if (this.chartData.length > MAX_POINTS) {
      this.chartData.splice(0, this.chartData.length - MAX_POINTS);
    }

    const firstX = this.chartData[0][0];
    const lastX = this.chartData[this.chartData.length - 1][0];

    // ✅ 只做增量更新：不去覆盖 grid / 样式
    this.chart.setOption({
      xAxis: { min: firstX, max: lastX + 10 },
      series: [{ data: this.chartData }],
    });
  },

  // ✅ refresh：恢复“refresh 风格”的完整 baseOption（而不是残缺 option 覆盖）
  onRefreshChart() {
    if (!this.chart) return;

    this.chartData = [];
    this._pendingRecords = [];
    this._lastFlushTs = 0;
    this.setData({ xCounter: 0 });

    // 关键：用完整 BASE_OPTION 覆盖，保证刷新后样式可控且与 init 一致
    this.chart.setOption(BASE_OPTION, true);
  },
});
