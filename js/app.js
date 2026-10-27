/* Корректор зрения — перенос программы с Flash (SWF) на HTML/JS.
 * Логика переходов и таймеров восстановлена из ActionScript оригинала.
 * Данные экранов, текстов, поз глаза и т.п. — в js/data.js. */
(function () {
  'use strict';
  var EC = window.EC;
  var FPS = 12;
  var SPEED = parseFloat(new URLSearchParams(location.search).get('speed')) || 1; // только для проверки: ускорение времени
  var stage = document.getElementById('stage');
  var layer = document.getElementById('layer');
  var canvas = document.getElementById('eye');
  var ctx = canvas.getContext('2d');
  var bye = document.getElementById('bye');

  /* ---------- масштабирование сцены 1024x768 под окно ---------- */
  function fit() {
    var s = Math.min(window.innerWidth / 1024, window.innerHeight / 768);
    var x = (window.innerWidth - 1024 * s) / 2, y = (window.innerHeight - 768 * s) / 2;
    stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- таблицы из оригинала ---------- */
  // кнопка (id объекта в SWF) -> куда ведёт (метка кадра)
  var ACT = {
    77: 'step1', 79: '@quit', 84: 'step2', 86: '_start', 96: 'step2_2', 99: 'step3_2', 104: 'step5_1',
    108: 'step5_1', 122: 'step5_2', 136: 'step6', 138: 'step5', 141: 'step6_2', 150: 'step7_1', 151: 'step7_1',
    152: 'step7_2', 153: 'step7_2', 154: 'step8', 155: 'step7_0', 158: 'step8_2', 162: 'step9_2', 164: 'step10_1',
    165: 'step10_1', 166: 'step10_2', 167: 'step10_2', 168: 'step11', 169: 'step10_0', 173: 'step11_0',
    174: '@next', 179: 'step11_2', 180: 'step12', 183: 'step12', 185: 'step_final'
  };
  // клавиша «пробел» на экранах
  var SPACE = { step5_1: 'step5_2', step7_1: 'step7_2', step10_1: 'step10_2', step11_0: '@next' };
  // упражнения со спрайтом: метка -> {трек, следующий экран, положение спрайта}
  var EXER = {
    step2_2: { kind: 'blink', id: 73, audio: 'blink', next: 'step3' },
    step3_2: { kind: 'blink', id: 101, audio: 'squeeze', next: 'step4' },
    step6_2: { kind: 'move', pose: 'move_ud', audio: 'move_ud', next: 'step7' },
    step8_2: { kind: 'move', pose: 'move_circle', audio: 'move_circle', next: 'step9' },
    step9_2: { kind: 'move', pose: 'move_diag', audio: 'move_diag', next: 'step10' }
  };
  // «картинка для отдыха глаз» — 30 секунд, затем следующий шаг (длительность = число кадров оригинала / 12)
  var REST = { step5_2: ['step6', 357 / FPS], step7_2: ['step8', 351 / FPS], step10_2: ['step11', 377 / FPS] };
  // на каком экране показывается картинка отдыха глаз
  var REST_IMG_SCREENS = { step5_1: 1, step5_2: 1, step7_1: 1, step7_2: 1, step10_1: 1, step10_2: 1 };
  var REST_CHARS = [114, 65, 120, 117, 134, 125, 128, 131]; // 0i..7i
  // Esc: вернуться из упражнения к его описанию
  var ESC_BACK = { step2_2: 'step2', step3_2: 'step3', step5_1: 'step4', step5_2: 'step5_1', step6_2: 'step6',
    step7_1: 'step7', step7_2: 'step7_1', step8_2: 'step8', step9_2: 'step9', step10_1: 'step10', step10_2: 'step10_1',
    step11_0: 'step11' };
  var ACC_POOL = [5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59, 62]; // im1..im21 (im6 в оригинале отсутствует)
  var ACC_SECONDS = 55; // таймер упражнения на аккомодацию
  var BLINK_FRAMES = 13; // длительность «моргания» между картинками (кадры 2..14 клипа glaz)
  var BTN_LABEL = { 76: 'Далее', 78: 'Выход', 85: 'Назад', 95: 'Начать упражнение', 106: '', 135: 'Пропустить',
    137: 'Помощь', 172: 'Начать тест', 178: 'Описание', 121: '' };

  /* ---------- вспомогательное ---------- */
  function mul(m, n) { // m * n (сначала n, потом m), формат [a,b,c,d,e,f]
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  function css(m) { return 'matrix(' + m.map(function (v) { return +v.toFixed(5); }).join(',') + ')'; }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function rnd(n) { return Math.floor(Math.random() * n); }
  var mctx = document.createElement('canvas').getContext('2d');
  var imgCache = {};
  function loadImg(src) {
    if (!imgCache[src]) { var i = new Image(); i.src = src; imgCache[src] = i; }
    return imgCache[src];
  }

  /* ---------- построение экрана ---------- */
  function addShape(parent, id, m) {
    var meta = EC.svg[id]; if (!meta) return null;
    var im = el('img'); im.src = 'svg/' + id + '.svg'; im.alt = ''; im.draggable = false;
    im.style.width = meta.w + 'px'; im.style.height = meta.h + 'px';
    im.style.transformOrigin = '0 0';
    // SVG начинается в точке (ox,oy) локальных координат фигуры
    im.style.transform = css(mul(m, [1, 0, 0, 1, meta.ox, meta.oy]));
    im.style.position = 'absolute'; im.style.left = '0'; im.style.top = '0';
    parent.appendChild(im);
    return im;
  }
  function textBox(cid, m, dx, dy) { // строки статического текста (каждая запись DefineText = строка)
    var t = EC.texts[cid]; if (!t) return null;
    var tm = t.m, T = [tm.sx, tm.r0, tm.r1, tm.sy, tm.tx, tm.ty];
    var box = el('div'); box.style.left = '0'; box.style.top = '0';
    box.style.transform = css(mul(m, mul([1, 0, 0, 1, dx || 0, dy || 0], T)));
    t.recs.forEach(function (r) {
      var d = el('div', 't'); d.textContent = r.t;
      // подгоняем ширину строки под оригинал (на случай другой версии шрифта)
      mctx.font = r.h + 'px Arial, "Liberation Sans", Helvetica, sans-serif';
      var wNow = mctx.measureText(r.t).width;
      if (r.w && r.t.length > 1 && Math.abs(r.w - wNow) / r.w > 0.02) d.style.letterSpacing = ((r.w - wNow) / r.t.length) + 'px';
      d.style.left = r.x + 'px'; d.style.top = (r.y - 0.905 * r.h) + 'px';
      d.style.fontSize = r.h + 'px'; d.style.lineHeight = (1.117 * r.h) + 'px';
      d.style.color = 'rgb(' + r.c.join(',') + ')';
      box.appendChild(d);
    });
    return box;
  }
  function addButton(id, m, name) {
    var faces = EC.buttons[id]; if (!faces) return null;
    var wrap = el('div', 'btn'); wrap.setAttribute('role', 'button'); wrap.tabIndex = 0;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, label = '', ghost = false;
    faces.forEach(function (f) {
      var ch = f[1], tx = f[2], ty = f[3], meta = EC.svg[ch];
      if (meta) {
        x0 = Math.min(x0, tx + meta.ox); y0 = Math.min(y0, ty + meta.oy);
        x1 = Math.max(x1, tx + meta.ox + meta.w); y1 = Math.max(y1, ty + meta.oy + meta.h);
        if (ch === 121) ghost = true;
        if (BTN_LABEL[ch]) label = BTN_LABEL[ch];
      }
    });
    if (x0 > x1) { x0 = 0; y0 = 0; x1 = 10; y1 = 10; }
    wrap.style.left = '0'; wrap.style.top = '0'; wrap.style.width = (x1 - x0) + 'px'; wrap.style.height = (y1 - y0) + 'px';
    wrap.style.transform = css(mul(m, [1, 0, 0, 1, x0, y0]));
    if (ghost) wrap.classList.add('ghost');
    faces.forEach(function (f) {
      var ch = f[1], tx = f[2], ty = f[3], meta = EC.svg[ch];
      if (meta && ch !== 121) {
        var im = el('img'); im.src = 'svg/' + ch + '.svg'; im.alt = ''; im.draggable = false;
        im.style.left = (tx + meta.ox - x0) + 'px'; im.style.top = (ty + meta.oy - y0) + 'px';
        im.style.width = meta.w + 'px'; im.style.height = meta.h + 'px';
        wrap.appendChild(im);
      } else if (!meta && EC.texts[ch]) {
        var tb = textBox(ch, [1, 0, 0, 1, 0, 0], tx - x0, ty - y0);
        wrap.appendChild(tb);
        EC.texts[ch].recs.forEach(function (r) { label = label ? label + ' ' + r.t : r.t; });
      }
    });
    if (label) wrap.setAttribute('aria-label', label.charAt(0) + label.slice(1).toLowerCase());
    var go = ACT[id];
    wrap.addEventListener('click', function (e) { e.stopPropagation(); act(go); });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !ghost) { e.preventDefault(); act(go); }
    });
    return wrap;
  }
  function addSirds(parent, charId, itemM) {
    var s = EC.sirds[charId]; if (!s) return;
    var im = loadImg(s.jpg).cloneNode(); im.alt = ''; im.draggable = false;
    im.style.left = '0'; im.style.top = '0';
    im.style.transform = css(mul(itemM, [s.s, 0, 0, s.sy, s.tx, s.ty]));
    parent.appendChild(im);
    return im;
  }

  var cur = { label: null, restChar: null, cleanup: [] };

  function clearScene() {
    cur.cleanup.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    cur.cleanup = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    layer.textContent = '';
  }

  function show(label) {
    clearScene();
    bye.hidden = true;
    cur.label = label;
    if (label === 'step5_1' || label === 'step7_1' || label === 'step10_1') cur.restChar = REST_CHARS[rnd(REST_CHARS.length)];
    var items = EC.screens[label] || [];
    items.forEach(function (it) {
      var m = it.m, node = null;
      if (it.t === 'shape') node = addShape(layer, it.c, m);
      else if (it.t === 'text') node = textBox(it.c, m);
      else if (it.t === 'button') node = addButton(it.c, m, it.n);
      else if (it.t === 'sprite') {
        if (it.c === 90) node = addShape(layer, 89, m);
        else if (REST_IMG_SCREENS[label] && REST_CHARS.indexOf(it.c) >= 0) { if (it.c === cur.restChar) addSirds(layer, it.c, m); }
      }
      if (node && node.parentNode !== layer) layer.appendChild(node);
    });
    if (label === 'step12') { var c = el('img'); c.src = 'img/bm186.jpg'; c.alt = 'Таблицы для проверки зрения'; c.style.left = '0'; c.style.top = '108.5px'; layer.insertBefore(c, layer.firstChild); }
    if (EXER[label]) runExercise(EXER[label]);
    else if (REST[label]) runRest(REST[label]);
    else if (label === 'step11_0') runAccommodation();
    var first = layer.querySelector('.btn:not(.ghost)'); if (first && document.activeElement !== document.body) first.focus({ preventScroll: true });
    document.title = 'Корректор зрения';
  }

  function act(a) {
    if (!a) return;
    if (a === '@quit') { quit(); return; }
    if (a === '@next') { if (cur.accNext) cur.accNext(); return; }
    show(a);
  }
  function quit() {
    clearScene(); cur.label = '@quit';
    try { window.close(); } catch (e) { /* ignore */ }
    bye.hidden = false;
  }
  bye.addEventListener('click', function () { show('_start'); });

  /* ---------- аудио + часы упражнения ---------- */
  function clock(audioName, onFrame) {
    var a = null, t0 = performance.now(), raf = 0, stopped = false;
    if (audioName) {
      a = new Audio('audio/' + audioName + '.mp3'); a.preload = 'auto';
      a.addEventListener('playing', function () { if (SPEED === 1) t0 = performance.now() - a.currentTime * 1000; });
      var p = a.play(); if (p && p.catch) p.catch(function () { /* звук заблокирован — идём без него */ });
    }
    function tick(now) {
      if (stopped) return;
      var f = Math.floor((now - t0) / 1000 * FPS * SPEED);
      if (onFrame(f) === false) return;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    cur.cleanup.push(function () { stopped = true; cancelAnimationFrame(raf); if (a) { a.pause(); a.src = ''; } });
  }
  function drawFrameImage(src, x, y, w, h) {
    var im = loadImg(src); if (!im.complete || !im.naturalWidth) return;
    ctx.drawImage(im, x, y, w || im.naturalWidth, h || im.naturalHeight);
  }
  function resetCtx() { ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, 1024, 768); ctx.globalAlpha = 1; }

  /* ---------- упражнения ---------- */
  function runExercise(ex) {
    var label = cur.label;
    if (ex.kind === 'blink') {
      var seq = EC.blink[ex.id], n = seq.length, last = -1;
      var imgs = []; for (var i = 0; i < EC.blink['n' + ex.id]; i++) imgs.push('eye/b' + ex.id + '_' + i + '.png');
      imgs.forEach(loadImg);
      clock(ex.audio, function (f) {
        if (f >= n) { show(ex.next); return false; }
        if (f !== last) { last = f; resetCtx(); drawFrameImage(imgs[seq[f]], 316, 238); }
      });
    } else {
      var n2 = EC.poses[ex.pose].length, last2 = -1;
      clock(ex.audio, function (f) {
        if (f >= n2) { show(ex.next); return false; }
        if (f !== last2) { last2 = f; drawMove(ex.pose, f); }
      });
    }
  }
  var BASE = [1, 0, 0, 1, 322.8, 322.15];
  function drawMove(pose, f) {
    var eye = loadImg('eye/eye.png'), a0 = loadImg('eye/arrow0.png'), a1 = loadImg('eye/arrow1.png');
    resetCtx();
    EC.poses[pose][f].forEach(function (o) {
      var m = mul(BASE, [o[1], o[2], o[3], o[4], o[5], o[6]]);
      var isEye = o[0] === 142, img = isEye ? eye : (o[9] ? a1 : a0), ox = isEye ? -12.2 : 34.1, oy = isEye ? -82.55 : -0.85;
      if (!img.complete || !img.naturalWidth) return;
      ctx.save(); ctx.globalAlpha = o[7];
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.drawImage(img, ox, oy, img.naturalWidth / 2, img.naturalHeight / 2);
      ctx.restore();
    });
  }
  function runRest(r) {
    var tm = setTimeout(function () { show(r[0]); }, r[1] * 1000 / SPEED);
    cur.cleanup.push(function () { clearTimeout(tm); });
  }

  function runAccommodation() {
    var shown = [], phase = 'img', blinkStart = 0, deadline = performance.now() + ACC_SECONDS * 1000 / SPEED, raf = 0, stopped = false;
    var holder = el('div'); holder.style.left = '0'; holder.style.top = '0'; layer.insertBefore(holder, layer.firstChild);
    var imgs = []; for (var i = 0; i < EC.blink.n73; i++) imgs.push('eye/b73_' + i + '.png'); imgs.forEach(loadImg);
    ACC_POOL.forEach(function (c) { loadImg(EC.sirds[c].jpg); });
    function nextImage() {
      var c, tries = 0;
      do { c = ACC_POOL[rnd(ACC_POOL.length)]; tries++; } while (shown.slice(-2).indexOf(c) >= 0 && tries < 50);
      shown.push(c); holder.textContent = ''; addSirds(holder, c, [1, 0, 0, 1, 0, 0]);
    }
    nextImage();
    cur.accNext = function () {
      if (phase !== 'img') return;
      phase = 'eye'; blinkStart = performance.now(); holder.textContent = '';
    };
    function tick(now) {
      if (stopped) return;
      if (now >= deadline) { show('step11_1'); return; }
      if (phase === 'eye') {
        var f = Math.floor((now - blinkStart) / 1000 * FPS * SPEED);
        if (f >= BLINK_FRAMES) { phase = 'img'; resetCtx(); nextImage(); }
        else {
          resetCtx();
          var seq = EC.blink['73'], im = loadImg(imgs[seq[Math.min(f, seq.length - 1)]]);
          if (im.complete && im.naturalWidth) ctx.drawImage(im, 237.05, 137.2, 552.3, 220.2);
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    cur.cleanup.push(function () { stopped = true; cancelAnimationFrame(raf); cur.accNext = null; });
  }

  /* ---------- клавиатура и полный экран ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.code === 'Space') {
      var a = SPACE[cur.label];
      if (a) { e.preventDefault(); act(a); }
      else if (document.activeElement && document.activeElement.classList.contains('btn')) { e.preventDefault(); document.activeElement.click(); }
    } else if (e.key === 'Escape') {
      var b = ESC_BACK[cur.label]; if (b) { e.preventDefault(); show(b); }
    } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
      toggleFullscreen();
    }
  });
  function toggleFullscreen() {
    var d = document, r = d.documentElement;
    if (!d.fullscreenElement && r.requestFullscreen) r.requestFullscreen().catch(function () {});
    else if (d.exitFullscreen) d.exitFullscreen();
  }
  // клик в любом месте на экранах со «скрытой» кнопкой (картинки для отдыха и аккомодации)
  stage.addEventListener('click', function () {
    var a = SPACE[cur.label]; if (a) act(a);
  });

  // предзагрузка графики глаза и стрелок, чтобы упражнения стартовали без мигания
  ['eye/eye.png', 'eye/arrow0.png', 'eye/arrow1.png'].forEach(loadImg);
  for (var bi = 0; bi < EC.blink.n73; bi++) loadImg('eye/b73_' + bi + '.png');
  for (var bj = 0; bj < EC.blink.n101; bj++) loadImg('eye/b101_' + bj + '.png');

  window.ECApp = { show: show, drawMove: drawMove, canvasPNG: function () { return canvas.toDataURL('image/png'); }, stop: clearScene, state: function () { return cur.label; } };
  show('_start');
})();
