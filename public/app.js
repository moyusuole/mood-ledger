/**
 * app.js — 情绪账本交互逻辑
 * 纯离线：情绪单选、描述可选、保存时写入本地当前时间(年月日 时分)。
 */
(function (root) {
  'use strict';

  var S = root.MoodStorage;
  var M = root.MoodMedia;
  var el = {};
  var selectedMood = '';
  var editingId = null;
  var expandedRow = null;       // 当前展开完整描述的记录 id
  var currentDetailMood = '';   // 明细页对应的情绪
  var customTimeMode = false;   // 是否启用了自选时间
  var historyView = 'group';    // 记录页视图：group=按日期 / timeline=时间线
  var pendingDeleteId = null;   // 待删除记录 id（确认弹窗用）
  var pendingMedia = [];        // 记录表单待保存的媒体引用
  var editMedia = [];           // 编辑弹层当前媒体（含原有 + 新增）
  var statRange = { type: 'month', value: '' }; // 统计时间范围
  var imgCanvas = null;         // 当前预览图片 canvas（保存用）
  var imgName = 'mood.png';
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
  // ---- 记录行通用片段 ----
  function recOpsHtml(r) {
    var fav = S.isFavorited(r.id);
    return '<div class="rec-ops">'
      + '<button type="button" class="star' + (fav ? ' on' : '') + '" data-act="star" data-id="' + r.id + '" title="收藏">' + (fav ? '★' : '☆') + '</button>'
      + '<button type="button" class="edit" data-act="edit" data-id="' + r.id + '">改</button>'
      + '<button type="button" class="del" data-act="del" data-id="' + r.id + '">删</button>'
      + '</div>';
  }
  function recMainHtml(r) {
    var desc = r.desc || '';
    var summary = desc.length > 20 ? desc.slice(0, 20) + '…' : desc;
    return '<div class="rec-main">'
      + '<div class="rec-line1"><span class="rec-mood">' + escapeHtml(r.mood) + '</span>'
        + '<span class="rec-tag ' + r.category + '">' + catLabel(r.category) + '</span></div>'
      + (summary ? '<div class="rec-desc">' + escapeHtml(summary) + '</div>' : '')
      + '</div>';
  }
  function mediaHtml(r) {
    if (!r.media || !r.media.length) return '';
    var items = r.media.map(function (m) {
      return '<button type="button" class="media-thumb" data-media="' + escapeHtml(m.id) + '" data-mtype="' + escapeHtml(m.type) + '">'
        + (m.type === 'video' ? '<span class="mt-play">▶</span>' : '<span class="mt-ph"></span>')
        + '</button>';
    }).join('');
    return '<div class="rec-media">' + items + '</div>';
  }
  function detailHtmlOf(r) {
    var desc = r.desc || '';
    var isOpen = expandedRow === r.id;
    return isOpen
      ? '<div class="rec-detail"><div class="rec-detail-inner">' + (desc ? escapeHtml(desc) : '（当时没有写下具体的事）') + '</div></div>'
      : '';
  }
  function renderGroupHtml(groups) {
    return groups.map(function (g) {
      var rows = g.items.map(function (r) {
        return '<div class="rec-row" data-id="' + r.id + '">'
          + '<div class="rec-emoji">' + r.emoji + '</div>'
          + recMainHtml(r)
          + mediaHtml(r)
          + '<div class="rec-right"><span class="rec-time">' + escapeHtml(r.time) + '</span>' + recOpsHtml(r) + '</div>'
          + '</div>' + detailHtmlOf(r);
      }).join('');
      return '<div class="date-group">'
        + '<div class="date-head"><span>' + escapeHtml(g.date) + '</span><span class="day-sum">' + g.items.length + ' 条</span></div>'
        + '<div class="date-card">' + rows + '</div></div>';
    }).join('');
  }
  function renderTimelineHtml(records) {
    var html = '', prevDate = null;
    records.forEach(function (r) {
      if (r.date !== prevDate) { html += '<div class="tl-date-sep">' + escapeHtml(r.date) + '</div>'; prevDate = r.date; }
      var desc = r.desc || '';
      html += '<div class="rec-row tl-item" data-id="' + r.id + '">'
        + '<div class="tl-rail"><span class="tl-dot"></span></div>'
        + '<div class="tl-col">'
          + '<div class="tl-card">'
            + '<div class="tl-card-head"><span class="tl-time">' + escapeHtml(r.time) + '</span>'
              + '<span class="tl-emoji">' + r.emoji + '</span>'
              + '<span class="rec-mood">' + escapeHtml(r.mood) + '</span>'
              + '<span class="rec-tag ' + r.category + '">' + catLabel(r.category) + '</span>'
              + recOpsHtml(r)
            + '</div>'
            + (desc ? '<div class="rec-desc">' + escapeHtml(desc.length > 40 ? desc.slice(0, 40) + '…' : desc) + '</div>' : '')
          + mediaHtml(r)
          + '</div>'
          + detailHtmlOf(r)
        + '</div>'
        + '</div>';
    });
    return html;
  }

  function setHistoryView(mode) {
    historyView = (mode === 'timeline') ? 'timeline' : 'group';
    if (el.viewSeg) el.viewSeg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === historyView);
    });
    renderHistory();
  }

  function renderHistory() {
    var groups = S.groupByDate();
    var total = S.getRecords().length;
    if ($('historyCount')) $('historyCount').textContent = total;
    if ($('recordSub')) $('recordSub').textContent = total ? ('已记录 ' + total + ' 种心情瞬间') : '给每一种心情，留个位置';

    var list = $('historyList');
    if (!list) return;
    if (!total) {
      list.innerHTML = '';
      if ($('historyEmpty')) $('historyEmpty').hidden = false;
      return;
    }
    if ($('historyEmpty')) $('historyEmpty').hidden = true;
    list.innerHTML = (historyView === 'timeline') ? renderTimelineHtml(S.getRecords()) : renderGroupHtml(groups);
    hydrateMedia(list);
  }

  // 记录行里的媒体缩略图是异步取 URL 的，渲染后再补填充
  function hydrateMedia(scope) {
    if (!scope || !M) return;
    scope.querySelectorAll('.media-thumb').forEach(function (btn) {
      if (btn.dataset.done) return;
      var ref = { id: btn.getAttribute('data-media'), type: btn.getAttribute('data-mtype') };
      M.getUrl(ref).then(function (url) {
        if (!url) return;
        btn.dataset.done = '1';
        if (ref.type === 'video') return; // 视频保留 ▶ 占位
        var im = document.createElement('img');
        im.src = url; im.alt = ''; im.className = 'mt-img';
        btn.insertBefore(im, btn.firstChild);
      }).catch(function () {});
    });
  }

  function saveRecord() {
    if (!selectedMood) { toast('先选一个情绪吧'); return; }
    var desc = el.moodDesc ? el.moodDesc.value.trim() : '';
    var input = { mood: selectedMood, desc: desc, media: pendingMedia.slice() };
    // 启用了自选时间且填了合法值，就用用户选的时间；否则用此刻
    if (customTimeMode && el.customTime && el.customTime.value) {
      input.datetime = S.fromLocalInput(el.customTime.value);
    }
    var res = S.addRecord(input);
    if (!res.ok) { toast(res.error || '保存失败'); return; }
    el.moodDesc.value = '';
    clearSelection();
    resetTimePick();
    pendingMedia = [];
    renderMediaPreview(el.recordMediaPrev, pendingMedia, true, removePendingMedia);
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
    if (!statRange.value) statRange.value = defaultRangeValue(statRange.type);
    var recs = S.filterByRange(statRange.type, statRange.value);
    var stats = S.statsByMood(recs);
    var total = recs.length;
    if ($('statsTotal')) $('statsTotal').textContent = '共 ' + total + ' 条';
    if ($('statsRangeLabel')) $('statsRangeLabel').textContent = S.rangeLabel(statRange.type, statRange.value) + ' · 占比';
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

  function defaultRangeValue(type) {
    var now = new Date();
    if (type === 'day') return S.formatNow().slice(0, 10);
    if (type === 'week') return S.isoWeek(now);
    if (type === 'month') return S.formatNow().slice(0, 7);
    return S.formatNow().slice(0, 4);
  }

  function setRangeType(type) {
    statRange.type = type;
    var seg = el.rangeSeg;
    if (seg) seg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-range') === type);
    });
    if (type === 'year') {
      if (el.rangePicker) el.rangePicker.hidden = true;
      if (el.rangeYear) {
        var y = new Date().getFullYear();
        var opts = '';
        for (var k = y; k >= y - 6; k--) opts += '<option value="' + k + '">' + k + '</option>';
        el.rangeYear.innerHTML = opts;
        el.rangeYear.hidden = false;
        statRange.value = String(y);
      }
    } else {
      if (el.rangeYear) el.rangeYear.hidden = true;
      if (el.rangePicker) {
        el.rangePicker.hidden = false;
        el.rangePicker.type = (type === 'day') ? 'date' : (type === 'week') ? 'week' : 'month';
        el.rangePicker.value = defaultRangeValue(type);
        statRange.value = el.rangePicker.value;
      }
    }
    renderStats();
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
          + mediaHtml(r)
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
    hydrateMedia(list);
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
    editMedia = (rec.media || []).map(function (m) { return { id: m.id, type: m.type, ext: m.ext }; });
    renderMediaPreview(el.editMediaPrev, editMedia, true, removeEditMedia);
    el.editModal.hidden = false;
  }
  function closeEdit() { editingId = null; if (el.editModal) el.editModal.hidden = true; }
  function saveEdit() {
    if (!editingId) return;
    // 找出被删掉的旧媒体，清理孤立文件
    var rec = S.getRecords().find(function (r) { return r.id === editingId; });
    var oldIds = (rec && rec.media ? rec.media : []).map(function (m) { return m.id; });
    var keptIds = editMedia.map(function (m) { return m.id; });
    var removed = oldIds.filter(function (id) { return keptIds.indexOf(id) < 0; });
    removed.forEach(function (id) { if (!S.isMediaUsed(id)) M.remove({ id: id }); });
    var res = S.updateRecord(editingId, {
      mood: el.editMood.value,
      desc: el.editDesc.value.trim(),
      datetime: S.fromLocalInput(el.editTime.value),
      media: editMedia.slice()
    });
    if (!res.ok) { toast(res.error || '保存失败'); return; }
    closeEdit();
    refreshCurrentPage();
    renderStats();
    toast('已更新');
  }
  function deleteRecord(id) {
    var rec = S.getRecords().find(function (r) { return r.id === Number(id); });
    var media = rec ? (rec.media || []) : [];
    var res = S.deleteRecord(id);
    if (!res.ok) return;
    // 清理不再被任何记录/收藏引用的媒体文件
    var orphans = media.filter(function (m) { return !S.isMediaUsed(m.id); });
    if (orphans.length) M.removeMany(orphans);
    if (expandedRow === Number(id)) expandedRow = null;
    refreshCurrentPage();
    renderStats();
    toast('已删除');
  }

  // ---- 收藏（拷贝副本，原记录保留）----
  function toggleFavorite(id) {
    if (S.isFavorited(id)) {
      S.removeFavorite(id);
      refreshCurrentPage();
      renderFavorites();
      toast('已取消收藏');
    } else {
      var res = S.addFavorite(id);
      if (!res.ok) { toast(res.error || '收藏失败'); return; }
      refreshCurrentPage();
      renderFavorites();
      toast('已收藏 ★');
    }
  }

  // ---- 删除确认（硬删，不进回收站）----
  function confirmDelete(id) {
    pendingDeleteId = Number(id);
    if (el.confirmModal) el.confirmModal.hidden = false;
  }
  function closeConfirm() {
    pendingDeleteId = null;
    if (el.confirmModal) el.confirmModal.hidden = true;
  }
  function doDelete() {
    if (!pendingDeleteId) return;
    var id = pendingDeleteId;
    pendingDeleteId = null;
    if (el.confirmModal) el.confirmModal.hidden = true;
    deleteRecord(id);
  }

  function refreshCurrentPage() {
    renderHistory();
    if (currentDetailMood) renderDetail();
  }

  // ---- 我的收藏 ----
  function renderFavorites() {
    var favs = S.getFavorites();
    if ($('favCount')) $('favCount').textContent = favs.length;
    var list = $('favList');
    if (!list) return;
    if (!favs.length) {
      list.innerHTML = '';
      if ($('favEmpty')) $('favEmpty').hidden = false;
      return;
    }
    if ($('favEmpty')) $('favEmpty').hidden = true;
    list.innerHTML = favs.map(function (f) {
      var desc = f.desc ? (f.desc.length > 30 ? f.desc.slice(0, 30) + '…' : f.desc) : '';
      return '<div class="rec-row fav-row" data-fav="' + escapeHtml(String(f.favId)) + '">'
        + '<div class="rec-emoji">' + f.emoji + '</div>'
        + '<div class="rec-main"><div class="rec-line1"><span class="rec-mood">' + escapeHtml(f.mood) + '</span>'
          + '<span class="rec-tag ' + f.category + '">' + catLabel(f.category) + '</span></div>'
          + (desc ? '<div class="rec-desc">' + escapeHtml(desc) + '</div>' : '')
          + '</div>'
        + mediaHtml(f)
        + '<div class="rec-right"><span class="rec-time">' + escapeHtml(f.date + ' ' + f.time) + '</span>'
          + '<button type="button" class="del" data-fav="' + escapeHtml(String(f.favId)) + '">取消收藏</button></div>'
        + '</div>';
    }).join('');
    hydrateMedia(list);
  }

  // ---- 那年今日 ----
  function renderOnThisDay() {
    var md = S.formatNow().slice(5, 10); // MM-DD
    var groups = S.onThisDay(md);
    var list = $('onThisDayList');
    if (!list) return;
    if (!groups.length) {
      list.innerHTML = '';
      if ($('onThisDayEmpty')) $('onThisDayEmpty').hidden = false;
      return;
    }
    if ($('onThisDayEmpty')) $('onThisDayEmpty').hidden = true;
    list.innerHTML = groups.map(function (g) {
      var rows = g.items.map(function (r) {
        var desc = r.desc ? (r.desc.length > 20 ? r.desc.slice(0, 20) + '…' : r.desc) : '';
        return '<div class="otd-row">'
          + '<span class="otd-time">' + escapeHtml(r.time) + '</span>'
          + '<span class="rec-emoji otd-emoji">' + r.emoji + '</span>'
          + '<span class="rec-mood">' + escapeHtml(r.mood) + '</span>'
          + (desc ? '<span class="otd-desc">' + escapeHtml(desc) + '</span>' : '')
          + '</div>';
      }).join('');
      return '<div class="otd-year"><div class="otd-year-head">' + g.year + ' 年的今天</div>' + rows + '</div>';
    }).join('');
  }

  // ---- 媒体：表单预览 / 选择 / 查看 ----
  function renderMediaPreview(container, mediaArr, removable, onRemove) {
    if (!container) return;
    container.innerHTML = '';
    if (!mediaArr || !mediaArr.length) { container.hidden = true; return; }
    container.hidden = false;
    mediaArr.forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'media-thumb';
      btn.setAttribute('data-media', m.id);
      btn.setAttribute('data-mtype', m.type);
      if (removable) {
        var x = document.createElement('span');
        x.className = 'mt-x'; x.textContent = '✕';
        x.setAttribute('data-remove', m.id);
        btn.appendChild(x);
      }
      if (m.type === 'video') {
        var p = document.createElement('span');
        p.className = 'mt-play'; p.textContent = '▶';
        btn.appendChild(p);
      }
      container.appendChild(btn);
      M.getUrl(m).then(function (url) {
        if (!url) return;
        if (m.type === 'image') {
          var im = document.createElement('img');
          im.src = url; im.alt = ''; im.className = 'mt-img';
          btn.insertBefore(im, btn.firstChild);
        }
      }).catch(function () {});
    });
  }

  function addMediaFromFile(file, target) {
    if (!file) return;
    M.save(file).then(function (ref) {
      if (target === 'edit') editMedia.push(ref);
      else pendingMedia.push(ref);
      renderMediaPreview(el.editMediaPrev, editMedia, true, removeEditMedia);
      renderMediaPreview(el.recordMediaPrev, pendingMedia, true, removePendingMedia);
    }).catch(function () {
      toast('媒体保存失败');
    });
  }

  function removePendingMedia(id) {
    pendingMedia = pendingMedia.filter(function (m) { return m.id !== id; });
    renderMediaPreview(el.recordMediaPrev, pendingMedia, true, removePendingMedia);
  }
  function removeEditMedia(id) {
    editMedia = editMedia.filter(function (m) { return m.id !== id; });
    renderMediaPreview(el.editMediaPrev, editMedia, true, removeEditMedia);
  }

  // 查看弹层：图片大图 / 视频播放
  function openMediaViewer(ref) {
    if (!ref || !ref.id) return;
    var stage = $('mediaStage');
    if (!stage) return;
    stage.innerHTML = '';
    M.getUrl(ref).then(function (url) {
      if (!url) { toast('无法打开媒体'); return; }
      if (ref.type === 'video') {
        var v = document.createElement('video');
        v.src = url; v.controls = true; v.autoplay = true; v.className = 'media-full';
        stage.appendChild(v);
      } else {
        var im = document.createElement('img');
        im.src = url; im.alt = ''; im.className = 'media-full';
        stage.appendChild(im);
      }
      if ($('mediaModal')) $('mediaModal').hidden = false;
    }).catch(function () { toast('无法打开媒体'); });
  }
  function closeMedia() { if ($('mediaModal')) $('mediaModal').hidden = true; }

  // 备份导出：把媒体以 base64 内联进 JSON（仅导出瞬间生成，不写进 Preferences）
  function cleanRec(r) {
    return {
      id: r.id, mood: r.mood, emoji: r.emoji, category: r.category,
      desc: r.desc, datetime: r.datetime, date: r.date, time: r.time,
      media: (r.media || []).map(function (m) { return { id: m.id, type: m.type, ext: m.ext }; })
    };
  }
  function exportWithMedia() {
    var obj = {
      app: 'mood-ledger', version: 1, exportedAt: new Date().toISOString(),
      state: { records: S.getRecords().map(cleanRec), favorites: S.getFavorites().map(cleanRec) }
    };
    var refs = [];
    obj.state.records.forEach(function (r) { (r.media || []).forEach(function (m) { refs.push(m); }); });
    obj.state.favorites.forEach(function (f) { (f.media || []).forEach(function (m) { refs.push(m); }); });
    Promise.all(refs.map(function (m) {
      return M.getBase64(m).then(function (b64) { if (b64) m.data = b64; return m; });
    })).then(function () {
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '情绪账本备份-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('备份已导出（含媒体）');
    }).catch(function () { toast('导出失败'); });
  }
  function importWithMedia(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); } catch (e) { toast('不是有效的 JSON'); return; }
      var st = parsed.state || parsed;
      if (!st || !Array.isArray(st.records)) { toast('备份格式不正确'); return; }
      var allMedia = [];
      st.records.forEach(function (r) { (r.media || []).forEach(function (m) { allMedia.push(m); }); });
      (st.favorites || []).forEach(function (f) { (f.media || []).forEach(function (m) { allMedia.push(m); }); });
      Promise.all(allMedia.map(function (m) {
        if (!m.data) return Promise.resolve();
        return M.saveFromBase64(m.data, m.type, m.ext).then(function (ref) {
          m.id = ref.id; m.type = ref.type; m.ext = ref.ext; delete m.data;
        });
      })).then(function () {
        var res = S.importData(JSON.stringify({ app: 'mood-ledger', version: 1, exportedAt: new Date().toISOString(), state: st }));
        if (!res.ok) { toast(res.error || '导入失败'); return; }
        expandedRow = null;
        renderHistory(); renderStats();
        toast('已导入 ' + res.count + ' 条记录');
      }).catch(function () { toast('导入失败（媒体还原出错）'); });
    };
    reader.readAsText(file);
  }

  // ---- 图片生成 / 预览 / 保存 ----
  function closeImg() { if (el.imgModal) el.imgModal.hidden = true; imgCanvas = null; }

  function saveImage() {
    if (!imgCanvas) return;
    var C = root.Capacitor;
    var Fs = C && C.Plugins && C.Plugins.Filesystem;
    if (Fs) {
      try {
        var b64 = imgCanvas.toDataURL('image/png').split(',')[1];
        Fs.writeFile({ path: imgName, directory: 'DOCUMENTS', data: b64 })
          .then(function () { toast('已保存到 Documents/' + imgName); })
          .catch(function () { fallbackDownload(); });
        return;
      } catch (e) { /* fall through */ }
    }
    fallbackDownload();
  }
  function fallbackDownload() {
    if (!imgCanvas) return;
    imgCanvas.toBlob(function (blob) {
      if (!blob) { toast('生成失败'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = imgName; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('已开始下载');
    }, 'image/png');
  }

  function showImageModal(canvas, title, filename) {
    imgCanvas = canvas;
    imgName = filename || 'mood.png';
    if ($('imgModalTitle')) $('imgModalTitle').textContent = title || '心情卡片';
    if (el.imgPreview) el.imgPreview.src = canvas.toDataURL('image/png');
    if (el.imgModal) el.imgModal.hidden = false;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrapText(ctx, text, x, y, maxW, lh) {
    var chars = String(text).split('');
    var line = '', yy = y;
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = chars[i]; yy += lh; }
      else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }
  function wrapTextCenter(ctx, text, cx, y, maxW, lh) {
    var chars = String(text).split('');
    var line = '', lines = [];
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = chars[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    var startY = y - (lines.length - 1) * lh / 2;
    lines.forEach(function (ln, idx) { ctx.fillText(ln, cx, startY + idx * lh); });
  }
  function lighten(hex, amt) {
    var c = String(hex).replace('#', '');
    var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // 统计页导出图片（日/周/月/年）
  function exportStatsImage() {
    if (!statRange.value) statRange.value = defaultRangeValue(statRange.type);
    var recs = S.filterByRange(statRange.type, statRange.value);
    var stats = S.statsByMood(recs);
    var label = S.rangeLabel(statRange.type, statRange.value);
    var sum = S.summary(recs, label);
    var w = 1080, rowH = 120, pad = 64, headerH = 230, footerH = 170;
    var h = headerH + Math.max(stats.length, 1) * rowH + footerH;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fbf7f0'); g.addColorStop(1, '#f3ebdd');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#4a4038'; ctx.font = '700 52px sans-serif';
    ctx.fillText('情绪分布', pad, 56);
    ctx.fillStyle = '#8d8072'; ctx.font = '400 30px sans-serif';
    ctx.fillText(label, pad, 124);
    ctx.fillStyle = '#b07f3f'; ctx.font = '700 30px sans-serif';
    ctx.fillText('共 ' + recs.length + ' 条', pad, 170);
    var colorMap = { positive: '#c98a3c', neutral: '#9b8b76', negative: '#a4634f' };
    var y = headerH;
    if (!stats.length) {
      ctx.fillStyle = '#8d8072'; ctx.font = '400 34px sans-serif';
      ctx.fillText('该时间段还没有记录', pad, y + 30);
    }
    stats.forEach(function (s) {
      var color = colorMap[s.category] || '#c9a26c';
      ctx.fillStyle = '#4a4038'; ctx.font = '400 44px sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText(s.emoji + '  ' + s.mood, pad, y + rowH / 2);
      var barX = 440, barW = 400, barY = y + rowH / 2 - 10;
      ctx.fillStyle = '#ece1cf'; roundRect(ctx, barX, barY, barW, 20, 10); ctx.fill();
      ctx.fillStyle = color; roundRect(ctx, barX, barY, Math.max(barW * s.pct / 100, 6), 20, 10); ctx.fill();
      ctx.fillStyle = '#4a4038'; ctx.font = '700 32px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(s.count + ' 次 · ' + s.pct + '%', w - pad, y + rowH / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      y += rowH;
    });
    var fy = h - footerH + 44;
    ctx.fillStyle = '#b07f3f'; ctx.fillRect(pad, fy, 8, 60);
    ctx.fillStyle = '#4a4038'; ctx.font = '400 32px sans-serif';
    wrapText(ctx, sum.text, pad + 28, fy, w - pad - (pad + 28), 44);
    showImageModal(canvas, '情绪分布 · ' + label, '情绪统计-' + label + '.png');
  }

  // 记录页：生成今日心情卡
  function generateTodayCard() {
    var recs = S.todayRecords();
    if (!recs.length) { toast('今天还没记录，先去记一笔吧'); return; }
    var sum = S.summary(recs, '今天');
    var canvas = document.createElement('canvas');
    var w = 1080, h = 1500;
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var base = sum.color || '#c9a26c';
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, lighten(base, 0.55)); g.addColorStop(1, lighten(base, 0.80));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    var today = S.formatNow().slice(0, 10);
    ctx.fillStyle = 'rgba(74,64,56,.65)'; ctx.font = '400 34px sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(today, 80, 90);
    ctx.font = '200px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(sum.topEmoji, w / 2, 220);
    ctx.fillStyle = '#4a4038'; ctx.font = '800 76px sans-serif';
    ctx.fillText(sum.topMood, w / 2, 520);
    ctx.fillStyle = 'rgba(74,64,56,.82)'; ctx.font = '400 38px sans-serif'; ctx.textAlign = 'center';
    wrapTextCenter(ctx, sum.text, w / 2, 660, w - 200, 56);
    ctx.fillStyle = 'rgba(74,64,56,.5)'; ctx.font = '400 30px sans-serif';
    ctx.fillText('情绪账本 · 今日心情卡', w / 2, h - 130);
    ctx.textAlign = 'left';
    showImageModal(canvas, '今日心情卡', '今日心情卡-' + today + '.png');
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
    if (name === 'mine') { renderOnThisDay(); renderFavorites(); }
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
      var mediaBtn = e.target.closest('.media-thumb');
      if (mediaBtn) {
        openMediaViewer({ id: mediaBtn.getAttribute('data-media'), type: mediaBtn.getAttribute('data-mtype') });
        return;
      }
      var id = Number(row.getAttribute('data-id'));
      var actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        var act = actBtn.getAttribute('data-act');
        if (act === 'edit') openEdit(id);
        else if (act === 'del') confirmDelete(id);
        else if (act === 'star') toggleFavorite(id);
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

    // 统计时间范围切换
    if (el.rangeSeg) el.rangeSeg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-range]');
      if (b) setRangeType(b.getAttribute('data-range'));
    });
    if (el.rangePicker) el.rangePicker.addEventListener('change', function () {
      statRange.value = el.rangePicker.value; renderStats();
    });
    if (el.rangeYear) el.rangeYear.addEventListener('change', function () {
      statRange.value = el.rangeYear.value; renderStats();
    });
    if ($('exportStatsBtn')) $('exportStatsBtn').addEventListener('click', exportStatsImage);
    if (el.todayCardBtn) el.todayCardBtn.addEventListener('click', generateTodayCard);

    // 记录表单：图片 / 视频选择
    if ($('addImgBtn')) $('addImgBtn').addEventListener('click', function () { if (el.imgInput) el.imgInput.click(); });
    if ($('addVidBtn')) $('addVidBtn').addEventListener('click', function () { if (el.vidInput) el.vidInput.click(); });
    if (el.imgInput) el.imgInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) addMediaFromFile(f, 'add');
      e.target.value = '';
    });
    if (el.vidInput) el.vidInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) addMediaFromFile(f, 'add');
      e.target.value = '';
    });
    // 记录表单预览区：点缩略图看大图，点 ✕ 移除
    if (el.recordMediaPrev) el.recordMediaPrev.addEventListener('click', function (e) {
      var x = e.target.closest('[data-remove]');
      if (x) { removePendingMedia(x.getAttribute('data-remove')); return; }
      var t = e.target.closest('.media-thumb');
      if (t) openMediaViewer({ id: t.getAttribute('data-media'), type: t.getAttribute('data-mtype') });
    });

    // 编辑弹层：图片 / 视频选择
    if ($('editImgBtn')) $('editImgBtn').addEventListener('click', function () { if (el.editImgInput) el.editImgInput.click(); });
    if ($('editVidBtn')) $('editVidBtn').addEventListener('click', function () { if (el.editVidInput) el.editVidInput.click(); });
    if (el.editImgInput) el.editImgInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) addMediaFromFile(f, 'edit');
      e.target.value = '';
    });
    if (el.editVidInput) el.editVidInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) addMediaFromFile(f, 'edit');
      e.target.value = '';
    });
    if (el.editMediaPrev) el.editMediaPrev.addEventListener('click', function (e) {
      var x = e.target.closest('[data-remove]');
      if (x) { removeEditMedia(x.getAttribute('data-remove')); return; }
      var t = e.target.closest('.media-thumb');
      if (t) openMediaViewer({ id: t.getAttribute('data-media'), type: t.getAttribute('data-mtype') });
    });

    // 媒体查看弹层关闭
    if ($('mediaClose')) $('mediaClose').addEventListener('click', closeMedia);
    if ($('mediaModal')) $('mediaModal').addEventListener('click', function (e) {
      if (e.target === $('mediaModal')) closeMedia();
    });

    // 删除确认弹窗
    if ($('confirmCancel')) $('confirmCancel').addEventListener('click', closeConfirm);
    if ($('confirmOk')) $('confirmOk').addEventListener('click', doDelete);
    if (el.confirmModal) el.confirmModal.addEventListener('click', function (e) {
      if (e.target === el.confirmModal) closeConfirm();
    });

    // 图片预览弹窗
    if ($('imgClose')) $('imgClose').addEventListener('click', closeImg);
    if ($('imgSave')) $('imgSave').addEventListener('click', saveImage);
    if (el.imgModal) el.imgModal.addEventListener('click', function (e) {
      if (e.target === el.imgModal) closeImg();
    });

    // 备份（含媒体：导出时把媒体以 base64 内联进 JSON，不写进 Preferences）
    if ($('exportBtn')) $('exportBtn').addEventListener('click', exportWithMedia);
    if ($('importBtn')) $('importBtn').addEventListener('click', function () { el.importInput.click(); });
    if (el.importInput) el.importInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      importWithMedia(file);
      e.target.value = '';
    });

    // 记录视图切换：按日期 / 时间线
    if (el.viewSeg) el.viewSeg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (b) setHistoryView(b.getAttribute('data-view'));
    });

    // 我的收藏：取消收藏
    var favList = $('favList');
    if (favList) favList.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-fav]');
      if (!btn) return;
      var fid = btn.getAttribute('data-fav');
      var fav = S.getFavorites().find(function (f) { return String(f.favId) === String(fid); });
      if (fav) { S.removeFavorite(fav.id); toast('已取消收藏'); renderFavorites(); refreshCurrentPage(); }
    });

    // 导出 Markdown 日记
    if ($('exportMdBtn')) $('exportMdBtn').addEventListener('click', function () {
      var md = S.exportMarkdown();
      var blob = new Blob([md], { type: 'text/markdown' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '情绪账本日记-' + S.formatNow().slice(0, 10) + '.md';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('Markdown 已导出');
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
      imgInput: $('imgInput'),
      vidInput: $('vidInput'),
      recordMediaPrev: $('recordMediaPrev'),
      editImgInput: $('editImgInput'),
      editVidInput: $('editVidInput'),
      editMediaPrev: $('editMediaPrev'),
      mediaModal: $('mediaModal'),
      mediaStage: $('mediaStage'),
      mediaClose: $('mediaClose'),
      todayCardBtn: $('todayCardBtn'),
      rangeSeg: $('rangeSeg'),
      rangePicker: $('rangePicker'),
      rangeYear: $('rangeYear'),
      confirmModal: $('confirmModal'),
      imgModal: $('imgModal'),
      imgPreview: $('imgPreview'),
      importInput: $('importInput'),
      viewSeg: $('viewSeg'),
      favList: $('favList'),
      favCount: $('favCount'),
      favEmpty: $('favEmpty'),
      onThisDayList: $('onThisDayList'),
      onThisDayEmpty: $('onThisDayEmpty'),
      exportMdBtn: $('exportMdBtn')
    };
    buildMoodPicker();
    bindEvents();
    return S.init().then(function () {
      renderHistory();
      setRangeType('month');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  root.MoodApp = { refresh: refreshCurrentPage, switchPage: switchPage };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
