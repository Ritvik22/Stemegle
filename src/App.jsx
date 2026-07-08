import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Atom,
  BarChart3,
  Bolt,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Crown,
  Eye,
  EyeOff,
  FlaskConical,
  Globe2,
  Lock,
  Menu,
  Orbit,
  Play,
  Rocket,
  Sparkles,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { fetchGamesPlayed, fetchLeaderboard, fetchRegisteredUsers, getPresencePlayers, hasRealtimeConfig, recordMatchResult, supabase } from './lib/supabase';
import { getQuestionsForMatch } from './data/questions';

const LOBBY_CHANNEL = 'stemegle:lobby:v1';
const AUTH_REDIRECT_URL = import.meta.env.VITE_SITE_URL || 'https://stemegle.vercel.app';

const VISITOR_ID = (() => {
  const key = 'stemegle_vid';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(key, id);
  return id;
})();

function useLiveStats(accountId) {
  const [onlineCount, setOnlineCount] = useState(null);
  const [gamesPlayed, setGamesPlayed] = useState(null);
  const [registeredUsers, setRegisteredUsers] = useState(null);
  const [leaders, setLeaders] = useState(null);
  const [accountRank, setAccountRank] = useState(null);

  useEffect(() => {
    if (!supabase) return undefined;

    let active = true;
    const refreshStats = async () => {
      const [count, userCount, leaderboardResult] = await Promise.all([
        fetchGamesPlayed(),
        fetchRegisteredUsers(),
        fetchLeaderboard(accountId),
      ]);
      if (!active) return;
      if (count !== null) setGamesPlayed(count);
      if (userCount !== null) setRegisteredUsers(userCount);
      if (leaderboardResult === false) {
        setLeaders(false);
        setAccountRank(null);
      } else {
        setLeaders(leaderboardResult.leaders);
        setAccountRank(leaderboardResult.accountRank);
      }
    };
    refreshStats();

    const visitorsChannel = supabase.channel('stemegle:visitors', {
      config: { presence: { key: VISITOR_ID } },
    });

    visitorsChannel
      .on('presence', { event: 'sync' }, () => {
        setOnlineCount(Object.keys(visitorsChannel.presenceState()).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await visitorsChannel.track({ joinedAt: Date.now() });
        }
      });

    const statsChannel = supabase
      .channel('stemegle:ranked-stats')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'matches',
      }, refreshStats)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
      }, refreshStats)
      .subscribe();

    return () => {
      active = false;
      visitorsChannel.untrack();
      supabase.removeChannel(visitorsChannel);
      supabase.removeChannel(statsChannel);
    };
  }, [accountId]);

  return { onlineCount, gamesPlayed, registeredUsers, leaders, accountRank };
}

function createPlayerId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function Logo() {
  return <a className="logo" href="#top" aria-label="Stemegle home"><span className="logo-mark"><Atom size={22} /></span><span>stemegle</span></a>;
}

function Header({ accountName, onGuest, onCreate, onLogin, onLogout, onAccountPlay }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <Logo />
      <nav className={open ? 'nav open' : 'nav'} aria-label="Main navigation">
        <a href="#how" onClick={() => setOpen(false)}>How it works</a>
        <a href="#leaderboard" onClick={() => setOpen(false)}>Leaderboard</a>
        {accountName ? (
          <>
            <span className="account-pill"><i>{accountName[0].toUpperCase()}</i><span><small>SIGNED IN</small>{accountName}</span></span>
            <button className="nav-login" onClick={onLogout}>Log out</button>
            <button className="button button-small" onClick={onAccountPlay}>Play now <ArrowRight size={15} /></button>
          </>
        ) : (
          <>
            <button className="nav-login" onClick={onLogin}>Log in</button>
            <button className="nav-guest" onClick={onGuest}>Guest play</button>
            <button className="button button-small" onClick={onCreate}>Create account <ArrowRight size={15} /></button>
          </>
        )}
      </nav>
      <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? <X /> : <Menu />}</button>
    </header>
  );
}

