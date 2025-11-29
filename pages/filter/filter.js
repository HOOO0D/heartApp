// pages/detect/detect.js
const app = getApp();


const BASE_URL = 'http://10.100.28.106:5000';

Page({
  data: {
    statusText: '点击按钮开始采集 60 秒心电数据',
    isCapturing: false,      // 是否正在进行本次 60s 采集/分析流程
    progress: 0,             // 0-100，进度条
    result: null,            // 后端返回的结果对象
    resultText: '',          // 把结果序列化成字符串，方便直接显示
  },

  onLoad() {
    this._pollTimer = null;  // 轮询计时器
    // 确保全局有这个开关
    if (!app.globalData) app.globalData = {};
    if (typeof app.globalData.sendToFlask !== 'boolean') {
      app.globalData.sendToFlask = false;
    }
  },

  onHide() {
    this.stopPolling();
    // 离开页面时，保险起见关掉上传
    app.globalData.sendToFlask = false;
  },

  onUnload() {
    this.stopPolling();
    app.globalData.sendToFlask = false;
  },

  // 停止轮询定时器
  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  // 点击按钮：开始采集 60s
  startCapture() {
    app.globalData.sendToFlask = true;
    if (this.data.isCapturing) {
      // 已经在一次流程中，防止重复点
      return;
    }

    this.setData({
      isCapturing: true,
      statusText: '正在发送采集指令...',
      progress: 0,
      result: null,
      resultText: '',
    });

    wx.request({
      url: `${BASE_URL}/start_capture`,
      method: 'POST',
      header: {
        'content-type': 'application/json',
      },
      success: (res) => {
        const data = res.data || {};
        if (data.ok) {
          // ⭐ 后端接受采集任务，开始让 index 页往 Flask 丢数据
          app.globalData.sendToFlask = true;

          this.setData({
            statusText: '已开始采集，预计 60 秒内完成数据收集...',
            progress: 0,
          });
          // 开始轮询采集/分析状态
          this.startPolling();
        } else {
          this.setData({
            isCapturing: false,
            statusText: data.msg || '采集任务启动失败',
          });
          wx.showToast({
            title: data.msg || '采集已在进行中',
            icon: 'none',
          });
        }
      },
      fail: (err) => {
        console.error('start_capture 请求失败:', err);
        this.setData({
          isCapturing: false,
          statusText: '采集指令发送失败，请检查网络或后端服务',
        });
        wx.showToast({
          title: '网络错误',
          icon: 'none',
        });
      },
    });
  },

  // 启动轮询 /capture_result
  startPolling() {
    this.stopPolling();
    // 每 2 秒轮询一次
    this._pollTimer = setInterval(() => {
      this.pollCaptureResult();
    }, 2000);
  },

  // 调用 /capture_result 获取最新状态 & 结果
  pollCaptureResult() {
    wx.request({
      url: `${BASE_URL}/capture_result`,
      method: 'GET',
      success: (res) => {
        const data = res.data || {};
        const status = data.status;

        if (status === 'collecting') {
          const secRaw = data.progress || 0;
          const sec = typeof secRaw === 'number' ? secRaw : Number(secRaw) || 0;
          const percent = Math.max(0, Math.min(100, (sec / 60) * 100));

          this.setData({
            statusText: `正在采集：${sec.toFixed(1)} s / 60 s`,
            progress: percent,
          });

        } else if (status === 'processing') {
          this.setData({
            statusText: '采集结束，正在调用 MATLAB 进行心电分析...',
            progress: 100,
          });

        } else if (status === 'done') {
          // ⭐ 分析完成，停止轮询 + 关闭上传
          this.stopPolling();
          app.globalData.sendToFlask = false;

          const result = data.result || null;
          let text = '';
          try {
            text = JSON.stringify(result, null, 2);
          } catch (e) {
            text = String(result);
          }

          this.setData({
            isCapturing: false,
            statusText: '分析完成',
            progress: 100,
            result,
            resultText: text,
          });

        } else if (status === 'error') {
          // ⭐ 后端分析出错，停止轮询 + 关闭上传
          this.stopPolling();
          app.globalData.sendToFlask = false;

          this.setData({
            isCapturing: false,
            statusText: '分析出错，请稍后重试',
          });
          console.error('后端错误:', data.error);
          wx.showToast({
            title: '后端错误',
            icon: 'none',
          });

        } else if (status === 'idle' || !status) {
          // idle 一般说明目前没有任务（比如服务刚启动）
          // ⭐ 防止一直传数据，直接关掉
          this.stopPolling();
          app.globalData.sendToFlask = false;

          this.setData({
            isCapturing: false,
            statusText: '当前没有采集任务，请重新开始采集',
            progress: 0,
          });
        } else {
          // 未知状态，打印出来 debug
          console.warn('未知状态:', status, data);
        }
      },
      fail: (err) => {
        console.error('capture_result 请求失败:', err);
        wx.showToast({
          title: '轮询失败',
          icon: 'none',
        });
        // 这里先不立刻 stopPolling，可能是临时网络抖动
        // 如果你想更激进一点，可以统计失败次数，多次失败后自动停止并关闭 sendToFlask
      },
    });
  },
});
