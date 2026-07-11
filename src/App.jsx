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
  Copy,
  GitBranch,
  Medal,
  Menu,
  MessageCircle,
  Orbit,
  Play,
  Rocket,
  Shuffle,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { fetchGamesPlayed, fetchLeaderboard, fetchRegisteredUsers, getPresencePlayers, hasRealtimeConfig, recordBotMatch, recordMatchResult, supabase } from './lib/supabase';
import { getQuestionsForMatch } from './data/questions';

const LOBBY_CHANNEL = 'stemegle:lobby:v1';
const AUTH_REDIRECT_URL = import.meta.env.VITE_SITE_URL || window.location.origin;
const PARTY_PREFIX = 'stemegle:party:';
const PARTY_CODE_LENGTH = 5;
const PARTY_HEARTBEAT_INTERVAL_MS = 5000;
// Background tabs throttle timers to ~1/minute, so anything under ~2 minutes
// risks kicking players who simply switched tabs. Supabase presence removes
// truly disconnected players much sooner; this is only a zombie-tab backstop.
const PARTY_PRESENCE_STALE_MS = 130000;

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

function createPartyCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(PARTY_CODE_LENGTH);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function normalizePartyCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PARTY_CODE_LENGTH);
}

function getPartyCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizePartyCode(params.get('party') || '');
}

function getPartyQuestions(seed, count) {
  const questions = [];
  let batch = 0;
  while (questions.length < count) {
    const needed = count - questions.length;
    questions.push(...getQuestionsForMatch(`${seed}:party:${batch}`, Math.min(needed, 5)));
    batch += 1;
  }
  return questions.slice(0, count);
}

function comparePartyPlayers(a, b) {
  const joinedA = Number.isFinite(a.joinedAt) ? a.joinedAt : Number.MAX_SAFE_INTEGER;
  const joinedB = Number.isFinite(b.joinedAt) ? b.joinedAt : Number.MAX_SAFE_INTEGER;
  return joinedA - joinedB || a.playerId.localeCompare(b.playerId);
}

function splitPartyTeams(players) {
  const ordered = [...players].sort(comparePartyPlayers);
  const teamASize = Math.ceil(ordered.length / 2);
  return ordered.map((player, index) => ({
    ...player,
    team: index < teamASize ? 'A' : 'B',
  }));
}

function getPartyRoster(channel) {
  const uniquePlayers = new Map();
  getPresencePlayers(channel).forEach((presence) => {
    const existing = uniquePlayers.get(presence.playerId);
    if (!existing) {
      uniquePlayers.set(presence.playerId, presence);
      return;
    }
    uniquePlayers.set(presence.playerId, {
      ...existing,
      ...presence,
      joinedAt: Math.min(existing.joinedAt ?? Date.now(), presence.joinedAt ?? Date.now()),
      lastSeen: Math.max(existing.lastSeen ?? 0, presence.lastSeen ?? 0) || undefined,
      partyLeader: Boolean(existing.partyLeader || presence.partyLeader),
    });
  });
  return [...uniquePlayers.values()]
    .sort(comparePartyPlayers);
}

function electPartyLeader(players) {
  if (!players.length) return '';
  const creator = players.find((player) => player.partyLeader);
  if (creator) return creator.playerId;
  return [...players].sort(comparePartyPlayers)[0].playerId;
}

function createTeamPartyConfig(partyCode, players, leaderId) {
  const roster = splitPartyTeams(players);
  const turnsPerPlayer = roster.length <= 4 ? 2 : 1;
  const rounds = [];
  // The timestamp seeds fresh questions per rematch and namespaces round ids:
  // the party channel outlives games, so late broadcasts from a previous game
  // must never match this game's rounds. Every client plays from this
  // leader-generated config verbatim.
  const stamp = Date.now();
  for (let turn = 0; turn < turnsPerPlayer; turn += 1) {
    roster.forEach((player) => {
      rounds.push({
        id: `${stamp}-${turn}-${player.playerId}`,
        playerId: player.playerId,
        playerName: player.name,
        team: player.team,
        questionIndex: rounds.length,
      });
    });
  }
  return {
    id: `${partyCode}-team-${stamp}`,
    type: 'team',
    partyCode,
    leaderId,
    roster,
    rounds,
    questions: getPartyQuestions(`${partyCode}:team:${stamp}`, rounds.length),
    startsAt: stamp + 1800,
  };
}

function createTournamentPartyConfig(partyCode, players, leaderId) {
  const entrants = [...players].sort((a, b) => a.joinedAt - b.joinedAt || a.playerId.localeCompare(b.playerId));
  const stamp = Date.now();
  return {
    id: `${partyCode}-tournament-${stamp}`,
    type: 'tournament',
    partyCode,
    leaderId,
    entrants,
    questions: getPartyQuestions(`${partyCode}:tournament:${stamp}`, Math.max(entrants.length * 2, 6)),
    startsAt: stamp + 1800,
  };
}

function buildTournamentPairs(players) {
  const pairs = [];
  for (let index = 0; index < players.length; index += 2) {
    pairs.push(players.slice(index, index + 2));
  }
  return pairs;
}

function createEventBus() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event, payload) {
      listeners.forEach((listener) => listener(event, payload));
    },
  };
}

const BOT_NAMES = ['Astra', 'Quark', 'Cosmo', 'Vega', 'Turing', 'Kepler', 'Fermi'];
const BOT_CORRECT_CHANCE = 0.68;

// Builds a self-contained practice match against a simulated opponent. It uses
// the exact same shape the live Game component expects (channel/events/opponent)
// so the game screen needs no bot-specific rendering. The "channel" is a local
// stub and the "opponent" drives itself through an internal timeline.
function createBotMatch(playerName) {
  const events = createEventBus();
  const id = `bot-${createPlayerId()}`;
  const questions = getQuestionsForMatch(id);
  const startsAt = Date.now() + 2000;
  const botName = `${BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]} (bot)`;
  const timers = [];

  // Pre-roll the bot's answers so its running score and finish are deterministic
  // once the match starts. Timing mirrors the human's per-question scoring.
  let runningScore = 0;
  let offset = 0;
  const timeline = questions.map((_, index) => {
    const answerSeconds = 2 + Math.random() * 5; // bot "thinks" 2–7s
    const correct = Math.random() < BOT_CORRECT_CHANCE;
    const gain = correct ? 500 + Math.round((15 - answerSeconds) * 45) : 0;
    runningScore += gain;
    offset += answerSeconds * 1000 + 850; // answer time + transition
    return { at: offset, score: runningScore, last: index === questions.length - 1 };
  });

  const channel = {
    send() {},
    untrack() {
      timers.forEach(clearTimeout);
      timers.length = 0;
    },
  };

  // Kick off the bot's timeline aligned to the shared countdown.
  const base = Math.max(0, startsAt - Date.now());
  timeline.forEach((step, index) => {
    timers.push(setTimeout(() => {
      events.emit('score', { playerId: 'bot', score: step.score, questionIndex: index });
      if (step.last) events.emit('finish', { playerId: 'bot', score: step.score });
    }, base + step.at));
  });

  return {
    id,
    isBot: true,
    channel,
    events,
    playerId: createPlayerId(),
    opponent: { id: 'bot', name: botName },
    startsAt,
    questions,
  };
}