function BattleCard() {
  return (
    <div className="battle-wrap" aria-label="Preview of a live Stemegle battle">
      <div className="float-chip chip-one"><FlaskConical size={16} /> Chemistry challenge</div>
      <div className="float-chip chip-two"><Zap size={16} /> Speed bonus</div>
      <div className="battle-card">
        <div className="battle-topline"><span className="live-pill"><i /> BATTLE PREVIEW</span><span>THINK FAST</span></div>
        <div className="players">
          <div className="player"><span className="avatar avatar-you">Y</span><div><strong>You</strong><small>Ready</small></div></div>
          <div className="versus">VS</div>
          <div className="player opponent"><div><strong>Live rival</strong><small>Ready</small></div><span className="avatar avatar-nova">R</span></div>
        </div>
        <div className="question-preview">
          <div className="question-meta"><span><Bolt size={14} /> PHYSICS</span><span className="mini-timer"><Clock3 size={14} /> SPEED COUNTS</span></div>
          <h3>What is the SI unit of force?</h3>
          <div className="answer-grid">
            <button>Joule</button><button className="answer-selected"><Check size={17} /> Newton</button><button>Watt</button><button>Pascal</button>
          </div>
        </div>
        <div className="battle-footer"><span><Sparkles size={15} /> Answer fast for a speed bonus</span><div className="mini-progress"><i /></div></div>
      </div>
    </div>
  );
}

