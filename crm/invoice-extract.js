/* ══════════════════════════════════════════════════════════════════════
   invoice-extract.js — read a GST tax invoice PDF (v11.53). Orders page.

   InvoiceExtract.fromFile(file) → { ok, invoiceNo, invoiceDate (yyyy-mm-dd),
     taxable, cgst, sgst, igst, gstAmount, gstPercent, total, roundOff, scanned }
   Works with the usual Tally / Busy / Zoho layouts: "Invoice No.", "Dated",
   "Taxable Value", CGST / SGST / IGST (or Central / State / Integrated Tax),
   "Round Off", "Total" / "Grand Total". Whatever is found is filled in and the
   person checks it before saving. Uses po-extract.js's PDF reader.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.InvoiceExtract) return;
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function num(s) {
    if (s == null) return null;
    var t = String(s).replace(/[₹]|rs\.?|inr/gi, '').replace(/\s+/g, '').replace(/\/-$/, '').replace(/^\((.*)\)$/, '-$1');
    if (!/^-?[\d,]*\.?\d+$/.test(t)) return null;
    var v = parseFloat(t.replace(/,/g, ''));
    return isNaN(v) ? null : v;
  }
  /** money values in a row: numbers with a decimal part or thousands commas (not "18%", not years / HSN codes) */
  function moneys(r) {
    var out = [];
    r.cells.forEach(function (c) {
      c.s.split(/\s+(?=[₹\d(-])/).forEach(function (p) {
        if (/%/.test(p)) return;
        var v = num(p);
        if (v == null) return;
        if (!/[.,]\d/.test(p) && Math.abs(v) < 100000 && !/^₹/.test(p)) { if (!/\.\d{2}$/.test(p)) return; }
        out.push(v);
      });
    });
    return out;
  }
  function pct(text) {
    var m = String(text).match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : null;
  }
  function isoDate(s) {
    var m = String(s).match(/(\d{1,2})[\/.\- ]([A-Za-z]{3,9}|\d{1,2})[\/.\-, ]+(\d{2,4})/);
    if (!m) return '';
    var d = +m[1], mo = /\d/.test(m[2]) ? +m[2] : MON[m[2].slice(0, 4).toLowerCase()] || MON[m[2].slice(0, 3).toLowerCase()], y = +m[3];
    if (y < 100) y += 2000;
    if (!mo || mo > 12 || d > 31) return '';
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  /** value of a label: the rest of its cell / the next cell, else the cell under it in the next row */
  function labelValue(rows, re, valRe) {
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].cells;
      for (var j = 0; j < cells.length; j++) {
        var c = cells[j], m = c.s.match(re);
        if (!m) continue;
        var rest = c.s.slice(m.index + m[0].length).replace(/^[\s:.\-#]+/, '').trim();
        if (rest && valRe.test(rest)) return rest.match(valRe)[0];
        if (cells[j + 1] && valRe.test(cells[j + 1].s) && cells[j + 1].x - (c.x + c.w) < 120) return cells[j + 1].s.match(valRe)[0];
        for (var k = i + 1; k < Math.min(rows.length, i + 3); k++) {
          var best = null;
          rows[k].cells.forEach(function (d) { if (Math.abs(d.x - c.x) < 40 || (d.x <= c.cx && d.x + d.w >= c.x)) { if (!best && valRe.test(d.s)) best = d; } });
          if (best) return best.s.match(valRe)[0];
        }
      }
    }
    return '';
  }
  function parse(rows) {
    var text = rows.map(function (r) { return r.text; }).join('\n');
    var R = { ok: false, invoiceNo: '', invoiceDate: '', taxable: null, cgst: null, sgst: null, igst: null, gstAmount: null, gstPercent: null, total: null, roundOff: null };
    R.invoiceNo = labelValue(rows, /(tax\s*)?invoice\s*(no|number|#)\.?/i, /[A-Z0-9][A-Z0-9\/\-_.]{1,}[0-9][A-Z0-9\/\-_.]*/i).replace(/[.,]$/, '');
    var ds = labelValue(rows, /(invoice\s*date|dated|date\s*of\s*invoice|^date)\b\.?/i, /\d{1,2}[\/.\- ](?:[A-Za-z]{3,9}|\d{1,2})[\/.\-, ]+\d{2,4}/);
    R.invoiceDate = isoDate(ds);
    var tax = { cgst: [], sgst: [], igst: [] }, taxable = [], totals = [], rates = { cgst: null, sgst: null, igst: null };
    rows.forEach(function (r) {
      var t = r.text, v = moneys(r);
      var k = /\b(cgst|central\s*tax)\b/i.test(t) ? 'cgst' : /\b(sgst|utgst|state\s*tax|ut\s*tax)\b/i.test(t) ? 'sgst' : /\b(igst|integrated\s*tax)\b/i.test(t) ? 'igst' : null;
      // a "CGST 9% 3,060.45" line (not the tax table header)
      if (k && v.length && !/taxable|hsn|total\s*tax/i.test(t)) { tax[k].push(v[v.length - 1]); if (pct(t) != null) rates[k] = pct(t); }
      if (/round(ed)?\s*off/i.test(t) && v.length) R.roundOff = v[v.length - 1];
      if (/taxable\s*(value|amount|amt)?/i.test(t) && v.length && !/total\s*tax/i.test(t)) taxable.push(Math.max.apply(null, v));
      if (/(grand\s*total|invoice\s*(total|value|amount)|total\s*amount|net\s*(amount|payable|total)|amount\s*payable|^total\b|\btotal\s*₹)/i.test(t) && !/total\s*tax|taxable|in\s*words/i.test(t) && v.length) totals.push(Math.max.apply(null, v));
    });
    // a tax table row "HSN 34,010.00 9% 3,060.90 9% 3,060.90 6,121.80"
    function first(a) { return a.length ? a[0] : null; }
    R.cgst = first(tax.cgst); R.sgst = first(tax.sgst); R.igst = first(tax.igst);
    R.total = totals.length ? Math.max.apply(null, totals) : null;
    R.taxable = taxable.length ? Math.max.apply(null, taxable.filter(function (x) { return R.total == null || x < R.total; }).concat([0])) || null : null;
    var g = (R.cgst || 0) + (R.sgst || 0) + (R.igst || 0);
    if (g > 0) R.gstAmount = Math.round(g * 100) / 100;
    if (R.taxable == null && R.total != null && R.gstAmount != null) R.taxable = Math.round((R.total - R.gstAmount - (R.roundOff || 0)) * 100) / 100;
    if (R.gstAmount == null && R.total != null && R.taxable != null && R.total > R.taxable) R.gstAmount = Math.round((R.total - R.taxable - (R.roundOff || 0)) * 100) / 100;
    if (rates.igst) R.gstPercent = rates.igst; else if (rates.cgst || rates.sgst) R.gstPercent = (rates.cgst || rates.sgst) * 2;
    if (!R.gstPercent && R.taxable && R.gstAmount) {
      var p = R.gstAmount / R.taxable * 100;
      [5, 12, 18, 28].forEach(function (s) { if (Math.abs(p - s) < 0.6) R.gstPercent = s; });
    }
    R.ok = !!(R.total || R.taxable || R.invoiceNo);
    R.text = text;
    return R;
  }
  function fromFile(file) {
    if (!file || !(/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf')) return Promise.resolve({ ok: false, notPdf: true });
    if (!window.POExtract) return Promise.resolve({ ok: false });
    return file.arrayBuffer().then(function (buf) {
      return POExtract._lib().then(function (pdfjs) { return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise; });
    }).then(POExtract._readRows).then(function (rows) {
      if (!rows.length) return { ok: false, scanned: true };
      return parse(rows);
    });
  }
  window.InvoiceExtract = { fromFile: fromFile, _parse: parse };
})();
