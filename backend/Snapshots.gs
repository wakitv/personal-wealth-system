/**
 * Daily snapshots via a time-driven trigger.
 *
 * Run installDailySnapshotTrigger() once from the editor. Every night at ~23:50
 * Asia/Manila it fills any missing days since the last snapshot and (re)computes
 * today's snapshot from the ledger and recorded prices. Snapshots are reproducible:
 * "Rebuild snapshots" in Settings recomputes them exactly the same way.
 *
 * If price auto-refresh is enabled in Settings, prices are fetched first.
 */
function dailySnapshotJob() {
  var svc = service_();
  var deps = buildDeps_();
  var settings = {};
  deps.store.read('Settings').forEach(function (r) { settings[r.key] = r.value; });
  if (settings.price_auto_refresh === 'true') {
    try { svc.runInternal('refreshPrices', {}, deps, 'system:daily'); }
    catch (e) { console.warn('Price refresh failed: ' + e.message); }
  }
  var tz = settings.timezone || 'Asia/Manila';
  var today = WealthCore.localDate(Date.now(), tz);
  var snaps = deps.store.read('DailySnapshots').map(function (s) { return String(s.snapshot_date); }).sort();
  var last = snaps.length ? snaps[snaps.length - 1] : null;
  var from = last && last < today ? WealthCore.addDays(last, 1) : today;
  if (WealthCore.daysBetween(from, today) > 1000) from = WealthCore.addDays(today, -1000);
  var res = svc.runInternal('rebuildSnapshots', { from: from, to: today }, buildDeps_(), 'system:daily');
  console.log('Snapshots written: ' + JSON.stringify(res));
  return res;
}

function installDailySnapshotTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailySnapshotJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailySnapshotJob').timeBased().atHour(23).nearMinute(50).everyDays(1).inTimezone('Asia/Manila').create();
  console.log('Daily snapshot trigger installed (≈23:50 Asia/Manila).');
}

function removeDailySnapshotTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailySnapshotJob') ScriptApp.deleteTrigger(t);
  });
}