function EntryModal({ mode, onClose, onGuestStart, onAuthSuccess, onSwitch }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isGuest = mode === 'guest';
  const isLogin = mode === 'login';
  const passwordStrong = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
  const valid = isGuest
    ? name.trim().length >= 2
    : isLogin
      ? email.includes('@') && password.length > 0
      : name.trim().length >= 2 && email.includes('@') && passwordStrong && password === confirmPassword;

  async function submit(event) {
    event.preventDefault();
    if (!valid || loading) return;
    setError('');
    setNotice('');

    if (isGuest) {
      onGuestStart(name.trim());
      return;
    }

    if (!supabase) {
      setError('Account services are not configured for this deployment.');
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (signInError) throw signInError;
        onAuthSuccess();
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { battle_name: name.trim() },
          emailRedirectTo: AUTH_REDIRECT_URL,
        },
      });
      if (signUpError) throw signUpError;
      if (data.session) {
        onAuthSuccess();
      } else {
        setNotice('Account created. Check your email to confirm it, then return and log in.');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (authError) {
      setError(authError?.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(nextMode) {
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setError('');
    setNotice('');
    onSwitch(nextMode);
  }

  const title = isGuest ? 'Choose your battle name' : isLogin ? 'Welcome back' : 'Create your contender';
  const eyebrow = isGuest ? 'QUICK PLAY' : isLogin ? 'PLAYER LOGIN' : 'JOIN THE LEAGUE';

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <span className="modal-icon">{isGuest ? <Play /> : isLogin ? <Lock /> : <Rocket />}</span>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="entry-title">{title}</h2>
        <p>{isGuest ? 'No account, no fuss. Pick a name and jump straight into a match.' : isLogin ? 'Log in securely to continue with your saved identity.' : 'Protect your account with a password and keep your player identity across devices.'}</p>
        <form onSubmit={submit}>
          {!isLogin && <label>Battle name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ProtonPilot" maxLength={18} autoComplete="nickname" /></label>}
          {!isGuest && <label>Email address<input autoFocus={isLogin} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>}
          {!isGuest && (
            <label>Password
              <span className="password-field">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isLogin ? 'Enter your password' : 'At least 8 characters'} autoComplete={isLogin ? 'current-password' : 'new-password'} />
                <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button>
              </span>
            </label>
          )}
          {!isGuest && !isLogin && <label>Confirm password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" /></label>}
          {!isGuest && !isLogin && <p className={password && !passwordStrong ? 'password-rule invalid' : 'password-rule'}><Lock /> Use 8+ characters with at least one letter and one number.</p>}
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {notice && <p className="auth-message success" role="status">{notice}</p>}
          <button type="submit" className="button button-wide" disabled={!valid || loading}>{loading ? 'Please wait…' : isGuest ? 'Find an opponent' : isLogin ? 'Log in' : 'Create account'} {!loading && <ArrowRight size={18} />}</button>
        </form>
        <small className="privacy"><Lock size={12} /> {isGuest ? 'Guest progress lasts for this session.' : 'Passwords are handled securely by Supabase Auth.'}</small>
        {!isGuest && <button className="auth-switch" onClick={() => switchMode(isLogin ? 'create' : 'login')}>{isLogin ? 'New here? Create an account' : 'Already have an account? Log in'}</button>}
      </div>
    </div>
  );
}

function Matchmaking({ name, onMatched, onCancel }) {
  const [secondsWaiting, setSecondsWaiting] = useState(0);
  const [opponentOnline, setOpponentOnline] = useState(false);
  const [status, setStatus] = useState(hasRealtimeConfig ? 'connecting' : 'configuration-error');
  const [error, setError] = useState('');
  const playerId = useRef(createPlayerId());

  useEffect(() => {
    const waitTicker = setInterval(() => setSecondsWaiting((seconds) => seconds + 1), 1000);
    if (!hasRealtimeConfig) return () => clearInterval(waitTicker);

    let active = true;
    let lobbyChannel;
    let attempt = null;
    let joinedMatch = false;

    const clearAttempt = () => {
      if (!attempt) return;
      attempt.intervals.forEach(clearInterval);
      attempt.timers.forEach(clearTimeout);
      attempt.channel.untrack();
      supabase.removeChannel(attempt.channel);
      attempt = null;
      setOpponentOnline(false);
      setStatus('waiting');
    };

    const beginAttempt = (opponent) => {
      const matchId = [playerId.current, opponent.playerId].sort().join('--');
      const isHost = matchId.startsWith(playerId.current);
      const eventListeners = new Set();
      const events = {
        subscribe(listener) {
          eventListeners.add(listener);
          return () => eventListeners.delete(listener);
        },
        emit(event, payload) {
          eventListeners.forEach((listener) => listener(event, payload));
        },
      };

      const channel = supabase.channel(`stemegle:match:${matchId}`, {
        config: {
          presence: { key: playerId.current },
          broadcast: { self: true, ack: true },
        },
      });

      attempt = { channel, opponentId: opponent.playerId, intervals: [], timers: [] };
      let opponentReady = false;
      let startsAt = null;
      let questionSet = null;

      const finalize = (payload) => {
        if (!active || joinedMatch) return;
        joinedMatch = true;
        attempt.intervals.forEach(clearInterval);
        attempt.timers.forEach(clearTimeout);
        lobbyChannel.untrack();
        supabase.removeChannel(lobbyChannel);
        lobbyChannel = null;
        onMatched({
          id: matchId,
          channel,
          events,
          playerId: playerId.current,
          opponent: { id: opponent.playerId, name: opponent.name },
          startsAt: payload.startsAt,
          // Host is the single source of truth for the question set so both
          // players always get an identical match, even if their local question
          // banks differ (e.g. mid-deploy). Fall back to deriving from matchId.
          questions: payload.questions ?? getQuestionsForMatch(matchId),
        });
      };

      channel
        .on('broadcast', { event: 'ready' }, ({ payload }) => {
          if (payload.playerId !== playerId.current) opponentReady = true;
        })
        .on('broadcast', { event: 'start' }, ({ payload }) => finalize(payload))
        .on('broadcast', { event: 'score' }, ({ payload }) => events.emit('score', payload))
        .on('broadcast', { event: 'finish' }, ({ payload }) => events.emit('finish', payload))
        .on('presence', { event: 'sync' }, () => {
          const matchPlayers = getPresencePlayers(channel);
          events.emit('presence', matchPlayers);
          if (matchPlayers.length === 2 && !joinedMatch) {
            setOpponentOnline(true);
            setStatus('opponent-found');
          }
        })
        .subscribe(async (subscriptionStatus) => {
          if (subscriptionStatus === 'SUBSCRIBED' && attempt?.channel === channel) {
            await channel.track({ playerId: playerId.current, name, joinedAt: Date.now() });
            // Handshake heartbeat: announce readiness until the match starts, so a
            // missed broadcast is always retried rather than hanging both players.
            attempt.intervals.push(setInterval(() => {
              if (joinedMatch || !active) return;
              channel.send({ type: 'broadcast', event: 'ready', payload: { playerId: playerId.current } });
              if (isHost && opponentReady) {
                startsAt = startsAt ?? Date.now() + 2000;
                questionSet = questionSet ?? getQuestionsForMatch(matchId);
                channel.send({ type: 'broadcast', event: 'start', payload: { startsAt, questions: questionSet } });
              }
            }, 700));
          }
          if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
            if (attempt?.channel === channel) {
              clearAttempt();
              pairFromLobby();
            }
          }
        });

      // If the handshake doesn't complete quickly, this pairing is dead (ghost
      // presence or the opponent paired elsewhere) — drop it and re-queue.
      attempt.timers.push(setTimeout(() => {
        if (joinedMatch || !active) return;
        clearAttempt();
        pairFromLobby();
      }, 8000));
    };

    const pairFromLobby = () => {
      if (!active || joinedMatch || !lobbyChannel) return;
      const players = getPresencePlayers(lobbyChannel)
        .sort((a, b) => a.joinedAt - b.joinedAt || a.playerId.localeCompare(b.playerId));
      const ownIndex = players.findIndex((candidate) => candidate.playerId === playerId.current);
      if (ownIndex === -1) return;
      const partnerIndex = ownIndex % 2 === 0 ? ownIndex + 1 : ownIndex - 1;
      const partner = players[partnerIndex];

      if (!partner) {
        // Nobody to pair with right now; abandon any half-open attempt.
        clearAttempt();
        setOpponentOnline(false);
        setStatus('waiting');
        return;
      }
      if (attempt) {
        if (attempt.opponentId === partner.playerId) return;
        // Pairing changed (e.g. our previous partner matched with someone else).
        clearAttempt();
      }
      beginAttempt(partner);
    };

    lobbyChannel = supabase.channel(LOBBY_CHANNEL, {
      config: { presence: { key: playerId.current } },
    });

    lobbyChannel
      .on('presence', { event: 'sync' }, pairFromLobby)
      .subscribe(async (subscriptionStatus) => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          setStatus('waiting');
          await lobbyChannel.track({ playerId: playerId.current, name, joinedAt: Date.now() });
        }
        if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
          setError('Unable to reach the multiplayer lobby. Check your connection and try again.');
          setStatus('error');
        }
      });

    return () => {
      active = false;
      clearInterval(waitTicker);
      if (lobbyChannel) {
        lobbyChannel.untrack();
        supabase.removeChannel(lobbyChannel);
      }
      if (attempt && !joinedMatch) clearAttempt();
    };
  }, [name, onMatched]);

  const progress = opponentOnline ? 100 : Math.min(18 + secondsWaiting * 3, 76);
  const connecting = status === 'connecting';
  const hasError = status === 'error' || status === 'configuration-error';

  return (
    <main className="game-shell matchmaking-screen">
      <Logo />
      <div className="radar"><span className="radar-ring r1" /><span className="radar-ring r2" /><span className="radar-ring r3" /><span className="radar-sweep" /><span className="avatar avatar-you radar-avatar">{name[0].toUpperCase()}</span></div>
      <p className="eyebrow"><i className="status-dot" /> {hasError ? 'CONNECTION NEEDED' : opponentOnline ? 'OPPONENT ONLINE' : connecting ? 'CONNECTING LIVE' : 'YOU’RE IN THE QUEUE'}</p>
      <h1>{hasError ? 'Multiplayer is offline' : opponentOnline ? 'Opponent found!' : connecting ? 'Joining the lobby...' : 'Waiting for a rival...'}</h1>
      <p>{hasError ? error || 'Supabase environment variables are missing from this deployment.' : opponentOnline ? 'Both players are connected. Your match is starting.' : 'You’ll be matched as soon as another real player comes online'}</p>
      <div className="search-progress"><i style={{ width: `${progress}%` }} /></div>
      <div className="match-stats">
        <span className={opponentOnline ? 'opponent-count online' : 'opponent-count'}><Globe2 /> {opponentOnline ? 'Rival connected' : 'Waiting for another player'}</span>
        <span><Clock3 /> Waiting {secondsWaiting}s</span>
      </div>
      {!opponentOnline && !hasError && <p className="queue-note">Keep this tab open. We only start when two players are connected.</p>}
      <button className="text-button" onClick={onCancel}>Cancel search</button>
    </main>
  );
}

