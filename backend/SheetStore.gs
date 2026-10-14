/**
 * SheetStore — the storage adapter WealthService uses inside Apps Script.
 *
 *  - One worksheet per entity (see WealthService.SCHEMA); row 1 is the header.
 *  - Columns are matched by header name, so adding columns later is safe.
 *  - Text columns are formatted as plain text so IDs/ISO timestamps are never
 *    auto-converted into dates or numbers by Sheets.
 *  - User text beginning with = + - @ is written with a leading apostrophe so
 *    Sheets stores it as text and never evaluates it as a formula.
 *  - Reads are cached for the lifetime of one request; writes keep the cache current.
 *  - The store never deletes rows. Corrections happen through reversals.
 */
function SheetStore_(ss, schema, tz) {
  var cache = {};

  function sheetOf(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Worksheet "' + name + '" is missing. Run setupDatabase() from the Apps Script editor.');
    return sh;
  }
  function load(name) {
    if (cache[name]) return cache[name];
    var sh = sheetOf(name);
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) throw new Error('Worksheet "' + name + '" has no header row. Run setupDatabase().');
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0].map(String);
    schema[name].cols.forEach(function (c) {
      if (headers.indexOf(c[0]) < 0) throw new Error('Worksheet "' + name + '" is missing column "' + c[0] + '". Run setupDatabase() to migrate.');
    });
    cache[name] = { sh: sh, headers: headers, rows: values.slice(1) };
    return cache[name];
  }
  function types(name) {
    var t = {};
    schema[name].cols.forEach(function (c) { t[c[0]] = c[1]; });
    return t;
  }
  function decode(name, row, headers) {
    var t = types(name), o = {};
    headers.forEach(function (h, i) {
      if (!t[h]) return;
      var v = row[i];
      if (t[h] === 'n') o[h] = v === '' || v === null ? 0 : Number(v);
      else if (t[h] === 'b') o[h] = v === true || String(v).toUpperCase() === 'TRUE';
      else {
        if (v instanceof Date) v = /_date$/.test(h) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
        v = v === null || v === undefined ? '' : String(v);
        if (/^'[=+\-@]/.test(v)) v = v.slice(1);
        o[h] = v;
      }
    });
    return o;
  }
  function encode(name, obj, headers) {
    var t = types(name);
    return headers.map(function (h) {
      var v = obj[h];
      if (!t[h]) return '';
      if (t[h] === 'n') { var n = Number(v); return isFinite(n) ? n : 0; }
      if (t[h] === 'b') return v === true || v === 'true' || v === 'TRUE';
      v = v === undefined || v === null ? '' : String(v);
      return /^[=+\-@]/.test(v) ? "'" + v : v;
    });
  }

  return {
    hasSheet: function (name) { return !!ss.getSheetByName(name); },
    read: function (name) {
      var c = load(name);
      return c.rows.filter(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); }).map(function (r) { return decode(name, r, c.headers); });
    },
    append: function (name, objs) {
      if (!objs.length) return;
      var c = load(name);
      var rows = objs.map(function (o) { return encode(name, o, c.headers); });
      var start = c.sh.getLastRow() + 1;
      c.sh.getRange(start, 1, rows.length, c.headers.length).setValues(rows);
      c.rows = c.rows.concat(rows);
    },
    update: function (name, keyField, id, patch) {
      var c = load(name);
      var ki = c.headers.indexOf(keyField);
      for (var i = 0; i < c.rows.length; i++) {
        if (String(c.rows[i][ki]) === String(id) || (c.rows[i][ki] instanceof Date && decode(name, c.rows[i], c.headers)[keyField] === id)) {
          var merged = decode(name, c.rows[i], c.headers);
          Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
          var row = encode(name, merged, c.headers);
          c.sh.getRange(i + 2, 1, 1, c.headers.length).setValues([row]);
          c.rows[i] = row;
          return decode(name, row, c.headers);
        }
      }
      throw new Error(name + ' row ' + id + ' not found');
    }
  };
}
