import * as echarts from '../../ec-canvas/echarts';

const app = getApp();

function initChart(canvas, width, height, dpr) {
  const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
  canvas.setChart(chart);

  const page = getCurrentPages().pop();
  if (page) {
    page.setData({ chartInstance: chart });
  }

  const option = {
    xAxis: {
      type: 'value',
      name: 'Index',
      min: 0,
      max: 100
    },
    yAxis: {
      type: 'value',
      name: 'Value',
      min: 0,
      max: 1000
    },
    series: [{
      type: 'line',
      data: [[0, 0]],
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 2, color: '#1890ff' },
      areaStyle: { color: 'rgba(24, 144, 255, 0.1)' }
    }]
  };

  chart.setOption(option);
  return chart;
}

Page({
  data: {
    ec: { onInit: initChart },
    chartInstance: null,
    chartData: [],
    xCounter: 0,
    chartWidth: 375
  },

  onLoad() {
    app.bleChartUpdateHandler = (vals) => {
      if (this.data.chartInstance) {
        this.addBLEPoints(vals);
      } else {
        if (!this._pendingPoints) this._pendingPoints = [];
        this._pendingPoints.push(vals);
      }
    };
  },

  onReady() {
    if (this._pendingPoints?.length > 0 && this.data.chartInstance) {
      this._pendingPoints.forEach(vals => this.addBLEPoints(vals));
      this._pendingPoints = [];
    }
  },

  onUnload() {
    app.bleChartUpdateHandler = null;
  },

  addBLEPoints(valuesObj) {
    if (!valuesObj) return;

    const valueArray = [valuesObj.val1, valuesObj.val2, valuesObj.val3, valuesObj.val4]
      .filter(v => typeof v === 'number');

    const { chartData, xCounter, chartInstance } = this.data;

    const newPoints = valueArray.map((val, i) => ({
      value: [xCounter + i, val]
    }));

    const updated = chartData.concat(newPoints);
    const MAX_POINTS = 200;
    if (updated.length > MAX_POINTS) updated.splice(0, updated.length - MAX_POINTS);

    chartInstance.setOption({
      xAxis: {
        type: 'value',
        name: 'Index',
        min: updated[0]?.value[0] ?? 0,
        max: updated[updated.length - 1]?.value[0] + 10
      },
      yAxis: {
        type: 'value',
        name: 'Value',
        min: 0,
        max: 1000
      },
      series: [{
        type: 'line',
        data: updated.map(p => p.value),
        showSymbol: false,
        smooth: true
      }]
    });

    this.setData({
      chartData: updated,
      xCounter: xCounter + valueArray.length,
      chartWidth: (xCounter + valueArray.length) * 10
    });
  },

  onRefreshChart() {
    const { chartInstance } = this.data;
    if (!chartInstance) return;

    const option = {
      xAxis: {
        type: 'value',
        name: 'Index',
        min: 0,
        max: 100
      },
      yAxis: {
        type: 'value',
        name: 'Value',
        min: 0,
        max: 1000
      },
      series: [{
        type: 'line',
        data: [[0, 0]],
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2, color: '#1890ff' },
        areaStyle: { color: 'rgba(24, 144, 255, 0.1)' }
      }]
    };

    chartInstance.setOption(option, true);
    this.setData({
      chartData: [],
      xCounter: 0,
      chartWidth: 375
    });
  }
});

