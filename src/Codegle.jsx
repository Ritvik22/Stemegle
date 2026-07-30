import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import {
  ArrowLeft, ArrowRight, Bot, Braces, Check, Clock3, Code2, Cpu, FlaskConical, Gauge,
  Lightbulb, LoaderCircle, Play, RotateCcw, Send, Sparkles, Terminal, Trophy, Users, X,
} from 'lucide-react';
import {
  finishCodegleBotMatch, revealCodegleHint, runCodegleProgram, startCodegleBotMatch,
  submitCodegleSolution,
} from './lib/api';
import { getPresencePlayers, hasRealtimeConfig, realtime } from './lib/realtime';
import {
  CODEGLE_DIFFICULTIES, CODEGLE_LANGUAGES, getCodegleProblem, getCodegleProblemForMatch,
} from './data/codegleProblems';
import { trackAnalyticsEvent } from './lib/analytics';
import { codeShapeFromSource, isCodeShape } from './lib/codeShape';

const CODEGLE_PRESENCE = 'stemegle:codegle:presence:v1';
const CODEGLE_MATCH_PREFIX = 'stemegle:codegle:match:';
const codegleLobby = (difficulty) => `stemegle:codegle:lobby:${difficulty}:v1`;
const codegleMatchTopic = (difficulty, matchId) => `${CODEGLE_MATCH_PREFIX}${difficulty}:${matchId}`;

function playerId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const languageExtension = {
  python: python(), java: java(), cpp: cpp(), javascript: javascript(),
};

const BOT_CODE_SHAPE = [
  { indent: 0, width: 8 }, { indent: 1, width: 5 }, { indent: 1, width: 9 },
  { indent: 2, width: 4 }, { indent: 1, width: 0 }, { indent: 1, width: 7 },
  { indent: 2, width: 10 }, { indent: 2, width: 5 }, { indent: 1, width: 3 },
  { indent: 0, width: 0 }, { indent: 0, width: 6 }, { indent: 0, width: 4 },
];

function difficultyLabel(difficulty) {
  return CODEGLE_DIFFICULTIES.find(({ id }) => id === difficulty)?.label || 'Beginner';
}

function useCodeglePopulations() {
  const [populations, setPopulations] = useState(() => Object.fromEntries(
    CODEGLE_DIFFICULTIES.map(({ id }) => [id, 0]),
  ));

  useEffect(() => {
    if (!hasRealtimeConfig) return undefined;
    const observerId = `observer-${playerId()}`;
    const channel = realtime.channel(CODEGLE_PRESENCE, {
      config: { presence: { key: observerId } },
    });
    channel.on('presence', { event: 'sync' }, () => {
      const next = Object.fromEntries(CODEGLE_DIFFICULTIES.map(({ id }) => [id, 0]));
      getPresencePlayers(channel).forEach((presence) => {
        if (Object.hasOwn(next, presence.difficulty)) next[presence.difficulty] += 1;
      });
      setPopulations(next);
    }).subscribe();
    return () => realtime.removeChannel(channel);
  }, []);

  return populations;
}

function OpponentCodeSilhouette({ lines, name, isBot }) {
  const visibleLines = lines.slice(-8);
  const offset = Math.max(0, lines.length - visibleLines.length);
  const nonBlankLines = lines.filter((line) => line.width > 0).length;
  const latestVisibleIndex = visibleLines.findLastIndex((line) => line.width > 0);
  return (
    <section className="codegle-rival-code" aria-label={`${name}'s hidden code progress`}>
      <header>
        <span><Braces /> {name}{isBot ? ' · BOT' : ''}</span>
        <small><i /> LIVE PROGRESS</small>
      </header>
      <div className="codegle-rival-screen" aria-hidden="true">
        {visibleLines.length ? visibleLines.map((line, index) => (
          <span
            className={`${line.width === 0 ? 'blank' : ''}${index === latestVisibleIndex ? ' active' : ''}`}
            key={`${offset + index}-${line.indent}-${line.width}`}
            style={{ '--line-indent': line.indent, '--line-width': line.width }}
          />
        )) : <><span /><span className="waiting" /><span /></>}
      </div>
      <footer><strong>{nonBlankLines} {nonBlankLines === 1 ? 'line' : 'lines'} forming</strong><small>SOURCE HIDDEN · SHAPE ONLY</small></footer>
    </section>
  );
}

