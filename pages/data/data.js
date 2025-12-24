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
    grid: { left: 40, right: 20, top: 20, bottom: 30, containLabel: true },
    xAxis: {
      type: 'value',
      name: 'Index',
      min: 0,
      max: 200,
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Value',
      min: 0,
      max: 1000,
      splitLine: { show: false },
    },
    series: [{
      type: 'line',
      data: [],
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 2, color: '#1890ff' },
      areaStyle: { color: 'rgba(24, 144, 255, 0.1)' },
    }],
  };

  chart.setOption(option);

  const page = getCurrentPages().pop();
  if (page) {
    page.chart = chart;   // 挂到页面实例上
  }

  return chart;
}

Page({
  data: {
    ec: { onInit: initChart },
    xCounter: 0,
  },

  // 逻辑层字段，不放 data
  chartData: [],          // [[x,y], ...]
  _pendingRecords: [],
  _lastFlushTs: 0,
  _chartHandler: null,

  onLoad() {
    // 这里只做初始化，不注册 handler
  },

  // ⭐ 只在页面可见时，接 BLE 数据画图
  onShow() {
    this._chartHandler = (record) => {
      this.enqueueRecord(record);
    };
    app.bleChartUpdateHandler = this._chartHandler;
  },

  // 页面隐藏（切到其他 tab）时就停掉图表更新
  onHide() {
    if (app.bleChartUpdateHandler === this._chartHandler) {
      app.bleChartUpdateHandler = null;
    }
  },

  // 保险起见，销毁时也清一下
  onUnload() {
    if (app.bleChartUpdateHandler === this._chartHandler) {
      app.bleChartUpdateHandler = null;
    }
  },

  // 收到一条新 record：先入缓冲，做 100ms 节流
  enqueueRecord(record) {
    if (!record) return;
    this._pendingRecords.push(record);

    // chart 还没 ready，就先攒着
    if (!this.chart) return;

    const now = Date.now();
    const INTERVAL = 100; // 100ms 刷一次图就够了
    if (now - this._lastFlushTs >= INTERVAL) {
      this._lastFlushTs = now;
      this.flushPending();
    }
  },

  // 批量把 pending 里的记录转成点，一次性 setOption
  flushPending() {
    if (!this.chart || this._pendingRecords.length === 0) return;

    const records = this._pendingRecords.slice();
    this._pendingRecords.length = 0;

    let xCounter = this.data.xCounter;
    const newPoints = [];

    records.forEach((record) => {
      const { val1, val2, val3, val4 } = record;
      const values = [val1, val2, val3, val4]
        .filter(v => typeof v === 'number' && !isNaN(v));
      values.forEach((v) => {
        newPoints.push([xCounter, v]);
        xCounter += 1;
      });
    });

    if (!newPoints.length) {
      this.setData({ xCounter: xCounter });
      return;
    }

    // 更新本地缓存 + 滑动窗口
    this.chartData = this.chartData.concat(newPoints);
    const MAX_POINTS = 200;          // 显示最近 200 个点
    if (this.chartData.length > MAX_POINTS) {
      this.chartData.splice(0, this.chartData.length - MAX_POINTS);
    }

    const firstX = this.chartData[0][0];
    const lastX = this.chartData[this.chartData.length - 1][0];

    // ⭐ 一次性 setOption
    this.chart.setOption({
      xAxis: {
        type: 'value',
        name: 'Index',
        min: firstX,
        max: lastX + 10,
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Value',
        min: 0,
        max: 1000,
        splitLine: { show: false },
      },
      series: [{
        type: 'line',
        data: this.chartData,
        showSymbol: false,
        smooth: true,
      }],
    });

    this.setData({ xCounter });
  },

  // 手动重置
  onRefreshChart() {
    if (!this.chart) return;

    this.chartData = [];
    this._pendingRecords = [];
    this._lastFlushTs = 0;

    this.setData({ xCounter: 0 });

    this.chart.setOption({
      xAxis: { min: 0, max: 200 },
      series: [{ data: [] }],
    }, true);
  },
});
