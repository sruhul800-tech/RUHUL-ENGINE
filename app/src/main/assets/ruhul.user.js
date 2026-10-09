// ==UserScript==
// @name         Ruhuls Engine X5 Pro
// @namespace    ruhul.engine
// @version      2.0
// @description  Floating signal panel + auto bet inside the WinGo page (7-layer ensemble, martingale steps, session limits, CSV log)
// @match        *://*.ar-lottery01.com/*
// @match        *://*.ar-lottery02.com/*
// @match        *://*.ar-lottery03.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      draw.ar-lottery01.com
// @connect      draw.ar-lottery02.com
// @connect      draw.ar-lottery03.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (!/wingo/i.test(location.href) || /\.json/i.test(location.pathname)) return;
  if (window.__ruhulEngine) return;
  window.__ruhulEngine = true;

  // if this page only wraps the game in an iframe, let the copy inside the iframe show the panel
  const gameChild = () => Array.from(document.querySelectorAll('iframe')).some(f => /wingo|ar-lottery/i.test(f.getAttribute('src') || ''));
  const boot = () => { if (!gameChild()) main(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800));
  else setTimeout(boot, 800);

  function main() {
  // ------------------------------------------------------------------ config
  const PASSWORD = 'RUHUL321';
  const API_HOSTS = ['https://draw.ar-lottery01.com', 'https://draw.ar-lottery02.com', 'https://draw.ar-lottery03.com'];
  const API_PATH = '/WinGo/WinGo_30S/GetHistoryIssuePage.json';
  const MAX_HIST = 600;
  const POLL_MS = (typeof window.__RUHUL_POLL_MS === 'number') ? window.__RUHUL_POLL_MS : 2000;
  const LAYERS = ['m1', 'm2', 'st', 'lg', 'zz', 'mr', 'dg'];
  const LABEL = { m1: 'M1', m2: 'M2', st: 'ST', lg: 'LG', zz: 'ZZ', mr: 'MR', dg: 'DG' };
  const AVATAR = 'https://i.ibb.co/35sLddh9/image.png';
  const FOLLOW_URL = 'https://www.facebook.com/share/1HDAxPn2fd/';
  const NATIVE = typeof window.RuhulBridge !== 'undefined' && typeof window.__ruhulTap === 'function';

  const toType = n => (n >= 5 ? 'BIG' : 'SMALL');
  const opposite = t => (t === 'BIG' ? 'SMALL' : 'BIG');
  const nice = t => (t === 'BIG' ? 'Big' : 'Small');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const big = s => { try { return BigInt(s); } catch (e) { return 0n; } };
  const money = v => '৳' + (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

  // ------------------------------------------------------------------ storage
  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  function store(k, v) {
    try { if (hasGM) GM_setValue(k, JSON.stringify(v)); else localStorage.setItem('ruhul_' + k, JSON.stringify(v)); } catch (e) {}
  }
  function load(k, d) {
    try {
      const raw = hasGM ? GM_getValue(k, null) : localStorage.getItem('ruhul_' + k);
      return raw ? JSON.parse(raw) : d;
    } catch (e) { return d; }
  }

  // ------------------------------------------------------------------ state
  const DEFAULT_CFG = { steps: 7, rounds: 100, target: 0, lossStop: 0, sound: true, size: 90, mode: 'full', x: 8, y: 60 };
  const st = {
    unlocked: false, auto: false, busy: false, fetching: false, dead: false,
    balance: 0, startBalance: 0, step: 1, baseBet: 0, wins: 0, losses: 0,
    pending: null, lastIssue: null, history: [], sess: { rounds: 0, start: 0 },
    cfg: Object.assign({}, DEFAULT_CFG, load('cfg', {})),
    hist: load('hist', {}), rows: load('rows', []), logs: [],
  };
  const saveCfg = () => store('cfg', st.cfg);
  const totalUnits = () => Math.pow(2, st.cfg.steps) - 1;
  const bustChance100 = k => Math.round((1 - Math.exp(-100 / Math.pow(2, k + 1))) * 100);

  function log(t) {
    const line = new Date().toTimeString().slice(0, 8) + ' ' + t;
    st.logs.push(line);
    if (st.logs.length > 40) st.logs.shift();
    try { console.log('[ruhul]', t); } catch (e) {}
    if (typeof renderLog === 'function') renderLog();
  }

  // ------------------------------------------------------------------ AI
  class Ensemble {
    constructor() {
      this.NF = 12;
      this.w = new Array(12).fill(0);
      this.b = 0;
      this.recent = {};
      this.total = {};
      LAYERS.concat(['ens']).forEach(k => { this.total[k] = [0, 0]; });
      LAYERS.forEach(k => { this.recent[k] = []; });
      this.boot = false;
    }
    m1(h) {
      const tr = { BIG: { BIG: 0, SMALL: 0 }, SMALL: { BIG: 0, SMALL: 0 } };
      for (let i = 0; i < h.length - 1; i++) tr[h[i + 1]][h[i]]++;
      const t = tr[h[0]];
      if (t.BIG === t.SMALL) return h[0];
      return t.BIG > t.SMALL ? 'BIG' : 'SMALL';
    }
    m2(h) {
      if (h.length < 30) return null;
      const c = { BIG: 0, SMALL: 0 };
      for (let i = 0; i < h.length - 2; i++) if (h[i + 1] === h[0] && h[i + 2] === h[1]) c[h[i]]++;
      const tot = c.BIG + c.SMALL;
      if (tot < 4 || c.BIG === c.SMALL) return null;
      return c.BIG > c.SMALL ? 'BIG' : 'SMALL';
    }
    st(h) {
      const last = h[0];
      let L = 1;
      while (L < h.length && h[L] === last) L++;
      const cap = Math.min(L, 4);
      const c = h.slice().reverse();
      let run = 1, cont = 0, tot = 0;
      for (let k = 0; k < c.length - 1; k++) {
        if (Math.min(run, 4) === cap) { tot++; if (c[k + 1] === c[k]) cont++; }
        run = c[k + 1] === c[k] ? run + 1 : 1;
      }
      if (tot < 3) return L >= 4 ? opposite(last) : last;
      const rate = cont / tot;
      if (rate === 0.5) return L >= 3 ? opposite(last) : last;
      return rate > 0.5 ? last : opposite(last);
    }
    feats(seq) {
      const f = seq.slice(0, this.NF).map(x => (x === 'BIG' ? 1 : -1));
      while (f.length < this.NF) f.push(0);
      return f;
    }
    p(f) {
      let z = this.b;
      for (let i = 0; i < this.NF; i++) z += this.w[i] * f[i];
      z = Math.max(-30, Math.min(30, z));
      return 1 / (1 + Math.exp(-z));
    }
    lg(h) { return this.p(this.feats(h)) > 0.5 ? 'BIG' : 'SMALL'; }
    trainOne(h) {
      if (h.length < 3) return;
      const f = this.feats(h.slice(1));
      const y = h[0] === 'BIG' ? 1 : 0;
      const err = y - this.p(f);
      for (let i = 0; i < this.NF; i++) this.w[i] += 0.03 * err * f[i];
      this.b += 0.03 * err;
    }
    bootstrap(h) {
      for (let e = 0; e < 3; e++) for (let i = 0; i < h.length - 2; i++) this.trainOne(h.slice(i));
      this.boot = true;
    }
    zz(h) {
      if (h.length >= 5) {
        let ok = true;
        for (let i = 0; i < 4; i++) if (h[i] === h[i + 1]) ok = false;
        if (ok) return opposite(h[0]);
      }
      return null;
    }
    mr(h) {
      if (h.length < 12) return null;
      const w = h.slice(0, 20);
      const r = w.filter(x => x === 'BIG').length / w.length;
      if (r >= 0.7) return 'SMALL';
      if (r <= 0.3) return 'BIG';
      return null;
    }
    dg(h, d) {
      if (d.length < 40) return null;
      const c = { BIG: 0, SMALL: 0 };
      for (let i = 1; i < d.length; i++) if (d[i] === d[0]) c[h[i - 1]]++;
      const tot = c.BIG + c.SMALL;
      if (tot < 5 || c.BIG === c.SMALL) return null;
      return c.BIG > c.SMALL ? 'BIG' : 'SMALL';
    }
    weight(k) {
      const r = this.recent[k];
      if (r.length < 20) return 1;
      const acc = r.reduce((a, b) => a + b, 0) / r.length;
      return Math.min(2, Math.max(0.3, 1 + 4 * (acc - 0.5)));
    }
    predict(h, d) {
      if (h.length < 4) {
        const t = Math.random() < 0.5 ? 'BIG' : 'SMALL';
        const l = {}; LAYERS.forEach(k => { l[k] = null; });
        return { type: t, agree: 50, layers: l };
      }
      const layers = {};
      LAYERS.forEach(k => { layers[k] = this[k](h, d); });
      let sb = 0, ss = 0;
      LAYERS.forEach(k => {
        const v = layers[k];
        if (v === null) return;
        const w = this.weight(k);
        if (v === 'BIG') sb += w; else ss += w;
      });
      let fin;
      if (sb === ss) fin = layers.m1 || h[0]; else fin = sb > ss ? 'BIG' : 'SMALL';
      const agree = (sb + ss) ? Math.round(Math.max(sb, ss) / (sb + ss) * 100) : 50;
      return { type: fin, agree, layers };
    }
    score(layers, fin, actual) {
      LAYERS.forEach(k => {
        const v = layers[k];
        if (v === null || v === undefined) return;
        const ok = v === actual ? 1 : 0;
        const r = this.recent[k]; r.push(ok); if (r.length > 100) r.shift();
        this.total[k][1]++; this.total[k][0] += ok;
      });
      this.total.ens[1]++; if (fin === actual) this.total.ens[0]++;
    }
    pct(k) { const t = this.total[k]; return t[1] ? String(Math.round(t[0] / t[1] * 100)) : '--'; }
    layersText() { return LAYERS.map(k => LABEL[k] + ' ' + this.pct(k) + '%').join('   '); }
  }
  const engine = new Ensemble();

  // ------------------------------------------------------------------ data
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      const done = txt => { try { resolve(JSON.parse(txt)); } catch (e) { reject(e); } };
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: 6000, headers: { Accept: 'application/json' },
          onload: r => (r.status >= 200 && r.status < 300 ? done(r.responseText) : reject(new Error('HTTP ' + r.status))),
          onerror: () => reject(new Error('network')), ontimeout: () => reject(new Error('timeout')),
        });
      } else {
        fetch(url).then(r => r.text()).then(done).catch(reject);
      }
    });
  }
  async function fetchDraws() {
    let lastErr = null;
    for (const host of API_HOSTS) {
      try {
        const j = await gmGet(host + API_PATH + '?ts=' + Date.now());
        const out = j.data.list.map(it => ({ issue: String(it.issueNumber || it.issue || '----'), num: parseInt(it.number, 10) }));
        if (out.length) return out;
      } catch (e) { lastErr = e; }
    }
    throw new Error('API fail: ' + (lastErr && lastErr.message));
  }
  function mergeHistory(fetched) {
    fetched.forEach(it => { st.hist[it.issue] = it.num; });
    const keys = Object.keys(st.hist).sort((a, b) => (big(a) < big(b) ? 1 : big(a) > big(b) ? -1 : 0)).slice(0, MAX_HIST);
    let use = [keys[0]];
    for (const k of keys.slice(1)) {
      if (big(use[use.length - 1]) - big(k) !== 1n) break;
      use.push(k);
    }
    if (use.length < fetched.length) use = fetched.map(i => i.issue);
    const keep = {}; keys.forEach(k => { keep[k] = st.hist[k]; });
    st.hist = keep; store('hist', keep);
    const nums = use.map(k => st.hist[k]);
    return { types: nums.map(toType), nums };
  }
  function betAmount() {
    if (st.baseBet === 0) st.baseBet = Math.max(1, Math.floor(st.balance / totalUnits()));
    let amt = Math.max(1, Math.round(st.baseBet * Math.pow(2, Math.min(st.step, st.cfg.steps) - 1)));
    if (amt > st.balance) amt = Math.floor(st.balance);
    return amt;
  }

  // ------------------------------------------------------------------ finding things on the page (by text)
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const rectOf = el => el.getBoundingClientRect();
  const areaOf = el => { const r = rectOf(el); return r.width * r.height; };
  function vis(el) {
    const r = rectOf(el);
    if (r.width < 3 || r.height < 3) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }
  const allEls = () => Array.from(document.querySelectorAll('body *')).filter(e => e !== hostEl);
  const smallest = list => (list.length ? list.reduce((m, e) => (areaOf(e) < areaOf(m) ? e : m)) : null);
  const follows = (x, y) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
  function label(t, all) {
    const l = all.filter(e => vis(e) && norm(e.innerText).toLowerCase() === t.toLowerCase());
    return l.length ? l[l.length - 1] : null;
  }
  function findEl(kind, text, opt) {
    opt = opt || {};
    const all = allEls();
    if (kind === 'side') {
      const re = new RegExp('^' + text + '\\s*x\\s*\\d', 'i');
      return smallest(all.filter(e => vis(e) && areaOf(e) > 600 && norm(e.innerText).length <= 14 && re.test(norm(e.innerText))));
    }
    if (kind === 'text') return label(text, all);
    if (kind === 'prefix') {
      const c = all.filter(e => vis(e) && norm(e.innerText).length <= 40 && norm(e.innerText).toLowerCase().startsWith(text.toLowerCase()));
      if (!c.length) return null;
      const mx = Math.max.apply(null, c.map(e => norm(e.innerText).length));
      return smallest(c.filter(e => norm(e.innerText).length === mx));
    }
    if (kind === 'input_after') {
      const lb = label(text, all);
      return lb ? (all.find(e => e.tagName === 'INPUT' && vis(e) && follows(lb, e)) || null) : null;
    }
    if (kind === 'after_text') {
      const lb = label(text, all);
      return lb ? (all.find(e => vis(e) && !lb.contains(e) && follows(lb, e) && norm(e.innerText) && norm(e.innerText).length <= 12) || null) : null;
    }
    if (kind === 'chip') {
      const lb = label(opt.after, all);
      if (!lb) return null;
      const c = all.filter(e => vis(e) && follows(lb, e) && norm(e.innerText) === text && areaOf(e) < 30000);
      return c.length ? c[0] : null;
    }
    return null;
  }
  function synthClick(el) {
    const r = rectOf(el), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    try {
      const tc = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [tc], targetTouches: [tc], changedTouches: [tc] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [tc] }));
    } catch (e) {}
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
      try {
        el.dispatchEvent(t.indexOf('pointer') === 0 ? new PointerEvent(t, Object.assign({ pointerType: 'touch', isPrimary: true }, o)) : new MouseEvent(t, o));
      } catch (e) {}
    });
  }
  function setInput(el, v) {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const r = fn(); if (r) return r; await sleep(200); }
    return null;
  }
  function pageTimeLeft() {
    const m = /time remaining\s*(\d+):(\d+)(?::(\d+))?/i.exec(document.body.innerText || '');
    if (!m) return null;
    return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
  }
  function timeLeft() {
    const t = pageTimeLeft();
    if (t !== null && t <= 30) return t;
    return 30 - (new Date().getSeconds() % 30);
  }

  // a real touch through the Android app (trusted by the page). The panel lets the touch pass through meanwhile.
  let passT = null;
  function passThrough(ms) {
    hostEl.style.pointerEvents = 'none';
    clearTimeout(passT);
    passT = setTimeout(() => { hostEl.style.pointerEvents = ''; }, ms);
  }
  async function press(el) {
    if (NATIVE) {
      try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      await sleep(120);
      const r = rectOf(el);
      passThrough(900);
      window.__ruhulTap(r.left + r.width / 2, r.top + r.height / 2);
      await sleep(400);
    } else {
      el.click();
      await sleep(150);
    }
  }

  // ------------------------------------------------------------------ betting
  async function placeBet(side, amount, issue) {
    if (st.busy) return;
    st.busy = true;
    const lab = nice(side);
    const popupOpen = () => findEl('text', 'Multiple') || findEl('text', 'Total Amount') || findEl('prefix', 'Total Amount') || (findEl('text', 'Cancel') && findEl('text', 'Choice'));
    const cancelPopup = async () => { const c = findEl('text', 'Cancel'); if (c) { await press(c); await sleep(400); } };
    try {
      if (popupOpen()) { log('leftover popup -> cancel'); await cancelPopup(); }

      const btn = findEl('side', lab);
      if (!btn) throw new Error(lab + ' button not found');
      try { btn.scrollIntoView({ block: 'center' }); await sleep(250); } catch (e) {}

      let opened = null;
      if (NATIVE) {
        await press(btn);
        opened = await waitFor(popupOpen, 2500);
        if (!opened) log('real touch on ' + lab + ': no popup, trying page clicks');
      }
      if (!opened) {
        const r0 = rectOf(btn);
        const topEl = document.elementFromPoint(r0.left + r0.width / 2, r0.top + r0.height / 2);
        const targets = [];
        if (topEl && topEl !== hostEl) targets.push(topEl);
        targets.push(btn);
        for (let q = btn.parentElement, i = 0; q && i < 3 && q !== document.body; q = q.parentElement, i++) targets.push(q);
        for (const t of targets.filter((v, i, arr) => arr.indexOf(v) === i)) {
          t.click();
          if ((opened = await waitFor(popupOpen, 1200))) break;
          synthClick(t);
          if ((opened = await waitFor(popupOpen, 1500))) { log('opened via synthetic touch'); break; }
        }
        if (!opened) {
          const desc = e => e ? (e.tagName + '.' + String(e.className || '').toString().slice(0, 40) + '[' + norm(e.innerText).slice(0, 14) + ']') : 'null';
          const seen = allEls().filter(e => vis(e) && e.children.length === 0 && norm(e.innerText) && norm(e.innerText).length <= 20)
            .map(e => norm(e.innerText)).filter((v, i, a2) => a2.indexOf(v) === i).slice(-25).join('|');
          log('btn=' + desc(btn) + ' top=' + desc(topEl) + ' rect=' + Math.round(r0.left) + ',' + Math.round(r0.top) + ',' + Math.round(r0.width) + 'x' + Math.round(r0.height) + ' inner=' + innerWidth + 'x' + innerHeight + ' native=' + NATIVE);
          log('btnHTML=' + btn.outerHTML.slice(0, 160).replace(/\s+/g, ' '));
          log('page texts: ' + seen);
          throw new Error('bet popup not found');
        }
      }
      await sleep(300);

      const ch = findEl('after_text', 'Choice');
      if (ch && norm(ch.innerText).toLowerCase() !== lab.toLowerCase()) {
        log('wrong choice: ' + norm(ch.innerText));
        await cancelPopup();
        toast('The popup picked ' + norm(ch.innerText) + ', not ' + lab + '. Bet cancelled.', 'bad');
        return;
      }

      const chip = findEl('chip', '1', { after: 'Amount' });
      if (chip) { await press(chip); await sleep(150); }

      const inp = findEl('input_after', 'Multiple');
      if (!inp) throw new Error('multiple box not found');
      setInput(inp, String(amount));
      await sleep(400);
      if (String(inp.value) !== String(amount)) { setInput(inp, String(amount)); await sleep(400); }

      const tot = findEl('prefix', 'Total Amount');
      if (!tot) throw new Error('confirm button not found');
      const nums = norm(tot.innerText).match(/\d[\d,]*\.?\d*/);
      const shown = nums ? parseFloat(nums[0].replace(/,/g, '')) : null;
      if (shown === null || Math.abs(shown - amount) > 0.01) {
        await cancelPopup();
        toast('Page showed ' + shown + ' instead of ' + amount + '. Bet cancelled.', 'bad');
        log('mismatch shown=' + shown + ' want=' + amount);
        return;
      }
      await press(tot);
      await sleep(700);
      if (popupOpen()) {
        log('popup still open after confirm');
        await cancelPopup();
        throw new Error('confirm did not go through');
      }
      if (st.pending && st.pending.issue === issue) st.pending.placed = true;
      log('confirmed ' + side + ' ' + amount);
      toast('Bet placed: ' + lab + ' ' + money(amount), 'good');
    } catch (e) {
      log('BET FAIL: ' + e.message);
      toast('Bet failed: ' + e.message + '. Open History for details.', 'bad');
    } finally {
      st.busy = false;
    }
  }

  // ------------------------------------------------------------------ settle / process
  function settle(resIssue, resNum) {
    const p = st.pending;
    const actual = toType(resNum);
    engine.score(p.layers, p.type, actual);
    const amount = p.amount, win = p.type === actual, stepWas = st.step;
    let delta;
    if (win) {
      delta = amount * 0.98;
      st.balance += delta; st.wins++; st.step = 1; st.baseBet = 0;
    } else {
      delta = -amount;
      st.balance -= amount; st.losses++; st.step++;
    }
    st.history.unshift({ issue: resIssue.slice(-4), num: resNum, type: actual, pred: p.type, agree: p.agree, win, amount });
    st.history = st.history.slice(0, 30);
    st.rows.push([new Date().toISOString(), resIssue, resNum, actual, p.type, p.agree, stepWas, amount, win ? 1 : 0, p.placed ? 1 : 0, +st.balance.toFixed(2)]
      .concat(LAYERS.map(k => p.layers[k] || '-')));
    if (st.rows.length > 3000) st.rows = st.rows.slice(-3000);
    store('rows', st.rows);
    showResult(win, delta);

    let why = null;
    if (!win && st.step > st.cfg.steps) { st.step = 1; st.baseBet = 0; why = 'All ' + st.cfg.steps + ' steps lost'; }
    if (st.balance <= 0) { st.balance = 0; why = 'Balance is 0'; }
    if (st.auto) {
      st.sess.rounds++;
      if (!why && !win && st.cfg.lossStop > 0 && st.step - 1 >= st.cfg.lossStop) {
        st.step = 1; st.baseBet = 0; why = 'Stopped after ' + st.cfg.lossStop + ' losses in a row';
      }
      if (!why && st.cfg.target > 0 && st.balance - st.sess.start >= st.cfg.target) why = 'Profit target reached';
      if (!why && st.cfg.rounds > 0 && st.sess.rounds >= st.cfg.rounds) why = st.cfg.rounds + ' rounds done';
      if (why) { setAuto(false); toast(why + '. Auto bet is off.', win ? 'good' : 'bad', 9000); }
    } else if (why) toast(why + '.', 'bad', 9000);
  }

  async function processDraw() {
    const fetched = await fetchDraws();
    const latest = fetched[0];
    if (st.lastIssue === latest.issue) return;
    const mh = mergeHistory(fetched);

    if (st.pending) {
      let ri = latest.issue;
      try { ri = (BigInt(st.pending.issue) + 1n).toString(); } catch (e) {}
      const rn = st.hist[ri];
      if (rn === undefined) log('missed round ' + ri + ': not settled'); else settle(ri, rn);
    }
    if (!engine.boot) engine.bootstrap(mh.types); else engine.trainOne(mh.types);

    const pred = engine.predict(mh.types, mh.nums);
    const amount = betAmount();
    st.pending = { type: pred.type, amount, layers: pred.layers, agree: pred.agree, issue: latest.issue, placed: false };
    st.lastIssue = latest.issue;
    const pool = pred.type === 'BIG' ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
    st.signal = { type: pred.type, num: pool[Math.floor(Math.random() * pool.length)], agree: pred.agree, amount };
    render();
    if (st.auto && amount > 0) {
      const left = pageTimeLeft();
      if (left === null || left >= 7) placeBet(pred.type, amount, latest.issue);
      else log('too late to bet (' + left + 's left)');
    }
  }

  // ------------------------------------------------------------------ UI
  if (!document.getElementById('ruhul-fonts')) {
    const lk = document.createElement('link');
    lk.id = 'ruhul-fonts'; lk.rel = 'stylesheet';
    lk.href = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700&family=Manrope:wght@500;600;700;800&display=swap';
    (document.head || document.documentElement).appendChild(lk);
  }
  const hostEl = document.createElement('div');
  hostEl.id = 'ruhul-host';
  hostEl.style.cssText = 'position:fixed;z-index:2147483647;touch-action:none;transform-origin:top left;';
  const root = hostEl.attachShadow({ mode: 'open' });
  const C = 2 * Math.PI * 58;
  let ticks = '';
  for (let i = 0; i < 30; i++) {
    const a = i / 30 * Math.PI * 2, r1 = i % 5 === 0 ? 63 : 66.5, r2 = 71;
    ticks += '<line x1="' + (80 + r1 * Math.sin(a)).toFixed(2) + '" y1="' + (80 - r1 * Math.cos(a)).toFixed(2) + '" x2="' + (80 + r2 * Math.sin(a)).toFixed(2) + '" y2="' + (80 - r2 * Math.cos(a)).toFixed(2) + '" class="' + (i % 5 === 0 ? 'tk5' : 'tk') + '"/>';
  }
  const ICON = {
    hist: '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"/><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4h4"/></svg>',
    csv: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
    set: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    fb: '<svg viewBox="0 0 24 24"><path d="M14 8h2.5V4.5H14A4 4 0 0 0 10 8.5V11H7.5v3.5H10V21h3.5v-6.5H16l.5-3.5h-3V9a1 1 0 0 1 1-1z"/></svg>',
    pill: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="6" rx="3"/></svg>',
    min: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
  };
  root.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