export function CodegleIntro({ onBack, onPlay }) {
  const [difficulty, setDifficulty] = useState('beginner');
  const populations = useCodeglePopulations();
  return (
    <main className="codegle-intro">
      <button className="codegle-back" onClick={onBack}><ArrowLeft size={17} /> Back to Stemegle</button>
      <div className="codegle-beta-badge"><Sparkles size={15} /> BETA</div>
      <section className="codegle-intro-grid">
        <div className="codegle-intro-copy">
          <p className="eyebrow">LIVE COMPETITIVE CODING</p>
          <h1>Meet <span>Codegle.</span></h1>
          <p>Get one coding problem, write a real program, and race a live opponent through hidden tests. Wrong answer? Fix it and submit again. First accepted solution wins.</p>
          <fieldset className="codegle-difficulties">
            <legend className="codegle-live-heading">
              <Users />
              <div><strong>Codegle Live Matchups</strong><small>Choose your difficulty</small></div>
            </legend>
            {CODEGLE_DIFFICULTIES.map((option) => (
              <button
                type="button"
                key={option.id}
                className={difficulty === option.id ? `selected ${option.id}` : option.id}
                onClick={() => setDifficulty(option.id)}
                aria-pressed={difficulty === option.id}
              >
                <span><Gauge />{option.label}</span>
                <small>{option.description}</small>
                <b><i />{populations[option.id]} real {populations[option.id] === 1 ? 'player' : 'players'} now</b>
              </button>
            ))}
          </fieldset>
          <div className="codegle-play-options">
            <button className="button button-large codegle-primary" onClick={() => onPlay(difficulty, 'live')}><Code2 /> Play {difficultyLabel(difficulty)} <ArrowRight /></button>
            <button className="button button-large codegle-solitaire" onClick={() => onPlay(difficulty, 'solitaire')}><Bot /> Codegle Solitaire <small>BOT</small></button>
          </div>
          <p className="codegle-match-note">Live Matchups searches for a person first, then starts a clearly labeled bot race after five seconds. Solitaire starts with a bot immediately.</p>
          <small>
            <span><Check /> Separate matchmaking pool</span>
            <span><Check /> Four real languages</span>
            <span><Check /> Matches count globally</span>
          </small>
        </div>
        <div className="codegle-intro-editor" aria-hidden="true">
          <header><span><i /> main.py</span><b>PYTHON</b></header>
          <pre><em>1</em><code><span>def</span> solve(nums):</code>{'\n'}<em>2</em><code>    <span>return</span> max(nums)</code>{'\n'}<em>3</em><code></code>{'\n'}<em>4</em><code>print(solve(values))</code></pre>
          <footer><span><Terminal /> 4/4 tests passed</span><strong><Trophy /> ACCEPTED</strong></footer>
        </div>
      </section>
      <section className="codegle-feature-row">
        <article><Cpu /><strong>Real compiler</strong><span>Run Python, Java, C++, or JavaScript against hidden tests.</span></article>
        <article><Braces /><strong>Proper editor</strong><span>Syntax colors, smart indentation, selections, and bracket matching.</span></article>
        <article><Users /><strong>Live race</strong><span>A dedicated Codegle queue keeps coding rivals together.</span></article>
      </section>
    </main>
  );
}

