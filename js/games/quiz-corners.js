/* PlayNet — 예능 퀴즈쇼 코너 화면
 *  💣 폭탄 돌리기 · 🔔 생존 퀴즈 · 💞 이구동성 · 🎌 청기백기 · 👅 잰말놀이 · 🙊 설명하고 맞히기
 *  quiz.js 가 만든 window.PlayNetQuiz(음성·소리 도구)에 코너별 { render, tick, tags, progress, onChat, leave } 를 등록한다.
 *   render(root, c, cv)  화면 (cv = 서버가 보낸 코너 정보)
 *   tick(c, cv)          상태가 바뀔 때마다 — 내 차례 듣기, 효과음
 *   tags(c, cv, id)      점수판 옆 표시 (❤️·💥 등)
 *   progress(cv)         위쪽 띠의 진행 ("폭탄 2/3")
 */
(() => {
  'use strict';
  const Q = window.PlayNetQuiz;
  if (!Q) return;
  const V = Q.V;

  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // ───────────────── 공통: 코너의 음성 상태 (한 번에 하나)
  const CV = { mode: 'idle', heard: '', interim: '', note: '' };
  const LINES = {
    listening: '🎙️ 듣고 있어요 — 말해 보세요!',
    checking: '⏳ 확인 중…',
    wrong: '❌ 다시 말해 보세요',
    done: '✅ 보냈어요',
    captions: '🎙️ 말로 설명하는 중 — 모두에게 자막으로 보여요',
  };
  function voiceLine() {
    const box = mk('div', 'qs-voice qc-voice ' + CV.mode);
    box.id = 'qcVoice';
    if (LINES[CV.mode]) box.append(mk('div', 'qv-line', LINES[CV.mode]));
    const said = CV.interim || CV.heard;
    if (said) box.append(mk('div', 'qv-heard', `“${said}”`));
    if (CV.note) box.append(mk('div', 'qv-note', CV.note));
    if (!box.children.length) box.classList.add('empty');
    return box;
  }
  function paintVoice() {
    const old = document.getElementById('qcVoice');
    if (old) old.replaceWith(voiceLine());
  }
  function setCV(patch) {
    Object.assign(CV, patch);
    paintVoice();
  }
  function resetCV() {
    Object.assign(CV, { mode: 'idle', heard: '', interim: '', note: '' });
  }
  const canTalk = () => !!(V.on && Q.SR);
  /**
   * 저절로 다시 듣기 — 듣기가 곧바로 끝나는 일이 거듭되면(오류 등) 그만두고 입력칸으로.
   * 1.5초 안에 끝난 듣기가 네 번 이어지면 이번 차례(key)에는 더 듣지 않는다.
   */
  const RE = { key: null, fast: 0, at: 0 };
  function listenStarted(key) {
    if (RE.key !== key) {
      RE.key = key;
      RE.fast = 0;
    }
    RE.at = Date.now();
  }
  function relisten(key, again, giveUp) {
    const quick = Date.now() - RE.at < 1500;
    RE.fast = quick ? RE.fast + 1 : 0;
    if (RE.fast >= 4) return void giveUp();
    setTimeout(again, quick ? 600 : 250);
  }

  /** 한 마디 듣기 (🎤 누르고 말하기) */
  function pushToTalk(onAlts) {
    if (!Q.SR) return;
    Q.unlock();
    setCV({ mode: 'listening', heard: '', interim: '', note: '' });
    Q.listen(
      (alts) => {
        setCV({ mode: 'checking', heard: alts[0], interim: '' });
        onAlts(alts);
      },
      () => setCV({ mode: 'idle', interim: '', note: '아무 말도 들리지 않았어요.' }),
      () => setCV({ mode: 'idle', note: '듣기를 시작하지 못했어요 — 입력칸에 써 주세요.' }),
      { onInterim: (t) => setCV({ interim: t }), onBlocked: (err) => setCV({ mode: 'idle', note: Q.blockedNote(err) }) }
    );
  }

  /** 입력칸 (+ 🎤) */
  function inputBar(c, { placeholder, keep, onSubmit, mic, onVoice }) {
    const { el } = c;
    const form = el('form', 'qs-answer');
    const input = el('input');
    input.maxLength = 80;
    input.placeholder = placeholder;
    input.dataset.keep = keep;
    input.autocomplete = 'off';
    input.enterKeyHint = 'send';
    const send = el('button', 'btn primary', '보내기');
    send.type = 'submit';
    form.append(input, send);
    if (mic && canTalk()) {
      const m = el('button', 'btn qs-mic-btn' + (CV.mode === 'listening' ? ' on' : ''), '🎤');
      m.type = 'button';
      m.title = '말로 하기';
      m.onclick = () => pushToTalk(onVoice);
      form.append(m);
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const res = await onSubmit(text);
      if (res && res.ok === false) input.value = text;
      input.focus();
    };
    setTimeout(() => {
      if (document.activeElement === document.body && window.innerWidth > 900) input.focus();
    }, 0);
    return form;
  }

  const who = (c, id) => `${c.nameOf(id)}님${id === c.me.id ? ' (나)' : ''}`;
  const hearts = (n, max) => '❤️'.repeat(Math.max(0, n)) + '🤍'.repeat(Math.max(0, max - n));

  function namesRow(c, ids, cls = '') {
    const row = mk('div', 'qc-names ' + cls);
    for (const id of ids) row.append(mk('span', 'qc-name' + (id === c.me.id ? ' me' : ''), c.nameOf(id)));
    return row;
  }

  // ───────────────── 💣 폭탄 돌리기
  const B = { listenKey: null, boomKey: null, ticker: null, c: null, tock: false };
  function startTicking() {
    if (B.ticker || !V.on) return;
    B.ticker = setInterval(() => {
      B.tock = !B.tock;
      Q.sfx(B.tock ? 'tock' : 'tick');
    }, 620);
  }
  function stopTicking() {
    clearInterval(B.ticker);
    B.ticker = null;
  }
  function bombListen(key) {
    if (B.listenKey !== key) return;
    setCV({ mode: 'listening', interim: '' });
    listenStarted(key);
    Q.listen(
      async (alts) => {
        if (B.listenKey !== key) return;
        setCV({ mode: 'checking', heard: alts[0], interim: '' });
        const res = await B.c.act('voice', { texts: alts });
        if (B.listenKey !== key) return;
        if (res && res.correct) return setCV({ mode: 'done', note: '' });
        Q.sfx('wrong');
        const why = res && res.reason === 'used' ? '이미 나온 단어예요' : '주제와 맞지 않아요';
        setCV({ mode: 'wrong', heard: '', note: `“${(res && res.heard) || alts[0]}” — ${why}` });
        setTimeout(() => bombListen(key), 250);
      },
      () => {
        if (B.listenKey === key) relisten(key, () => bombListen(key), () => setCV({ mode: 'idle', interim: '', note: '말이 잘 안 들려요 — 입력칸에 써 주세요.' }));
      },
      () => setCV({ mode: 'idle', note: '듣기를 시작하지 못했어요 — 입력칸에 써 주세요.' }),
      { onInterim: (t) => setCV({ interim: t }), onBlocked: (err) => setCV({ mode: 'idle', note: Q.blockedNote(err) }) }
    );
  }
  const bombUI = {
    progress: (cv) => (cv.no ? `폭탄 ${cv.no}/${cv.total}` : ''),
    tags(c, cv, id) {
      const out = [];
      if (cv.step === 'play' && cv.holderId === id) out.push({ text: '💣', cls: 'turn' });
      const b = cv.booms[id];
      if (b) out.push({ text: `💥${b > 1 ? `×${b}` : ''}`, cls: 'boom' });
      return out;
    },
    render(root, c, cv) {
      const { el } = c;
      const card = el('div', 'qs-card qc-card qc-bomb ' + cv.step);
      const mine = cv.holderId === c.me.id;
      if (cv.topic) card.append(el('div', 'qc-topic', `${cv.topic.icon} 주제: ${cv.topic.name}`));
      if (cv.step === 'ready') {
        card.append(el('div', 'qc-big', `💣 ${cv.no}번째 폭탄`), el('div', 'qs-status', `${who(c, cv.holderId)}부터! 폭탄을 받으면 주제에 맞는 단어를 외치세요`));
      } else if (cv.step === 'play') {
        card.append(el('div', 'qc-bomb-icon' + (mine ? ' mine' : ''), '💣'));
        card.append(el('div', 'qc-holder' + (mine ? ' mine' : ''), mine ? '내 차례! 단어를 외치세요!' : `${c.nameOf(cv.holderId)}님이 들고 있어요`));
        card.append(el('div', 'qs-status', `${cv.turnSeconds}초 안에 못 넘기면 펑! 심지가 언제 다 탈지는 아무도 몰라요`));
        if (mine) card.append(voiceLine());
      } else if (cv.step === 'boom' && cv.lastBoom) {
        card.append(el('div', 'qc-big boom', '💥 펑!'), el('div', 'qs-status', `${who(c, cv.lastBoom.id)} 폭발! 단어 ${cv.lastBoom.count}개가 오갔어요`));
      }
      if (cv.used.length) {
        const list = el('div', 'qc-chips');
        for (const u of cv.used.slice().reverse().slice(0, 30)) {
          const chip = el('span', 'qc-chip' + (u.by === c.me.id ? ' mine' : ''), u.word);
          chip.title = c.nameOf(u.by);
          list.append(chip);
        }
        card.append(el('div', 'qs-label', `나온 단어 ${cv.used.length}개`), list);
      }
      root.append(card);
      if (cv.step === 'play' && mine) {
        root.append(inputBar(c, { placeholder: `${cv.topic ? cv.topic.name : '단어'} 입력 (채팅으로 보내져요)`, keep: 'bombWord', onSubmit: (t) => c.say(t) }));
      }
    },
    tick(c, cv) {
      B.c = c;
      if (cv.step === 'play') startTicking();
      else stopTicking();
      if (cv.step === 'boom' && cv.lastBoom && B.boomKey !== `${cv.no}`) {
        B.boomKey = `${cv.no}`;
        Q.sfx('boom');
        if (cv.lastBoom.id === c.me.id) setTimeout(() => Q.sfx('fail'), 700);
      }
      const mine = cv.step === 'play' && cv.holderId === c.me.id;
      const key = `${cv.no}:${cv.used.length}`;
      if (!mine) {
        if (B.listenKey) {
          B.listenKey = null;
          Q.stopListening();
          resetCV();
        }
        return;
      }
      if (B.listenKey === key) return;
      B.listenKey = key;
      resetCV();
      if (!canTalk()) return;
      Q.sfx('turn');
      setTimeout(() => bombListen(key), 350);
    },
    leave() {
      stopTicking();
      if (B.listenKey) Q.stopListening();
      B.listenKey = null;
      resetCV();
    },
  };

  // ───────────────── 🔔 생존 퀴즈
  const S = { revealKey: null, qKey: null };
  const survUI = {
    progress: (cv) => (cv.n ? `문제 ${cv.n}/${cv.total}` : ''),
    tags(c, cv, id) {
      if (!(id in cv.lives)) return [];
      const l = cv.lives[id];
      if (l <= 0) return [{ text: '탈락', cls: 'out' }];
      const t = [{ text: '❤️'.repeat(l), cls: 'life' }];
      if (cv.step === 'question' && cv.answered.includes(id)) t.push({ text: '✓ 답함', cls: 'pass' });
      return t;
    },
    render(root, c, cv) {
      const { el } = c;
      const q = cv.question;
      if (!q) return;
      const alive = cv.me.alive;
      if (cv.step === 'question') {
        const card = el('div', 'qs-card qc-card qc-surv');
        card.append(Q.promptBlock(c, q), Q.tiles(c, q.tiles, true));
        if (q.hints && q.hints.length) {
          const hs = el('div', 'qs-hints');
          for (const h of q.hints) hs.append(el('div', null, `💡 ${h}`));
          card.append(hs);
        }
        const inGame = Object.keys(cv.lives).filter((id) => cv.lives[id] > 0 && c.player(id) && !c.player(id).left).length;
        card.append(el('div', 'qs-status', `🔔 모두 함께! 답은 다른 사람에게 안 보여요 · 답한 사람 ${cv.answered.length}/${inGame}`));
        if (cv.me.inGame) card.append(el('div', 'qc-lives', `내 목숨 ${hearts(cv.lives[c.me.id] || 0, cv.maxLives)}`));
        if (cv.mine) card.append(el('div', 'qc-mine', `내 답: ${cv.mine} (시간 안에 바꿀 수 있어요)`));
        if (alive) card.append(voiceLine());
        else if (cv.me.inGame) card.append(el('div', 'qc-out', '탈락 — 구경하며 속으로 맞혀 보세요 😢'));
        root.append(card);
        if (alive) {
          const send = async (texts, voice) => {
            const res = await c.act('answer', { texts, voice: !!voice });
            if (res && res.ok) setCV({ mode: 'done', heard: res.heard, interim: '' });
            return res;
          };
          root.append(inputBar(c, { placeholder: '정답 입력 — 다른 사람에게 안 보여요', keep: 'survAnswer', onSubmit: (t) => send([t]), mic: true, onVoice: (alts) => send(alts, true) }));
        }
      } else if (cv.step === 'reveal' && cv.reveal) {
        const r = cv.reveal;
        const card = el('div', 'qs-card reveal qc-card qc-surv');
        card.append(Q.promptBlock(c, q), el('div', 'qs-label', '정답'), Q.tiles(c, q.tiles, true));
        if (r.note) card.append(el('div', 'qs-note', r.note));
        if (r.allWrong) card.append(el('div', 'qs-status', '😅 모두 틀려서 이번 문제는 없던 걸로!'));
        const list = el('div', 'qc-rows');
        const rows = r.rows.slice().sort((a, b) => Number(b.ok) - Number(a.ok));
        for (const row of rows) {
          const line = el('div', 'qc-row' + (row.ok ? ' ok' : ' no') + (row.id === c.me.id ? ' me' : ''));
          line.append(el('span', 'qc-row-name', c.nameOf(row.id)), el('span', 'qc-row-text', row.text || '(못 씀)'));
          line.append(el('span', 'qc-row-mark', row.ok ? '✅ ⭐' : row.out ? '💀 탈락' : row.lost ? '❤️ -1' : '—'));
          list.append(line);
        }
        card.append(list);
        root.append(card);
      }
    },
    tick(c, cv) {
      if (cv.step === 'question' && S.qKey !== `${cv.n}`) {
        S.qKey = `${cv.n}`;
        resetCV();
      }
      if (cv.step === 'reveal' && cv.reveal && S.revealKey !== `${cv.n}`) {
        S.revealKey = `${cv.n}`;
        Q.stopListening();
        const mine = cv.reveal.rows.find((r) => r.id === c.me.id);
        if (mine) Q.sfx(mine.ok ? 'pass' : mine.out ? 'fail' : mine.lost ? 'wrong' : 'tick');
      }
    },
    leave() {
      S.qKey = null;
      resetCV();
    },
  };

  // ───────────────── 💞 이구동성
  const P = { revealKey: null, qKey: null };
  const teleUI = {
    progress: (cv) => (cv.n ? `질문 ${cv.n}/${cv.total}` : ''),
    tags(c, cv, id) {
      return cv.step === 'ask' && cv.answered.includes(id) ? [{ text: '✓ 답함', cls: 'pass' }] : [];
    },
    render(root, c, cv) {
      const { el } = c;
      const card = el('div', 'qs-card qc-card qc-tele ' + cv.step);
      card.append(el('div', 'qc-prompt', cv.prompt || ''));
      if (cv.step === 'ask') {
        const total = c.play.participants.filter((id) => c.player(id) && !c.player(id).left).length;
        card.append(el('div', 'qs-status', `💞 한 단어로 몰래! 다른 사람과 같으면 별 · 답한 사람 ${cv.answered.length}/${total}`));
        if (cv.mine) card.append(el('div', 'qc-mine', `내 답: ${cv.mine}`));
        card.append(voiceLine());
        root.append(card);
        const send = async (texts) => {
          const res = await c.act('answer', { texts });
          if (res && res.ok) setCV({ mode: 'done', heard: res.heard, interim: '' });
          return res;
        };
        root.append(inputBar(c, { placeholder: '한 단어로 답하기 — 다른 사람에게 안 보여요', keep: 'teleAnswer', onSubmit: (t) => send([t]), mic: true, onVoice: (alts) => send(alts.slice(0, 1)) }));
      } else if (cv.step === 'reveal' && cv.reveal) {
        const list = el('div', 'qc-groups');
        for (const g of cv.reveal.groups) {
          const row = el('div', 'qc-group' + (g.ids.length >= 2 ? ' match' : '') + (g.ids.includes(c.me.id) ? ' me' : ''));
          row.append(el('span', 'qc-group-text', g.text), el('span', 'qc-group-n', `${g.ids.length}명`), el('span', 'qc-group-stars', g.stars ? '⭐'.repeat(g.stars) : ''));
          row.append(namesRow(c, g.ids));
          list.append(row);
        }
        if (cv.reveal.none.length) list.append(el('div', 'qc-none', `답 안 함: ${cv.reveal.none.map((id) => c.nameOf(id)).join(', ')}`));
        card.append(list);
        root.append(card);
      }
    },
    tick(c, cv) {
      if (cv.step === 'ask' && P.qKey !== `${cv.n}`) {
        P.qKey = `${cv.n}`;
        resetCV();
      }
      if (cv.step === 'reveal' && cv.reveal && P.revealKey !== `${cv.n}`) {
        P.revealKey = `${cv.n}`;
        Q.stopListening();
        const g = cv.reveal.groups.find((x) => x.ids.includes(c.me.id));
        if (g && g.ids.length >= 2) Q.sfx('pass');
      }
    },
    leave() {
      P.qKey = null;
      resetCV();
    },
  };

  // ───────────────── 🎌 청기백기
  const F = { pending: {}, judgeKey: null, c: null, cv: null };
  function flagState(cv) {
    const s = Object.assign({ blue: false, white: false }, cv.mine || {});
    for (const [k, v] of Object.entries(F.pending)) s[k] = v;
    return s;
  }
  function toggleFlag(which) {
    const c = F.c;
    const cv = F.cv;
    if (!c || !cv || !cv.me.alive || cv.step === 'done') return;
    const up = !flagState(cv)[which];
    F.pending[which] = up;
    Q.unlock();
    Q.sfx('flag');
    paintFlags();
    c.act('flag', { which, up });
  }
  function flagButtons() {
    const cv = F.cv;
    const s = flagState(cv);
    const box = mk('div', 'qc-flags');
    box.id = 'qcFlags';
    for (const [which, name, color] of [['blue', '청기', 'blue'], ['white', '백기', 'white']]) {
      const b = mk('button', `qc-flag ${color}${s[which] ? ' up' : ''}`);
      b.type = 'button';
      b.disabled = !cv.me.alive;
      const art = mk('span', 'qc-flagart');
      art.append(mk('i', 'qc-pole'), mk('i', 'qc-cloth'));
      b.append(art, mk('b', null, name), mk('small', null, s[which] ? '⬆ 올림' : '⬇ 내림'));
      b.onclick = () => toggleFlag(which);
      box.append(b);
    }
    return box;
  }
  function paintFlags() {
    const old = document.getElementById('qcFlags');
    if (old && F.cv) old.replaceWith(flagButtons());
  }
  document.addEventListener('keydown', (e) => {
    if (!F.cv || !F.c || F.c.play.stage !== 'corner' || !F.c.play.corner || F.c.play.corner.kind !== 'flags') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      toggleFlag('blue');
    } else if (e.key === 'ArrowRight' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      toggleFlag('white');
    }
  });
  const flagsUI = {
    progress: (cv) => (cv.n ? `명령 ${cv.n}/${cv.total}` : ''),
    tags(c, cv, id) {
      if (!(id in cv.lives)) return [];
      const l = cv.lives[id];
      if (l <= 0) return [{ text: '탈락', cls: 'out' }];
      const t = [{ text: '❤️'.repeat(l), cls: 'life' }];
      if (cv.step === 'judge' && cv.judge && cv.judge.wrong.includes(id)) t.push({ text: '❌', cls: 'boom' });
      return t;
    },
    render(root, c, cv) {
      const { el } = c;
      F.c = c;
      F.cv = cv;
      // 서버가 받은 상태가 기다리던 것과 같으면 기다림 끝
      for (const [k, v] of Object.entries(F.pending)) if (cv.mine && cv.mine[k] === v) delete F.pending[k];
      const card = el('div', 'qs-card qc-card qc-flagcard ' + cv.step);
      if (cv.step === 'ready') card.append(el('div', 'qc-cmd', '깃발 준비!'), el('div', 'qs-status', '둘 다 내리고 시작해요 · 명령이 들리면 깃발을 올리고 내리세요 (← 청기 · → 백기)'));
      else if (cv.cmd) card.append(el('div', 'qc-cmd' + (cv.step === 'judge' ? ' judged' : ''), cv.cmd));
      if (cv.step === 'judge' && cv.judge) {
        const ex = cv.judge.expected;
        card.append(el('div', 'qc-expect', `정답: 청기 ${ex.blue ? '⬆' : '⬇'} · 백기 ${ex.white ? '⬆' : '⬇'}`));
        const mineWrong = cv.judge.wrong.includes(c.me.id);
        if (cv.me.inGame) card.append(el('div', 'qc-result ' + (mineWrong ? 'no' : 'ok'), mineWrong ? (cv.judge.out.includes(c.me.id) ? '💀 탈락!' : '❌ 틀렸어요 — 깃발을 바로잡았어요') : '⭕ 통과!'));
        if (cv.judge.wrong.length) card.append(el('div', 'qs-status', `틀린 사람: ${cv.judge.wrong.map((id) => c.nameOf(id)).join(', ')}`));
      }
      if (cv.me.inGame) card.append(el('div', 'qc-lives', `내 목숨 ${hearts(cv.lives[c.me.id] || 0, cv.maxLives)}`));
      if (cv.me.inGame && !cv.me.alive) card.append(el('div', 'qc-out', '탈락 — 구경하며 같이 해 보세요!'));
      root.append(card);
      if (cv.me.inGame) root.append(flagButtons());
    },
    tick(c, cv) {
      F.c = c;
      F.cv = cv;
      if (cv.step === 'cmd') F.judgeKey = null;
      if (cv.step === 'judge' && cv.judge && F.judgeKey !== `${cv.n}`) {
        F.judgeKey = `${cv.n}`;
        F.pending = {};
        if (cv.judge.out.includes(c.me.id)) Q.sfx('fail');
        else if (cv.judge.wrong.includes(c.me.id)) Q.sfx('wrong');
      }
    },
    leave() {
      F.pending = {};
      F.cv = null;
    },
  };

  // ───────────────── 👅 잰말놀이
  const W = { key: null, start: 0, scoreKey: null, c: null, typedStart: 0, fallback: null };
  function twisterListen(key) {
    if (W.key !== key) return;
    let t0 = 0;
    setCV({ mode: 'listening', interim: '', heard: '', note: '' });
    listenStarted(key);
    Q.listen(
      async (alts) => {
        if (W.key !== key) return;
        const end = Date.now();
        const secs = t0 ? Math.max(0.5, (end - t0) / 1000 - 0.6) : undefined; // 말이 끝난 걸 알아차리는 시간만큼 빼고
        setCV({ mode: 'checking', heard: alts[0], interim: '' });
        const res = await W.c.act('twister', { text: alts[0], secs, voice: true });
        if (res && res.ok) {
          Q.sfx(res.acc >= 85 ? 'pass' : 'wrong');
          setCV({ mode: 'done', note: `정확도 ${res.acc}% · ${res.secs}초` });
        }
      },
      () => {
        if (W.key === key) relisten(key, () => twisterListen(key), () => twisterFallback(key, '말이 잘 안 들려요 — 입력칸에 빠르게 써 주세요.'));
      },
      () => twisterFallback(key, '듣기를 시작하지 못했어요 — 입력칸에 빠르게 써 주세요.'),
      {
        onSpeechStart: () => {
          t0 = Date.now();
        },
        onInterim: (t) => setCV({ interim: t }),
        onBlocked: (err) => twisterFallback(key, Q.blockedNote(err)),
      }
    );
  }
  /** 말로 할 수 없으면 입력칸으로 (시간은 차례가 시작된 때부터) */
  function twisterFallback(key, note) {
    if (W.key !== key) return;
    setCV({ mode: 'idle', note });
    W.fallback = key;
    const slot = document.getElementById('qcTwTyped');
    if (slot && !slot.children.length && W.c) slot.append(twisterInput(W.c));
  }
  function twisterInput(c) {
    return inputBar(c, {
      placeholder: '문장을 그대로 빠르게 입력하세요',
      keep: 'twisterText',
      onSubmit: async (t) => {
        const res = await c.act('twister', { text: t, secs: (Date.now() - W.typedStart) / 1000 });
        if (res && res.ok) Q.sfx(res.acc >= 85 ? 'pass' : 'wrong');
        return res;
      },
    });
  }
  const twisterUI = {
    progress: (cv) => (cv.setNo ? `문장 ${cv.setNo}/${cv.sets}` : ''),
    tags(c, cv, id) {
      if (cv.step === 'turn' && cv.turnId === id) return [{ text: '차례', cls: 'turn' }];
      const r = cv.results.find((x) => x.id === id);
      return r ? [{ text: `${r.acc}%`, cls: r.acc >= cv.pass ? 'pass' : '' }] : [];
    },
    render(root, c, cv) {
      const { el } = c;
      W.c = c;
      const card = el('div', 'qs-card qc-card qc-twister ' + cv.step);
      const label = cv.step === 'demo' ? '🎤 사회자 시범' : `👅 문장 ${cv.setNo}/${cv.sets}`;
      card.append(el('div', 'qs-label', label), el('div', 'qc-sentence', cv.sentence || ''));
      const mine = cv.step === 'turn' && cv.me.turn;
      if (cv.step === 'turn') {
        card.append(el('div', 'qc-holder' + (mine ? ' mine' : ''), mine ? '내 차례! 빠르고 정확하게 말해 보세요!' : `${c.nameOf(cv.turnId)}님 차례 — 조용히 들어 주세요 🤫`));
        if (mine) card.append(voiceLine());
      } else if (cv.step === 'set' && cv.best) {
        card.append(el('div', 'qc-big', `👑 잰말왕: ${c.nameOf(cv.best.id)}`), el('div', 'qs-status', `정확도 ${cv.best.acc}% · ${cv.best.secs}초`));
      } else if (cv.step === 'set') card.append(el('div', 'qs-status', '이번 문장은 아무도 성공하지 못했어요 😅'));
      if (cv.results.length) {
        const list = el('div', 'qc-rows');
        for (const r of cv.results) {
          const line = el('div', 'qc-row' + (r.acc >= cv.pass ? ' ok' : ' no') + (r.id === c.me.id ? ' me' : ''));
          line.append(el('span', 'qc-row-name', c.nameOf(r.id)), el('span', 'qc-row-text', r.text || '(시간 초과)'), el('span', 'qc-row-mark', `${r.acc}%${r.secs ? ` · ${r.secs}초` : ''}`));
          list.append(line);
        }
        card.append(list);
      }
      const waiting = cv.order.filter((id) => !cv.results.some((r) => r.id === id));
      if (waiting.length && cv.step !== 'set') card.append(el('div', 'qc-none', `남은 차례: ${waiting.map((id) => c.nameOf(id)).join(' → ')}`));
      root.append(card);
      if (mine) {
        // 음성 모드면 듣기가 안 될 때만 입력칸이 나타난다 (그 자리)
        const slot = el('div', 'qc-tw-typed');
        slot.id = 'qcTwTyped';
        if (!canTalk() || W.fallback === `${cv.setNo}:${cv.results.length}`) slot.append(twisterInput(c));
        root.append(slot);
      }
    },
    tick(c, cv) {
      W.c = c;
      const mine = cv.step === 'turn' && cv.me.turn;
      const key = `${cv.setNo}:${cv.results.length}`;
      if (!mine) {
        if (W.key) {
          W.key = null;
          Q.stopListening();
        }
        return;
      }
      if (W.key === key) return;
      W.key = key;
      W.typedStart = Date.now();
      resetCV();
      if (!canTalk()) return;
      Q.sfx('turn');
      setTimeout(() => twisterListen(key), 400);
    },
    leave() {
      if (W.key) Q.stopListening();
      W.key = null;
      resetCV();
    },
  };

  // ───────────────── 🙊 설명하고 맞히기
  const X = { capKey: null, lines: [], capOn: true, autoOff: false, running: null, c: null, gotN: 0, buzzN: 0, wordKey: null };
  const tabooKey = (cv) => `${cv.idx}:${cv.got.length}:${cv.skipped.length}:${cv.buzzes.length}`;
  function captionStop() {
    if (X.running) {
      X.running = null;
      Q.stopListening();
    }
  }
  function captionStart(key) {
    if (X.running === key) return;
    X.running = key;
    setCV({ mode: 'captions', interim: '', note: CV.note });
    listenStarted(`taboo:${key}`);
    const again = () => {
      if (X.running !== key) return;
      relisten(
        `taboo:${key}`,
        () => {
          if (X.running !== key) return;
          X.running = null;
          captionStart(key);
        },
        () => {
          X.capOn = false; // 이번 설명은 채팅으로 (다음 설명 차례에는 다시 켜 본다)
          X.autoOff = true;
          X.running = null;
          setCV({ mode: 'idle', interim: '', note: '말이 잘 안 들려요 — 채팅으로 설명해 주세요.' });
        }
      );
    };
    Q.listen(
      () => again(),
      () => again(),
      () => {
        X.running = null;
        setCV({ mode: 'idle', note: '말로 설명을 시작하지 못했어요 — 채팅으로 써 주세요.' });
      },
      {
        continuous: true,
        onInterim: (t) => setCV({ interim: t }),
        onPhrase: async (alts) => {
          setCV({ interim: '' });
          const res = await X.c.act('caption', { text: alts[0] });
          if (res && res.blocked) setCV({ note: `🚫 「${res.hit}」 금지어! 다음 단어로 넘어갔어요` });
        },
        onBlocked: (err) => {
          X.capOn = false;
          X.autoOff = true;
          X.running = null;
          setCV({ mode: 'idle', note: Q.blockedNote(err) });
        },
      }
    );
  }
  const tabooUI = {
    progress: (cv) => (cv.explainerId ? `설명 ${cv.idx + 1}/${cv.order.length}` : ''),
    tags(c, cv, id) {
      if (cv.explainerId === id && (cv.step === 'explain' || cv.step === 'ready')) return [{ text: '설명', cls: 'turn' }];
      const n = cv.got.filter((g) => g.by === id).length;
      return n ? [{ text: `✅${n}`, cls: 'pass' }] : [];
    },
    onChat(c, m, cv) {
      if (m.kind !== 'explain' || m.from !== cv.explainerId) return;
      const key = tabooKey(cv);
      if (X.capKey !== key) {
        X.capKey = key;
        X.lines = [];
      }
      X.lines.push(m.text);
      if (X.lines.length > 5) X.lines.shift();
      const box = document.getElementById('qcCaps');
      if (box) box.replaceWith(captions(cv));
    },
    render(root, c, cv) {
      const { el } = c;
      X.c = c;
      const me = cv.me.explainer;
      const card = el('div', 'qs-card qc-card qc-taboo ' + cv.step);
      if (cv.step === 'ready') {
        card.append(el('div', 'qc-big', '🙊 다음 설명'), el('div', 'qc-holder' + (me ? ' mine' : ''), me ? '내 차례! 곧 단어가 나와요' : `${c.nameOf(cv.explainerId)}님이 설명해요`));
        card.append(el('div', 'qs-status', me ? '말로(🎙️) 또는 채팅으로 설명하세요. 단어 일부나 금지어를 말하면 삐빅!' : '설명을 듣고 채팅이나 🎤로 먼저 맞히면 별!'));
      } else if (cv.step === 'explain') {
        if (me && cv.word) {
          card.append(el('div', 'qs-label', '설명할 단어'), el('div', 'qc-word', cv.word.text));
          const tb = el('div', 'qc-taboos');
          tb.append(el('span', 'qc-taboo-label', '🚫 금지어'));
          for (const w of cv.word.taboo) tb.append(el('span', 'qc-chip no', w));
          tb.append(el('span', 'qc-chip no', `${cv.word.text} (일부도)`));
          card.append(tb);
          const btns = el('div', 'qv-btns');
          if (canTalk()) {
            const mic = el('button', 'btn small' + (X.capOn ? ' primary' : ''), X.capOn ? '🎙️ 말로 설명: 켜짐' : '🎙️ 말로 설명: 꺼짐');
            mic.type = 'button';
            mic.onclick = () => {
              X.capOn = !X.capOn;
              if (!X.capOn) {
                captionStop();
                setCV({ mode: 'idle', interim: '' });
              }
              c.toast(X.capOn ? '말로 설명해요 — 모두에게 자막으로 보여요' : '말로 설명 끔 — 채팅으로 써 주세요');
              tabooUI.tick(c, cv);
            };
            btns.append(mic);
          }
          const skip = el('button', 'btn small', '⏭ 패스');
          skip.type = 'button';
          skip.onclick = () => c.act('skip');
          btns.append(skip);
          card.append(btns, voiceLine());
        } else {
          card.append(el('div', 'qc-topic', `🗂️ 주제: ${cv.cat || '?'}`), el('div', 'qc-holder', `${c.nameOf(cv.explainerId)}님이 설명 중`), captions(cv));
        }
      } else if (cv.step === 'done' && cv.summary) {
        card.append(el('div', 'qc-big', `🙊 ${c.nameOf(cv.summary.id)}님 설명 끝!`), el('div', 'qs-status', `${cv.summary.got}개 성공${cv.summary.last ? ` · 마지막 단어는 「${cv.summary.last}」` : ''}`));
      }
      if (cv.got.length || cv.skipped.length || cv.buzzes.length) {
        const list = el('div', 'qc-chips');
        for (const g of cv.got) list.append(el('span', 'qc-chip ok', `✅ ${g.word} · ${c.nameOf(g.by)}`));
        for (const w of cv.skipped) list.append(el('span', 'qc-chip', `⏭ ${w}`));
        for (const b of cv.buzzes) list.append(el('span', 'qc-chip no', `🚫 ${b.word} (${b.hit})`));
        card.append(list);
      }
      root.append(card);
      if (cv.step === 'explain') {
        if (me) root.append(inputBar(c, { placeholder: '설명 쓰기 (채팅) — 금지어 조심!', keep: 'tabooExplain', onSubmit: (t) => c.say(t) }));
        else {
          const guess = async (alts) => {
            const res = await c.act('voice', { texts: alts });
            if (res && res.ok) setCV({ mode: res.correct ? 'done' : 'idle', heard: res.heard, note: res.correct ? '' : '아니에요 — 다시!' });
            return res;
          };
          root.append(inputBar(c, { placeholder: '정답 입력 (채팅으로 보내져요)', keep: 'tabooGuess', onSubmit: (t) => c.say(t), mic: true, onVoice: guess }));
          root.append(voiceLine());
        }
      }
    },
    tick(c, cv) {
      X.c = c;
      // 정답·삐빅 소리 (모두)
      if (X.gotKey !== `${cv.idx}`) {
        X.gotKey = `${cv.idx}`;
        X.gotN = cv.got.length;
        X.buzzN = cv.buzzes.length;
        if (X.autoOff) {
          X.autoOff = false;
          X.capOn = true; // 저절로 꺼졌던 말로 설명은 새 차례에 다시
        }
      }
      if (cv.got.length > X.gotN) Q.sfx('pass');
      if (cv.buzzes.length > X.buzzN) Q.sfx('wrong');
      X.gotN = cv.got.length;
      X.buzzN = cv.buzzes.length;
      const key = tabooKey(cv);
      if (X.wordKey !== key) {
        X.wordKey = key;
        if (!cv.me.explainer) resetCV();
      }
      // 설명하는 사람: 말로 설명(자막) 켜기
      const explaining = cv.step === 'explain' && cv.me.explainer;
      if (explaining && X.capOn && canTalk()) captionStart(`${cv.idx}`);
      else captionStop();
      if (!explaining && CV.mode === 'captions') resetCV();
    },
    leave() {
      captionStop();
      X.lines = [];
      X.capKey = null;
      resetCV();
    },
  };
  function captions(cv) {
    const box = mk('div', 'qc-caps');
    box.id = 'qcCaps';
    const lines = X.capKey === tabooKey(cv) ? X.lines : [];
    if (!lines.length) box.append(mk('div', 'qc-cap empty', '설명을 기다리는 중…'));
    for (const t of lines) box.append(mk('div', 'qc-cap', `💬 ${t}`));
    return box;
  }

  Object.assign(Q.corners, { bomb: bombUI, survival: survUI, telepathy: teleUI, flags: flagsUI, twister: twisterUI, taboo: tabooUI });
})();
