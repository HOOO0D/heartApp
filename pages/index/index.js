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

// 发送到 Flask
function sendDataToFlask({ val1, val2, val3, val4 }) {
  wx.request({
    url: 'http://10.78.173.85:5000/upload_data',   // 你的 Flask 地址
    method: 'POST',
    header: { 'content-type': 'application/json' },
    data: { val1, val2, val3, val4 },
    success(res) { console.log('Flask 返回:', res.data); },
    fail(err) { console.error('发送失败:', err); },
  });
}

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
    canWrite: false,
  },

  onLoad() {
    if (!app.globalData) app.globalData = {};
    if (!app.globalData.bleValues) app.globalData.bleValues = [];
    // ⭐ 新增：控制是否向 Flask 上传
    if (typeof app.globalData.sendToFlask !== 'boolean') {
      app.globalData.sendToFlask = false;
    }

    this._discoveryStarted = false;

    // ⭐ 全局只注册一次 BLE 通知监听
    if (!this._bleListenerRegistered) {
      wx.onBLECharacteristicValueChange((characteristic) => {
        this.handleBleNotification(characteristic);
      });
      this._bleListenerRegistered = true;
    }
  },

  onUnload() {
    if (this._bleListenerRegistered) {
      try {
        wx.offBLECharacteristicValueChange && wx.offBLECharacteristicValueChange();
      } catch (e) {
        console.warn('offBLECharacteristicValueChange 不支持或出错:', e);
      }
      this._bleListenerRegistered = false;
    }
  },

  // ⭐ 收到 BLE 通知的统一处理函数
  handleBleNotification(characteristic) {
    const hexVal = ab2hex(characteristic.value);

    // 更新 chs（调试用）
    const idx = inArray(this.data.chs, 'uuid', characteristic.characteristicId);
    const chsData = {};
    if (idx === -1) {
      chsData[`chs[${this.data.chs.length}]`] = {
        uuid: characteristic.characteristicId,
        value: hexVal,
      };
    } else {
      chsData[`chs[${idx}]`] = {
        uuid: characteristic.characteristicId,
        value: hexVal,
      };
    }

    const values = parseBLEData(hexVal);
    if (!values || values.length < 4) {
      this.setData(chsData);
      return;
    }

    const [val1, val2, val3, val4] = values;
    const time = new Date().toLocaleTimeString();

    // 更新全局缓存（滑动窗口）
    const buf = app.globalData.bleValues;
    const MAX_LEN = 1000;
    buf.push({ time, val1, val2, val3, val4 });
    if (buf.length > MAX_LEN) buf.splice(0, buf.length - MAX_LEN);

    // 更新 index 页当前显示值 + chs
    this.setData(Object.assign({}, chsData, {
      VALUE1: val1,
      VALUE2: val2,
      VALUE3: val3,
      VALUE4: val4,
    }));

    const record = { time, val1, val2, val3, val4 };

    // 分发给图表页
    if (typeof app.bleChartUpdateHandler === 'function') {
      app.bleChartUpdateHandler(record);
    }

    // 分发给记录页
    if (typeof app.bleRecordHandler === 'function') {
      app.bleRecordHandler(record);
    }

    // ⭐ 只有 detect 页开启采集时，才往 Flask 丢数据
    if (app.globalData.sendToFlask) {
      sendDataToFlask({ val1, val2, val3, val4 });
    }
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
      },
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
      },
    });
  },

  stopBluetoothDevicesDiscovery() {
    wx.stopBluetoothDevicesDiscovery({
      complete: () => {
        this._discoveryStarted = false;
      },
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
      },
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
      },
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
      },
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
              characteristicId: item.uuid,
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
              state: true,
            });
          }
        });
      },
      fail: (err) => {
        console.error('getBLEDeviceCharacteristics fail', err);
      },
    });
    // ⚠️ 不要在这里再注册 onBLECharacteristicValueChange
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
      },
    });
  },

  closeBluetoothAdapter() {
    wx.closeBluetoothAdapter({
      complete: () => {
        this._discoveryStarted = false;
      },
    });
  },
});
