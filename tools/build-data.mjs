// docs/ の資料から data.js を生成する（原文のまま抜き出し。要約・言い換えはしない）
// 使い方: node tools/build-data.mjs
import fs from 'fs';
import { parse01 } from './parse01.mjs';
const rd = f => fs.readFileSync(new URL('../docs/' + f, import.meta.url), 'utf8');
const nob = s => s.replace(/\*\*/g, '').trim();
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(nob);
const isSep = l => /^\|[-\s|]+\|$/.test(l.trim());
const toArabic = s => s;

// ---- 05 ----
const t05 = rd('05_過去10回_設問別ストーリー.md').split('\n');
const heads = [];
t05.forEach((l, i) => { const m = l.match(/^\*\*(令和|平成)(.+?)年度（(\d{4})）　(問\d)　(.+)\*\*$/); if (m) heads.push({ i, m }); });
let endAll = t05.findIndex(l => l.startsWith('**過去10実施回で頻出'));
const past = heads.map((h, k) => {
  const end = k + 1 < heads.length ? heads[k + 1].i : endAll;
  const L = t05.slice(h.i + 1, end).filter(l => !l.startsWith('※2020'));
  const m = h.m;
  const p = { id: `${m[3]}-${m[4]}`, year: `${m[1]}${m[2]}年度（${m[3]}）`, yearNum: +m[3], q: m[4], theme: m[5],
    eval: null, summary: null, keywords: null, setsumon: {}, sections: [], story: null, note: null };
  let mode = '';
  for (let j = 0; j < L.length; j++) {
    const l = L[j].trim(); if (!l) continue;
    if (l.startsWith('**本文でどういう')) { mode = 'summary'; continue; }
    if (l === '**全体ストーリー**') { mode = 'story'; continue; }
    if (l === '**本番での注意**') { mode = 'note'; continue; }
    if (l.startsWith('|')) {
      if (isSep(l)) continue;
      const c = cells(l);
      if (c.length === 1 && !p.eval) p.eval = c[0];
      else if (c[0] === '本文キーワード') p.keywords = c[1];
      else if (/^設問[アイウ]$/.test(c[0])) p.setsumon[{ 'ア': 'a', 'イ': 'i', 'ウ': 'u' }[c[0][2]]] = c[1];
      else if (/^第\d章 \d\.\d$/.test(c[0])) p.sections.push({ no: c[0], title: c[1], content: c[2] });
      continue;
    }
    if (mode === 'summary' && !p.summary) { p.summary = nob(l); mode = ''; }
    else if (mode === 'story' && !p.story) { p.story = nob(l); mode = ''; }
    else if (mode === 'note' && !p.note) { p.note = nob(l); mode = ''; }
  }
  p.evalMark = (p.eval || '').trim()[0];
  const src = [...p.sections.map(s => s.content), p.story || '', p.note || ''].join('\n');
  p.reds = [...src.matchAll(/【赤】([\s\S]*?)【\/赤】/g)].map(x => x[1].trim());
  return p;
});

