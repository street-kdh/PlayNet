/* PlayNet — 라이어 게임 화면 */
(() => {
  'use strict';

  const STAGE_ICON = { intro: '🎭', hint: '💬', discussion: '🗣️', vote: '🗳️', guess: '🎯', end: '🏁' };

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

  function renderSettings(panel, c) {
    const { el, isHost, info } = c;
    const s = c.state.settings;

    // 주제
    const sec1 = el('div', 'set-section');
    sec1.append(el('div', 'set-title', '주제'));
    const sel = el('select');
    sel.disabled = !isHost;
    const opt = (v, t) => {
      const o = el('option', null, t);
      o.value = v;
      if (v === s.category) o.selected = true;
      sel.append(o);
    };
    opt('random', '🎲 무작위 (매 판 바뀜)');
    for (const cat of info.categories) opt(cat.id, `${cat.icon} ${cat.name} (${cat.count}개)`);
    sel.onchange = () => c.update({ category: sel.value });
    sec1.append(sel);
    panel.append(sec1);

    // 규칙
    const sec2 = el('div', 'set-section');
    const row = el('div', 'set-title');
    row.append(el('span', null, '힌트 바퀴 수'));
    row.append(seg(el, [[1, '1바퀴'], [2, '2바퀴'], [3, '3바퀴']], s.rounds, !isHost, (v) => c.update({ rounds: v })));
    sec2.append(row);
    const row2 = el('div', 'set-title');
    row2.append(el('span', null, '모드'));
    row2.append(seg(el, [['normal', '일반'], ['fool', '바보 모드']], s.mode, !isHost, (v) => c.update({ mode: v })));
    sec2.append(row2);
    sec2.append(
      el(
        'p',
        'set-note',
        s.mode === 'fool'
          ? '바보 모드: 라이어도 같은 주제의 다른 단어를 받고, 자신이 라이어인지 모릅니다.'
          : '일반: 라이어는 주제만 알고, 자신이 라이어라는 것을 압니다.'
      )
    );
    panel.append(sec2);

    // 시간
    const sec3 = el('div', 'set-section');
    sec3.append(el('div', 'set-title', '단계별 시간 (초)'));
    const grid = el('div', 'times-grid');
    const labels = { hint: '힌트(1인)', discussion: '토론', vote: '지목', guess: '정답 맞히기' };
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
    sec3.append(grid);
    panel.append(sec3);
  }

  function wordCard(c) {
    const { el, play } = c;
    const top = el('div', 'liar-top');
    const me = play.me;
    const card = el('div', 'word-card' + (me && me.isLiar ? ' liar' : ''));
    const text = el('div');
    if (me && me.isLiar) {
      card.append(el('span', 'wc-icon', '🤫'));
      text.append(el('div', 'wc-label', '당신은'), el('div', 'wc-word', '라이어'), el('div', 'wc-note', '주제만 알고 있어요. 들키지 말고 제시어를 알아내세요.'));
    } else if (me) {
      card.append(el('span', 'wc-icon', '🔑'));
      text.append(
        el('div', 'wc-label', '내 제시어'),
        el('div', 'wc-word', me.word || '—'),
        el('div', 'wc-note', play.mode === 'fool' ? '바보 모드 — 라이어도 비슷한 다른 단어를 받았어요.' : '라이어가 눈치채지 못하게 설명하세요.')
      );
    }
    card.append(text);
    const cat = el('div', 'cat-card');
    cat.append(el('div', 'cc-icon', play.category.icon), el('div', 'cc-name', play.category.name), el('div', 'cc-label', '주제'));
    top.append(card, cat);
    return top;
  }

  function hintBoard(c) {
    const { el, ui, play } = c;
    const board = el('div', 'hint-board');
    play.order.forEach((id, i) => {
      const p = c.player(id) || { id, name: '?' };
      const row = el('div', 'hint-row' + (play.speakerId === id ? ' speaking' : '') + (p.left ? ' left' : ''));
      const who = el('div', 'hint-who');
      const nm = el('div');
      nm.append(el('div', 'hn', p.name + (id === c.me.id ? ' (나)' : '')), el('div', 'turn', `${i + 1}번째`));
      who.append(ui.avatar(p, 32), nm);
      const list = el('div', 'hint-list');
      for (const h of play.hints.filter((x) => x.playerId === id)) {
        const b = el('span', 'hint-bubble' + (h.text ? '' : ' miss'));
        if (play.rounds > 1) b.append(el('span', 'r', `${h.round}R`));
        b.append(document.createTextNode(h.text || (h.status === 'timeout' ? '(시간 초과)' : '(자리 비움)')));
        list.append(b);
      }
      if (play.speakerId === id) list.append(el('span', 'hint-bubble typing', id === c.me.id ? '내 차례!' : '말하는 중…'));
      else if (play.stage === 'hint' && !play.hints.some((x) => x.playerId === id && x.round === play.round)) list.append(el('span', 'hint-bubble wait', '대기'));
      row.append(who, list);
      board.append(row);
    });
    return board;
  }

  function render(root, c) {
    const { el, ui, play } = c;
    const me = play.me;
    const speaker = c.player(play.speakerId);
    const accused = c.player(play.accusedId);

    if (play.stage === 'end' && play.result) {
      const r = play.result;
      const box = el('div', 'liar-result');
      box.append(el('div', 'lr-sub', `주제 ${play.category.icon} ${play.category.name} · 제시어`), el('div', 'lr-word', r.word));
      const bits = [`라이어: ${c.nameOf(r.liarId)}`];
      if (r.fakeWord) bits.push(`라이어가 받은 단어: ${r.fakeWord}`);
      if (r.guess) bits.push(`라이어의 추측: ${r.guess}`);
      box.append(el('div', 'lr-sub', bits.join(' · ')));
      root.append(box);
      const title = r.winner === 'liar' ? '🤫 라이어 승리' : r.winner === 'citizen' ? '🎉 시민 승리' : '게임 종료';
      ui.banner(root, title, r.reasonText, r.winner === 'liar' ? 'alert' : 'accent');
    } else {
      root.append(wordCard(c));
    }

    if (play.stage === 'intro') {
      ui.banner(root, '제시어를 확인하세요', '잠시 후 순서대로 힌트를 말하는 시간이 시작됩니다.');
    } else if (play.stage === 'hint') {
      if (play.speakerId === c.me.id) {
        ui.banner(root, '내 차례예요!', '제시어를 직접 말하지 말고 한 마디로 설명하세요. (최대 60자)', 'accent');
        const form = el('form', 'hint-input');
        const input = el('input');
        input.maxLength = 60;
        input.placeholder = '예: 여름에 자주 생각나요';
        input.dataset.keep = 'hint';
        input.autocomplete = 'off';
        const btn = el('button', 'btn primary', '말하기');
        btn.type = 'submit';
        form.append(input, btn);
        form.onsubmit = async (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          const res = await c.act('hint', { text });
          if (res && res.ok !== false) input.value = '';
        };
        root.append(form);
        setTimeout(() => {
          if (document.activeElement === document.body) input.focus();
        }, 0);
      } else {
        const myIdx = play.order.indexOf(c.me.id);
        const curIdx = play.order.indexOf(play.speakerId);
        const wait = myIdx > curIdx ? myIdx - curIdx : null;
        ui.banner(
          root,
          `${speaker ? speaker.name : '?'}님이 힌트를 말하는 중…`,
          `${play.round}/${play.rounds}바퀴${wait ? ` · 내 차례까지 ${wait}명` : ''} · 힌트 차례에는 대화할 수 없어요`
        );
      }
    } else if (play.stage === 'discussion') {
      const ready = play.readyIds.includes(c.me.id);
      const total = c.state.players.filter((p) => !p.left && p.connected).length;
      ui.banner(root, '누가 라이어일까요?', '대화창에서 자유롭게 토론하세요. 모두 준비되면 바로 지목으로 넘어갑니다.');
      ui.actionBar(root, [
        {
          label: ready ? `✓ 준비 완료 (${play.readyIds.length}/${total})` : `지목하러 가기 (${play.readyIds.length}/${total})`,
          cls: ready ? 'selected' : 'primary',
          disabled: ready,
          onClick: () => c.act('ready'),
        },
      ]);
    } else if (play.stage === 'vote') {
      ui.banner(
        root,
        '라이어를 지목하세요',
        play.myVote ? `${c.nameOf(play.myVote)}님을 지목했습니다 · 바꿀 수 있습니다` : '가장 많은 표를 받은 사람이 지목됩니다. 동률이면 라이어의 승리!',
        'accent'
      );
      const items = play.order.filter((id) => c.player(id) && !c.player(id).left).map((id) => ({ id, badge: play.voteTally && play.voteTally[id] }));
      ui.playerGrid(root, items, {
        clickable: items.map((x) => x.id).filter((id) => id !== c.me.id),
        selected: play.myVote,
        onPick: (id) => c.act('vote', { targetId: id }),
      });
    } else if (play.stage === 'guess') {
      if (play.guessOptions) {
        ui.banner(root, '들켰습니다! 마지막 기회', '제시어가 무엇인지 고르세요. 맞히면 라이어의 역전승입니다.', 'alert');
        const grid = el('div', 'guess-grid');
        for (const w of play.guessOptions) {
          const b = el('button', 'btn', w);
          b.onclick = () => c.act('guess', { word: w });
          grid.append(b);
        }
        root.append(grid);
      } else {
        ui.banner(root, `🎯 라이어는 ${accused ? accused.name : '?'}님!`, '라이어가 제시어를 고르는 중입니다. 맞히면 라이어의 역전승…', 'alert');
      }
    }

    if (play.stage !== 'intro') {
      const title = el('h3', 'section-title', '힌트 기록');
      title.style.marginTop = '22px';
      root.append(title, hintBoard(c));
    }

    if (play.stage === 'end') {
      const buttons = [{ label: '결과 보기', onClick: () => document.getElementById('resultModal').classList.remove('hidden') }];
      if (c.isHost) buttons.push({ label: '대기실로', cls: 'primary', onClick: () => document.getElementById('lobbyBtn').click() });
      ui.actionBar(root, buttons);
    }
  }

  function showCard(c, animate) {
    const play = c.play;
    const me = play.me;
    if (!me) return;
    const cat = `${play.category.icon} ${play.category.name}`;
    if (me.isLiar) {
      c.ui.revealCard({
        eyebrow: '당신은',
        icon: '🤫',
        title: '라이어',
        badge: `주제: ${cat}`,
        desc: '제시어를 모르는 사람은 당신뿐이에요. 다른 사람의 힌트를 잘 듣고, 들키지 않게 그럴듯한 힌트를 말하세요.',
        tone: 'bad',
        animate,
      });
    } else {
      c.ui.revealCard({
        eyebrow: '제시어',
        icon: play.category.icon,
        title: me.word,
        badge: `주제: ${cat}`,
        desc:
          play.mode === 'fool'
            ? '바보 모드: 라이어도 비슷한 다른 단어를 받았고, 자신이 라이어인지 몰라요. 설명이 미묘하게 다른 사람을 찾으세요.'
            : '라이어는 주제만 알고 있어요. 너무 쉽게 설명하면 라이어가 제시어를 눈치챕니다.',
        tone: 'teal',
        animate,
      });
    }
  }

  function onStage(c, { first }) {
    const play = c.play;
    if (play.stage === 'intro') return showCard(c, true);
    if (first) return;
    const acc = c.player(play.accusedId);
    const map = {
      hint: ['💬', play.round > 1 ? `${play.round}번째 바퀴` : '힌트 시간', '순서대로 제시어를 한 마디로 설명하세요'],
      discussion: ['🗣️', '토론 시간', '누가 라이어일까요?'],
      vote: ['🗳️', '라이어 지목', '가장 수상한 사람을 고르세요'],
      guess: ['🎯', '라이어 발각!', acc ? `${acc.name}님이 제시어를 맞히면 역전승` : ''],
    };
    const v = map[play.stage];
    if (v) c.ui.overlay({ icon: v[0], title: v[1], sub: v[2] });
  }

  window.PlayNet.registerGame('liar', {
    meta: {
      name: '라이어 게임',
      icon: '🎭',
      tagline: '제시어를 모르는 단 한 사람을 찾아라.',
      description: '모두 같은 제시어를 받지만 라이어만 주제밖에 모릅니다. 돌아가며 한 마디씩 설명하고, 어색한 사람을 찾아내세요.',
      players: '3~10명',
      playtime: '5~10분',
    },
    renderSettings,
    render,
    showCard,
    onStage,
    topbar(c) {
      const play = c.play;
      let sub = `주제 ${play.category.icon} ${play.category.name}`;
      if (play.stage === 'hint') sub += ` · ${play.round}/${play.rounds}바퀴`;
      if (play.mode === 'fool') sub += ' · 바보 모드';
      return { icon: STAGE_ICON[play.stage] || '🎭', label: play.stageLabel, sub };
    },
    roleChip(c) {
      const me = c.play.me;
      if (!me) return null;
      return me.isLiar ? { text: '🤫 라이어', tone: 'bad' } : { text: `🔑 ${me.word}`, tone: 'teal' };
    },
    mutedText(c) {
      return (
        {
          intro: '곧 힌트 시간이 시작됩니다',
          hint: '힌트 차례에는 대화할 수 없어요',
          guess: '라이어가 답을 고르는 중이에요',
        }[c.play.stage] || null
      );
    },
    result(c) {
      const play = c.play;
      const r = play.result;
      if (!r) return null;
      const tally = play.voteTally || {};
      const iWon = r.winner && (r.winner === 'liar') === (c.me.id === r.liarId);
      const extra = c.el('div', 'liar-result');
      extra.append(c.el('div', 'lr-sub', '제시어'), c.el('div', 'lr-word', r.word));
      const bits = [];
      if (r.fakeWord) bits.push(`라이어가 받은 단어: ${r.fakeWord}`);
      if (r.guess) bits.push(`라이어의 추측: ${r.guess}`);
      if (bits.length) extra.append(c.el('div', 'lr-sub', bits.join(' · ')));
      return {
        tone: r.winner === 'liar' ? 'bad' : 'teal',
        title: r.winner === 'liar' ? '라이어 승리' : r.winner === 'citizen' ? '시민 승리' : '게임 종료',
        sub: r.reasonText + (r.winner ? (iWon ? ' 🎉 당신의 승리!' : '') : ''),
        extra,
        rows: play.order.map((id) => ({
          id,
          name: c.nameOf(id),
          label: id === r.liarId ? '🤫 라이어' : '🔑 시민',
          note: `${tally[id] || 0}표`,
          win: r.winner ? (r.winner === 'liar') === (id === r.liarId) : false,
        })),
      };
    },
  });
})();
