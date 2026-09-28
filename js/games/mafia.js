/* PlayNet — 마피아 화면 */
(() => {
  'use strict';

  const STAGE_ICON = { intro: '🎭', night: '🌙', discussion: '☀️', vote: '🗳️', defense: '⚖️', final: '⚖️', verdict: '🔔', end: '🏁' };

  const roleOf = (c) => (c.play && c.play.me ? c.play.roles[c.play.me.role] : null);
  const pstate = (c, id) => (c.play ? c.play.players.find((x) => x.id === id) : null);

  // ───────────────── 📢 사회자 목소리 (이 기기만)
  //  서버가 모두에게 보이는 진행 알림("밤이 되었습니다…")에 붙여 보낸 읽기용 문장(speech)을 차례로 읽는다.
  //  직업·조사 결과 같은 개인 알림에는 읽을 문장이 없어서 어떤 기기도 소리 내지 않는다.
  //  기본은 켜짐 — 한자리에 모여 여러 기기로 할 때는 한 기기만 켜 두면 된다.
  const HAS_TTS = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  const NAR_KEY = 'playnet.mafia.narrator';
  const NAR_VOICE = { rate: 0.95, pitch: 0.85 }; // 조금 낮고 차분하게
  const N = { on: readPref(NAR_KEY), primed: false, queue: [], id: 0, busy: false, u: null };
  function readPref(key) {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  }
  function savePref(key, on) {
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch {
      /* 저장 안 돼도 이번 접속 동안은 유지 */
    }
  }
  const inMafia = () => document.body.classList.contains('game-mafia');
  function koVoice() {
    try {
      return window.speechSynthesis.getVoices().find((v) => /^ko/i.test(v.lang || '')) || null;
    } catch {
      return null;
    }
  }
  /** 지금 바로 읽기 (하던 말은 끊는다) — 끝나면 줄 서 있던 다음 문장 */
  function sayNow(text, done) {
    const id = ++N.id;
    N.busy = true;
    let finished = false;
    const fin = () => {
      if (finished) return;
      finished = true;
      if (N.id !== id) return;
      N.busy = false;
      N.u = null;
      if (done) done();
      setTimeout(nextLine, 250);
    };
    if (window.PLAYNET_DEBUG) (window.PlayNet._narr = window.PlayNet._narr || []).push(text);
    const go = () => {
      if (N.id !== id) return;
      try {
        const u = new window.SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        u.rate = NAR_VOICE.rate;
        u.pitch = NAR_VOICE.pitch;
        u.volume = 1;
        const v = koVoice();
        if (v) u.voice = v;
        u.onend = fin;
        u.onerror = fin;
        N.u = u; // 끝 알림이 사라지지 않게 붙잡아 둔다 (일부 브라우저)
        window.speechSynthesis.speak(u);
      } catch {
        setTimeout(fin, 0);
      }
    };
    let busy = false;
    try {
      busy = !!(window.speechSynthesis.speaking || window.speechSynthesis.pending);
      if (busy) window.speechSynthesis.cancel();
    } catch {
      /* 무시 */
    }
    if (busy) setTimeout(go, 80); // 끊자마자 말하면 소리가 안 나는 브라우저가 있어 잠깐 쉬었다가
    else go(); // 누른 순간이면 그 안에서 바로 (아이폰)
    setTimeout(fin, 2000 + String(text).length * 280); // 끝났다는 알림이 오지 않는 브라우저 대비
  }
  function nextLine() {
    while (N.queue.length && !N.busy) {
      const it = N.queue.shift();
      if (Date.now() - it.at > 20000 || !N.on || !inMafia()) continue; // 너무 늦은 알림은 건너뛴다
      return void sayNow(it.text);
    }
  }
  function narrate(text) {
    if (!N.on || !HAS_TTS || !inMafia() || !text) return;
    N.queue.push({ text, at: Date.now() });
    if (N.queue.length > 6) N.queue.shift();
    if (!N.busy) nextLine();
  }
  function hush() {
    N.id++;
    N.queue = [];
    N.busy = false;
    N.u = null;
    try {
      if (HAS_TTS) window.speechSynthesis.cancel();
    } catch {
      /* 무시 */
    }
  }
  function setNarrator(on, c) {
    N.on = on;
    savePref(NAR_KEY, on);
    if (!on) hush();
    else sayNow('사회자 목소리를 켰습니다.'); // 누른 순간 한 번 읽어 두면 아이폰에서도 이후 알림을 읽는다
    if (c) c.toast(on ? '📢 사회자 목소리 켜짐 — 이 기기에서 진행 알림을 읽어 줘요' : '🔇 사회자 목소리 꺼짐 (이 기기만)');
  }
  // 아이폰 등: 사용자 동작 안에서 한 번 말해 두어야 나중에 저절로 읽을 수 있다 (홈 화면에서 방에 들어가는 누름 포함)
  function primeTts(e) {
    if (N.primed || !N.on || !HAS_TTS) return;
    if (!inMafia() && !document.body.classList.contains('screen-home')) return;
    if (!['touchend', 'click', 'keydown'].includes(e.type)) return;
    N.primed = true;
    try {
      const u = new window.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* 무시 */
    }
  }
  for (const type of ['touchend', 'click', 'keydown']) document.addEventListener(type, primeTts, true);
  // 마피아 방을 나가면 읽던 말을 멈춘다 (다른 게임·화면에 영향 없게)
  let wasMafia = inMafia();
  new MutationObserver(() => {
    const now = inMafia();
    if (now === wasMafia) return;
    wasMafia = now;
    if (!now) hush();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  function narratorNote() {
    if (!HAS_TTS) return '이 브라우저는 읽어 주기를 지원하지 않아요 (크롬·사파리·삼성 인터넷에서 가능).';
    return '기본으로 켜져 있어요. "밤이 되었습니다", "아침이 밝았습니다"처럼 진행 알림을 사회자가 읽어 줘요. 직업·조사 결과 같은 비밀은 읽지 않아요. 한자리에 모여 여러 기기로 할 때는 한 기기만 켜 두면 돼요.';
  }
  function narratorPill(c) {
    const { el } = c;
    const b = el('button', 'qs-voice-pill' + (N.on ? ' on' : ''), N.on ? '📢 사회자 켜짐' : '🔇 사회자 꺼짐');
    b.type = 'button';
    b.title = narratorNote();
    b.onclick = () => {
      setNarrator(!N.on, c);
      b.replaceWith(narratorPill(c));
    };
    return b;
  }

  function renderSettings(panel, c) {
    const { el, isHost, info } = c;
    const s = c.state.settings;
    const n = c.state.players.length;

    // 직업 구성
    const auto = !s.composition;
    const sec1 = el('div', 'set-section');
    const t1 = el('div', 'set-title');
    t1.append(el('span', null, `직업 구성${n < 4 ? ' (4인 기준)' : ''}`));
    const sw = el('label', 'switch');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = auto;
    cb.disabled = !isHost;
    cb.onchange = () => {
      if (cb.checked) c.update({ composition: null });
      else {
        const comp = {};
        for (const [id, cnt] of Object.entries(info.composition)) if (!info.roles[id].filler) comp[id] = cnt;
        c.update({ composition: comp });
      }
    };
    sw.append(cb, el('span', null, '자동'));
    t1.append(sw);
    sec1.append(t1);

    const list = el('div', 'comp-list');
    for (const r of Object.values(info.roles)) {
      const count = info.composition[r.id] ?? 0;
      const row = el('div', 'comp-row' + (r.team === 'mafia' ? ' bad' : ''));
      row.title = r.description;
      row.append(el('span', null, r.icon), el('span', 'rname', r.name));
      const st = el('span', 'stepper');
      if (!auto && isHost && !r.filler) {
        const minus = el('button', 'btn', '−');
        const plus = el('button', 'btn', '+');
        const change = (d) => c.update({ composition: { ...s.composition, [r.id]: Math.max(0, count + d) } });
        minus.onclick = () => change(-1);
        plus.onclick = () => change(1);
        st.append(minus, el('b', null, count), plus);
      } else {
        st.append(el('b', null, count));
      }
      row.append(st);
      list.append(row);
    }
    sec1.append(list);
    panel.append(sec1);

    // 시간
    const sec2 = el('div', 'set-section');
    sec2.append(el('div', 'set-title', '단계별 시간 (초)'));
    const grid = el('div', 'times-grid');
    const labels = { night: '밤', discussion: '토론', vote: '투표', defense: '최후 변론', final: '찬반 투표' };
    for (const [k, label] of Object.entries(labels)) {
      const lab = el('label', null, label);
      const inp = el('input');
      inp.type = 'number';
      inp.value = s.times[k];
      [inp.min, inp.max] = info.limits[k];
      inp.disabled = !isHost;
      inp.onchange = () => c.update({ times: { [k]: inp.value } });
      lab.append(inp);
      grid.append(lab);
    }
    sec2.append(grid);
    panel.append(sec2);

    // 기타
    const sec3 = el('div', 'set-section');
    const sw2 = el('label', 'switch');
    const cb2 = el('input');
    cb2.type = 'checkbox';
    cb2.checked = s.revealOnDeath;
    cb2.disabled = !isHost;
    cb2.onchange = () => c.update({ revealOnDeath: cb2.checked });
    sw2.append(cb2, el('span', null, '죽은 사람의 직업 공개'));
    sec3.append(sw2);
    panel.append(sec3);

    // 이 기기만 (방장이 아니어도 각자)
    const sec4 = el('div', 'set-section');
    sec4.append(el('div', 'set-title', '내 기기'));
    if (HAS_TTS) {
      const sw4 = el('label', 'switch');
      const cb4 = el('input');
      cb4.type = 'checkbox';
      cb4.checked = N.on;
      cb4.onchange = () => setNarrator(cb4.checked, c);
      sw4.append(cb4, el('span', null, '📢 사회자 목소리 — 진행 알림을 읽어 주기'));
      sec4.append(sw4);
    }
    sec4.append(el('p', 'set-note', narratorNote()));
    if (HAS_TTS) {
      const btns = el('div', 'qs-dev-btns');
      const test = el('button', 'btn small', '🔊 소리 확인');
      test.type = 'button';
      test.title = '이 기기에서 사회자 목소리가 들리는지 확인해요';
      test.onclick = () => {
        N.queue = [];
        sayNow('사회자입니다. 목소리가 잘 들리나요?');
      };
      btns.append(test);
      sec4.append(btns);
    }
    panel.append(sec4);
  }

  /**
   * 마피아 공동 선택 (서버 1.2.2+: a.step 이 있음)
   *  여러 명: ① 예정자 선택(10초) → ② 예정자 중 최종 선택 → 결정 (가장 많이 고른 대상, 동률이면 무작위)
   *  한 명:   바로 최종 선택. 어느 단계든 "아무도 선택하지 않음"을 고를 수 있다.
   */
  const isTeamKill = (a) => !!(a && a.type === 'night' && a.action === 'kill' && a.step);
  const pickName = (c, id) => (id && id !== 'none' ? `${c.nameOf(id)}님` : '아무도 선택하지 않음');
  const teamPicks = (a) => (a.step === 'final' ? a.finals : a.nominees) || [];

  function killBanner(c, a) {
    if (a.step === 'done') {
      const d = a.decided || {};
      if (d.targetId) {
        return {
          title: `오늘 밤 대상: ${c.nameOf(d.targetId)}`,
          sub: `${a.team && d.by ? `${d.by}님이 움직입니다 · ` : ''}능력을 가진 사람이 모두 고르면 바로 아침이 됩니다`,
        };
      }
      return {
        title: '오늘 밤은 아무도 해치지 않습니다',
        sub: a.team ? '예정자가 없거나 모두 "아무도 선택하지 않음"을 골랐어요 · 아침을 기다리세요' : '아침을 기다리세요',
      };
    }
    if (!a.team) {
      return {
        title: a.prompt,
        sub: '카드를 누르면 바로 확정됩니다 · 아무도 해치지 않으려면 "아무도 선택하지 않음"을 누르세요',
      };
    }
    if (a.step === 'nominate') {
      return {
        title: '① 예정자 선택',
        sub: a.selected
          ? `내 예정자: ${pickName(c, a.selected)} (모두 고르기 전까지 바꿀 수 있어요) · 마피아가 모두 고르면 예정자 중에서 최종 선택을 합니다`
          : '오늘 밤 대상 후보를 고르세요 · 10초 안에 고르지 않으면 예정자 없음으로 처리됩니다 · 모두 고르면 예정자 중에서 최종 선택을 합니다',
        countdown: a.stepDeadline,
      };
    }
    return {
      title: '② 최종 선택',
      sub:
        (a.selected ? `내 최종 선택: ${pickName(c, a.selected)} (모두 고르기 전까지 바꿀 수 있어요)` : '예정자 중에서 오늘 밤 대상을 고르세요') +
        ' · 가장 많이 고른 사람이 대상이 되고 동률이면 무작위 · 모두 "아무도 선택하지 않음"이면 아무 일도 없어요',
    };
  }

  /** 동료 마피아가 지금 단계에서 누구를 골랐는지 */
  function teamRow(c, a) {
    const { el } = c;
    const row = el('div', 'team-picks');
    const picks = new Map(teamPicks(a).map((x) => [x.by, x.targetId]));
    const label = a.step === 'final' ? '최종' : '예정자';
    for (const id of a.members || []) {
      const has = picks.has(id);
      const t = picks.get(id);
      const chip = el('span', 'tp ' + (!has ? 'wait' : t ? 'on' : 'none'));
      chip.append(el('b', null, id === c.me.id ? '나' : c.nameOf(id)));
      chip.append(document.createTextNode(!has ? ' · 고르는 중…' : t ? ` → ${c.nameOf(t)}` : ' → 아무도'));
      chip.title = `${id === c.me.id ? '나' : c.nameOf(id)}의 ${label} 선택`;
      row.append(chip);
    }
    return row;
  }

  function render(root, c) {
    const { el, ui, play } = c;
    const me = play.me || { alive: false, action: null };
    const a = me.action;
    const accused = c.player(play.accusedId);
    const teamKill = me.alive && play.stage === 'night' && isTeamKill(a);

    // 안내 배너
    let title = '';
    let sub = '';
    let tone = '';
    let countdown = null;
    if (play.stage === 'end') {
      const win = play.winner === 'mafia';
      title = win ? '🔪 마피아 승리' : '⚖️ 시민 승리';
      sub = '모든 플레이어의 직업이 공개되었습니다.';
      tone = win ? 'alert' : 'accent';
    } else if (!me.alive) {
      title = '👻 당신은 죽었습니다';
      sub = '모든 직업을 볼 수 있으며, 다른 망자들과만 대화할 수 있습니다.';
    } else if (play.stage === 'intro') {
      title = '직업을 확인하세요';
      sub = '잠시 후 첫 번째 밤이 시작됩니다.';
    } else if (play.stage === 'night') {
      if (teamKill) {
        tone = 'alert';
        ({ title, sub, countdown } = killBanner(c, a));
      } else if (a && a.type === 'night') {
        title = a.locked ? '조사를 마쳤습니다' : a.prompt;
        if (a.locked) sub = '결과는 대화창에서 확인하세요.';
        else if (a.action === 'kill') {
          // 이전 서버(1.2.1 이하)와 연결된 경우
          tone = 'alert';
          if (!a.selected) sub = '동료 마피아 중 마지막으로 고른 사람이 대상이 되고, 그 마피아가 움직인 것으로 처리됩니다.';
          else if (a.done === false)
            sub = `동료가 ${c.nameOf(a.selected)}님을 골랐어요 · 같은 사람을 누르면 동의, 다른 사람을 누르면 변경 · 마피아가 모두 골라야 밤이 끝납니다`;
          else sub = `현재 목표: ${c.nameOf(a.selected)} · ${a.pickedBy}님이 움직입니다 (마지막으로 지목한 마피아) · 모두 고르면 바로 아침이 됩니다`;
        } else if (a.action === 'track') {
          sub = a.selected
            ? `미행 대상: ${c.nameOf(a.selected)} · 결과는 아침에 대화창으로 알려드려요 · 모두 고르면 바로 아침이 됩니다`
            : '카드를 눌러 미행할 사람을 고르세요. 그 사람이 누구에게 움직였는지 아침에 알려드려요.';
        } else sub = a.selected ? `선택: ${c.nameOf(a.selected)} · 모두 고르면 바로 아침이 됩니다 (그 전까지 바꿀 수 있어요)` : '카드를 눌러 선택하세요.';
      } else {
        title = '밤이 깊었습니다';
        sub = '아침이 오기를 기다리세요…';
      }
    } else if (play.stage === 'discussion') {
      title = '토론 시간';
      sub = '밤사이 일어난 일을 바탕으로 마피아를 찾아내세요. 모두 "투표로 넘어가기"를 누르면 바로 투표합니다.';
    } else if (play.stage === 'vote') {
      title = '처형할 사람을 지목하세요';
      sub = a && a.selected
        ? (a.selected === 'skip' ? '기권했습니다' : `${c.nameOf(a.selected)}님에게 투표했습니다`) + ' · 모두 투표하면 바로 결과가 나옵니다 (그 전까지 바꿀 수 있어요)'
        : '최다 득표자가 최후의 변론을 합니다. 동률이면 아무도 지목되지 않습니다. 모두 투표하면 바로 결과가 나옵니다.';
    } else if (play.stage === 'defense') {
      tone = 'alert';
      title = a && a.type === 'accused' ? '당신의 최후의 변론 시간입니다' : `${accused?.name}님의 최후의 변론`;
      sub = a && a.type === 'accused' ? '대화창에서 결백을 주장하세요. 다 말했으면 "변론 마치기"를 누르세요.' : '변론을 들어보세요. 변론이 끝나면 바로 찬반 투표입니다.';
    } else if (play.stage === 'final') {
      tone = 'alert';
      title = a && a.type === 'accused' ? '당신의 운명이 결정되고 있습니다' : `${accused?.name}님을 처형할까요?`;
      sub = `${play.finalCount}명 투표 완료 · 찬성이 반대보다 많으면 처형됩니다 · 모두 투표하면 바로 결과가 나옵니다`;
    } else if (play.stage === 'verdict') {
      title = '판결이 내려졌습니다';
      sub = '곧 밤이 찾아옵니다.';
    }
    if (HAS_TTS) {
      const tools = el('div', 'mf-tools');
      tools.append(narratorPill(c));
      root.append(tools);
    }
    const bannerEl = ui.banner(root, title, sub, tone);
    if (countdown) {
      // 제목 옆에 남은 시간 (⏱ 8초) — core 의 타이머가 매 순간 갱신
      const cd = el('span', 'step-timer');
      cd.append('⏱ ', ui.countdown(countdown));
      bannerEl.insertBefore(cd, bannerEl.querySelector('small'));
    }
    if (teamKill && a.team && a.step !== 'done') bannerEl.append(teamRow(c, a));

    // 플레이어 카드
    let targets = [];
    if (a && a.type === 'night' && !a.locked) targets = a.targets;
    if (a && a.type === 'vote') targets = a.targets;
    // 마피아: 대상마다 동료가 고른 수 (예정자 / 최종), 최종 선택 단계에서는 예정자 표시
    const killCount = {};
    const candidates = new Set();
    if (teamKill && a.team && a.step !== 'done') {
      for (const x of teamPicks(a)) if (x.targetId) killCount[x.targetId] = (killCount[x.targetId] || 0) + 1;
      if (a.step === 'final') for (const id of a.targets) candidates.add(id);
    }
    const items = play.players.map((x) => {
      const r = x.role ? play.roles[x.role] : null;
      let tag = r ? { text: `${r.icon} ${r.name}`, tone: r.team === 'mafia' ? 'bad' : '' } : null;
      if (candidates.has(x.id)) tag = { text: tag ? `${tag.text} · 🎯 예정자` : '🎯 예정자', tone: 'bad' };
      return {
        id: x.id,
        dead: !x.alive,
        tag,
        badge: (play.voteTally && play.voteTally[x.id]) || (killCount[x.id] ? `🔪${killCount[x.id]}` : null),
      };
    });
    ui.playerGrid(root, items, {
      clickable: targets,
      selected: a ? a.selected : null,
      accused: play.accusedId,
      onPick: (id) => (a.type === 'night' ? c.act('night', { targetId: id }) : c.act('vote', { targetId: id })),
    });

    // 하단 버튼
    const buttons = [];
    if (teamKill) {
      if (a.canSkip) {
        buttons.push({
          label: a.selected === 'none' ? '✓ 아무도 선택하지 않음' : '🚫 아무도 선택하지 않음',
          cls: a.selected === 'none' ? 'selected' : '',
          onClick: () => c.act('night', { targetId: 'none' }),
        });
      }
    } else if (a && a.type === 'discussion') {
      if (play.readyTotal != null) {
        const cnt = `${play.readyCount}/${play.readyTotal}`;
        buttons.push({
          label: a.ready ? `✓ 준비 완료 (${cnt})` : `투표로 넘어가기 (${cnt})`,
          cls: a.ready ? 'selected' : 'primary',
          disabled: a.ready,
          onClick: () => c.act('ready'),
        });
      }
      buttons.push({ label: '⏱ 시간 +15초', onClick: () => c.act('adjustTime', { dir: 1 }), disabled: a.usedTimeAdjust });
      buttons.push({ label: '⏱ 시간 −15초', onClick: () => c.act('adjustTime', { dir: -1 }), disabled: a.usedTimeAdjust });
    } else if (a && a.type === 'vote') {
      const sk = play.voteTally && play.voteTally.skip;
      buttons.push({ label: `기권${sk ? ` (${sk})` : ''}`, cls: a.selected === 'skip' ? 'selected' : '', onClick: () => c.act('vote', { targetId: 'skip' }) });
    } else if (a && a.type === 'accused' && a.canEnd && play.stage === 'defense') {
      buttons.push({ label: '변론 마치기', cls: 'primary', onClick: () => c.act('endDefense') });
    } else if (a && a.type === 'final') {
      buttons.push({ label: '👍 찬성 (처형)', cls: 'yes' + (a.selected === 'yes' ? ' selected' : ''), onClick: () => c.act('final', { choice: 'yes' }) });
      buttons.push({ label: '👎 반대 (살림)', cls: 'no' + (a.selected === 'no' ? ' selected' : ''), onClick: () => c.act('final', { choice: 'no' }) });
    } else if (play.stage === 'end') {
      buttons.push({ label: '결과 보기', onClick: () => document.getElementById('resultModal').classList.remove('hidden') });
      if (c.isHost) buttons.push({ label: '대기실로', cls: 'primary', onClick: () => document.getElementById('lobbyBtn').click() });
    }
    ui.actionBar(root, buttons);
  }

  function showCard(c, animate) {
    const r = roleOf(c);
    if (!r) return;
    const mates = c.play.players.filter((x) => x.id !== c.me.id && x.role && r.team === 'mafia' && c.play.roles[x.role].team === 'mafia');
    c.ui.revealCard({
      eyebrow: '당신의 직업은',
      icon: r.icon,
      title: r.name,
      badge: r.team === 'mafia' ? '마피아 팀' : '시민 팀',
      desc: r.description,
      extra: mates.length ? `동료: ${mates.map((m) => c.nameOf(m.id)).join(', ')}` : '',
      tone: r.team === 'mafia' ? 'bad' : '',
      animate,
    });
  }

  function onStage(c, { first }) {
    const play = c.play;
    if (play.stage === 'intro') return showCard(c, true);
    if (first) return;
    const a = play.me && play.me.action;
    const acc = c.player(play.accusedId);
    const content = {
      night: ['🌙', `${play.day}번째 밤`, !play.me || !play.me.alive ? '망자들의 시간' : a && a.type === 'night' ? a.prompt : '조용히 아침을 기다리세요'],
      discussion: ['☀️', `${play.day}번째 낮`, '밤사이 무슨 일이 있었는지 확인하세요'],
      vote: ['🗳️', '투표 시간', '마피아로 의심되는 사람을 지목하세요'],
      defense: ['⚖️', '최후의 변론', acc ? `${acc.name}님의 마지막 발언` : ''],
      final: ['⚖️', '찬반 투표', acc ? `${acc.name}님을 처형할까요?` : ''],
    }[play.stage];
    if (content) c.ui.overlay({ icon: content[0], title: content[1], sub: content[2] });
  }

  window.PlayNet.registerGame('mafia', {
    meta: {
      name: '마피아',
      icon: '🔪',
      tagline: '밤이 되면, 누군가는 사라진다.',
      description: '마피아·의사·경찰·탐정·시민으로 나뉘어, 밤에는 능력을 쓰고 낮에는 토론과 투표로 상대 팀을 찾아내는 추리 게임.',
      players: '4~12명',
      playtime: '15~30분',
    },
    renderSettings,
    render,
    showCard,
    onStage,
    /** 새 대화 — 모두에게 보이는 진행 알림에 읽을 문장이 있으면 사회자 목소리로 */
    onChat(c, m) {
      if (m.channel === 'system' && !m.to && m.speech) narrate(m.speech);
    },
    topbar(c) {
      const play = c.play;
      const alive = play.players.filter((x) => x.alive).length;
      return { icon: STAGE_ICON[play.stage] || '🔪', label: play.stageLabel, sub: play.day > 0 ? `${play.day}일차 · 생존 ${alive}명` : '마피아' };
    },
    roleChip(c) {
      const r = roleOf(c);
      if (!r) return null;
      return { text: `${r.icon} ${r.name}${c.play.me.alive ? '' : ' (사망)'}`, tone: r.team === 'mafia' ? 'bad' : '' };
    },
    mutedText(c) {
      return (
        {
          intro: '곧 첫 번째 밤이 시작됩니다',
          night: '밤에는 말할 수 없습니다',
          defense: '최후의 변론 중에는 말할 수 없습니다',
          final: '찬반 투표 중에는 말할 수 없습니다',
        }[c.play.stage] || null
      );
    },
    result(c) {
      const play = c.play;
      const win = play.winner;
      const r = roleOf(c);
      return {
        tone: win === 'mafia' ? 'bad' : 'good',
        title: win === 'mafia' ? '마피아 승리' : '시민 승리',
        sub: r ? (r.team === win ? '당신의 팀이 이겼습니다! 🎉' : '당신의 팀이 졌습니다.') : '',
        rows: play.players.map((x) => {
          const role = play.roles[x.role];
          const p = c.player(x.id);
          return {
            id: x.id,
            name: c.nameOf(x.id),
            label: `${role.icon} ${role.name}`,
            note: p && p.left ? '나감' : x.alive ? '생존' : '사망',
            dead: !x.alive,
            win: role.team === win,
          };
        }),
      };
    },
  });
})();
