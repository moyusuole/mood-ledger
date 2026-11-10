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
    { name: '不舍',   emoji: '💔',  category: 'negative' }
  ];

  const CATEGORIES = [
    { key: 'positive', label: '积极', color: '#c98a3c' },
    { key: 'neutral',  label: '中性', color: '#9b8b76' },
    { key: 'negative', label: '消极', color: '#a4634f' }
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
    return { records: [] };
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
      time: sp.time
    };
  }
  function formatNowForStored(r) {
    if (r && r.datetime && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.datetime)) return r.datetime;
    if (r && r.date && r.time) return r.date + ' ' + String(r.time).slice(0, 5);
    return formatNow();
  }

  const Storage = {
    MOODS: MOODS,
    CATEGORIES: CATEGORIES,
    moodInfo: moodInfo,
    formatNow: formatNow,

    init: function () {
      return readRaw().then(function (raw) {
        state = raw && Array.isArray(raw.records)
          ? { records: raw.records.map(normRecord) }
          : emptyState();
        seq = state.records.reduce(function (m, r) { return Math.max(m, r.id || 0); }, 0) + 1;
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
      const dt = formatNow(); // 保存那一刻的本地时间，精确到分
      const sp = splitDateTime(dt);
      const info = moodInfo(mood);
      const rec = normRecord({
        id: seq++,
        mood: mood,
        emoji: info ? info.emoji : '🙂',
        category: info ? info.category : 'neutral',
        desc: String((input && input.desc) || '').trim().slice(0, 500),
        datetime: dt
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
      // 时间允许手动改（HH:mm），日期保持创建当天
      if (patch && patch.time && /^\d{2}:\d{2}$/.test(patch.time)) {
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

    // 按情绪聚合统计（数量 + 占比），按数量降序
    statsByMood: function () {
      const counts = {};
      const total = state && state.records ? state.records.length : 0;
      (state && state.records ? state.records : []).forEach(function (r) {
        counts[r.mood] = (counts[r.mood] || 0) + 1;
      });
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

    exportData: function () {
      return JSON.stringify({
        app: 'mood-ledger',
        version: 1,
        exportedAt: new Date().toISOString(),
        state: JSON.parse(JSON.stringify(state || emptyState()))
      }, null, 2);
    },

    importData: function (jsonString) {
      if (typeof jsonString !== 'string' || !jsonString.trim()) return { ok: false, error: '内容为空' };
      let parsed;
      try { parsed = JSON.parse(jsonString); }
      catch (e) { return { ok: false, error: '不是有效的 JSON' }; }
      const incoming = (parsed && parsed.state) ? parsed.state : parsed;
      if (!incoming || !Array.isArray(incoming.records)) return { ok: false, error: '备份格式不正确' };
      state = { records: incoming.records.map(normRecord) };
      seq = state.records.reduce(function (m, r) { return Math.max(m, r.id || 0); }, 0) + 1;
      persist();
      return { ok: true, count: state.records.length };
    }
  };

  root.MoodStorage = Storage;
  if (typeof module !== 'undefined' && module.exports) module.exports = Storage;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
