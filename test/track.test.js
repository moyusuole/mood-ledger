/* 打卡逻辑自测：在 Node 里 mock localStorage 跑 storage.js */
const assert = require('assert');
let store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.self = global;
const S = require('../public/src/storage.js');

(async () => {
  await S.init();
  assert.deepStrictEqual(S.TRACKERS.map(t => t.key),
    ['period','wash','exercise','s','water','poop','pee','drink','call','message','talk']);
  // 长名称必须完整，不能漏字
  assert.strictEqual(S.trackerDef('call').name, '给家里打电话');
  assert.strictEqual(S.trackerDef('message').name, '给家里发信息');
  // 只有经期是区间类型，其余都是单日（防止区间着色 bug 回归）
  assert.strictEqual(S.trackerDef('period').kind, 'range');
  S.TRACKERS.filter(t => t.key !== 'period').forEach(t => {
    assert.notStrictEqual(t.kind, 'range', t.key + ' 不应是区间类型');
  });

  // 1) 新增单次打卡
  let r = S.addTrackerLog({ key: 'wash', start: '2026-11-16 09:30', note: '洗了头' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(S.logsOnDate('2026-11-16').length, 1);

  // 2) 新增经期（开始~结束区间），跨 3 天
  r = S.addTrackerLog({ key: 'period', start: '2026-11-13 08:00', end: '2026-11-15 20:00' });
  assert.strictEqual(r.ok, true);
  assert.ok(S.trackersOnDate('2026-11-13').includes('period'));
  assert.ok(S.trackersOnDate('2026-11-14').includes('period'));
  assert.ok(S.trackersOnDate('2026-11-15').includes('period'));
  assert.ok(!S.trackersOnDate('2026-11-16').includes('period')); // 已结束，不覆盖 16 号

  // 3) 进行中的经期（end 空）着色到今天
  const today = S.formatNow().slice(0, 10);
  S.addTrackerLog({ key: 'period', start: '2026-11-01 07:00' });
  assert.ok(S.trackersOnDate(today).includes('period'), '进行中经期应覆盖到今天');

  // 4) 按类型过滤
  assert.strictEqual(S.logsByKey('period').length, 2);
  assert.strictEqual(S.logsByKey('wash').length, 1);

  // 5) 编辑：补上结束时间
  const p2 = S.logsByKey('period').find(l => l.end === '');
  S.updateTrackerLog(p2.id, { end: '2026-11-02 20:00' });
  assert.strictEqual(S.logsByKey('period').find(l => l.id === p2.id).end, '2026-11-02 20:00');

  // 6) 删除
  const before = S.getTrackerLogs().length;
  const wash = S.logsByKey('wash')[0];
  S.deleteTrackerLog(wash.id);
  assert.strictEqual(S.getTrackerLogs().length, before - 1);
  assert.strictEqual(S.logsOnDate('2026-11-16').length, 0);

  // 7) 导出 / 导入往返保留打卡数据
  S.addTrackerLog({ key: 'exercise', start: '2026-11-16 18:00', note: '跑步' });
  const json = S.exportData();
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.state.trackerLogs.length, S.getTrackerLogs().length);
  const imp = S.importData(json);
  assert.strictEqual(imp.ok, true);
  assert.ok(S.logsByKey('exercise').length >= 1, '导入后应保留 exercise 打卡');

  // 8) 打卡 Markdown 导出含类型名
  const md = S.exportTrackerMarkdown();
  assert.ok(md.includes('经期') && md.includes('运动'), '打卡 Markdown 应含类型名');

  console.log('TRACK_TESTS_OK');
})().catch(e => { console.error(e); process.exit(1); });
