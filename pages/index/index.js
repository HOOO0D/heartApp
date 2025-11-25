// pages/index/index.js
const app = getApp();

// 工具：数组中按 key 查找元素下标
function inArray(arr, key, val) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i][key] === val) {
      return i;
    }
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

// 按 2 字节一组，小端转大端，解析为整数数组
function parseBLEData(hexStr) {
  const values = [];
  const groupSize = 4; // 每组 2 字节 = 4 个 hex 字符
  const totalGroups = Math.floor(hexStr.length / groupSize);

  for (let i = 0; i < totalGroups; i++) {
    const group = hexStr.slice(i * groupSize, (i + 1) * groupSize);
    // 小端转大端：低字节在前 -> 高字节在前
    const val = parseInt(group.slice(2, 4) + group.slice(0, 2), 16);
    values.push(val);
  }

  return values;
}

// 发送数据到 Flask 后端（仍然是每帧一发，你可以以后改成批量）
function sendDataToFlask({ val1, val2, val3, val4 }) {
  wx.request({
    url: 'http://192.168.144.216:5000/upload_data', // ⚠️ 改为你自己的 Flask 地址
    method: 'POST',
    header: {
      'content-type': 'application/json',
    },
    data: {
      val1,
      val2,
      val3,
      val4,
    },
    success(res) {
      console.log('数据已发送，后端返回:', res.data);
    },
    fail(err) {
      console.error('发送失败:', err);
    },
  });
}

// 可以抽成常量，便于以后改
const SERVICE_UUID = '8653000A-43E6-47B7-9CB0-5FC21D4AE340';

