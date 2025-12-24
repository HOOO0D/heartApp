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

// 解析 BLE 数据：每 2 字节一组，小端转大端 + 转 int16
function parseBLEData(hexStr) {
  const values = [];
  const groupSize = 4;
  const totalGroups = Math.floor(hexStr.length / groupSize);

  for (let i = 0; i < totalGroups; i++) {
    const group = hexStr.slice(i * groupSize, (i + 1) * groupSize);
    let val = parseInt(group.slice(2, 4) + group.slice(0, 2), 16);
    if (val >= 0x8000) val -= 0x10000;  // ✅ 转成 int16
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
    // ✅ 现在 _uploadBuf 存的是 {ts, samples:[...]}（每条=一次notify）
    this._uploadBuf = [];
    this._flushTimer = null;
    this._uploading = false;
    this._reqTask = null;

    // 你可以按网络情况调这些参数
    this._UPLOAD_INTERVAL_MS = 200; // 200ms flush 一次 -> 5次/秒
    this._BATCH_SIZE = 25;          // ✅ 每次最多 25 包（每包16点），更贴近真实速率
    this._MAX_BUF = 2000;           // ✅ 最大缓存（包数），防止网络差时无限堆积

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
    this._statPackets = 0; // ✅ 现在是 notify 包数
    this._statPoints = 0;  // ✅ 点数（sum(samples.length)）
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

    // 单通道：每 2 字节一个采样点（一个包 16 点 -> values.length=16）
    const values = parseBLEData(hexVal);
    if (!values || values.length < 1) return;

    const now = Date.now();

    // ====== 速率统计：按“包/秒”和“点/秒”统计 ======
    this._statPackets += 1;             // 1 次 notify = 1 包
    this._statPoints += values.length;  // 包内采样点数（理想 16 或 8）

    const dt = now - this._statTs;
    if (dt >= 1000) {
      const pps = (this._statPackets * 1000 / dt).toFixed(1); // packets/s
      const sps = (this._statPoints * 1000 / dt).toFixed(1);  // samples/s
      console.log(`[BLE rate] packets/s=${pps}, samples/s=${sps}, valuesLen=${values.length}`);
      this._statTs = now;
      this._statPackets = 0;
      this._statPoints = 0;
    }

    // ====== UI 显示节流：只显示最新一个采样点 ======
    if (now - this._uiLastTs >= this._UI_THROTTLE_MS) {
      this._uiLastTs = now;
      const last = values[values.length - 1];
      this.setData({
        VALUE1: last,
        VALUE2: 0,
        VALUE3: 0,
        VALUE4: 0
      });
    }

    // ====== 给图表页/记录页发 “samples 数组” ======
    const packet = { ts: now, samples: values };

    const buf = app.globalData.bleValues;
    const MAX_LEN = 300;
    buf.push(packet);
    if (buf.length > MAX_LEN) buf.splice(0, buf.length - MAX_LEN);

    if (typeof app.bleChartUpdateHandler === 'function') app.bleChartUpdateHandler(packet);
    if (typeof app.bleRecordHandler === 'function') app.bleRecordHandler(packet);

    // ✅ ✅ ✅ 真·16点/包上传：不再拆 val1..val4
    if (app.globalData.sendToFlask) {
      if (!app.globalData.captureId) return;
      this.enqueueUpload(packet); // packet={ts, samples:[...]}
    } else {
      this.stopUploadPipeline();
    }
  },

  // ================== 上传管道（核心） ==================
  enqueueUpload(packet) {
    this._uploadBuf.push(packet);

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
    if (!app.globalData.sendToFlask) {
      this.stopUploadPipeline();
      return;
    }

    const cid = app.globalData.captureId;
    if (!cid) {
      this.stopUploadPipeline();
      return;
    }

    if (this._uploading) return;
    if (!this._uploadBuf.length) return;

    // 取一批（每条是一个 notify 包）
    const batch = this._uploadBuf.splice(0, this._BATCH_SIZE);

    // ✅ payload 改成 samples 格式（后端已支持）
    const payload = {
      capture_id: cid,
      batch: batch.map(x => ({
        samples: Array.isArray(x.samples) ? x.samples : []
      }))
    };

    this._uploading = true;

    this._reqTask = wx.request({
      url: `${BASE_URL}/upload_data`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: payload,

      success: (res) => {
        if (res.statusCode === 409) {
          this.stopUploadPipeline();
          return;
        }

        if (res.statusCode !== 200) {
          console.warn('upload statusCode:', res.statusCode, res.data);
          return;
        }
      },

      fail: (err) => {
        console.error('upload fail:', err);
      },

      complete: () => {
        this._uploading = false;
        this._reqTask = null;
      }
    });
  },

  stopUploadPipeline() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }

    this._uploadBuf = [];

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
            this._serviceId = deviceId;     // ✅ 修复：这里必须是 serviceId
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