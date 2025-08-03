// pages/index/index.js
const app = getApp()

function inArray(arr, key, val) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i][key] === val) {
      return i;
    }
  }
  return -1;
}
function parseBLEData(hexStr) {
  const values = []
  const groupSize = 4 // 每组2字节 = 4个十六进制字符
  const totalGroups = Math.floor(hexStr.length / groupSize)

  for (let i = 0; i < totalGroups; i++) {
    const group = hexStr.slice(i * groupSize, (i + 1) * groupSize)
    const val = parseInt(group.slice(2, 4) + group.slice(0, 2), 16)
    values.push(val)
  }

  return values // 例如 [737, 58, 13, 5]
}
// ArrayBuffer转16进度字符串示例
function ab2hex(buffer) {
  var hexArr = Array.prototype.map.call(
    new Uint8Array(buffer),
    function (bit) {
      return ('00' + bit.toString(16)).slice(-2)
    }
  )
  return hexArr.join('');
}

Page({
  data: {
    devices: [],
    connected: false,
    chs: [],
    Value_notify : 0,
    VALUE1 :0,
    VALUE2 :0,
    VALUE3 :0,
    VALUE4 :0
  },
  openBluetoothAdapter() {
    wx.openBluetoothAdapter({
      success: (res) => {
        console.log('openBluetoothAdapter success', res)
        this.startBluetoothDevicesDiscovery()
      },
      fail: (res) => {
        if (res.errCode === 10001) {
          wx.onBluetoothAdapterStateChange(function (res) {
            console.log('onBluetoothAdapterStateChange', res)
            if (res.available) {
              this.startBluetoothDevicesDiscovery()
            }
          })
        }
      }
    })
  },
  getBluetoothAdapterState() {
    wx.getBluetoothAdapterState({
      success: (res) => {
        console.log('getBluetoothAdapterState', res)
        if (res.discovering) {
          this.onBluetoothDeviceFound()
        } else if (res.available) {
          this.startBluetoothDevicesDiscovery()
        }
      }
    })
  },
  startBluetoothDevicesDiscovery() {
    if (this._discoveryStarted) {
      return
    }
    this._discoveryStarted = true
    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: true,
      success: (res) => {
        console.log('startBluetoothDevicesDiscovery success', res)
        this.onBluetoothDeviceFound()
      },
    })
  },
  stopBluetoothDevicesDiscovery() {
    wx.stopBluetoothDevicesDiscovery()
  },
  onBluetoothDeviceFound() {
    wx.onBluetoothDeviceFound((res) => {
      res.devices.forEach(device => {
        if (!device.name && !device.localName) {
          return
        }
        const foundDevices = this.data.devices
        const idx = inArray(foundDevices, 'deviceId', device.deviceId)
        const data = {}
        if (idx === -1) {
          data[`devices[${foundDevices.length}]`] = device
        } else {
          data[`devices[${idx}]`] = device
        }
        this.setData(data)
      })
    })
  },
  createBLEConnection(e) {
    const ds = e.currentTarget.dataset
    const deviceId = ds.deviceId
    const name = ds.name
    wx.createBLEConnection({
      deviceId,
      success: (res) => {
        this.setData({
          connected: true,
          name,
          deviceId,
        })
        this.getBLEDeviceServices(deviceId)
        wx.setBLEMTU({
          deviceId,
          mtu: 255,
        })
      }
    
    })
    this.stopBluetoothDevicesDiscovery()
  },
  closeBLEConnection() {
    wx.closeBLEConnection({
      deviceId: this.data.deviceId
    })
    this.setData({
      connected: false,
      chs: [],
      canWrite: false,
    })
  },
  getBLEDeviceServices(deviceId) {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => {
        for (let i = 0; i < res.services.length; i++) {
          if (res.services[i].uuid=="8653000A-43E6-47B7-9CB0-5FC21D4AE340")
           {
            this.getBLEDeviceCharacteristics(deviceId, res.services[i].uuid)
            return
          }//if(res.services[i].uuid == "86530A00-43E6-47B7-9CB0-5FC21D4AE340")
        }
      }
    })
  },
  getBLEDeviceCharacteristics(deviceId, serviceId) {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => {
        console.log('getBLEDeviceCharacteristics success', res.characteristics)
        for (let i = 0; i < res.characteristics.length; i++) {
          let item = res.characteristics[i]
          if (item.properties.read) {
            wx.readBLECharacteristicValue({
              deviceId,
              serviceId,
              characteristicId: item.uuid,
            })
          }
          if (item.properties.write) {
            this.setData({
              canWrite: true
              
            })
            this._deviceId = deviceId
            this._serviceId = deviceId
            this._characteristicId = item.uuid
            this.writeBLECharacteristicValue()
          }
          if (item.properties.notify || item.properties.indicate) {
            wx.notifyBLECharacteristicValueChange({
              deviceId,
              serviceId,
              characteristicId: item.uuid,
              state: true,
              success:(res)=>{
                console.log("notify已OK UUID：")
                console.log(this._characteristicId)
                //this.Value_notify= characteristic.value
              }
            })
          }
        }
      },
      fail(res) {
        console.error('getBLEDeviceCharacteristics', res)
      }
    })
    // 操作之前先监听，保证第一时间获取数据
    wx.onBLECharacteristicValueChange((characteristic) => {
      const idx = inArray(this.data.chs, 'uuid', characteristic.characteristicId)
      const data = {}
      if (idx === -1) {
        data[`chs[${this.data.chs.length}]`] = {
          uuid: characteristic.characteristicId,
          value: ab2hex(characteristic.value)
        }
      } else {
        data[`chs[${idx}]`] = {
          uuid: characteristic.characteristicId,
          value: ab2hex(characteristic.value)
        }
      }
      this.setData(data);
      //提取差值
      const hexVal = ab2hex(characteristic.value);
      if (!app.globalData.bleValues) app.globalData.bleValues = [];
      
      if (app.globalData.bleValues.length > 4) {
        app.globalData.bleValues.shift();
      }
      /*function hexStrDiff(hexStr) {
        if (hexStr.length < 8) return null;
        const part1 = hexStr.slice(0, 4); // 前4位（小端）
        const part2 = hexStr.slice(4, 8); // 后4位（小端）
        const val1 = parseInt(part1.slice(2, 4) + part1.slice(0, 2), 16);
        const val2 = parseInt(part2.slice(2, 4) + part2.slice(0, 2), 16);
        //app.globalData.bleValues.push(val1-val2);
        return {
          val1,
          val2,
          diff: val1 - val2
        };
      }*/
      const values = parseBLEData(hexVal);
	  if (values.length >= 4) {
		const [val1, val2, val3, val4] = values;
	
		// 设置本地页面数据
		data.VALUE1 = val1;
		data.VALUE2 = val2;
		data.VALUE3 = val3;
		data.VALUE4 = val4;
	
		const timestamp = new Date().toLocaleTimeString();
	
		if (!app.globalData.bleValues) app.globalData.bleValues = [];
		if (app.globalData.bleValues.length > 100) {
		  app.globalData.bleValues.shift();
		}
	
		app.globalData.bleValues.push({
		  time: timestamp,
		  val1,
		  val2,
		  val3,
		  val4
		});
	
		if (typeof app.bleChartUpdateHandler === 'function') {
		  app.bleChartUpdateHandler({
			time: timestamp,
			val1,
			val2,
			val3,
			val4,
		  });
		}
	  }
	  this.setData(data);
	})
  },
  writeBLECharacteristicValue() {
    // 向蓝牙设备发送一个0x00的16进制数据
    let buffer = new ArrayBuffer(1)
    let dataView = new DataView(buffer)
    dataView.setUint8(0,255)
    wx.writeBLECharacteristicValue({
      deviceId: this._deviceId,
      serviceId: this._serviceId,
      characteristicId: this._characteristicId,
      value: buffer,
      success:(res)=>{
        console.log("OK_W")
      },
    })
    console.log(this._serviceId)
    //console.log(this._deviceId)
    console.log(this._characteristicId)
    console.log(buffer)
  },
  closeBluetoothAdapter() {
    wx.closeBluetoothAdapter()
    this._discoveryStarted = false
  },

})
