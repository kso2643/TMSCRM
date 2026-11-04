/* ══════════════════════════════════════════════════════════════════════
   Engineer notes — lesson content + quiz questions (v11.46).
   Each topic: { id, n, icon, title, sub, body (HTML with SVG pictures), qs: [MCQ] }
   MCQ: { q, o: [4 options], a: index of the right one, e: why }
   Speeds and feeds here are typical starting values for coated carbide —
   always check the tool maker's catalogue for the exact grade.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var C = { P: '#1d6fd1', M: '#e5b700', K: '#d9322b', N: '#2f9e44', S: '#c26a14', H: '#7a7f87' };
  function fig(svg, cap) { return '<figure class="en-fig">' + svg + '<figcaption>' + cap + '</figcaption></figure>'; }
  function box(kind, html) { return '<div class="en-box en-' + kind + '">' + html + '</div>'; }
  function tbl(head, rows) {
    return '<div class="en-tw"><table class="en-t"><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function poly(cx, cy, r, n, rot) { var p = []; for (var i = 0; i < n; i++) { var a = (rot + i * 360 / n) * Math.PI / 180; p.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1)); } return p.join(' '); }
  function rhomb(cx, cy, L, ang, fill) {   // rhombic insert with the given corner angle (degrees), long diagonal horizontal
    var a = ang * Math.PI / 360, dx = L * Math.cos(a), dy = L * Math.sin(a);
    return '<polygon points="' + (cx - dx) + ',' + cy + ' ' + cx + ',' + (cy - dy) + ' ' + (cx + dx) + ',' + cy + ' ' + cx + ',' + (cy + dy) + '" fill="' + fill + '" stroke="#334155" stroke-width="1.5"/>';
  }

  var T = [];

  // ── 1. Cutting tools ────────────────────────────────────────────────
  T.push({ id: 'tools', n: 1, icon: '🛠', title: 'What are cutting tools', sub: 'How metal cutting works, tool types, tool materials and coatings',
    body:
      '<p>A <b>cutting tool</b> removes metal from a workpiece as <b>chips</b>. The tool is harder than the work material and has a sharp wedge-shaped edge. ' +
      'Either the work turns (turning on a lathe) or the tool turns (milling, drilling on a VMC / HMC).</p>' +
      fig('<svg viewBox="0 0 420 220"><rect x="10" y="130" width="400" height="80" fill="#cbd5e1"/><text x="300" y="195" font-size="13" fill="#334155">Workpiece</text>' +
        '<path d="M190 130 L250 130 L235 60 L205 40 Z" fill="#94a3b8" stroke="#475569"/><text x="196" y="30" font-size="12" fill="#475569">Chip</text>' +
        '<polygon points="250,130 330,40 380,40 380,128 252,128" fill="#1e3a5f"/><text x="318" y="90" font-size="12" fill="#fff">Tool</text>' +
        '<line x1="250" y1="130" x2="250" y2="40" stroke="#ef4444" stroke-dasharray="4 3"/><path d="M250 70 A60 60 0 0 1 280 85" fill="none" stroke="#ef4444"/><text x="262" y="34" font-size="11" fill="#ef4444">rake angle γ</text>' +
        '<line x1="252" y1="130" x2="380" y2="130" stroke="#16a34a" stroke-dasharray="4 3"/><text x="262" y="148" font-size="11" fill="#16a34a">clearance angle α</text><text x="262" y="162" font-size="11" fill="#16a34a">(under the edge)</text>' +
        '<path d="M140 115 L100 115" stroke="#0f172a" marker-end="url(#ar)"/><defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#0f172a"/></marker></defs>' +
        '<text x="40" y="108" font-size="12" fill="#0f172a">cutting direction (Vc)</text></svg>',
        'The edge shears the metal; the chip slides up the rake face. Rake angle = how sharp; clearance angle = so the tool does not rub.') +
      '<h3>Main tool types</h3>' + tbl(['Tool', 'Machine', 'Used for'], [
        ['Turning insert + holder', 'CNC lathe', 'OD / ID turning, facing, profiling, grooving, threading'],
        ['Milling cutter (indexable)', 'VMC / HMC', 'Face milling, shoulder milling, slots, high-feed roughing'],
        ['Solid carbide end mill', 'VMC / HMC', 'Pockets, profiles, slots, finishing'],
        ['Drill (solid / indexable)', 'Any', 'Holes'],
        ['Tap, thread mill', 'Any', 'Threads'],
        ['Reamer, boring bar', 'Any', 'Accurate hole size and finish']]) +
      '<h3>Tool materials — from tough to hard</h3>' + tbl(['Material', 'What it is', 'Where used'], [
        ['HSS (high-speed steel)', 'Alloy steel, tough, low heat resistance', 'Taps, small drills, low speeds'],
        ['<b>Cemented carbide</b>', '<b>Tungsten carbide (WC) grains held by cobalt (Co) binder</b>', 'Most inserts, end mills, drills — the main product'],
        ['Cermet', 'Titanium carbo-nitride (TiCN) + nickel/cobalt', 'Finishing steel — very good surface finish'],
        ['Ceramic', 'Alumina or silicon nitride', 'Cast iron and heat-resistant alloys at high speed'],
        ['CBN', 'Cubic boron nitride (second hardest)', 'Hardened steel 45–65 HRC, hard turning'],
        ['PCD', 'Polycrystalline diamond (hardest)', 'Aluminium, copper, composites — never steel']]) +
      box('tip', '<b>Carbide grade = WC grain size + cobalt %.</b> More cobalt → tougher (does not chip), less cobalt → harder (lasts longer, runs faster). Fine grains → sharper, stronger edge.') +
      '<h3>Coatings</h3><p>A thin layer (2–20 µm) on carbide that resists heat and wear.</p>' + tbl(['Coating', 'Method', 'Good for'], [
        ['TiN (gold)', 'PVD', 'General purpose, HSS and carbide'],
        ['TiCN (grey-violet)', 'PVD / CVD', 'Abrasive wear, steel'],
        ['TiAlN / AlTiN (dark violet-black)', 'PVD', 'High heat — steel, stainless, hard milling, dry cutting'],
        ['Al₂O₃ (black/yellow layers)', 'CVD', 'Turning steel and cast iron at high speed (heat barrier)'],
        ['DLC / ZrN / uncoated polished', 'PVD', 'Aluminium and non-ferrous (no built-up edge)']]) +
      box('note', '<b>CVD</b> = thick, very wear resistant, slightly rounded edge → turning steel / cast iron. <b>PVD</b> = thin, sharp edge, tougher → milling, stainless, superalloys, small parts.'),
    qs: [
      { q: 'Cemented carbide is made of…', o: ['Tungsten carbide grains in a cobalt binder', 'Diamond in nickel', 'Alumina and silicon', 'High-speed steel with chromium'], a: 0, e: 'Carbide = WC grains + Co binder.' },
      { q: 'More cobalt in a carbide grade makes it…', o: ['Tougher', 'Harder and more wear resistant', 'Better for aluminium only', 'Ceramic'], a: 0, e: 'Cobalt is the tough binder: more Co = tougher, less Co = harder.' },
      { q: 'Which tool material is used for hardened steel at 55–62 HRC?', o: ['CBN', 'PCD', 'HSS', 'Uncoated carbide'], a: 0, e: 'CBN is made for hard turning. PCD (diamond) reacts with iron.' },
      { q: 'PCD (diamond) tools should never be used on…', o: ['Steel', 'Aluminium', 'Copper', 'Carbon fibre'], a: 0, e: 'Carbon in diamond dissolves into iron at cutting heat.' },
      { q: 'The clearance angle on a tool is there to…', o: ['Stop the tool rubbing on the work', 'Break the chip', 'Hold the insert', 'Cool the edge'], a: 0, e: 'Clearance = gap below the edge so the flank does not rub.' },
      { q: 'CVD coatings are mostly used for…', o: ['Turning steel and cast iron', 'Sharp end mills for aluminium', 'Taps', 'PCD tools'], a: 0, e: 'CVD is thick and wear resistant — turning steel and cast iron.' },
      { q: 'PVD coatings are preferred when you need…', o: ['A sharp, tough edge (milling, stainless)', 'The thickest coating', 'Cutting cast iron at very high speed', 'No coating'], a: 0, e: 'PVD is thin and keeps the edge sharp.' },
      { q: 'Cermet is best known for…', o: ['Excellent surface finish on steel', 'Roughing cast iron', 'Hard turning above 60 HRC', 'Cutting aluminium'], a: 0, e: 'Cermet gives very good finish in steel finishing.' }
    ] });

  // ── 2. Materials ────────────────────────────────────────────────────
  T.push({ id: 'materials', n: 2, icon: '🧱', title: 'Work materials (ISO P M K N S H)', sub: 'The six material groups, colours, examples and how they cut',
    body:
      '<p>Every tool catalogue sorts work materials into <b>six ISO groups</b>, each with a colour. The group decides the grade, the speed and the chip breaker.</p>' +
      fig('<svg viewBox="0 0 600 200">' + [['P', 'Steel', 'C45, EN8/EN19, 20MnCr5'], ['M', 'Stainless', 'SS304, SS316, duplex'], ['K', 'Cast iron', 'GG25 (grey), SG iron'],
        ['N', 'Non-ferrous', 'Aluminium, brass, copper'], ['S', 'Superalloys & titanium', 'Inconel 718, Ti6Al4V'], ['H', 'Hardened', 'D2, EN31, 45–65 HRC']].map(function (g, i) {
        var x = 10 + i * 98; return '<rect x="' + x + '" y="10" width="92" height="180" rx="10" fill="' + C[g[0]] + '"/><text x="' + (x + 46) + '" y="70" font-size="44" font-weight="800" fill="#fff" text-anchor="middle">' + g[0] + '</text>' +
          '<text x="' + (x + 46) + '" y="105" font-size="12.5" font-weight="700" fill="#fff" text-anchor="middle">' + g[1].split(' & ')[0] + '</text>' + (g[1].indexOf(' & ') > 0 ? '<text x="' + (x + 46) + '" y="121" font-size="12.5" font-weight="700" fill="#fff" text-anchor="middle">&amp; ' + g[1].split(' & ')[1] + '</text>' : '') +
          g[2].split(', ').map(function (t, k) { return '<text x="' + (x + 46) + '" y="' + (145 + k * 14) + '" font-size="10.5" fill="#fff" text-anchor="middle">' + t + '</text>'; }).join('');
      }).join('') + '</svg>', 'ISO material groups and their colours — the same colours are printed on insert boxes.') +
      tbl(['Group', 'Materials', 'How it cuts', 'Watch out for'], [
        ['<b style="color:' + C.P + '">P</b> Steel', 'Carbon & alloy steel, low-alloy, tool steel (soft)', 'Long chips, good machinability', 'Chip control — use the right chip breaker'],
        ['<b style="color:#a68400">M</b> Stainless', 'Austenitic (304/316), ferritic, martensitic, duplex', 'Work hardens, sticky, high heat', 'Built-up edge, notch wear — keep feed up, sharp PVD edge'],
        ['<b style="color:' + C.K + '">K</b> Cast iron', 'Grey (GG), nodular (SG/GGG), CGI', 'Short chips, abrasive', 'Flank wear; dust — usually dry or with CVD Al₂O₃'],
        ['<b style="color:' + C.N + '">N</b> Non-ferrous', 'Aluminium alloys, copper, brass, plastics', 'Soft, very high speed possible', 'Built-up edge — sharp polished uncoated / PCD, big chip space'],
        ['<b style="color:' + C.S + '">S</b> HRSA & Ti', 'Inconel, Hastelloy, Nimonic, titanium', 'Very high heat, low speed', 'Notch wear, work hardening — low Vc, sharp PVD, coolant'],
        ['<b style="color:' + C.H + '">H</b> Hardened', 'Hardened steel 45–65 HRC, chilled cast iron', 'Hard, high cutting force', 'Use CBN / ceramic or special hard-milling grades']]) +
      '<h3>Hardness tells you a lot</h3><p>Ask the customer for the <b>material grade and hardness</b> (HB or HRC) every time. The same EN24 at 250 HB and at 40 HRC needs different speeds and grades.</p>' +
      box('tip', '<b>Indian names you will hear:</b> EN8 ≈ C45 (medium carbon steel), EN19 ≈ 42CrMo4, EN24 ≈ 34CrNiMo6, EN31 = bearing steel (52100), EN353 / 20MnCr5 = case-hardening steels, D2 / D3 = die steels, GG25 = grey cast iron, SG 500/7 = nodular iron.'),
    qs: [
      { q: 'Which ISO group is stainless steel?', o: ['M', 'P', 'K', 'S'], a: 0, e: 'M (yellow) = stainless steels.' },
      { q: 'The colour of ISO group K (cast iron) is…', o: ['Red', 'Blue', 'Green', 'Yellow'], a: 0, e: 'K = red.' },
      { q: 'Inconel 718 belongs to group…', o: ['S', 'M', 'H', 'N'], a: 0, e: 'S = heat-resistant superalloys and titanium.' },
      { q: 'Aluminium alloys are group…', o: ['N', 'K', 'P', 'M'], a: 0, e: 'N (green) = non-ferrous.' },
      { q: 'A hardened die steel at 58 HRC is group…', o: ['H', 'P', 'S', 'K'], a: 0, e: 'H = hardened materials above ~45 HRC.' },
      { q: 'Stainless steel is difficult because it…', o: ['Work hardens and is sticky', 'Is very brittle', 'Is softer than aluminium', 'Makes dust'], a: 0, e: 'Austenitic stainless work-hardens and forms built-up edge.' },
      { q: 'EN8 is close to which steel?', o: ['C45 medium carbon steel', 'SS304 stainless', 'Inconel', 'Grey cast iron'], a: 0, e: 'EN8 ≈ C45 / 080M40.' },
      { q: 'Before recommending a tool you must always ask for…', o: ['Material grade and hardness', 'The colour of the machine', 'The operator name', 'The coolant brand only'], a: 0, e: 'Grade + hardness decide the tool grade and speed.' },
      { q: 'Grey cast iron chips are usually…', o: ['Short and broken', 'Long and stringy', 'Sticky and welded', 'Blue and curly'], a: 0, e: 'Cast iron gives short chips — chip control is easy, abrasion is the problem.' }
    ] });

  // ── 3. Turning inserts: shape, ISO code, size ──────────────────────
  var shapes = [['C', 80, 'Rhombic 80°'], ['D', 55, 'Rhombic 55°'], ['V', 35, 'Rhombic 35°'], ['S', 90, 'Square 90°']];
  T.push({ id: 'inserts', n: 3, icon: '🔷', title: 'Turning inserts — type, ISO code and size', sub: 'Read any insert code step by step: shape, clearance, tolerance, type, size, thickness, nose radius',
    body:
      '<p>Every turning insert has an <b>ISO 1832 code</b>. Learn to read it and you can match any brand.</p>' +
      fig('<svg viewBox="0 0 620 330">' + [['C', 'Shape', '80° rhombic'], ['N', 'Clearance', '0° (negative)'], ['M', 'Tolerance', 'moulded (±)'], ['G', 'Type', 'hole + breaker both sides'],
        ['12', 'Edge length', '12 mm (≈12.9)'], ['04', 'Thickness', '4.76 mm'], ['08', 'Nose radius', '0.8 mm'], ['PM', 'Chip breaker', 'maker code: P steel, M medium']].map(function (c, i) {
        var col = ['#1d4ed8', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#ca8a04', '#475569'][i];
        var x = 20 + (i % 4) * 150, y = i < 4 ? 14 : 162;
        return '<rect x="' + x + '" y="' + y + '" width="130" height="54" rx="9" fill="' + col + '"/><text x="' + (x + 65) + '" y="' + (y + 38) + '" font-size="28" font-weight="800" fill="#fff" text-anchor="middle">' + c[0] + '</text>' +
          '<text x="' + (x + 65) + '" y="' + (y + 76) + '" font-size="13" font-weight="700" fill="' + col + '" text-anchor="middle">' + (i + 1) + '. ' + c[1] + '</text>' +
          '<text x="' + (x + 65) + '" y="' + (y + 95) + '" font-size="11.5" fill="#334155" text-anchor="middle">' + c[2] + '</text>';
      }).join('') + '<text x="310" y="318" font-size="15" fill="#0f172a" text-anchor="middle" font-weight="800">C N M G 12 04 08 – PM</text></svg>', 'The insert code CNMG 120408-PM, position by position.') +
      '<h3>Step 1 — Shape (1st letter)</h3>' +
      fig('<svg viewBox="0 0 640 170">' + shapes.map(function (s, i) {
        var x = 70 + i * 110; return (s[0] === 'S' ? '<rect x="' + (x - 38) + '" y="40" width="76" height="76" fill="#bfdbfe" stroke="#334155" stroke-width="1.5"/>' : rhomb(x, 78, 55, s[1], '#bfdbfe')) +
          '<text x="' + x + '" y="145" font-size="15" font-weight="800" text-anchor="middle">' + s[0] + '</text><text x="' + x + '" y="162" font-size="11" text-anchor="middle" fill="#475569">' + s[2] + '</text>';
      }).join('') +
        '<polygon points="' + poly(510, 80, 45, 3, -90) + '" fill="#bfdbfe" stroke="#334155" stroke-width="1.5"/><text x="510" y="145" font-size="15" font-weight="800" text-anchor="middle">T</text><text x="510" y="162" font-size="11" text-anchor="middle" fill="#475569">Triangle 60°</text>' +
        '<circle cx="600" cy="80" r="34" fill="#bfdbfe" stroke="#334155" stroke-width="1.5"/><text x="600" y="145" font-size="15" font-weight="800" text-anchor="middle">R</text><text x="600" y="162" font-size="11" text-anchor="middle" fill="#475569">Round</text></svg>',
        'Common insert shapes (W = trigon 80° is also common). Bigger corner angle = stronger edge; smaller angle = better access for profiling.') +
      tbl(['Shape', 'Corner', 'Strength', 'Use'], [['R round', '—', 'Strongest', 'Roughing, copying, heat-resistant alloys'], ['S square', '90°', 'Very strong', 'Roughing, chamfering, facing'],
        ['C rhombic', '80°', 'Strong', 'Most popular — turning + facing'], ['W trigon', '80°', 'Strong', 'Turning + facing, 6 edges (negative)'],
        ['T triangle', '60°', 'Medium', 'General turning, 3 or 6 edges'], ['D rhombic', '55°', 'Medium', 'Profiling, copying'], ['V rhombic', '35°', 'Weakest', 'Fine profiling, back-turning, finishing']]) +
      '<h3>Step 2 — Clearance angle (2nd letter)</h3>' + tbl(['Letter', 'Angle', 'Meaning'], [['N', '0°', '<b>Negative insert</b> — double-sided, strong, many edges, for roughing / general'], ['B', '5°', 'Positive'], ['C', '7°', '<b>Positive</b> — single-sided, light cutting, small boring bars, finishing'], ['P', '11°', 'Positive, very free cutting']]) +
      fig('<svg viewBox="0 0 440 150"><text x="80" y="20" font-size="12" font-weight="700" text-anchor="middle">Negative (N, 0°)</text><rect x="30" y="40" width="100" height="40" fill="#bfdbfe" stroke="#334155"/>' +
        '<text x="80" y="105" font-size="11" text-anchor="middle" fill="#475569">tilted in the holder →</text><text x="80" y="120" font-size="11" text-anchor="middle" fill="#475569">both sides usable</text>' +
        '<text x="320" y="20" font-size="12" font-weight="700" text-anchor="middle">Positive (C, 7°)</text><polygon points="270,40 370,40 362,80 278,80" fill="#bbf7d0" stroke="#334155"/>' +
        '<text x="320" y="105" font-size="11" text-anchor="middle" fill="#475569">built-in clearance →</text><text x="320" y="120" font-size="11" text-anchor="middle" fill="#475569">light, sharp cutting</text></svg>', 'Side view: a negative insert has straight sides, a positive insert has sloping sides.') +
      '<h3>Step 3 — Tolerance (3rd letter)</h3><p><b>M</b> (moulded, wider tolerance) is the normal choice. <b>G</b> or <b>E</b> are ground — tighter, for precision and sharp edges.</p>' +
      '<h3>Step 4 — Type: hole and chip breaker (4th letter)</h3>' + tbl(['Letter', 'Hole', 'Chip breaker'], [['G', 'Yes (cylindrical)', 'Both sides'], ['M', 'Yes', 'One side'], ['T', '40–60° countersunk', 'One side (screw clamp positive)'], ['W', '40–60° countersunk', 'None'], ['A', 'Yes', 'None'], ['N', 'No hole', 'None (clamp on top)']]) +
      '<h3>Step 5 — Size (2 digits): cutting edge length</h3><p>Rounded mm of the edge length. <b>CNMG 12</b>… has a 12.9 mm edge (12.7 mm inscribed circle ½"). Bigger insert = deeper cut possible: as a rule the depth of cut should stay below about ⅔ of the edge length.</p>' +
      tbl(['Insert', 'IC (inscribed circle)', 'Typical max ap'], [['CNMG 09…', '9.525 mm', '~4 mm'], ['CNMG 12…', '12.7 mm', '~6–8 mm'], ['CNMG 16…', '15.875 mm', '~8–10 mm'], ['CNMG 19…', '19.05 mm', '~10–12 mm']]) +
      '<h3>Step 6 — Thickness (2 digits)</h3><p><b>04</b> = 4.76 mm, <b>06</b> = 6.35 mm, <b>07</b> = 7.94 mm. Thicker = stronger for heavy roughing.</p>' +
      '<h3>Step 7 — Nose radius (2 digits)</h3>' +
      fig('<svg viewBox="0 0 420 150"><path d="M40 120 L140 120 Q170 120 170 90 L170 20" fill="none" stroke="#1d4ed8" stroke-width="4"/><text x="105" y="140" font-size="11" text-anchor="middle">small radius 0.4</text>' +
        '<path d="M240 120 L300 120 Q370 120 370 50 L370 20" fill="none" stroke="#16a34a" stroke-width="4"/><text x="305" y="140" font-size="11" text-anchor="middle">large radius 1.2</text></svg>',
        '<b>02</b> = 0.2 mm, <b>04</b> = 0.4, <b>08</b> = 0.8, <b>12</b> = 1.2, <b>16</b> = 1.6. Small radius: finishing, low cutting force, less vibration. Large radius: stronger edge, higher feed, roughing.') +
      box('tip', '<b>Finish rule:</b> theoretical surface roughness Rmax ≈ f² ÷ (8 × r) × 1000 µm (f in mm/rev, r = nose radius in mm). Example f = 0.2, r = 0.8 → 0.04 ÷ 6.4 × 1000 ≈ 6.25 µm Rmax (about Ra 1.6). Double the feed → 4× rougher.') +
      '<h3>Step 8 — Chip breaker (after the dash)</h3><p>Maker-specific. Usually <b>F / FF</b> = finishing (small ap, low feed), <b>M</b> = medium, <b>R / RR</b> = roughing. First letter often tells the material: P (steel), M (stainless), K (cast iron).</p>',
    qs: [
      { q: 'In CNMG 120408, what is the nose radius?', o: ['0.8 mm', '0.4 mm', '8 mm', '1.2 mm'], a: 0, e: 'Last two digits 08 = 0.8 mm.' },
      { q: 'The letter C at the start of CNMG means…', o: ['80° rhombic shape', 'Clearance 7°', 'Coated', 'Cast iron'], a: 0, e: 'First position = shape. C = 80° rhombic.' },
      { q: 'The N in CNMG (2nd letter) means…', o: ['0° clearance — a negative insert', 'No hole', 'Non-ferrous', 'Nose radius'], a: 0, e: '2nd letter = clearance angle. N = 0°.' },
      { q: 'Which shape is the strongest?', o: ['R (round)', 'V (35°)', 'D (55°)', 'T (60°)'], a: 0, e: 'The bigger the corner angle, the stronger. Round is strongest.' },
      { q: 'Which insert gives the best access for fine profiling?', o: ['V 35°', 'S 90°', 'R round', 'C 80°'], a: 0, e: 'The smallest corner angle reaches into profiles.' },
      { q: 'Thickness code 04 means…', o: ['4.76 mm', '4 mm exactly', '0.4 mm', '40 mm'], a: 0, e: '04 = 4.76 mm (3/16").' },
      { q: 'A larger nose radius gives…', o: ['A stronger edge and allows higher feed', 'Less vibration on slender parts', 'Always a worse finish', 'Smaller cutting force'], a: 0, e: 'Large radius = strong edge, roughing. But it raises cutting force and vibration.' },
      { q: 'Positive inserts (e.g. CCMT) are preferred for…', o: ['Light cuts, small boring bars, finishing', 'Heavy roughing of forgings', 'Interrupted cuts in cast iron', 'Hard turning with CBN'], a: 0, e: 'Positive = built-in clearance = light, free cutting.' },
      { q: 'A chip breaker marked F or FF is for…', o: ['Finishing', 'Heavy roughing', 'Threading', 'Grooving'], a: 0, e: 'F = finishing (small ap, low feed).' },
      { q: 'Feed 0.2 mm/rev, nose radius 0.8 mm → Rmax is about…', o: ['6.25 µm', '0.625 µm', '62.5 µm', '25 µm'], a: 0, e: 'f²/(8r)×1000 = 0.04/6.4×1000 = 6.25 µm.' },
      { q: 'The 4th letter G in CNMG means…', o: ['Hole with chip breaker on both sides', 'Ground tolerance', 'Grade', 'No hole'], a: 0, e: '4th letter = type (hole + chip breaker). G = hole + both sides.' }
    ] });

  // ── 4. Grades ───────────────────────────────────────────────────────
  T.push({ id: 'grades', n: 4, icon: '🎯', title: 'Insert grades — which grade for which material', sub: 'P01–P50, M, K… wear resistance vs toughness, and a quick selection table',
    body:
      '<p>The <b>grade</b> is the carbide recipe + coating. Catalogues show it with the ISO group and a number from 01 to 50.</p>' +
      fig('<svg viewBox="0 0 600 150"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#93c5fd"/></linearGradient></defs>' +
        '<rect x="40" y="50" width="520" height="34" rx="6" fill="url(#gg)"/>' + ['01', '10', '20', '30', '40', '50'].map(function (t, i) { return '<text x="' + (70 + i * 92) + '" y="73" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">P' + t + '</text>'; }).join('') +
        '<path d="M40 110 L560 110" stroke="#0f172a" stroke-width="2" marker-end="url(#a2)"/><path d="M560 30 L40 30" stroke="#0f172a" stroke-width="2" marker-end="url(#a2)"/>' +
        '<defs><marker id="a2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z"/></marker></defs>' +
        '<text x="300" y="132" font-size="12" text-anchor="middle">more TOUGHNESS → roughing, interrupted cuts, unstable set-ups, lower speed</text>' +
        '<text x="300" y="22" font-size="12" text-anchor="middle">← more WEAR RESISTANCE (hardness) → finishing, continuous cuts, higher speed</text></svg>', 'Low number = hard and wear resistant. High number = tough.') +
      '<h3>Step by step: choosing a grade</h3><ol><li><b>Material group</b> — P, M, K, N, S or H (from the material and hardness).</li><li><b>Operation</b> — finishing (F), medium (M) or roughing (R).</li>' +
      '<li><b>Conditions</b> — good (continuous cut, rigid, coolant) → harder grade (lower number). Difficult (interrupted, scale, long overhang) → tougher grade (higher number).</li><li><b>Coating</b> — CVD for turning steel / cast iron; PVD for stainless, superalloys, milling and sharp edges.</li></ol>' +
      tbl(['Material', 'Typical grade area', 'Coating', 'Start Vc turning (m/min)', 'Start Vc milling (m/min)'], [
        ['<b style="color:' + C.P + '">P</b> steel ~200 HB', 'P15–P25', 'CVD (TiCN + Al₂O₃)', '200–300', '180–260'],
        ['<b style="color:#a68400">M</b> stainless 304/316', 'M15–M25', 'CVD or PVD', '150–220', '130–200'],
        ['<b style="color:' + C.K + '">K</b> grey cast iron', 'K10–K20', 'CVD Al₂O₃', '220–350', '200–300'],
        ['<b style="color:' + C.N + '">N</b> aluminium', 'N10–N20', 'Uncoated polished / PCD', '400–1500', '500–2000+'],
        ['<b style="color:' + C.S + '">S</b> Inconel 718', 'S15–S25', 'PVD', '30–60', '25–50'],
        ['<b style="color:' + C.S + '">S</b> titanium Ti6Al4V', 'S10–S20', 'PVD / uncoated', '50–90', '40–70'],
        ['<b style="color:' + C.H + '">H</b> hardened 55–60 HRC', 'H10–H20 / CBN', 'CBN (turning), AlTiN (milling)', '100–200 (CBN)', '60–150']]) +
      box('warn', 'These speeds are typical starting values for coated carbide. Always check the maker’s catalogue for the exact grade, then adjust on the machine.') +
      box('tip', '<b>Problem → change the grade:</b> edge chipping / breakage → tougher grade (higher number). Fast flank wear / crater → harder grade (lower number) or lower speed. Plastic deformation (edge sags, red hot) → harder grade, lower speed.'),
    qs: [
      { q: 'Compared with P30, a P10 grade is…', o: ['More wear resistant, less tough', 'Tougher, less wear resistant', 'For aluminium', 'Uncoated'], a: 0, e: 'Low number = hard and wear resistant.' },
      { q: 'For an interrupted cut with an unstable set-up you should choose…', o: ['A tougher grade (higher number)', 'A harder grade (lower number)', 'PCD', 'Ceramic'], a: 0, e: 'Toughness prevents chipping in interrupted cuts.' },
      { q: 'Which coating is typical for turning grey cast iron?', o: ['CVD with Al₂O₃', 'Uncoated polished', 'DLC', 'No coating, HSS'], a: 0, e: 'CVD Al₂O₃ resists abrasion and heat in cast iron.' },
      { q: 'A good starting Vc for turning Inconel 718 with carbide is about…', o: ['30–60 m/min', '200–300 m/min', '600 m/min', '5 m/min'], a: 0, e: 'Superalloys need low speed: about 30–60 m/min.' },
      { q: 'The edge keeps chipping. What do you change first?', o: ['Go to a tougher grade', 'Go to a harder grade', 'Increase speed a lot', 'Use a smaller insert'], a: 0, e: 'Chipping = edge not tough enough.' },
      { q: 'Fast flank wear in a continuous cut suggests…', o: ['A harder grade or lower speed', 'A tougher grade', 'More feed only', 'A bigger nose radius only'], a: 0, e: 'Wear = not wear-resistant enough or speed too high.' },
      { q: 'For aluminium the best choice is usually…', o: ['Sharp uncoated polished carbide or PCD', 'CVD Al₂O₃ coated', 'CBN', 'Ceramic'], a: 0, e: 'Aluminium sticks — sharp polished edges / PCD.' },
      { q: 'For hard turning at 58 HRC use…', o: ['CBN', 'Uncoated carbide', 'HSS', 'PCD'], a: 0, e: 'CBN for hardened steel.' }
    ] });

  // ── 5. Milling cutters ──────────────────────────────────────────────
  T.push({ id: 'cutters', n: 5, icon: '⚙', title: 'Milling cutters', sub: 'Face mills, shoulder mills, entering angle, pitch, up / down milling and chip thinning',
    body:
      '<p>An <b>indexable milling cutter</b> is a body with several insert pockets. It rotates; the table moves the work.</p>' +
      fig('<svg viewBox="0 0 620 210"><text x="150" y="18" font-size="13" font-weight="700" text-anchor="middle">Face mill — 45° entering angle</text>' +
        '<rect x="60" y="30" width="180" height="70" fill="#64748b"/><polygon points="60,100 90,100 75,130 45,130" fill="#1e3a5f"/><polygon points="210,100 240,100 255,130 225,130" fill="#1e3a5f"/>' +
        '<rect x="20" y="130" width="260" height="60" fill="#cbd5e1"/><text x="150" y="168" font-size="11" text-anchor="middle">thin chips, smooth entry, good for faces</text>' +
        '<text x="460" y="18" font-size="13" font-weight="700" text-anchor="middle">Shoulder mill — 90°</text><rect x="370" y="30" width="180" height="70" fill="#64748b"/>' +
        '<rect x="370" y="100" width="22" height="40" fill="#1e3a5f"/><rect x="528" y="100" width="22" height="40" fill="#1e3a5f"/><rect x="330" y="140" width="260" height="50" fill="#cbd5e1"/>' +
        '<path d="M550 100 L550 140" stroke="#ef4444" stroke-width="2"/><text x="470" y="170" font-size="11" text-anchor="middle">true 90° wall (shoulder)</text></svg>', 'Entering angle κr: 45° spreads the load (chip is thinner than the feed), 90° makes a square shoulder.') +
      tbl(['Cutter', 'Entering angle', 'Use'], [['Face mill', '45° (also 60°, 75°)', 'Facing flat surfaces, best general facing'], ['Square shoulder mill', '90°', 'Shoulders, walls, facing thin parts'], ['High-feed mill', '10–17°', 'Very fast roughing with small ap, big feed'], ['Round-insert mill', 'varies', 'Copying, strong roughing, superalloys'], ['Disc / side & face', '—', 'Slots, grooves, straddle milling']]) +
      '<h3>Pitch — how many teeth</h3>' + tbl(['Pitch', 'Teeth (Ø80 example)', 'Use'], [['Coarse', '4–5', 'Long overhang, unstable, low power, roughing'], ['Close (normal)', '6', 'General'], ['Extra close', '8–9', 'Short chips (cast iron), stable set-up, high productivity']]) +
      '<h3>Down milling (climb) vs up milling (conventional)</h3>' +
      fig('<svg viewBox="0 0 600 190"><circle cx="150" cy="80" r="50" fill="#e2e8f0" stroke="#334155"/><path d="M150 30 A50 50 0 0 1 200 80" fill="none" stroke="#16a34a" stroke-width="4"/><text x="150" y="85" text-anchor="middle" font-size="12">↻</text>' +
        '<rect x="40" y="130" width="220" height="40" fill="#cbd5e1"/><path d="M250 150 L210 150" stroke="#0f172a" marker-end="url(#a3)"/><text x="150" y="20" font-size="13" font-weight="700" text-anchor="middle">Down (climb) — preferred</text>' +
        '<text x="150" y="185" font-size="11" text-anchor="middle">chip starts thick, ends thin → less heat, better life</text>' +
        '<circle cx="450" cy="80" r="50" fill="#e2e8f0" stroke="#334155"/><path d="M400 80 A50 50 0 0 1 450 30" fill="none" stroke="#ef4444" stroke-width="4"/><text x="450" y="85" text-anchor="middle" font-size="12">↻</text>' +
        '<rect x="340" y="130" width="220" height="40" fill="#cbd5e1"/><path d="M350 150 L390 150" stroke="#0f172a" marker-end="url(#a3)"/><text x="450" y="20" font-size="13" font-weight="700" text-anchor="middle">Up (conventional)</text>' +
        '<text x="450" y="185" font-size="11" text-anchor="middle">chip starts at zero → rubbing, more heat</text>' +
        '<defs><marker id="a3" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z"/></marker></defs></svg>', 'Use down milling on CNC machines whenever possible.') +
      '<h3>Key milling words</h3>' + tbl(['Symbol', 'Name', 'Meaning'], [['ap', 'Axial depth of cut', 'How deep along the cutter axis (mm)'], ['ae', 'Radial width of cut', 'How much of the diameter is engaged (mm)'], ['fz', 'Feed per tooth', 'mm each insert cuts per revolution'], ['z', 'Number of teeth', 'Effective inserts'], ['vf', 'Table feed', 'mm/min = fz × z × n'], ['hex', 'Max chip thickness', 'Real chip thickness — what the insert feels']]) +
      box('tip', '<b>Chip thinning:</b> with a 45° insert the chip is thinner than fz (hex = fz × sin 45° ≈ 0.7 × fz), so you can raise fz by about 1.4×. When ae is small (less than half the diameter) the chip also gets thinner — raise fz to keep hex right.') +
      box('note', '<b>Cutter size for face milling:</b> choose a diameter about 1.3–1.6 × the width of cut, and keep the cutter slightly off-centre so the insert enters with a thick chip.'),
    qs: [
      { q: 'Which milling method is preferred on CNC machines?', o: ['Down milling (climb)', 'Up milling (conventional)', 'Both the same', 'Plunge only'], a: 0, e: 'Down milling: thick-to-thin chip, less heat, longer life.' },
      { q: 'To make a true 90° shoulder you use a cutter with entering angle…', o: ['90°', '45°', '10°', 'Round inserts'], a: 0, e: 'Only 90° gives a square shoulder.' },
      { q: 'With a 45° face mill, the real chip thickness is about…', o: ['0.7 × fz', 'Equal to fz', '1.4 × fz', '2 × fz'], a: 0, e: 'hex = fz × sin κr = fz × 0.707.' },
      { q: 'A coarse pitch cutter is best for…', o: ['Long overhang and unstable set-ups', 'Short-chipping cast iron at maximum output', 'Finishing aluminium', 'Threading'], a: 0, e: 'Fewer teeth = less force, less vibration.' },
      { q: 'Table feed vf equals…', o: ['fz × z × n', 'Vc × D', 'ap × ae', 'π × D × n'], a: 0, e: 'vf (mm/min) = feed per tooth × teeth × rpm.' },
      { q: 'ae means…', o: ['Radial width of cut', 'Axial depth of cut', 'Feed per tooth', 'Cutting speed'], a: 0, e: 'ae = radial engagement; ap = axial depth.' },
      { q: 'For face milling a 100 mm wide part, a good cutter diameter is about…', o: ['125–160 mm', '50 mm', '100 mm exactly', '300 mm'], a: 0, e: 'About 1.3–1.6 × the width of cut.' },
      { q: 'High-feed mills work with…', o: ['Small ap and very high feed', 'Large ap and small feed', 'Only finishing', 'Only aluminium'], a: 0, e: 'Small entering angle → thin chip → very high fz with small ap.' }
    ] });

  // ── 6. End mills ────────────────────────────────────────────────────
  T.push({ id: 'endmills', n: 6, icon: '🔩', title: 'End mills', sub: 'Parts of an end mill, flutes, helix, corner types, lengths, coatings and strategies',
    body:
      fig('<svg viewBox="0 0 620 180"><rect x="20" y="60" width="220" height="50" rx="4" fill="#94a3b8"/><text x="130" y="90" font-size="13" text-anchor="middle" fill="#0f172a">Shank (h6) — held in the holder</text>' +
        '<rect x="240" y="60" width="40" height="50" fill="#64748b"/><text x="260" y="130" font-size="10.5" text-anchor="middle">neck</text>' +
        '<rect x="280" y="55" width="260" height="60" fill="#1e3a5f"/>' + [0, 1, 2, 3, 4, 5].map(function (i) { return '<path d="M' + (295 + i * 42) + ' 55 L' + (275 + i * 42) + ' 115" stroke="#93c5fd" stroke-width="3"/>'; }).join('') +
        '<text x="410" y="40" font-size="12" text-anchor="middle">flute length (cutting length)</text><path d="M280 45 L540 45" stroke="#0f172a"/>' +
        '<text x="560" y="90" font-size="11">end</text><path d="M20 150 L540 150" stroke="#0f172a"/><text x="280" y="170" font-size="12" text-anchor="middle">overall length</text>' +
        '<text x="410" y="140" font-size="11" text-anchor="middle" fill="#334155">helix angle = slope of the flutes</text></svg>', 'Parts of a solid carbide end mill.') +
      '<h3>Number of flutes</h3>' + tbl(['Flutes', 'Chip space', 'Use'], [['2–3', 'Large', '<b>Aluminium</b>, slotting, soft materials'], ['4', 'Medium', 'General steel — slotting and side milling'], ['5–6', 'Smaller', 'Steel / stainless side milling, finishing, high feed'], ['7+', 'Small', 'Finishing, hardened steel, superalloys (low ae)']]) +
      '<h3>Helix angle</h3><p><b>30°</b> = general, strong edge. <b>35–45°</b> = smoother cutting, better finish, aluminium and stainless. <b>Variable helix / variable pitch</b> = breaks up vibration (chatter) — a big selling point.</p>' +
      '<h3>Corner types</h3>' +
      fig('<svg viewBox="0 0 600 150"><rect x="50" y="20" width="80" height="90" fill="#1e3a5f"/><text x="90" y="135" font-size="12" text-anchor="middle">Square</text>' +
        '<path d="M250 20 L330 20 L330 95 Q330 110 315 110 L265 110 Q250 110 250 95 Z" fill="#1e3a5f"/><text x="290" y="135" font-size="12" text-anchor="middle">Corner radius</text>' +
        '<path d="M450 20 L530 20 L530 70 A40 40 0 0 1 450 70 Z" fill="#1e3a5f"/><text x="490" y="135" font-size="12" text-anchor="middle">Ball nose</text></svg>',
        'Square = sharp 90° corner. Corner radius = stronger corner, longer life (sell this!). Ball nose = 3D shapes, dies and moulds.') +
      '<h3>Length</h3><p>Use the <b>shortest</b> tool that reaches. Deflection grows with the cube of overhang — doubling the stick-out makes the tool about 8× less rigid. Stub / regular / long / extra-long; reduced neck tools for deep pockets.</p>' +
      '<h3>Coating by material</h3>' + tbl(['Material', 'Coating'], [['Steel, cast iron', 'AlTiN / TiAlN'], ['Stainless, titanium', 'AlTiN, AlCrN'], ['Hardened steel', 'AlTiSiN / nano coatings'], ['Aluminium, copper', 'Uncoated polished, DLC, ZrN']]) +
      '<h3>Strategies</h3><ul><li><b>Slotting</b> (ae = D): hardest job — use 3–4 flutes, ap about 0.5–1 × D.</li><li><b>Side milling</b>: ae 10–40 % of D, ap up to 1.5–2 × D.</li>' +
      '<li><b>Dynamic / trochoidal milling</b>: very small ae (5–15 %), full flute length ap, high speed and feed — long life, high output.</li><li><b>Holder</b>: shrink-fit or hydraulic holders keep runout below 0.005 mm — runout kills end mill life.</li></ul>' +
      box('tip', '<b>Roughing end mills</b> have serrations (chip breakers) on the flutes — smaller chips, less power, can cut deeper. <b>Finishing end mills</b> are plain with more flutes.'),
    qs: [
      { q: 'For milling aluminium choose an end mill with…', o: ['2–3 flutes, polished / uncoated', '7 flutes, AlTiN', '4 flutes, CBN', 'Any HSS tap'], a: 0, e: 'Aluminium needs big chip space and a sharp, non-sticky edge.' },
      { q: 'Variable helix end mills are mainly sold to…', o: ['Reduce chatter / vibration', 'Cut threads', 'Increase runout', 'Allow plunging only'], a: 0, e: 'Uneven flute spacing breaks the vibration rhythm.' },
      { q: 'A corner radius end mill compared with square…', o: ['Has a stronger corner and longer life', 'Makes a sharper inside corner', 'Is only for aluminium', 'Cannot side mill'], a: 0, e: 'The radius protects the weakest point — the corner.' },
      { q: 'Doubling the stick-out of an end mill makes it about…', o: ['8 times less rigid', '2 times less rigid', 'No change', '4 times more rigid'], a: 0, e: 'Deflection grows with the cube of length: 2³ = 8.' },
      { q: 'Trochoidal / dynamic milling uses…', o: ['Small ae and large ap', 'Large ae and small ap', 'Only slotting at full width', 'Low speed'], a: 0, e: 'Small radial engagement, full flute length.' },
      { q: 'Which holder gives the lowest runout?', o: ['Shrink-fit / hydraulic', 'Side-lock (weldon) worn holder', 'Drill chuck', 'Any collet with dirt'], a: 0, e: 'Shrink-fit and hydraulic holders: runout under 5 µm.' },
      { q: 'Ball nose end mills are used for…', o: ['3D shapes, dies and moulds', 'Square shoulders', 'Threading', 'Drilling deep holes'], a: 0, e: 'The ball shape follows 3D surfaces.' },
      { q: 'Slotting (ae = full diameter) is best done with…', o: ['3–4 flutes for chip space', '8 flutes', 'A ball nose only', 'A tap'], a: 0, e: 'Full-width slots need chip space.' }
    ] });

  // ── 7. Probes ───────────────────────────────────────────────────────
  T.push({ id: 'probes', n: 7, icon: '📡', title: 'Probes', sub: 'Spindle probes, tool setters, how they work and what they save',
    body:
      '<p>A <b>machine tool probe</b> is a measuring sensor used on the CNC machine itself. It touches the part or the tool and sends a signal; the CNC records the position.</p>' +
      fig('<svg viewBox="0 0 620 220"><rect x="80" y="10" width="60" height="60" fill="#64748b"/><text x="110" y="45" font-size="11" fill="#fff" text-anchor="middle">spindle</text>' +
        '<rect x="95" y="70" width="30" height="50" fill="#1e3a5f"/><line x1="110" y1="120" x2="110" y2="160" stroke="#0f172a" stroke-width="3"/><circle cx="110" cy="165" r="7" fill="#ef4444"/>' +
        '<rect x="20" y="172" width="200" height="40" fill="#cbd5e1"/><text x="120" y="198" font-size="11" text-anchor="middle">part — probe touches, CNC stores X Y Z</text>' +
        '<text x="110" y="140" font-size="10" fill="#ef4444" text-anchor="start" dx="14">ruby stylus</text>' +
        '<rect x="400" y="10" width="60" height="60" fill="#64748b"/><rect x="418" y="70" width="24" height="70" fill="#334155"/><text x="430" y="105" font-size="9" fill="#fff" text-anchor="middle" transform="rotate(-90 430 105)">tool</text>' +
        '<rect x="395" y="160" width="70" height="20" fill="#1e3a5f"/><rect x="380" y="180" width="100" height="32" fill="#94a3b8"/><text x="430" y="200" font-size="11" text-anchor="middle">tool setter</text>' +
        '<text x="540" y="150" font-size="11" text-anchor="middle">measures tool</text><text x="540" y="165" font-size="11" text-anchor="middle">length &amp; radius,</text><text x="540" y="180" font-size="11" text-anchor="middle">finds broken tools</text></svg>',
        'Left: spindle (workpiece) probe. Right: tool setter on the table.') +
      tbl(['Type', 'Where', 'What it does'], [['Spindle / workpiece probe', 'In the spindle like a tool', 'Sets the work datum (G54), finds bore centres, checks alignment, measures features in process'],
        ['Contact tool setter', 'On the table', 'Measures tool length and diameter, checks for broken tools'], ['Laser tool setter', 'On the table, non-contact', 'Measures tools while spinning, very small tools, wear and breakage'],
        ['Lathe tool-setting arm', 'Swings in on a lathe', 'Sets turning tool offsets'], ['CMM probe', 'In the quality lab', 'Final inspection — not on the machine']]) +
      '<h3>How the signal reaches the CNC</h3><ul><li><b>Optical (infrared)</b> — line of sight, small and medium machines.</li><li><b>Radio</b> — large machines, 5-axis, no line of sight needed.</li><li><b>Hard-wired</b> — tool setters fixed on the table.</li></ul>' +
      '<h3>Why customers buy probes — selling points</h3><ul><li>Set-up time cut from 20–30 minutes to 1–2 minutes per job.</li><li>No manual edge-finding errors → less scrap.</li><li>In-process measurement: the CNC corrects offsets automatically.</li><li>Broken tool detection → no crash, no scrap batch at night.</li><li>Enables unmanned / lights-out machining.</li></ul>' +
      box('note', '<b>Before quoting a probe ask:</b> machine make and model, CNC control (Fanuc, Siemens, Mitsubishi, Heidenhain…), spindle taper (BT40, HSK63…), is there a free M-code / skip input, and the main job (datum setting, measuring, tool setting).') +
      box('tip', 'A probe must be <b>calibrated</b> (stylus ball offset) with a ring gauge or a known sphere — after a crash or stylus change, calibrate again.'),
    qs: [
      { q: 'A spindle probe is mainly used to…', o: ['Set work datums and measure the part on the machine', 'Cut threads', 'Cool the spindle', 'Hold inserts'], a: 0, e: 'It touches the part and records positions.' },
      { q: 'Which device measures tool length on the table?', o: ['Tool setter', 'CMM', 'Micrometer', 'Spindle probe only'], a: 0, e: 'A tool setter (contact or laser) measures tools.' },
      { q: 'Radio transmission probes are preferred on…', o: ['Large and 5-axis machines', 'Only small lathes', 'Manual mills', 'CMMs'], a: 0, e: 'Radio does not need line of sight.' },
      { q: 'A big benefit of probing is…', o: ['Set-up time falls from many minutes to 1–2 minutes', 'Higher spindle speed', 'Cheaper inserts', 'No need for coolant'], a: 0, e: 'Automatic datum setting saves set-up time.' },
      { q: 'After a stylus change you must…', o: ['Calibrate the probe again', 'Change the coolant', 'Re-grind the stylus', 'Nothing'], a: 0, e: 'The ball offset changes — recalibrate.' },
      { q: 'A laser tool setter can…', o: ['Measure small tools while spinning, without contact', 'Only measure parts', 'Replace the spindle', 'Cut the part'], a: 0, e: 'Non-contact laser measurement at speed.' },
      { q: 'Before quoting a probe you must know the…', o: ['CNC control and machine model', 'Colour of the guards', 'Coolant brand', 'Insert grade'], a: 0, e: 'The control decides the interface and software.' }
    ] });

  // ── 8. How to take technical data ──────────────────────────────────
  T.push({ id: 'techdata', n: 8, icon: '📋', title: 'How to take technical data', sub: 'The application data sheet: what to collect, where to get it, step by step',
    body:
      '<p>Before you recommend any tool, collect the <b>technical data</b>. A complete data sheet = a correct offer and a successful trial.</p>' +
      fig('<svg viewBox="0 0 620 300"><rect x="10" y="10" width="600" height="280" rx="10" fill="#fff" stroke="#334155"/><rect x="10" y="10" width="600" height="34" rx="10" fill="#1e3a5f"/>' +
        '<text x="310" y="32" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">APPLICATION DATA SHEET</text>' +
        [['1 Customer / contact', 'Rishaba Industries · Mr Kumar'], ['2 Component & drawing no.', 'Gear shaft · DRG-2231 rev C'], ['3 Material & hardness', 'EN19 · 28–32 HRC'], ['4 Operation', 'OD rough turning, Ø62 → Ø55, length 120'],
          ['5 Machine', 'LMW LL20 · 15 kW · 4000 rpm · BMT55'], ['6 Clamping', 'chuck + tailstock · overhang 40 mm'], ['7 Present tool', 'CNMG 120408 · grade "X" · ₹420/insert'], ['8 Present data', 'S220 m/min · f0.25 · ap2.5'],
          ['9 Tool life / problem', '35 parts per edge · chipping'], ['10 Target', '60 parts/edge · cycle time −10 %']].map(function (r, i) {
          var y = 64 + i * 22; return '<text x="26" y="' + y + '" font-size="11.5" font-weight="700" fill="#1e3a5f">' + r[0] + '</text><line x1="220" y1="' + (y + 4) + '" x2="596" y2="' + (y + 4) + '" stroke="#cbd5e1"/><text x="226" y="' + y + '" font-size="11.5" fill="#0f172a">' + r[1] + '</text>';
        }).join('') + '</svg>', 'A filled application data sheet (example).') +
      '<h3>Step by step — what and where</h3>' + tbl(['#', 'Data', 'Where to get it'], [
        ['1', 'Customer, contact, phone', 'Visiting card / customer page in the CRM'],
        ['2', 'Component name, drawing no., <b>photo</b>', 'Drawing title block, the part itself — take a photo with a scale'],
        ['3', '<b>Material grade + hardness</b> (HB/HRC), forging / casting / bar', 'Drawing material block, material test certificate, quality dept.'],
        ['4', 'Operation: OD/ID turning, facing, grooving, milling face/pocket, drilling Ø × depth', 'Process sheet / routing card, watch the machine'],
        ['5', 'Machine: make, model, power kW, max rpm, spindle taper (BT40/HSK/BMT), coolant (through-spindle? pressure)', 'Machine nameplate, operator, maintenance'],
        ['6', 'Clamping and rigidity: chuck, fixture, overhang, wall thickness', 'Look at the set-up — take a photo'],
        ['7', 'Present tool: brand, full code, grade, holder, price', 'Tool box / insert box label, tool crib, purchase'],
        ['8', 'Present cutting data: Vc or rpm (S), feed (F), ap, ae, coolant', 'CNC program (S and F words), machine display, operator'],
        ['9', 'Tool life: parts per edge or minutes; problems (wear, chatter, burr, finish Ra)', 'Operator, production record, inspect used inserts'],
        ['10', 'Quantity: batch, monthly / annual volume; cycle time now; target', 'Planning / production manager']]) +
      box('tip', '<b>Always photograph:</b> the part, the set-up, the used insert edge (wear) and the box label. Keep the old insert — it tells the real story.') +
      box('warn', 'Never skip <b>material, hardness and machine power</b>. Most failed trials come from a wrong hardness or a machine without enough power or rigidity.') +
      '<p>Save the data in the CRM: <b>Log meeting</b> → customer requirements, and use <b>Trials</b> for the trial sheet (existing vs proposed).</p>',
    qs: [
      { q: 'The two most important material details are…', o: ['Material grade and hardness', 'Colour and weight', 'Price and supplier', 'Batch and invoice no.'], a: 0, e: 'Grade + hardness decide tool, grade and speed.' },
      { q: 'Where do you find the present spindle speed and feed?', o: ['In the CNC program (S and F words) / machine display', 'On the drawing', 'On the invoice', 'On the insert box'], a: 0, e: 'S = speed, F = feed in the program.' },
      { q: 'Machine power (kW) matters because…', o: ['It limits how much metal you can remove', 'It decides the colour of chips', 'It changes the material', 'It is only for billing'], a: 0, e: 'Power limits ap × f × Vc.' },
      { q: 'Which photo is most useful to diagnose a problem?', o: ['The worn insert edge', 'The factory gate', 'The customer office', 'The tool catalogue'], a: 0, e: 'The wear pattern shows the cause.' },
      { q: 'Tool life is best recorded as…', o: ['Parts per edge or minutes in cut', 'Days in stock', 'Price per box', 'Number of operators'], a: 0, e: 'Measurable life — parts or minutes.' },
      { q: 'Where do you find the material grade?', o: ['Drawing material block / test certificate', 'Tool box', 'Machine nameplate', 'CNC alarm list'], a: 0, e: 'The drawing title block or the material certificate.' },
      { q: 'Annual quantity is needed to…', o: ['Work out savings and the business value', 'Choose the coolant', 'Set the clamping', 'Calibrate a probe'], a: 0, e: 'Savings per part × volume = business case.' }
    ] });

  // ── 9. Reading the existing data ───────────────────────────────────
  T.push({ id: 'existing', n: 9, icon: '🔍', title: 'Reading the existing data', sub: 'CNC program words, working out Vc and fz, wear patterns, tool life and cost per part',
    body:
      '<p>The customer’s <b>existing data</b> is your starting point. Learn to read it, work out the real cutting values and find what to improve.</p>' +
      '<h3>1. Read the CNC program</h3>' +
      fig('<svg viewBox="0 0 620 200"><rect x="10" y="10" width="600" height="180" rx="8" fill="#0f172a"/>' +
        [['G96 S220 M03', 'G96 = constant cutting speed → S is Vc in m/min (220)'], ['G50 S3000', 'rpm limit 3000 (lathe)'], ['G95 G01 X55. F0.25', 'G95 = feed per revolution → 0.25 mm/rev'],
          ['G97 S1800 M03', 'G97 = fixed rpm → S1800 = 1800 rpm (milling / drilling)'], ['G94 G01 X120. F960.', 'G94 = feed per minute → 960 mm/min (milling)']].map(function (r, i) {
          var y = 42 + i * 32; return '<text x="26" y="' + y + '" font-size="14" font-family="monospace" fill="#86efac">' + r[0] + '</text><text x="250" y="' + y + '" font-size="11.5" fill="#cbd5e1">' + r[1] + '</text>';
        }).join('') + '</svg>', 'S and F words in a Fanuc-style program.') +
      '<h3>2. Work out the real values</h3>' + tbl(['You have', 'Formula', 'Example'], [
        ['rpm n and diameter D', 'Vc = π × D × n ÷ 1000', 'Ø80, 1800 rpm → 3.1416 × 80 × 1800 ÷ 1000 = 452 m/min'],
        ['Vc and D', 'n = Vc × 1000 ÷ (π × D)', 'Vc 200, Ø50 → 200000 ÷ 157.1 = 1273 rpm'],
        ['Table feed vf, teeth z, rpm n', 'fz = vf ÷ (z × n)', '960 mm/min, 4 teeth, 1200 rpm → 0.2 mm/tooth'],
        ['Turning feed f and rpm', 'vf = f × n', '0.25 × 1000 = 250 mm/min'],
        ['Length L and vf', 'time (min) = L ÷ vf', '120 mm ÷ 250 = 0.48 min = 29 s']]) +
      '<h3>3. Look at the used insert — wear patterns</h3>' +
      fig('<svg viewBox="0 0 640 170">' + [['Flank wear', 'normal — band VB|on the flank', '<rect x="20" y="40" width="80" height="60" fill="#94a3b8"/><rect x="20" y="88" width="80" height="12" fill="#ef4444"/>'],
        ['Crater', 'speed too high /|wrong grade', '<rect x="150" y="40" width="80" height="60" fill="#94a3b8"/><ellipse cx="190" cy="56" rx="26" ry="8" fill="#ef4444"/>'],
        ['Built-up edge', 'speed too low,|sticky material', '<rect x="280" y="40" width="80" height="60" fill="#94a3b8"/><path d="M280 40 Q300 25 318 40 Z" fill="#f59e0b"/>'],
        ['Notch', 'at depth-of-cut line|(stainless, HRSA)', '<rect x="410" y="40" width="80" height="60" fill="#94a3b8"/><path d="M460 100 L468 84 L476 100 Z" fill="#ef4444"/>'],
        ['Chipping', 'edge too weak /|vibration', '<rect x="540" y="40" width="80" height="60" fill="#94a3b8"/><path d="M540 40 L556 40 L548 52 L560 56 L552 66 L540 64 Z" fill="#fff" stroke="#ef4444"/>']].map(function (w, i) {
        var x = 60 + i * 130; return w[2] + '<text x="' + x + '" y="125" font-size="12" font-weight="700" text-anchor="middle">' + w[0] + '</text>' + w[1].split('|').map(function (t, k) { return '<text x="' + x + '" y="' + (142 + k * 13) + '" font-size="10" text-anchor="middle" fill="#475569">' + t + '</text>'; }).join('');
      }).join('') + '</svg>', 'Common wear types — look at the old insert with a magnifier.') +
      tbl(['Wear', 'Cause', 'Remedy'], [['Fast flank wear', 'Speed too high, grade too soft', 'Lower Vc, harder grade (lower number), better coating'], ['Crater wear', 'High heat in steel', 'Lower speed/feed, CVD Al₂O₃ grade'],
        ['Built-up edge', 'Speed too low, sticky material, no coolant', 'Raise Vc, sharp PVD / polished edge, coolant'], ['Notch wear', 'Work-hardened surface, scale', 'Vary the depth of cut, round insert / bigger lead angle, tougher grade'],
        ['Chipping / breakage', 'Interrupted cut, vibration, feed too high, weak edge', 'Tougher grade, stronger chip breaker, more rigidity, reduce feed at entry'],
        ['Plastic deformation', 'Too hot: speed and feed too high', 'Lower Vc, harder grade, coolant'], ['Thermal cracks (milling)', 'Coolant on/off heating cycles', 'Mill dry or with plenty of coolant, tougher grade']]) +
      '<h3>4. Tool cost per part — the selling argument</h3>' +
      box('note', '<b>Tool cost per part</b> = insert price ÷ (edges per insert × parts per edge).<br>Example: ₹420 insert, 4 edges, 35 parts/edge → 420 ÷ 140 = <b>₹3.00 per part</b>. Our insert ₹520, 4 edges, 60 parts/edge → 520 ÷ 240 = <b>₹2.17 per part</b> — cheaper per part even though the insert costs more.') +
      box('tip', '<b>Machine time is worth more than inserts.</b> If the machine costs ₹1,200 per hour, cutting 10 seconds per part on 20,000 parts a year saves 55 hours = ₹66,000 a year. Show both: tool cost per part and cycle time saving.'),
    qs: [
      { q: 'In a lathe program G96 S220 means…', o: ['Constant cutting speed 220 m/min', '220 rpm', 'Feed 220 mm/min', 'Tool number 220'], a: 0, e: 'G96 = constant surface speed, S = m/min.' },
      { q: 'G95 F0.25 means…', o: ['Feed 0.25 mm per revolution', 'Feed 0.25 mm per minute', 'Depth of cut 0.25', 'Speed 0.25 m/s'], a: 0, e: 'G95 = feed per rev.' },
      { q: 'A milling program says G94 F960 with 4 teeth at 1200 rpm. fz is…', o: ['0.2 mm/tooth', '0.8 mm/tooth', '0.05 mm/tooth', '1.2 mm/tooth'], a: 0, e: 'fz = 960 ÷ (4 × 1200) = 0.2.' },
      { q: 'Crater wear on top of the insert usually means…', o: ['Too much heat — speed too high or wrong grade', 'Speed too low', 'Wrong nose radius', 'Too little feed'], a: 0, e: 'Crater = heat / diffusion wear.' },
      { q: 'Built-up edge is caused mainly by…', o: ['Cutting speed too low on sticky material', 'Speed too high', 'Too much coolant', 'A large nose radius'], a: 0, e: 'Low speed lets the material weld to the edge.' },
      { q: 'Notch wear at the depth-of-cut line is typical in…', o: ['Stainless and superalloys', 'Grey cast iron', 'Aluminium', 'Plastics'], a: 0, e: 'Work-hardened surface cuts a notch.' },
      { q: '₹600 insert, 2 edges, 50 parts per edge. Tool cost per part is…', o: ['₹6.00', '₹12.00', '₹3.00', '₹300'], a: 0, e: '600 ÷ (2 × 50) = 6.' },
      { q: 'Edge chipping in an interrupted cut — first remedy?', o: ['Tougher grade / stronger chip breaker', 'Increase speed', 'Use a sharper finishing breaker', 'Remove coolant only'], a: 0, e: 'More toughness and edge strength.' }
    ] });

  // ── 10. Conversions & formulas ─────────────────────────────────────
  T.push({ id: 'conversions', n: 10, icon: '🧮', title: 'Basic conversions and formulas', sub: 'mm ↔ inch, SFM ↔ m/min, rpm, feed, MRR, power, hardness — with calculators',
    body:
      '<h3>Length and speed</h3>' + tbl(['From', 'To', 'Multiply by'], [['inch', 'mm', '25.4'], ['mm', 'inch', '÷ 25.4 (× 0.03937)'], ['SFM (feet/min)', 'm/min', '0.3048'], ['m/min', 'SFM', '3.281'],
        ['IPR (inch/rev)', 'mm/rev', '25.4'], ['IPM (inch/min)', 'mm/min', '25.4'], ['µm', 'mm', '÷ 1000'], ['thou (0.001")', 'mm', '0.0254']]) +
      '<h3>Cutting formulas</h3>' + tbl(['What', 'Formula', 'Units'], [['Cutting speed', 'Vc = π × D × n ÷ 1000', 'm/min (D mm, n rpm)'], ['Spindle speed', 'n = Vc × 1000 ÷ (π × D)', 'rpm'], ['Milling table feed', 'vf = fz × z × n', 'mm/min'],
        ['Turning feed rate', 'vf = f × n', 'mm/min (f mm/rev)'], ['Metal removal — turning', 'Q = Vc × ap × f', 'cm³/min'], ['Metal removal — milling', 'Q = ap × ae × vf ÷ 1000', 'cm³/min'],
        ['Power — turning (approx.)', 'Pc = Vc × ap × f × kc ÷ 60 000', 'kW (kc N/mm²)'], ['Surface finish — turning', 'Rmax ≈ f² ÷ (8 × r) × 1000', 'µm']]) +
      box('note', '<b>Specific cutting force kc</b> (approximate, N/mm²): steel 1500–2000 · stainless 2000–2500 · cast iron 1000–1300 · aluminium 600–800 · superalloys 2500–3500 · hardened steel 3500–4500.') +
      '<h3>Hardness (approximate)</h3>' + tbl(['HRC', 'HB', 'Tensile (MPa, steel ≈ 3.45 × HB)'], [['20', '226', '780'], ['25', '253', '870'], ['30', '286', '990'], ['35', '327', '1130'], ['40', '371', '1280'], ['45', '421', '1450'], ['50', '481', '1660']]) +
      '<h3>Calculators</h3><div class="en-calc" data-calc="rpm"></div><div class="en-calc" data-calc="vf"></div><div class="en-calc" data-calc="mrr"></div><div class="en-calc" data-calc="conv"></div>',
    qs: [
      { q: '1 inch equals…', o: ['25.4 mm', '2.54 mm', '254 mm', '10 mm'], a: 0, e: '1" = 25.4 mm.' },
      { q: '600 SFM is about…', o: ['183 m/min', '600 m/min', '60 m/min', '1968 m/min'], a: 0, e: '600 × 0.3048 = 182.9 m/min.' },
      { q: 'Vc = 200 m/min on a Ø50 part. The rpm is about…', o: ['1273', '4000', '637', '200'], a: 0, e: '200 × 1000 ÷ (3.1416 × 50) = 1273.' },
      { q: 'fz 0.1, 6 teeth, 2000 rpm. vf is…', o: ['1200 mm/min', '120 mm/min', '12000 mm/min', '333 mm/min'], a: 0, e: '0.1 × 6 × 2000 = 1200.' },
      { q: 'Turning MRR with Vc 200, ap 2, f 0.3 is…', o: ['120 cm³/min', '12 cm³/min', '1200 cm³/min', '60 cm³/min'], a: 0, e: 'Q = Vc × ap × f = 200 × 2 × 0.3 = 120.' },
      { q: '40 HRC is about…', o: ['371 HB', '200 HB', '600 HB', '40 HB'], a: 0, e: 'From the table: 40 HRC ≈ 371 HB.' },
      { q: '0.010 inch per rev is…', o: ['0.254 mm/rev', '2.54 mm/rev', '0.0254 mm/rev', '25.4 mm/rev'], a: 0, e: '0.010 × 25.4 = 0.254.' }
    ],
    gen: true });

  // Auto-generated number questions (a fresh set every quiz)
  function rnd(a, b, step) { var n = Math.round((a + Math.random() * (b - a)) / step) * step; return +n.toFixed(4); }
  function opts(right, fmt) {
    var set = [right], tries = 0;
    while (set.length < 4 && tries++ < 40) {
      var f = [0.5, 0.8, 1.25, 1.5, 2, 0.25, 3][Math.floor(Math.random() * 7)], v = +(right * f).toFixed(right < 10 ? 2 : 0);
      if (set.indexOf(v) === -1 && v > 0) set.push(v);
    }
    set.sort(function () { return Math.random() - 0.5; });
    return { o: set.map(fmt), a: set.indexOf(right) };
  }
  function generated(n) {
    var out = [], makers = [
      function () { var D = rnd(20, 120, 5), Vc = rnd(100, 300, 10), ans = Math.round(Vc * 1000 / (Math.PI * D)); var o = opts(ans, function (v) { return v + ' rpm'; });
        return { q: 'Vc = ' + Vc + ' m/min, diameter Ø' + D + ' mm. What is the spindle speed?', o: o.o, a: o.a, e: 'n = Vc × 1000 ÷ (π × D) = ' + Vc + ' × 1000 ÷ (3.1416 × ' + D + ') = ' + ans + ' rpm.', gen: true }; },
      function () { var D = rnd(10, 100, 5), n = rnd(500, 4000, 100), ans = Math.round(Math.PI * D * n / 1000); var o = opts(ans, function (v) { return v + ' m/min'; });
        return { q: 'A Ø' + D + ' mm tool runs at ' + n + ' rpm. What is the cutting speed Vc?', o: o.o, a: o.a, e: 'Vc = π × D × n ÷ 1000 = 3.1416 × ' + D + ' × ' + n + ' ÷ 1000 = ' + ans + ' m/min.', gen: true }; },
      function () { var fz = rnd(0.05, 0.25, 0.01), z = [2, 3, 4, 5, 6, 8][Math.floor(Math.random() * 6)], n = rnd(800, 6000, 100), ans = Math.round(fz * z * n); var o = opts(ans, function (v) { return v + ' mm/min'; });
        return { q: 'Milling: fz ' + fz + ' mm, ' + z + ' teeth, ' + n + ' rpm. What is the table feed vf?', o: o.o, a: o.a, e: 'vf = fz × z × n = ' + fz + ' × ' + z + ' × ' + n + ' = ' + ans + ' mm/min.', gen: true }; },
      function () { var inch = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3][Math.floor(Math.random() * 8)], ans = +(inch * 25.4).toFixed(2); var o = opts(ans, function (v) { return v + ' mm'; });
        return { q: 'Convert ' + inch + ' inch to mm.', o: o.o, a: o.a, e: inch + ' × 25.4 = ' + ans + ' mm.', gen: true }; },
      function () { var sfm = rnd(300, 1200, 50), ans = Math.round(sfm * 0.3048); var o = opts(ans, function (v) { return v + ' m/min'; });
        return { q: 'A US catalogue says ' + sfm + ' SFM. How many m/min is that?', o: o.o, a: o.a, e: sfm + ' × 0.3048 = ' + ans + ' m/min.', gen: true }; },
      function () { var price = rnd(300, 900, 10), edges = [2, 3, 4, 6, 8][Math.floor(Math.random() * 5)], parts = rnd(20, 120, 5), ans = +(price / (edges * parts)).toFixed(2); var o = opts(ans, function (v) { return '₹' + v.toFixed(2); });
        return { q: 'Insert ₹' + price + ', ' + edges + ' edges, ' + parts + ' parts per edge. Tool cost per part?', o: o.o, a: o.a, e: price + ' ÷ (' + edges + ' × ' + parts + ') = ₹' + ans.toFixed(2) + ' per part.', gen: true }; }
    ];
    for (var i = 0; i < n; i++) out.push(makers[Math.floor(Math.random() * makers.length)]());
    return out;
  }

  window.ENotes = { topics: T, generated: generated, colors: C };
})();