function Game({ player, match, onFinish, onExit }) {
  const questions = useRef(match.questions ?? getQuestionsForMatch(match.id)).current;
  const [questionIndex, setQuestionIndex] = useState(0);
  const [time, setTime] = useState(15);
  const [score, setScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [started, setStarted] = useState(Date.now() >= match.startsAt);
  const [opponentFinished, setOpponentFinished] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const transitionTimer = useRef(null);
  const localFinal = useRef(null);
  const remoteFinal = useRef(null);
  const deliveredResult = useRef(false);
  const opponentScoreRef = useRef(0);
  const question = questions[questionIndex];
  const opponent = match.opponent.name;

  useEffect(() => {
    const renderGameState = () => JSON.stringify({
      mode: 'live-match',
      player: { name: player, score },
      opponent: { name: opponent, score: opponentScore, connected: opponentConnected },
      round: questionIndex + 1,
      totalRounds: questions.length,
      question: question.q,
      category: question.category,
      choices: question.choices,
      secondsRemaining: time,
      answerLocked: selected !== null,
    });
    window.render_game_to_text = renderGameState;
    return () => {
      if (window.render_game_to_text === renderGameState) delete window.render_game_to_text;
    };
  }, [opponent, opponentConnected, opponentScore, player, question, questionIndex, questions.length, score, selected, time]);

  const deliverResult = useCallback((localScore, remoteScore) => {
    if (deliveredResult.current || localScore === null || remoteScore === null) return;
    deliveredResult.current = true;
    onFinish({ score: localScore, opponentScore: remoteScore });
  }, [onFinish]);

  const finishLocal = useCallback((finalScore) => {
    if (localFinal.current !== null) return;
    localFinal.current = finalScore;
    setFeedback(remoteFinal.current === null ? 'Finished! Waiting for your rival…' : 'Match complete!');
    match.channel.send({
      type: 'broadcast',
      event: 'finish',
      payload: { playerId: match.playerId, score: finalScore },
    });
    deliverResult(finalScore, remoteFinal.current);
  }, [deliverResult, match.channel, match.playerId]);

  const advance = useCallback((finalScore) => {
    if (questionIndex === questions.length - 1) {
      finishLocal(finalScore);
      return;
    }
    setQuestionIndex((i) => i + 1);
    setTime(15);
    setSelected(null);
    setFeedback('');
  }, [finishLocal, questionIndex, questions.length]);

  useEffect(() => {
    const delay = Math.max(0, match.startsAt - Date.now());
    const startTimer = setTimeout(() => setStarted(true), delay);

    const unsubscribe = match.events.subscribe((event, payload) => {
      if (event === 'score') {
        if (payload.playerId === match.playerId) return;
        opponentScoreRef.current = payload.score;
        setOpponentScore(payload.score);
      }
      if (event === 'finish') {
        if (payload.playerId === match.playerId) return;
        remoteFinal.current = payload.score;
        opponentScoreRef.current = payload.score;
        setOpponentScore(payload.score);
        setOpponentFinished(true);
        deliverResult(localFinal.current, payload.score);
      }
      if (event === 'presence') {
        const players = payload;
        setOpponentConnected(players.some((candidate) => candidate.playerId === match.opponent.id));
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(startTimer);
      clearTimeout(transitionTimer.current);
      match.channel.untrack();
      supabase.removeChannel(match.channel);
    };
  }, [deliverResult, match]);

  useEffect(() => {
    if (!started || selected !== null || localFinal.current !== null) return undefined;
    const timer = setInterval(() => setTime((t) => Math.max(0, +(t - 0.1).toFixed(1))), 100);
    return () => clearInterval(timer);
  }, [questionIndex, selected, started]);

  useEffect(() => {
    if (time > 0 || selected !== null) return;
    setSelected(-1);
    setFeedback('Time!');
    transitionTimer.current = setTimeout(() => advance(score), 750);
  }, [advance, score, selected, time]);

  function choose(index) {
    if (!started || selected !== null || localFinal.current !== null) return;
    setSelected(index);
    const correct = index === question.answer;
    const gain = correct ? 500 + Math.round(time * 45) : 0;
    const nextScore = score + gain;
    setScore(nextScore);
    setFeedback(correct ? `Correct! +${gain}` : 'Not quite!');
    match.channel.send({
      type: 'broadcast',
      event: 'score',
      payload: { playerId: match.playerId, score: nextScore, questionIndex },
    });
    transitionTimer.current = setTimeout(() => advance(nextScore), 850);
  }

  return (
    <main className="game-shell arena">
      <div className="game-header"><Logo /><span className="round-label"><i className={opponentConnected ? 'game-live-dot' : 'game-live-dot offline'} /> LIVE · ROUND {questionIndex + 1}/{questions.length}</span><button className="icon-button" aria-label="Exit game" onClick={onExit}><X /></button></div>
      <div className="scoreboard">
        <div className="game-player"><span className="avatar avatar-you">{player[0].toUpperCase()}</span><div><small>YOU</small><strong>{player}</strong></div><b>{score.toLocaleString()}</b></div>
        <div className="vs-badge">VS</div>
        <div className="game-player rival"><b>{opponentScore.toLocaleString()}</b><div><small>{opponentFinished ? 'FINISHED' : opponentConnected ? 'RIVAL · LIVE' : 'RECONNECTING'}</small><strong>{opponent}</strong></div><span className="avatar avatar-nova">{opponent[0]}</span></div>
      </div>
      <div className="game-progress"><i style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
      <section className="question-card">
        <div className="question-meta"><span><BrainCircuit size={15} /> {question.category.toUpperCase()}</span><span className={time < 5 ? 'timer timer-low' : 'timer'}><Clock3 size={17} /> {time.toFixed(1)}s</span></div>
        <h1>{question.q}</h1>
        <div className="game-answers">
          {question.choices.map((choice, index) => {
            let state = '';
            if (selected !== null && index === question.answer) state = 'correct';
            else if (selected === index) state = 'wrong';
            return <button className={state} key={choice} onClick={() => choose(index)} disabled={!started || selected !== null || localFinal.current !== null}><span>{String.fromCharCode(65 + index)}</span>{choice}{state === 'correct' && <Check />}{state === 'wrong' && <X />}</button>;
          })}
        </div>
        <div className={feedback ? 'feedback show' : 'feedback'}>{feedback || 'placeholder'}</div>
        {!started && <div className="match-countdown"><span>RIVAL CONNECTED</span><strong>Get ready…</strong></div>}
      </section>
    </main>
  );
}

function Results({ player, opponent, result, onRematch, onHome }) {
  const won = result.score >= result.opponentScore;
  const { xpGained = 0, streak = 0, totalXp = 0 } = result.matchStats || {};
  return (
    <main className="game-shell results-screen">
      <Logo />
      <div className={won ? 'result-emblem win' : 'result-emblem'}>{won ? <Trophy /> : <BrainCircuit />}</div>
      <p className="eyebrow">MATCH COMPLETE</p>
      <h1>{won ? 'Brilliant win!' : 'So close. Run it back?'}</h1>
      <p>{won ? 'Fast thinking pays off. Your rank is moving up.' : 'Every match sharpens the mind. Your next rival is waiting.'}</p>
      <div className="result-card">
        <div><span className="avatar avatar-you">{player[0].toUpperCase()}</span><strong>{player}</strong><b>{result.score.toLocaleString()}</b></div>
        <span className="result-vs">{won ? 'WIN' : 'GG'}</span>
        <div><span className="avatar avatar-nova">{opponent[0]}</span><strong>{opponent}</strong><b>{result.opponentScore.toLocaleString()}</b></div>
      </div>
      {result.matchStats && <div className="reward-row"><span><Zap /> +{xpGained} score</span><span><BarChart3 /> {totalXp.toLocaleString()} total score</span><span><Bolt /> {streak} streak</span></div>}
      <div className="result-actions"><button className="button" onClick={onRematch}><Play size={17} /> Play again</button><button className="button button-secondary" onClick={onHome}>Back home</button></div>
    </main>
  );
}

function Landing({ accountName, accountRank, authNotice, onNoticeClose, onlineCount, gamesPlayed, registeredUsers, leaders, onGuest, onCreate, onLogin, onLogout, onAccountPlay }) {
  return (
    <div id="top">
      <Header accountName={accountName} onGuest={onGuest} onCreate={onCreate} onLogin={onLogin} onLogout={onLogout} onAccountPlay={onAccountPlay} />
      {authNotice && <div className="auth-notice" role="status">{authNotice}<button onClick={onNoticeClose} aria-label="Dismiss"><X size={16} /></button></div>}
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="social-proof">
              <Globe2 size={22} />
              <span>{onlineCount !== null ? <><b>{onlineCount.toLocaleString()}</b> online now</> : <><b>Live</b> matchmaking is online</>}</span>
              {gamesPlayed !== null && <span className="games-played-chip"><Zap size={12} /> <b>{gamesPlayed.toLocaleString()}</b> matches completed all time</span>}
              {registeredUsers !== null && <span className="games-played-chip"><CircleUserRound size={12} /> <b>{registeredUsers.toLocaleString()}</b> accounts created</span>}
            </div>
            <p className="eyebrow">REAL-TIME STEM SHOWDOWNS</p>
            <h1>Think fast.<br />Win <em>faster.</em></h1>
            <p className="hero-sub">Go head-to-head in rapid-fire STEM battles. Outsmart real opponents, climb the universal ranks, and prove your brain has game.</p>
            <div className="hero-actions">
              <button className="button button-large" onClick={accountName ? onAccountPlay : onGuest}><Play fill="currentColor" size={18} /> {accountName ? 'Play with my account' : 'Play as guest'}</button>
              {accountName ? <span className="signed-in-copy"><Check /> Signed in as <b>{accountName}</b></span> : <button className="button button-secondary button-large" onClick={onCreate}>Create account <ArrowRight size={18} /></button>}
            </div>
            <p className="fine-print"><Check size={14} /> Free to play <Check size={14} /> No download <Check size={14} /> Match in seconds</p>
          </div>
          <BattleCard />
        </section>

        <section className="ticker" aria-label="Popular STEM categories"><div><span><Atom /> PHYSICS</span><i>✦</i><span><FlaskConical /> CHEMISTRY</span><i>✦</i><span><Orbit /> SPACE</span><i>✦</i><span><BrainCircuit /> BIOLOGY</span><i>✦</i><span><Bolt /> MATHEMATICS</span></div></section>

        <section className="how-section" id="how">
          <div className="section-heading"><p className="eyebrow">YOUR BRAIN. THEIR CLOCK.</p><h2>Three steps to glory.</h2><p>No tutorials. No waiting rooms. Just pure knowledge under pressure.</p></div>
          <div className="steps">
            <article><span className="step-number">01</span><div className="step-icon"><CircleUserRound /></div><h3>Pick your identity</h3><p>Create an account to save your rank, or jump in instantly as a named guest.</p><ChevronRight /></article>
            <article className="featured-step"><span className="step-number">02</span><div className="step-icon"><Globe2 /></div><h3>Meet your match</h3><p>We pair you live with a challenger at your skill level. The countdown starts.</p><ChevronRight /></article>
            <article><span className="step-number">03</span><div className="step-icon"><Zap /></div><h3>Answer. Faster.</h3><p>Correct answers score. Fast answers score more. Win, streak, and rise.</p></article>
          </div>
        </section>

        <section className="leader-section" id="leaderboard">
          <div className="rank-callout"><p className="eyebrow">ONE PLANET. ONE RANK.</p><h2>How smart<br />is the world?</h2><p>Every account has a global rank. Scores from signed-in battles move that rank; guest battles count toward the match total but are not attached to an account.</p><div className="rank-stat"><Trophy /><span><b>{gamesPlayed === null ? 'Loading live total…' : `${gamesPlayed.toLocaleString()} matches completed`}</b><small>Verified from recorded match IDs</small></span></div><button className="button button-light" onClick={accountName ? onAccountPlay : onCreate}>{accountName ? 'Play a ranked match' : 'Claim your rank'} <ArrowRight /></button></div>
          <div className="leaderboard-card">
            <div className="leader-header"><div><span className="live-pill"><i /> LIVE</span><h3>Global leaderboard</h3></div><span>ALL TIME</span></div>
            <div className="leader-cols"><span>RANK & ACCOUNT</span><span>WINS</span><span>SCORE</span></div>
            {Array.isArray(leaders) && leaders.map((leader) => <div className="leader-row" key={leader.id}><span className={leader.rank_position <= 3 ? 'leader-rank top' : 'leader-rank'}>{leader.rank_position}</span><span className="leader-avatar">{leader.battle_name[0].toUpperCase()}</span><strong>{leader.battle_name}{leader.rank_position === 1 && <Crown size={14} />}</strong><span className="streak">{leader.wins.toLocaleString()}</span><b>{leader.total_score.toLocaleString()}</b></div>)}
            {leaders === null && <div className="leader-empty"><Globe2 /><strong>Loading live rankings…</strong><span>Connecting to the global leaderboard.</span></div>}
            {leaders === false && <div className="leader-empty"><Globe2 /><strong>Rankings temporarily unavailable</strong><span>Live data could not be loaded. Please try again shortly.</span></div>}
            {Array.isArray(leaders) && leaders.length === 0 && <div className="leader-empty"><Trophy /><strong>No ranked matches yet</strong><span>Create an account and finish a battle to set the first real score.</span></div>}
            <div className="your-rank"><span>{accountRank ? `#${accountRank.rank_position}` : '—'}</span><span className="leader-avatar">{accountName ? accountName[0].toUpperCase() : 'Y'}</span><strong>{accountRank ? `${accountRank.total_score.toLocaleString()} score · ${accountRank.matches_played.toLocaleString()} ranked matches` : accountName ? 'Loading your global rank' : 'Sign in to earn a global rank'}</strong><button onClick={accountName ? onAccountPlay : onCreate}>{accountName ? 'PLAY' : 'JOIN'} <ArrowRight /></button></div>
          </div>
        </section>

        <section className="final-cta"><div className="cta-orbit orbit-one" /><div className="cta-orbit orbit-two" /><span className="cta-icon"><Rocket /></span><p className="eyebrow">YOUR NEXT RIVAL IS ONLINE</p><h2>Ready to put your<br />brain on the board?</h2><p>One name. Five questions. Infinite bragging rights.</p><button className="button button-large" onClick={accountName ? onAccountPlay : onGuest}><Play fill="currentColor" /> {accountName ? 'Play a ranked match' : 'Start battling — it’s free'}</button></section>
      </main>
      <footer><Logo /><p>Competitive STEM for curious minds everywhere.</p><span>© 2026 Stemegle</span></footer>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('landing');
  const [modal, setModal] = useState(null);
  const [player, setPlayer] = useState('');
  const [opponent, setOpponent] = useState('');
  const [match, setMatch] = useState(null);
  const [result, setResult] = useState(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authNotice, setAuthNotice] = useState('');
  const { onlineCount, gamesPlayed, registeredUsers, leaders, accountRank } = useLiveStats(session?.user?.id);
  const fromConfirmLink = useRef(
    window.location.hash.includes('access_token') ||
    Boolean(new URLSearchParams(window.location.search).get('code'))
  );
  const handleMatched = useCallback((matchData) => { setMatch(matchData); setOpponent(matchData.opponent.name); setScreen('game'); }, []);
  const handleFinish = useCallback(async (data) => {
    let matchStats = null;
    try {
      matchStats = await recordMatchResult(match?.id, data.score, data.opponentScore);
    } catch (error) {
      console.error('Could not persist match result', error);
    }
    setResult({ ...data, matchStats });
    setScreen('results');
  }, [match?.id]);

  useEffect(() => {
    const renderAppState = () => JSON.stringify({
      mode: screen,
      player: player || null,
      opponent: opponent || null,
      matchId: match?.id ?? null,
    });
    window.render_game_to_text = renderAppState;
    return () => {
      if (window.render_game_to_text === renderAppState) delete window.render_game_to_text;
    };
  }, [match?.id, opponent, player, screen]);

  useEffect(() => {
    if (!supabase) return undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      if (event === 'SIGNED_IN' && fromConfirmLink.current) {
        fromConfirmLink.current = false;
        const name = nextSession?.user?.user_metadata?.battle_name
          || nextSession?.user?.email?.split('@')[0]
          || 'Player';
        setAuthNotice(`Email confirmed! You're now signed in as ${name}.`);
        window.history.replaceState(null, '', window.location.pathname);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const accountName = session?.user?.user_metadata?.battle_name
    || session?.user?.email?.split('@')[0]
    || '';

  function start(name) { setPlayer(name); setModal(null); setScreen('matchmaking'); }
  function playAccount() { if (accountName) start(accountName); else setModal('login'); }
  function rematch() { setResult(null); setMatch(null); setScreen('matchmaking'); }
  function home() { setScreen('landing'); setResult(null); setMatch(null); setOpponent(''); }
  async function logout() { await supabase?.auth.signOut(); home(); }

  if (screen === 'matchmaking') return <Matchmaking name={player} onMatched={handleMatched} onCancel={home} />;
  if (screen === 'game' && match) return <Game player={player} match={match} onFinish={handleFinish} onExit={home} />;
  if (screen === 'results') return <Results player={player} opponent={opponent} result={result} onRematch={rematch} onHome={home} />;
  return <>
    <Landing accountName={authReady ? accountName : ''} accountRank={accountRank} authNotice={authNotice} onNoticeClose={() => setAuthNotice('')} onlineCount={onlineCount} gamesPlayed={gamesPlayed} registeredUsers={registeredUsers} leaders={leaders} onGuest={() => setModal('guest')} onCreate={() => setModal('create')} onLogin={() => setModal('login')} onLogout={logout} onAccountPlay={playAccount} />
    {modal && <EntryModal mode={modal} onClose={() => setModal(null)} onGuestStart={start} onAuthSuccess={() => setModal(null)} onSwitch={setModal} />}
  </>;
}
