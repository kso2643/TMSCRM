/* ══════════════════════════════════════════════════════════════════════
   POExtract — reads a customer's purchase-order PDF in the browser (PDF.js)
   and pulls out the item lines (code, description, qty, unit price, amount),
   the PO number / date and the total value. Works with different PO layouts:

     1. find the table heading row (Qty + Rate/Price/Amount …) and use its
        column positions to read every row under it, until "Total";
     2. if there is no recognisable heading, read rows that end in
        qty · rate · amount (qty × rate ≈ amount).

   A scanned PO (a picture, no text) cannot be read — the caller is told so.

     POExtract.fromFile(file) → Promise<{ ok, scanned, text, items[], total, poNumber, poDate }>
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.POExtract) return;

  var libP = null;
  function lib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = '/vendor/pdfjs/pdf.min.js';
      s.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; } catch (e) {} res(window.pdfjsLib); };
      s.onerror = function () { libP = null; rej(new Error('Could not load the PDF reader')); };
      document.head.appendChild(s);
    });
    return libP;
  }

  /** "1,23,456.50" / "₹ 1 234.5" / "1.234,50"(rare) → 123456.5 ; null when not a number */
  function num(s) {
    if (s == null) return null;
    var t = String(s).replace(/[₹$€]|rs\.?|inr/gi, '').replace(/\s+/g, '').replace(/\/-$/, '');
    if (!/^-?[\d,]*\.?\d+$/.test(t)) return null;
    var v = parseFloat(t.replace(/,/g, ''));
    return isNaN(v) ? null : v;
  }

  // ── PDF → rows of cells with x positions ───────────────────────────
  function readRows(doc) {
    var pages = [];
    for (var i = 1; i <= doc.numPages; i++) pages.push(i);
    return pages.reduce(function (p, n) {
      return p.then(function (all) {
        return doc.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          var bits = tc.items.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
            return { s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || (it.str.length * 4), h: Math.abs(it.transform[3]) || 8 };
          });
          bits.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
          var rows = [];
          bits.forEach(function (b) {
            var r = rows.length ? rows[rows.length - 1] : null;
            if (r && Math.abs(r.y - b.y) <= Math.max(2.5, b.h * 0.45)) r.bits.push(b); else rows.push({ y: b.y, bits: [b], page: n });
          });
          rows.forEach(function (r) {
            r.bits.sort(function (a, b) { return a.x - b.x; });
            // join pieces that touch into one cell
            var cells = [];
            r.bits.forEach(function (b) {
              var c = cells.length ? cells[cells.length - 1] : null;
              if (c && b.x - (c.x + c.w) < Math.max(3, b.h * 0.6)) { c.s += (b.x - (c.x + c.w) > b.h * 0.15 ? ' ' : '') + b.s; c.w = b.x + b.w - c.x; }
              else cells.push({ s: b.s, x: b.x, w: b.w });
            });
            cells.forEach(function (c) { c.s = c.s.replace(/\s+/g, ' ').trim(); c.cx = c.x + c.w / 2; });
            r.cells = cells.filter(function (c) { return c.s; });
            r.text = r.cells.map(function (c) { return c.s; }).join(' ');
          });
          return all.concat(rows);
        });
      });
    }, Promise.resolve([]));
  }

  var H = {
    code: /^(item\s*code|part\s*(no|number|#|code)|material\s*(code|no)|mat\.?\s*code|item\s*(no|#)|product\s*code|cat(alogue)?\.?\s*no|code|sku|drawing\s*no|ref(erence)?\s*no)\.?$/i,
    desc: /(description|particulars|material|item\s*name|product|item|goods|specification)/i,
    qty: /^(qty|quantity|qnty|order\s*qty|ord\.?\s*qty|po\s*qty|nos\.?|no\.?\s*of\s*(units|pcs))\.?$|\bqty\b|quantity/i,
    uom: /^(uom|unit|u\.?o\.?m\.?|units)$/i,
    rate: /(rate|unit\s*price|price|u\.?\s*price|basic|cost\s*per|per\s*unit|unit\s*cost|net\s*price)/i,
    disc: /(disc|discount)/i,
    amount: /(amount|value|total|line\s*total|net\s*amt|amt)/i,
    sl: /^(s\.?\s*no\.?|sl\.?(\s*no\.?)?|sr\.?(\s*no\.?)?|#|no\.?|line|item|pos)$/i
  };
  var STOP = /^(sub\s*-?total|total|grand\s*total|net\s*total|amount\s*in\s*words|rupees|taxable|cgst|sgst|igst|gst|terms|tax\s*amount|freight|packing|note)/i;

  /** Cells of 1–3 stacked rows merged into columns ("Unit" over "Price" → "Unit Price"). */
  function mergeRows(rs) {
    var cols = [];
    rs.forEach(function (r) {
      r.cells.forEach(function (c) {
        var hit = null;
        cols.forEach(function (k) { if (!hit && c.x < k.x + k.w + 2 && c.x + c.w > k.x - 2) hit = k; });
        if (hit) { hit.s += ' ' + c.s; var x2 = Math.max(hit.x + hit.w, c.x + c.w); hit.x = Math.min(hit.x, c.x); hit.w = x2 - hit.x; hit.cx = hit.x + hit.w / 2; }
        else cols.push({ s: c.s, x: c.x, w: c.w, cx: c.cx });
      });
    });
    cols.sort(function (a, b) { return a.x - b.x; });
    return { cells: cols, text: cols.map(function (c) { return c.s; }).join(' '), page: rs[0].page, y: rs[rs.length - 1].y };
  }
  function headerScore(r) {
    var t = r.text.toLowerCase();
    var hasQty = r.cells.some(function (c) { return H.qty.test(c.s); });
    var hasMoney = r.cells.some(function (c) { return H.rate.test(c.s) || H.amount.test(c.s); });
    if (!hasQty || !hasMoney || r.cells.length < 3 || t.length > 300) return 0;
    if (r.cells.filter(function (c) { return num(c.s) != null; }).length > 1) return 0;   // a data row, not a heading
    return r.cells.length + (r.cells.some(function (c) { return H.desc.test(c.s) || H.code.test(c.s); }) ? 3 : 0);
  }
  function findHeader(rows) {
    var best = null;
    for (var i = 0; i < rows.length; i++) {
      [[i], [i, i + 1], [i - 1, i], [i - 1, i, i + 1]].forEach(function (set) {
        if (set[0] < 0 || set[set.length - 1] >= rows.length) return;
        var rs = set.map(function (k) { return rows[k]; });
        for (var j = 1; j < rs.length; j++) if (rs[j].page !== rs[0].page || rs[j - 1].y - rs[j].y > 22) return;
        // every row of a heading is words — a row with two or more numbers is data
        if (rs.some(function (x) { return x.cells.filter(function (c) { return num(c.s) != null; }).length >= 2; })) return;
        var m = rs.length === 1 ? rows[i] : mergeRows(rs);
        var sc = headerScore(m) + 0.3 * (rs.length - 1);
        if (sc && (!best || sc > best.score)) best = { idx: set[set.length - 1], score: sc, row: m };
      });
    }
    return best;
  }

  function columnsFrom(row) {
    var cols = row.cells.map(function (c) {
      var s = c.s, k = null;
      if (H.sl.test(s)) k = 'sl';
      else if (H.code.test(s)) k = 'code';
      else if (/^hsn|sac$|^hsn\/sac/i.test(s)) k = 'hsn';
      else if (H.qty.test(s) && !H.rate.test(s)) k = 'qty';
      else if (H.uom.test(s)) k = 'uom';
      else if (H.disc.test(s)) k = 'disc';
      else if (H.rate.test(s) && !/total|amount|value/i.test(s)) k = 'rate';
      else if (H.amount.test(s)) k = 'amount';
      else if (H.desc.test(s)) k = 'desc';
      return { key: k, x: c.x, cx: c.cx, w: c.w, label: s };
    });
    var am = cols.filter(function (c) { return c.key === 'amount'; });
    if (am.length > 1) am.slice(0, -1).forEach(function (c) { if (!cols.some(function (x) { return x.key === 'rate'; })) c.key = 'rate'; else c.key = null; });
    return cols;
  }

  function nearestCol(cols, cell) {
    var best = null, d = 1e9;
    cols.forEach(function (c, i) {
      var inside = cell.cx >= c.x - 3 && cell.cx <= c.x + c.w + 3 ? -1000 : 0;
      var dd = inside + Math.min(Math.abs(c.cx - cell.cx), Math.abs(c.x - cell.x));
      if (dd < d) { d = dd; best = i; }
    });
    return best;
  }

  var CODE_RE = /\b(?=[A-Z0-9.\-\/]*\d)(?=[A-Z0-9.\-\/]*[A-Z])[A-Z0-9][A-Z0-9.\-\/]{3,}[A-Z0-9]\b/;
  function codeIn(s) {
    var toks = String(s || '').toUpperCase().split(/\s+/), best = '';
    toks.forEach(function (t) {
      t = t.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
      var m = t.match(CODE_RE);
      if (!m || /^(GST|CGST|SGST|IGST|HSN)/.test(m[0]) || /^\d+(MM|X\d+)?$/.test(m[0]) || /^M\d+X[\d.]+$/.test(m[0])) return;
      if (m[0].length > best.length) best = m[0];
    });
    return best;
  }
  function joinText(a, b) { a = (a || '').trim(); b = (b || '').trim(); if (!a) return b; if (!b) return a; return /[-\/]$/.test(a) ? a + b : a + ' ' + b; }

  /** A text run that crosses into the next column ("820750 10" under HSN | Qty) is split into words with estimated positions. */
  function splitCells(cells, cols) {
    var out = [];
    cells.forEach(function (c) {
      var crosses = cols.some(function (k) { return k.x > c.x + 4 && k.x < c.x + c.w - 4; });
      var nums = c.s.split(' ').filter(function (t) { return num(t) != null; }).length;
      if (!crosses || c.s.indexOf(' ') < 0 || nums < 2) { out.push(c); return; }
      var len = c.s.length, pos = 0;
      c.s.split(' ').forEach(function (tok) {
        var tx = c.x + c.w * (pos / len), tw = c.w * (tok.length / len);
        if (tok) out.push({ s: tok, x: tx, w: tw, cx: tx + tw / 2 });
        pos += tok.length + 1;
      });
    });
    // words that landed in the same column stay one phrase
    return out;
  }

  function tableItems(rows, hdr) {
    var cols = columnsFrom(hdr.row), lines = [];
    var hasCode = cols.some(function (c) { return c.key === 'code'; });
    for (var i = hdr.idx + 1; i < rows.length; i++) {
      var r = rows[i];
      if (r.page !== hdr.row.page && headerScore(r)) continue;            // heading repeated on the next page
      var first = r.cells[0] ? r.cells[0].s : '';
      if (STOP.test(first) || STOP.test(r.text)) { if (lines.some(function (l) { return l.item; })) break; else continue; }
      var f = {};
      splitCells(r.cells, cols).forEach(function (c) {
        var k = cols[nearestCol(cols, c)].key || 'desc';
        f[k] = f[k] ? f[k] + ' ' + c.s : c.s;
      });
      var q = num(f.qty && f.qty.split(' ')[0]);
      if (q != null && q > 0) {
        var it = { itemCode: hasCode ? (f.code || '').trim() : '', description: (f.desc || '').trim(), quantity: q,
                   unit: (f.uom || '').trim(), unitPrice: num(f.rate && f.rate.split(' ').pop()), amount: num(f.amount && f.amount.split(' ').pop()), discount: num(f.disc) };
        lines.push({ item: it, y: r.y, page: r.page, above: [], below: [] });
      } else {
        var t = joinText(f.code || '', f.desc || '');
        if (!t) t = r.text;
        if (t && !/^(hsn|note|remarks?)\b/i.test(t)) lines.push({ text: t, code: f.code || '', y: r.y, page: r.page });
      }
    }
    // text rows between item rows belong to the nearer item (descriptions printed above / below the numbers)
    var gaps = [];
    for (var g = 1; g < lines.length; g++) if (lines[g].page === lines[g - 1].page) gaps.push(lines[g - 1].y - lines[g].y);
    gaps.sort(function (a, b) { return a - b; });
    var lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
    lines.forEach(function (l, idx) {
      if (l.item) return;
      var prev = null, next = null;
      for (var a = idx - 1; a >= 0; a--) if (lines[a].item) { prev = lines[a]; break; }
      for (var b = idx + 1; b < lines.length; b++) if (lines[b].item) { next = lines[b]; break; }
      var dp = prev && prev.page === l.page ? prev.y - l.y : 1e9, dn = next && next.page === l.page ? l.y - next.y : 1e9;
      var tgt = dn < dp ? next : prev, d = Math.min(dp, dn);
      if (!tgt || d > lineGap * 3.5) return;
      if (tgt === next) tgt.above.push(l); else tgt.below.push(l);
    });
    return lines.filter(function (l) { return l.item; }).map(function (l) {
      var it = l.item, desc = '';
      l.above.forEach(function (x) { desc = joinText(desc, x.text); });
      desc = joinText(desc, it.description);
      l.below.forEach(function (x) { desc = joinText(desc, x.text); });
      it.description = desc.replace(/\s+/g, ' ').trim();
      if (!it.itemCode) { var codeTxt = l.above.concat(l.below).map(function (x) { return x.code; }).join(''); it.itemCode = codeIn(codeTxt) || codeIn(it.description); }
      if (it.unitPrice == null && it.amount != null && it.quantity) it.unitPrice = Math.round(it.amount / it.quantity * 100) / 100;
      if (it.amount == null && it.unitPrice != null) it.amount = Math.round(it.unitPrice * it.quantity * (1 - (it.discount || 0) / 100) * 100) / 100;
      return it;
    });
  }

  /** No heading row: rows that end with  qty  rate  amount  where qty × rate ≈ amount. */
  function looseItems(rows) {
    var items = [];
    rows.forEach(function (r) {
      var nums = [];
      r.cells.forEach(function (c, i) { c.s.split(' ').forEach(function (tok) { var v = num(tok); if (v != null) nums.push({ v: v, i: i, tok: tok }); }); });
      if (nums.length < 3) return;
      for (var k = nums.length - 3; k >= 0; k--) {
        var q = nums[k].v, rate = nums[k + 1].v, amt = nums[k + 2].v;
        if (q > 0 && q < 1e6 && rate > 0 && amt > 0 && Math.abs(q * rate - amt) <= Math.max(1, amt * 0.02)) {
          var words = r.cells.map(function (c) { return c.s; }).join(' ').split(/\s+/);
          var cut = words.lastIndexOf(nums[k].tok);
          var text = words.slice(0, cut).join(' ').replace(/^\d{1,3}[.)]?\s+/, '');
          var unit = '';
          var um = text.match(/\s(nos|no|pcs|pc|sets?|units?|ea|each|kg|mtr|m|box|pkt)\.?$/i);
          if (um) { unit = um[1]; text = text.slice(0, um.index).trim(); }
          var after = words.slice(cut + 1, cut + 2).join('');
          if (!unit && /^(nos|no|pcs|pc|sets?|units?|ea|each|kg|mtr|box|pkt)\.?$/i.test(after)) unit = after;
          items.push({ itemCode: codeIn(text), description: text, quantity: q, unit: unit, unitPrice: rate, amount: amt, discount: null });
          return;
        }
      }
    });
    return items;
  }

  function meta(rows, items) {
    var text = rows.map(function (r) { return r.text; }).join('\n');
    var poNumber = '', poDate = '', total = null;
    var m = text.match(/(?:p\.?\s*o\.?|purchase\s*order|order)\s*(?:no|number|#|ref)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-_.]{2,})/i);
    if (m) poNumber = m[1].replace(/[.,]$/, '');
    m = text.match(/(?:p\.?\s*o\.?\s*date|order\s*date|dated|date)\s*[:\-]?\s*(\d{1,2}[\/.\-](?:\d{1,2}|[A-Za-z]{3,9})[\/.\-]\d{2,4})/i);
    if (m) poDate = m[1];
    rows.forEach(function (r) {
      if (!/(grand\s*total|total\s*(amount|value|po\s*value|order\s*value)|net\s*(amount|value|total)|po\s*value|total\s*rs|^total\b)/i.test(r.text)) return;
      var vals = r.cells.map(function (c) { return num(c.s.split(' ').pop()); }).filter(function (v) { return v != null && v > 0; });
      if (vals.length) { var v = vals[vals.length - 1]; if (total == null || /grand|net|po\s*value|order\s*value/i.test(r.text) || v > total) total = v; }
    });
    var sum = items.reduce(function (a, it) { return a + (it.amount || 0); }, 0);
    return { text: text, poNumber: poNumber, poDate: poDate, total: total, itemsTotal: Math.round(sum * 100) / 100 };
  }

  function parseRows(rows) {
    var hdr = findHeader(rows);
    var items = hdr ? tableItems(rows, hdr) : [];
    if (!items.length) items = looseItems(rows);
    items = items.filter(function (it) { return it.description || it.itemCode; });
    var m = meta(rows, items);
    return { ok: items.length > 0, scanned: false, text: m.text, items: items, total: m.total, itemsTotal: m.itemsTotal, poNumber: m.poNumber, poDate: m.poDate, layout: hdr ? 'table' : 'rows' };
  }

  function fromFile(file) {
    if (!file || !/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') return Promise.resolve({ ok: false, scanned: false, notPdf: true, items: [] });
    return file.arrayBuffer().then(function (buf) {
      return lib().then(function (pdfjs) { return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise; });
    }).then(readRows).then(function (rows) {
      if (!rows.length) return { ok: false, scanned: true, items: [], text: '' };
      return parseRows(rows);
    });
  }

  window.POExtract = { fromFile: fromFile, _parseRows: parseRows, _num: num, _findHeader: findHeader, _columnsFrom: columnsFrom, _readRows: readRows, _lib: lib };
})();
