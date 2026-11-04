#!/usr/bin/env python3
"""Adds ?v=<stamp> to every hand-coded script / stylesheet in crm/**/*.html
(app-shell.js, stock-app.js, motion.css, payroll-common.css …) so browsers and
the service worker never serve an old copy after an update.
Run before each release:  python3 tools/stamp_assets.py"""
import os, re, sys, time
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'crm')
stamp = sys.argv[1] if len(sys.argv) > 1 else time.strftime('%Y%m%d%H%M')
pat = re.compile(r'((?:src|href)=")((?:/|\.\./)(?!_next/)[A-Za-z0-9_./-]+\.(?:js|css))(?:\?v=[0-9A-Za-z]+)?(")')
changed = 0
for d, _, files in os.walk(root):
    if '/_next' in d: continue
    for f in files:
        if not f.endswith('.html'): continue
        p = os.path.join(d, f)
        s = open(p, encoding='utf-8').read()
        n = pat.sub(lambda m: m.group(1) + m.group(2) + '?v=' + stamp + m.group(3), s)
        if n != s:
            open(p, 'w', encoding='utf-8').write(n); changed += 1
print(f'stamped {changed} pages with v={stamp}')

# The service worker precaches /index.html (cache-first). Its revision must follow the file,
# or browsers keep the old start page forever. Refresh it after stamping.
import hashlib
sw = os.path.join(root, 'sw.js')
if os.path.exists(sw):
    s = open(sw, encoding='utf-8').read()
    for page in ['index.html']:
        h = hashlib.md5(open(os.path.join(root, page), 'rb').read()).hexdigest()
        s2 = re.sub(r'(\{url:"/' + re.escape(page) + r'",revision:")[0-9a-f]+(")', lambda m: m.group(1) + h + m.group(2), s)
        if s2 != s:
            s = s2; print(f'sw.js: /{page} revision → {h[:8]}')
    open(sw, 'w', encoding='utf-8').write(s)
