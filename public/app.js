/**
 * app.js — 情绪账本交互逻辑
 * 纯离线：情绪单选、描述可选、保存时写入本地当前时间(年月日 时分)。
 */
(function (root) {
  'use strict';

  var S = root.MoodStorage;
  var el = {};
  var selectedMood = '';
  var editingId = null;
  var expandedRow = null;       // 当前展开完整描述的记录 id
  var currentDetailMood = '';   // 明细页对应的情绪
  var customTimeMode = false;   // 是否启用了自选时间
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 1800);
  }
  function catLabel(cat) {
    var m = { positive: '积极', neutral: '中性', negative: '消极' };
    return m[cat] || '心情';
  }

  // ---- 构建情绪选择按钮 ----
  function buildMoodPicker() {
    ['positive', 'neutral', 'negative'].forEach(function (cat) {
      var grid = document.querySelector('[data-grid="' + cat + '"]');
      if (!grid) return;
      var list = S.MOODS.filter(function (m) { return m.category === cat; });
      var cnt = { positive: 'cntPositive', neutral: 'cntNeutral', negative: 'cntNegative' }[cat];
      if ($(cnt)) $(cnt).textContent = '(' + list.length + ')';
      grid.innerHTML = list.map(function (m) {
        return '<button type="button" class="mood-chip" data-cat="' + cat + '" data-mood="' + escapeHtml(m.name) + '">'
          + '<span class="emo">' + m.emoji + '</span><span>' + escapeHtml(m.name) + '</span></button>';
      }).join('');
    });
    document.getElementById('moodPicker').addEventListener('click', function (e) {
      var chip = e.target.closest('.mood-chip');
      if (!chip) return;
      document.querySelectorAll('.mood-chip').forEach(function (c) { c.classList.remove('selected'); });
      chip.classList.add('selected');
      selectedMood = chip.getAttribute('data-mood');
    });
  }

  function clearSelection() {
    selectedMood = '';
    document.querySelectorAll('.mood-chip').forEach(function (c) { c.classList.remove('selected'); });
  }

  // ---- 记录页 ----
  function renderHistory() {
    var groups = S.groupByDate();
    var total = S.getRecords().length;
    if ($('historyCount')) $('historyCount').textContent = total;
    if ($('recordSub')) $('recordSub').textContent = total ? ('已记录 ' + total + ' 种心情瞬间') : '给每一种心情，留个位置';

    var list = $('historyList');
    if (!list) return;
    if (!groups.length) {
      list.innerHTML = '';
      if ($('historyEmpty')) $('historyEmpty').hidden = false;
      return;
    }
    if ($('historyEmpty')) $('historyEmpty').hidden = true;

    list.innerHTML = groups.map(function (g) {
      var rows = g.items.map(function (r) {
        var desc = r.desc || '';
        var summary = desc.length > 20 ? desc.slice(0, 20) + '…' : desc;
        var cat = catLabel(r.category);
        var isOpen = expandedRow === r.id;
        var detailHtml = isOpen
          ? '<div class="rec-detail"><div class="rec-detail-inner">' + (desc ? escapeHtml(desc) : '（当时没有写下具体的事）') + '</div></div>'
          : '';
        return '<div class="rec-row" data-id="' + r.id + '">'
          + '<div class="rec-emoji">' + r.emoji + '</div>'
          + '<div class="rec-main">'
            + '<div class="rec-line1"><span class="rec-mood">' + escapeHtml(r.mood) + '</span>'
              + '<span class="rec-tag ' + r.category + '">' + cat + '</span></div>'
            + (summary ? '<div class="rec-desc">' + escapeHtml(summary) + '</div>' : '')
          + '</div>'
          + '<div class="rec-right"><span class="rec-time">' + escapeHtml(r.time) + '</span>'
            + '<div class="rec-ops">'
              + '<button type="button" class="edit" data-act="edit" data-id="' + r.id + '">改</button>'
              + '<button type="button" class="del" data-act="del" data-id="' + r.id + '">删</button>'
            + '</div></div>'
          + '</div>' + detailHtml;
      }).join('');
      return '<div class="date-group">'
        + '<div class="date-head"><span>' + escapeHtml(g.date) + '</span><span class="day-sum">' + g.items.length + ' 条</span></div>'
        + '<div class="date-card">' + rows + '</div></div>';
    }).join('');
  }

  function saveRecord() {
    if (!selectedMood) { toast('先选一个情绪吧'); return; }
    var desc = el.moodDesc ? el.moodDesc.value.trim() : '';
    var input = { mood: selectedMood, desc: desc };
    // 启用了自选时间且填了合法值，就用用户选的时间；否则用此刻
    if (customTimeMode && el.customTime && el.customTime.value) {
      input.datetime = S.fromLocalInput(el.customTime.value);
    }
    var res = S.addRecord(input);
    if (!res.ok) { toast(res.error || '保存失败'); return; }
    el.moodDesc.value = '';
    clearSelection();
    resetTimePick();
    // 保存后自动展开历史，让用户看到结果
    setHistoryOpen(true);
    renderHistory();
    toast('已记下 ' + res.record.emoji + ' ' + res.record.mood + ' · ' + res.record.time);
  }

  // ---- 自选时间 ----
  function setTimeMode(custom) {
    customTimeMode = !!custom;
    if (!el.timeEditBtn || !el.customTime) return;
    el.timeEditBtn.textContent = custom ? '用此刻时间' : '自选时间';
    el.customTime.hidden = !custom;
    if (custom) {
      // 预填为当前本地时间，方便小幅度调整
      if (!el.customTime.value) el.customTime.value = S.toLocalInput(S.formatNow());
      updateTimeHint();
    } else {
      updateTimeHint();
    }
  }
  function updateTimeHint() {
    if (!el.timeHint) return;
    if (customTimeMode && el.customTime && el.customTime.value) {
      el.timeHint.textContent = '记录时间：' + S.fromLocalInput(el.customTime.value);
    } else {
      el.timeHint.textContent = '记录时间：现在';
    }
  }
  function resetTimePick() {
    customTimeMode = false;
    if (el.timeEditBtn) el.timeEditBtn.textContent = '自选时间';
    if (el.customTime) { el.customTime.hidden = true; el.customTime.value = ''; }
    updateTimeHint();
  }

  function setHistoryOpen(open) {
    if (!el.historyWrap) return;
    el.historyWrap.hidden = !open;
    if (el.historyToggle) el.historyToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (el.historyChevron) el.historyChevron.textContent = open ? '▴' : '▾';
  }

  // ---- 统计页 ----
  function renderStats() {
    var stats = S.statsByMood();
    var total = S.getRecords().length;
    if ($('statsTotal')) $('statsTotal').textContent = '共 ' + total + ' 条';
    var list = $('statsList');
    if (!list) return;
    if (!stats.length) {
      list.innerHTML = '';
      if ($('statsEmpty')) $('statsEmpty').hidden = false;
      return;
    }
    if ($('statsEmpty')) $('statsEmpty').hidden = true;
    var colorMap = { positive: '#c99a4e', neutral: '#a89987', negative: '#b5735a' };
    list.innerHTML = stats.map(function (s) {
      var color = colorMap[s.category] || '#c9a26c';
      return '<div class="stat-row" data-mood="' + escapeHtml(s.mood) + '">'
        + '<span class="stat-emoji">' + s.emoji + '</span>'
        + '<div class="stat-info">'
          + '<div class="stat-line"><span class="stat-name">' + escapeHtml(s.mood) + '</span>'
            + '<span class="stat-val"><b>' + s.count + '</b> 次 · ' + s.pct + '%</span></div>'
          + '<div class="bar-track"><div class="bar-fill" style="width:' + s.pct + '%;background:' + color + '"></div></div>'
        + '</div><span class="stat-arrow">›</span></div>';
    }).join('');
  }

  // ---- 明细页 ----
  function openDetail(mood) {
    currentDetailMood = mood;
    var info = S.moodInfo(mood);
    var stats = S.statsByMood();
    var st = stats.find(function (s) { return s.mood === mood; });
    if ($('detailTitle')) $('detailTitle').textContent = catLabel(info ? info.category : '') + ' · ' + mood;
    if ($('detailMoodEmoji')) $('detailMoodEmoji').textContent = info ? info.emoji : '🙂';
    if ($('detailMoodName')) $('detailMoodName').textContent = mood;
    if ($('detailMoodPct')) $('detailMoodPct').textContent = st ? (st.count + ' 次 · ' + st.pct + '%') : '';
    if ($('tabDetail')) $('tabDetail').disabled = false;
    renderDetail();
    switchPage('detail');
  }

  function renderDetail() {
    var groups = currentDetailMood ? S.recordsByMood(currentDetailMood) : [];
    var list = $('detailList');
    if (!list) return;
    list.innerHTML = groups.map(function (g) {
      var rows = g.items.map(function (r) {
        var isOpen = expandedRow === r.id;
        var detailHtml = isOpen
          ? '<div class="rec-detail"><div class="rec-detail-inner">' + (r.desc ? escapeHtml(r.desc) : '（当时没有写下具体的事）') + '</div></div>'
          : '';
        return '<div class="rec-row" data-id="' + r.id + '" data-scope="detail">'
          + '<div class="rec-emoji">' + r.emoji + '</div>'
          + '<div class="rec-main"><div class="rec-line1"><span class="rec-mood">' + escapeHtml(r.mood) + '</span></div>'
            + (r.desc ? '<div class="rec-desc">' + escapeHtml(r.desc.length > 20 ? r.desc.slice(0,20)+'…' : r.desc) + '</div>' : '')
          + '</div>'
          + '<div class="rec-right"><span class="rec-time">' + escapeHtml(r.time) + '</span>'
            + '<div class="rec-ops">'
              + '<button type="button" class="edit" data-act="edit" data-id="' + r.id + '">改</button>'
              + '<button type="button" class="del" data-act="del" data-id="' + r.id + '">删</button>'
            + '</div></div></div>' + detailHtml;
      }).join('');
      return '<div class="date-group">'
        + '<div class="date-head"><span>' + escapeHtml(g.date) + '</span><span class="day-sum">' + g.items.length + ' 条</span></div>'
        + '<div class="date-card">' + rows + '</div></div>';
    }).join('');
  }

  // ---- 编辑弹层 ----
  function openEdit(id) {
    var rec = S.getRecords().find(function (r) { return r.id === Number(id); });
    if (!rec) return;
    editingId = rec.id;
    el.editMood.innerHTML = S.MOODS.map(function (m) {
      return '<option value="' + escapeHtml(m.name) + '"' + (m.name === rec.mood ? ' selected' : '') + '>' + m.emoji + ' ' + escapeHtml(m.name) + '</option>';
    }).join('');
    el.editDesc.value = rec.desc || '';
    el.editTime.value = S.toLocalInput(rec.datetime) || '';
    el.editModal.hidden = false;
  }
  function closeEdit() { editingId = null; if (el.editModal) el.editModal.hidden = true; }
  function saveEdit() {
    if (!editingId) return;
    var res = S.updateRecord(editingId, {
      mood: el.editMood.value,
      desc: el.editDesc.value.trim(),
      datetime: S.fromLocalInput(el.editTime.value)
    });
    if (!res.ok) { toast(res.error || '保存失败'); return; }
    closeEdit();
    refreshCurrentPage();
    renderStats();
    toast('已更新');
  }
  function deleteRecord(id) {
    var res = S.deleteRecord(id);
    if (!res.ok) return;
    if (expandedRow === Number(id)) expandedRow = null;
    refreshCurrentPage();
    renderStats();
    toast('已删除');
  }

  function refreshCurrentPage() {
    renderHistory();
    if (currentDetailMood) renderDetail();
  }

  // ---- 页面切换 ----
  function switchPage(name) {
    ['record', 'stats', 'detail', 'mine'].forEach(function (p) {
      var node = $('page' + p.charAt(0).toUpperCase() + p.slice(1));
      if (node) node.hidden = (p !== name);
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.id === 'tabDetail') return; // 明细 tab 状态单独管
      t.classList.toggle('active', t.getAttribute('data-page') === name);
    });
    if (name === 'stats') renderStats();
    if (name === 'record') renderHistory();
    window.scrollTo(0, 0);
  }

  // ---- 事件绑定 ----
  function bindEvents() {
    if ($('saveMoodBtn')) $('saveMoodBtn').addEventListener('click', saveRecord);
    if ($('historyToggle')) $('historyToggle').addEventListener('click', function () {
      setHistoryOpen(el.historyWrap.hidden);
    });

    // 自选时间：切换模式 + 实时更新提示
    if (el.timeEditBtn) el.timeEditBtn.addEventListener('click', function () {
      setTimeMode(!customTimeMode);
    });
    if (el.customTime) el.customTime.addEventListener('input', updateTimeHint);

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        if (t.id === 'tabDetail' && t.disabled) return;
        switchPage(t.getAttribute('data-page'));
      });
    });
    if ($('tabAdd')) $('tabAdd').addEventListener('click', function () {
      switchPage('record');
      window.scrollTo(0, 0);
      if (el.moodDesc) el.moodDesc.focus();
      toast('选个情绪，写点什么');
    });
    if ($('detailBack')) $('detailBack').addEventListener('click', function () { switchPage('stats'); });

    // 记录行：点击展开/收起描述；点改/删单独处理（两处列表共用委托）
    function onRowClick(e) {
      var row = e.target.closest('.rec-row');
      if (!row) return;
      var id = Number(row.getAttribute('data-id'));
      var actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        var act = actBtn.getAttribute('data-act');
        if (act === 'edit') openEdit(id);
        else if (act === 'del') deleteRecord(id);
        return;
      }
      expandedRow = (expandedRow === id) ? null : id;
      refreshCurrentPage();
    }
    var list = $('historyList'); if (list) list.addEventListener('click', onRowClick);
    var dl = $('detailList'); if (dl) dl.addEventListener('click', onRowClick);

    var statsList = $('statsList');
    if (statsList) statsList.addEventListener('click', function (e) {
      var row = e.target.closest('.stat-row');
      if (!row) return;
      openDetail(row.getAttribute('data-mood'));
    });

    // 编辑弹层
    if ($('editCancel')) $('editCancel').addEventListener('click', closeEdit);
    if ($('editSave')) $('editSave').addEventListener('click', saveEdit);
    if (el.editModal) el.editModal.addEventListener('click', function (e) {
      if (e.target === el.editModal) closeEdit();
    });

    // 备份
    if ($('exportBtn')) $('exportBtn').addEventListener('click', function () {
      var data = S.exportData();
      var blob = new Blob([data], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '情绪账本备份-' + new Date().toISOString().slice(0,10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('备份已导出');
    });
    if ($('importBtn')) $('importBtn').addEventListener('click', function () { el.importInput.click(); });
    if (el.importInput) el.importInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var res = S.importData(String(reader.result));
        if (!res.ok) { toast(res.error || '导入失败'); return; }
        expandedRow = null;
        renderHistory(); renderStats();
        toast('已导入 ' + res.count + ' 条记录');
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  function init() {
    el = {
      toast: $('toast'),
      moodDesc: $('moodDesc'),
      historyWrap: $('historyWrap'),
      historyToggle: $('historyToggle'),
      historyChevron: $('historyChevron'),
      editModal: $('editModal'),
      editMood: $('editMood'),
      editDesc: $('editDesc'),
      editTime: $('editTime'),
      customTime: $('customTime'),
      timeEditBtn: $('timeEditBtn'),
      timeHint: $('timeHint'),
      importInput: $('importInput')
    };
    buildMoodPicker();
    bindEvents();
    return S.init().then(function () {
      renderHistory();
      renderStats();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  root.MoodApp = { refresh: refreshCurrentPage, switchPage: switchPage };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
