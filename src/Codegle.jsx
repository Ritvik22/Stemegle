import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import {
  ArrowLeft, ArrowRight, Braces, Check, Clock3, Code2, Cpu, FlaskConical,
  LoaderCircle, Play, RotateCcw, Send, Sparkles, Terminal, Trophy, Users, X,
} from 'lucide-react';
import { submitCodegleSolution } from './lib/api';
import { getPresencePlayers, hasRealtimeConfig, realtime } from './lib/realtime';
import { CODEGLE_LANGUAGES, getCodegleProblem, getCodegleProblemForMatch } from './data/codegleProblems';
import { trackAnalyticsEvent } from './lib/analytics';

const CODEGLE_LOBBY = 'stemegle:codegle:lobby:v1';
const CODEGLE_MATCH_PREFIX = 'stemegle:codegle:match:';

function playerId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const languageExtension = {
  python: python(), java: java(), cpp: cpp(), javascript: javascript(),
};

export function CodegleIntro({ onBack, onPlay }) {
  return (
    <main className="codegle-intro">
      <button className="codegle-back" onClick={onBack}><ArrowLeft size={17} /> Back to Stemegle</button>
      <div className="codegle-beta-badge"><Sparkles size={15} /> BETA</div>
      <section className="codegle-intro-grid">
        <div className="codegle-intro-copy">
          <p className="eyebrow">LIVE COMPETITIVE CODING</p>
          <h1>Meet <span>Codegle.</span></h1>
          <p>Get one coding problem, write a real program, and race a live opponent through hidden tests. Wrong answer? Fix it and submit again. First accepted solution wins.</p>
          <button className="button button-large codegle-primary" onClick={onPlay}><Code2 /> Find a coding rival <ArrowRight /></button>
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

export function CodegleMatchmaking({ name, onMatched, onCancel }) {
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState(hasRealtimeConfig ? 'connecting' : 'error');
  const [error, setError] = useState(hasRealtimeConfig ? '' : 'Realtime multiplayer is not configured.');
  const ownId = useRef(playerId());

  useEffect(() => {
    trackAnalyticsEvent('queue_started', { mode: 'codegle' });
    const ticker = setInterval(() => setSeconds((value) => value + 1), 1000);
    if (!hasRealtimeConfig) return () => clearInterval(ticker);
    let active = true;
    let lobby;
    let attempt;
    let joined = false;

    const clearAttempt = () => {
      if (!attempt) return;
      attempt.intervals.forEach(clearInterval);
      attempt.timers.forEach(clearTimeout);
      attempt.channel.untrack();
      realtime.removeChannel(attempt.channel);
      attempt = null;
    };

    const beginAttempt = (opponent) => {
      const matchId = [ownId.current, opponent.playerId].sort().join('--');
      const isHost = matchId.startsWith(ownId.current);
      const channel = realtime.channel(`${CODEGLE_MATCH_PREFIX}${matchId}`, {
        config: { presence: { key: ownId.current }, broadcast: { self: true, ack: true } },
      });
      attempt = { channel, opponentId: opponent.playerId, intervals: [], timers: [] };
      let opponentReady = false;

      const finishPairing = (payload) => {
        if (!active || joined) return;
        joined = true;
        attempt.intervals.forEach(clearInterval);
        attempt.timers.forEach(clearTimeout);
        lobby.untrack();
        realtime.removeChannel(lobby);
        lobby = null;
        onMatched({
          id: matchId,
          playerId: ownId.current,
          opponent: { id: opponent.playerId, name: opponent.name },
          problemId: payload.problemId,
          startsAt: payload.startsAt,
          channel,
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
            await channel.track({ playerId: ownId.current, name, joinedAt: Date.now(), mode: 'codegle' });
            attempt.intervals.push(setInterval(() => {
              if (!active || joined) return;
              channel.send({ type: 'broadcast', event: 'ready', payload: { playerId: ownId.current } });
              if (isHost && opponentReady && channel.matchAuthorization()) {
                const problem = getCodegleProblemForMatch(matchId);
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
      if (!active || joined || !lobby) return;
      const players = getPresencePlayers(lobby).sort((a, b) => a.joinedAt - b.joinedAt || a.playerId.localeCompare(b.playerId));
      const index = players.findIndex((candidate) => candidate.playerId === ownId.current);
      if (index < 0) return;
      const opponent = players[index % 2 === 0 ? index + 1 : index - 1];
      if (!opponent) { clearAttempt(); setStatus('waiting'); return; }
      if (attempt?.opponentId === opponent.playerId) return;
      clearAttempt();
      beginAttempt(opponent);
    };

    lobby = realtime.channel(CODEGLE_LOBBY, { config: { presence: { key: ownId.current } } });
    lobby.on('presence', { event: 'sync' }, pair).subscribe(async (subscriptionStatus) => {
      if (subscriptionStatus === 'SUBSCRIBED') {
        setStatus('waiting');
        await lobby.track({ playerId: ownId.current, name, joinedAt: Date.now(), mode: 'codegle' });
      }
      if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
        setStatus('error');
        setError('Unable to reach the Codegle lobby.');
      }
    });
    return () => {
      active = false;
      clearInterval(ticker);
      if (lobby) { lobby.untrack(); realtime.removeChannel(lobby); }
      if (attempt && !joined) clearAttempt();
    };
  }, [name, onMatched]);

  return (
    <main className="codegle-queue">
      <div className="codegle-beta-badge"><Sparkles size={15} /> CODEGLE BETA</div>
      <div className="codegle-queue-orbit"><Code2 /><i /><i /><i /></div>
      <p className="eyebrow">SEPARATE CODING QUEUE</p>
      <h1>{status === 'opponent-found' ? 'Coder found!' : status === 'error' ? 'Compiler lobby offline' : 'Finding a coding rival…'}</h1>
      <p>{error || 'You’ll only match with another Codegle player. The normal STEM battle queue stays separate.'}</p>
      <div className="codegle-queue-status"><span><Users /> {status === 'opponent-found' ? 'Opponent connected' : 'Codegle pool'}</span><span><Clock3 /> {seconds}s</span></div>
      <button className="codegle-text-button" onClick={onCancel}><X /> Cancel search</button>
    </main>
  );
}

export function CodegleGame({ player, match, onFinish, onExit }) {
  const problem = getCodegleProblem(match.problemId);
  const [language, setLanguage] = useState('python');
  const [sources, setSources] = useState(() => Object.fromEntries(CODEGLE_LANGUAGES.map(({ id }) => [id, problem.starter[id]])));
  const [submitting, setSubmitting] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [winner, setWinner] = useState(null);
  const [countdown, setCountdown] = useState(Math.max(0, Math.ceil((match.startsAt - Date.now()) / 1000)));
  const [elapsed, setElapsed] = useState(0);
  const finishedRef = useRef(false);

  const finish = useCallback((solved) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const won = solved.playerId === match.playerId;
    setWinner(solved);
    setTimeout(() => onFinish({
      type: 'codegle', won, winnerName: won ? player : match.opponent.name,
      opponentName: match.opponent.name, elapsedMs: solved.elapsedMs,
    }), 1100);
  }, [match.opponent.name, match.playerId, onFinish, player]);

  useEffect(() => {
    const channel = match.channel;
    channel.on('broadcast', { event: 'solved' }, ({ payload }) => finish(payload));
    return () => {
      channel.untrack();
      realtime.removeChannel(channel);
    };
  }, [finish, match.channel]);

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((match.startsAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (!remaining) setElapsed(Date.now() - match.startsAt);
    }, 250);
    return () => clearInterval(timer);
  }, [match.startsAt]);

  useLayoutEffect(() => {
    const render = () => JSON.stringify({
      mode: 'codegle-game', problem: problem.id, language, submitting,
      verdict: verdict?.status || null, elapsedMs: elapsed,
      player, opponent: match.opponent.name, winner: winner?.playerId || null,
    });
    window.render_game_to_text = render;
    return () => { if (window.render_game_to_text === render) delete window.render_game_to_text; };
  }, [elapsed, language, match.opponent.name, player, problem.id, submitting, verdict, winner]);

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
        <div><span>{player}</span><b>VS</b><span>{match.opponent.name}</span></div>
        <time><Clock3 /> {Math.floor(elapsed / 60000)}:{String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}</time>
      </header>
      <div className="codegle-workspace">
        <aside className="codegle-problem">
          <div className="codegle-problem-top"><span>{problem.difficulty}</span><small>ONE PROBLEM · FIRST ACCEPTED WINS</small></div>
          <h1>{problem.title}</h1>
          <p>{problem.description}</p>
          <h2>Input</h2><p>{problem.inputFormat}</p>
          <h2>Output</h2><p>{problem.outputFormat}</p>
          <h2>Example</h2>
          <div className="codegle-example"><small>INPUT</small><code>{problem.examples[0].input}</code><small>OUTPUT</small><code>{problem.examples[0].output}</code></div>
          <h2>Constraints</h2>{problem.constraints.map((constraint) => <code className="codegle-constraint" key={constraint}>{constraint}</code>)}
        </aside>
        <section className="codegle-editor-pane">
          <div className="codegle-editor-toolbar">
            <span><i /> main.{CODEGLE_LANGUAGES.find(({ id }) => id === language).extension}</span>
            <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}>{CODEGLE_LANGUAGES.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}</select></label>
          </div>
          <CodeMirror
            value={sources[language]}
            height="100%"
            minHeight="430px"
            theme={vscodeDark}
            extensions={[languageExtension[language]]}
            onChange={(value) => setSources((current) => ({ ...current, [language]: value }))}
            basicSetup={{ lineNumbers: true, bracketMatching: true, closeBrackets: true, highlightActiveLine: true, highlightSelectionMatches: true, indentOnInput: true, foldGutter: true }}
            indentWithTab
            aria-label="Code editor"
          />
          <footer className={verdict ? `codegle-verdict ${verdict.status}` : 'codegle-verdict'}>
            <div>{verdict ? (verdict.status === 'accepted' ? <Check /> : <FlaskConical />) : <Terminal />}<span><strong>{verdict ? verdict.status.replaceAll('_', ' ').toUpperCase() : 'READY'}</strong><small>{verdict?.message || 'Your code runs against hidden tests when submitted.'}</small></span></div>
            <button className="button codegle-submit" onClick={submit} disabled={submitting || countdown > 0 || Boolean(winner)}>{submitting ? <LoaderCircle className="upload-spin" /> : verdict && verdict.status !== 'accepted' ? <RotateCcw /> : <Send />}{submitting ? 'Running…' : verdict && verdict.status !== 'accepted' ? 'Try again' : 'Submit solution'}</button>
          </footer>
        </section>
      </div>
      {countdown > 0 && <div className="codegle-countdown"><Code2 /><small>CODERS READY</small><strong>{countdown}</strong></div>}
      {winner && <div className="codegle-winner-flash"><Trophy /><strong>{winner.playerId === match.playerId ? 'Accepted — you won!' : `${match.opponent.name} solved it first`}</strong></div>}
    </main>
  );
}

export function CodegleResults({ result, onRematch, onHome }) {
  return (
    <main className="codegle-results">
      <div className={result.won ? 'codegle-result-icon won' : 'codegle-result-icon'}>{result.won ? <Trophy /> : <Code2 />}</div>
      <p className="eyebrow">CODEGLE BETA · MATCH COMPLETE</p>
      <h1>{result.won ? 'You compiled the win.' : `${result.winnerName} solved it first.`}</h1>
      <p>{result.won ? 'All hidden tests passed before your opponent.' : 'Refactor, resubmit, and take the next race.'}</p>
      <div className="codegle-result-stat"><Clock3 /><span><small>WINNING TIME</small><strong>{(result.elapsedMs / 1000).toFixed(1)} seconds</strong></span></div>
      <small className="codegle-count-note"><Check /> Codegle matches count toward matches completed all time.</small>
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
