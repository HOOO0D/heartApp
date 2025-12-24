// pages/records/records.js
const app = getApp();

function fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// 把 packet 变成适合列表展示的结构
function normalizePacket(p) {
  if (!p) return null;

  // 兼容旧字段
  const ts = typeof p.ts === 'number' ? p.ts : Date.now();

  // 新结构：samples:[...]
  if (Array.isArray(p.samples)) {
    const samples = p.samples;
    const last = samples.length ? samples[samples.length - 1] : 0;
    const preview = samples.slice(0, 6).join(', ') + (samples.length > 6 ? ' ...' : '');
    return {
      ts,
      timeStr: fmtTime(ts),
      samplesLen: samples.length,
      last,
      preview,
      // 保留原始，方便你点开调试
      samples
    };
  }

  // 旧结构：val1..val4（万一还有旧数据混进来）
  const v1 = p.val1 ?? 0;
  const v2 = p.val2 ?? 0;
  const v3 = p.val3 ?? 0;
  const v4 = p.val4 ?? 0;
  const samples = [v1, v2, v3, v4];
  return {
    ts,
    timeStr: fmtTime(ts),
    samplesLen: samples.length,
    last: v4,
    preview: samples.join(', '),
    samples,
    normalizePacket:false,
  };
}

Page({
  data: {
    records: [], // 每条是 normalize 后的对象
  },

  onShow() {
    // 1) 先把历史读出来（globalData.bleValues 里存的是 packet）
    const buf = (app.globalData && Array.isArray(app.globalData.bleValues))
      ? app.globalData.bleValues
      : [];

    const MAX = 120; // 每条记录现在是一包(16点)，不用放太多
    const tail = buf.length > MAX ? buf.slice(buf.length - MAX) : buf.slice();

    const initRecords = tail
      .map(normalizePacket)
      .filter(Boolean);

    this.setData({ records: initRecords });

    // 2) 注册实时 handler
    this._recordHandler = (packet) => {
      const item = normalizePacket(packet);
      if (!item) return;

      const updated = this.data.records.concat(item);
      if (updated.length > MAX) {
        updated.splice(0, updated.length - MAX);
      }
      this.setData({ records: updated });
    };

    app.bleRecordHandler = this._recordHandler;
  },

  onHide() {
    if (app.bleRecordHandler === this._recordHandler) {
      app.bleRecordHandler = null;
    }
  },

  onUnload() {
    if (app.bleRecordHandler === this._recordHandler) {
      app.bleRecordHandler = null;
    }
  },

  clearRecords() {
    this.setData({ records: [] });
    if (app.globalData) app.globalData.bleValues = [];
  },
  toggleExpand(e) {
    const idx = e.currentTarget.dataset.index;
    const list = this.data.records.slice();
    if (!list[idx]) return;
    list[idx].expanded = !list[idx].expanded;
    this.setData({ records: list });
  },
});