// Dialog accessibility (WCAG 2.1.2 / dialog pattern): close on Escape, keep
// Tab focus inside the dialog, focus it on open, and restore focus on close.
function useDialogA11y(onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const node = dialogRef.current;
    const previouslyFocused = document.activeElement;
    if (node && !node.contains(document.activeElement)) {
      const target = node.querySelector('input, select, textarea, button:not(.modal-close)') || node;
      target.focus?.();
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const focusables = [...node.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
        .filter((el) => !el.disabled && el.getClientRects().length > 0);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);
  return dialogRef;
}

function Logo() {
  return <a className="logo" href="#top" aria-label="Stemegle home"><span className="logo-mark"><Atom size={22} /></span><span>stemegle</span></a>;
}

const CHAT_MAX_LENGTH = 240;
const CHAT_HISTORY_CAP = 100;

// Appends a chat message, deduping by id — messages are appended optimistically
// on send AND echoed back by the channel (broadcast self: true), so the id
// check keeps exactly one copy.
function appendChatMessage(current, msg) {
  if (!msg?.id || typeof msg.text !== 'string' || !msg.text.trim()) return current;
  if (current.some((existing) => existing.id === msg.id)) return current;
  return [...current.slice(-(CHAT_HISTORY_CAP - 1)), { ...msg, text: msg.text.slice(0, CHAT_MAX_LENGTH) }];
}

function ChatDock({ title, scopeLabel, messages, onSend, selfId }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const listRef = useRef(null);
  const seenCount = useRef(messages.length);

  useEffect(() => {
    if (open) {
      setUnread(0);
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    } else if (messages.length > seenCount.current) {
      setUnread((count) => count + (messages.length - seenCount.current));
    }
    seenCount.current = messages.length;
  }, [messages, open]);

  function submit(event) {
    event.preventDefault();
    const trimmed = text.trim().slice(0, CHAT_MAX_LENGTH);
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label={`Open ${title} chat`}>
        <MessageCircle size={17} /> Chat{unread > 0 && <i className="chat-unread">{unread > 9 ? '9+' : unread}</i>}
      </button>
    );
  }

  return (
    <section className="chat-dock" aria-label={`${title} chat`}>
      <div className="chat-head">
        <strong><MessageCircle size={14} /> {title}</strong>
        <button onClick={() => setOpen(false)} aria-label="Minimize chat"><X size={15} /></button>
      </div>
      <div className="chat-list" ref={listRef} role="log" aria-live="polite">
        {messages.length === 0 && <p className="chat-empty">Say hi — only {scopeLabel} can see these messages.</p>}
        {messages.map((msg) => (
          <div key={msg.id} className={msg.playerId === selfId ? 'chat-msg own' : 'chat-msg'}>
            <small>{msg.playerId === selfId ? 'You' : msg.name}</small>
            <span>{msg.text}</span>
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a message…" maxLength={CHAT_MAX_LENGTH} aria-label="Chat message" />
        <button type="submit" disabled={!text.trim()} aria-label="Send message"><ArrowRight size={16} /></button>
      </form>
    </section>
  );
}

function CloudflareBadge() {
  return (
    <span className="cloudflare-badge" aria-label="Protected by Cloudflare">
      <svg className="cloudflare-logo" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
        <path fill="#f6821f" d="M45.7 17.5c-.8-7.2-7-12.8-14.5-12.8-6.1 0-11.4 3.7-13.6 9-5.2.2-9.4 4.5-9.4 9.8 0 .9.1 1.7.3 2.5h37.3c2.4 0 4.3-1.9 4.3-4.3s-2-4.2-4.4-4.2Z" />
        <path fill="#fbad41" d="M48.8 19.7h-1.1c-.4 0-.8.3-.9.7l-.6 2.1c-.2.6.3 1.2.9 1.2h12.3c1.9 0 3.5-1.6 3.5-3.5s-1.6-3.5-3.5-3.5c-.9 0-1.7.3-2.3.9-1.4-3.6-4.9-6.2-9-6.2-1.2 0-2.3.2-3.4.6 2.2 1.8 3.8 4.5 4.1 7.7Z" />
      </svg>
      <span>Protected by Cloudflare</span>
    </span>
  );
}

function Header({ accountName, onGuest, onCreate, onLogin, onLogout, onAccountPlay }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <Logo />
      <nav className={open ? 'nav open' : 'nav'} aria-label="Main navigation">
        <a href="#how" onClick={() => setOpen(false)}>How it works</a>
        <a href="#party" onClick={() => setOpen(false)}>Party</a>
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
      <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>{open ? <X /> : <Menu />}</button>
    </header>
  );
}

function BattleCard() {
  return (
    <div className="battle-wrap" aria-hidden="true">
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

function EntryModal({ mode, guestActionLabel = 'Find an opponent', guestDescription, onClose, onGuestStart, onAuthSuccess, onSwitch }) {
  const dialogRef = useDialogA11y(onClose);
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
      <div className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title" ref={dialogRef} tabIndex={-1}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <span className="modal-icon">{isGuest ? <Play /> : isLogin ? <Lock /> : <Rocket />}</span>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="entry-title">{title}</h2>
        <p>{isGuest ? guestDescription || 'No account, no fuss. Pick a name and jump straight into a match.' : isLogin ? 'Log in securely to continue with your saved identity.' : 'Protect your account with a password and keep your player identity across devices.'}</p>
        <form onSubmit={submit}>
          {!isLogin && <label>Battle name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ProtonPilot" maxLength={18} autoComplete="nickname" /></label>}
          {!isGuest && <label>Email address<input autoFocus={isLogin} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>}
          {!isGuest && (
            <label>Password
              <span className="password-field">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isLogin ? 'Enter your password' : 'At least 8 characters'} autoComplete={isLogin ? 'current-password' : 'new-password'} aria-describedby={!isGuest && !isLogin ? 'pw-requirements' : undefined} />
                <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button>
              </span>
            </label>
          )}
          {!isGuest && !isLogin && <label>Confirm password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" /></label>}
          {!isGuest && !isLogin && <p id="pw-requirements" className={password && !passwordStrong ? 'password-rule invalid' : 'password-rule'}><Lock aria-hidden="true" /> Use 8+ characters with at least one letter and one number.</p>}
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {notice && <p className="auth-message success" role="status">{notice}</p>}
          <button type="submit" className="button button-wide" disabled={!valid || loading}>{loading ? 'Please wait…' : isGuest ? guestActionLabel : isLogin ? 'Log in' : 'Create account'} {!loading && <ArrowRight size={18} />}</button>
        </form>
        <small className="privacy"><Lock size={12} /> {isGuest ? 'Guest progress lasts for this session.' : 'Passwords are handled securely by Supabase Auth.'}</small>
        {!isGuest && <button className="auth-switch" onClick={() => switchMode(isLogin ? 'create' : 'login')}>{isLogin ? 'New here? Create an account' : 'Already have an account? Log in'}</button>}
      </div>
    </div>
  );
}

function Matchmaking({ name, onMatched, onPlayBot, onCancel }) {
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
        .on('broadcast', { event: 'chat' }, ({ payload }) => events.emit('chat', payload))
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
  // Offer a practice match against the bot once the wait is long enough, or
  // right away if the live lobby is unreachable.
  const offerBot = !opponentOnline && (secondsWaiting >= 10 || hasError);

  return (
    <main className="game-shell matchmaking-screen">
      <Logo />
      <div className="radar" aria-hidden="true"><span className="radar-ring r1" /><span className="radar-ring r2" /><span className="radar-ring r3" /><span className="radar-sweep" /><span className="avatar avatar-you radar-avatar">{name[0].toUpperCase()}</span></div>
      <p className="eyebrow"><i className="status-dot" /> {hasError ? 'CONNECTION NEEDED' : opponentOnline ? 'OPPONENT ONLINE' : connecting ? 'CONNECTING LIVE' : 'YOU’RE IN THE QUEUE'}</p>
      <h1 aria-live="polite">{hasError ? 'Multiplayer is offline' : opponentOnline ? 'Opponent found!' : connecting ? 'Joining the lobby...' : 'Waiting for a rival...'}</h1>
      <p>{hasError ? error || 'Supabase environment variables are missing from this deployment.' : opponentOnline ? 'Both players are connected. Your match is starting.' : 'You’ll be matched as soon as another real player comes online'}</p>
      <div className="search-progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={opponentOnline ? 'Opponent found — match ready' : 'Searching for opponent'}><i style={{ width: `${progress}%` }} /></div>
      <div className="match-stats">
        <span className={opponentOnline ? 'opponent-count online' : 'opponent-count'}><Globe2 /> {opponentOnline ? 'Rival connected' : 'Waiting for another player'}</span>
        <span><Clock3 /> Waiting {secondsWaiting}s</span>
      </div>
      {offerBot && (
        <div className="bot-offer">
          <p>{hasError ? "Multiplayer is offline right now." : "We couldn't find an available player."} Play against a bot?</p>
          <button className="button" onClick={onPlayBot}><BrainCircuit size={17} /> Play against bot</button>
          <small>Practice match — counts toward matches played, but not ranked score.</small>
        </div>
      )}
      {!opponentOnline && !hasError && <p className="queue-note">Keep this tab open, or jump into a bot match anytime.</p>}
      <button className="text-button" onClick={onCancel}>Cancel search</button>
    </main>
  );
}

function usePartyConnection({ code, name, playerIdRef, createdPartyCodeRef, onGameStart }) {
  const [players, setPlayers] = useState([]);
  const [leaderId, setLeaderId] = useState('');
  const [status, setStatus] = useState(hasRealtimeConfig ? 'idle' : 'configuration-error');
  const [error, setError] = useState('');
  // Group chat for the whole party. Lives at the connection level so it
  // survives games and screen changes; it resets only when the party code
  // changes (joining, leaving, or creating a new party).
  const [chat, setChat] = useState([]);
  const channelRef = useRef(null);
  const eventsRef = useRef(createEventBus());
  const heartbeatsRef = useRef({});
  const joinedAtRef = useRef(Date.now());
  const nameRef = useRef(name);
  const onGameStartRef = useRef(onGameStart);

  useEffect(() => {
    nameRef.current = name;
    onGameStartRef.current = onGameStart;
  });

  useEffect(() => {
    if (!hasRealtimeConfig) return undefined;
    if (!code) {
      setPlayers([]);
      setLeaderId('');
      setStatus('idle');
      setError('');
      setChat([]);
      return undefined;
    }

    let active = true;
    setStatus('connecting');
    setError('');
    setChat([]);
    heartbeatsRef.current = {};
    joinedAtRef.current = Date.now();
    const channel = supabase.channel(`${PARTY_PREFIX}${code}`, {
      config: {
        presence: { key: playerIdRef.current },
        broadcast: { self: true, ack: true },
      },
    });
    channelRef.current = channel;

    const selfPresence = (at) => ({
      playerId: playerIdRef.current,
      name: nameRef.current,
      joinedAt: joinedAtRef.current,
      partyLeader: createdPartyCodeRef.current === code,
      lastSeen: at,
    });
    setPlayers([selfPresence(Date.now())]);
    setLeaderId(createdPartyCodeRef.current === code ? playerIdRef.current : '');

    const refreshPresence = () => {
      const roster = getPartyRoster(channel);
      const now = Date.now();
      const observed = heartbeatsRef.current;
      // Staleness is judged by the local time we last saw a player's heartbeat
      // change — never by their clock, which can be skewed past the stale window.
      roster.forEach((partyPlayer) => {
        const entry = observed[partyPlayer.playerId];
        if (!entry || entry.stamp !== partyPlayer.lastSeen) {
          observed[partyPlayer.playerId] = { stamp: partyPlayer.lastSeen, at: now };
        }
      });
      const liveRoster = roster.filter((partyPlayer) => {
        if (partyPlayer.playerId === playerIdRef.current) return true;
        const entry = observed[partyPlayer.playerId];
        return now - (entry?.at ?? now) <= PARTY_PRESENCE_STALE_MS;
      });
      // Presence sync can lag our own track(); keep ourselves in the roster so
      // the party never renders empty or leaderless for the local player.
      if (!liveRoster.some((partyPlayer) => partyPlayer.playerId === playerIdRef.current)) {
        liveRoster.push(selfPresence(now));
        liveRoster.sort(comparePartyPlayers);
      }
      setPlayers(liveRoster);
      setLeaderId(electPartyLeader(liveRoster));
    };

    const sendHeartbeat = () => {
      channel.track(selfPresence(Date.now()));
      refreshPresence();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') sendHeartbeat();
    };

    channel
      .on('presence', { event: 'sync' }, refreshPresence)
      .on('broadcast', { event: 'party-start' }, ({ payload }) => {
        if (!active || !payload?.config) return;
        onGameStartRef.current?.({
          ...payload.config,
          channel,
          events: eventsRef.current,
          playerId: playerIdRef.current,
        });
      })
      .on('broadcast', { event: 'party-answer' }, ({ payload }) => eventsRef.current.emit('answer', payload))
      .on('broadcast', { event: 'party-timeout' }, ({ payload }) => eventsRef.current.emit('timeout', payload))
      .on('broadcast', { event: 'party-duel-answer' }, ({ payload }) => eventsRef.current.emit('duel-answer', payload))
      .on('broadcast', { event: 'party-duel-result' }, ({ payload }) => eventsRef.current.emit('duel-result', payload))
      .on('broadcast', { event: 'party-chat' }, ({ payload }) => {
        if (active) setChat((current) => appendChatMessage(current, payload));
      })
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          setStatus('ready');
          sendHeartbeat();
        }
        if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
          setStatus('error');
          setError('Unable to connect to this party. Check the code and try again.');
        }
      });

    const heartbeatTimer = setInterval(sendHeartbeat, PARTY_HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      channel.untrack();
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  // The channel lives at the app level for as long as the party code does, so
  // finishing a game or navigating between screens never disconnects the
  // party. `name` and `onGameStart` are read through refs so parent re-renders
  // never tear down the subscription — that teardown is what kicked players.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const sendChat = useCallback((text) => {
    const channel = channelRef.current;
    if (!channel) return;
    const msg = { id: createPlayerId(), playerId: playerIdRef.current, name: nameRef.current, text, at: Date.now() };
    setChat((current) => appendChatMessage(current, msg));
    channel.send({ type: 'broadcast', event: 'party-chat', payload: msg });
  }, [playerIdRef]);

  return { players, leaderId, status, error, channelRef, events: eventsRef.current, chat, sendChat };
}

function PartyRoom({ partyCode, party, playerId, onCreateParty, onJoinParty, onLeaveParty, onCancel }) {
  const [joinCode, setJoinCode] = useState(partyCode);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const { players, leaderId, status } = party;

  useEffect(() => {
    setJoinCode(partyCode);
    setError('');
  }, [partyCode]);

  const isLeader = leaderId === playerId;
  const teamPreview = players.length >= 2 ? splitPartyTeams(players) : [];
  const teamACount = teamPreview.filter((player) => player.team === 'A').length;
  const teamBCount = teamPreview.filter((player) => player.team === 'B').length;
  const inviteLink = partyCode ? `${window.location.origin}${window.location.pathname}?party=${partyCode}` : '';

  function submitJoin(event) {
    event.preventDefault();
    const code = normalizePartyCode(joinCode);
    if (code.length !== PARTY_CODE_LENGTH) {
      setError('Enter a valid 5-character party code.');
      return;
    }
    setError('');
    onJoinParty(code);
  }

  async function copyInvite() {
    if (!inviteLink) return;
    await navigator.clipboard?.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function startTeamBattle() {
    if (!isLeader || players.length < 2 || !party.channelRef.current) return;
    const config = createTeamPartyConfig(partyCode, players, leaderId);
    party.channelRef.current.send({ type: 'broadcast', event: 'party-start', payload: { config } });
  }

  function startTournament() {
    if (!isLeader || players.length < 2 || !party.channelRef.current) return;
    const config = createTournamentPartyConfig(partyCode, players, leaderId);
    party.channelRef.current.send({ type: 'broadcast', event: 'party-start', payload: { config } });
  }

  const hasError = status === 'error' || status === 'configuration-error';
  const displayError = error || party.error;

  return (
    <main className="game-shell party-screen">
      <Logo />
      <button className="icon-button" aria-label="Back home (you stay in the party)" onClick={onCancel}><X /></button>
      <section className="party-card">
        <span className="modal-icon"><Users /></span>
        <p className="eyebrow">{partyCode ? 'FRIEND PARTY' : 'PLAY WITH FRIENDS'}</p>
        <h1>{partyCode ? `Party ${partyCode}` : 'Create or join a party'}</h1>
        <p>{partyCode ? 'Share the code, wait for friends to appear, then the party leader chooses the game type. The party stays together between games.' : 'Create a private party code or paste a friend’s code to join their room.'}</p>

        {(hasError || error) && <p className="auth-message error" role="alert">{displayError || 'Supabase realtime is not configured for parties on this deployment.'}</p>}

        {!partyCode && (
          <div className="party-entry-grid">
            <button className="button button-large" onClick={onCreateParty} disabled={!hasRealtimeConfig}><Users /> Create party</button>
            <form onSubmit={submitJoin} className="party-join-form">
              <label>Party code<input value={joinCode} onChange={(event) => setJoinCode(normalizePartyCode(event.target.value))} placeholder="ABCDE" maxLength={PARTY_CODE_LENGTH} /></label>
              <button className="button button-secondary" type="submit" disabled={!hasRealtimeConfig}>Join party <ArrowRight /></button>
            </form>
          </div>
        )}

        {partyCode && (
          <>
            <div className="party-invite">
              <div><small>INVITE LINK</small><strong>{inviteLink}</strong></div>
              <button className="button button-small" onClick={copyInvite}><Copy size={15} /> {copied ? 'Copied' : 'Copy'}</button>
            </div>

            <div className="party-roster">
              <div className="party-roster-head"><span>{players.length} in party</span><small>{isLeader ? 'You are the leader' : leaderId ? `${players.find((member) => member.playerId === leaderId)?.name ?? 'A friend'} is the leader` : 'Waiting for party leader'}</small></div>
              {players.map((player) => (
                <div className="party-player" key={player.playerId}>
                  <span className="leader-avatar">{player.name[0].toUpperCase()}</span>
                  <strong>{player.name}</strong>
                  {player.playerId === leaderId && <small>LEADER</small>}
                </div>
              ))}
            </div>

            <div className="party-modes">
              <article className="party-mode">
                <span><Swords /></span>
                <h3>Team Battle · {players.length >= 2 ? `${teamACount}v${teamBCount}` : 'XvX'}</h3>
                <p>Splits the party into two teams. Everyone answers in rotation, and small parties get up to two turns each.</p>
                <button className="button" onClick={startTeamBattle} disabled={!isLeader || players.length < 2}>Start team battle</button>
              </article>
              <article className="party-mode">
                <span><GitBranch /></span>
                <h3>Tournament</h3>
                <p>Runs live 1v1 bracket duels. Winners advance until one party champion remains.</p>
                <button className="button" onClick={startTournament} disabled={!isLeader || players.length < 2}>Start tournament</button>
              </article>
            </div>
            {status === 'connecting' && <p className="queue-note">Connecting to party…</p>}
            {!isLeader && <p className="queue-note">Only the party leader can choose and start the game type.</p>}
            {isLeader && players.length < 2 && <p className="queue-note">Invite at least one friend to unlock party games.</p>}
            <div className="party-footer-actions">
              <button className="button button-secondary party-new-button" onClick={onCreateParty} disabled={!hasRealtimeConfig}><Shuffle size={16} /> Start a new party</button>
              <button className="button party-leave-button" onClick={onLeaveParty}><X size={16} /> Leave party</button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function PartyPill({ code, count, onReturn, onLeave }) {
  return (
    <div className="party-pill">
      <button className="party-pill-main" onClick={onReturn} aria-label={`You are in party ${code} with ${count} ${count === 1 ? 'player' : 'players'}. Return to the party.`}>
        <span className="party-pill-icon"><Users size={17} /></span>
        <span className="party-pill-text"><small><i /> IN PARTY · {count} {count === 1 ? 'PLAYER' : 'PLAYERS'}</small><strong>Party {code}</strong></span>
        <ArrowRight size={16} />
      </button>
      <button className="party-pill-leave" onClick={onLeave} aria-label="Leave party" title="Leave party"><X size={15} /></button>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }) {
  const dialogRef = useDialogA11y(onCancel);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="entry-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" ref={dialogRef} tabIndex={-1}>
        <button className="modal-close" onClick={onCancel} aria-label="Close"><X size={20} /></button>
        <span className="modal-icon"><Users /></span>
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="button button-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className="button party-leave-button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function PartyGame({ player, game, onFinish, onExit }) {
  if (game.type === 'tournament') {
    return <TournamentPartyGame player={player} game={game} onFinish={onFinish} onExit={onExit} />;
  }
  return <TeamPartyGame player={player} game={game} onFinish={onFinish} onExit={onExit} />;
}

function TeamPartyGame({ player, game, onFinish, onExit }) {
  const [roundIndex, setRoundIndex] = useState(0);
  const [time, setTime] = useState(15);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [scores, setScores] = useState({ A: 0, B: 0 });
  const [playerScores, setPlayerScores] = useState({});
  const [started, setStarted] = useState(Date.now() >= game.startsAt);
  const transitionTimer = useRef(null);
  const resolvedRounds = useRef(new Set());
  const round = game.rounds[roundIndex];
  const question = game.questions[round.questionIndex];
  const isActive = round.playerId === game.playerId;
  const teamA = game.roster.filter((member) => member.team === 'A');
  const teamB = game.roster.filter((member) => member.team === 'B');

  const resolveRound = useCallback((payload) => {
    if (!payload || payload.roundId !== round.id || resolvedRounds.current.has(payload.roundId)) return;
    resolvedRounds.current.add(payload.roundId);
    setSelected(payload.selected ?? -1);
    if (payload.correct) {
      setScores((current) => ({ ...current, [payload.team]: current[payload.team] + payload.gain }));
      setPlayerScores((current) => ({ ...current, [payload.playerId]: (current[payload.playerId] || 0) + payload.gain }));
      setFeedback(`${payload.playerName} scored +${payload.gain} for Team ${payload.team}`);
    } else {
      setFeedback(payload.timedOut ? `${payload.playerName} ran out of time.` : `${payload.playerName} missed it.`);
    }
    transitionTimer.current = setTimeout(() => {
      if (roundIndex === game.rounds.length - 1) {
        const finalScores = payload.correct
          ? { ...scores, [payload.team]: scores[payload.team] + payload.gain }
          : scores;
        const winner = finalScores.A === finalScores.B ? 'TIE' : finalScores.A > finalScores.B ? 'A' : 'B';
        onFinish({
          type: 'party-team',
          score: finalScores.A,
          opponentScore: finalScores.B,
          teamScores: finalScores,
          winner,
          summary: winner === 'TIE' ? 'Team battle tied.' : `Team ${winner} wins the party battle.`,
        });
        return;
      }
      setRoundIndex((index) => index + 1);
      setTime(15);
      setSelected(null);
      setFeedback('');
    }, 950);
  }, [game.rounds.length, onFinish, round.id, roundIndex, scores]);

  useEffect(() => {
    const delay = Math.max(0, game.startsAt - Date.now());
    const startTimer = setTimeout(() => setStarted(true), delay);
    const unsubscribe = game.events.subscribe((event, payload) => {
      if (event === 'answer' || event === 'timeout') resolveRound(payload);
    });
    return () => {
      unsubscribe();
      clearTimeout(startTimer);
    };
  }, [game, resolveRound]);

  // The party connection owns the channel; the game only borrows it, so the
  // party survives after the game ends.
  useEffect(() => () => clearTimeout(transitionTimer.current), []);

  useEffect(() => {
    const renderGameState = () => JSON.stringify({
      mode: 'party-team',
      player,
      round: roundIndex + 1,
      totalRounds: game.rounds.length,
      activePlayer: round.playerName,
      activeTeam: round.team,
      teamScores: scores,
      question: question.q,
      choices: question.choices,
      answerLocked: selected !== null,
    });
    window.render_game_to_text = renderGameState;
    return () => {
      if (window.render_game_to_text === renderGameState) delete window.render_game_to_text;
    };
  }, [game.rounds.length, player, question, round, roundIndex, scores, selected]);

  useEffect(() => {
    if (!started || selected !== null || resolvedRounds.current.has(round.id)) return undefined;
    const timer = setInterval(() => setTime((value) => Math.max(0, +(value - 0.1).toFixed(1))), 100);
    return () => clearInterval(timer);
  }, [round.id, selected, started]);

  useEffect(() => {
    if (time > 0 || selected !== null || resolvedRounds.current.has(round.id)) return;
    game.channel.send({
      type: 'broadcast',
      event: 'party-timeout',
      payload: {
        roundId: round.id,
        playerId: round.playerId,
        playerName: round.playerName,
        team: round.team,
        correct: false,
        gain: 0,
        selected: -1,
        timedOut: true,
      },
    });
  }, [game.channel, round, selected, time]);

  function choose(index) {
    if (!started || !isActive || selected !== null || resolvedRounds.current.has(round.id)) return;
    const correct = index === question.answer;
    const gain = correct ? 500 + Math.round(time * 45) : 0;
    game.channel.send({
      type: 'broadcast',
      event: 'party-answer',
      payload: {
        roundId: round.id,
        playerId: game.playerId,
        playerName: round.playerName,
        team: round.team,
        correct,
        gain,
        selected: index,
      },
    });
  }

  return (
    <main className="game-shell arena party-game">
      <div className="game-header"><Logo /><span className="round-label"><i className="game-live-dot" /> PARTY TEAM · ROUND {roundIndex + 1}/{game.rounds.length}</span><button className="icon-button" aria-label="Exit party game" onClick={onExit}><X /></button></div>
      <div className="party-scoreboard">
        <div><small>TEAM A</small><strong>{scores.A.toLocaleString()}</strong><span>{teamA.map((member) => member.name).join(', ')}</span></div>
        <div className="vs-badge">VS</div>
        <div><small>TEAM B</small><strong>{scores.B.toLocaleString()}</strong><span>{teamB.map((member) => member.name).join(', ')}</span></div>
      </div>
      <section className="question-card">
        <div className="question-meta"><span><BrainCircuit size={15} aria-hidden="true" /> TEAM {round.team} · {round.playerName} answers</span><span role="timer" className={time < 5 ? 'timer timer-low' : 'timer'} aria-label={`${time.toFixed(1)} seconds remaining`}><Clock3 size={17} aria-hidden="true" /> {time.toFixed(1)}s</span></div>
        <h1>{question.q}</h1>
        <div className="game-answers">
          {question.choices.map((choice, index) => {
            let state = '';
            if (selected !== null && index === question.answer) state = 'correct';
            else if (selected === index) state = 'wrong';
            return <button aria-label={`Option ${String.fromCharCode(65 + index)}: ${choice}${state === 'correct' ? ' — correct answer' : state === 'wrong' ? ' — incorrect' : ''}`} className={state} key={`${round.id}-${choice}`} onClick={() => choose(index)} disabled={!started || !isActive || selected !== null}><span aria-hidden="true">{String.fromCharCode(65 + index)}</span>{choice}{state === 'correct' && <Check aria-hidden="true" />}{state === 'wrong' && <X aria-hidden="true" />}</button>;
          })}
        </div>
        <div className={feedback ? 'feedback show' : 'feedback'} role="status">{feedback || (isActive ? 'Your turn — answer fast.' : `Waiting for ${round.playerName}.`)}</div>
        {!started && <div className="match-countdown"><span>PARTY READY</span><strong>Get ready…</strong></div>}
      </section>
      <div className="party-turn-strip">
        {game.rounds.map((item, index) => <span className={index === roundIndex ? 'active' : index < roundIndex ? 'done' : ''} key={item.id}>{item.playerName}</span>)}
      </div>
    </main>
  );
}

function TournamentPartyGame({ player, game, onFinish, onExit }) {
  const [tournament, setTournament] = useState(() => ({
    roundNumber: 1,
    pairs: buildTournamentPairs(game.entrants),
    matchIndex: 0,
    winners: [],
    champion: null,
  }));
  const [time, setTime] = useState(15);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [duelAnswers, setDuelAnswers] = useState({});
  const [started, setStarted] = useState(Date.now() >= game.startsAt);
  const transitionTimer = useRef(null);
  const resolvedDuels = useRef(new Set());
  const answersRef = useRef({});
  const pair = tournament.pairs[tournament.matchIndex] || [];
  // Namespaced by game id: the party channel outlives games, so a late duel
  // broadcast from a previous game must never match this game's duels.
  const duelId = `${game.id}-r${tournament.roundNumber}-m${tournament.matchIndex}`;
  const questionIndex = ((tournament.roundNumber - 1) * game.entrants.length + tournament.matchIndex) % game.questions.length;
  const question = game.questions[questionIndex];
  const isDuelist = pair.some((member) => member.playerId === game.playerId);
  const hasAnswered = Boolean(duelAnswers[game.playerId]);

  const applyDuelResult = useCallback((payload) => {
    if (!payload || payload.duelId !== duelId || resolvedDuels.current.has(payload.duelId)) return;
    resolvedDuels.current.add(payload.duelId);
    setFeedback(payload.bye ? `${payload.winner.name} gets a bye.` : `${payload.winner.name} wins this duel.`);
    transitionTimer.current = setTimeout(() => {
      const finishPayload = tournament.pairs.length === 1 && tournament.winners.length === 0
        ? {
            type: 'party-tournament',
            score: payload.winner.playerId === game.playerId ? 1 : 0,
            opponentScore: payload.winner.playerId === game.playerId ? 0 : 1,
            champion: payload.winner.name,
            summary: `${payload.winner.name} is the party tournament champion.`,
          }
        : null;
      setTournament((current) => {
        const nextWinners = [...current.winners, payload.winner];
        const nextMatchIndex = current.matchIndex + 1;
        if (nextMatchIndex < current.pairs.length) {
          return { ...current, winners: nextWinners, matchIndex: nextMatchIndex };
        }
        if (nextWinners.length === 1) {
          return { ...current, winners: nextWinners, champion: payload.winner };
        }
        return {
          roundNumber: current.roundNumber + 1,
          pairs: buildTournamentPairs(nextWinners),
          matchIndex: 0,
          winners: [],
          champion: null,
        };
      });
      setTime(15);
      setSelected(null);
      setFeedback('');
      setDuelAnswers({});
      answersRef.current = {};
      if (finishPayload) onFinish(finishPayload);
    }, 1200);
  }, [duelId, game.playerId, onFinish, tournament.pairs.length, tournament.winners.length]);

  const resolveDuel = useCallback((reason = 'answered') => {
    if (resolvedDuels.current.has(duelId) || pair.length === 0) return;
    if (pair.length === 1) {
      game.channel.send({ type: 'broadcast', event: 'party-duel-result', payload: { duelId, winner: pair[0], bye: true } });
      return;
    }
    const answers = answersRef.current;
    const bothAnswered = pair.every((member) => answers[member.playerId]);
    if (reason !== 'timeout' && !bothAnswered) return;
    const ranked = pair
      .map((member) => ({
        member,
        answer: answers[member.playerId] || { gain: 0, correct: false, answeredAt: Number.MAX_SAFE_INTEGER },
      }))
      .sort((a, b) => b.answer.gain - a.answer.gain || a.answer.answeredAt - b.answer.answeredAt || a.member.joinedAt - b.member.joinedAt);
    game.channel.send({ type: 'broadcast', event: 'party-duel-result', payload: { duelId, winner: ranked[0].member, bye: false } });
  }, [duelId, game.channel, pair]);

  useEffect(() => {
    const delay = Math.max(0, game.startsAt - Date.now());
    const startTimer = setTimeout(() => setStarted(true), delay);
    const unsubscribe = game.events.subscribe((event, payload) => {
      if (event === 'duel-answer' && payload?.duelId === duelId) {
        answersRef.current = { ...answersRef.current, [payload.playerId]: payload };
        setDuelAnswers(answersRef.current);
        resolveDuel('answered');
      }
      if (event === 'duel-result') applyDuelResult(payload);
    });
    return () => {
      unsubscribe();
      clearTimeout(startTimer);
    };
  }, [applyDuelResult, duelId, game, resolveDuel]);

  // The party connection owns the channel; the game only borrows it, so the
  // party survives after the game ends.
  useEffect(() => () => clearTimeout(transitionTimer.current), []);

  useEffect(() => {
    answersRef.current = {};
    setDuelAnswers({});
    setSelected(null);
    setFeedback('');
    setTime(15);
  }, [duelId]);

  useEffect(() => {
    const renderGameState = () => JSON.stringify({
      mode: 'party-tournament',
      player,
      round: tournament.roundNumber,
      match: tournament.matchIndex + 1,
      duelists: pair.map((member) => member.name),
      champion: tournament.champion?.name || null,
      question: question.q,
      choices: question.choices,
      answerLocked: selected !== null,
    });
    window.render_game_to_text = renderGameState;
    return () => {
      if (window.render_game_to_text === renderGameState) delete window.render_game_to_text;
    };
  }, [pair, player, question, selected, tournament]);

  useEffect(() => {
    if (!started || selected !== null || resolvedDuels.current.has(duelId)) return undefined;
    const timer = setInterval(() => setTime((value) => Math.max(0, +(value - 0.1).toFixed(1))), 100);
    return () => clearInterval(timer);
  }, [duelId, selected, started]);

  useEffect(() => {
    if (!started || resolvedDuels.current.has(duelId)) return undefined;
    if (pair.length === 1) {
      const byeTimer = setTimeout(() => resolveDuel('bye'), 700);
      return () => clearTimeout(byeTimer);
    }
    const timeout = setTimeout(() => resolveDuel('timeout'), 15000);
    return () => clearTimeout(timeout);
  }, [duelId, pair.length, resolveDuel, started]);

  function choose(index) {
    if (!started || !isDuelist || hasAnswered || selected !== null || resolvedDuels.current.has(duelId)) return;
    const correct = index === question.answer;
    const gain = correct ? 500 + Math.round(time * 45) : 0;
    setSelected(index);
    setFeedback(correct ? `Locked in +${gain}` : 'Locked in — not quite.');
    game.channel.send({
      type: 'broadcast',
      event: 'party-duel-answer',
      payload: {
        duelId,
        playerId: game.playerId,
        playerName: player,
        selected: index,
        correct,
        gain,
        answeredAt: Date.now(),
      },
    });
  }

  return (
    <main className="game-shell arena party-game">
      <div className="game-header"><Logo /><span className="round-label"><i className="game-live-dot" /> TOURNAMENT · ROUND {tournament.roundNumber}</span><button className="icon-button" aria-label="Exit tournament" onClick={onExit}><X /></button></div>
      <div className="party-scoreboard tournament-board">
        <div><small>DUELIST</small><strong>{pair[0]?.name || 'TBD'}</strong><span>{duelAnswers[pair[0]?.playerId]?.gain?.toLocaleString?.() || 'Waiting'}</span></div>
        <div className="vs-badge">VS</div>
        <div><small>DUELIST</small><strong>{pair[1]?.name || 'BYE'}</strong><span>{pair[1] ? (duelAnswers[pair[1].playerId]?.gain?.toLocaleString?.() || 'Waiting') : 'Auto advance'}</span></div>
      </div>
      <section className="question-card">
        <div className="question-meta"><span><Medal size={15} aria-hidden="true" /> {isDuelist ? 'YOUR DUEL' : 'SPECTATING DUEL'}</span><span role="timer" className={time < 5 ? 'timer timer-low' : 'timer'} aria-label={`${time.toFixed(1)} seconds remaining`}><Clock3 size={17} aria-hidden="true" /> {time.toFixed(1)}s</span></div>
        <h1>{question.q}</h1>
        <div className="game-answers">
          {question.choices.map((choice, index) => {
            let state = '';
            if (selected !== null && index === question.answer) state = 'correct';
            else if (selected === index) state = 'wrong';
            return <button aria-label={`Option ${String.fromCharCode(65 + index)}: ${choice}${state === 'correct' ? ' — correct answer' : state === 'wrong' ? ' — incorrect' : ''}`} className={state} key={`${duelId}-${choice}`} onClick={() => choose(index)} disabled={!started || !isDuelist || hasAnswered || selected !== null}><span aria-hidden="true">{String.fromCharCode(65 + index)}</span>{choice}{state === 'correct' && <Check aria-hidden="true" />}{state === 'wrong' && <X aria-hidden="true" />}</button>;
          })}
        </div>
        <div className={feedback ? 'feedback show' : 'feedback'} role="status">{feedback || (isDuelist ? 'Answer fast. Higher score advances.' : 'Watch this 1v1 — your turn may be next.')}</div>
        {!started && <div className="match-countdown"><span>BRACKET READY</span><strong>Get ready…</strong></div>}
      </section>
      <div className="party-turn-strip">
        {game.entrants.map((entrant) => <span className={tournament.champion?.playerId === entrant.playerId ? 'active' : ''} key={entrant.playerId}>{entrant.name}</span>)}
      </div>
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
  // Match chat lives in component state, so it starts fresh for every match.
  const [chatMessages, setChatMessages] = useState([]);
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
      if (event === 'chat') {
        setChatMessages((current) => appendChatMessage(current, payload));
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(startTimer);
      clearTimeout(transitionTimer.current);
      match.channel.untrack();
      // Bot matches use a local stub channel, not a Supabase channel.
      if (!match.isBot) supabase.removeChannel(match.channel);
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

  function sendChat(text) {
    const msg = { id: createPlayerId(), playerId: match.playerId, name: player, text, at: Date.now() };
    setChatMessages((current) => appendChatMessage(current, msg));
    match.channel.send({ type: 'broadcast', event: 'chat', payload: msg });
  }

  return (
    <main className="game-shell arena">
      <div className="game-header"><Logo /><span className="round-label"><i className={opponentConnected ? 'game-live-dot' : 'game-live-dot offline'} /> LIVE · ROUND {questionIndex + 1}/{questions.length}</span><button className="icon-button" aria-label="Exit game" onClick={onExit}><X /></button></div>
      <div className="scoreboard">
        <div className="game-player"><span className="avatar avatar-you">{player[0].toUpperCase()}</span><div><small>YOU</small><strong>{player}</strong></div><b>{score.toLocaleString()}</b></div>
        <div className="vs-badge">VS</div>
        <div className="game-player rival"><b>{opponentScore.toLocaleString()}</b><div><small>{opponentFinished ? 'FINISHED' : opponentConnected ? 'RIVAL · LIVE' : 'RECONNECTING'}</small><strong>{opponent}</strong></div><span className="avatar avatar-nova">{opponent[0]}</span></div>
      </div>
      <div className="game-progress" role="progressbar" aria-valuenow={questionIndex + 1} aria-valuemin={1} aria-valuemax={questions.length} aria-label={`Question ${questionIndex + 1} of ${questions.length}`}><i style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
      <section className="question-card">
        <div className="question-meta"><span><BrainCircuit size={15} aria-hidden="true" /> {question.category.toUpperCase()}</span><span role="timer" className={time < 5 ? 'timer timer-low' : 'timer'} aria-label={`${time.toFixed(1)} seconds remaining`}><Clock3 size={17} aria-hidden="true" /> {time.toFixed(1)}s</span></div>
        <h1>{question.q}</h1>
        <div className="game-answers">
          {question.choices.map((choice, index) => {
            let state = '';
            if (selected !== null && index === question.answer) state = 'correct';
            else if (selected === index) state = 'wrong';
            return <button aria-label={`Option ${String.fromCharCode(65 + index)}: ${choice}${state === 'correct' ? ' — correct answer' : state === 'wrong' ? ' — incorrect' : ''}`} className={state} key={choice} onClick={() => choose(index)} disabled={!started || selected !== null || localFinal.current !== null}><span aria-hidden="true">{String.fromCharCode(65 + index)}</span>{choice}{state === 'correct' && <Check aria-hidden="true" />}{state === 'wrong' && <X aria-hidden="true" />}</button>;
          })}
        </div>
        <div className={feedback ? 'feedback show' : 'feedback'} role="status">{feedback}</div>
        {!started && <div className="match-countdown"><span>RIVAL CONNECTED</span><strong>Get ready…</strong></div>}
      </section>
      {!match.isBot && <ChatDock title="Match chat" scopeLabel="you and your rival" messages={chatMessages} onSend={sendChat} selfId={match.playerId} />}
    </main>
  );
}

function Results({ player, opponent, result, onRematch, onHome, onBackToParty }) {
  if (result.type === 'party-team' || result.type === 'party-tournament') {
    const isTournament = result.type === 'party-tournament';
    return (
      <main className="game-shell results-screen">
        <Logo />
        <div className="result-emblem win" role="img" aria-label={isTournament ? 'Tournament complete' : 'Team battle complete'}>{isTournament ? <Medal aria-hidden="true" /> : <Trophy aria-hidden="true" />}</div>
        <p className="eyebrow">{isTournament ? 'TOURNAMENT COMPLETE' : 'TEAM BATTLE COMPLETE'}</p>
        <h1>{isTournament ? `${result.champion} wins!` : result.summary}</h1>
        <p>{isTournament ? 'The bracket is complete and the party has one champion.' : 'The party team battle finished with every player rotating through the questions.'}</p>
        {result.teamScores && (
          <div className="result-card">
            <div><span className="avatar avatar-you">A</span><strong>Team A</strong><b>{result.teamScores.A.toLocaleString()}</b></div>
            <span className="result-vs">{result.winner === 'TIE' ? 'TIE' : 'WIN'}</span>
            <div><span className="avatar avatar-nova">B</span><strong>Team B</strong><b>{result.teamScores.B.toLocaleString()}</b></div>
          </div>
        )}
        {isTournament && (
          <div className="result-card">
            <div><span className="avatar avatar-you">{result.champion[0].toUpperCase()}</span><strong>Champion</strong><b>{result.champion}</b></div>
            <span className="result-vs">#1</span>
            <div><span className="avatar avatar-nova">{player[0].toUpperCase()}</span><strong>You</strong><b>{result.champion === player ? 'Winner' : 'GG'}</b></div>
          </div>
        )}
        <div className="result-actions">
          {onBackToParty
            ? <><button className="button" onClick={onBackToParty}><Users size={17} /> Back to party</button><button className="button button-secondary" onClick={onHome}>Back home</button></>
            : <><button className="button" onClick={onHome}><Users size={17} /> Back to home</button><button className="button button-secondary" onClick={onHome}>Done</button></>}
        </div>
        {onBackToParty && <p className="queue-note">You are still in the party — the leader can start the next game any time.</p>}
      </main>
    );
  }
  const won = result.score >= result.opponentScore;
  const { xpGained = 0, streak = 0, totalXp = 0 } = result.matchStats || {};
  return (
    <main className="game-shell results-screen">
      <Logo />
      <div className={won ? 'result-emblem win' : 'result-emblem'} role="img" aria-label={won ? 'You won this match' : 'Match complete'}>{won ? <Trophy aria-hidden="true" /> : <BrainCircuit aria-hidden="true" />}</div>
      <p className="eyebrow">{result.vsBot ? 'PRACTICE MATCH COMPLETE' : 'MATCH COMPLETE'}</p>
      <h1>{won ? 'Brilliant win!' : 'So close. Run it back?'}</h1>
      <p>{result.vsBot ? 'Practice match against a bot — it counts toward matches played, but not your ranked score.' : won ? 'Fast thinking pays off. Your rank is moving up.' : 'Every match sharpens the mind. Your next rival is waiting.'}</p>
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

function Landing({ accountName, accountRank, authNotice, onNoticeClose, onlineCount, gamesPlayed, registeredUsers, leaders, onGuest, onParty, onCreate, onLogin, onLogout, onAccountPlay }) {
  return (
    <div id="top">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header accountName={accountName} onGuest={onGuest} onCreate={onCreate} onLogin={onLogin} onLogout={onLogout} onAccountPlay={onAccountPlay} />
      {authNotice && <div className="auth-notice" role="status">{authNotice}<button onClick={onNoticeClose} aria-label="Dismiss"><X size={16} /></button></div>}
      <a className="leaderboard-fab" href="#leaderboard" aria-label={accountRank ? `View leaderboard. Your current rank is ${accountRank.rank_position}` : 'View the live global leaderboard'}>
        <span className="leaderboard-fab-icon"><Trophy aria-hidden="true" /></span>
        <span><small>{accountRank ? `YOUR RANK · #${accountRank.rank_position}` : 'LIVE GLOBAL RANKS'}</small><strong>{accountRank ? 'Climb even higher' : 'Can you take the top spot?'}</strong></span>
        <ChevronRight />
      </a>
      <main id="main-content">
        <section className="hero">
          <div className="hero-copy">
            <div className="social-proof">
              <Globe2 size={22} aria-hidden="true" />
              <span>{onlineCount !== null ? <><b>{onlineCount.toLocaleString()}</b> online now</> : <><b>Live</b> matchmaking is online</>}</span>
              {gamesPlayed !== null && <span className="games-played-chip"><Zap size={12} aria-hidden="true" /> <b>{gamesPlayed.toLocaleString()}</b> matches completed all time</span>}
              {registeredUsers !== null && <span className="games-played-chip"><CircleUserRound size={12} aria-hidden="true" /> <b>{registeredUsers.toLocaleString()}</b> accounts created</span>}
            </div>
            <p className="eyebrow">REAL-TIME STEM SHOWDOWNS</p>
            <h1>Think fast.<br />Win <em>faster.</em></h1>
            <p className="hero-sub">Go head-to-head in rapid-fire STEM battles. Outsmart real opponents, climb the universal ranks, and prove your brain has game.</p>
            <div className="hero-actions">
              {accountName ? (
                <>
                  <button className="button button-large" onClick={onAccountPlay}><Play fill="currentColor" size={18} aria-hidden="true" /> Play with my account</button>
                  <button className="button button-secondary button-large" onClick={onParty}><Users size={18} aria-hidden="true" /> Play with friends</button>
                  <span className="signed-in-copy"><Check aria-hidden="true" /> Signed in as <b>{accountName}</b></span>
                </>
              ) : (
                <>
                  <button className="button button-large" onClick={onCreate}>Create account <ArrowRight size={18} aria-hidden="true" /></button>
                  <button className="button button-secondary button-large" onClick={onParty}><Users size={18} aria-hidden="true" /> Play with friends</button>
                  <button className="button button-secondary button-large" onClick={onGuest}><Play size={18} aria-hidden="true" /> Play as guest</button>
                </>
              )}
            </div>
            <p className="fine-print"><Check size={14} aria-hidden="true" /> Free to play <Check size={14} aria-hidden="true" /> No download <Check size={14} aria-hidden="true" /> Match in seconds</p>
          </div>
          <BattleCard />
        </section>

        <section className="ticker" aria-label="Popular STEM categories"><div><span><Atom aria-hidden="true" /> PHYSICS</span><i aria-hidden="true">✦</i><span><FlaskConical aria-hidden="true" /> CHEMISTRY</span><i aria-hidden="true">✦</i><span><Orbit aria-hidden="true" /> SPACE</span><i aria-hidden="true">✦</i><span><BrainCircuit aria-hidden="true" /> BIOLOGY</span><i aria-hidden="true">✦</i><span><Bolt aria-hidden="true" /> MATHEMATICS</span></div></section>

        <section className="party-section" id="party">
          <div>
            <p className="eyebrow">FRIENDS. TEAMS. BRACKETS.</p>
            <h2>Build a party, then let the leader pick the format.</h2>
            <p>Create a private code, invite friends, and play either auto-balanced XvX team battles or a 1v1 elimination tournament.</p>
          </div>
          <div className="party-feature-grid">
            <article><Swords aria-hidden="true" /><strong>Auto XvX split</strong><span>Odd parties give one team the extra player.</span></article>
            <article><Shuffle aria-hidden="true" /><strong>Rotating turns</strong><span>Everyone answers at least once; small parties cap at two turns each.</span></article>
            <article><Medal aria-hidden="true" /><strong>Tournament mode</strong><span>1v1 duels advance to one final winner.</span></article>
          </div>
          <button className="button button-large" onClick={onParty}><Users /> Create or join a party</button>
        </section>

        <section className="how-section" id="how">
          <div className="section-heading"><p className="eyebrow">YOUR BRAIN. THEIR CLOCK.</p><h2>Three steps to glory.</h2><p>No tutorials. No waiting rooms. Just pure knowledge under pressure.</p></div>
          <div className="steps">
            <article><span className="step-number" aria-hidden="true">01</span><div className="step-icon" aria-hidden="true"><CircleUserRound /></div><h3>Pick your identity</h3><p>Create an account to save your rank, or jump in instantly as a named guest.</p><ChevronRight aria-hidden="true" /></article>
            <article className="featured-step"><span className="step-number" aria-hidden="true">02</span><div className="step-icon" aria-hidden="true"><Globe2 /></div><h3>Meet your match</h3><p>We pair you live with a challenger at your skill level. The countdown starts.</p><ChevronRight aria-hidden="true" /></article>
            <article><span className="step-number" aria-hidden="true">03</span><div className="step-icon" aria-hidden="true"><Zap /></div><h3>Answer. Faster.</h3><p>Correct answers score. Fast answers score more. Win, streak, and rise.</p></article>
          </div>
        </section>

        <section className="leader-section" id="leaderboard">
          <div className="rank-callout"><p className="eyebrow">ONE PLANET. ONE RANK.</p><h2>How smart<br />is the world?</h2><p>Every account has a global rank. Scores from signed-in battles move that rank; guest battles count toward the match total but are not attached to an account.</p><div className="rank-stat"><Trophy aria-hidden="true" /><span><b>{gamesPlayed === null ? 'Loading live total…' : `${gamesPlayed.toLocaleString()} matches completed`}</b><small>Verified from recorded match IDs</small></span></div><button className="button button-light" onClick={accountName ? onAccountPlay : onCreate}>{accountName ? 'Play a ranked match' : 'Claim your rank'} <ArrowRight /></button></div>
          <div className="leaderboard-card">
            <div className="leader-header"><div><span className="live-pill"><i /> LIVE</span><h3>Global leaderboard</h3></div><span>ALL-TIME RANKS</span></div>
            <div role="table" aria-label="Global leaderboard rankings">
              <div role="rowgroup">
                <div className="leader-cols" role="row"><span role="columnheader">RANK & ACCOUNT</span><span role="columnheader">WINS</span><span role="columnheader">SCORE</span></div>
              </div>
              <div role="rowgroup">
                {Array.isArray(leaders) && leaders.map((leader) => <div className="leader-row" role="row" key={leader.id}><span role="cell" className={leader.rank_position <= 3 ? 'leader-rank top' : 'leader-rank'}>{leader.rank_position}</span><span role="presentation" className="leader-avatar">{leader.battle_name[0].toUpperCase()}</span><strong role="cell">{leader.battle_name}{leader.rank_position === 1 && <><Crown size={14} aria-hidden="true" /><span className="sr-only"> — Champion</span></>}</strong><span role="cell" className="streak">{leader.wins.toLocaleString()}</span><b role="cell">{leader.total_score.toLocaleString()}</b></div>)}
                {leaders === null && <div className="leader-empty"><Globe2 aria-hidden="true" /><strong>Loading live rankings…</strong><span>Connecting to the global leaderboard.</span></div>}
                {leaders === false && <div className="leader-empty"><Globe2 aria-hidden="true" /><strong>Rankings temporarily unavailable</strong><span>Live data could not be loaded. Please try again shortly.</span></div>}
                {Array.isArray(leaders) && leaders.length === 0 && <div className="leader-empty"><Trophy aria-hidden="true" /><strong>No ranked matches yet</strong><span>Create an account and finish a battle to set the first real score.</span></div>}
              </div>
            </div>
            <div className="your-rank"><span>{accountRank ? `#${accountRank.rank_position}` : '—'}</span><span className="leader-avatar">{accountName ? accountName[0].toUpperCase() : 'Y'}</span><strong>{accountRank ? `${accountRank.total_score.toLocaleString()} score · ${accountRank.matches_played.toLocaleString()} ranked matches` : accountName ? 'Loading your global rank' : 'Sign in to earn a global rank'}</strong><button onClick={accountName ? onAccountPlay : onCreate}>{accountName ? 'PLAY' : 'JOIN'} <ArrowRight /></button></div>
          </div>
        </section>

        <section className="final-cta"><div className="cta-orbit orbit-one" aria-hidden="true" /><div className="cta-orbit orbit-two" aria-hidden="true" /><span className="cta-icon" aria-hidden="true"><Rocket /></span><p className="eyebrow">YOUR NEXT RIVAL IS ONLINE</p><h2>Ready to put your<br />brain on the board?</h2><p>One name. Five questions. Infinite bragging rights.</p><button className="button button-large" onClick={accountName ? onAccountPlay : onGuest}><Play fill="currentColor" aria-hidden="true" /> {accountName ? 'Play a ranked match' : 'Start battling — it\'s free'}</button></section>
      </main>
      <footer><Logo /><p>Competitive STEM for curious minds everywhere.</p><CloudflareBadge /><a className="footer-a11y" href="mailto:ritvik.shah@gsynergy.com?subject=Stemegle%20accessibility%20feedback">Accessibility feedback</a><span>© 2026 Stemegle</span></footer>
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
  const [guestDestination, setGuestDestination] = useState('matchmaking');
  const [confirmLeave, setConfirmLeave] = useState(false);
  // `partyCode` is the party you have actually joined/created. A code sitting
  // in the invite URL is only a *pending* invite until you accept it, so
  // browsing elsewhere never silently connects you to it.
  const [partyCode, setPartyCode] = useState('');
  const { onlineCount, gamesPlayed, registeredUsers, leaders, accountRank } = useLiveStats(session?.user?.id);
  const partyLinkHandled = useRef(false);
  const pendingInvite = useRef(getPartyCodeFromUrl());
  const partyPlayerId = useRef(createPlayerId());
  const createdPartyCodeRef = useRef('');
  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // The party connection lives here, not in the party screen, so finishing a
  // game or browsing other screens never disconnects anyone from the party.
  const party = usePartyConnection({
    code: player ? partyCode : '',
    name: player,
    playerIdRef: partyPlayerId,
    createdPartyCodeRef,
    onGameStart: (config) => {
      // Don't yank members out of an active ranked match or queue.
      if (screenRef.current === 'game' || screenRef.current === 'matchmaking') return;
      setResult(null);
      setMatch(config);
      setScreen('party-game');
    },
  });
  const fromConfirmLink = useRef(
    window.location.hash.includes('access_token') ||
    Boolean(new URLSearchParams(window.location.search).get('code'))
  );
  const handleMatched = useCallback((matchData) => { setMatch(matchData); setOpponent(matchData.opponent.name); setScreen('game'); }, []);
  const handlePlayBot = useCallback(() => {
    const botMatch = createBotMatch(player);
    setMatch(botMatch);
    setOpponent(botMatch.opponent.name);
    setScreen('game');
  }, [player]);
  const handleFinish = useCallback(async (data) => {
    let matchStats = null;
    try {
      if (match?.isBot) {
        // Counts toward the global matches total, but not ranked score.
        await recordBotMatch(match.id);
      } else {
        matchStats = await recordMatchResult(match?.id, data.score, data.opponentScore);
      }
    } catch (error) {
      console.error('Could not persist match result', error);
    }
    setResult({ ...data, matchStats, vsBot: Boolean(match?.isBot) });
    setScreen('results');
  }, [match?.id, match?.isBot]);

  useEffect(() => {
    if (screen === 'game' || screen === 'party-game') return undefined;
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

  useEffect(() => {
    const invite = pendingInvite.current;
    if (partyLinkHandled.current || invite.length !== PARTY_CODE_LENGTH || !authReady) return;
    partyLinkHandled.current = true;
    if (accountName) {
      pendingInvite.current = '';
      joinParty(invite);
      start(accountName, 'party');
      return;
    }
    setGuestDestination('party');
    setModal('guest');
  }, [accountName, authReady]);

  function start(name, destination = 'matchmaking') { setPlayer(name); setModal(null); setScreen(destination); }
  function createParty() {
    if (!hasRealtimeConfig) return;
    const code = createPartyCode();
    createdPartyCodeRef.current = code;
    setPartyCode(code);
    window.history.replaceState(null, '', `${window.location.pathname}?party=${code}`);
  }
  function joinParty(code) {
    createdPartyCodeRef.current = '';
    setPartyCode(code);
    window.history.replaceState(null, '', `${window.location.pathname}?party=${code}`);
  }
  function leaveParty() {
    createdPartyCodeRef.current = '';
    setPartyCode('');
    setConfirmLeave(false);
    window.history.replaceState(null, '', window.location.pathname);
  }
  function playAccount() { if (accountName) start(accountName); else setModal('login'); }
  function playParty() {
    if (accountName) {
      start(accountName, 'party');
      return;
    }
    setGuestDestination('party');
    setModal('guest');
  }
  function playGuest() {
    setGuestDestination('matchmaking');
    setModal('guest');
  }
  function rematch() { setResult(null); setMatch(null); setScreen('matchmaking'); }
  function home() { setScreen('landing'); setResult(null); setMatch(null); setOpponent(''); }
  async function logout() { await supabase?.auth.signOut(); home(); }

  const inParty = Boolean(partyCode && player);
  const showPartyPill = inParty && screen !== 'party' && screen !== 'party-game' && screen !== 'game';

  let content;
  if (screen === 'matchmaking') content = <Matchmaking name={player} onMatched={handleMatched} onPlayBot={handlePlayBot} onCancel={home} />;
  else if (screen === 'party') content = <PartyRoom partyCode={partyCode} party={party} playerId={partyPlayerId.current} onCreateParty={createParty} onJoinParty={joinParty} onLeaveParty={() => setConfirmLeave(true)} onCancel={home} />;
  else if (screen === 'party-game' && match) content = <PartyGame key={match.id} player={player} game={match} onFinish={(data) => { setResult(data); setScreen('results'); }} onExit={() => setScreen(inParty ? 'party' : 'landing')} />;
  else if (screen === 'game' && match) content = <Game player={player} match={match} onFinish={handleFinish} onExit={home} />;
  else if (screen === 'results' && result) content = <Results player={player} opponent={opponent} result={result} onRematch={rematch} onHome={home} onBackToParty={inParty ? () => setScreen('party') : undefined} />;
  else content = <>
    <Landing accountName={authReady ? accountName : ''} accountRank={accountRank} authNotice={authNotice} onNoticeClose={() => setAuthNotice('')} onlineCount={onlineCount} gamesPlayed={gamesPlayed} registeredUsers={registeredUsers} leaders={leaders} onGuest={playGuest} onParty={playParty} onCreate={() => setModal('create')} onLogin={() => setModal('login')} onLogout={logout} onAccountPlay={playAccount} />
    {modal && <EntryModal mode={modal} guestActionLabel={guestDestination === 'party' ? 'Continue to party' : 'Find an opponent'} guestDescription={guestDestination === 'party' ? 'Pick a name so friends can recognize you in the party.' : undefined} onClose={() => { setModal(null); if (guestDestination === 'party') pendingInvite.current = ''; }} onGuestStart={(name) => {
      const invite = guestDestination === 'party' ? pendingInvite.current : '';
      pendingInvite.current = '';
      if (invite.length === PARTY_CODE_LENGTH) joinParty(invite);
      start(name, guestDestination);
    }} onAuthSuccess={() => setModal(null)} onSwitch={setModal} />}
  </>;

  return <>
    {content}
    {inParty && (screen === 'party' || screen === 'party-game') && <ChatDock title={`Party ${partyCode}`} scopeLabel="your party" messages={party.chat} onSend={party.sendChat} selfId={partyPlayerId.current} />}
    {showPartyPill && <PartyPill code={partyCode} count={party.players.length} onReturn={() => setScreen('party')} onLeave={() => setConfirmLeave(true)} />}
    {confirmLeave && <ConfirmDialog title="Leave the party?" message="Are you sure you want to leave the party? You'll need the invite link or code to rejoin." confirmLabel="Leave party" onConfirm={leaveParty} onCancel={() => setConfirmLeave(false)} />}
  </>;
}