export function CodegleMatchmaking({ name, difficulty, mode = 'live', onMatched, onCancel }) {
  const [seconds, setSeconds] = useState(0);
  const [population, setPopulation] = useState(0);
  const [status, setStatus] = useState(hasRealtimeConfig ? 'connecting' : 'error');
  const [error, setError] = useState(hasRealtimeConfig ? '' : 'Realtime multiplayer is not configured.');
  const ownId = useRef(playerId());

  useEffect(() => {
    trackAnalyticsEvent('queue_started', { mode: mode === 'solitaire' ? 'codegle_solitaire' : 'codegle', difficulty });
    const ticker = setInterval(() => setSeconds((value) => value + 1), 1000);
    if (!hasRealtimeConfig) return () => clearInterval(ticker);
    let active = true;
    let lobby;
    let census;
    let attempt;
    let joined = false;
    let botStarting = false;
    let fallbackTimer;

    const clearAttempt = () => {
      if (!attempt) return;
      attempt.intervals.forEach(clearInterval);
      attempt.timers.forEach(clearTimeout);
      attempt.channel.untrack();
      realtime.removeChannel(attempt.channel);
      attempt = null;
    };

    const beginBotMatch = async (kind) => {
      if (!active || joined || botStarting) return;
      botStarting = true;
      clearAttempt();
      clearTimeout(fallbackTimer);
      setStatus('bot-found');
      try {
        if (lobby) {
          await lobby.untrack();
          realtime.removeChannel(lobby);
          lobby = null;
        }
        const botMatch = await startCodegleBotMatch(ownId.current, difficulty, kind);
        if (!active || !botMatch) return;
        joined = true;
        await census.track({
          playerId: ownId.current, name, joinedAt: Date.now(), mode: 'codegle', difficulty, phase: 'playing',
        });
        const channel = { on() { return this; }, untrack() {}, unsubscribe() {} };
        onMatched({
          id: botMatch.matchId,
          playerId: botMatch.playerId,
          opponent: { id: botMatch.botId, name: botMatch.botName },
          problemId: botMatch.problemId,
          difficulty,
          startsAt: botMatch.startsAt,
          botSolvesAt: botMatch.botSolvesAt,
          botKind: botMatch.botKind,
          isBot: true,
          channel,
          populationChannel: census,
          getAuthorization: () => ({
            ticket: botMatch.ticket,
            matchId: botMatch.matchId,
            playerId: botMatch.playerId,
            difficulty,
          }),
        });
      } catch (botError) {
        botStarting = false;
        setStatus('error');
        setError(botError.message || 'Could not prepare the Codegle bot.');
      }
    };

    const beginAttempt = (opponent) => {
      const matchId = [ownId.current, opponent.playerId].sort().join('--');
      const isHost = matchId.startsWith(ownId.current);
      const channel = realtime.channel(codegleMatchTopic(difficulty, matchId), {
        config: { presence: { key: ownId.current }, broadcast: { self: true, ack: true } },
      });
      attempt = { channel, opponentId: opponent.playerId, intervals: [], timers: [] };
      let opponentReady = false;

      const finishPairing = (payload) => {
        if (!active || joined) return;
        joined = true;
        attempt.intervals.forEach(clearInterval);
        attempt.timers.forEach(clearTimeout);
        clearTimeout(fallbackTimer);
        lobby.untrack();
        realtime.removeChannel(lobby);
        lobby = null;
        void census.track({
          playerId: ownId.current, name, joinedAt: Date.now(), mode: 'codegle', difficulty, phase: 'playing',
        });
        onMatched({
          id: matchId,
          playerId: ownId.current,
          opponent: { id: opponent.playerId, name: opponent.name },
          problemId: payload.problemId,
          difficulty,
          startsAt: payload.startsAt,
          channel,
          populationChannel: census,
          getAuthorization: () => channel.matchAuthorization(),
        });
      };

      channel
        .on('broadcast', { event: 'ready' }, ({ payload }) => {
          if (payload.playerId !== ownId.current) opponentReady = true;
        })
        .on('broadcast', { event: 'start' }, ({ payload }) => finishPairing(payload))
        .on('presence', { event: 'sync' }, () => {
          if (getPresencePlayers(channel).length === 2) setStatus('opponent-found');
        })
        .subscribe(async (subscriptionStatus) => {
          if (subscriptionStatus === 'SUBSCRIBED' && attempt?.channel === channel) {
            await channel.track({ playerId: ownId.current, name, joinedAt: Date.now(), mode: 'codegle', difficulty });
            attempt.intervals.push(setInterval(() => {
              if (!active || joined) return;
              channel.send({ type: 'broadcast', event: 'ready', payload: { playerId: ownId.current } });
              if (isHost && opponentReady && channel.matchAuthorization()) {
                const problem = getCodegleProblemForMatch(matchId, difficulty);
                channel.send({ type: 'broadcast', event: 'start', payload: { startsAt: Date.now() + 1800, problemId: problem.id } });
              }
            }, 700));
          }
          if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
            setStatus('error');
            setError('Could not connect to the Codegle match.');
          }
        });
      attempt.timers.push(setTimeout(() => {
        if (!joined && active) { clearAttempt(); pair(); }
      }, 8000));
    };

    const pair = () => {
      if (!active || joined || botStarting || !lobby) return;
      const players = getPresencePlayers(lobby).sort((a, b) => a.joinedAt - b.joinedAt || a.playerId.localeCompare(b.playerId));
      const index = players.findIndex((candidate) => candidate.playerId === ownId.current);
      if (index < 0) return;
      const opponent = players[index % 2 === 0 ? index + 1 : index - 1];
      if (!opponent) { clearAttempt(); setStatus('waiting'); return; }
      if (attempt?.opponentId === opponent.playerId) return;
      clearAttempt();
      beginAttempt(opponent);
    };

    census = realtime.channel(CODEGLE_PRESENCE, { config: { presence: { key: ownId.current } } });
    census.on('presence', { event: 'sync' }, () => {
      setPopulation(getPresencePlayers(census).filter((presence) => presence.difficulty === difficulty).length);
    }).subscribe(async (subscriptionStatus) => {
      if (subscriptionStatus === 'SUBSCRIBED') {
        await census.track({
          playerId: ownId.current, name, joinedAt: Date.now(), mode: 'codegle', difficulty, phase: 'waiting',
        });
        if (mode === 'solitaire') void beginBotMatch('solitaire');
      }
    });

    if (mode === 'live') {
      lobby = realtime.channel(codegleLobby(difficulty), { config: { presence: { key: ownId.current } } });
      lobby.on('presence', { event: 'sync' }, pair).subscribe(async (subscriptionStatus) => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          setStatus('waiting');
          await lobby.track({
            playerId: ownId.current, name, joinedAt: Date.now(), mode: 'codegle', difficulty, phase: 'waiting',
          });
          fallbackTimer = setTimeout(() => {
            if (!attempt && !joined) void beginBotMatch('fallback');
          }, 5000);
        }
        if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
          setStatus('error');
          setError('Unable to reach the Codegle lobby.');
        }
      });
    }
    return () => {
      active = false;
      clearInterval(ticker);
      clearTimeout(fallbackTimer);
      if (lobby) { lobby.untrack(); realtime.removeChannel(lobby); }
      if (attempt && !joined) clearAttempt();
      if (census && !joined) { census.untrack(); realtime.removeChannel(census); }
    };
  }, [difficulty, mode, name, onMatched]);

  return (
    <main className="codegle-queue">
      <div className="codegle-beta-badge"><Sparkles size={15} /> CODEGLE BETA</div>
      <div className="codegle-queue-orbit"><Code2 /><i /><i /><i /></div>
      <p className="eyebrow">{mode === 'solitaire' ? 'CODEGLE SOLITAIRE · BOT' : `${difficultyLabel(difficulty).toUpperCase()} LIVE MATCHUPS`}</p>
      <h1>{status === 'opponent-found' ? 'Coder found!' : status === 'bot-found' ? 'Bot challenger ready!' : status === 'error' ? 'Compiler lobby offline' : mode === 'solitaire' ? 'Preparing your bot race…' : 'Finding a coding rival…'}</h1>
      <p>{error || (mode === 'solitaire' ? 'Your opponent is a clearly labeled Codegle bot.' : `Searching for a real ${difficultyLabel(difficulty).toLowerCase()} player. If nobody joins within five seconds, a clearly labeled bot will step in.`)}</p>
      <div className="codegle-queue-status"><span>{status === 'bot-found' || mode === 'solitaire' ? <Bot /> : <Users />} {status === 'opponent-found' ? 'Human opponent connected' : status === 'bot-found' ? 'Bot opponent' : `${population} real ${population === 1 ? 'player' : 'players'} this level`}</span><span><Clock3 /> {seconds}s</span></div>
      <button className="codegle-text-button" onClick={onCancel}><X /> Cancel search</button>
    </main>
  );
}

