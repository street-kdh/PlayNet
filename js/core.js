/* PlayNet — 화면 공통 부분 (접속, 첫 화면, 대기실, 채팅, 공용 UI)
 * 각 게임의 화면은 js/games/<id>.js 가 PlayNet.registerGame 으로 등록한다. */
(() => {
  'use strict';

  const PROTOCOL = 2; // server/core/version.js 의 PROTOCOL 과 같아야 함
  const VERSION = '1.3.3';
  const BASE = window.PLAYNET_BASE || '/';
  const CFG = window.PLAYNET_CONFIG || {};

  // ───────────────── DOM helpers
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  // ───────────────── 게임 모듈 등록
  const modules = new Map();
  window.PlayNet = {
    version: VERSION,
    registerGame(id, mod) {
      modules.set(id, mod);
    },
  };

  // ───────────────── 상태
  let socket = null;
  let conn = 'connecting';
  let serverInfo = null;
  let state = null;
  let skew = 0;
  let timerTotal = 0;
  let lastDeadline = null;
  let lastStageKey = null;
  let resultShownKey = null;
  let session = store.get('playnet.session');

  const AVATAR_COLORS = ['#d9b772', '#c77b5a', '#9fb4c7', '#b6a0c9', '#8fbf9f', '#d4a5a5', '#c9c28f', '#a3a3a3', '#e0b48a', '#8fb3b0', '#c49bb0', '#b8b8d9'];
  const colorFor = (id) => {
    const idx = state ? state.players.findIndex((p) => p.id === id) : 0;
    return AVATAR_COLORS[(idx < 0 ? 0 : idx) % AVATAR_COLORS.length];
  };
  const player = (id) => (state ? state.players.find((p) => p.id === id) : null);
  const nameOf = (id) => player(id)?.name ?? '?';
  const moduleFor = (id) => modules.get(id);

  // ───────────────── 알림
  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
  }

  function emit(ev, data) {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) {
        toast('서버에 연결되어 있지 않아요.', true);
        return resolve({ ok: false });
      }
      socket.timeout(8000).emit(ev, data || {}, (err, res) => {
        if (err) {
          toast('서버 응답이 없어요. 잠시 후 다시 시도하세요.', true);
          return resolve({ ok: false });
        }
        if (res && res.ok === false) toast(res.error, true);
        resolve(res || {});
      });
    });
  }

  // ───────────────── 공용 UI (게임 모듈에서 사용)
  const ui = {
    avatar(p, size) {
      const bot = !!(p && p.bot);
      const a = el('span', 'avatar' + (bot ? ' bot' : ''), (bot ? p.name.replace(/^AI\s*/, '') : p?.name || '?')[0] || '?');
      a.style.background = colorFor(p?.id);
      if (bot) a.title = 'AI 플레이어';
      if (size) {
        a.style.width = a.style.height = size + 'px';
        a.style.fontSize = Math.round(size * 0.44) + 'px';
      }
      return a;
    },

    banner(parent, title, sub, tone) {
      const b = el('div', 'banner' + (tone ? ' ' + tone : ''));
      b.append(document.createTextNode(title));
      if (sub) b.append(el('small', null, sub));
      parent.append(b);
      return b;
    },

    /** items: [{ id, name, tag:{text,tone}, meta, dead, badge }] */
    playerGrid(parent, items, opts = {}) {
      const grid = el('div', 'player-grid');
      const clickable = new Set(opts.clickable || []);
      items.forEach((it, i) => {
        const p = player(it.id) || { id: it.id, name: it.name };
        const c = el('div', 'pcard');
        if (it.id === state.me.id) c.classList.add('me');
        if (it.dead) c.classList.add('dead');
        if (p.connected === false && !p.left) c.classList.add('offline');
        if (opts.accused === it.id) c.classList.add('accused');
        if (opts.speaking === it.id) c.classList.add('speaking');
        const can = clickable.has(it.id);
        if (can) c.classList.add('clickable');
        else if (clickable.size && !it.dead) c.classList.add('dim');
        if (opts.selected === it.id) c.classList.add('selected');

        c.append(el('span', 'seat', String(i + 1).padStart(2, '0')));
        c.append(ui.avatar(p), el('div', 'pname', p.name));
        let meta = it.meta ?? '';
        if (!meta) {
          if (it.id === state.me.id) meta = '나';
          else if (p.bot) meta = 'AI';
          if (p.left) meta = '나감';
          else if (p.connected === false) meta = '연결 끊김';
          else if (it.dead) meta = p.bot ? '사망 · AI' : '사망';
        }
        c.append(el('div', 'pmeta', meta));
        if (it.tag) c.append(el('span', 'ptag' + (it.tag.tone ? ' ' + it.tag.tone : ''), it.tag.text));
        if (it.badge) c.append(el('span', 'votes', it.badge));
        if (can && opts.onPick) {
          c.tabIndex = 0;
          c.setAttribute('role', 'button');
          c.onclick = () => opts.onPick(it.id);
          c.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), opts.onPick(it.id));
        }
        grid.append(c);
      });
      parent.append(grid);
      return grid;
    },

    /** 서버 시각 deadline 까지 남은 초 ("8초") — 화면 타이머와 함께 매 순간 갱신된다 */
    countdown(deadline) {
      const s = el('span', 'countdown');
      s.dataset.countdown = String(deadline);
      paintCountdown(s);
      return s;
    },

    /** buttons: [{ label, cls, onClick, disabled }] */
    actionBar(parent, buttons) {
      const bar = el('div', 'action-bar');
      for (const b of buttons) {
        if (!b) continue;
        const btn = el('button', 'btn ' + (b.cls || ''), b.label);
        btn.onclick = b.onClick;
        btn.disabled = !!b.disabled;
        bar.append(btn);
      }
      if (bar.children.length) parent.append(bar);
      return bar;
    },

    overlay({ icon, title, sub }) {
      const o = $('phaseOverlay');
      $('poIcon').textContent = icon || '';
      $('poTitle').textContent = title || '';
      $('poSub').textContent = sub || '';
      $('cardModal').classList.add('hidden');
      o.classList.remove('hidden');
      o.style.animation = 'none';
      o.firstElementChild.style.animation = 'none';
      void o.offsetWidth;
      o.style.animation = '';
      o.firstElementChild.style.animation = '';
      clearTimeout(o._t);
      o._t = setTimeout(() => o.classList.add('hidden'), 2200);
    },

    /** 직업·제시어 카드 */
    revealCard({ eyebrow, icon, title, badge, desc, extra, tone, animate }) {
      const card = document.querySelector('.reveal-card');
      card.className = 'reveal-card' + (tone ? ' ' + tone : '') + (animate ? '' : ' static');
      const inner = card.querySelector('.rc-inner');
      inner.style.animation = 'none';
      void inner.offsetWidth;
      inner.style.animation = '';
      $('rcEyebrow').textContent = eyebrow || '';
      $('rcIcon').textContent = icon || '';
      $('rcTitle').textContent = title || '';
      $('rcBadge').textContent = badge || '';
      $('rcDesc').textContent = desc || '';
      $('rcExtra').textContent = extra || '';
      $('cardModal').classList.remove('hidden');
    },
  };

  function ctx() {
    return {
      state,
      play: state.play,
      me: state.me,
      isHost: state.me.id === state.hostId,
      info: state.lobby ? state.lobby.info : null,
      player,
      nameOf,
      colorFor,
      el,
      toast,
      ui,
      act: (type, payload) => emit('gameAction', { type, ...(payload || {}) }),
      /** 대화창으로 보내기 (퀴즈처럼 대화로 답하는 게임) */
      say: (text) => emit('chat', { text }),
      update: (settings) => emit('updateSettings', { settings }),
    };
  }

  // ───────────────── 접속
  function connect() {
    let url;
    let path;
    if (CFG.server) {
      const u = new URL(CFG.server, location.href);
      url = u.origin;
      path = u.pathname.replace(/\/+$/, '') + '/socket.io';
    } else {
      path = BASE + 'socket.io';
    }
    const opts = { path, reconnectionDelayMax: 8000, timeout: 10000 };
    socket = url ? io(url, opts) : io(opts);

    socket.on('connect', () => {
      setConn('online');
      if (session) {
        socket.emit('resume', session, (res) => {
          if (!res || !res.ok) {
            clearSession();
            showHome();
          }
        });
      }
    });
    socket.on('disconnect', () => setConn('offline'));
    socket.on('connect_error', () => setConn('offline'));
    socket.on('hello', (info) => {
      serverInfo = info;
      $('versionNote').classList.toggle('hidden', info.protocol === PROTOCOL);
      renderGameList();
    });
    socket.on('state', (s) => {
      state = s;
      skew = s.serverNow - Date.now();
      renderRoom();
    });
    socket.on('history', (msgs) => {
      $('messages').innerHTML = '';
      msgs.forEach(addMessage);
    });
    socket.on('chat', (m) => {
      addMessage(m);
      // 게임 화면이 새 메시지에 반응할 수 있게 (예: 퀴즈 음성 모드의 통과/실패 소리)
      const mod = state && moduleFor(state.gameId);
      if (mod && mod.onChat) {
        try {
          mod.onChat(ctx(), m);
        } catch (e) {
          console.error(e);
        }
      }
    });
    socket.on('kicked', ({ message }) => {
      clearSession();
      showHome();
      toast(message, true);
    });
  }

  function setConn(s) {
    conn = s;
    const pill = $('connPill');
    pill.className = 'conn-pill ' + s;
    pill.querySelector('span').textContent = s === 'online' ? '서버 연결됨' : s === 'offline' ? '서버 꺼짐 · 재연결 중' : '서버 연결 중…';
    $('offlineNote').classList.toggle('hidden', s !== 'offline');
    $('connBanner').classList.toggle('hidden', s !== 'offline' || !state);
    renderGameList();
  }

  function saveSession(res) {
    session = { code: res.code, playerId: res.playerId, token: res.token };
    store.set('playnet.session', session);
    history.replaceState(null, '', BASE + '?room=' + res.code);
  }
  function clearSession() {
    session = null;
    store.del('playnet.session');
  }

  // ───────────────── 첫 화면
  const nameInput = $('nameInput');
  const codeInput = $('codeInput');

  function getName() {
    const n = nameInput.value.trim();
    if (!n) {
      toast('닉네임을 먼저 입력하세요.', true);
      nameInput.focus();
      return null;
    }
    store.set('playnet.name', n);
    return n;
  }

  function renderGameList() {
    const list = $('gameList');
    if (!list) return;
    list.innerHTML = '';
    const available = serverInfo ? new Set(serverInfo.games.map((g) => g.id)) : null;
    for (const [id, mod] of modules) {
      const m = mod.meta;
      const card = el('article', 'game-card');
      card.dataset.game = id;
      const soon = available && !available.has(id);
      if (soon) card.classList.add('soon');
      card.append(el('div', 'gc-icon', m.icon), el('h3', null, m.name), el('p', 'gc-tag', m.tagline), el('p', 'gc-desc', m.description));
      const meta = el('div', 'gc-meta');
      meta.append(el('span', null, `👥 ${m.players}`), el('span', null, `⏱ ${m.playtime}`));
      card.append(meta);
      const btn = el('button', 'btn go', soon ? '서버 업데이트 필요' : '방 만들기');
      btn.disabled = soon || conn !== 'online';
      btn.onclick = async () => {
        const name = getName();
        if (!name) return;
        btn.disabled = true;
        const res = await emit('createRoom', { name, gameId: id });
        btn.disabled = false;
        if (res.ok) saveSession(res);
      };
      card.append(btn);
      list.append(card);
    }
    $('joinBtn').disabled = conn !== 'online';
  }

  async function join() {
    const name = getName();
    if (!name) return;
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return toast('4자리 초대 코드를 입력하세요.', true);
    const res = await emit('joinRoom', { code, name });
    if (res.ok) saveSession(res);
  }

  let peekTimer;
  function peek() {
    const code = codeInput.value.trim().toUpperCase();
    const out = $('joinPeek');
    out.textContent = '';
    clearTimeout(peekTimer);
    if (code.length !== 4 || conn !== 'online') return;
    peekTimer = setTimeout(() => {
      socket.emit('peekRoom', { code }, (res) => {
        if (codeInput.value.trim().toUpperCase() !== code) return;
        out.textContent = '';
        if (!res || !res.ok) {
          out.textContent = '존재하지 않는 방 코드예요.';
          return;
        }
        const mod = moduleFor(res.gameId);
        out.append(el('b', null, `${mod ? mod.meta.icon + ' ' : ''}${res.gameName}`));
        const status = res.phase === 'lobby' ? '대기 중' : '게임 중 (끝나면 참가 가능)';
        out.append(document.createTextNode(` 방 · ${res.players}/${res.max}명 · ${status}`));
      });
    }, 250);
  }

  function bindHome() {
    nameInput.value = store.get('playnet.name') || '';
    const urlRoom = new URLSearchParams(location.search).get('room');
    if (urlRoom) codeInput.value = urlRoom.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    $('joinBtn').onclick = join;
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
      peek();
    });
    codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && codeInput.value.length === 4 && join());
    $('clientVersion').textContent = 'v' + VERSION;
  }

  function showHome() {
    state = null;
    lastStageKey = null;
    resultShownKey = null;
    lastDeadline = null;
    document.body.className = 'screen-home';
    $('home').classList.remove('hidden');
    $('app').classList.add('hidden');
    ['cardModal', 'resultModal', 'phaseOverlay'].forEach((id) => $(id).classList.add('hidden'));
    $('messages').innerHTML = '';
    renderGameList();
    peek();
  }

  // ───────────────── 방 화면
  function bindRoom() {
    $('codeChip').onclick = async () => {
      if (!state) return;
      const link = `${location.origin}${BASE}?room=${state.code}`;
      try {
        await navigator.clipboard.writeText(link);
        toast('초대 링크를 복사했습니다.');
      } catch {
        toast(link);
      }
    };

    let leaveArmed = false;
    $('leaveBtn').onclick = async () => {
      const inGame = state && state.phase === 'playing';
      if (inGame && !leaveArmed) {
        leaveArmed = true;
        $('leaveBtn').textContent = '정말 나갈까요?';
        setTimeout(() => {
          leaveArmed = false;
          $('leaveBtn').textContent = '나가기';
        }, 3000);
        return;
      }
      leaveArmed = false;
      $('leaveBtn').textContent = '나가기';
      if (socket && socket.connected) await emit('leaveRoom');
      clearSession();
      history.replaceState(null, '', BASE);
      codeInput.value = '';
      showHome();
    };

    $('roleChip').onclick = () => {
      const mod = moduleFor(state?.gameId);
      if (mod && mod.showCard) mod.showCard(ctx(), false);
    };

    $('startBtn').onclick = () => emit('startGame');
    $('rcClose').onclick = () => $('cardModal').classList.add('hidden');
    $('cardModal').onclick = (e) => e.target.id === 'cardModal' && $('cardModal').classList.add('hidden');
    $('resultClose').onclick = () => $('resultModal').classList.add('hidden');
    $('lobbyBtn').onclick = () => emit('returnToLobby');

    $('chatForm').onsubmit = async (e) => {
      e.preventDefault();
      const input = $('chatInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const res = await emit('chat', { text });
      if (res.ok === false) input.value = text;
    };
  }

  function renderRoom() {
    const s = state;
    const mod = moduleFor(s.gameId);
    const play = s.play;
    $('home').classList.add('hidden');
    $('app').classList.remove('hidden');
    document.body.className = ['screen-room', 'game-' + s.gameId, 'phase-' + s.phase, play && play.stage ? 'stage-' + play.stage : '']
      .filter(Boolean)
      .join(' ');

    // 상단 바
    $('roomCode').textContent = s.code;
    let top = { icon: s.game.icon, label: '대기실', sub: s.game.name };
    if (s.phase !== 'lobby' && mod && mod.topbar) top = { ...top, ...mod.topbar(ctx()) };
    $('phaseIcon').textContent = top.icon;
    $('phaseLabel').textContent = top.label;
    $('phaseSub').textContent = top.sub || '';
    const chip = $('roleChip');
    const rc = s.phase !== 'lobby' && mod && mod.roleChip ? mod.roleChip(ctx()) : null;
    chip.classList.toggle('hidden', !rc);
    if (rc) {
      chip.textContent = rc.text;
      chip.className = 'chip role' + (rc.tone ? ' ' + rc.tone : '');
    }
    if (s.deadline !== lastDeadline) {
      lastDeadline = s.deadline;
      timerTotal = s.deadline ? s.deadline - s.serverNow : 0;
    }
    $('timer').classList.toggle('hidden', !s.deadline);
    $('connBanner').classList.toggle('hidden', conn !== 'offline');

    const inLobby = s.phase === 'lobby';
    $('lobbyView').classList.toggle('hidden', !inLobby);
    $('gameView').classList.toggle('hidden', inLobby);
    if (inLobby) {
      $('resultModal').classList.add('hidden');
      renderLobby();
    } else if (mod) {
      const root = $('gameRoot');
      keepInputs(root, () => {
        root.innerHTML = '';
        mod.render(root, ctx());
      });
    }
    renderChatInput(mod);
    handleStageChange(mod);
    tick();
  }

  /** 다시 그려도 입력 중인 내용과 커서가 유지되도록 (data-keep 속성) */
  function keepInputs(root, fn) {
    const saved = {};
    root.querySelectorAll('[data-keep]').forEach((i) => {
      saved[i.dataset.keep] = { value: i.value, focus: document.activeElement === i, s: i.selectionStart, e: i.selectionEnd };
    });
    fn();
    root.querySelectorAll('[data-keep]').forEach((i) => {
      const v = saved[i.dataset.keep];
      if (!v) return;
      i.value = v.value;
      if (v.focus) {
        i.focus();
        try { i.setSelectionRange(v.s, v.e); } catch {}
      }
    });
  }

  function renderLobby() {
    const s = state;
    const isHost = s.me.id === s.hostId;
    const mod = moduleFor(s.gameId);

    const ul = $('lobbyPlayers');
    ul.innerHTML = '';
    s.players.forEach((p) => {
      const li = el('li', (p.connected ? '' : 'off') + (p.bot ? ' bot' : ''));
      li.append(ui.avatar(p), el('span', 'name', p.name));
      if (p.id === s.hostId) li.append(el('span', 'tag host', '방장'));
      if (p.id === s.me.id) li.append(el('span', 'tag me', '나'));
      if (p.bot) li.append(el('span', 'tag ai', 'AI'));
      if (!p.connected) li.append(el('span', 'tag', '연결 끊김'));
      if (isHost && p.id !== s.me.id && !p.bot) {
        const k = el('button', 'btn ghost small kick', '내보내기');
        k.onclick = () => emit('kick', { playerId: p.id });
        li.append(k);
      }
      ul.append(li);
    });
    const bots = s.lobby.bots;
    $('playerCount').textContent = `${s.players.length} / ${s.game.maxPlayers}${bots && bots.count ? ` (AI ${bots.count})` : ''}`;
    $('settingsLock').classList.toggle('hidden', isHost);
    renderBotPanel(isHost);

    // 게임 고르기
    const picker = $('gamePicker');
    picker.innerHTML = '';
    const available = serverInfo ? serverInfo.games : [];
    for (const g of available) {
      const m = moduleFor(g.id);
      if (!m) continue;
      const b = el('button', 'gp-item' + (g.id === s.gameId ? ' active' : ''));
      b.disabled = !isHost;
      const txt = el('span');
      txt.append(el('div', 'gp-name', g.name), el('div', 'gp-meta', `${g.minPlayers}~${g.maxPlayers}명 · ${g.playtime}`));
      b.append(el('span', 'gp-icon', g.icon), txt);
      if (isHost && g.id !== s.gameId) b.onclick = () => emit('selectGame', { gameId: g.id });
      picker.append(b);
    }

    // 게임별 설정 (입력 중이면 다시 그리지 않음)
    const panel = $('settingsPanel');
    // 글자·숫자를 입력하는 중일 때만 다시 그리지 않는다 (버튼·체크박스를 누른 뒤에는 바로 반영)
    const ae = document.activeElement;
    const editing =
      ae && panel.contains(ae) && (ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(ae.type)));
    if (!editing || panel.dataset.game !== s.gameId) {
      panel.innerHTML = '';
      panel.dataset.game = s.gameId;
      if (mod && mod.renderSettings) mod.renderSettings(panel, ctx());
    }

    const btn = $('startBtn');
    btn.classList.toggle('hidden', !isHost);
    btn.disabled = !!s.lobby.startError;
    const short = s.lobby.startError && bots && !bots.enabled && s.players.length < s.game.minPlayers;
    $('startHint').textContent = s.lobby.startError
      ? s.lobby.startError + (short && isHost ? ' · 🤖 AI로 채우기를 켜면 바로 시작할 수 있어요.' : '')
      : isHost
      ? '모두 모였다면 시작하세요.'
      : '방장이 게임을 시작하기를 기다리는 중…';
  }

  /** 부족한 인원을 AI 로 채우기 (방장만 변경) */
  function renderBotPanel(isHost) {
    const s = state;
    const b = s.lobby.bots;
    const panel = $('botPanel');
    panel.innerHTML = '';
    if (!b) return;
    const head = el('div', 'bot-head');
    const sw = el('label', 'switch');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = b.enabled;
    cb.disabled = !isHost;
    cb.onchange = () => emit('setBots', { enabled: cb.checked });
    sw.append(cb, el('span', null, '🤖 부족한 인원 AI로 채우기'));
    head.append(sw);
    panel.append(head);
    if (b.enabled) {
      const row = el('div', 'bot-row');
      row.append(el('span', 'bot-label', '총 인원'));
      const st = el('span', 'stepper');
      const lo = s.game.minPlayers;
      const hi = s.game.maxPlayers;
      if (isHost) {
        const minus = el('button', 'btn', '−');
        const plus = el('button', 'btn', '+');
        minus.disabled = b.target <= lo;
        plus.disabled = b.target >= hi;
        minus.onclick = () => emit('setBots', { target: b.target - 1 });
        plus.onclick = () => emit('setBots', { target: b.target + 1 });
        st.append(minus, el('b', null, b.target), plus);
      } else st.append(el('b', null, b.target));
      row.append(st, el('span', 'muted small', `사람 ${b.humans} · AI ${b.count}`));
      panel.append(row);
    }
    panel.append(
      el(
        'p',
        'set-note',
        b.enabled
          ? 'AI는 사람과 같은 정보만 보고 스스로 판단해요. 사람이 들어오면 AI가 자리를 비켜 줘요.'
          : `혼자이거나 인원이 부족해도 AI와 함께 바로 시작할 수 있어요. (${s.game.name} ${s.game.minPlayers}~${s.game.maxPlayers}명)`
      )
    );
  }

  // ───────────────── 채팅
  function addMessage(m) {
    const box = $('messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    let d;
    const mine = state && m.from === state.me.id;
    if (m.channel === 'system' && m.kind === 'host') {
      // 게임 사회자(AI MC)의 멘트
      d = el('div', 'msg host');
      d.append(el('span', 'who', m.name || '사회자'), document.createTextNode(m.text));
    } else if (m.channel === 'system') {
      d = el('div', `msg system ${m.kind || ''}${m.to ? ' private' : ''}`, m.text);
    } else if (!m.name) {
      d = el('div', `msg ${m.channel} note`, m.text);
    } else {
      d = el('div', `msg ${m.channel}${m.kind ? ' ' + m.kind : ''}${m.voice ? ' voice' : ''}${mine ? ' mine' : ''}`);
      const who = el('span', 'who', m.name);
      if (m.channel === 'public' && !mine) who.style.color = colorFor(m.from);
      d.append(who, document.createTextNode(m.text));
    }
    box.append(d);
    if (nearBottom || mine) box.scrollTop = box.scrollHeight;
  }

  const CHANNELS = {
    public: ['전체 대화', '메시지 입력'],
    mafia: ['🔪 마피아 전용', '동료 마피아에게만 보입니다'],
    dead: ['👻 망자 전용', '죽은 사람끼리만 보입니다'],
  };

  function renderChatInput(mod) {
    const ch = state.me.channel;
    const input = $('chatInput');
    const tag = $('channelTag');
    let [label, ph] = CHANNELS[ch] || ['🔇 대화 불가', '지금은 말할 수 없습니다'];
    if (!ch && mod && mod.mutedText) ph = mod.mutedText(ctx()) || ph;
    tag.textContent = label;
    tag.className = 'channel-tag ' + (ch || '');
    input.placeholder = ph;
    input.disabled = !ch;
    $('chatForm').querySelector('button').disabled = !ch;
  }

  // ───────────────── 단계 전환 / 결과
  function handleStageChange(mod) {
    const s = state;
    const p = s.play || {};
    const key = [s.code, s.gameNo, s.phase, s.gameId, p.stage, p.day, p.round].join(':');
    if (key === lastStageKey) return;
    const first = lastStageKey === null;
    lastStageKey = key;
    // 한 줄 배치(모바일)에서는 새 단계의 안내가 보이도록 맨 위로
    if (!first && window.innerWidth <= 900) window.scrollTo({ top: 0, behavior: 'smooth' });
    if (s.phase === 'lobby') return;
    if (s.phase === 'gameover') {
      const rk = `${s.code}:${s.gameNo}`;
      if (resultShownKey !== rk) {
        resultShownKey = rk;
        showResult(mod);
      }
      return;
    }
    if (mod && mod.onStage) mod.onStage(ctx(), { first });
  }

  function showResult(mod) {
    if (!mod || !mod.result) return;
    const r = mod.result(ctx());
    if (!r) return;
    const box = document.querySelector('.result');
    box.className = 'card result ' + (r.tone || '');
    $('resultTitle').textContent = r.title;
    $('resultSub').textContent = r.sub || '';
    const extra = $('resultExtra');
    extra.innerHTML = '';
    if (r.extra) extra.append(r.extra);
    const ul = $('resultList');
    ul.innerHTML = '';
    for (const row of r.rows || []) {
      const li = el('li', (row.dead ? 'dead ' : '') + (row.win ? 'win' : ''));
      li.append(ui.avatar(player(row.id) || { id: row.id, name: row.name }), el('span', 'name', row.name + (row.id === state.me.id ? ' (나)' : '')));
      if (row.label) li.append(el('span', null, row.label));
      if (row.note) li.append(el('span', 'muted small', row.note));
      ul.append(li);
    }
    $('lobbyBtn').classList.toggle('hidden', state.me.id !== state.hostId);
    $('resultModal').classList.remove('hidden');
  }

  // ───────────────── 타이머
  function paintCountdown(node) {
    const left = Math.max(0, Number(node.dataset.countdown) - (Date.now() + skew));
    const sec = Math.ceil(left / 1000);
    node.textContent = `${sec}초`;
    node.classList.toggle('urgent', sec <= 3);
  }

  function tick() {
    document.querySelectorAll('[data-countdown]').forEach(paintCountdown);
    if (!state || !state.deadline) return;
    const left = Math.max(0, state.deadline - (Date.now() + skew));
    const sec = Math.ceil(left / 1000);
    $('timerText').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const ratio = timerTotal > 0 ? Math.min(1, left / timerTotal) : 0;
    $('timerBar').style.transform = `scaleX(${ratio})`;
    const calm = state.play && ['intro', 'verdict'].includes(state.play.stage);
    $('timer').classList.toggle('urgent', sec <= 10 && !calm);
  }

  // ───────────────── 시작
  function boot() {
    bindHome();
    bindRoom();
    renderGameList();
    setConn('connecting');
    if (typeof io !== 'function') {
      setConn('offline');
      toast('필요한 파일을 불러오지 못했어요. 새로고침해 주세요.', true);
      return;
    }
    connect();
    setInterval(tick, 250);
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
