'use strict';

(function () {
  var STORE_KEY = 'az400-drill-v1';
  var BANK_KEY = 'az400-drill-bank-v1';
  var LETTERS = 'ABCDEFGHIJKL';
  var TARGET = 70;
  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  var MAX_QUESTIONS = 5000;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    back: 'M15 18l-6-6 6-6',
    check: 'M20 6L9 17l-5-5',
    cross: 'M18 6L6 18M6 6l12 12',
    upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
    install: 'M12 4v12M7 11l5 5 5-5M5 20h14'
  };

  var root = document.getElementById('app');
  var installEvent = null;
  var scrollToExplanation = false;

  // ---------- Storage ----------

  function readJSON(key) {
    try {
      var v = window.localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }

  function writeJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function removeKey(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* storage blocked: nothing to remove */ }
  }

  // ---------- Pure helpers ----------

  function toCount(n) {
    n = Number(n);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function shuffle(a) {
    var b = a.slice();
    for (var i = b.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = b[i]; b[i] = b[j]; b[j] = t;
    }
    return b;
  }

  function sameSet(a, b) {
    if (!a || a.length !== b.length) return false;
    var x = a.slice().sort(), y = b.slice().sort();
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  function withShuffledOptions(q) {
    if (!q.shuffleOptions) return q;
    var order = shuffle(q.options.map(function (o, k) { return k; }));
    return Object.assign({}, q, {
      options: order.map(function (k) { return q.options[k]; }),
      answer: q.answer.map(function (a) { return order.indexOf(a); })
    });
  }

  function uniqueDomains(list) {
    var out = [];
    list.forEach(function (q) { if (out.indexOf(q.domain) < 0) out.push(q.domain); });
    return out;
  }

  function normalize(raw, source) {
    if (!Array.isArray(raw)) throw new Error('The file must hold a JSON array of questions.');
    if (!raw.length) throw new Error('The file has no questions.');
    if (raw.length > MAX_QUESTIONS) throw new Error('The file has more than ' + MAX_QUESTIONS + ' questions.');
    var seen = {};
    return raw.map(function (q, n) {
      var where = 'Question ' + (n + 1);
      if (!q || typeof q !== 'object') throw new Error(where + ' is not an object.');
      var text = typeof q.question === 'string' ? q.question : q.q;
      var opts = q.options;
      var ans = typeof q.answer === 'number' ? [q.answer] : q.answer;
      if (typeof text !== 'string' || !text.trim()) throw new Error(where + ' needs a "question" text.');
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > LETTERS.length) {
        throw new Error(where + ' needs between 2 and ' + LETTERS.length + ' "options".');
      }
      if (!Array.isArray(ans) || !ans.length) throw new Error(where + ' needs an "answer" index or a list of indexes.');
      ans.forEach(function (a) {
        if (typeof a !== 'number' || a % 1 !== 0 || a < 0 || a >= opts.length) {
          throw new Error(where + ' has an answer index outside its options (indexes start at 0).');
        }
      });
      var options = opts.map(function (o) { return String(o); });
      var id = source === 'builtin' && typeof q.id === 'string'
        ? q.id
        : 'c:' + hash(text + '\u0001' + options.join('\u0001'));
      if (seen[id]) id += ':' + n;
      seen[id] = true;
      return {
        id: id,
        domain: typeof q.domain === 'string' && q.domain.trim() ? q.domain.trim() : 'Imported',
        q: text,
        code: typeof q.code === 'string' ? q.code : '',
        options: options,
        answer: ans.filter(function (a, k) { return ans.indexOf(a) === k; }),
        shuffleOptions: source === 'builtin',
        why: typeof q.explanation === 'string' ? q.explanation : (typeof q.why === 'string' ? q.why : '')
      };
    });
  }

  // ---------- State ----------

  var BUILTIN = [];
  try { BUILTIN = normalize(window.BUILTIN_QUESTIONS || [], 'builtin'); } catch (e) { console.error('Built-in questions are invalid:', e); }

  var saved = readJSON(STORE_KEY) || {};
  var storedBank = null;
  var rawBank = readJSON(BANK_KEY);
  if (rawBank) {
    try { storedBank = normalize(rawBank, 'file'); } catch (e) { removeKey(BANK_KEY); }
  }

  var S = {
    screen: 'home', mode: 'practice', domain: 'All',
    custom: storedBank, useCustom: !!storedBank && saved.useCustom === true,
    fileMsg: '', fileErr: false,
    session: [], i: 0, picks: {}, checked: {}, review: false,
    missed: Array.isArray(saved.missed) ? saved.missed.filter(function (x) { return typeof x === 'string'; }) : [],
    answered: toCount(saved.answered), correct: Math.min(toCount(saved.correct), toCount(saved.answered))
  };

  function getBank() { return S.useCustom && S.custom ? S.custom : BUILTIN; }

  function persist() {
    writeJSON(STORE_KEY, { missed: S.missed, answered: S.answered, correct: S.correct, useCustom: S.useCustom });
  }

  function setState(patch, opts) {
    Object.assign(S, patch);
    render(opts && opts.top);
  }

  // ---------- Actions ----------

  function startSession(list) {
    if (!list.length) return;
    setState({ screen: 'quiz', session: shuffle(list).map(withShuffledOptions), i: 0, picks: {}, checked: {}, review: false }, { top: true });
  }

  function pick(k) {
    var q = S.session[S.i];
    if (!q || k < 0 || k >= q.options.length) return;
    if (S.review || (S.mode === 'practice' && S.checked[q.id])) return;
    var cur = (S.picks[q.id] || []).slice(), need = q.answer.length;
    if (need === 1) cur = [k];
    else {
      var at = cur.indexOf(k);
      if (at >= 0) cur.splice(at, 1);
      else { if (cur.length >= need) cur.shift(); cur.push(k); }
    }
    var picks = Object.assign({}, S.picks);
    picks[q.id] = cur;
    setState({ picks: picks });
  }

  function check() {
    var q = S.session[S.i];
    if (!q || !(S.picks[q.id] || []).length) return;
    var checked = Object.assign({}, S.checked);
    checked[q.id] = true;
    scrollToExplanation = true;
    setState({ checked: checked });
  }

  function go(n) {
    if (n < 0 || n >= S.session.length || n === S.i) return;
    setState({ i: n }, { top: true });
  }

  function finish() {
    var right = 0, missed = S.missed.slice();
    S.session.forEach(function (q) {
      var at = missed.indexOf(q.id);
      if (sameSet(S.picks[q.id], q.answer)) { right++; if (at >= 0) missed.splice(at, 1); }
      else if (at < 0) missed.push(q.id);
    });
    S.missed = missed;
    S.answered += S.session.length;
    S.correct += right;
    persist();
    setState({ screen: 'result', review: false }, { top: true });
  }

  function leaveToHome() {
    var inProgress = S.screen === 'quiz' && !S.review && Object.keys(S.picks).length > 0;
    if (inProgress && !window.confirm('Leave this set? Your answers in it will not be scored.')) return;
    setState({ screen: 'home', review: false }, { top: true });
  }

  function resetStats() {
    if (!window.confirm('Reset your answered count, accuracy and missed list on this device?')) return;
    S.missed = []; S.answered = 0; S.correct = 0;
    persist();
    render();
  }

  function onFile(e) {
    var input = e.target, f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { setState({ fileMsg: 'That file is over 5 MB.', fileErr: true }); return; }
    f.text().then(function (txt) {
      var qs = normalize(JSON.parse(txt), 'file');
      var stored = writeJSON(BANK_KEY, qs);
      S.useCustom = true;
      persist();
      setState({
        custom: qs, domain: 'All', fileErr: false,
        fileMsg: 'Loaded ' + qs.length + ' questions from ' + f.name + '.' + (stored ? '' : ' They could not be saved on this device, so load the file again next time.')
      });
    }).catch(function (err) {
      setState({ fileErr: true, fileMsg: err instanceof SyntaxError ? 'That file is not valid JSON.' : (err && err.message) || 'Could not read that file.' });
    });
  }

  function removeCustom() {
    if (!window.confirm('Remove your question file from this app? You can load it again later.')) return;
    removeKey(BANK_KEY);
    S.useCustom = false;
    persist();
    setState({ custom: null, domain: 'All', fileMsg: 'Removed your question file.', fileErr: false });
  }

  function promptInstall() {
    if (!installEvent) return;
    var evt = installEvent;
    installEvent = null;
    evt.prompt();
    evt.userChoice.then(render, render);
  }

  function primaryAction(q, picks) {
    var last = S.i >= S.session.length - 1;
    if (S.review) {
      return last
        ? { label: 'Back to results', run: function () { setState({ screen: 'result', review: false }, { top: true }); } }
        : { label: 'Next', run: function () { go(S.i + 1); } };
    }
    if (S.mode === 'practice') {
      if (!S.checked[q.id]) return { label: 'Check answer', run: check, disabled: !picks.length };
      return last ? { label: 'See results', run: finish } : { label: 'Next question', run: function () { go(S.i + 1); } };
    }
    return last ? { label: 'Finish exam', run: finish } : { label: 'Next', run: function () { go(S.i + 1); } };
  }

  // ---------- DOM helpers ----------

  function append(el, kids) {
    if (kids == null || kids === false) return;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    append(el, kids);
    return el;
  }

  function icon(name, size, label) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', size || 20);
    svg.setAttribute('height', size || 20);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', name === 'check' || name === 'cross' ? '2.5' : '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); }
    else svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  function isAppleSafari() {
    var ua = navigator.userAgent;
    return /Safari/.test(ua) && /Mac|iPhone|iPad/.test(ua) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Android/.test(ua);
  }

  // ---------- Screens ----------

  function eyebrow(text) { return h('p', { class: 'eyebrow', text: text }); }

  function group(label, body) {
    return h('div', { class: 'group' }, [eyebrow(label), body]);
  }

  function renderHome() {
    var bank = getBank();
    var names = ['All'].concat(uniqueDomains(bank));
    var domain = names.indexOf(S.domain) >= 0 ? S.domain : 'All';
    var pool = domain === 'All' ? bank : bank.filter(function (q) { return q.domain === domain; });
    var missedList = bank.filter(function (q) { return S.missed.indexOf(q.id) >= 0; });
    var accuracy = S.answered ? Math.round(100 * S.correct / S.answered) + '%' : '—';

    function stat(value, label) {
      return h('div', { class: 'stat' }, [h('div', { class: 'v', text: String(value) }), h('div', { class: 'l', text: label })]);
    }

    var bankChips = S.custom ? group('Question bank', h('div', { class: 'chips' }, [
      { label: 'Built-in', count: BUILTIN.length, val: false },
      { label: 'Your file', count: S.custom.length, val: true }
    ].map(function (b) {
      return h('button', {
        type: 'button', class: 'chip', 'data-k': 'bank-' + b.val, 'aria-pressed': String(S.useCustom === b.val),
        onclick: function () { S.useCustom = b.val; persist(); setState({ domain: 'All' }); }
      }, [b.label, ' ', h('span', { class: 'count', text: String(b.count) })]);
    }))) : null;

    var domainChips = group('Domain', h('div', { class: 'chips' }, names.map(function (d) {
      var count = d === 'All' ? bank.length : bank.filter(function (q) { return q.domain === d; }).length;
      return h('button', {
        type: 'button', class: 'chip', 'data-k': 'domain-' + d, 'aria-pressed': String(domain === d),
        onclick: function () { setState({ domain: d }); }
      }, [d, ' ', h('span', { class: 'count', text: String(count) })]);
    })));

    var modeCards = group('Mode', h('div', { class: 'modes' }, [
      { key: 'practice', label: 'Practice', sub: 'Explanation after each answer' },
      { key: 'exam', label: 'Exam', sub: 'No hints, score at the end' }
    ].map(function (m) {
      return h('button', {
        type: 'button', class: 'mode', 'data-k': 'mode-' + m.key, 'aria-pressed': String(S.mode === m.key),
        onclick: function () { setState({ mode: m.key }); }
      }, [h('span', { class: 't', text: m.label }), h('span', { class: 's', text: m.sub })]);
    })));

    var install = null;
    if (!isStandalone()) {
      if (installEvent) {
        install = h('button', { type: 'button', class: 'btn-secondary with-icon', 'data-k': 'install', onclick: promptInstall }, [icon('install'), 'Install app']);
      } else if (isAppleSafari()) {
        install = h('p', { class: 'note', text: 'To install in Safari: on Mac choose File, then Add to Dock. On iPhone or iPad tap Share, then Add to Home Screen.' });
      }
    }

    var extra = h('section', { class: 'home-extra' }, [
      group('Your own questions', h('div', { class: 'stack' }, [
        h('label', { class: 'upload' }, [
          icon('upload'), 'Load a question file (.json)',
          h('input', { type: 'file', accept: '.json,application/json', 'data-k': 'file', onchange: onFile })
        ]),
        S.fileMsg ? h('p', { class: 'msg ' + (S.fileErr ? 'bad' : 'ok'), role: 'status', text: S.fileMsg }) : null,
        h('p', { class: 'note' }, [
          'A JSON array of objects with question, options, answer (index from 0, or a list of indexes), and optional explanation, domain and code. ',
          h('a', { href: 'sample-questions.json', download: 'sample-questions.json', text: 'Download a sample' }),
          '.'
        ])
      ])),
      h('div', { class: 'row-links' }, [
        h('button', { type: 'button', class: 'link', 'data-k': 'reset', disabled: !S.answered && !S.missed.length, onclick: resetStats, text: 'Reset progress' }),
        S.custom ? h('button', { type: 'button', class: 'link', 'data-k': 'remove-file', onclick: removeCustom, text: 'Remove question file' }) : null
      ]),
      install
    ]);

    return h('main', { class: 'home' }, [
      h('div', { class: 'home-left' }, [
        h('section', { class: 'home-intro' }, [
          h('div', { class: 'stack tight' }, [
            eyebrow('AZ-400 · DevOps Engineer Expert'),
            h('h1', { class: 'display', text: 'Exam drill' }),
            h('p', { class: 'lede', text: 'Short sets with an explanation for every answer. Anything you miss is saved for review.' })
          ]),
          h('div', { class: 'stats' }, [stat(S.answered, 'Answered'), stat(accuracy, 'Accuracy'), stat(missedList.length, 'To review')])
        ]),
        extra
      ]),
      h('div', { class: 'home-right' }, [
        h('section', { class: 'home-setup' }, [
          h('h2', { class: 'setup-title', text: 'Set up a session' }),
          bankChips, domainChips, modeCards
        ]),
        h('div', { class: 'actions' }, [
          h('button', {
            type: 'button', class: 'btn-primary', 'data-k': 'start', disabled: !pool.length,
            onclick: function () { startSession(pool); },
            text: 'Start ' + pool.length + (pool.length === 1 ? ' question' : ' questions')
          }),
          h('button', {
            type: 'button', class: 'btn-secondary', 'data-k': 'missed', disabled: !missedList.length,
            onclick: function () { startSession(missedList); },
            text: 'Review missed (' + missedList.length + ')'
          })
        ])
      ])
    ]);
  }

  function explanation(q, picks, variant) {
    var ok = sameSet(picks, q.answer);
    var verdict = ok ? 'Correct' : (picks.length ? 'Incorrect' : 'Not answered');
    var answer = 'Answer: ' + q.answer.slice().sort(function (a, b) { return a - b; }).map(function (k) { return LETTERS[k]; }).join(', ');
    var why = q.why || 'No explanation was given for this question.';
    if (variant === 'aside') {
      return h('div', { class: 'stack' }, [
        h('div', { class: 'verdict big ' + (ok ? 'ok' : 'bad') }, [icon(ok ? 'check' : 'cross', 26), verdict]),
        h('div', { class: 'ans', text: answer }),
        h('p', { class: 'why', text: why })
      ]);
    }
    return h('div', { class: 'expl expl-inline', id: 'explanation' }, [
      h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, [icon(ok ? 'check' : 'cross'), h('span', { class: 'grow', text: verdict }), h('span', { class: 'ans', text: answer })]),
      h('p', { class: 'why', text: why })
    ]);
  }

  function renderQuiz() {
    var n = S.session.length, q = S.session[S.i];
    var picks = S.picks[q.id] || [];
    var reveal = S.review || (S.mode === 'practice' && !!S.checked[q.id]);
    var action = primaryAction(q, picks);
    var modeLabel = S.review ? 'Review' : (S.mode === 'exam' ? 'Exam' : 'Practice');

    var options = h('ul', { class: 'options' }, q.options.map(function (text, k) {
      var sel = picks.indexOf(k) >= 0, isAns = q.answer.indexOf(k) >= 0;
      var tone = reveal ? (isAns ? 'right' : (sel ? 'wrong' : '')) : (sel ? 'sel' : '');
      var mark = reveal && isAns ? icon('check', 20, 'Correct answer') : (reveal && sel ? icon('cross', 20, 'Your incorrect choice') : null);
      return h('li', null, h('button', {
        type: 'button', class: 'opt ' + tone + (reveal ? ' locked' : ''), 'data-k': 'opt-' + k,
        'aria-pressed': String(sel), onclick: function () { pick(k); }
      }, [
        h('span', { class: 'badge', text: LETTERS[k] }),
        h('span', { class: 'txt', text: text }),
        mark ? h('span', { class: 'mark' }, mark) : null
      ]));
    }));

    var nav = h('aside', { class: 'quiz-nav', 'aria-label': 'Questions in this set' }, [
      h('div', { class: 'nav-grid' }, S.session.map(function (qq, k) {
        var p = S.picks[qq.id] || [], shown = S.review || (S.mode === 'practice' && S.checked[qq.id]);
        var tone = shown ? (sameSet(p, qq.answer) ? 'right' : 'wrong') : (p.length ? 'sel' : '');
        return h('button', {
          type: 'button', class: 'nav-btn ' + tone + (k === S.i ? ' current' : ''), 'data-k': 'nav-' + k,
          'aria-label': 'Question ' + (k + 1), 'aria-current': k === S.i ? 'step' : null,
          onclick: function () { go(k); }, text: String(k + 1)
        });
      })),
      h('div', { class: 'legend' }, [
        h('span', null, [h('i', { class: 'sw sel' }), 'Answered']),
        h('span', null, [h('i', { class: 'sw right' }), 'Correct']),
        h('span', null, [h('i', { class: 'sw wrong' }), 'Incorrect'])
      ]),
      h('p', { class: 'note keys', text: 'Keys: 1–' + Math.min(q.options.length, 9) + ' or A–' + LETTERS[q.options.length - 1] + ' to choose, Enter to continue, arrow keys to move.' }),
      S.mode === 'exam' && !S.review ? h('button', { type: 'button', class: 'btn-outline', 'data-k': 'finish-now', onclick: finish, text: 'Finish exam now' }) : null
    ]);

    return h('main', { class: 'quiz' }, [
      h('header', { class: 'quiz-top' }, [
        h('div', { class: 'row' }, [
          h('button', { type: 'button', class: 'home-btn', 'data-k': 'home', 'aria-label': 'Exit to home', onclick: leaveToHome }, [icon('back', 22), h('span', { class: 'label', text: 'Home' })]),
          h('div', { class: 'counter', text: 'Question ' + (S.i + 1) + ' of ' + n }),
          h('div', { class: 'pill', text: modeLabel })
        ]),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': n, 'aria-valuenow': S.i + 1, 'aria-label': 'Progress' },
          h('span', { style: 'width:' + Math.round(100 * (S.i + 1) / n) + '%' }))
      ]),
      h('div', { class: 'quiz-body' }, [
        nav,
        h('div', { class: 'quiz-main', 'data-scroll': 'quiz-main' }, [
          h('div', { class: 'quiz-content' }, [
            h('p', { class: 'domain-tag', text: q.domain }),
            h('p', { class: 'qtext', text: q.q }),
            q.code ? h('pre', { class: 'code', text: q.code }) : null,
            q.answer.length > 1 ? h('p', { class: 'need', text: 'Choose ' + q.answer.length + '.' }) : null,
            options,
            reveal ? explanation(q, picks, 'inline') : null
          ]),
          h('div', { class: 'quiz-foot' }, [
            h('button', { type: 'button', class: 'prev', 'data-k': 'prev', 'aria-label': 'Previous question', disabled: S.i === 0, onclick: function () { go(S.i - 1); } },
              [icon('back'), h('span', { class: 'label', text: 'Previous' })]),
            h('button', { type: 'button', class: 'btn-primary', 'data-k': 'primary', disabled: !!action.disabled, onclick: action.run, text: action.label })
          ])
        ]),
        h('aside', { class: 'quiz-aside', 'aria-label': 'Explanation' }, [
          eyebrow('Explanation'),
          reveal ? explanation(q, picks, 'aside') : h('p', {
            class: 'note big',
            text: S.mode === 'exam' ? 'Exam mode hides answers. Explanations appear when you review your results.' : 'Pick an answer, then check it. The explanation appears here.'
          })
        ])
      ])
    ]);
  }

  function renderResult() {
    var n = S.session.length;
    var right = S.session.filter(function (q) { return sameSet(S.picks[q.id], q.answer); });
    var wrong = S.session.filter(function (q) { return !sameSet(S.picks[q.id], q.answer); });
    var pct = n ? Math.round(100 * right.length / n) : 0;
    var passed = pct >= TARGET;

    var bars = uniqueDomains(S.session).map(function (d) {
      var all = S.session.filter(function (q) { return q.domain === d; });
      var r = all.filter(function (q) { return sameSet(S.picks[q.id], q.answer); }).length;
      var p = Math.round(100 * r / all.length);
      return h('div', { class: 'bar-row' }, [
        h('div', { class: 'bar-head' }, [h('span', { class: 'b', text: d }), h('span', { class: 'mono muted', text: r + ' / ' + all.length })]),
        h('div', { class: 'bar' }, h('span', { class: p >= TARGET ? '' : 'low', style: 'width:' + p + '%' }))
      ]);
    });

    var list = S.session.map(function (q, k) {
      var good = sameSet(S.picks[q.id], q.answer);
      return h('button', {
        type: 'button', class: 'rq', 'data-k': 'rq-' + k,
        onclick: function () { setState({ screen: 'quiz', review: true, i: k }, { top: true }); }
      }, [
        h('span', { class: 'num', text: String(k + 1) }),
        h('span', { class: 'grow stack tight' }, [h('span', { class: 'rq-text', text: q.q }), h('span', { class: 'eyebrow', text: q.domain })]),
        h('span', { class: good ? 'mark-ok' : 'mark-bad' }, icon(good ? 'check' : 'cross', 20, good ? 'Correct' : 'Incorrect'))
      ]);
    });

    return h('main', { class: 'result' }, [
      h('div', { class: 'result-left' }, [
        h('section', { class: 'result-summary' }, [
          h('div', { class: 'stack tight' }, [
            eyebrow('Set complete'),
            h('div', { class: 'score', text: pct + '%' }),
            h('div', { class: 'score-line' }, [
              h('span', { class: 'pass-pill ' + (passed ? 'ok' : 'bad'), text: passed ? 'At or above ' + TARGET + '% target' : 'Below ' + TARGET + '% target' }),
              h('span', { class: 'muted', text: right.length + ' of ' + n + ' correct' })
            ])
          ]),
          h('div', { class: 'group' }, [eyebrow('By domain')].concat(bars))
        ]),
        h('div', { class: 'actions' }, [
          h('button', {
            type: 'button', class: 'btn-primary', 'data-k': 'retry', disabled: !wrong.length,
            onclick: function () { startSession(wrong); },
            text: wrong.length ? 'Retry ' + wrong.length + ' missed' : 'No misses. Nice.'
          }),
          h('div', { class: 'two' }, [
            h('button', { type: 'button', class: 'btn-secondary', 'data-k': 'review', onclick: function () { setState({ screen: 'quiz', review: true, i: 0 }, { top: true }); }, text: 'Review answers' }),
            h('button', { type: 'button', class: 'btn-secondary', 'data-k': 'home', onclick: leaveToHome, text: 'Home' })
          ])
        ])
      ]),
      h('section', { class: 'result-list', 'data-scroll': 'result-list' }, [h('h2', { class: 'setup-title', text: 'Questions' })].concat(list))
    ]);
  }

  // ---------- Render loop ----------

  function render(toTop) {
    var active = document.activeElement;
    var key = active && active.getAttribute ? active.getAttribute('data-k') : null;
    var scrolls = {};
    if (!toTop) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-scroll]'), function (el) { scrolls[el.getAttribute('data-scroll')] = el.scrollTop; });
    }

    var view;
    if (S.screen === 'quiz' && S.session[S.i]) view = renderQuiz();
    else if (S.screen === 'result' && S.session.length) view = renderResult();
    else { S.screen = 'home'; view = renderHome(); }
    root.replaceChildren(view);

    document.title = S.screen === 'quiz' ? 'Question ' + (S.i + 1) + ' · AZ-400 Drill' : (S.screen === 'result' ? 'Results · AZ-400 Drill' : 'AZ-400 Drill');

    if (toTop) window.scrollTo(0, 0);
    else {
      Object.keys(scrolls).forEach(function (k) {
        var el = root.querySelector('[data-scroll="' + k + '"]');
        if (el) el.scrollTop = scrolls[k];
      });
    }
    if (key) {
      var sel = '[data-k="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]';
      var el = root.querySelector(sel);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
    if (scrollToExplanation) {
      scrollToExplanation = false;
      var ex = document.getElementById('explanation');
      if (ex && ex.offsetParent !== null) ex.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ---------- Keyboard (Mac / tablets with keyboards) ----------

  function onKeydown(e) {
    if (S.screen !== 'quiz' || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var q = S.session[S.i];
    if (!q) return;
    var k = e.key, idx = -1;
    if (/^[1-9]$/.test(k)) idx = Number(k) - 1;
    else if (/^[a-l]$/i.test(k)) idx = LETTERS.indexOf(k.toUpperCase());
    if (idx >= 0 && idx < q.options.length) { e.preventDefault(); pick(idx); return; }
    if (k === 'ArrowRight') { e.preventDefault(); go(S.i + 1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); go(S.i - 1); }
    else if (k === 'Enter' && (!t || t.tagName !== 'BUTTON')) {
      var action = primaryAction(q, S.picks[q.id] || []);
      if (!action.disabled) { e.preventDefault(); action.run(); }
    }
  }

  // ---------- Install + offline ----------

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    navigator.serviceWorker.register('./sw.js').catch(function (err) {
      console.warn('Offline support is unavailable:', err);
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e;
    if (S.screen === 'home') render();
  });
  window.addEventListener('appinstalled', function () {
    installEvent = null;
    if (S.screen === 'home') render();
  });
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('load', registerServiceWorker);

  render(true);
})();