export function CodegleGame({ player, match, onFinish, onExit }) {
  const problem = getCodegleProblem(match.problemId);
  const [language, setLanguage] = useState('python');
  const [sources, setSources] = useState(() => Object.fromEntries(CODEGLE_LANGUAGES.map(({ id }) => [id, problem.starter[id]])));
  const [submitting, setSubmitting] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState(problem.examples[0].input);
  const [testResult, setTestResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [winner, setWinner] = useState(null);
  const [opponentCodeShape, setOpponentCodeShape] = useState([]);
  const [revealedHints, setRevealedHints] = useState([]);
  const [hintPenaltyMs, setHintPenaltyMs] = useState(0);
  const [totalHints, setTotalHints] = useState(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState('');
  const [countdown, setCountdown] = useState(Math.max(0, Math.ceil((match.startsAt - Date.now()) / 1000)));
  const [elapsed, setElapsed] = useState(0);
  const finishedRef = useRef(false);
  const ownCodeShape = useMemo(() => codeShapeFromSource(sources[language]), [language, sources]);
  const adjustedElapsed = elapsed + hintPenaltyMs;
  const displayedOpponentShape = useMemo(() => {
    if (!match.isBot) return opponentCodeShape;
    const duration = Math.max(1, match.botSolvesAt - match.startsAt);
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    return BOT_CODE_SHAPE.slice(0, Math.max(1, Math.ceil(progress * BOT_CODE_SHAPE.length)));
  }, [elapsed, match.botSolvesAt, match.isBot, match.startsAt, opponentCodeShape]);

  const finish = useCallback((solved) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const won = solved.playerId === match.playerId;
    setWinner(solved);
    setTimeout(() => onFinish({
      type: 'codegle', won, winnerName: won ? player : match.opponent.name,
      opponentName: match.opponent.name, elapsedMs: solved.elapsedMs,
      penaltyMs: solved.penaltyMs || 0, hintsUsed: solved.hintsUsed || 0,
      difficulty: match.difficulty, vsBot: Boolean(match.isBot), botKind: match.botKind || null,
    }), 1100);
  }, [match.botKind, match.difficulty, match.isBot, match.opponent.name, match.playerId, onFinish, player]);

  useEffect(() => {
    const channel = match.channel;
    let botTimer;
    if (match.isBot) {
      const finishBot = async () => {
        try {
          const authorization = match.getAuthorization?.();
          const result = await finishCodegleBotMatch(match.id, match.playerId, authorization?.ticket);
          if (result?.winner) finish(result.winner);
        } catch (botError) {
          setVerdict({ status: 'connection_error', message: botError.message || 'Could not confirm the bot result.' });
        }
      };
      botTimer = setTimeout(finishBot, Math.max(0, match.botSolvesAt - Date.now()));
    } else {
      channel.on('broadcast', { event: 'solved' }, ({ payload }) => finish(payload));
    }
    return () => {
      clearTimeout(botTimer);
      channel.untrack();
      realtime.removeChannel(channel);
      if (match.populationChannel) {
        match.populationChannel.untrack();
        realtime.removeChannel(match.populationChannel);
      }
    };
  }, [finish, match.botSolvesAt, match.channel, match.getAuthorization, match.id, match.isBot, match.playerId, match.populationChannel]);

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((match.startsAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (!remaining) setElapsed(Date.now() - match.startsAt);
    }, 250);
    return () => clearInterval(timer);
  }, [match.startsAt]);

  useEffect(() => {
    if (match.isBot) return undefined;
    match.channel.on('broadcast', { event: 'code-progress' }, ({ payload }) => {
      if (payload?.playerId === match.opponent.id && isCodeShape(payload.lines)) {
        setOpponentCodeShape(payload.lines);
      }
    });
    return undefined;
  }, [match.channel, match.isBot, match.opponent.id]);

  useEffect(() => {
    if (match.isBot) return undefined;
    const publish = () => {
      void match.channel.send({
        type: 'broadcast',
        event: 'code-progress',
        payload: { playerId: match.playerId, lines: ownCodeShape },
      });
    };
    const initialTimer = setTimeout(publish, 250);
    const heartbeat = setInterval(publish, 3000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(heartbeat);
    };
  }, [match.channel, match.isBot, match.playerId, ownCodeShape]);

  useLayoutEffect(() => {
    const render = () => JSON.stringify({
      mode: 'codegle-game', difficulty: match.difficulty, problem: problem.id, language, submitting,
      verdict: verdict?.status || null, elapsedMs: adjustedElapsed,
      hints: {
        revealed: revealedHints.length,
        total: totalHints,
        penaltyMs: hintPenaltyMs,
        loading: hintLoading,
        error: hintError || null,
      },
      player, opponent: match.opponent.name, opponentType: match.isBot ? 'bot' : 'human',
      botKind: match.botKind || null, winner: winner?.playerId || null,
      opponentCode: {
        sourceHidden: true,
        lines: displayedOpponentShape,
        nonBlankLines: displayedOpponentShape.filter((line) => line.width > 0).length,
      },
      testConsole: {
        open: testOpen, running, status: testResult?.status || null,
        message: testResult?.message || null,
        output: testResult?.output || null,
      },
    });
    window.render_game_to_text = render;
    return () => { if (window.render_game_to_text === render) delete window.render_game_to_text; };
  }, [adjustedElapsed, displayedOpponentShape, hintError, hintLoading, hintPenaltyMs, language, match.botKind, match.difficulty, match.isBot, match.opponent.name, player, problem.id, revealedHints.length, running, submitting, testOpen, testResult, totalHints, verdict, winner]);

  async function revealHint() {
    if (hintLoading || countdown || winner || (totalHints !== null && revealedHints.length >= totalHints)) return;
    const authorization = match.getAuthorization?.();
    if (!authorization?.ticket) {
      setHintError('Match authorization is still connecting. Try again.');
      return;
    }
    setHintLoading(true);
    setHintError('');
    try {
      const result = await revealCodegleHint({
        matchId: match.id,
        playerId: match.playerId,
        ticket: authorization.ticket,
        hintIndex: revealedHints.length,
      });
      setRevealedHints((current) => (
        current[result.hintIndex] ? current : [...current, result.hint]
      ));
      setHintPenaltyMs(result.penaltyMs);
      setTotalHints(result.totalHints);
    } catch (error) {
      if (error.details?.winner) finish(error.details.winner);
      else setHintError(error.message || 'Could not reveal the hint.');
    } finally {
      setHintLoading(false);
    }
  }

  async function runTest() {
    if (running || submitting || countdown || winner) return;
    const authorization = match.getAuthorization?.();
    if (!authorization?.ticket) {
      setTestResult({ status: 'connection_error', message: 'Match authorization is still connecting.', output: '' });
      return;
    }
    setRunning(true);
    setTestResult(null);
    try {
      const result = await runCodegleProgram({
        matchId: match.id,
        playerId: match.playerId,
        ticket: authorization.ticket,
        language,
        source: sources[language],
        input: testInput,
      });
      setTestResult(result);
    } catch (error) {
      if (error.details?.winner) finish(error.details.winner);
      else setTestResult({ status: 'error', message: error.message || 'Test run failed.', output: '' });
    } finally {
      setRunning(false);
    }
  }

  async function submit() {
    if (submitting || countdown || winner) return;
    const authorization = match.getAuthorization?.();
    if (!authorization?.ticket) {
      setVerdict({ status: 'connection_error', message: 'Match authorization is still connecting. Try again.' });
      return;
    }
    setSubmitting(true);
    setVerdict(null);
    try {
      const result = await submitCodegleSolution({
        matchId: match.id, playerId: match.playerId, ticket: authorization.ticket,
        language, source: sources[language],
      });
      setVerdict({ status: result.status, message: result.message });
      if (result.winner) finish(result.winner);
    } catch (error) {
      if (error.details?.winner) finish(error.details.winner);
      else setVerdict({ status: 'error', message: error.message || 'Submission failed. Try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="codegle-game">
      <header className="codegle-game-header">
        <button onClick={onExit} aria-label="Exit Codegle"><ArrowLeft /></button>
        <strong><Code2 /> codegle <small>BETA</small></strong>
        <div><span>{player}</span><b>VS</b><span>{match.opponent.name}{match.isBot && <small className="codegle-bot-label"><Bot /> BOT</small>}</span></div>
        <time>
          <Clock3 />
          <span>{Math.floor(adjustedElapsed / 60000)}:{String(Math.floor(adjustedElapsed / 1000) % 60).padStart(2, '0')}</span>
          {hintPenaltyMs > 0 && <small>+{hintPenaltyMs / 1000}s hints</small>}
        </time>
      </header>
      <div className="codegle-workspace">
        <aside className="codegle-problem">
          <div className="codegle-problem-top"><span>{difficultyLabel(problem.difficulty)}</span><small>{match.isBot ? 'BOT RACE · FIRST ACCEPTED WINS' : 'ONE PROBLEM · FIRST ACCEPTED WINS'}</small></div>
          <OpponentCodeSilhouette lines={displayedOpponentShape} name={match.opponent.name} isBot={match.isBot} />
          <section className="codegle-hints" aria-labelledby="codegle-hints-title">
            <header>
              <span><Lightbulb /><strong id="codegle-hints-title">Need a nudge?</strong></span>
              <small>+10 seconds each</small>
            </header>
            {revealedHints.map((hint, index) => (
              <p className="codegle-hint" key={hint}><b>HINT {index + 1}</b>{hint}</p>
            ))}
            <button
              type="button"
              onClick={revealHint}
              disabled={hintLoading || countdown > 0 || Boolean(winner) || (totalHints !== null && revealedHints.length >= totalHints)}
            >
              {hintLoading ? <LoaderCircle className="upload-spin" /> : <Lightbulb />}
              {hintLoading
                ? 'Revealing…'
                : totalHints !== null && revealedHints.length >= totalHints
                  ? 'All hints revealed'
                  : `Reveal hint ${revealedHints.length + 1}`}
              {!hintLoading && (totalHints === null || revealedHints.length < totalHints) && <em>+10s</em>}
            </button>
            {hintError && <small className="codegle-hint-error" role="alert">{hintError}</small>}
          </section>
          <h1>{problem.title}</h1>
          <p>{problem.description}</p>
          <h2>Input</h2><p>{problem.inputFormat}</p>
          <h2>Output</h2><p>{problem.outputFormat}</p>
          <h2>Example</h2>
          <div className="codegle-example"><small>INPUT</small><code>{problem.examples[0].input}</code><small>OUTPUT</small><code>{problem.examples[0].output}</code></div>
          <h2>Constraints</h2>{problem.constraints.map((constraint) => <code className="codegle-constraint" key={constraint}>{constraint}</code>)}
        </aside>
        <section className={testOpen ? 'codegle-editor-pane test-open' : 'codegle-editor-pane'}>
          <div className="codegle-editor-toolbar">
            <span><i /> main.{CODEGLE_LANGUAGES.find(({ id }) => id === language).extension}</span>
            {match.isBot && <span className="codegle-bot-thinking"><Bot /> {match.opponent.name} is solving</span>}
            <div className="codegle-editor-actions">
              <button className={testOpen ? 'codegle-test-toggle active' : 'codegle-test-toggle'} onClick={() => setTestOpen((open) => !open)} aria-expanded={testOpen}><Play /> Test code</button>
              <label>Language<select value={language} onChange={(event) => { setLanguage(event.target.value); setTestResult(null); }}>{CODEGLE_LANGUAGES.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}</select></label>
            </div>
          </div>
          <CodeMirror
            value={sources[language]}
            height="100%"
            minHeight="430px"
            theme={vscodeDark}
            extensions={[languageExtension[language]]}
            onChange={(value) => {
              setSources((current) => ({ ...current, [language]: value }));
              setTestResult(null);
            }}
            basicSetup={{ lineNumbers: true, bracketMatching: true, closeBrackets: true, highlightActiveLine: true, highlightSelectionMatches: true, indentOnInput: true, foldGutter: true }}
            indentWithTab
            aria-label="Code editor"
          />
          {testOpen && (
            <section className="codegle-test-console">
              <label>
                <span>CUSTOM INPUT</span>
                <textarea value={testInput} onChange={(event) => setTestInput(event.target.value)} maxLength={8192} spellCheck="false" aria-label="Custom program input" />
              </label>
              <div className="codegle-test-output" aria-live="polite">
                <header><span>PROGRAM OUTPUT</span><button onClick={() => { setTestInput(problem.examples[0].input); setTestResult(null); }}><RotateCcw /> Use sample</button></header>
                <pre className={testResult ? testResult.status : ''}>{running ? 'Running in the sandbox…' : testResult ? (testResult.status === 'completed' ? (testResult.output || '(no output)') : (testResult.message || 'Run failed.')) : 'Run your code to see its output here.'}</pre>
              </div>
              <button className="button codegle-run" onClick={runTest} disabled={running || submitting || countdown > 0 || Boolean(winner)}>{running ? <LoaderCircle className="upload-spin" /> : <Play />}{running ? 'Running…' : 'Run code'}</button>
            </section>
          )}
          <footer className={verdict ? `codegle-verdict ${verdict.status}` : 'codegle-verdict'}>
            <div>{verdict ? (verdict.status === 'accepted' ? <Check /> : <FlaskConical />) : <Terminal />}<span><strong>{verdict ? verdict.status.replaceAll('_', ' ').toUpperCase() : 'READY'}</strong><small>{verdict?.message || 'Your code runs against hidden tests when submitted.'}</small></span></div>
            <button className="button codegle-submit" onClick={submit} disabled={submitting || running || countdown > 0 || Boolean(winner)}>{submitting ? <LoaderCircle className="upload-spin" /> : verdict && verdict.status !== 'accepted' ? <RotateCcw /> : <Send />}{submitting ? 'Running…' : verdict && verdict.status !== 'accepted' ? 'Try again' : 'Submit solution'}</button>
          </footer>
        </section>
      </div>
      {countdown > 0 && <div className="codegle-countdown">{match.isBot ? <Bot /> : <Code2 />}<small>{match.isBot ? `${match.botKind === 'solitaire' ? 'SOLITAIRE' : 'BOT FALLBACK'} · BOT OPPONENT` : 'CODERS READY'}</small><strong>{countdown}</strong></div>}
      {winner && <div className="codegle-winner-flash"><Trophy /><strong>{winner.playerId === match.playerId ? 'Accepted — you won!' : `${match.opponent.name} solved it first`}</strong></div>}
    </main>
  );
}

export function CodegleResults({ result, onRematch, onHome }) {
  return (
    <main className="codegle-results">
      <div className={result.won ? 'codegle-result-icon won' : 'codegle-result-icon'}>{result.won ? <Trophy /> : <Code2 />}</div>
      <p className="eyebrow">CODEGLE BETA · {difficultyLabel(result.difficulty).toUpperCase()} · {result.vsBot ? 'BOT MATCH' : 'MATCH COMPLETE'}</p>
      <h1>{result.won ? 'You compiled the win.' : `${result.winnerName} solved it first.`}</h1>
      <p>{result.won ? 'All hidden tests passed before your opponent.' : 'Refactor, resubmit, and take the next race.'}</p>
      <div className="codegle-result-stat"><Clock3 /><span><small>WINNING TIME</small><strong>{(result.elapsedMs / 1000).toFixed(1)} seconds</strong></span></div>
      {result.hintsUsed > 0 && <small className="codegle-result-penalty"><Lightbulb /> Includes +{result.penaltyMs / 1000}s from {result.hintsUsed} {result.hintsUsed === 1 ? 'hint' : 'hints'}.</small>}
      <small className="codegle-count-note"><Check /> {result.vsBot ? 'This clearly labeled bot race counts' : 'Codegle matches count'} toward matches completed all time.</small>
      <div><button className="button codegle-primary" onClick={onRematch}><RotateCcw /> Race again</button><button className="button button-secondary" onClick={onHome}>Back to Stemegle <ArrowRight /></button></div>
    </main>
  );
}

export default function CodegleView({ view, ...props }) {
  if (view === 'intro') return <CodegleIntro {...props} />;
  if (view === 'matchmaking') return <CodegleMatchmaking {...props} />;
  if (view === 'game') return <CodegleGame {...props} />;
  if (view === 'results') return <CodegleResults {...props} />;
  return null;
}
