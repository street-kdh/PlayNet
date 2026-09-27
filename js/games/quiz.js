/* PlayNet — 예능 퀴즈쇼 화면 */
(() => {
  'use strict';

  const STAGE_ICON = { intro: '🎤', roundIntro: '📣', question: '❓', steal: '🔥', reveal: '💡', roundEnd: '📊', finale: '🥁', end: '🏆' };
  const MODE_LABEL = { speed: '빨리 맞히기', turn: '차례 릴레이' };
  const LEVELS = [['easy', '약하게'], ['normal', '보통'], ['hard', '강하게']];
  const LEVEL_NOTE = {
    easy: 'AI가 자주 모르고 느려요. 처음 해 보는 분이나 어린이와 함께할 때.',
    normal: 'AI가 보통 사람만큼 알고, 비슷한 속도로 답해요.',
    hard: 'AI가 많이 알고 빨라요. 퀴즈에 자신 있는 분께.',
  };

  function seg(el, options, value, disabled, onPick) {
    const box = el('div', 'seg');
    for (const [v, label] of options) {
      const b = el('button', v === value ? 'on' : '', label);
      b.type = 'button';
      b.disabled = disabled;
      if (!disabled && v !== value) b.onclick = () => onPick(v);
      box.append(b);
    }
    return box;
  }

  // ───────────────── 대기실 설정
  function renderSettings(panel, c) {
    const { el, isHost, info } = c;
    const s = c.state.settings;
    if (!info) return;

    const sec1 = el('div', 'set-section');
    sec1.append(el('div', 'set-title', '라운드 구성'));
    const list = el('div', 'qs-round-opts');
    const on = new Set(s.rounds);
    for (const r of info.rounds) {
      const row = el('label', 'qs-round-opt' + (on.has(r.id) ? ' on' : ''));
      const cb = el('input');
      cb.type = 'checkbox';
      cb.dataset.id = r.id;
      cb.checked = on.has(r.id);
      cb.disabled = !isHost || (on.has(r.id) && on.size === 1);
      cb.onchange = () => {
        // 화면의 체크 상태 그대로 (연달아 눌러도 앞의 선택이 되돌아가지 않도록)
        const ids = [...list.querySelectorAll('input[type=checkbox]')].filter((x) => x.checked).map((x) => x.dataset.id);
        if (!ids.length) {
          cb.checked = true;
          return c.toast('라운드를 하나 이상 골라 주세요.', true);
        }
        row.classList.toggle('on', cb.checked);
        c.update({ rounds: ids });
      };
      const txt = el('span', 'qro-text');
      txt.append(el('b', null, `${r.icon} ${r.name}`), el('small', null, r.desc));
      row.append(cb, txt, el('span', 'qro-mode ' + r.mode, MODE_LABEL[r.mode]));
      list.append(row);
    }
    sec1.append(list);
    panel.append(sec1);

    const sec2 = el('div', 'set-section');
    const row1 = el('div', 'set-title');
    row1.append(el('span', null, '라운드당 문제'));
    row1.append(seg(el, [[3, '3'], [5, '5'], [7, '7'], [10, '10']], s.questions, !isHost, (v) => c.update({ questions: v })));
    sec2.append(row1);
    const row2 = el('div', 'set-title');
    row2.append(el('span', null, '문제당 시간'));
    row2.append(seg(el, [[15, '15초'], [20, '20초'], [30, '30초']], s.seconds, !isHost, (v) => c.update({ seconds: v })));
    sec2.append(row2);
    sec2.append(el('p', 'set-note', '사자성어 릴레이는 사람마다 한 문제씩(시간은 조금 짧게), 못 맞히면 다른 사람이 가로챌 수 있어요.'));
    panel.append(sec2);

    const sec3 = el('div', 'set-section');
    const sw = el('label', 'switch');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = s.doubleLast;
    cb.disabled = !isHost;
    cb.onchange = () => c.update({ doubleLast: cb.checked });
    sw.append(cb, el('span', null, '마지막 라운드는 별 2배'));
    sec3.append(sw);
    const row3 = el('div', 'set-title');
    row3.style.marginTop = '12px';
    row3.append(el('span', null, 'AI 실력'));
    row3.append(seg(el, LEVELS, s.botLevel, !isHost, (v) => c.update({ botLevel: v })));
    sec3.append(row3);
    sec3.append(el('p', 'set-note', LEVEL_NOTE[s.botLevel] || ''));
    panel.append(sec3);
  }

  // ───────────────── 공통 조각
  function hostBubble(c) {
    const { el, play } = c;
    const b = el('div', 'qs-host');
    b.append(el('span', 'qs-mic', '🎤'));
    const t = el('div', 'qs-host-text');
    t.append(el('b', null, play.host || 'MC'), el('span', null, play.hostLine || '잠시 후 시작합니다!'));
    b.append(t);
    return b;
  }

  function strip(c) {
    const { el, play } = c;
    const r = play.round;
    const s = el('div', 'qs-strip');
    const total = play.rounds.length;
    if (play.stage === 'finale' || play.stage === 'end') s.append(el('span', 'qs-rnd', '최종 결과'), el('span', 'qs-rname', `총 ${total}라운드`));
    else if (r) {
      s.append(el('span', 'qs-rnd', `ROUND ${play.roundIndex + 1}/${total}`), el('span', 'qs-rname', `${r.icon} ${r.name}`));
      if (play.qTotal && ['question', 'steal', 'reveal'].includes(play.stage)) s.append(el('span', 'qs-qn', `문제 ${play.qIndex}/${play.qTotal}`));
      if (r.double) s.append(el('span', 'qs-double', '⭐×2'));
    } else s.append(el('span', 'qs-rnd', `총 ${total}라운드`));
    return s;
  }

  function tiles(c, list, big) {
    const { el } = c;
    const row = el('div', 'qs-tiles' + (big ? ' big' : ''));
    let word = el('span', 'qs-word');
    for (const t of list) {
      if (t.k === 'space') {
        row.append(word);
        word = el('span', 'qs-word');
        continue;
      }
      word.append(el('span', 'qs-tile ' + t.k, t.t));
    }
    row.append(word);
    return row;
  }

  function promptBlock(c, q) {
    const { el } = c;
    const box = el('div', 'qs-prompt');
    switch (q.kind) {
      case 'chosung':
        box.append(el('span', 'qs-chip', `${q.category.icon} ${q.category.name}`));
        break;
      case 'person': {
        box.append(el('div', 'qs-label', '이 사람은 누구일까요?'));
        const ul = el('ul', 'qs-clues');
        for (const clue of q.clues || []) ul.append(el('li', null, clue));
        box.append(ul);
        break;
      }
      case 'song':
        box.append(el('div', 'qs-label', '이 노래 제목은?'), el('div', 'qs-artist', `🎤 ${q.artist}${q.year ? ` · ${q.year}` : ''}`));
        break;
      case 'idiom':
        box.append(el('div', 'qs-label', '앞 두 글자를 보고 뒤 두 글자를!'));
        if (q.meaning) box.append(el('div', 'qs-meaning', `뜻: ${q.meaning}`));
        break;
      case 'proverb':
        box.append(el('div', 'qs-label', '속담을 완성하세요'), el('div', 'qs-front', `${q.front} …`));
        break;
      case 'nonsense':
        box.append(el('div', 'qs-label', '넌센스 퀴즈'), el('div', 'qs-front', q.text));
        break;
      default:
        break;
    }
    return box;
  }

  function scoreboard(c) {
    const { el, ui, play } = c;
    const box = el('div', 'qs-scores');
    const passed = new Set(play.passed || []);
    const rows = play.participants
      .map((id) => ({ id, stars: play.scores[id] || 0, round: play.roundScores[id] || 0, streak: play.streaks[id] || 0 }))
      .sort((a, b) => b.stars - a.stars);
    let rank = 0;
    rows.forEach((r, i) => {
      if (i === 0 || r.stars !== rows[i - 1].stars) rank = i + 1;
      const p = c.player(r.id) || { id: r.id, name: '?' };
      const li = el('div', 'qs-score' + (r.id === c.me.id ? ' me' : '') + (p.left ? ' left' : '') + (play.turnId === r.id ? ' turn' : ''));
      li.append(el('span', 'qs-rank', rank === 1 && r.stars > 0 ? '👑' : `${rank}`), ui.avatar(p, 28));
      const nm = el('span', 'qs-name', p.name + (r.id === c.me.id ? ' (나)' : ''));
      li.append(nm);
      const tags = el('span', 'qs-tags');
      const live = play.stage !== 'end' && play.stage !== 'finale';
      if (play.turnId === r.id && ['question', 'steal'].includes(play.stage)) tags.append(el('span', 'qs-tag turn', play.stage === 'steal' ? '쉬는 중' : '차례'));
      if (live && passed.has(r.id)) tags.append(el('span', 'qs-tag pass', '패스'));
      if (live && r.streak >= 2) tags.append(el('span', 'qs-tag fire', `🔥${r.streak}`));
      if (p.left) tags.append(el('span', 'qs-tag', '나감'));
      li.append(tags);
      const st = el('span', 'qs-stars');
      st.append(el('b', null, `⭐ ${r.stars}`));
      if (r.round && play.stage !== 'end') st.append(el('small', null, ` +${r.round}`));
      li.append(st);
      box.append(li);
    });
    return box;
  }

  /** 답 입력 (채팅으로 보냄) + 패스 */
  function answerBar(c, canAnswer, canPass, placeholder) {
    const { el, play } = c;
    const form = el('form', 'qs-answer');
    const input = el('input');
    input.maxLength = 60;
    input.placeholder = placeholder;
    input.dataset.keep = 'quizAnswer';
    input.autocomplete = 'off';
    input.enterKeyHint = 'send';
    input.disabled = !canAnswer;
    const send = el('button', 'btn primary', '보내기');
    send.type = 'submit';
    send.disabled = !canAnswer;
    form.append(input, send);
    if (canPass) {
      const pass = el('button', 'btn' + (play.me && play.me.passed ? ' selected' : ''), play.me && play.me.passed ? '✓ 패스함' : '패스');
      pass.type = 'button';
      pass.disabled = !!(play.me && play.me.passed);
      pass.onclick = () => c.act('pass');
      form.append(pass);
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const res = await c.say(text);
      if (res && res.ok === false) input.value = text;
      input.focus();
    };
    return form;
  }

  // ───────────────── 화면
  function render(root, c) {
    const { el, ui, play } = c;
    const me = play.me;
    const q = play.question;
    root.append(hostBubble(c), strip(c));

    if (play.stage === 'intro') {
      const box = el('div', 'qs-lineup');
      box.append(el('div', 'qs-lineup-title', '오늘의 라인업'));
      const ol = el('ol');
      play.rounds.forEach((r, i) => {
        const li = el('li');
        li.append(el('span', 'qs-lu-icon', r.icon), el('span', null, r.name));
        if (play.doubleLast && i === play.rounds.length - 1 && play.rounds.length > 1) li.append(el('span', 'qs-double', '⭐×2'));
        ol.append(li);
      });
      box.append(ol, el('p', 'qs-lineup-note', '정답은 채팅으로! 가장 먼저 맞히면 별 ⭐ · 꼴찌는 벌칙 😆'));
      root.append(box);
    } else if (play.stage === 'roundIntro' && play.round) {
      const r = play.round;
      const card = el('div', 'qs-round-card');
      card.append(el('div', 'qs-rc-icon', r.icon), el('div', 'qs-rc-n', `ROUND ${play.roundIndex + 1}`), el('div', 'qs-rc-name', r.name), el('div', 'qs-rc-desc', r.desc));
      const meta = el('div', 'qs-rc-meta');
      meta.append(el('span', 'qro-mode ' + r.mode, MODE_LABEL[r.mode]), el('span', null, r.points > 1 ? '정답마다 별 2개 ⭐⭐' : '정답마다 별 1개 ⭐'));
      card.append(meta);
      if (play.turnOrder) card.append(el('div', 'qs-rc-order', `순서: ${play.turnOrder.map((id) => c.nameOf(id)).join(' → ')}`));
      root.append(card);
    } else if ((play.stage === 'question' || play.stage === 'steal') && q) {
      const card = el('div', 'qs-card' + (play.stage === 'steal' ? ' steal' : ''));
      card.append(promptBlock(c, q), tiles(c, q.tiles, true));
      if (q.hints && q.hints.length) {
        const hs = el('div', 'qs-hints');
        for (const h of q.hints) hs.append(el('div', null, `💡 ${h}`));
        card.append(hs);
      }
      const turn = play.round.mode === 'turn';
      let status = '';
      if (turn && play.stage === 'question') status = me && me.isTurn ? '🎯 내 차례예요! 뒤 두 글자를 입력하세요' : `🎯 ${c.nameOf(play.turnId)}님 차례 — 훈수 금지! 🤐`;
      else if (play.stage === 'steal') status = me && me.isTurn ? '🔥 스틸 찬스 — 다른 분들이 가로챌 차례예요' : '🔥 스틸 찬스! 먼저 맞히면 별을 가져가요';
      else {
        const total = play.participants.filter((id) => c.player(id) && !c.player(id).left).length;
        status = `채팅에 먼저 맞히면 별 ${play.round.points > 1 ? '2개 ⭐⭐' : '⭐'}${play.passed.length ? ` · 패스 ${play.passed.length}/${total}` : ''}`;
      }
      card.append(el('div', 'qs-status', status));
      root.append(card);
      // 답 입력
      let canAnswer = !!me;
      let canPass = !!me;
      if (turn && play.stage === 'question') canAnswer = canPass = !!(me && me.isTurn);
      if (play.stage === 'steal' && me && me.isTurn) canAnswer = canPass = false;
      if (canAnswer) {
        root.append(answerBar(c, true, canPass, play.stage === 'steal' ? '스틸! 정답을 입력하세요' : '정답 입력 (채팅으로 보내져요)'));
        setTimeout(() => {
          const inp = root.querySelector('.qs-answer input');
          if (inp && document.activeElement === document.body && window.innerWidth > 900) inp.focus();
        }, 0);
      }
    } else if (play.stage === 'reveal' && q && play.reveal) {
      const r = play.reveal;
      const card = el('div', 'qs-card reveal' + (r.winnerId ? ' won' : ''));
      card.append(promptBlock(c, q), el('div', 'qs-label', '정답'), tiles(c, q.tiles, true));
      const who = r.winnerId
        ? `🎉 ${c.nameOf(r.winnerId)}님${r.winnerId === c.me.id ? ' (나)' : ''} ${r.how === 'steal' ? '스틸 성공' : '정답'}! +${'⭐'.repeat(r.pts)}`
        : '😅 아무도 못 맞혔어요';
      card.append(el('div', 'qs-winner', who));
      if (r.note) card.append(el('div', 'qs-note', r.note));
      root.append(card);
    } else if (play.stage === 'roundEnd') {
      ui.banner(root, `${play.roundIndex + 1}라운드 끝!`, '이번 라운드에서 모은 별은 +로 표시돼요. 잠시 후 다음 라운드!', 'accent');
    } else if (play.stage === 'finale') {
      const d = el('div', 'qs-drum');
      d.append(el('div', 'qs-drum-icon', '🥁'), el('div', 'qs-drum-text', '두구두구두구…'), el('div', 'qs-drum-sub', '오늘의 우승자는?!'));
      root.append(d);
    } else if (play.stage === 'end' && play.result) {
      root.append(finalBlock(c, play.result));
      const buttons = [{ label: '결과 보기', onClick: () => document.getElementById('resultModal').classList.remove('hidden') }];
      if (c.isHost) buttons.push({ label: '대기실로', cls: 'primary', onClick: () => document.getElementById('lobbyBtn').click() });
      ui.actionBar(root, buttons);
    }

    const title = el('h3', 'section-title', play.stage === 'end' ? '최종 순위' : '점수판');
    title.style.marginTop = '18px';
    root.append(title, scoreboard(c));
  }

  function finalBlock(c, res) {
    const { el, ui } = c;
    const box = el('div', 'qs-final');
    const podium = el('div', 'qs-podium');
    const top = res.ranking.filter((r) => !r.left).slice(0, 3);
    const order = [top[1], top[0], top[2]].filter(Boolean);
    for (const r of order) {
      const p = c.player(r.id) || { id: r.id, name: '?' };
      const col = el('div', 'qs-pod r' + r.rank);
      col.append(ui.avatar(p, 44), el('div', 'qs-pod-name', p.name), el('div', 'qs-pod-stars', `⭐ ${r.stars}`), el('div', 'qs-pod-base', r.rank === 1 ? '🏆' : `${r.rank}`));
      podium.append(col);
    }
    box.append(podium);
    if (res.penalty && res.losers.length) {
      const pen = el('div', 'qs-penalty');
      pen.append(el('div', 'qs-pen-title', `😆 꼴찌 벌칙 — ${res.losers.map((id) => c.nameOf(id)).join(', ')}`), el('div', 'qs-pen-text', res.penalty));
      box.append(pen);
    }
    if (res.awards && res.awards.length) {
      const aw = el('div', 'qs-awards');
      for (const a of res.awards) {
        const item = el('div', 'qs-award');
        item.append(el('span', 'qa-icon', a.icon), el('b', null, a.title), el('span', null, `${c.nameOf(a.id)} · ${a.text}`));
        aw.append(item);
      }
      box.append(aw);
    }
    return box;
  }

  function onStage(c, { first }) {
    const play = c.play;
    if (first) return;
    if (play.stage === 'roundIntro' && play.round) {
      c.ui.overlay({ icon: play.round.icon, title: `ROUND ${play.roundIndex + 1}`, sub: `${play.round.name}${play.round.double ? ' · 별 2배!' : ''}` });
    } else if (play.stage === 'finale') {
      c.ui.overlay({ icon: '🥁', title: '결과 발표', sub: '두구두구두구…' });
    }
  }

  window.PlayNet.registerGame('quiz', {
    meta: {
      name: '예능 퀴즈쇼',
      icon: '🎤',
      tagline: 'AI 사회자가 진행하는 한 회짜리 예능 퀴즈!',
      description: '초성·인물·노래 제목 퀴즈, 사자성어 릴레이, 속담 이어 말하기, 넌센스까지. 채팅에 먼저 맞히면 별 ⭐, 꼴찌는 벌칙!',
      players: '2~12명',
      playtime: '10~20분',
    },
    renderSettings,
    render,
    onStage,
    topbar(c) {
      const play = c.play;
      const r = play.round;
      let sub = `${play.rounds.length}라운드`;
      if (play.stage === 'finale' || play.stage === 'end') sub = `${play.rounds.length}라운드 완료`;
      else if (r) sub = `${play.roundIndex + 1}/${play.rounds.length}라운드 · ${r.name}${play.qTotal && ['question', 'steal', 'reveal'].includes(play.stage) ? ` · ${play.qIndex}/${play.qTotal}` : ''}`;
      return { icon: STAGE_ICON[play.stage] || '🎤', label: play.stageLabel, sub };
    },
    roleChip(c) {
      const play = c.play;
      if (!play.participants.includes(c.me.id)) return null;
      const mine = play.scores[c.me.id] || 0;
      const better = play.participants.filter((id) => (play.scores[id] || 0) > mine).length;
      return { text: `⭐ ${mine} · ${better + 1}위`, tone: 'teal' };
    },
    mutedText() {
      return null;
    },
    result(c) {
      const play = c.play;
      const res = play.result;
      if (!res) return null;
      const names = (ids) => ids.map((id) => c.nameOf(id)).join(', ');
      const iWon = res.winners.includes(c.me.id);
      const extra = c.el('div', 'qs-result-extra');
      if (res.penalty && res.losers.length) extra.append(c.el('div', 'qs-pen-text', `😆 벌칙 (${names(res.losers)}): ${res.penalty}`));
      for (const a of res.awards || []) extra.append(c.el('div', 'qs-award-line', `${a.icon} ${a.title} — ${c.nameOf(a.id)} (${a.text})`));
      return {
        tone: iWon ? 'good' : '',
        title: res.winners.length ? `🏆 ${names(res.winners)} 우승!` : '게임 종료',
        sub: iWon ? '축하합니다! 오늘의 퀴즈왕 🎉' : res.losers.includes(c.me.id) ? '아쉽게도 꼴찌… 벌칙을 확인하세요 😆' : '수고하셨어요!',
        extra,
        rows: res.ranking.map((r) => ({
          id: r.id,
          name: c.nameOf(r.id),
          label: `⭐ ${r.stars}`,
          note: `${r.rank}위 · 정답 ${r.correct}${r.steals ? ` · 스틸 ${r.steals}` : ''}${r.left ? ' · 나감' : ''}`,
          win: res.winners.includes(r.id),
        })),
      };
    },
  });
})();
