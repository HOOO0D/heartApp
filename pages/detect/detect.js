// pages/detect/detect.js
const app = getApp();

const BASE_URL = 'http://10.218.241.216:5000';

Page({
  data: {
    statusText: '点击按钮开始采集 60 秒心电数据',
    isCapturing: false,
    progress: 0,

    result: null,
    resultText: '',

    totalBeats: 0,
    abnormalBeats: 0,
    normalBeats: 0,
    abnormalRatioText: '',

    rpeaksImage: '',
    last10Image: '' ,
  },
  previewImage(e) {
    const current = e.currentTarget.dataset.src;
    const urls = [];
  
    if (this.data.rpeaksImage) urls.push(this.data.rpeaksImage);
    if (this.data.last10Image) urls.push(this.data.last10Image);
  
    wx.previewImage({
      current, // 当前点击的那张
      urls     // 可左右滑动查看两张
    });
  },
  
  onLoad() {
    this._pollTimer = null;
    this._pollFailCount = 0;

    if (!app.globalData) app.globalData = {};
    if (typeof app.globalData.sendToFlask !== 'boolean') app.globalData.sendToFlask = false;
    if (typeof app.globalData.captureId !== 'string') app.globalData.captureId = '';
  },

  onHide() {
  },

  onUnload() {
    this._safeStopAll('页面卸载，停止采集');
  },

  // ============== 内部工具 ==============

  _safeStopAll(tip) {
    this.stopPolling();

    // ✅ 关上传开关 + 清会话
    app.globalData.sendToFlask = false;
    app.globalData.captureId = '';

    this.setData({
      isCapturing: false,
      statusText: tip || '已停止',
      progress: 0
    });
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  startPolling() {
    this.stopPolling();
    this._pollFailCount = 0;
    this._pollTimer = setInterval(() => {
      this.pollCaptureResult();
    }, 2000);
  },

  // ============== 事件：开始采集 ==============

  startCapture() {
    if (this.data.isCapturing) return;

    // ✅ 注意：不要提前打开 sendToFlask（否则还没拿到 capture_id 会无意义请求）
    app.globalData.sendToFlask = false;
    app.globalData.captureId = '';

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
      rpeaksImage: '',
      last10Image: '',
    });

    wx.request({
      url: `${BASE_URL}/start_capture`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: {},

      success: (res) => {
        const data = res.data || {};
        if (!data.ok) {
          this._safeStopAll(data.msg || '采集任务启动失败');
          wx.showToast({ title: data.msg || '采集启动失败', icon: 'none' });
          return;
        }

        const cid = data.capture_id || '';
        if (!cid) {
          // 没拿到 capture_id 直接停止（后端/网络异常）
          this._safeStopAll('未获取到 capture_id，采集启动失败');
          wx.showToast({ title: '未获取 capture_id', icon: 'none' });
          return;
        }

        // ✅ 保存会话ID并打开上传开关
        app.globalData.captureId = cid;
        app.globalData.sendToFlask = true;

        this.setData({
          statusText: '已开始采集，预计 60 秒内完成数据收集...',
          progress: 0
        });

        this.startPolling();
      },

      fail: (err) => {
        console.error('start_capture 请求失败:', err);
        this._safeStopAll('采集指令发送失败，请检查网络或后端服务');
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },

  // ============== 轮询后端 /capture_result ==============

  pollCaptureResult() {
    wx.request({
      url: `${BASE_URL}/capture_result`,
      method: 'GET',

      success: (res) => {
        this._pollFailCount = 0;

        const data = res.data || {};
        const status = data.status;

        if (status === 'collecting') {
          const secRaw = data.progress || 0;
          const sec = typeof secRaw === 'number' ? secRaw : Number(secRaw) || 0;
          const percent = Math.max(0, Math.min(100, (sec / 60) * 100));

          this.setData({
            statusText: `正在采集：${sec.toFixed(1)} s / 60 s`,
            progress: percent
          });

        } else if (status === 'processing') {
          // ✅ processing 立即关上传开关（index.js 会清队列/abort）
          app.globalData.sendToFlask = false;

          this.setData({
            statusText: '采集结束，正在调用 MATLAB 进行心电分析...',
            progress: 100
          });

        } else if (status === 'done') {
          this.stopPolling();

          // ✅ done 关上传开关并清会话
          app.globalData.sendToFlask = false;
          app.globalData.captureId = '';

          const result = data.result || {};
          let text = '';
          try { text = JSON.stringify(result, null, 2); }
          catch (e) { text = String(result); }

          const totalBeats = result.total_beats || 0;
          const abnormalBeats = result.abnormal_beats || 0;
          const normalBeats = result.normal_beats || 0;

          let abnormalRatioText = '';
          if (typeof result.abnormal_ratio === 'number') {
            abnormalRatioText = (result.abnormal_ratio * 100).toFixed(1) + '%';
          }

          if (typeof result.abnormal_ratio === 'number' && result.abnormal_ratio > 0.25) {
            wx.showModal({
              title: '警告',
              content: '心跳异常比例超过 25%，请注意！',
              showCancel: false,
              confirmText: '知道了'
            });
          }

          let imgUrl1 = '';
          if (result.rpeaks_image_base64) {
          imgUrl1 = 'data:image/png;base64,' + result.rpeaks_image_base64;
          }

          let imgUrl2 = '';
          if (result.last10_image_base64) {        // ✅ 新增：后端第二张图字段
          imgUrl2 = 'data:image/png;base64,' + result.last10_image_base64;
          }


          this.setData({
            isCapturing: false,
            statusText: '分析完成',
            progress: 100,
            result,
            resultText: text,
            totalBeats,
            abnormalBeats,
            normalBeats,
            abnormalRatioText,
            rpeaksImage: imgUrl1,
            last10Image:imgUrl2,
          });

        } else if (status === 'error') {
          this.stopPolling();

          app.globalData.sendToFlask = false;
          app.globalData.captureId = '';

          this.setData({
            isCapturing: false,
            statusText: '分析出错，请稍后重试'
          });

          console.error('后端错误:', data.error);
          wx.showToast({ title: '后端错误', icon: 'none' });

        } else if (status === 'idle' || !status) {
          this.stopPolling();

          app.globalData.sendToFlask = false;
          app.globalData.captureId = '';

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
        this._pollFailCount += 1;

        if (this._pollFailCount >= 3) {
          this._safeStopAll('轮询连续失败，已停止采集上传，请检查网络后重试');
          wx.showToast({ title: '轮询失败，已停止', icon: 'none' });
        } else {
          wx.showToast({ title: '轮询失败', icon: 'none' });
        }
      }
    });
  }
});