// ---- 04 ----
const t04 = rd('04_過去5年_本番判断表.md').split('\n');
const list04 = {};
let inList = false;
for (const l of t04) {
  if (l.startsWith('# **1.')) inList = true; else if (l.startsWith('# **2.')) inList = false;
  if (inList && l.startsWith('|') && !isSep(l)) {
    const c = cells(l); const ym = c[0].match(/（(\d{4})）/);
    if (ym) list04[`${ym[1]}-${c[1]}`] = { theme: c[2], stars: c[3], flow: c[4], judge: c[5] };
  }
}
const sec04 = {};
let cur = null;
for (const raw of t04) {
  const l = raw.trim();
  const h = l.match(/^## \*\*(令和.+?)（(\d{4})）(問\d)　(.+)　【適合度 (.+?)】\*\*$/);
  if (h) { cur = { id: `${h[2]}-${h[3]}`, title: h[4], stars: h[5], judge: null, toc: [], storyLines: [], caution: null }; sec04[cur.id] = cur; continue; }
  if (l.startsWith('# ')) { cur = null; continue; }
  if (!cur || !l) continue;
  if (l.startsWith('**本番判断：**')) cur.judge = l.replace('**本番判断：**', '').trim();
  else if (l.startsWith('|') && !isSep(l)) { const c = cells(l); if (/^第\d章$/.test(c[0])) cur.toc.push({ chapter: c[0], title: c[1], s1: c[2], s23: c[3] }); }
  else if (l.startsWith('>')) {
    const s = l.replace(/^>\s*/, ''); if (!s) continue;
    const m = s.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    let label = m ? m[1] : '', text = m ? m[2] : s;
    if (!m && /^注意 /.test(s)) { label = '注意'; text = s.slice(3); }
    if (label === '注意') cur.caution = text;
    else cur.storyLines.push({ label, text });
  }
}
for (const p of past) {
  p.fit04 = sec04[p.id] ? { ...sec04[p.id], list: list04[p.id] || null } : null;
}

// ---- 02 ----
const t02 = rd('02_元論文_詳細骨子.md').split('\n');
const genSecs = []; let g = null;
for (const raw of t02) {
  const l = raw.trim();
  const h = l.match(/^## (\d\.\d) (.+)$/);
  if (h) { g = { sec: h[1], title: h[2], keys: null, lines: [] }; genSecs.push(g); continue; }
  if (!g) continue;
  if (l.startsWith('**起動キー：')) g.keys = nob(l).replace('起動キー：', '');
  else if (/^> ・/.test(l)) g.lines.push(l.replace(/^> ・/, ''));
}
// キーを色付きトークンに分割
function tokenize(s) {
  const out = []; let color = null, buf = '';
  const push = () => { if (buf.trim()) out.push({ t: buf.trim(), c: color }); buf = ''; };
  let i = 0;
  while (i < s.length) {
    const m = s.slice(i).match(/^【(\/?)(赤|え|灰)】/);
    if (m) { if (buf.trim()) { out.push({ t: buf.trim(), c: color }); buf = ''; } color = m[1] ? null : m[2]; i += m[0].length; continue; }
    if (s[i] === '・') { push(); i++; continue; }
    buf += s[i]; i++;
  }
  push();
  // 「【赤】WhoWhatHow」のように1つのタグ内で ・ が無い場合はそのまま1トークン
  return out;
}
const chapOf = sec => ({ '1': 'a', '2': 'i', '3': 'u' })[sec[0]];
genSecs.forEach(s => { s.q = chapOf(s.sec); s.tokens = tokenize(s.keys); });

// ---- 03 ----
const t03 = rd('03_ITEC_TAC_起動キー.md').split('\n');
const kt = { itec: [], tac: [] }; const overall = {};
let typ = null, ks = null;
for (const raw of t03) {
  const l = raw.trim();
  if (l.startsWith('# 1. ITEC')) { typ = 'itec'; ks = null; continue; }
  if (l.startsWith('# 2. TAC')) { typ = 'tac'; ks = null; continue; }
  if (l.startsWith('# 3.')) { typ = null; continue; }
  if (!typ || !l) continue;
  if (l.startsWith('全体：')) { overall[typ] = l; continue; }
  const h = l.match(/^## (ITEC|TAC) (\d\.\d) (.+)$/);
  if (h) { ks = { sec: h[2], title: h[3], keys: null, rows: [] }; kt[typ].push(ks); continue; }
  if (!ks) continue;
  if (l.startsWith('|')) { if (isSep(l)) continue; const c = cells(l); if (c[0] === 'キー') continue; ks.rows.push({ key: c[0], content: c[1], diff: c[2] }); }
  else if (!ks.keys) ks.keys = nob(l);
}
// 「【赤】WhoWhatHow【/赤】」等 ・区切りが無い部分は表のキー列で分割
for (const t of ['itec', 'tac']) for (const s of kt[t]) {
  s.q = chapOf(s.sec);
  s.tokens = s.rows.map(r => { const tk = tokenize(r.key); return { t: tk.map(x => x.t).join(''), c: tk[0] ? tk[0].c : null }; });
  // キー行の色を優先（原文のキー行の色付け。例：TAC 2.3 はキー行全体がえんじ）
  const lineTk = tokenize(s.keys);
  if (lineTk.length === s.tokens.length) s.tokens = lineTk;
}

// ---- 01 → blocks ----
const s01 = parse01(rd('01_元論文_全文.md'));
const MAP = [
  ['1.1', [0, 1], [0, 1]], ['1.1', [2, 3], [2, 3]], ['1.1', [4, 5], [4, 5, 6, 7]],
  ['1.2', [0, 1], [0, 1]], ['1.2', [2], [2, 3]], ['1.2', [3, 4], [4, 5]],
  ['2.1', [0], [1, 2]], ['2.1', [1, 2], [3, 4, 5]], ['2.1', [3, 4], [6, 7, 8]], ['2.1', [5, 6], [9, 10, 11]],
  ['2.2', [0], [0, 1, 2]], ['2.2', [1], [3, 4, 5]], ['2.2', [2], [6, 7, 8]], ['2.2', [3], [9, 10, 11]], ['2.2', [4], [12, 13, 14]],
  ['2.3', [0, 1, 2], [0, 1, 2]], ['2.3', [3], [3, 4]], ['2.3', [4], [5, 6]],
  ['3.1', [0, 1], [0, 1, 2]], ['3.1', [2, 3], [3, 4, 5]], ['3.1', [4], [6, 7]], ['3.1', [5], [8, 9, 10]],
  ['3.2', [0, 1, 2, 3, 4], [0, 1, 2]],
  ['3.3', [0, 1, 2], [0, 1, 2]], ['3.3', [3, 4], [3, 4]], ['3.3', [5], [5, 6]],
];
const blocks = [];
MAP.forEach(([sec, li, si], n) => {
  const gs = genSecs.find(s => s.sec === sec);
  const sents = si.map(i => { const x = s01[sec].sents[i]; if (!x) throw new Error(sec + ' sent ' + i); return x; });
  if (sents.length > 4) throw new Error('>4');
  blocks.push({ id: `gen-${n + 1}`, type: 'gen', sec, title: gs.title, q: chapOf(sec), lines: li.map(i => { const x = gs.lines[i]; if (x === undefined) throw new Error(sec + ' line ' + i); return x; }),
    allLines: gs.lines, keys: gs.keys, answer: sents, full: true });
});
for (const t of ['itec', 'tac']) kt[t].forEach(s => {
  blocks.push({ id: `${t}-${s.sec}`, type: t, sec: s.sec, title: s.title, q: s.q, keys: s.keys, rows: s.rows,
    answer: s.rows.map(r => `${r.key}：${r.content}`), full: false });
});

const keys = { gen: genSecs, itec: kt.itec, tac: kt.tac, overall };
const data = { past, keys, blocks, builtAt: new Date().toISOString().slice(0, 10) };
const out = '// 自動生成: node tools/build-data.mjs （docs/ から原文のまま抜き出し）\nwindow.DATA = ' + JSON.stringify(data, null, 1) + ';\n';
fs.writeFileSync(new URL('../data.js', import.meta.url), out);

// ---- 件数チェック ----
const n05 = t05.filter(l => /^\*\*(令和|平成).+年度（\d{4}）　問\d　/.test(l)).length;
const n03 = t03.filter(l => /^## (ITEC|TAC) /.test(l)).length;
const n02 = t02.filter(l => /^## \d\.\d /.test(l)).length;
console.log({ past: past.length, docs05: n05, with04: past.filter(p => p.fit04).length, docs04: Object.keys(sec04).length,
  gen: genSecs.length, docs02: n02, itec: kt.itec.length, tac: kt.tac.length, docs03: n03, blocks: blocks.length });
for (const p of past) {
  const miss = ['eval', 'summary', 'keywords', 'story'].filter(k => !p[k]);
  if (miss.length || Object.keys(p.setsumon).length !== 3 || p.sections.length !== 8) console.log('WARN', p.id, miss, Object.keys(p.setsumon).length, p.sections.length);
  if (p.fit04 && (p.fit04.toc.length !== 3 || !p.fit04.judge || !p.fit04.caution || !p.fit04.list)) console.log('WARN04', p.id, p.fit04.toc.length, !!p.fit04.judge, !!p.fit04.caution, !!p.fit04.list);
}
for (const t of ['itec', 'tac']) for (const s of kt[t]) if (s.tokens.length !== s.rows.length) console.log('WARNKEY', t, s.sec, s.tokens.length, s.rows.length);
