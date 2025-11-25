// pages/data/data.js
import * as echarts from '../../ec-canvas/echarts';

const app = getApp();

function initChart(canvas, width, height, dpr) {
  const chart = echarts.init(canvas, null, {
    width,
    height,
    devicePixelRatio: dpr,
  });
  canvas.setChart(chart);

  const option = {
    xAxis: {
      type: 'value',
      name: 'Index',
      min: 0,
      max: 100,
    },
    yAxis: {
      type: 'value',
      name: 'Value',
      min: 0,
      max: 1000,
    },
    series: [{
      type: 'line',
      data: [[0, 0]],
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 2, color: '#1890ff' },
      areaStyle: { color: 'rgba(24, 144, 255, 0.1)' },
    }],
  };

  chart.setOption(option);

  // 把 chart 实例挂到当前页面实例上（不要放在 data 里）
  const page = getCurrentPages().pop();
  if (page) {
    page.chart = chart;
  }

  return chart;
}

Page({
  data: {
    ec: { onInit: initChart },
    xCounter: 0,
    chartWidth: 375,
  },

  // 仅存在于逻辑层，不进 data，避免频繁 setData 大数组
  chartData: [],
  _pendingRecords: [],
  _lastFlushTs: 0,

  onLoad() {
    // 注册全局图表更新 handler
    app.bleChartUpdateHandler = (record) => {
      this.enqueueRecord(record);
    };
  },

  onReady() {
    // 如果 chart 已经准备好了，尝试刷一遍 pending
    if (this.chart && this._pendingRecords.length > 0) {
      this.flushPending();
    }
  },

  onUnload() {
    // 页面销毁时解绑
    if (app.bleChartUpdateHandler) {
      app.bleChartUpdateHandler = null;
    }
  },

  // 接收到一条新的 record，放入缓冲，并做简单节流
  enqueueRecord(record) {
    if (!record) return;
    this._pendingRecords.push(record);

    // 如果 chart 还没准备好，先缓存在 _pendingRecords 中
    if (!this.chart) return;

    const now = Date.now();
    const INTERVAL = 100; // 每 100ms 最多刷新一次图表
    if (now - this._lastFlushTs >= INTERVAL) {
      this._lastFlushTs = now;
      this.flushPending();
    }
  },

  // 把 pending 里的记录全部画上去
  flushPending() {
    if (!this.chart || this._pendingRecords.length === 0) return;
    const records = this._pendingRecords.slice();
    this._pendingRecords.length = 0;

    records.forEach((record) => {
      this.addBLEPoints(record);
    });
  },

  // 把一条 record（包含 val1~4）转换为若干个点，更新到折线图
  addBLEPoints(record) {
    const { val1, val2, val3, val4 } = record;
    const values = [val1, val2, val3, val4]
      .filter(v => typeof v === 'number' && !isNaN(v));

    if (values.length === 0) return;

    const xCounter = this.data.xCounter;

    const newPoints = values.map((val, i) => ({
      value: [xCounter + i, val],
    }));

    this.chartData = this.chartData.concat(newPoints);

    const MAX_POINTS = 200;
    if (this.chartData.length > MAX_POINTS) {
      this.chartData.splice(0, this.chartData.length - MAX_POINTS);
    }

    const firstX = this.chartData[0].value[0];
    const lastX = this.chartData[this.chartData.length - 1].value[0];

    this.chart.setOption({
      xAxis: {
        type: 'value',
        name: 'Index',
        min: firstX,
        max: lastX + 10,
      },
      yAxis: {
        type: 'value',
        name: 'Value',
        min: 0,
        max: 1000,
      },
      series: [{
        type: 'line',
        data: this.chartData.map(p => p.value),
        showSymbol: false,
        smooth: true,
      }],
    });

    const newXCounter = xCounter + values.length;
    this.setData({
      xCounter: newXCounter,
      chartWidth: newXCounter * 10,
    });
  },

  // 手动重置图表
  onRefreshChart() {
    if (!this.chart) return;

    const option = {
      xAxis: {
        type: 'value',
        name: 'Index',
        min: 0,
        max: 100,
      },
      yAxis: {
        type: 'value',
        name: 'Value',
        min: 0,
        max: 1000,
      },
      series: [{
        type: 'line',
        data: [[0, 0]],
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2, color: '#1890ff' },
        areaStyle: { color: 'rgba(24, 144, 255, 0.1)' },
      }],
    };

    this.chart.setOption(option, true);
    this.chartData = [];

    this.setData({
      xCounter: 0,
      chartWidth: 375,
    });
  },
});