Page({
  data: {
    devices: [],
    connected: false,
    chs: [],
    Value_notify: 0,
    VALUE1: 0,
    VALUE2: 0,
    VALUE3: 0,
    VALUE4: 0,
    canWrite: false,
  },

  onLoad() {
    // 初始化全局缓存
    if (!app.globalData.bleValues) {
      app.globalData.bleValues = [];
    }

    // 全局唯一：监听 BLE 通知
    wx.onBLECharacteristicValueChange((characteristic) => {
      this.handleBleNotification(characteristic);
    });

    // 标记，避免重复注册设备发现回调
    this._deviceFoundListenerRegistered = false;
    this._discoveryStarted = false;
  },

  // 统一处理收到的 BLE 通知
  handleBleNotification(characteristic) {
    const hexVal = ab2hex(characteristic.value);

    // 更新 chs 列表（用于调试显示）
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
      // 不够 4 个值就先忽略（也可以在这里做缓冲拼包）
      this.setData(chsData);
      return;
    }

    const [val1, val2, val3, val4] = values;
    const timestamp = new Date().toLocaleTimeString();

    // 更新全局缓存（滑动窗口，最多 100 条）
    const MAX_LEN = 100;
    const buffer = app.globalData.bleValues || [];
    buffer.push({ time: timestamp, val1, val2, val3, val4 });
    if (buffer.length > MAX_LEN) {
      buffer.splice(0, buffer.length - MAX_LEN);
    }
    app.globalData.bleValues = buffer;

    // 更新当前页面显示的 4 个值 + chs
    this.setData(Object.assign({}, chsData, {
      VALUE1: val1,
      VALUE2: val2,
      VALUE3: val3,
      VALUE4: val4,
    }));

    const record = { time: timestamp, val1, val2, val3, val4 };

    // 分发给图表页
    if (typeof app.bleChartUpdateHandler === 'function') {
      app.bleChartUpdateHandler(record);
    }

    // 分发给记录页
    if (typeof app.bleRecordHandler === 'function') {
      app.bleRecordHandler(record);
    }

    // 同步发给 Flask
    sendDataToFlask({ val1, val2, val3, val4 });
  },

  /* ===== 蓝牙适配器相关 ===== */

  openBluetoothAdapter() {
    wx.openBluetoothAdapter({
      success: (res) => {
        console.log('openBluetoothAdapter success', res);
        this.startBluetoothDevicesDiscovery();
      },
      fail: (res) => {
        console.warn('openBluetoothAdapter fail', res);
        if (res.errCode === 10001) {
          // 蓝牙未打开，监听状态变化
          wx.onBluetoothAdapterStateChange((state) => {
            console.log('onBluetoothAdapterStateChange', state);
            if (state.available) {
              this.startBluetoothDevicesDiscovery();
            }
          });
        } else {
          wx.showToast({
            title: '蓝牙初始化失败',
            icon: 'none',
          });
        }
      },
    });
  },

  getBluetoothAdapterState() {
    wx.getBluetoothAdapterState({
      success: (res) => {
        console.log('getBluetoothAdapterState', res);
        if (res.discovering) {
          this.onBluetoothDeviceFound();
        } else if (res.available) {
          this.startBluetoothDevicesDiscovery();
        }
      },
    });
  },

  /* ===== 扫描设备相关 ===== */

  startBluetoothDevicesDiscovery() {
    if (this._discoveryStarted) {
      return;
    }
    this._discoveryStarted = true;

    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: true,
      success: (res) => {
        console.log('startBluetoothDevicesDiscovery success', res);
        this.onBluetoothDeviceFound();
      },
      fail: (err) => {
        console.error('startBluetoothDevicesDiscovery fail', err);
        wx.showToast({
          title: '搜索设备失败',
          icon: 'none',
        });
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

  // 注册设备发现回调（只注册一次）
  onBluetoothDeviceFound() {
    if (this._deviceFoundListenerRegistered) return;
    this._deviceFoundListenerRegistered = true;

    wx.onBluetoothDeviceFound((res) => {
      res.devices.forEach((device) => {
        if (!device.name && !device.localName) {
          return;
        }
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

  /* ===== 连接设备 & 服务/特征 ===== */

  createBLEConnection(e) {
    const ds = e.currentTarget.dataset;
    const deviceId = ds.deviceId;
    const name = ds.name;

    wx.createBLEConnection({
      deviceId,
      success: (res) => {
        console.log('createBLEConnection success', res);
        this.setData({
          connected: true,
          name,
          deviceId,
        });

        // 可选：设置 MTU
        wx.setBLEMTU({
          deviceId,
          mtu: 255,
          success: (mtuRes) => {
            console.log('setBLEMTU success', mtuRes);
          },
          fail: (mtuErr) => {
            console.warn('setBLEMTU fail', mtuErr);
          },
        });

        this.getBLEDeviceServices(deviceId);
      },
      fail: (err) => {
        console.error('createBLEConnection fail', err);
        wx.showToast({
          title: '连接失败',
          icon: 'none',
        });
      },
    });

    this.stopBluetoothDevicesDiscovery();
  },

  closeBLEConnection() {
    if (!this.data.deviceId) return;
    wx.closeBLEConnection({
      deviceId: this.data.deviceId,
      complete: () => {
        this.setData({
          connected: false,
          chs: [],
          canWrite: false,
        });
      },
    });
  },

  getBLEDeviceServices(deviceId) {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => {
        console.log('getBLEDeviceServices', res.services);
        for (let i = 0; i < res.services.length; i++) {
          const service = res.services[i];
          if (service.uuid === SERVICE_UUID) {
            this.getBLEDeviceCharacteristics(deviceId, service.uuid);
            return;
          }
        }
        wx.showToast({
          title: '未找到指定服务',
          icon: 'none',
        });
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
        console.log('getBLEDeviceCharacteristics success', res.characteristics);
        res.characteristics.forEach((item) => {
          // 可读
          if (item.properties.read) {
            wx.readBLECharacteristicValue({
              deviceId,
              serviceId,
              characteristicId: item.uuid,
            });
          }

          // 可写
          if (item.properties.write) {
            this.setData({ canWrite: true });
            this._deviceId = deviceId;
            this._serviceId = deviceId; 
            this._characteristicId = item.uuid;
            this.writeBLECharacteristicValue();
          }

          // 支持 notify / indicate
          if (item.properties.notify || item.properties.indicate) {
            wx.notifyBLECharacteristicValueChange({
              deviceId,
              serviceId,
              characteristicId: item.uuid,
              state: true,
              success: () => {
                console.log('notify 已开启, characteristicId:', item.uuid);
              },
              fail: (err) => {
                console.error('notifyBLECharacteristicValueChange fail', err);
              },
            });
          }
        });
      },
      fail(res) {
        console.error('getBLEDeviceCharacteristics fail', res);
      },
    });

  },

  // 示例：写一个单字节 0xFF 到设备（可作为启动命令）
  writeBLECharacteristicValue() {
    if (!this._deviceId || !this._serviceId || !this._characteristicId) return;

    const buffer = new ArrayBuffer(1);
    const dataView = new DataView(buffer);
    dataView.setUint8(0, 0xff);

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

    console.log('write to', this._serviceId, this._characteristicId, buffer);
  },

  closeBluetoothAdapter() {
    wx.closeBluetoothAdapter({
      complete: () => {
        this._discoveryStarted = false;
        this._deviceFoundListenerRegistered = false;
      },
    });
  },
});
