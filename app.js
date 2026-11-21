(function () {
  'use strict';
  var D = window.DATA;
  var NA = '資料に記載なし';
  var MODES = {
    A: { name: '型判定', short: 'A 型判定' },
    B: { name: 'キー再現', short: 'B キー再現' },
    C: { name: '骨子展開', short: 'C 骨子展開' },
    D: { name: '本文起動', short: 'D 本文起動' },
    E: { name: '△×だけ復習', short: 'E △×復習' }
  };
  var SPEED_LABEL = { 1: 'じっくり', 2: '標準', 3: '高速', 4: '超高速' };
  var TYPE_NAME = { gen: '元論文', itec: 'ITEC', tac: 'TAC' };
  var Q_NAME = { a: '設問ア（第1章）', i: '設問イ（第2章）', u: '設問ウ（第3章）' };
  var GRADE_VAL = { '○': 1, '△': 0.5, '×': 0 };
  var STORE = 'st-drill-v1';

  // ---------- 状態 ----------
  var S = { speed: 2, mode: 'A', log: [], decks: {}, lastKey: null, lastPast: null };
  var cur = null; // {mode, origMode, id, revealed, input}
  var timerId = null;

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          if ([1, 2, 3, 4].indexOf(o.speed) >= 0) S.speed = o.speed;
          if (MODES[o.mode]) S.mode = o.mode;
          if (Array.isArray(o.log)) S.log = o.log;
          if (o.decks && typeof o.decks === 'object') S.decks = o.decks;
          S.lastKey = o.lastKey || null; S.lastPast = o.lastPast || null;
        }
      }
    } catch (e) { /* localStorage が使えなくても動く */ }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }

  // ---------- 表示ヘルパ ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var MK = { '赤': 'mk-red', 'え': 'mk-enji', '灰': 'mk-gray' };
  // 【赤】【え】【灰】の印を色に変換（開閉の対応がずれていても崩れないようにする）
  function fmt(s) {
    if (s == null || s === '') return esc(NA);
    var out = '', depth = 0, re = /【(\/?)(赤|え|灰)】/g, last = 0, m;
    var str = String(s);
    while ((m = re.exec(str))) {
      out += esc(str.slice(last, m.index));
      if (m[1]) { if (depth > 0) { out += '</span>'; depth--; } }
      else { out += '<span class="' + MK[m[2]] + '">'; depth++; }
      last = re.lastIndex;
    }
    out += esc(str.slice(last));
    while (depth-- > 0) out += '</span>';
    return out;
  }
  function strip(s) { return String(s || '').replace(/【\/?(赤|え|灰)】/g, ''); }
  function diffFmt(s) {
    var plain = strip(s);
    if (plain.indexOf('青') >= 0 && s.indexOf('【') < 0) return '<span class="diff-blue">' + esc(s) + '</span>';
    return fmt(s);
  }
  function norm(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ''); }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function box(inner) { return '<div class="box">' + inner + '</div>'; }
  function sec(title, inner) { return '<h3>' + esc(title) + '</h3>' + inner; }
  function stackTable(rows) {
    // rows: [[{h:true,html}],...] 狭い画面でも横スクロールしない縦積み表
    return '<table class="stack"><tbody>' + rows.map(function (r) {
      return '<tr>' + r.map(function (c) { return '<td' + (c.h ? ' class="h"' : '') + '>' + c.html + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
  }

  // ---------- データ索引 ----------
  var pastById = {}; D.past.forEach(function (p) { pastById[p.id] = p; });
  var blockById = {}; D.blocks.forEach(function (b) { blockById[b.id] = b; });
  var B_ITEMS = [];
  ['gen', 'itec', 'tac'].forEach(function (t) { ['a', 'i', 'u'].forEach(function (q) { B_ITEMS.push(t + '|' + q); }); });
  function pool(mode) {
    if (mode === 'A' || mode === 'C') return D.past.map(function (p) { return p.id; });
    if (mode === 'B') return B_ITEMS.slice();
    if (mode === 'D') return D.blocks.map(function (b) { return b.id; });
    return [];
  }
  function itemType(mode, id) {
    if (mode === 'B') return id.split('|')[0];
    if (mode === 'D') return blockById[id] ? blockById[id].type : null;
    return null;
  }
  function keySecs(type, q) { return D.keys[type].filter(function (s) { return s.q === q; }); }

  // ---------- 進捗 ----------
  function latestGrades() {
    var m = {};
    S.log.forEach(function (e) { m[e.mode + ':' + e.id] = e; });
    return m;
  }
  function reviewItems() {
    var m = latestGrades(), out = [];
    Object.keys(m).forEach(function (k) { if (m[k].grade !== '○') out.push({ mode: m[k].mode, id: m[k].id }); });
    return out.filter(function (x) { return x.mode === 'B' ? B_ITEMS.indexOf(x.id) >= 0 : (x.mode === 'D' ? blockById[x.id] : pastById[x.id]); });
  }
  function renderProgress() {
    var mode = S.mode, entries, total;
    if (mode === 'E') { entries = S.log.filter(function (e) { return e.viaE; }); }
    else { entries = S.log.filter(function (e) { return e.mode === mode && !e.viaE; }); }
    var c = { '○': 0, '△': 0, '×': 0 };
    entries.forEach(function (e) { c[e.grade]++; });
    var head;
    if (mode === 'E') head = '<span>' + MODES.E.name + ' <b>' + entries.length + '</b>回答 ／ 残り対象 <b>' + reviewItems().length + '</b>件</span>';
    else { total = pool(mode).length; head = '<span>' + MODES[mode].name + ' <b>' + entries.length + ' / ' + total + '</b>問</span>'; }
    var rate = ['gen', 'itec', 'tac'].map(function (t) {
      var es = S.log.filter(function (e) { return (e.mode === 'B' || e.mode === 'D') && e.type === t; });
      var v = es.length ? Math.round(es.reduce(function (a, e) { return a + GRADE_VAL[e.grade]; }, 0) / es.length * 100) + '%' : '−';
      return '<span>' + TYPE_NAME[t] + ' <b>' + v + '</b><small>' + (es.length ? '（' + es.length + '）' : '') + '</small></span>';
    }).join('');
    $('#progress').innerHTML = head +
      '<span class="ok">○ <b>' + c['○'] + '</b></span><span class="mid">△ <b>' + c['△'] + '</b></span><span class="ng">× <b>' + c['×'] + '</b></span>' +
      '<span style="flex-basis:100%;height:0"></span>' + rate;
  }

  // ---------- ヘッダー ----------
  function renderTabs() {
    $('#tabs').innerHTML = Object.keys(MODES).map(function (k) {
      return '<button type="button" data-mode="' + k + '" aria-pressed="' + (S.mode === k) + '"><b>' + k + '</b>' + esc(MODES[k].name) + '</button>';
    }).join('');
  }
  function renderSpeed() {
    var h = '';
    [1, 2, 3, 4].forEach(function (n, i) {
      if (i) h += '<span class="bar" aria-hidden="true"></span>';
      h += '<button type="button" class="sp' + (S.speed === n ? ' on' : '') + '" data-speed="' + n + '" aria-pressed="' + (S.speed === n) + '" aria-label="速度' + n + ' ' + SPEED_LABEL[n] + '">' +
        '<span class="num">' + n + '</span><span class="tri">' + (S.speed === n ? '▲' : '') + '</span><span class="lab">' + SPEED_LABEL[n] + '</span></button>';
    });
    $('#speed').innerHTML = h;
  }
  function setSpeed(n) {
    if (S.speed === n) return;
    S.speed = n; save(); renderSpeed();
    if (cur && cur.revealed) renderAnswer();
  }

  // ---------- 出題 ----------
  function conflict(mode, id) {
    if (S.lastKey === mode + ':' + id) return true;
    if ((mode === 'A' || mode === 'C') && S.lastPast === id) return true;
    return false;
  }
  function draw(mode) {
    var valid = pool(mode);
    var deck = (S.decks[mode] || []).filter(function (id) { return valid.indexOf(id) >= 0; });
    if (!deck.length) deck = shuffle(valid);
    var idx = -1;
    for (var i = 0; i < deck.length; i++) if (!conflict(mode, deck[i])) { idx = i; break; }
    if (idx < 0) { // 残りが全部「直前と同じ」なら次の周を後ろにつなぐ
      deck = deck.concat(shuffle(valid));
      for (var j = 0; j < deck.length; j++) if (!conflict(mode, deck[j])) { idx = j; break; }
    }
    var id = deck.splice(idx, 1)[0];
    S.decks[mode] = deck;
    return id;
  }
  function drawE() {
    var items = reviewItems();
    if (!items.length) return null;
    var keys = items.map(function (x) { return x.mode + ':' + x.id; });
    var deck = (S.decks.E || []).filter(function (k) { return keys.indexOf(k) >= 0; });
    if (!deck.length) deck = shuffle(keys);
    var idx = 0;
    for (var i = 0; i < deck.length; i++) {
      var p = deck[i].split(':');
      if (!conflict(p[0], p.slice(1).join(':'))) { idx = i; break; }
    }
    var k = deck.splice(idx, 1)[0];
    S.decks.E = deck;
    var parts = k.split(':');
    return { mode: parts[0], id: parts.slice(1).join(':') };
  }
  function next() {
    stopTimer();
    var mode = S.mode, origMode, id;
    if (mode === 'E') {
      var it = drawE();
      if (!it) { cur = null; save(); renderEmptyE(); renderProgress(); return; }
      origMode = it.mode; id = it.id;
    } else { origMode = mode; id = draw(mode); }
    cur = { mode: mode, origMode: origMode, id: id, revealed: false, input: null, started: Date.now() };
    S.lastKey = origMode + ':' + id;
    if (origMode === 'A' || origMode === 'C') S.lastPast = id; else S.lastPast = null;
    save();
    renderQuestion();
    renderProgress();
    window.scrollTo(0, 0);
  }
  function renderEmptyE() {
    $('#card').innerHTML = '<div class="empty"><p><b>対象なし</b></p><p>このセッションで △・× を付けた問題はありません。</p></div>';
  }
  function grade(g) {
    if (!cur || !cur.revealed) return;
    S.log.push({ mode: cur.origMode, id: cur.id, grade: g, type: itemType(cur.origMode, cur.id), viaE: cur.mode === 'E', at: Date.now() });
    save();
    next();
  }

  // ---------- 共通パーツ ----------
  function eTag() { return cur.mode === 'E' ? '<div class="meta">E 復習（元：' + esc(MODES[cur.origMode].short) + '）</div>' : ''; }
  function pastHead(p) {
    return eTag() + '<div class="meta">' + esc(p.year) + '　' + esc(p.q) + '</div><h2>' + esc(p.theme) + '</h2>' +
      box(['a', 'i', 'u'].map(function (k) {
        return '<p><span class="lbl">設問' + { a: 'ア', i: 'イ', u: 'ウ' }[k] + '</span>' + fmt(p.setsumon[k]) + '</p>';
      }).join(''));
  }
  function gradeButtons(labels) {
    labels = labels || { '○': '○', '△': '△', '×': '×' };
    return '<h3>自己採点</h3><div class="btns">' +
      '<button type="button" class="btn g-ok" data-grade="○">' + esc(labels['○']) + '</button>' +
      '<button type="button" class="btn g-mid" data-grade="△">' + esc(labels['△']) + '</button>' +
      '<button type="button" class="btn g-ng" data-grade="×">' + esc(labels['×']) + '</button></div>';
  }
  function skipBtn() { return '<div class="btns"><button type="button" class="ghost skip" data-act="skip">この問題を飛ばす（記録しない）</button></div>'; }
  function sectionsTable(p, withContent) {
    return stackTable(p.sections.map(function (s) {
      var r = [{ h: true, html: esc(s.no) + '　' + fmt(s.title) }];
      if (withContent) r.push({ html: fmt(s.content) });
      return r;
    }));
  }
  function tocTable(f) {
    return stackTable(f.toc.map(function (t) {
      return [{ h: true, html: esc(t.chapter) + '　' + fmt(t.title) }, { html: fmt(t.s1) + '<br>' + fmt(t.s23) }];
    }));
  }
  function storyLines(f, onlyAIU) {
    return '<ul class="lines">' + f.storyLines.filter(function (l) { return !onlyAIU || l.label !== 'ストーリー'; }).map(function (l) {
      return '<li>' + (l.label ? '<b>' + fmt(l.label) + '</b>　' : '') + fmt(l.text) + '</li>';
    }).join('') + '</ul>';
  }
  function redsHtml(p) {
    if (!p.reds.length) return '<p>' + esc(NA) + '（この問の資料には赤字の印なし）</p>' + (p.note ? '<p><b>本番での注意</b>　' + fmt(p.note) + '</p>' : '');
    return '<ul class="lines">' + p.reds.map(function (r) { return '<li><span class="mk-red">' + esc(r) + '</span></li>'; }).join('') + '</ul>';
  }

  // ---------- 出題画面 ----------
  function renderQuestion() {
    var m = cur.origMode, h = '';
    if (m === 'A') {
      var p = pastById[cur.id];
      h = pastHead(p) + '<h3>どの型を使う？</h3><div class="btns choice">' +
        ['元論文', 'ITEC', 'TAC', '選ばない'].map(function (c) { return '<button type="button" class="btn" data-pick="' + c + '">' + c + '</button>'; }).join('') +
        '</div>' + skipBtn() + '<div id="ans"></div>';
    } else if (m === 'B') {
      var t = cur.id.split('|')[0], q = cur.id.split('|')[1];
      var secs = keySecs(t, q);
      h = eTag() + '<div class="meta">キー再現</div><h2>' + TYPE_NAME[t] + 'の' + Q_NAME[q] + 'のキーは？</h2>' +
        box('<p class="note">節：' + secs.map(function (s) { return esc(s.sec + ' ' + strip(s.title)); }).join(' ／ ') + '</p>') +
        '<label class="f" for="inB">キーを入力（区切り・改行は自由）</label><textarea id="inB" autocomplete="off" placeholder="例：私・建・3…"></textarea>' +
        '<div class="btns"><button type="button" class="btn primary" data-act="reveal" disabled>答え合わせ</button></div>' + skipBtn() + '<div id="ans"></div>';
    } else if (m === 'C') {
      var pc = pastById[cur.id];
      h = pastHead(pc) +
        '<div class="box"><div class="timer" id="timer"><span class="t" id="tt">0:00</span><span class="note">目安 15分</span></div>' +
        '<div class="tbar"><i id="tfill" style="width:0"></i><s style="left:20%"></s><s style="left:40%"></s><s style="left:66.7%"></s></div>' +
        '<div class="tlegend">問題選択＋型 3分 ／ キー 2〜3分（〜6分）／ 詳細骨子 7〜10分（〜15分）</div></div>' +
        '<label class="f" for="c1">① 使用型</label><select id="c1"><option value="">選んでください</option><option>元論文</option><option>ITEC</option><option>TAC</option><option>選ばない</option></select>' +
        '<label class="f" for="c2">② 設問アの骨子</label><textarea id="c2"></textarea>' +
        '<label class="f" for="c3">③ 設問イの骨子</label><textarea id="c3"></textarea>' +
        '<label class="f" for="c4">④ 設問ウの骨子</label><textarea id="c4"></textarea>' +
        '<label class="f" for="c5">⑤ 元の型から変更する点</label><textarea id="c5"></textarea>' +
        '<div class="btns"><button type="button" class="btn primary" data-act="reveal" disabled>答え合わせ</button></div>' + skipBtn() + '<div id="ans"></div>';
    } else if (m === 'D') {
      var b = blockById[cur.id];
      var cue;
      if (b.type === 'gen') cue = '<ul class="lines">' + b.lines.map(function (l) { return '<li>' + fmt(l) + '</li>'; }).join('') + '</ul>';
      else cue = '<p class="note">キー</p><div class="keys">' + keyChips(D.keys[b.type].filter(function (s) { return s.sec === b.sec; })[0].tokens, null) + '</div>';
      h = eTag() + '<div class="meta">本文起動</div><h2>' + TYPE_NAME[b.type] + '・' + esc(b.sec) + ' ' + fmt(b.title) + '</h2>' + box(cue) +
        '<label class="f" for="inD">ここから本文を2〜4文で</label><textarea id="inD" style="min-height:140px"></textarea>' +
        '<div class="btns"><button type="button" class="btn primary" data-act="reveal" disabled>答え合わせ</button></div>' + skipBtn() + '<div id="ans"></div>';
    }
    $('#card').innerHTML = h;
    if (m === 'C') startTimer();
    var revealBtn = $('[data-act="reveal"]');
    if (revealBtn) {
      var check = function () {
        var ok;
        if (m === 'C') ok = !!$('#c1').value;
        else ok = !!($('#inB') || $('#inD')).value.trim();
        revealBtn.disabled = !ok;
      };
      $('#card').oninput = check;
      $('#card').onchange = check;
    }
  }

  function keyChips(tokens, missSet) {
    return tokens.map(function (t, i) {
      var cls = 'key' + (missSet && missSet[i] ? ' miss' : '');
      var inner = t.c ? '<span class="' + MK[t.c] + '">' + esc(t.t) + '</span>' : esc(t.t);
      return '<span class="' + cls + '">' + inner + '</span>';
    }).join('');
  }

  // ---------- タイマー（C） ----------
  function startTimer() {
    stopTimer();
    var tick = function () {
      if (!cur) return;
      var sec = Math.floor((Date.now() - cur.started) / 1000);
      var el = $('#tt'); if (!el) return;
      el.textContent = Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2);
      $('#tfill').style.width = Math.min(100, sec / 900 * 100) + '%';
      $('#timer').classList.toggle('over', sec > 900);
    };
    tick(); timerId = setInterval(tick, 1000);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  // ---------- 答え合わせ ----------
  function reveal(pick) {
    if (!cur || cur.revealed) return;
    var m = cur.origMode;
    if (m === 'A') cur.input = pick;
    else if (m === 'B') cur.input = $('#inB').value;
    else if (m === 'D') cur.input = $('#inD').value;
    else if (m === 'C') {
      cur.input = { type: $('#c1').value, a: $('#c2').value, i: $('#c3').value, u: $('#c4').value, chg: $('#c5').value };
      stopTimer();
      cur.elapsed = Math.floor((Date.now() - cur.started) / 1000);
    }
    cur.revealed = true;
    // 入力欄をロック
    Array.prototype.forEach.call(document.querySelectorAll('#card textarea, #card select, #card [data-pick], #card [data-act]'), function (el) { el.disabled = true; });
    renderAnswer();
  }

  function renderAnswer() {
    var m = cur.origMode, sp = S.speed, h = '';
    if (m === 'A') h = answerA(sp);
    else if (m === 'B') h = answerB(sp);
    else if (m === 'C') h = answerC(sp);
    else if (m === 'D') h = answerD(sp);
    var labels = m === 'D' ? { '○': '○ 十分', '△': '△ 因果・具体性不足', '×': '× 本文化できていない' } : null;
    $('#ans').innerHTML = '<div class="ans">' + h + gradeButtons(labels) + '</div>';
  }

  function answerA(sp) {
    var p = pastById[cur.id], f = p.fit04, pick = cur.input, h = '';
    h += box('<p><span class="lbl">回答</span>' + esc(pick) + '</p>');
    var rec = '<p><b>元論文</b>：' + fmt(p.eval) + '<span class="src">05</span></p>';
    if (f) rec += '<p>適合度 ' + esc(f.stars) + '　本番判断：' + fmt(f.judge) + '<span class="src">04</span></p>';
    if (pick === 'ITEC' || pick === 'TAC') {
      rec += '<p><b>' + pick + '</b>：資料に明記なし（過去問ごとに ITEC・TAC を推奨する記述は資料にありません）</p>' +
        '<p class="note">ITEC ' + esc(D.keys.overall.itec) + '</p><p class="note">TAC ' + esc(D.keys.overall.tac) + '</p>';
    }
    h += sec('【推奨型】', box(rec));
    if (sp <= 3) {
      var why = '';
      if (f && f.list) why += '<p>' + fmt(f.list.judge) + '<span class="src">04 一覧</span></p><p class="note">使う流れ：' + fmt(f.list.flow) + '</p>';
      why += '<p>' + fmt(p.summary) + '<span class="src">05 要約</span></p>';
      h += sec('【理由】', box(why));
      h += sec('本文キーワード', box('<p>' + fmt(p.keywords) + '</p>'));
    }
    if (sp <= 2) {
      var dif = '<p><b>注意（04）</b>　' + (f ? fmt(f.caution) : esc(NA)) + '</p>';
      if (p.note) dif += '<p><b>本番での注意（05）</b>　' + fmt(p.note) + '</p>';
      dif += '<p><b>赤字＝元の型から変更する点（05）</b></p>' + redsHtml(p);
      h += sec('【注意する差分】', box(dif));
    }
    if (sp <= 1) {
      h += sec('全体ストーリー（05）', box('<p>' + fmt(p.story) + '</p>'));
      h += sec('目次（04）', f ? tocTable(f) : box(esc(NA)));
      if (f) h += sec('ストーリー（04）', box(storyLines(f)));
      h += sec('章・節と書く内容（05）', sectionsTable(p, true));
    }
    return h;
  }

  function answerB(sp) {
    var t = cur.id.split('|')[0], q = cur.id.split('|')[1];
    var secs = keySecs(t, q), inp = norm(cur.input), h = '', missList = [];
    var body = secs.map(function (s) {
      var miss = s.tokens.map(function (tk) { return inp.indexOf(norm(strip(tk.t))) < 0; });
      s.tokens.forEach(function (tk, i) { if (miss[i]) missList.push({ s: s, tk: tk, i: i }); });
      return '<p><b>' + esc(s.sec) + '</b> ' + fmt(s.title) + '</p><div class="keys">' + keyChips(s.tokens, miss) + '</div>';
    }).join('');
    h += sec('【正しいキー】', box(body + '<p class="note">赤枠＝入力に含まれなかったキー</p>'));
    if (sp <= 3) {
      h += sec('【抜けたキー】', box(missList.length ? '<div class="keys">' + missList.map(function (x) {
        return '<span class="key miss">' + (x.tk.c ? '<span class="' + MK[x.tk.c] + '">' + esc(x.tk.t) + '</span>' : esc(x.tk.t)) + '</span>';
      }).join('') + '</div>' : '<p>なし</p>'));
    }
    if (sp === 2 && missList.length) {
      var pts = [];
      missList.forEach(function (x) {
        if (t === 'gen') {
          x.s.lines.forEach(function (l) { if (strip(l).replace(/^[\s　]+/, '').indexOf(strip(x.tk.t) + '：') === 0) pts.push(l); });
        } else if (x.s.rows[x.i]) pts.push(x.s.rows[x.i].key + '：' + x.s.rows[x.i].content);
      });
      h += sec('抜けたキーの内容', box(pts.length ? '<ul class="lines">' + pts.map(function (l) { return '<li>' + fmt(l) + '</li>'; }).join('') + '</ul>' : '<p class="note">' + esc(NA) + '（この節の骨子行はキー名で始まっていません。速度1で全行を表示）</p>'));
    }
    if (sp <= 1) {
      secs.forEach(function (s) {
        if (t === 'gen') h += sec(s.sec + ' ' + strip(s.title), box('<p class="note">起動キー：' + fmt(s.keys) + '</p><ul class="lines">' + s.lines.map(function (l) { return '<li>' + fmt(l) + '</li>'; }).join('') + '</ul>'));
        else h += sec(s.sec + ' ' + strip(s.title), stackTable(s.rows.map(function (r) {
          return [{ h: true, html: fmt(r.key) + '　<span class="note">差分：</span>' + diffFmt(r.diff) }, { html: fmt(r.content) }];
        })));
      });
      if (t !== 'gen') h += '<p class="note">' + esc(D.keys.overall[t]) + '</p>';
    }
    return h;
  }

  function answerC(sp) {
    var p = pastById[cur.id], f = p.fit04, inp = cur.input, h = '';
    var el = cur.elapsed || 0;
    h += box('<p><span class="lbl">所要</span>' + Math.floor(el / 60) + '分' + ('0' + el % 60).slice(-2) + '秒' + (el > 900 ? '（15分超過）' : '') + '　<span class="lbl">使用型</span>' + esc(inp.type) + '</p>' +
      (sp <= 2 ? '<div class="mine">ア：' + esc(inp.a) + '\nイ：' + esc(inp.i) + '\nウ：' + esc(inp.u) + '\n変更点：' + esc(inp.chg) + '</div>' : ''));
    var rec = '<p><b>型</b>　元論文：' + fmt(p.eval) + '<span class="src">05</span>' + (f ? '　／　適合度 ' + esc(f.stars) + ' ' + fmt(f.judge) + '<span class="src">04</span>' : '') + '</p>';
    if (inp.type === 'ITEC' || inp.type === 'TAC') rec += '<p class="note">' + inp.type + '：資料に明記なし。' + esc(D.keys.overall[inp.type === 'ITEC' ? 'itec' : 'tac']) + '</p>';
    rec += '<p><b>全体ストーリー</b>　' + fmt(p.story) + '<span class="src">05</span></p>';
    if (sp <= 2) rec += '<p><b>ストーリー（04）</b></p>' + (f ? storyLines(f, true) : '<p>' + esc(NA) + '</p>');
    h += sec('【資料上の推奨骨子】', box(rec));
    if (sp <= 1) {
      h += sec('目次（04）', f ? tocTable(f) : box(esc(NA)));
      h += sec('章・節と書く内容（05）', sectionsTable(p, true));
    } else if (sp <= 3) {
      h += sec('章・節（05）', sectionsTable(p, false));
    }
    if (sp <= 3) {
      var all = norm([inp.a, inp.i, inp.u, inp.chg].join(' '));
      var kws = strip(p.keywords || '').split('／').map(function (s) { return s.trim(); }).filter(Boolean);
      var missing = kws.filter(function (k) { return all.indexOf(norm(k)) < 0; });
      h += sec('【本番で絶対入れる語】', box('<p>' + fmt(p.keywords) + '<span class="src">05 本文キーワード</span></p>' +
        '<p class="note">入力に無かった語：' + (missing.length ? esc(missing.join('／')) : 'なし') + '（文字一致の機械判定。言い換えは自分で確認）</p>'));
    }
    h += sec('【変更点】（赤字）', box(redsHtml(p) + (sp <= 2 && f ? '<p><b>注意（04）</b>　' + fmt(f.caution) + '</p>' : '') + (sp <= 2 && p.note && p.reds.length ? '<p><b>本番での注意（05）</b>　' + fmt(p.note) + '</p>' : '')));
    return h;
  }

  function answerD(sp) {
    var b = blockById[cur.id], h = '';
    if (sp <= 2) h += box('<div class="mine">' + esc(cur.input) + '</div>');
    var ex = '<ul class="lines">' + b.answer.map(function (s) { return '<li>' + fmt(s) + '</li>'; }).join('') + '</ul>';
    if (b.type === 'gen') ex += '<p class="note">01 元論文本文より（' + b.answer.length + '文）</p>';
    else ex = '<p class="note">全文なし（キー表から）＝「思い出す内容」列</p>' + ex;
    h += sec('【正解例】', box(ex));
    if (sp <= 3) {
      if (b.type === 'gen') h += sec('起動キー（02）', box('<p>' + fmt(b.keys) + '</p>'));
      else h += sec('キー（03）', box('<p>' + fmt(b.keys) + '</p>'));
    }
    if (sp <= 1) {
      if (b.type === 'gen') h += sec(b.sec + ' の骨子 全行（02）', box('<ul class="lines">' + b.allLines.map(function (l) { return '<li>' + fmt(l) + '</li>'; }).join('') + '</ul>'));
      else h += sec('差分（03）', stackTable(b.rows.map(function (r) { return [{ h: true, html: fmt(r.key) + '　<span class="note">差分：</span>' + diffFmt(r.diff) }, { html: fmt(r.content) }]; })));
    }
    return h;
  }

  // ---------- イベント ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('button'); if (!t || t.disabled) return;
    if (t.dataset.mode) { if (S.mode !== t.dataset.mode) { S.mode = t.dataset.mode; save(); renderTabs(); next(); } return; }
    if (t.dataset.speed) { setSpeed(+t.dataset.speed); return; }
    if (t.dataset.pick) { reveal(t.dataset.pick); return; }
    if (t.dataset.grade) { grade(t.dataset.grade); return; }
    if (t.dataset.act === 'reveal') { reveal(); return; }
    if (t.dataset.act === 'skip') { next(); return; }
    if (t.id === 'reset') {
      if (!window.confirm('このセッションの記録（○△×・出題順）を消去しますか？')) return;
      S.log = []; S.decks = {}; S.lastKey = null; S.lastPast = null; save(); next(); return;
    }
  });
  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input' || tag === 'select' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^[1-4]$/.test(ev.key)) setSpeed(+ev.key);
  });

  // ---------- 起動 ----------
  load();
  renderTabs(); renderSpeed();
  next();
})();
