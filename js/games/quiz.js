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


  // ───────────────── 음성 모드 (이 기기만)
  //  릴레이에서 내 차례가 되면: 띠링 → 이 기기가 문제 앞부분을 읽어 줌("훈민") → 듣기 → 말한 답을 서버가 판정
  //  → 딩동댕(정답) · 삐빅(틀림 — 시간이 남으면 다시 듣기) · 땡(차례 실패). 다른 사람 차례에는 조용히 있다.
  //  빨리 맞히기·스틸에서는 답 입력칸의 🎤 를 눌러 말로 답할 수 있다.
  //  브라우저의 음성 합성(speechSynthesis)·음성 인식(SpeechRecognition — 크롬·엣지·사파리)을 쓴다.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const HAS_TTS = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  const PASS_WORD = /^(패스|몰라|몰라요|모르겠어|모르겠어요|모르겠다|모름)$/;
  const V = {
    on: readPref(),
    unlocked: false, // 이 페이지에서 한 번 눌러 소리를 켰는지 (브라우저 자동 재생 제한)
    actx: null,
    rec: null,
    c: null, // 가장 최근 화면 정보
    turnKey: null, // 음성으로 시작한 내 차례
    revealKey: null,
    failKey: null,
    mode: 'idle', // idle | reading | listening | checking | wrong | done | tap
    heard: '',
    note: '',
    retries: 0,
    typed: null, // 입력칸으로 보낸 답 — 틀렸을 때 삐빅
    out: null, // 효과음 출력 (부드러운 리미터)
    mic: 'unknown', // 마이크 권한: granted | denied | prompt | unknown
  };
  /** 기본은 켜짐 — 이 기기에서 직접 끈 경우만 꺼짐 */
  function readPref() {
    try {
      return localStorage.getItem('playnet.quiz.voice') !== '0';
    } catch {
      return true;
    }
  }
  function savePref(on) {
    try {
      localStorage.setItem('playnet.quiz.voice', on ? '1' : '0');
    } catch {
      /* 저장 안 돼도 이번 접속 동안은 유지 */
    }
  }
  const debug = (key, v) => {
    if (window.PLAYNET_DEBUG) (window.PlayNet['_' + key] = window.PlayNet['_' + key] || []).push(v);
  };
  const compact = (t) => String(t || '').replace(/[\s.,!?~]/g, '');

  // 효과음 (Web Audio 로 직접 만든 소리)
  function audio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!V.actx) {
      try {
        V.actx = new AC();
      } catch {
        return null;
      }
    }
    if (V.actx.state === 'suspended' || V.actx.state === 'interrupted') V.actx.resume().catch(() => {}); // interrupted: 아이폰에서 소리 길이 바뀔 때
    return V.actx;
  }
  /** 모든 효과음이 지나가는 마지막 단 — 작은 소리는 키우고, 겹쳐서 커진 소리는 찢어지지 않게 부드럽게 눌러 준다 */
  function output() {
    const ctx = audio();
    if (!ctx) return null;
    if (!V.out) {
      const shaper = ctx.createWaveShaper();
      const n = 2048;
      const curve = new Float32Array(n);
      const k = 1.8;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      shaper.connect(ctx.destination);
      V.out = shaper;
    }
    return V.out;
  }
  /** 음 하나 (+ 배음들) — partials: [[주파수 배수, 세기 비율], ...] */
  function tone(freq, at, dur, type = 'sine', vol = 0.6, partials = []) {
    const ctx = audio();
    const out = output();
    if (!ctx || !out) return;
    const t0 = ctx.currentTime + at;
    const voice = (f, v, d, ty) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = ty;
      o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g);
      g.connect(out);
      o.start(t0);
      o.stop(t0 + d + 0.05);
    };
    voice(freq, vol, dur, type);
    for (const [ratio, amp] of partials) voice(freq * ratio, vol * amp, dur * 0.7, 'sine');
  }
  // 휴대폰 스피커는 낮은 소리를 잘 못 내므로 500Hz 이상 + 배음으로 또렷하고 크게
  const BELL = [[2, 0.45], [3, 0.2], [4.2, 0.08]];
  const SFX = {
    turn: () => (tone(1319, 0, 0.22, 'triangle', 0.8, [[2, 0.35]]), tone(1760, 0.15, 0.5, 'triangle', 0.8, [[2, 0.35]])), // 띠링
    pass: () => (tone(784, 0, 0.6, 'sine', 0.7, BELL), tone(659, 0.22, 0.6, 'sine', 0.7, BELL), tone(1047, 0.46, 1.2, 'sine', 0.8, BELL)), // 딩동댕
    wrong: () => (tone(415, 0, 0.17, 'square', 0.55), tone(415, 0.22, 0.24, 'square', 0.55)), // 삐빅
    fail: () => (tone(523, 0, 1.5, 'sine', 0.75, [[2.0, 0.55], [2.76, 0.45], [5.4, 0.25], [8.93, 0.12]]), tone(262, 0, 0.4, 'triangle', 0.55)), // 땡~ (종)
  };
  function sfx(name) {
    if (!V.on) return;
    debug('sfx', name);
    try {
      SFX[name]();
    } catch {
      /* 소리를 못 내도 게임은 계속 */
    }
  }

  // 읽어 주기 (음성 합성)
  function koVoice() {
    try {
      return window.speechSynthesis.getVoices().find((v) => /^ko/i.test(v.lang || '')) || null;
    } catch {
      return null;
    }
  }
  function speak(text, done) {
    let finished = false;
    const fin = () => {
      if (finished) return;
      finished = true;
      if (done) done();
    };
    if (!V.on || !text) return void setTimeout(fin, 0);
    debug('tts', text);
    if (!HAS_TTS) return void setTimeout(fin, 0);
    try {
      window.speechSynthesis.cancel();
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.rate = 0.9;
      u.volume = 1;
      const v = koVoice();
      if (v) u.voice = v;
      u.onend = fin;
      u.onerror = fin;
      window.speechSynthesis.speak(u);
    } catch {
      return void setTimeout(fin, 0);
    }
    setTimeout(fin, 1200 + String(text).length * 400); // 끝났다는 알림이 오지 않는 브라우저 대비
  }
  function hush() {
    try {
      if (HAS_TTS) window.speechSynthesis.cancel();
    } catch {
      /* 무시 */
    }
  }

  /**
   * 소리 길 (아이폰 사파리의 navigator.audioSession) — 바꿨으면 true.
   * 평소엔 'playback': 무음 스위치를 켜 둬도 소리가 나고, 마이크를 쓴 뒤 작아진 소리도 원래 크기로.
   * 마이크로 듣는 동안만 'auto'(녹음되는 기본값), 퀴즈쇼 방을 나가거나 음성을 끄면 'auto'로 되돌린다.
   */
  function session(type) {
    try {
      const s = navigator.audioSession;
      if (!s || s.type === type) return false;
      s.type = type;
      return true;
    } catch {
      return false;
    }
  }
  const inQuiz = () => document.body.classList.contains('game-quiz');
  /** 지금 화면: 퀴즈쇼 방 · 홈 · 다른 게임 방 */
  const where = () => (inQuiz() ? 'quiz' : document.body.classList.contains('screen-home') ? 'home' : 'other');
  function idleSession() {
    session(V.on && V.unlocked && !V.rec && inQuiz() ? 'playback' : 'auto');
  }

  /** 브라우저 자동 재생 제한 풀기 — 사용자가 누를 때 한 번 (방에 들어가는 홈 화면의 누름도 포함, 다른 게임 방에서는 안 함) */
  function unlock() {
    if (!V.on || V.unlocked || where() === 'other') return;
    V.unlocked = true;
    idleSession();
    audio();
    if (HAS_TTS) {
      try {
        const u = new window.SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      } catch {
        /* 무시 */
      }
    }
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  // 화면이 바뀔 때 — 퀴즈쇼 방에 들어오면 'playback', 퀴즈쇼 방이 아니면 듣기·읽기를 멈추고 소리를 쉬게 (다른 게임·화면에 영향 없게).
  // 홈 화면에서 방에 들어가며 누른 것으로 풀린 소리는 퀴즈쇼 방까지 이어진다.
  let wasAt = where();
  new MutationObserver(() => {
    const now = where();
    if (now === wasAt) return;
    const left = wasAt === 'quiz';
    wasAt = now;
    if (now === 'quiz') return void idleSession();
    if (left) {
      stopListening();
      hush();
    }
    session('auto');
    V.unlocked = false; // 다음 누름(홈 화면·퀴즈쇼 방)에서 다시 푼다
    if (V.actx && V.actx.state === 'running') V.actx.suspend().catch(() => {});
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // 마이크 권한 — 미리 허용해 두면 내 차례에 바로 듣는다 (허용 창이 차례 중에 뜨지 않게)
  (async () => {
    try {
      if (!SR || !navigator.permissions || !navigator.permissions.query) return;
      const st = await navigator.permissions.query({ name: 'microphone' });
      V.mic = st.state;
      st.onchange = () => {
        V.mic = st.state;
      };
    } catch {
      /* 권한 조회를 지원하지 않는 브라우저 */
    }
  })();
  async function askMic() {
    unlock();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      session('auto');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      V.mic = 'granted';
      return true;
    } catch {
      V.mic = 'denied';
      return false;
    } finally {
      idleSession();
    }
  }

  // 듣기 (음성 인식)
  function stopListening() {
    const r = V.rec;
    V.rec = null;
    if (!r) return;
    r.onresult = r.onerror = r.onend = null;
    try {
      r.abort();
    } catch {
      /* 무시 */
    }
    idleSession();
  }
  /** 한 마디 듣기 — 말이 끝나면 onFinal(후보들), 아무 말도 없으면 onNothing(), 듣기를 시작하지 못하면 onFail() */
  function listen(onFinal, onNothing, onFail) {
    if (!SR) return void onFail();
    stopListening();
    let rec;
    try {
      rec = new SR();
    } catch {
      return void onFail();
    }
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    let final = null;
    let blocked = null;
    rec.onresult = (e) => {
      for (let i = e.resultIndex || 0; i < e.results.length; i++) {
        const r = e.results[i];
        const alts = [];
        for (let j = 0; j < r.length; j++) if (r[j] && r[j].transcript) alts.push(String(r[j].transcript).trim());
        if (r.isFinal) final = alts.filter(Boolean);
        else if (alts[0]) {
          V.heard = alts[0];
          paint();
        }
      }
    };
    rec.onerror = (e) => {
      if (e && ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) blocked = e.error;
    };
    rec.onend = () => {
      if (V.rec !== rec) return;
      V.rec = null;
      idleSession();
      if (final && final.length) onFinal(final);
      else if (blocked) {
        V.mode = 'tap';
        V.note = blocked === 'audio-capture' ? '마이크를 찾을 수 없어요.' : '마이크 권한이 필요해요 — 버튼을 눌러 말해 보세요.';
        paint();
      } else if (onNothing) onNothing();
    };
    V.rec = rec;
    session('auto'); // 아이폰: 듣는 동안만 녹음되는 소리 길로 (누른 흐름이 끊기지 않게 기다리지 않고 바로)
    try {
      rec.start();
    } catch {
      V.rec = null;
      idleSession();
      return void onFail();
    }
    debug('listen', Date.now());
  }

  // 내 차례 흐름
  const qKey = (play) => `${play.roundIndex}:${play.qIndex}`;
  function myTurn(play) {
    return !!(play && play.stage === 'question' && play.round && play.round.mode === 'turn' && play.me && play.me.isTurn);
  }
  function stillMyTurn(key) {
    const play = V.c && V.c.play;
    return myTurn(play) && qKey(play) === key;
  }
  function promptText(q) {
    if (!q) return '';
    if (q.kind === 'idiom' || q.kind === 'proverb') return q.front;
    if (q.kind === 'nonsense') return q.text;
    return '';
  }
  function startTurn(play) {
    const key = qKey(play);
    V.turnKey = key;
    V.mode = 'reading';
    V.heard = '';
    V.note = '';
    V.retries = 0;
    sfx('turn');
    setTimeout(() => {
      if (!stillMyTurn(key)) return;
      speak(promptText(play.question), () => setTimeout(() => turnListen(key), 250));
    }, 550);
  }
  function turnListen(key) {
    if (!stillMyTurn(key)) return;
    if (!SR) {
      V.mode = 'idle';
      V.note = '이 브라우저는 음성 인식을 지원하지 않아요 — 입력칸에 답해 주세요.';
      return paint();
    }
    V.mode = 'listening';
    V.heard = '';
    if (V.note && !V.note.startsWith('“')) V.note = '';
    paint();
    listen(
      (alts) => answerByVoice(alts, key),
      () => {
        if (stillMyTurn(key) && V.retries++ < 8) turnListen(key);
        else {
          V.mode = 'idle';
          paint();
        }
      },
      () => {
        V.mode = 'tap';
        V.note = '버튼을 눌러 말해 보세요.';
        paint();
      }
    );
  }
  /** 입력칸의 🎤 — 빨리 맞히기·스틸에서 한 마디 */
  function pushToTalk() {
    const play = V.c && V.c.play;
    if (myTurn(play)) return turnListen(qKey(play));
    V.mode = 'listening';
    V.heard = '';
    V.note = '';
    paint();
    listen(
      (alts) => answerByVoice(alts, null),
      () => {
        V.mode = 'idle';
        V.note = '아무 말도 들리지 않았어요.';
        paint();
      },
      () => {
        V.mode = 'idle';
        V.note = SR ? '듣기를 시작하지 못했어요 — 입력칸에 답해 주세요.' : '이 브라우저는 음성 인식을 지원하지 않아요.';
        paint();
      }
    );
  }
  async function answerByVoice(alts, turnKey) {
    const c = V.c;
    if (!c) return;
    V.heard = alts[0];
    if (PASS_WORD.test(compact(alts[0])) && turnKey) {
      V.mode = 'idle';
      paint();
      return c.act('pass');
    }
    V.mode = 'checking';
    paint();
    const res = await c.act('voice', { texts: alts });
    if (!res || res.ok === false) {
      V.mode = 'idle';
      return paint();
    }
    V.heard = res.heard;
    if (res.correct) {
      V.mode = 'done'; // 딩동댕은 정답 공개 화면에서
      return paint();
    }
    sfx('wrong');
    V.mode = 'wrong';
    V.note = `“${res.heard}” — 틀렸어요${turnKey ? ', 다시 말해 보세요' : ''}`;
    V.heard = '';
    paint();
    if (turnKey) setTimeout(() => turnListen(turnKey), 650);
  }

  /** 화면이 바뀔 때마다 — 내 차례 시작, 통과/실패 소리 */
  function voiceTick(c) {
    V.c = c;
    const play = c.play;
    if (!V.on || !play) return;
    const key = qKey(play);
    if (myTurn(play) && V.turnKey !== key) startTurn(play);
    if (!(play.stage === 'question' || play.stage === 'steal')) stopListening();
    // 내 차례가 실패로 끝남 (시간 초과·패스 → 스틸 찬스)
    if (play.stage === 'steal' && play.turnId === c.me.id && V.turnKey === key && V.failKey !== key) {
      V.failKey = key;
      stopListening();
      hush();
      sfx('fail');
      V.mode = 'idle';
      V.note = '';
    }
    if (play.stage === 'reveal' && play.reveal && V.revealKey !== key) {
      V.revealKey = key;
      const r = play.reveal;
      if (r.winnerId === c.me.id) sfx('pass');
      else if (V.turnKey === key) {
        if (V.failKey !== key) {
          V.failKey = key;
          sfx('fail');
        }
        setTimeout(() => speak(`정답은 ${r.answer}`), 900); // 내 차례에 못 맞혔으면 정답을 읽어 준다
      }
      V.mode = 'idle';
      V.heard = '';
      V.note = '';
    }
  }

  function voicePanel(c) {
    const { el } = c;
    const mine = myTurn(c.play);
    const box = el('div', 'qs-voice ' + V.mode);
    box.id = 'qsVoice';
    const line = {
      reading: '🔊 문제를 읽어 주는 중…',
      listening: '🎙️ 듣고 있어요 — 말해 보세요!',
      checking: '⏳ 확인 중…',
      wrong: '❌ 틀렸어요',
      done: '✅ 정답!',
      tap: '🎤 버튼을 눌러 말해 주세요',
    }[V.mode];
    if (line) box.append(el('div', 'qv-line', line));
    if (V.heard && V.mode !== 'reading') box.append(el('div', 'qv-heard', `“${V.heard}”`));
    if (V.note) box.append(el('div', 'qv-note', V.note));
    const btns = el('div', 'qv-btns');
    if (mine) {
      const again = el('button', 'btn small', '🔁 다시 읽어 주기');
      again.type = 'button';
      again.onclick = () => {
        const key = qKey(c.play);
        stopListening();
        V.mode = 'reading';
        paint();
        speak(promptText(c.play.question), () => setTimeout(() => turnListen(key), 250));
      };
      btns.append(again);
    }
    if (SR && (V.mode === 'tap' || (mine && V.mode === 'idle'))) {
      const talk = el('button', 'btn small primary', '🎤 눌러서 말하기');
      talk.type = 'button';
      talk.onclick = pushToTalk;
      btns.append(talk);
    }
    if (btns.children.length) box.append(btns);
    return box;
  }
  /** 음성 상태만 다시 그리기 (다음 상태가 오기 전에도) */
  function paint() {
    const c = V.c;
    if (!c || !c.play) return;
    const old = document.getElementById('qsVoice');
    const show = V.on && (myTurn(c.play) || V.mode !== 'idle' || V.note) && (c.play.stage === 'question' || c.play.stage === 'steal');
    if (!show) {
      if (old) old.remove();
      return;
    }
    const panel = voicePanel(c);
    if (old) old.replaceWith(panel);
    else {
      const card = document.querySelector('.qs-card');
      if (card) card.append(panel);
    }
  }

  async function enableVoice() {
    V.on = true;
    savePref(true);
    V.unlocked = false;
    unlock();
    speak('음성 모드를 켰어요');
    sfx('turn');
    if (SR && V.mic !== 'granted') await askMic();
    if (V.c) voiceTick(V.c);
    paint();
  }
  function disableVoice() {
    stopListening();
    hush();
    V.on = false;
    savePref(false);
    idleSession();
    V.mode = 'idle';
    V.note = '';
    V.heard = '';
    paint();
  }
  function voiceSupportNote() {
    if (SR && HAS_TTS)
      return '기본으로 켜져 있어요. 사자성어 릴레이에서 내 차례가 되면 이 기기가 앞 두 글자를 읽어 주고, 말로 답하면 알아듣고 딩동댕·땡 소리를 내요. 빨리 맞히기에서는 🎤를 눌러 말로 답할 수 있어요. 기기 볼륨을 크게 해 두세요. 음성 인식은 브라우저(구글·애플)의 서비스를 사용해요.';
    if (HAS_TTS) return '이 브라우저는 음성 인식을 지원하지 않아 읽어 주기와 소리만 돼요 (말로 답하기는 크롬·엣지·사파리에서 가능).';
    return '이 브라우저는 음성 기능을 지원하지 않아 효과음만 나요.';
  }
  function voicePill(c) {
    const { el } = c;
    const box = el('span', 'qs-voice-pills');
    const b = el('button', 'qs-voice-pill' + (V.on ? ' on' : ''), V.on ? '🎙️ 음성 켜짐' : '🔈 음성 꺼짐');
    b.type = 'button';
    b.title = voiceSupportNote();
    b.onclick = async () => {
      if (V.on) disableVoice();
      else await enableVoice();
      box.replaceWith(voicePill(c));
    };
    box.append(b);
    if (V.on && !V.unlocked) {
      const t = el('button', 'qs-voice-pill warn', '🔊 눌러서 소리 켜기');
      t.type = 'button';
      t.onclick = () => {
        unlock();
        sfx('turn');
        box.replaceWith(voicePill(c));
      };
      box.append(t);
    }
    if (V.on && SR && V.mic === 'prompt') {
      const m = el('button', 'qs-voice-pill warn', '🎤 마이크 허용');
      m.type = 'button';
      m.title = '미리 허용해 두면 내 차례에 바로 말로 답할 수 있어요';
      m.onclick = async () => {
        await askMic();
        box.replaceWith(voicePill(c));
      };
      box.append(m);
    } else if (V.on && SR && V.mic === 'denied') {
      const m = el('button', 'qs-voice-pill bad', '🎤 마이크 막힘');
      m.type = 'button';
      m.onclick = () => c.toast('주소창의 🔒(사이트 설정)에서 마이크를 허용해 주세요. 입력칸으로도 답할 수 있어요.', true);
      box.append(m);
    }
    return box;
  }

  /** 새 대화 — 입력칸으로 보낸 내 답이 틀렸으면 삐빅 */
  function onChat(c, m) {
    if (!V.on || !V.typed || m.from !== c.me.id || m.voice) return;
    const t = V.typed;
    if (Date.now() - t.at > 4000) {
      V.typed = null;
      return;
    }
    if (m.text !== t.text) return;
    V.typed = null;
    if (m.kind !== 'correct') sfx('wrong');
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

    // 이 기기만 (방장이 아니어도 각자)
    const sec4 = el('div', 'set-section');
    sec4.append(el('div', 'set-title', '내 기기'));
    const sw4 = el('label', 'switch');
    const cb4 = el('input');
    cb4.type = 'checkbox';
    cb4.checked = V.on;
    cb4.onchange = () => (cb4.checked ? enableVoice() : disableVoice());
    sw4.append(cb4, el('span', null, '🎙️ 음성 모드 — 내 차례에 문제를 읽어 주고 말로 답하기'));
    sec4.append(sw4, el('p', 'set-note', voiceSupportNote()));
    if (V.on && SR && V.mic !== 'granted') {
      const mic = el('button', 'btn small', V.mic === 'denied' ? '🎤 마이크가 막혀 있어요 (주소창 🔒에서 허용)' : '🎤 마이크 미리 허용하기');
      mic.type = 'button';
      mic.disabled = V.mic === 'denied';
      mic.onclick = async () => {
        await askMic();
        mic.textContent = V.mic === 'granted' ? '✓ 마이크 준비됨' : '🎤 마이크가 막혀 있어요 (주소창 🔒에서 허용)';
        mic.disabled = true;
      };
      sec4.append(mic);
    }
    panel.append(sec4);
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
    s.append(voicePill(c));
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
    if (V.on && SR && canAnswer) {
      const mic = el('button', 'btn qs-mic-btn' + (V.mode === 'listening' ? ' on' : ''), '🎤');
      mic.type = 'button';
      mic.title = '말로 답하기';
      mic.onclick = pushToTalk;
      form.append(mic);
    }
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
      V.typed = { text, at: Date.now() };
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
    voiceTick(c);
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
      if (turn && play.stage === 'question')
        status = me && me.isTurn ? `🎯 내 차례예요! 뒤 두 글자를 ${V.on && SR ? '말하거나 ' : ''}입력하세요` : `🎯 ${c.nameOf(play.turnId)}님 차례 — 훈수 금지! 🤐`;
      else if (play.stage === 'steal') status = me && me.isTurn ? '🔥 스틸 찬스 — 다른 분들이 가로챌 차례예요' : '🔥 스틸 찬스! 먼저 맞히면 별을 가져가요';
      else {
        const total = play.participants.filter((id) => c.player(id) && !c.player(id).left).length;
        status = `채팅에 먼저 맞히면 별 ${play.round.points > 1 ? '2개 ⭐⭐' : '⭐'}${play.passed.length ? ` · 패스 ${play.passed.length}/${total}` : ''}`;
      }
      card.append(el('div', 'qs-status', status));
      if (V.on && (myTurn(play) || V.mode !== 'idle' || V.note)) card.append(voicePanel(c));
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
    onChat,
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