.p{--ink:#15111c;--lac:#221a2c;--lac2:#2b2137;--gold:#e8c77b;--gold2:#b98a3e;--txt:#f4efe6;--mut:#a69db2;--dim:#6f6680;
  --big:#f39a4c;--big2:#ffbf7a;--sml:#4d8ef7;--sml2:#8db8ff;--win:#3ddc97;--loss:#ff5a6e;
  font-family:'Manrope',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--txt);-webkit-font-smoothing:antialiased;
  user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.d{font-family:'Unbounded','Manrope',system-ui,sans-serif;font-variant-numeric:tabular-nums}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
button:focus-visible,input:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
svg{display:block}

/* ---------- full panel */
.full{position:relative;width:222px;border-radius:22px;padding:12px 12px 10px;overflow:hidden;
  background:radial-gradient(120% 70% at 50% 0%,rgba(232,199,123,.10),transparent 60%),linear-gradient(180deg,rgba(34,26,44,.96),rgba(21,17,28,.97));
  border:1px solid rgba(232,199,123,.38);box-shadow:0 22px 48px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.hd{display:flex;align-items:center;gap:8px;cursor:grab;touch-action:none;padding-bottom:10px}
.av{position:relative;width:34px;height:34px;flex:none;border-radius:50%;padding:2px;background:conic-gradient(from 200deg,var(--gold),var(--gold2),#f7e3b0,var(--gold))}
.av img{width:100%;height:100%;border-radius:50%;object-fit:cover;background:var(--lac);display:block;border:2px solid var(--ink)}
.nm{flex:1;min-width:0}
.nm b{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;letter-spacing:.01em;white-space:nowrap}
.chipx{flex:none;white-space:nowrap;font-family:'Manrope',sans-serif;font-size:9px;font-weight:800;color:var(--ink);background:linear-gradient(135deg,#f7e3b0,var(--gold) 45%,var(--gold2));padding:2px 6px;border-radius:999px}
.nm small{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--mut);margin-top:4px}
.live{flex:none;width:6px;height:6px;border-radius:50%;background:var(--win);box-shadow:0 0 0 3px rgba(61,220,151,.18);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 5px rgba(61,220,151,.05)}}
.ib{flex:none;width:26px;height:26px;border-radius:9px;display:grid;place-items:center;color:var(--mut);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
.ib svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}

/* dial */
.dial{position:relative;width:158px;height:158px;margin:0 auto}
.dial svg.ring{width:158px;height:158px}
.bez{fill:rgba(0,0,0,.25);stroke:rgba(232,199,123,.25);stroke-width:1}
.tk{stroke:rgba(232,199,123,.28);stroke-width:1.2;stroke-linecap:round}
.tk5{stroke:var(--gold);stroke-width:2;stroke-linecap:round}
.trk{fill:none;stroke:rgba(255,255,255,.06);stroke-width:5}
.arc{fill:none;stroke:var(--gold);stroke-width:5;stroke-linecap:round;transform:rotate(-90deg);transform-origin:80px 80px;transition:stroke-dashoffset .25s linear,stroke .3s}
.dial.big .arc{stroke:var(--big)} .dial.sml .arc{stroke:var(--sml)} .dial.hot .arc{stroke:var(--loss)}
.ctr{position:absolute;inset:27px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  background:radial-gradient(circle at 50% 30%,rgba(255,255,255,.06),rgba(0,0,0,.25) 70%)}
.secs{font-size:10.5px;color:var(--mut);font-weight:600}
.word{font-size:24px;font-weight:700;line-height:1.15;margin:2px 0 3px;letter-spacing:-.01em}
.dial.big .word{background:linear-gradient(180deg,var(--big2),var(--big));-webkit-background-clip:text;background-clip:text;color:transparent}
.dial.sml .word{background:linear-gradient(180deg,var(--sml2),var(--sml));-webkit-background-clip:text;background-clip:text;color:transparent}
.dial.lock .word,.dial.wait .word{font-size:17px;color:var(--gold)}
.agree{font-size:10px;color:var(--mut)}
.agree b{color:var(--txt);font-weight:700}
.ball{position:absolute;left:50%;bottom:-2px;transform:translateX(-50%);width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:700;color:#fff;
  background:radial-gradient(circle at 35% 30%,#ffffff55,transparent 45%),var(--lac2);border:2px solid var(--ink);box-shadow:0 0 0 1px rgba(232,199,123,.5)}
.dial.big .ball{background:radial-gradient(circle at 35% 30%,#ffffff66,transparent 45%),var(--big)}
.dial.sml .ball{background:radial-gradient(circle at 35% 30%,#ffffff66,transparent 45%),var(--sml)}
.dial.lock .ball,.dial.wait .ball,.dial.flash-w .ball,.dial.flash-l .ball{display:none}
.dial.hot .secs{color:var(--loss);font-weight:800}
/* result moment */
.res{position:absolute;inset:27px;border-radius:50%;display:none;flex-direction:column;align-items:center;justify-content:center;background:var(--ink)}
.res.on{display:flex;animation:resin .5s cubic-bezier(.2,.9,.3,1.2)}
.res b{font-size:22px;font-weight:700}
.res span{font-size:12px;font-weight:700;margin-top:4px}
.res.w b,.res.w span{color:var(--win)} .res.l b,.res.l span{color:var(--loss)}
.dial.flash-w svg.ring{filter:drop-shadow(0 0 10px rgba(61,220,151,.7))}
.dial.flash-l svg.ring{filter:drop-shadow(0 0 10px rgba(255,90,110,.7))}
@keyframes resin{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}

/* bet + steps */
.bet{margin-top:12px;display:flex;justify-content:space-between;align-items:flex-end}
.bet .k{font-size:10px;color:var(--mut)}
.bet .v{font-size:17px;font-weight:700;margin-top:2px}
.bet .r{text-align:right}
.bet .r .v{font-size:12px;color:var(--mut)}
.steps{display:flex;align-items:center;gap:4px;margin-top:9px}
.dot{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.08)}
.dot.on{background:linear-gradient(90deg,var(--gold2),var(--gold))}
.dot.on.late{background:var(--loss)}
.stepl{font-size:10px;color:var(--mut);margin-left:6px;white-space:nowrap}

/* stats */
.stats{display:grid;grid-template-columns:repeat(4,1fr);margin-top:11px;padding:9px 0;border-top:1px solid rgba(255,255,255,.07);border-bottom:1px solid rgba(255,255,255,.07)}
.stats div{text-align:center}
.stats div+div{border-left:1px solid rgba(255,255,255,.06)}
.stats .k{display:block;font-size:9.5px;color:var(--mut)}
.stats .v{display:block;font-size:12px;font-weight:700;margin-top:3px}

/* auto switch */
.auto{width:100%;margin-top:10px;display:flex;align-items:center;justify-content:space-between;padding:9px 10px 9px 13px;border-radius:14px;
  background:rgba(255,255,255,.04);border:1px solid rgba(232,199,123,.22);text-align:left;transition:background .25s,border-color .25s}
.auto b{display:block;font-size:12.5px;font-weight:800}
.auto small{display:block;font-size:10px;color:var(--mut);margin-top:2px}
.sw{width:38px;height:22px;border-radius:999px;background:rgba(255,255,255,.12);position:relative;flex:none;transition:background .25s}
.sw i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#d9d3e2;transition:transform .25s}
.auto.on{background:linear-gradient(135deg,rgba(232,199,123,.22),rgba(185,138,62,.12));border-color:var(--gold)}
.auto.on .sw{background:linear-gradient(135deg,#f7e3b0,var(--gold) 50%,var(--gold2))}
.auto.on .sw i{transform:translateX(16px);background:var(--ink)}

/* tools */
.tools{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:8px}
.tool{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0 5px;border-radius:11px;color:var(--mut);font-size:9.5px;font-weight:600;text-decoration:none}
.tool:active{background:rgba(255,255,255,.05)}
.tool svg{width:17px;height:17px;fill:none;stroke:var(--gold);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.tool.fb svg{fill:var(--gold);stroke:none}
.toast{min-height:14px;margin-top:6px;font-size:10px;line-height:1.35;color:var(--mut);text-align:center}
.toast.good{color:var(--win)} .toast.bad{color:var(--loss)}

/* sheets */
.sheet{position:absolute;inset:0;display:none;flex-direction:column;padding:14px 13px 12px;border-radius:22px;
  background:linear-gradient(180deg,#241c2e,#16121d);z-index:5}
.sheet.on{display:flex;animation:up .28s cubic-bezier(.2,.8,.3,1)}
@keyframes up{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
.sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.sh b{font-size:14px;font-weight:700}
.sb{flex:1;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}
.sb::-webkit-scrollbar{width:3px} .sb::-webkit-scrollbar-thumb{background:rgba(232,199,123,.3);border-radius:3px}
.fld{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.fld:first-child{padding-top:0}
.fld>label{display:block;font-size:11.5px;font-weight:700}
.fld p{font-size:10px;color:var(--mut);line-height:1.45;margin-top:5px}
.seg{display:flex;gap:4px;margin-top:7px}
.seg button{flex:1;padding:7px 0;border-radius:10px;font-size:12px;font-weight:700;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
.seg button.on{background:linear-gradient(135deg,#f7e3b0,var(--gold) 50%,var(--gold2));color:var(--ink);border-color:transparent}
.num{margin-top:7px;display:flex;align-items:center;gap:6px}
.num input{flex:1;min-width:0;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);color:var(--txt);font:700 13px 'Manrope',system-ui,sans-serif;outline:none}
.num input:focus{border-color:var(--gold)}
.num span{font-size:10px;color:var(--mut);width:52px}
.done{margin-top:10px;width:100%;padding:10px;border-radius:13px;font-size:12.5px;font-weight:800;color:var(--ink);background:linear-gradient(135deg,#f7e3b0,var(--gold) 50%,var(--gold2))}
.hrow{display:grid;grid-template-columns:42px 34px 1fr 34px;align-items:center;gap:4px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:10.5px;white-space:nowrap}
.hrow.th{font-size:9.5px;color:var(--dim);padding-top:0}
.hrow .no{color:var(--dim);font-weight:600;font-size:9.5px}
.hrow .pr b{color:var(--txt);font-weight:700}
.mb{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:800;color:#fff}
.mb.big{background:var(--big)} .mb.sml{background:var(--sml)}
.hrow .pr{color:var(--mut)}
.hrow .ok{font-weight:800;text-align:right}
.ok.w{color:var(--win)} .ok.l{color:var(--loss)}
.layer{font-size:10px;color:var(--mut);padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,.06)}
.layer b{color:var(--txt)}
.lg{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px}
.lg span{padding:4px 0;border-radius:7px;background:rgba(255,255,255,.04);text-align:center;font-size:9.5px}
.lg span b{display:block;font-size:11px;margin-top:1px}
.logbox{font-size:9.5px;color:var(--dim);line-height:1.45;margin-top:8px;word-break:break-word;white-space:pre-wrap}
.empty{text-align:center;color:var(--mut);font-size:11px;padding:28px 6px;line-height:1.5}

/* lock screen */
.login{align-items:center;text-align:center;justify-content:center}
.login .av{width:62px;height:62px;padding:3px}
.login h2{font-size:14px;font-weight:700;margin-top:12px}
.login p{font-size:10.5px;color:var(--mut);line-height:1.5;margin:6px 6px 14px}
.login input{width:100%;padding:11px 12px;margin-bottom:8px;border-radius:12px;background:rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.1);color:var(--txt);font:600 12.5px 'Manrope',system-ui,sans-serif;outline:none;text-align:center}
.login input:focus{border-color:var(--gold)}
.login input::placeholder{color:var(--dim)}
.login .err{font-size:10.5px;color:var(--loss);min-height:15px}
.login .done{display:flex;align-items:center;justify-content:center;gap:7px}
.login .done svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}

/* ---------- compact pill */
.pillv{display:none;align-items:center;gap:9px;padding:6px 12px 6px 6px;border-radius:999px;cursor:grab;touch-action:none;
  background:linear-gradient(180deg,rgba(34,26,44,.97),rgba(21,17,28,.98));border:1px solid rgba(232,199,123,.4);box-shadow:0 14px 30px rgba(0,0,0,.45)}
.pillv .av{width:36px;height:36px}
.pw{font-size:15px;font-weight:700;min-width:46px}
.pillv.big .pw{color:var(--big2)} .pillv.sml .pw{color:var(--sml2)}
.pm{font-size:10px;color:var(--mut);line-height:1.35}
.pm b{color:var(--txt)}
.pt{font-size:13px;font-weight:700;color:var(--gold);min-width:28px;text-align:right}
.pt.hot{color:var(--loss)}
.adot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.2)}
.adot.on{background:var(--gold);box-shadow:0 0 0 3px rgba(232,199,123,.25)}
/* ---------- orb */
.orbv{display:none;width:58px;height:58px;position:relative;cursor:grab;touch-action:none}
.orbv svg{position:absolute;inset:0;width:58px;height:58px}
.orbv .av{position:absolute;inset:7px;width:44px;height:44px;padding:2px}
.orbv .ob{fill:none;stroke:rgba(255,255,255,.15);stroke-width:4}
.orbv .oa{fill:none;stroke:var(--gold);stroke-width:4;stroke-linecap:round;transform:rotate(-90deg);transform-origin:29px 29px}
.orbv.big .oa{stroke:var(--big)} .orbv.sml .oa{stroke:var(--sml)}
.p.m-pill .full,.p.m-orb .full{display:none}
.p.m-pill .pillv{display:flex}
.p.m-orb .orbv{display:block}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
<div class="p" id="p">
  <div class="full">
    <div class="hd" id="drag">
      <div class="av"><img src="${AVATAR}" alt=""></div>
      <div class="nm"><b><span class="d">Ruhuls Engine</span></b><small><span class="chipx">X5 Pro</span><i class="live" title="Live"></i><span id="clock" class="d" style="font-size:9.5px">00:00:00</span></small></div>
      <button class="ib" id="toPill" title="Compact" aria-label="Compact view">${ICON.pill}</button>
      <button class="ib" id="toOrb" title="Minimise" aria-label="Minimise">${ICON.min}</button>
    </div>

    <div class="dial lock" id="dial">
      <svg class="ring" viewBox="0 0 160 160" aria-hidden="true">
        <circle class="bez" cx="80" cy="80" r="76"/>${ticks}
        <circle class="trk" cx="80" cy="80" r="58"/>
        <circle class="arc" id="arc" cx="80" cy="80" r="58" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="0"/>
      </svg>
      <div class="ctr"><span class="secs d" id="secs">30s</span><span class="word d" id="word">Locked</span><span class="agree" id="agree">Unlock to start</span></div>
      <div class="res" id="res"><b class="d" id="resT">Won</b><span class="d" id="resV">+৳0</span></div>
      <div class="ball d" id="ball">?</div>
    </div>

    <div class="bet">
      <div><div class="k">Next bet</div><div class="v d" id="betv">৳0</div></div>
      <div class="r"><div class="k">Balance</div><div class="v d" id="bal">৳0</div></div>
    </div>
    <div class="steps"><div style="display:flex;gap:4px;flex:1" id="dots"></div><span class="stepl" id="stepl">Step 1 of 7</span></div>

    <div class="stats">
      <div><span class="k">Won</span><span class="v d" id="w" style="color:var(--win)">0</span></div>
      <div><span class="k">Lost</span><span class="v d" id="l" style="color:var(--loss)">0</span></div>
      <div><span class="k">Rate</span><span class="v d" id="wr">--</span></div>
      <div><span class="k">Profit</span><span class="v d" id="pnl">৳0</span></div>
    </div>

    <button class="auto" id="auto" role="switch" aria-checked="false"><span><b>Auto bet</b><small id="autos">Off. Tap to let the bot bet.</small></span><span class="sw"><i></i></span></button>
    <div class="tools">
      <button class="tool" id="hbtn">${ICON.hist}History</button>
      <button class="tool" id="csv">${ICON.csv}CSV</button>
      <button class="tool" id="sbtn">${ICON.set}Settings</button>
      <a class="tool fb" href="${FOLLOW_URL}" target="_blank" rel="noopener">${ICON.fb}Follow</a>
    </div>
    <div class="toast" id="toast"></div>

    <div class="sheet login on" id="login">
      <div class="av"><img src="${AVATAR}" alt=""></div>
      <h2 class="d">Ruhuls Engine X5 Pro</h2>
      <p>Enter your password and the balance you are starting with.</p>
      <input type="password" id="pw" placeholder="Password" autocomplete="off">
      <input type="text" id="bl" placeholder="Balance, e.g. 1000" autocomplete="off" inputmode="decimal">
      <div class="err" id="err"></div>
      <button class="done" id="unlock">${ICON.lock}Unlock</button>
    </div>

    <div class="sheet" id="hist">
      <div class="sh"><b class="d">History</b><button class="ib" id="hx" aria-label="Close">${ICON.x}</button></div>
      <div class="layer" id="layer"></div>
      <div class="sb" id="hlist"></div>
      <div class="logbox" id="logbox"></div>
    </div>

    <div class="sheet" id="sets">
      <div class="sh"><b class="d">Settings</b><button class="ib" id="sx" aria-label="Close">${ICON.x}</button></div>
      <div class="sb">
        <div class="fld"><label>Martingale steps</label>
          <div class="seg" id="segSteps"><button data-v="7">7</button><button data-v="8">8</button><button data-v="9">9</button><button data-v="10">10</button></div>
          <p id="stepInfo"></p></div>
        <div class="fld"><label for="fRounds">Stop after this many rounds</label>
          <div class="num"><input id="fRounds" type="number" min="0" inputmode="numeric"><span>0 = never</span></div></div>
        <div class="fld"><label for="fTarget">Stop at this profit</label>
          <div class="num"><input id="fTarget" type="number" min="0" inputmode="decimal"><span>৳, 0 = off</span></div></div>
        <div class="fld"><label for="fLoss">Stop after losses in a row</label>
          <div class="num"><input id="fLoss" type="number" min="0" inputmode="numeric"><span>0 = off</span></div>
          <p>Stops auto bet early and goes back to step 1, so a long losing run costs less.</p></div>
        <div class="fld"><label>Sound</label>
          <div class="seg" id="segSound"><button data-v="1">On</button><button data-v="0">Off</button></div></div>
        <div class="fld"><label>Panel size</label>
          <div class="seg" id="segSize"><button data-v="80">Small</button><button data-v="90">Medium</button><button data-v="100">Large</button></div></div>
      </div>
      <button class="done" id="sdone">Save</button>
    </div>
  </div>

  <div class="pillv" id="pill">
    <div class="av"><img src="${AVATAR}" alt=""></div>
    <span class="pw d" id="pw2">--</span>
    <span class="pm" id="pm"><b>৳0</b><br>Step 1 of 7</span>
    <span class="adot" id="adot"></span>
    <span class="pt d" id="pt">30s</span>
  </div>

  <div class="orbv" id="orb">
    <svg viewBox="0 0 58 58"><circle class="ob" cx="29" cy="29" r="26"/><circle class="oa" id="oarc" cx="29" cy="29" r="26" stroke-dasharray="163.36" stroke-dashoffset="0"/></svg>
    <div class="av"><img src="${AVATAR}" alt=""></div>
  </div>
</div>`;
  (document.body || document.documentElement).appendChild(hostEl);
  const $ = id => root.getElementById(id);

  // ---- placement, size, view mode
  function applyPlace() {
    const s = st.cfg.size / 100;
    hostEl.style.transform = s === 1 ? '' : 'scale(' + s + ')';
    const w = hostEl.offsetWidth * s || 200, h = hostEl.offsetHeight * s || 60;
    st.cfg.x = Math.max(0, Math.min(innerWidth - Math.min(w, 60), st.cfg.x));
    st.cfg.y = Math.max(0, Math.min(innerHeight - Math.min(h, 60), st.cfg.y));
    hostEl.style.left = st.cfg.x + 'px'; hostEl.style.top = st.cfg.y + 'px';
  }
  function setMode(m) {
    st.cfg.mode = m; saveCfg();
    $('p').className = 'p' + (m === 'full' ? '' : ' m-' + m);
    applyPlace();
  }

  // ---- sound
  let audio = null;
  function sound(win) {
    if (!st.cfg.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime, g = audio.createGain();
      g.connect(audio.destination);
      const notes = win ? [660, 990] : [330, 220];
      notes.forEach((f, i) => {
        const o = audio.createOscillator();
        o.type = win ? 'sine' : 'triangle';
        o.frequency.setValueAtTime(f, t + i * 0.12);
        o.connect(g); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.18);
      });
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    } catch (e) {}
  }

  // ---- render
  let toastT = null;
  function toast(t, kind, ms) {
    const el = $('toast');
    el.textContent = t; el.className = 'toast' + (kind ? ' ' + kind : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.textContent = ''; el.className = 'toast'; }, ms || 5000);
  }
  function renderDots() {
    const n = st.cfg.steps;
    let h = '';
    for (let i = 1; i <= n; i++) h += '<span class="dot' + (i <= st.step ? ' on' : '') + (i <= st.step && i > n - 2 ? ' late' : '') + '"></span>';
    $('dots').innerHTML = h;
    $('stepl').textContent = 'Step ' + st.step + ' of ' + n;
  }
  function render() {
    const s = st.signal;
    const d = $('dial');
    const side = s ? (s.type === 'BIG' ? 'big' : 'sml') : '';
    d.classList.remove('big', 'sml', 'lock', 'wait');
    if (!st.unlocked) d.classList.add('lock');
    else if (!s) d.classList.add('wait');
    else d.classList.add(side);
    if (st.unlocked && s) {
      $('word').textContent = nice(s.type);
      $('agree').innerHTML = 'Model agree <b>' + s.agree + '%</b>';
      $('ball').textContent = s.num;
    } else if (st.unlocked) {
      $('word').textContent = 'Reading';
      $('agree').textContent = 'Fetching the last draws';
    }
    const amt = s ? s.amount : betAmount();
    $('betv').textContent = money(st.unlocked ? amt : 0);
    $('bal').textContent = money(st.balance);
    renderDots();
    $('w').textContent = st.wins; $('l').textContent = st.losses;
    $('wr').textContent = (st.wins + st.losses) ? Math.round(st.wins / (st.wins + st.losses) * 100) + '%' : '--';
    const pnl = st.balance - st.startBalance;
    $('pnl').textContent = (pnl > 0 ? '+' : pnl < 0 ? '−' : '') + money(Math.abs(pnl));
    $('pnl').style.color = pnl > 0 ? 'var(--win)' : pnl < 0 ? 'var(--loss)' : 'var(--txt)';
    // pill + orb
    $('pill').className = 'pillv' + (side ? ' ' + side : '');
    $('orb').className = 'orbv' + (side ? ' ' + side : '');
    $('pw2').textContent = s && st.unlocked ? nice(s.type) : (st.unlocked ? '...' : 'Locked');
    $('pm').innerHTML = '<b>' + money(st.unlocked ? amt : 0) + '</b><br>Step ' + st.step + ' of ' + st.cfg.steps;
    $('adot').className = 'adot' + (st.auto ? ' on' : '');
    renderAuto();
    if ($('hist').classList.contains('on')) renderHistory();
  }
  function renderAuto() {
    const a = $('auto');
    a.classList.toggle('on', st.auto);
    a.setAttribute('aria-checked', st.auto ? 'true' : 'false');
    let t;
    if (!st.auto) t = 'Off. Tap to let the bot bet.';
    else if (st.cfg.rounds > 0) t = 'On, round ' + Math.min(st.sess.rounds + 1, st.cfg.rounds) + ' of ' + st.cfg.rounds;
    else t = 'On, ' + st.sess.rounds + ' rounds so far';
    $('autos').textContent = t;
  }
  function showResult(win, delta) {
    const r = $('res'), d = $('dial');
    $('resT').textContent = win ? 'Won' : 'Lost';
    $('resV').textContent = (win ? '+' : '−') + money(Math.abs(delta));
    r.className = 'res on ' + (win ? 'w' : 'l');
    d.classList.add(win ? 'flash-w' : 'flash-l');
    sound(win);
    setTimeout(() => { r.className = 'res'; d.classList.remove('flash-w', 'flash-l'); }, 2600);
  }
  function renderHistory() {
    $('layer').innerHTML = 'Picked right <b>' + engine.pct('ens') + '%</b> of ' + engine.total.ens[1] + ' rounds. Each layer:' +
      '<div class="lg">' + LAYERS.map(k => '<span>' + LABEL[k] + '<b class="d">' + engine.pct(k) + '%</b></span>').join('') + '</div>';
    const c = $('hlist');
    if (!st.history.length) { c.innerHTML = '<div class="empty">No rounds yet. Results show here as each round ends.</div>'; return; }
    c.innerHTML = '<div class="hrow th"><span>Round</span><span>Result</span><span>Picked</span><span></span></div>' +
      st.history.map(i => '<div class="hrow"><span class="no d">' + i.issue + '</span>' +
      '<span><span class="mb ' + (i.type === 'BIG' ? 'big' : 'sml') + '">' + i.num + '</span></span>' +
      '<span class="pr"><b>' + nice(i.pred) + '</b> ' + i.agree + '%</span>' +
      '<span class="ok ' + (i.win ? 'w' : 'l') + '">' + (i.win ? 'Won' : 'Lost') + '</span></div>').join('');
  }
  window.renderLog = function () { const b = $('logbox'); if (b) b.textContent = st.logs.slice(-6).join('\n'); };

  function setAuto(on) {
    if (on && !st.unlocked) { toast('Unlock first.', 'bad'); return; }
    st.auto = on;
    if (on) st.sess = { rounds: 0, start: st.balance };
    try { if (window.RuhulBridge && RuhulBridge.keepAwake) RuhulBridge.keepAwake(!!on); } catch (e) {}
    render();
  }
  function exportCsv() {
    const head = ['time', 'issue', 'result', 'result_type', 'pred', 'agree', 'step', 'bet', 'win', 'placed', 'balance'].concat(LAYERS.map(k => LABEL[k]));
    const csv = [head].concat(st.rows).map(r => r.join(',')).join('\n');
    if (window.RuhulBridge && typeof RuhulBridge.saveCsv === 'function') { toast(String(RuhulBridge.saveCsv('ruhul_rounds.csv', csv)), 'good'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'ruhul_rounds.csv';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Saved ' + st.rows.length + ' rounds as CSV.', 'good');
  }

  // ---- settings sheet
  function fillSettings() {
    root.querySelectorAll('#segSteps button').forEach(b => b.classList.toggle('on', +b.dataset.v === st.cfg.steps));
    root.querySelectorAll('#segSound button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === !!st.cfg.sound));
    root.querySelectorAll('#segSize button').forEach(b => b.classList.toggle('on', +b.dataset.v === st.cfg.size));
    $('fRounds').value = st.cfg.rounds; $('fTarget').value = st.cfg.target; $('fLoss').value = st.cfg.lossStop;
    stepInfo();
  }
  function stepInfo() {
    const k = +(root.querySelector('#segSteps button.on') || { dataset: { v: st.cfg.steps } }).dataset.v;
    const units = Math.pow(2, k) - 1;
    const base = st.balance > 0 ? Math.max(1, Math.floor(st.balance / units)) : null;
    $('stepInfo').textContent = (base ? 'Base bet ' + money(base) + ' (balance ÷ ' + units + '). ' : 'Base bet is balance ÷ ' + units + '. ') +
      'Chance of losing all ' + k + ' steps within 100 rounds: about ' + bustChance100(k) + '%.';
  }
  root.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (seg.id === 'segSteps') stepInfo();
  }));
  function saveSettings() {
    const pick = id => (root.querySelector('#' + id + ' button.on') || {}).dataset;
    const steps = +(pick('segSteps') || { v: st.cfg.steps }).v;
    st.cfg.steps = steps;
    st.cfg.sound = (pick('segSound') || { v: '1' }).v === '1';
    st.cfg.size = +(pick('segSize') || { v: 100 }).v;
    st.cfg.rounds = Math.max(0, parseInt($('fRounds').value, 10) || 0);
    st.cfg.target = Math.max(0, parseFloat($('fTarget').value) || 0);
    st.cfg.lossStop = Math.max(0, parseInt($('fLoss').value, 10) || 0);
    if (st.step > steps) st.step = steps;
    if (st.step === 1) st.baseBet = 0;
    saveCfg(); applyPlace(); render();
    $('sets').classList.remove('on');
    toast('Settings saved.', 'good');
  }

  // ---- events
  function unlock() {
    const bal = parseFloat(String($('bl').value).replace(/,/g, '').trim());
    if ($('pw').value.trim() === PASSWORD && !isNaN(bal) && bal > 0) {
      st.balance = bal; st.startBalance = bal; st.step = 1; st.baseBet = 0; st.unlocked = true;
      $('login').classList.remove('on');
      render();
      toast('Reading the last draws...');
      poll();
    } else {
      sound(false);
      $('err').textContent = $('pw').value.trim() !== PASSWORD ? 'Wrong password.' : 'Balance must be a number above 0.';
      setTimeout(() => { $('err').textContent = ''; }, 2500);
    }
  }
  $('unlock').addEventListener('click', unlock);
  $('bl').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
  $('pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('bl').focus(); });
  $('auto').addEventListener('click', () => { setAuto(!st.auto); if (st.unlocked) toast(st.auto ? 'Auto bet is on.' : 'Auto bet is off.'); });
  $('csv').addEventListener('click', exportCsv);
  $('hbtn').addEventListener('click', () => { renderHistory(); renderLog(); $('hist').classList.add('on'); });
  $('hx').addEventListener('click', () => $('hist').classList.remove('on'));
  $('sbtn').addEventListener('click', () => { fillSettings(); $('sets').classList.add('on'); });
  $('sx').addEventListener('click', () => $('sets').classList.remove('on'));
  $('sdone').addEventListener('click', saveSettings);
  $('toPill').addEventListener('click', () => setMode('pill'));
  $('toOrb').addEventListener('click', () => setMode('orb'));

  // drag on the header, the pill and the orb; a short tap on the pill/orb opens the full panel
  function draggable(el, onTap) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false, moved = false;
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('button') && el.id === 'drag') return;
      on = true; moved = false; sx = e.clientX; sy = e.clientY; ox = st.cfg.x; oy = st.cfg.y;
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
    });
    el.addEventListener('pointermove', e => {
      if (!on) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      moved = true;
      st.cfg.x = ox + dx; st.cfg.y = oy + dy; applyPlace();
    });
    const end = () => { if (!on) return; on = false; if (moved) saveCfg(); else if (onTap) onTap(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { on = false; });
  }
  draggable($('drag'), null);
  draggable($('pill'), () => setMode('full'));
  draggable($('orb'), () => setMode('full'));
  window.addEventListener('resize', applyPlace);

  // ---- timers
  const tick1 = setInterval(() => { if (!st.dead) $('clock').textContent = new Date().toTimeString().slice(0, 8); }, 1000);
  const tick2 = setInterval(() => {
    if (st.dead) return;
    const left = timeLeft();
    const frac = Math.max(0, Math.min(1, left / 30));
    $('arc').style.strokeDashoffset = (C * (1 - frac)).toFixed(2);
    $('oarc').style.strokeDashoffset = (163.36 * (1 - frac)).toFixed(2);
    const hot = st.unlocked && left <= 5;
    $('dial').classList.toggle('hot', hot);
    $('secs').textContent = st.unlocked ? (hot ? left + 's, bets closing' : 'Next round in ' + left + 's') : '30s rounds';
    $('pt').textContent = left + 's';
    $('pt').classList.toggle('hot', hot);
  }, 250);

  let lastErr = 0;
  function poll() {
    if (st.dead || !st.unlocked || st.fetching) return;
    st.fetching = true;
    processDraw().catch(e => {
      log('ERROR: ' + e.message);
      if (Date.now() - lastErr > 8000) { lastErr = Date.now(); toast('Could not read draws: ' + String(e.message).slice(0, 40), 'bad'); }
    }).then(() => { st.fetching = false; });
  }
  const tick3 = setInterval(() => {
    // a game iframe appeared later in this page: hand over to the panel inside it
    if (!st.unlocked && window === window.top && gameChild()) {
      st.dead = true; clearInterval(tick1); clearInterval(tick2); clearInterval(tick3); hostEl.remove();
      return;
    }
    poll();
  }, POLL_MS);

  setMode(st.cfg.mode || 'full');
  render();
  log('Ruhuls Engine loaded' + (NATIVE ? ' (app, real touch)' : ''));
  }
})();
