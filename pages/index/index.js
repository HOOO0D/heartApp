// pages/index/index.js
const app = getApp();

// 工具：在数组里按 key 找下标
function inArray(arr, key, val) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i][key] === val) return i;
  }
  return -1;
}

// ArrayBuffer -> hex 字符串
function ab2hex(buffer) {
  return Array.prototype.map.call(
    new Uint8Array(buffer),
    bit => ('00' + bit.toString(16)).slice(-2)
  ).join('');
}

// 解析 BLE 数据：每 2 字节一组，小端转大端
function parseBLEData(hexStr) {
  const values = [];
  const groupSize = 4;
  const totalGroups = Math.floor(hexStr.length / groupSize);

  for (let i = 0; i < totalGroups; i++) {
    const group = hexStr.slice(i * groupSize, (i + 1) * groupSize);
    const val = parseInt(group.slice(2, 4) + group.slice(0, 2), 16);
    values.push(val);
  }
  return values;
}

// 后端地址
const BASE_URL = 'http://10.218.241.216:5000';

// 设备服务 UUID（按你的设备来）
const SERVICE_UUID = '8653000A-43E6-47B7-9CB0-5FC21D4AE340';

Page({
  data: {
    devices: [],
    connected: false,
    chs: [],
    VALUE1: 0,
    VALUE2: 0,
    VALUE3: 0,
    VALUE4: 0,
    canWrite: false
  },

  onLoad() {
    if (!app.globalData) app.globalData = {};
    if (!app.globalData.bleValues) app.globalData.bleValues = [];
    if (typeof app.globalData.sendToFlask !== 'boolean') app.globalData.sendToFlask = false;
    if (typeof app.globalData.captureId !== 'string') app.globalData.captureId = '';

    // 发现控制
    this._discoveryStarted = false;

    // ====== 上传管道状态（核心）======
    this._uploadBuf = [];       // 待上传缓存（record 列表）
    this._flushTimer = null;    // flush 定时器
    this._uploading = false;    // 是否有在途请求
    this._reqTask = null;       // 当前 RequestTask（可 abort）

    // 你可以按网络情况调这些参数
    this._UPLOAD_INTERVAL_MS = 200; // 200ms flush 一次 -> 5次/秒
    this._BATCH_SIZE = 50;          // 每次最多 50 条 record
    this._MAX_BUF = 4000;           // 最大缓存，防止网络差时无限堆积

    // ⭐ 全局只注册一次 BLE 通知监听
    if (!this._bleListenerRegistered) {
      wx.onBLECharacteristicValueChange((characteristic) => {
        this.handleBleNotification(characteristic);
      });
      this._bleListenerRegistered = true;
    }
    // UI 节流：200ms 更新一次显示
  this._uiLastTs = 0;
  this._UI_THROTTLE_MS = 200;

  // 速率统计：每秒打印一次（用于判断是不是 BLE 限制）
  this._statTs = Date.now();
  this._statPackets = 0;   // record 数（每个 record = 4点）
  this._statPoints = 0;    // 点数（= record*4）

  },

  onHide() {
    // 页面隐藏：如果已经关上传，就清掉管道，避免后台继续吐
    if (!app.globalData.sendToFlask) {
      this.stopUploadPipeline();
    }
  },

  onUnload() {
    this.stopUploadPipeline();

    if (this._bleListenerRegistered) {
      try {
        wx.offBLECharacteristicValueChange && wx.offBLECharacteristicValueChange();
      } catch (e) {
        console.warn('offBLECharacteristicValueChange 不支持或出错:', e);
      }
      this._bleListenerRegistered = false;
    }
  },

  // ================== BLE 通知处理 ==================

  handleBleNotification(characteristic) {
    const hexVal = ab2hex(characteristic.value);
  
    // 解析所有 16bit 值
    const values = parseBLEData(hexVal);
    if (!values || values.length < 4) return;
  
    // ✅ 按 4 个一组拆分（防止一个 notify 里有多组数据你只取前4个）
    const now = Date.now();
    const groups = Math.floor(values.length / 4);
  
    for (let g = 0; g < groups; g++) {
      const base = g * 4;
      const val1 = values[base + 0];
      const val2 = values[base + 1];
      const val3 = values[base + 2];
      const val4 = values[base + 3];
  
      const record = { ts: now, val1, val2, val3, val4 };
  
      // 全局缓存（滑动窗口）— 注意：这里缓存的是 record，不要太大
      const buf = app.globalData.bleValues;
      const MAX_LEN = 1000;
      buf.push(record);
      if (buf.length > MAX_LEN) buf.splice(0, buf.length - MAX_LEN);
  
      // 分发给图表页/记录页（这俩如果很重，也建议你在那边做节流）
      if (typeof app.bleChartUpdateHandler === 'function') app.bleChartUpdateHandler(record);
      if (typeof app.bleRecordHandler === 'function') app.bleRecordHandler(record);
  
      // ✅ 上传：只在 detect 页开启采集时进行
      if (app.globalData.sendToFlask) {
        if (app.globalData.captureId) this.enqueueUpload(record);
      } else {
        this.stopUploadPipeline();
      }
  
      // ====== 速率统计（每秒打印）======
      this._statPackets += 1;   // 一个 record = 4点
      this._statPoints += 4;
    }
  
    // ====== 每秒输出一次统计：判断到底是多少包/秒 ======
    const dt = now - this._statTs;
    if (dt >= 1000) {
      const pps = (this._statPackets * 1000 / dt).toFixed(1); // records/s
      const sps = (this._statPoints * 1000 / dt).toFixed(1);  // samples/s
      console.log(`[BLE rate] records/s=${pps}, samples/s=${sps}, valuesLen=${values.length}`);
  
      this._statTs = now;
      this._statPackets = 0;
      this._statPoints = 0;
    }
  
    // ====== UI 更新节流：200ms 才 setData 一次 ======
    if (now - this._uiLastTs >= this._UI_THROTTLE_MS) {
      this._uiLastTs = now;
  
      // 只显示最新一组（最后一组）
      const lastBase = (groups - 1) * 4;
      const d1 = values[lastBase + 0];
      const d2 = values[lastBase + 1];
      const d3 = values[lastBase + 2];
      const d4 = values[lastBase + 3];
  
      this.setData({
        VALUE1: d1,
        VALUE2: d2,
        VALUE3: d3,
        VALUE4: d4
        // chsData 这种调试字段建议别再每次更新，否则很卡
      });
    }
  },

  // ================== 上传管道（核心） ==================

  enqueueUpload(record) {
    this._uploadBuf.push(record);

    // 缓冲上限：网络差时丢弃最旧数据，避免越积越多发不完
    if (this._uploadBuf.length > this._MAX_BUF) {
      this._uploadBuf.splice(0, this._uploadBuf.length - this._MAX_BUF);
    }

    // 启动 flush 定时器
    if (!this._flushTimer) {
      this._flushTimer = setInterval(() => {
        this.flushUpload();
      }, this._UPLOAD_INTERVAL_MS);
    }
  },

  flushUpload() {
    // 开关关了：直接停
    if (!app.globalData.sendToFlask) {
      this.stopUploadPipeline();
      return;
    }

    // 没有会话ID：也停（不应该出现，稳妥起见）
    const cid = app.globalData.captureId;
    if (!cid) {
      this.stopUploadPipeline();
      return;
    }

    // 单并发：已有请求在途，不再发新的
    if (this._uploading) return;

    // 没数据不发
    if (!this._uploadBuf.length) return;

    // 取一批
    const batch = this._uploadBuf.splice(0, this._BATCH_SIZE);

    // 组装后端 batch 数据：后端只需要 val1..val4
    const payload = {
      capture_id: cid,
      batch: batch.map(x => ({
        val1: x.val1, val2: x.val2, val3: x.val3, val4: x.val4
      }))
    };

    this._uploading = true;

    this._reqTask = wx.request({
      url: `${BASE_URL}/upload_data`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: payload,

      success: (res) => {
        // 后端在 not_collecting / capture_id mismatch 时会返回 409
        if (res.statusCode === 409) {
          // 说明采集已经结束或会话不一致：立即止血
          this.stopUploadPipeline();
          return;
        }

        // 非 200 也当失败处理
        if (res.statusCode !== 200) {
          console.warn('upload statusCode:', res.statusCode, res.data);
          // 简单策略：失败批次丢弃（防止死循环重试）
          return;
        }

        // 200 正常：不需要每次都打印，避免刷屏
        // console.log('upload ok:', res.data);
      },

      fail: (err) => {
        console.error('upload fail:', err);
        // 失败策略：丢弃该批次（避免无限重试阻塞后续）
        // 如果你想重试，可以把 batch 放回队头，但必须限制重试次数
      },

      complete: () => {
        this._uploading = false;
        this._reqTask = null;

        // 如果开关仍开着且队列还有数据，下一次 timer tick 会继续发
      }
    });
  },

  stopUploadPipeline() {
    // 停止定时器
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }

    // 清空待上传缓存
    this._uploadBuf = [];

    // abort 在途请求（止血）
    if (this._reqTask && typeof this._reqTask.abort === 'function') {
      try { this._reqTask.abort(); } catch (e) {}
    }
    this._reqTask = null;

    this._uploading = false;
  },

  /* ================= 蓝牙适配器 / 扫描 / 连接 ================= */

  openBluetoothAdapter() {
    wx.openBluetoothAdapter({
      success: () => {
        this.startBluetoothDevicesDiscovery();
      },
      fail: (res) => {
        if (res.errCode === 10001) {
          wx.onBluetoothAdapterStateChange((state) => {
            if (state.available) this.startBluetoothDevicesDiscovery();
          });
        } else {
          wx.showToast({ title: '蓝牙初始化失败', icon: 'none' });
        }
      }
    });
  },

  startBluetoothDevicesDiscovery() {
    if (this._discoveryStarted) return;
    this._discoveryStarted = true;

    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: true,
      success: () => {
        this.onBluetoothDeviceFound();
      },
      fail: (err) => {
        console.error('startDiscovery fail', err);
        wx.showToast({ title: '搜索设备失败', icon: 'none' });
      }
    });
  },

  stopBluetoothDevicesDiscovery() {
    wx.stopBluetoothDevicesDiscovery({
      complete: () => {
        this._discoveryStarted = false;
      }
    });
  },

  onBluetoothDeviceFound() {
    wx.onBluetoothDeviceFound((res) => {
      res.devices.forEach((device) => {
        if (!device.name && !device.localName) return;

        const foundDevices = this.data.devices;
        const idx = inArray(foundDevices, 'deviceId', device.deviceId);

        const data = {};
        if (idx === -1) {
          data[`devices[${foundDevices.length}]`] = device;
        } else {
          data[`devices[${idx}]`] = device;
        }
        this.setData(data);
      });
    });
  },

  createBLEConnection(e) {
    const { deviceId, name } = e.currentTarget.dataset;

    wx.createBLEConnection({
      deviceId,
      success: () => {
        this.setData({ connected: true, name, deviceId });
        wx.setBLEMTU({ deviceId, mtu: 255 });
        this.getBLEDeviceServices(deviceId);
      },
      fail: (err) => {
        console.error('createBLEConnection fail', err);
        wx.showToast({ title: '连接失败', icon: 'none' });
      }
    });

    this.stopBluetoothDevicesDiscovery();
  },

  closeBLEConnection() {
    if (!this.data.deviceId) return;

    wx.closeBLEConnection({
      deviceId: this.data.deviceId,
      complete: () => {
        this.setData({ connected: false, chs: [], canWrite: false });
        this._deviceId = null;
        this._serviceId = null;
        this._characteristicId = null;
      }
    });
  },

  getBLEDeviceServices(deviceId) {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => {
        for (let s of res.services) {
          if (s.uuid === SERVICE_UUID) {
            this.getBLEDeviceCharacteristics(deviceId, s.uuid);
            return;
          }
        }
        wx.showToast({ title: '未找到指定服务', icon: 'none' });
      },
      fail: (err) => {
        console.error('getBLEDeviceServices fail', err);
      }
    });
  },

  getBLEDeviceCharacteristics(deviceId, serviceId) {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => {
        res.characteristics.forEach((item) => {
          if (item.properties.read) {
            wx.readBLECharacteristicValue({
              deviceId,
              serviceId,
              characteristicId: item.uuid
            });
          }

          if (item.properties.write) {
            this.setData({ canWrite: true });
            this._deviceId = deviceId;
            this._serviceId = deviceId;      
            this._characteristicId = item.uuid;
            this.writeBLECharacteristicValue();
          }

          if (item.properties.notify || item.properties.indicate) {
            wx.notifyBLECharacteristicValueChange({
              deviceId,
              serviceId,
              characteristicId: item.uuid,
              state: true
            });
          }
        });
      },
      fail: (err) => {
        console.error('getBLEDeviceCharacteristics fail', err);
      }
    });
  },

  writeBLECharacteristicValue() {
    if (!this._deviceId || !this._serviceId || !this._characteristicId) return;

    const buffer = new ArrayBuffer(1);
    new DataView(buffer).setUint8(0, 0xff);

    wx.writeBLECharacteristicValue({
      deviceId: this._deviceId,
      serviceId: this._serviceId,
      characteristicId: this._characteristicId,
      value: buffer,
      success: (res) => {
        console.log('writeBLECharacteristicValue success', res);
      },
      fail: (err) => {
        console.error('writeBLECharacteristicValue fail', err);
      }
    });
  },

  closeBluetoothAdapter() {
    wx.closeBluetoothAdapter({
      complete: () => {
        this._discoveryStarted = false;
      }
    });
  }
});
