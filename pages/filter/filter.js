// pages/detect/detect.js
const app = getApp();

const BASE_URL = 'http://10.218.241.216:5000';

Page({
  data: {
    statusText: '点击按钮开始采集 60 秒心电数据',
    isCapturing: false,      // 是否正在进行本次 60s 采集/分析流程
    progress: 0,             // 0-100，进度条

    // 后端原始结果
    result: null,
    resultText: '',          // JSON 字符串展示用

    // 统计信息（便于在 WXML 里单独显示）
    totalBeats: 0,
    abnormalBeats: 0,
    normalBeats: 0,
    abnormalRatioText: '',   // 比如 "12.3%"

    // R 峰示意图（后端 base64 -> dataURL）
    rpeaksImage: ''
  },

  onLoad() {
    this._pollTimer = null;  // 轮询计时器

    if (!app.globalData) app.globalData = {};
    if (typeof app.globalData.sendToFlask !== 'boolean') {
      app.globalData.sendToFlask = false;
    }
  },

  onHide() {
    this._safeStopAll();
  },

  onUnload() {
    this._safeStopAll();
  },

  // ============== 内部小工具 ==============

  _safeStopAll() {
    this.stopPolling();
    app.globalData.sendToFlask = false;
    this.setData({
      isCapturing: false
    });
  },

  // 停止轮询定时器
  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  // 启动轮询 /capture_result
  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(() => {
      this.pollCaptureResult();
    }, 2000);
  },

  // ============== 事件：点击“开始采集”按钮 ==============

  startCapture() {
    // 防止重复点击
    if (this.data.isCapturing) return;

    // 开启发送到 Flask 的开关（index.js 里会根据这个开关决定是否上报）
    app.globalData.sendToFlask = true;

    this.setData({
      isCapturing: true,
      statusText: '正在发送采集指令...',
      progress: 0,
      result: null,
      resultText: '',
      totalBeats: 0,
      abnormalBeats: 0,
      normalBeats: 0,
      abnormalRatioText: '',
      rpeaksImage: ''
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
          // 后端接受采集任务
          this.setData({
            statusText: '已开始采集，预计 60 秒内完成数据收集...',
            progress: 0
          });
          // 开始轮询采集/分析状态
          this.startPolling();
        } else {
          // 启动失败，关掉开关
          app.globalData.sendToFlask = false;
          this.setData({
            isCapturing: false,
            statusText: data.msg || '采集任务启动失败'
          });
          wx.showToast({
            title: data.msg || '采集已在进行中',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('start_capture 请求失败:', err);
        app.globalData.sendToFlask = false;
        this.setData({
          isCapturing: false,
          statusText: '采集指令发送失败，请检查网络或后端服务'
        });
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
      },
    });
  },

  // ============== 轮询后端 /capture_result ==============

  pollCaptureResult() {
    wx.request({
      url: `${BASE_URL}/capture_result`,
      method: 'GET',
      success: (res) => {
        const data = res.data || {};
        const status = data.status;

        if (status === 'collecting') {
          // 仍在采集 60s
          const secRaw = data.progress || 0;
          const sec = typeof secRaw === 'number' ? secRaw : Number(secRaw) || 0;
          const percent = Math.max(0, Math.min(100, (sec / 60) * 100));

          this.setData({
            statusText: `正在采集：${sec.toFixed(1)} s / 60 s`,
            progress: percent
          });

        } else if (status === 'processing') {
          // 采集结束，MATLAB 正在跑
          app.globalData.sendToFlask = false;
          this.setData({
            statusText: '采集结束，正在调用 MATLAB 进行心电分析...',
            progress: 100
          });

        } else if (status === 'done') {
          // 分析完成：停止轮询 + 关闭上传
          this.stopPolling();
          app.globalData.sendToFlask = false;

          const result = data.result || {};
          let text = '';
          try {
            text = JSON.stringify(result, null, 2);
          } catch (e) {
            text = String(result);
          }

          // 解析统计信息
          const totalBeats = result.total_beats || 0;
          const abnormalBeats = result.abnormal_beats || 0;
          const normalBeats = result.normal_beats || 0;
          let abnormalRatioText = '';
          if (typeof result.abnormal_ratio === 'number') {
            abnormalRatioText = (result.abnormal_ratio * 100).toFixed(1) + '%';
          }

          // 异常比例大于 25% 时，弹出提示框
          if (result.abnormal_ratio > 0.25) {
            wx.showModal({
              title: '警告',
              content: '心跳异常比例超过 25%，请注意！',
              showCancel: false,
              confirmText: '知道了',
            });
          }

          // 解析 R 峰示意图
          let imgUrl = '';
          if (result.rpeaks_image_base64) {
            imgUrl = 'data:image/png;base64,' + result.rpeaks_image_base64;
          }

          this.setData({
            isCapturing: false,  // 确保采集完成后更新为 false
            statusText: '分析完成',
            progress: 100,
            result,
            resultText: text,
            totalBeats,
            abnormalBeats,
            normalBeats,
            abnormalRatioText,
            rpeaksImage: imgUrl
          });

        } else if (status === 'error') {
          // 后端报错：停止轮询 + 关闭上传
          this.stopPolling();
          app.globalData.sendToFlask = false;

          this.setData({
            isCapturing: false,
            statusText: '分析出错，请稍后重试'
          });
          console.error('后端错误:', data.error);
          wx.showToast({
            title: '后端错误',
            icon: 'none'
          });

        } else if (status === 'idle' || !status) {
          // idle：当前没有任务，通常是刚启动 / 上一次已结束
          this.stopPolling();
          app.globalData.sendToFlask = false;

          this.setData({
            isCapturing: false,
            statusText: '当前没有采集任务，请重新开始采集',
            progress: 0
          });
        } else {
          console.warn('未知状态:', status, data);
        }
      },
      fail: (err) => {
        console.error('capture_result 请求失败:', err);
        wx.showToast({
          title: '轮询失败',
          icon: 'none',
        });
      },
    });
  },
});
