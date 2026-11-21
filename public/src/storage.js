/**
 * storage.js — 情绪账本数据层（Capacitor 原生 Preferences / localStorage 双后端）
 *
 * - 原生 App：用 @capacitor/preferences 持久化到手机本地（Android=SharedPreferences）
 * - 浏览器/桌面预览：自动回退 localStorage
 * - 纯离线：不依赖任何服务器、不发任何网络请求
 *
 * 用法：先 await MoodStorage.init() 载入内存，之后所有方法同步调用。
 */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'mood_ledger_state_v1';

  // ---- 情绪清单（删"一般"，保留其余，新增用户 24 种）----
  // category: positive / neutral / negative —— 用于统计分类
  const MOODS = [
    // 积极
    { name: '开心',   emoji: '😄',  category: 'positive' },
    { name: '满足',   emoji: '😌',  category: 'positive' },
    { name: '轻松',   emoji: '🍃',  category: 'positive' },
    { name: '兴奋',   emoji: '🤩',  category: 'positive' },
    { name: '平静',   emoji: '😊',  category: 'positive' },
    { name: '感激',   emoji: '🥰',  category: 'positive' },
    { name: '自豪',   emoji: '😎',  category: 'positive' },
    { name: '期待',   emoji: '🥳',  category: 'positive' },
    { name: '温暖',   emoji: '☀️',  category: 'positive' },
    { name: '幸福',   emoji: '🥹',  category: 'positive' },
    { name: '释然',   emoji: '🕊️',  category: 'positive' },
    { name: '振奋',   emoji: '💪',  category: 'positive' },
    { name: '好奇',   emoji: '🤔',  category: 'positive' },
    { name: '欣慰',   emoji: '😊',  category: 'positive' },
    { name: '羡慕',   emoji: '😍',  category: 'positive' },
    { name: '心动',   emoji: '💗',  category: 'positive' },
    { name: '眷恋',   emoji: '💞',  category: 'positive' },
    // 中性
    { name: '困惑',   emoji: '😕',  category: 'neutral' },
    { name: '惊讶',   emoji: '😲',  category: 'neutral' },
    { name: '吃惊',   emoji: '😳',  category: 'neutral' },
    { name: '纠结',   emoji: '😵‍💫', category: 'neutral' },
    { name: '麻木',   emoji: '😑',  category: 'neutral' },
    { name: '羞涩',   emoji: '😳',  category: 'neutral' },
    // 消极
    { name: '难过',   emoji: '😢',  category: 'negative' },
    { name: '委屈',   emoji: '🥺',  category: 'negative' },
    { name: '焦虑',   emoji: '😰',  category: 'negative' },
    { name: '生气',   emoji: '😠',  category: 'negative' },
    { name: '疲惫',   emoji: '😮‍💨', category: 'negative' },
    { name: '失落',   emoji: '😔',  category: 'negative' },
    { name: '孤独',   emoji: '🥲',  category: 'negative' },
    { name: '烦躁',   emoji: '😤',  category: 'negative' },
    { name: '压力大', emoji: '😖',  category: 'negative' },
    { name: '沮丧',   emoji: '😞',  category: 'negative' },
    { name: '害怕',   emoji: '😱',  category: 'negative' },
    { name: '紧张',   emoji: '😬',  category: 'negative' },
    { name: '不安',   emoji: '😟',  category: 'negative' },
    { name: '反感',   emoji: '😒',  category: 'negative' },
    { name: '嫌弃',   emoji: '🤢',  category: 'negative' },
    { name: '愧疚',   emoji: '😣',  category: 'negative' },
    { name: '尴尬',   emoji: '😅',  category: 'negative' },
    { name: '无措',   emoji: '😵',  category: 'negative' },
    { name: '无奈',   emoji: '😮‍💨', category: 'negative' },
    { name: '煎熬',   emoji: '😫',  category: 'negative' },
    { name: '挫败',   emoji: '😩',  category: 'negative' },
    { name: '惋惜',   emoji: '😥',  category: 'negative' },
    { name: '憋屈',   emoji: '😤',  category: 'negative' },
    { name: '迷茫',   emoji: '😵‍💫', category: 'negative' },
    { name: '别扭',   emoji: '😒',  category: 'negative' },
    { name: '不情愿', emoji: '🙅',  category: 'negative' },
    { name: '不舍',   emoji: '💔',  category: 'negative' }
  ];

  const CATEGORIES = [
    { key: 'positive', label: '积极', color: '#c98a3c' },
    { key: 'neutral',  label: '中性', color: '#9b8b76' },
    { key: 'negative', label: '消极', color: '#a4634f' }
  ];

  // ---- 日常打卡项（经期 + 生活习惯）----
  // kind:'range' 表示有开始/结束时间、按区间着色（经期）；其余按单日记录着色。
  // 配色经感知色差(ΔE*76)优化：任意两项最小色差 >=24，避免日历小圆点撞色
  const TRACKERS = [
    { key: 'period',   name: '经期',       emoji: '🌸', color: '#e8648c', kind: 'range' }, // 玫红
    { key: 'wash',     name: '洗头',       emoji: '🚿', color: '#3f7fd1' }, // 深蓝
    { key: 'exercise', name: '运动',       emoji: '🏃', color: '#4caf50' }, // 绿
    { key: 's',        name: 's',          emoji: '🔤', color: '#455a64' }, // 蓝灰(中性)
    { key: 'water',    name: '喝水',       emoji: '💧', color: '#00acc1' }, // 青
    { key: 'poop',     name: '排便',       emoji: '🌾', color: '#a1662e' }, // 棕橙
    { key: 'pee',      name: '排尿',       emoji: '🚽', color: '#e0b400' }, // 金黄
    { key: 'drink',    name: '饮料',       emoji: '🥤', color: '#e65100' }, // 橙
    { key: 'call',     name: '给家里打电话', emoji: '📞', color: '#6d4c9f' }, // 紫
    { key: 'message',  name: '给家里发信息', emoji: '💬', color: '#795548' }, // 深棕
    { key: 'talk',     name: '必要沟通',     emoji: '🗣️', color: '#00796b' }, // 深青绿
    { key: 'shopping', name: '网购',         emoji: '🛒', color: '#7b1fa2' }, // 深紫
    { key: 'jiang_l',  name: '蒋洗衣液',     emoji: '🧴', color: '#afb42b' }, // 黄绿
    { key: 'xu_l',     name: '徐洗衣液',     emoji: '🫧', color: '#880e4f' }, // 深玫红
    { key: 'wo_l',     name: '我洗衣液',     emoji: '🧺', color: '#b71c1c' }  // 深红
  ];

  function isNativePlatform() {
    const C = root.Capacitor;
    if (!C) return false;
    if (typeof C.isNativePlatform === 'function') return C.isNativePlatform();
    if (C.Plugins && C.Plugins.Preferences) return true;
    return false;
  }
  const NATIVE = isNativePlatform();

  function emptyState() {
    return { records: [], favorites: [], trackerLogs: [] };
  }

  function readRaw() {
    if (NATIVE) {
      const P = root.Capacitor.Plugins.Preferences;
      return P.get({ key: STORAGE_KEY }).then(function (r) {
        return (r && r.value) ? JSON.parse(r.value) : null;
      });
    }
    const raw = root.localStorage.getItem(STORAGE_KEY);
    return Promise.resolve(raw ? JSON.parse(raw) : null);
  }

  function writeRaw(json) {
    if (NATIVE) {
      const P = root.Capacitor.Plugins.Preferences;
      return P.set({ key: STORAGE_KEY, value: json });
    }
    root.localStorage.setItem(STORAGE_KEY, json);
    return Promise.resolve();
  }

  let state = null;
  let seq = 1;
  let tseq = 1;
  let pendingSave = null;

  function persist() {
    if (!state) return;
    const json = JSON.stringify(state);
    if (NATIVE) {
      // 原生异步写入，防抖避免频繁落盘
      if (pendingSave) clearTimeout(pendingSave);
      pendingSave = setTimeout(function () {
        root.Capacitor.Plugins.Preferences.set({ key: STORAGE_KEY, value: json }).catch(function () {});
        pendingSave = null;
      }, 120);
    } else {
      root.localStorage.setItem(STORAGE_KEY, json);
    }
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // datetime-local 输入框值是 "YYYY-MM-DDTHH:mm"，内部存储是 "YYYY-MM-DD HH:mm"
  function toLocalInput(dt) {
    return String(dt || '').replace(' ', 'T').slice(0, 16);
  }
  function fromLocalInput(v) {
    return v ? String(v).replace('T', ' ') : '';
  }
  function validStored(dt) {
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dt || '');
  }

  // 本地时间（非 UTC）：YYYY-MM-DD HH:mm
  function formatNow(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function splitDateTime(dt) {
    const parts = String(dt || '').split(' ');
    return {
      date: parts[0] || '',
      time: (parts[1] || '').slice(0, 5)
    };
  }
  function moodInfo(name) {
    return MOODS.find(function (m) { return m.name === name; }) || null;
  }

  // ---- 时间范围辅助 ----
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isoWeek(date) {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return d.getFullYear() + '-W' + (week < 10 ? '0' + week : '' + week);
  }
  // 'YYYY-Www' -> [周一 00:00:00, 周日 23:59:59]
  function weekDates(value) {
    const m = String(value).match(/^(\d{4})-W(\d{1,2})$/);
    if (!m) return [new Date(0), new Date(0)];
    const year = +m[1], week = +m[2];
    const jan4 = new Date(year, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7;
    const monday = new Date(year, 0, 4 - jan4Day + (week - 1) * 7, 0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return [monday, sunday];
  }

  function sanitizeMedia(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(function (m) { return m && m.id && (m.type === 'image' || m.type === 'video'); })
      .map(function (m) {
        return { id: String(m.id), type: m.type, ext: String(m.ext || (m.type === 'video' ? 'mp4' : 'jpg')) };
      });
  }

  function normRecord(r) {
    const info = moodInfo(r && r.mood);
    const dt = formatNowForStored(r);
    const sp = splitDateTime(dt);
    return {
      id: Number(r.id) || 0,
      mood: info ? info.name : String((r && r.mood) || '开心'),
      emoji: info ? info.emoji : ((r && r.emoji) || '🙂'),
      category: info ? info.category : ((r && r.category) || 'neutral'),
      desc: String((r && r.desc) || '').slice(0, 500),
      datetime: dt,
      date: sp.date,
      time: sp.time,
      media: sanitizeMedia(r.media)
    };
  }
  function formatNowForStored(r) {
    if (r && r.datetime && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.datetime)) return r.datetime;
    if (r && r.date && r.time) return r.date + ' ' + String(r.time).slice(0, 5);
    return formatNow();
  }

  // ---- 日常打卡记录 ----
  // 结构：{ id, key, start:'YYYY-MM-DD HH:mm', end:'YYYY-MM-DD HH:mm'(可空), note }
  // 经期(key=period)用 start~end 区间；结束为空表示"进行中"，着色到今天。
  function trackerDef(key) {
    return TRACKERS.find(function (t) { return t.key === key; }) || null;
  }
  function validDT(dt) {
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dt || '');
  }
  function normTrackerLog(l) {
    const key = String((l && l.key) || '');
    if (!trackerDef(key)) return null;
    const start = validDT(l.start) ? l.start : formatNow();
    let end = validDT(l.end) ? l.end : '';
    // 结束早于开始时视为无效，清空（进行中）
    if (end && end < start) end = '';
    return {
      id: Number(l.id) || 0,
      key: key,
      start: start,
      end: end,
      note: String((l && l.note) || '').slice(0, 200)
    };
  }
  function dtDate(dt) { return String(dt || '').slice(0, 10); }
  // 某条打卡是否落在指定日期 YYYY-MM-DD
  function trackerOnDate(l, date) {
    if (!l || !date) return false;
    const def = trackerDef(l.key);
    if (!def) return false;
    if (def.kind === 'range') {
      const s = dtDate(l.start);
      const e = l.end ? dtDate(l.end) : formatNow().slice(0, 10); // 进行中着色到今天
      return date >= s && date <= e;
    }
    return dtDate(l.start) === date;
  }

  const Storage = {
    MOODS: MOODS,
    CATEGORIES: CATEGORIES,
    moodInfo: moodInfo,
    formatNow: formatNow,
    toLocalInput: toLocalInput,
    fromLocalInput: fromLocalInput,

    init: function () {
      return readRaw().then(function (raw) {
        state = raw && Array.isArray(raw.records)
          ? {
              records: raw.records.map(normRecord),
              favorites: Array.isArray(raw.favorites)
                ? raw.favorites.map(function (f) { var n = normRecord(f); n.favId = f.favId || ('f' + (f.id || 0)); return n; })
                : [],
              trackerLogs: Array.isArray(raw.trackerLogs)
                ? raw.trackerLogs.map(normTrackerLog).filter(Boolean)
                : []
            }
          : emptyState();
        seq = state.records.reduce(function (m, r) { return Math.max(m, r.id || 0); }, 0) + 1;
        tseq = state.trackerLogs.reduce(function (m, l) { return Math.max(m, l.id || 0); }, 0) + 1;
        return state;
      });
    },

    getRecords: function () {
      // 按时间倒序（最新在前）
      return (state && state.records)
        ? state.records.slice().sort(function (a, b) {
            return a.datetime < b.datetime ? 1 : (a.datetime > b.datetime ? -1 : b.id - a.id);
          })
        : [];
    },

    addRecord: function (input) {
      if (!state) return { ok: false, error: '存储未初始化' };
      const mood = String((input && input.mood) || '').trim();
      if (!mood) return { ok: false, error: '请选择情绪' };
      // 默认用保存那一刻的本地时间；若调用方传了合法时间（自选时间）则用传入值
      const dt = (input && validStored(input.datetime)) ? input.datetime : formatNow();
      const sp = splitDateTime(dt);
      const info = moodInfo(mood);
      const rec = normRecord({
        id: seq++,
        mood: mood,
        emoji: info ? info.emoji : '🙂',
        category: info ? info.category : 'neutral',
        desc: String((input && input.desc) || '').trim().slice(0, 500),
        datetime: dt,
        media: (input && input.media) || []
      });
      state.records.push(rec);
      persist();
      return { ok: true, record: rec };
    },

    updateRecord: function (id, patch) {
      if (!state) return { ok: false, error: '存储未初始化' };
      const rec = state.records.find(function (r) { return r.id === Number(id); });
      if (!rec) return { ok: false, error: '记录不存在' };
      if (patch && patch.mood) {
        const info = moodInfo(patch.mood);
        rec.mood = info ? info.name : String(patch.mood);
        rec.emoji = info ? info.emoji : rec.emoji;
        rec.category = info ? info.category : rec.category;
      }
      if (patch && patch.desc !== undefined) rec.desc = String(patch.desc).trim().slice(0, 500);
      if (patch && patch.media !== undefined) rec.media = sanitizeMedia(patch.media);
      // 时间允许手动改：优先完整日期时间 datetime（YYYY-MM-DD HH:mm），否则仅改时分（日期不变）
      if (patch && validStored(patch.datetime)) {
        rec.datetime = patch.datetime;
        const sp = splitDateTime(patch.datetime);
        rec.date = sp.date;
        rec.time = sp.time;
      } else if (patch && patch.time && /^\d{2}:\d{2}$/.test(patch.time)) {
        rec.time = patch.time;
        rec.datetime = rec.date + ' ' + patch.time;
      }
      persist();
      return { ok: true, record: rec };
    },

    deleteRecord: function (id) {
      if (!state) return { ok: false };
      const before = state.records.length;
      state.records = state.records.filter(function (r) { return r.id !== Number(id); });
      persist();
      return { ok: true, deleted: before - state.records.length };
    },

    // 按日期分组（日期倒序），用于记录页
    groupByDate: function () {
      const groups = [];
      this.getRecords().forEach(function (r) {
        let g = groups.find(function (x) { return x.date === r.date; });
        if (!g) { g = { date: r.date, items: [] }; groups.push(g); }
        g.items.push(r);
      });
      return groups;
    },

    // 按情绪聚合统计（数量 + 占比），按数量降序；可传 records 做范围统计
    statsByMood: function (records) {
      const list = records || (state && state.records) || [];
      const counts = {};
      list.forEach(function (r) {
        counts[r.mood] = (counts[r.mood] || 0) + 1;
      });
      const total = list.length;
      return Object.keys(counts).map(function (name) {
        const info = moodInfo(name);
        const cnt = counts[name];
        return {
          mood: name,
          emoji: info ? info.emoji : '🙂',
          category: info ? info.category : 'neutral',
          count: cnt,
          pct: total ? Math.round((cnt / total) * 1000) / 10 : 0
        };
      }).sort(function (a, b) { return b.count - a.count || a.mood.localeCompare(b.mood); });
    },

    // 某情绪的明细（按日期分组）
    recordsByMood: function (mood) {
      const groups = [];
      this.getRecords().filter(function (r) { return r.mood === mood; }).forEach(function (r) {
        let g = groups.find(function (x) { return x.date === r.date; });
        if (!g) { g = { date: r.date, items: [] }; groups.push(g); }
        g.items.push(r);
      });
      return groups;
    },

    // ---- 时间范围 ----
    isoWeek: function (date) {
      return isoWeek(date instanceof Date ? date : new Date());
    },
    // 按 日/周/月/年 过滤记录
    filterByRange: function (type, value) {
      const all = this.getRecords();
      if (!type || !value) return all;
      return all.filter(function (r) {
        const day = r.datetime.slice(0, 10);
        if (type === 'day') return day === value;
        if (type === 'month') return day.slice(0, 7) === value;
        if (type === 'year') return day.slice(0, 4) === value;
        if (type === 'week') {
          const wd = weekDates(value);
          const rd = new Date(day + 'T00:00:00');
          return rd >= wd[0] && rd <= wd[1];
        }
        return true;
      });
    },
    todayRecords: function () {
      return this.filterByRange('day', formatNow().slice(0, 10));
    },
    // 生成一句小结 + 主导情绪信息
    summary: function (records, rangeLabelText) {
      const list = records || [];
      const colorMap = { positive: '#c98a3c', neutral: '#9b8b76', negative: '#a4634f' };
      if (!list.length) {
        return { has: false, text: (rangeLabelText ? rangeLabelText + ' ' : '') + '还没有记录', color: '#c9a26c' };
      }
      const cat = { positive: 0, neutral: 0, negative: 0 };
      list.forEach(function (r) { cat[r.category] = (cat[r.category] || 0) + 1; });
      const total = list.length;
      const dom = (cat.positive >= cat.negative && cat.positive >= cat.neutral) ? 'positive'
        : (cat.negative >= cat.positive && cat.negative >= cat.neutral) ? 'negative' : 'neutral';
      const counts = {};
      list.forEach(function (r) { counts[r.mood] = (counts[r.mood] || 0) + 1; });
      let topMood = null, topCnt = 0;
      Object.keys(counts).forEach(function (m) { if (counts[m] > topCnt) { topCnt = counts[m]; topMood = m; } });
      const info = moodInfo(topMood);
      const word = { positive: '整体偏向积极', neutral: '整体比较平稳', negative: '整体略显低落' };
      const text = '共 ' + total + ' 条，' + word[dom] + '，最常出现的是「' + topMood + '」';
      return {
        has: true, text: text, dominant: dom, color: colorMap[dom],
        topMood: topMood, topEmoji: info ? info.emoji : '🙂',
        counts: cat, total: total
      };
    },
    rangeLabel: function (type, value) {
      if (type === 'day') return value;
      if (type === 'week') { const w = weekDates(value); return fmtDate(w[0]) + ' ~ ' + fmtDate(w[1]); }
      if (type === 'month') return value;
      if (type === 'year') return value + ' 年';
      return '全部';
    },

    // ---- 收藏（拷贝副本，原记录保留）----
    getFavorites: function () {
      return (state && state.favorites)
        ? state.favorites.slice().sort(function (a, b) {
            return a.datetime < b.datetime ? 1 : (a.datetime > b.datetime ? -1 : 0);
          })
        : [];
    },
    isFavorited: function (id) {
      return !!(state && state.favorites && state.favorites.some(function (f) { return f.id === Number(id); }));
    },

    // 某个媒体引用是否还被任意记录或收藏引用（删除记录时用于判断是否能清理文件）
    isMediaUsed: function (refId) {
      if (!state || !refId) return false;
      function hit(list) {
        return list.some(function (r) {
          return Array.isArray(r.media) && r.media.some(function (m) { return m.id === refId; });
        });
      }
      return hit(state.records) || hit(state.favorites);
    },
    addFavorite: function (id) {
      if (!state) return { ok: false, error: '存储未初始化' };
      var rec = state.records.find(function (r) { return r.id === Number(id); });
      if (!rec) return { ok: false, error: '记录不存在' };
      if (this.isFavorited(id)) return { ok: true, existed: true };
      var copy = normRecord(rec);
      copy.favId = 'f' + (seq++);
      state.favorites.push(copy);
      persist();
      return { ok: true };
    },
    removeFavorite: function (id) {
      if (!state || !state.favorites) return { ok: false };
      var before = state.favorites.length;
      state.favorites = state.favorites.filter(function (f) { return f.id !== Number(id); });
      persist();
      return { ok: true, removed: before - state.favorites.length };
    },

    // ---- 那年今日（同月同日，往年）----
    onThisDay: function (md) {
      var groups = [];
      (state && state.records ? state.records : []).forEach(function (r) {
        if (r.date.slice(5) === md) {
          var y = r.date.slice(0, 4);
          var g = groups.find(function (x) { return x.year === y; });
          if (!g) { g = { year: y, items: [] }; groups.push(g); }
          g.items.push(r);
        }
      });
      groups.sort(function (a, b) { return a.year < b.year ? 1 : -1; });
      return groups;
    },

    // ---- 日常打卡 ----
    TRACKERS: TRACKERS,
    trackerDef: trackerDef,
    getTrackerLogs: function () { return (state && state.trackerLogs) ? state.trackerLogs.slice() : []; },
    addTrackerLog: function (input) {
      if (!state) return { ok: false, error: '存储未初始化' };
      const key = String((input && input.key) || '');
      if (!trackerDef(key)) return { ok: false, error: '未知的打卡类型' };
      const log = normTrackerLog({
        id: tseq++, key: key,
        start: (input && validDT(input.start)) ? input.start : formatNow(),
        end: (input && input.end) || '',
        note: (input && input.note) || ''
      });
      if (!state.trackerLogs) state.trackerLogs = [];
      state.trackerLogs.push(log);
      persist();
      return { ok: true, log: log };
    },
    updateTrackerLog: function (id, patch) {
      if (!state || !state.trackerLogs) return { ok: false, error: '存储未初始化' };
      const log = state.trackerLogs.find(function (l) { return l.id === Number(id); });
      if (!log) return { ok: false, error: '记录不存在' };
      if (patch && validDT(patch.start)) log.start = patch.start;
      if (patch && patch.end !== undefined) log.end = validDT(patch.end) ? patch.end : '';
      if (log.end && log.end < log.start) log.end = '';
      if (patch && patch.note !== undefined) log.note = String(patch.note).slice(0, 200);
      persist();
      return { ok: true, log: log };
    },
    deleteTrackerLog: function (id) {
      if (!state || !state.trackerLogs) return { ok: false };
      const before = state.trackerLogs.length;
      state.trackerLogs = state.trackerLogs.filter(function (l) { return l.id !== Number(id); });
      persist();
      return { ok: true, deleted: before - state.trackerLogs.length };
    },
    // 指定日期有记录的类型 key 列表（按 TRACKERS 顺序）
    trackersOnDate: function (date) {
      const logs = (state && state.trackerLogs) ? state.trackerLogs : [];
      return TRACKERS.filter(function (t) {
        return logs.some(function (l) { return l.key === t.key && trackerOnDate(l, date); });
      }).map(function (t) { return t.key; });
    },
    // 某类型的所有记录（倒序）；某日期+类型的记录
    logsByKey: function (key) {
      const logs = (state && state.trackerLogs) ? state.trackerLogs : [];
      return logs.filter(function (l) { return l.key === key; })
        .slice().sort(function (a, b) { return a.start < b.start ? 1 : (a.start > b.start ? -1 : b.id - a.id); });
    },
    logsOnDate: function (date) {
      const logs = (state && state.trackerLogs) ? state.trackerLogs : [];
      return logs.filter(function (l) { return trackerOnDate(l, date); })
        .slice().sort(function (a, b) { return a.start < b.start ? 1 : (a.start > b.start ? -1 : b.id - a.id); });
    },

    // ---- 导出 Markdown 日记 ----
    exportMarkdown: function () {
      var groups = this.groupByDate();
      if (!groups.length) return '# 情绪账本日记\n\n（还没有任何记录）\n';
      var lines = ['# 情绪账本日记', '', '_导出时间：' + new Date().toLocaleString() + '_', ''];
      groups.forEach(function (g) {
        lines.push('## ' + g.date);
        g.items.forEach(function (r) {
          var line = '- ' + r.time + ' ' + r.emoji + ' **' + r.mood + '**';
          if (r.desc) line += '：' + r.desc;
          lines.push(line);
        });
        lines.push('');
      });
      return lines.join('\n');
    },

    exportData: function () {
      return JSON.stringify({
        app: 'mood-ledger',
        version: 1,
        exportedAt: new Date().toISOString(),
        state: JSON.parse(JSON.stringify(state || emptyState()))
      }, null, 2);
    },
    exportTrackerMarkdown: function () {
      var logs = (state && state.trackerLogs) ? state.trackerLogs.slice() : [];
      if (!logs.length) return '# 日常打卡记录\n\n（还没有任何打卡）\n';
      logs.sort(function (a, b) { return a.start < b.start ? 1 : (a.start > b.start ? -1 : b.id - a.id); });
      var byDate = {};
      logs.forEach(function (l) {
        var d = dtDate(l.start);
        (byDate[d] = byDate[d] || []).push(l);
      });
      var lines = ['# 日常打卡记录', '', '_导出时间：' + new Date().toLocaleString() + '_', ''];
      Object.keys(byDate).sort().reverse().forEach(function (d) {
        lines.push('## ' + d);
        byDate[d].forEach(function (l) {
          var def = trackerDef(l.key);
          var name = def ? (def.emoji + ' ' + def.name) : l.key;
          var line = '- ' + l.start.slice(11) + ' ' + name;
          if (l.key === 'period') line += '（开始' + l.start.slice(11) + (l.end ? ' ~ 结束 ' + l.end.slice(5) : ' · 进行中') + '）';
          if (l.note) line += '：' + l.note;
          lines.push(line);
        });
        lines.push('');
      });
      return lines.join('\n');
    },

    importData: function (jsonString) {
      if (typeof jsonString !== 'string' || !jsonString.trim()) return { ok: false, error: '内容为空' };
      let parsed;
      try { parsed = JSON.parse(jsonString); }
      catch (e) { return { ok: false, error: '不是有效的 JSON' }; }
      const incoming = (parsed && parsed.state) ? parsed.state : parsed;
      if (!incoming || !Array.isArray(incoming.records)) return { ok: false, error: '备份格式不正确' };
      state = {
        records: incoming.records.map(normRecord),
        favorites: Array.isArray(incoming.favorites)
          ? incoming.favorites.map(function (f) { var n = normRecord(f); n.favId = f.favId || ('f' + (f.id || 0)); return n; })
          : [],
        trackerLogs: Array.isArray(incoming.trackerLogs)
          ? incoming.trackerLogs.map(normTrackerLog).filter(Boolean)
          : []
      };
      seq = state.records.reduce(function (m, r) { return Math.max(m, r.id || 0); }, 0) + 1;
      tseq = state.trackerLogs.reduce(function (m, l) { return Math.max(m, l.id || 0); }, 0) + 1;
      persist();
      return { ok: true, count: state.records.length };
    }
  };

  root.MoodStorage = Storage;
  if (typeof module !== 'undefined' && module.exports) module.exports = Storage;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
