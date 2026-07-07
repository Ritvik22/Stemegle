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

const QUESTIONS = [
  { category: 'Physics', q: 'A car travels 120 km in 2 hours. What is its average speed?', choices: ['40 km/h', '60 km/h', '80 km/h', '240 km/h'], answer: 1 },
  { category: 'Biology', q: 'Which organelle is known as the powerhouse of the cell?', choices: ['Nucleus', 'Ribosome', 'Mitochondrion', 'Golgi body'], answer: 2 },
  { category: 'Mathematics', q: 'What is the next prime number after 19?', choices: ['20', '21', '23', '29'], answer: 2 },
  { category: 'Chemistry', q: 'What is the chemical symbol for gold?', choices: ['Ag', 'Gd', 'Go', 'Au'], answer: 3 },
  { category: 'Space', q: 'Which planet has the shortest year?', choices: ['Mercury', 'Venus', 'Mars', 'Jupiter'], answer: 0 },
];

const LEADERS = [
  { rank: 1, name: 'NovaNerd', xp: '18,942', streak: 14, color: '#b7ff5a' },
  { rank: 2, name: 'QuantumQuinn', xp: '18,105', streak: 9, color: '#73ddff' },
  { rank: 3, name: 'AstroAce', xp: '17,870', streak: 7, color: '#ffab73' },
  { rank: 4, name: 'PiRates', xp: '16,442', streak: 6, color: '#cf9cff' },
  { rank: 5, name: 'BioBoss', xp: '15,997', streak: 4, color: '#ff7ca8' },
];

const OPPONENTS = ['QuantumQuinn', 'AstroAce', 'NeuronNinja', 'LabLegend'];

function Logo() {
  return <a className="logo" href="#top" aria-label="Stemegle home"><span className="logo-mark"><Atom size={22} /></span><span>stemegle</span></a>;
}

function Header({ onGuest, onCreate }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <Logo />
      <nav className={open ? 'nav open' : 'nav'} aria-label="Main navigation">
        <a href="#how" onClick={() => setOpen(false)}>How it works</a>
        <a href="#leaderboard" onClick={() => setOpen(false)}>Leaderboard</a>
        <button className="nav-login" onClick={onGuest}>Guest play</button>
        <button className="button button-small" onClick={onCreate}>Create account <ArrowRight size={15} /></button>
      </nav>
      <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? <X /> : <Menu />}</button>
    </header>
  );
}

function BattleCard() {
  return (
    <div className="battle-wrap" aria-label="Preview of a live Stemegle battle">
      <div className="float-chip chip-one"><FlaskConical size={16} /> Chemistry streak!</div>
      <div className="float-chip chip-two"><Zap size={16} /> +240 XP</div>
      <div className="battle-card">
        <div className="battle-topline"><span className="live-pill"><i /> LIVE BATTLE</span><span>Question 3 of 5</span></div>
        <div className="players">
          <div className="player"><span className="avatar avatar-you">Y</span><div><strong>You</strong><small>1,240 pts</small></div></div>
          <div className="versus">VS</div>
          <div className="player opponent"><div><strong>NovaNerd</strong><small>980 pts</small></div><span className="avatar avatar-nova">N</span></div>
        </div>
        <div className="question-preview">
          <div className="question-meta"><span><Bolt size={14} /> PHYSICS</span><span className="mini-timer"><Clock3 size={14} /> 08.4s</span></div>
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

function EntryModal({ mode, onClose, onStart }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const isGuest = mode === 'guest';
  const valid = isGuest ? name.trim().length >= 2 : name.trim().length >= 2 && email.includes('@');

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <span className="modal-icon">{isGuest ? <Play /> : <Rocket />}</span>
        <p className="eyebrow">{isGuest ? 'QUICK PLAY' : 'JOIN THE LEAGUE'}</p>
        <h2 id="entry-title">{isGuest ? 'Choose your battle name' : 'Create your contender'}</h2>
        <p>{isGuest ? 'No account, no fuss. Pick a name and jump straight into a match.' : 'Save your rank, build streaks, and climb the universal leaderboard.'}</p>
        <label>Battle name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ProtonPilot" maxLength={18} /></label>
        {!isGuest && <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>}
        <button className="button button-wide" disabled={!valid} onClick={() => onStart(name.trim())}>{isGuest ? 'Find an opponent' : 'Create & play'} <ArrowRight size={18} /></button>
        <small className="privacy"><Lock size={12} /> {isGuest ? 'Guest progress lasts for this session.' : 'No spam. Just scores, streaks, and science.'}</small>
      </div>
    </div>
  );
}

function Matchmaking({ name, onMatched, onCancel }) {
  const [secondsWaiting, setSecondsWaiting] = useState(0);
  const [opponentOnline, setOpponentOnline] = useState(false);

  useEffect(() => {
    const waitTicker = setInterval(() => setSecondsWaiting((seconds) => seconds + 1), 1000);

    // Demo presence event. In production, the matchmaker should trigger this
    // only after the realtime backend reports another queued player.
    let matchTimer;
    const presenceTimer = setTimeout(() => {
      setOpponentOnline(true);
      matchTimer = setTimeout(
        () => onMatched(OPPONENTS[Math.floor(Math.random() * OPPONENTS.length)]),
        1200,
      );
    }, 5000);

    return () => {
      clearInterval(waitTicker);
      clearTimeout(presenceTimer);
      clearTimeout(matchTimer);
    };
  }, [onMatched]);

  const progress = opponentOnline ? 100 : Math.min(22 + secondsWaiting * 9, 76);

  return (
    <main className="game-shell matchmaking-screen">
      <Logo />
      <div className="radar"><span className="radar-ring r1" /><span className="radar-ring r2" /><span className="radar-ring r3" /><span className="radar-sweep" /><span className="avatar avatar-you radar-avatar">{name[0].toUpperCase()}</span></div>
      <p className="eyebrow"><i className="status-dot" /> {opponentOnline ? 'OPPONENT ONLINE' : 'YOU’RE IN THE QUEUE'}</p>
      <h1>{opponentOnline ? 'Opponent found!' : 'Waiting for a rival...'}</h1>
      <p>{opponentOnline ? 'Locking in your live match' : 'You’ll be matched as soon as another player comes online'}</p>
      <div className="search-progress"><i style={{ width: `${progress}%` }} /></div>
      <div className="match-stats">
        <span className={opponentOnline ? 'opponent-count online' : 'opponent-count'}><Globe2 /> {opponentOnline ? '1 opponent available' : '0 opponents available'}</span>
        <span><Clock3 /> Waiting {secondsWaiting}s</span>
      </div>
      {!opponentOnline && <p className="queue-note">You’re first in line. Keep this tab open.</p>}
      <button className="text-button" onClick={onCancel}>Cancel search</button>
    </main>
  );
}

function Game({ player, opponent, onFinish }) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [time, setTime] = useState(15);
  const [score, setScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState('');
  const transitionTimer = useRef(null);
  const question = QUESTIONS[questionIndex];

  const advance = useCallback((finalScore) => {
    const rivalGain = 520 + Math.floor(Math.random() * 480);
    const nextRival = opponentScore + rivalGain;
    if (questionIndex === QUESTIONS.length - 1) {
      onFinish({ score: finalScore, opponentScore: nextRival });
      return;
    }
    setOpponentScore(nextRival);
    setQuestionIndex((i) => i + 1);
    setTime(15);
    setSelected(null);
    setFeedback('');
  }, [onFinish, opponentScore, questionIndex]);

  useEffect(() => () => clearTimeout(transitionTimer.current), []);

  useEffect(() => {
    if (selected !== null) return undefined;
    const timer = setInterval(() => setTime((t) => Math.max(0, +(t - 0.1).toFixed(1))), 100);
    return () => clearInterval(timer);
  }, [questionIndex, selected]);

  useEffect(() => {
    if (time > 0 || selected !== null) return;
    setSelected(-1);
    setFeedback('Time!');
    transitionTimer.current = setTimeout(() => advance(score), 750);
  }, [advance, score, selected, time]);

  function choose(index) {
    if (selected !== null) return;
    setSelected(index);
    const correct = index === question.answer;
    const gain = correct ? 500 + Math.round(time * 45) : 0;
    const nextScore = score + gain;
    setScore(nextScore);
    setFeedback(correct ? `Correct! +${gain}` : 'Not quite!');
    transitionTimer.current = setTimeout(() => advance(nextScore), 850);
  }

  return (
    <main className="game-shell arena">
      <div className="game-header"><Logo /><span className="round-label">RANKED · ROUND {questionIndex + 1}/{QUESTIONS.length}</span><button className="icon-button" aria-label="Exit game" onClick={() => onFinish({ score, opponentScore })}><X /></button></div>
      <div className="scoreboard">
        <div className="game-player"><span className="avatar avatar-you">{player[0].toUpperCase()}</span><div><small>YOU</small><strong>{player}</strong></div><b>{score.toLocaleString()}</b></div>
        <div className="vs-badge">VS</div>
        <div className="game-player rival"><b>{opponentScore.toLocaleString()}</b><div><small>RIVAL</small><strong>{opponent}</strong></div><span className="avatar avatar-nova">{opponent[0]}</span></div>
      </div>
      <div className="game-progress"><i style={{ width: `${((questionIndex + 1) / QUESTIONS.length) * 100}%` }} /></div>
      <section className="question-card">
        <div className="question-meta"><span><BrainCircuit size={15} /> {question.category.toUpperCase()}</span><span className={time < 5 ? 'timer timer-low' : 'timer'}><Clock3 size={17} /> {time.toFixed(1)}s</span></div>
        <h1>{question.q}</h1>
        <div className="game-answers">
          {question.choices.map((choice, index) => {
            let state = '';
            if (selected !== null && index === question.answer) state = 'correct';
            else if (selected === index) state = 'wrong';
            return <button className={state} key={choice} onClick={() => choose(index)} disabled={selected !== null}><span>{String.fromCharCode(65 + index)}</span>{choice}{state === 'correct' && <Check />}{state === 'wrong' && <X />}</button>;
          })}
        </div>
        <div className={feedback ? 'feedback show' : 'feedback'}>{feedback || 'placeholder'}</div>
      </section>
    </main>
  );
}

function Results({ player, opponent, result, onRematch, onHome }) {
  const won = result.score >= result.opponentScore;
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
      <div className="reward-row"><span><Zap /> +{won ? 84 : 32} XP</span><span><BarChart3 /> Rank #{won ? '12,481' : '12,533'}</span><span><Bolt /> {won ? '2' : '0'} streak</span></div>
      <div className="result-actions"><button className="button" onClick={onRematch}><Play size={17} /> Play again</button><button className="button button-secondary" onClick={onHome}>Back home</button></div>
    </main>
  );
}

function Landing({ onGuest, onCreate }) {
  return (
    <div id="top">
      <Header onGuest={onGuest} onCreate={onCreate} />
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="social-proof"><span className="proof-faces"><i>N</i><i>Q</i><i>A</i></span><span><b>2,481</b> minds battling now</span></div>
            <p className="eyebrow">REAL-TIME STEM SHOWDOWNS</p>
            <h1>Think fast.<br />Win <em>faster.</em></h1>
            <p className="hero-sub">Go head-to-head in rapid-fire STEM battles. Outsmart real opponents, climb the universal ranks, and prove your brain has game.</p>
            <div className="hero-actions"><button className="button button-large" onClick={onGuest}><Play fill="currentColor" size={18} /> Play as guest</button><button className="button button-secondary button-large" onClick={onCreate}>Create account <ArrowRight size={18} /></button></div>
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
          <div className="rank-callout"><p className="eyebrow">ONE PLANET. ONE RANK.</p><h2>How smart<br />is the world?</h2><p>Every battle counts toward one universal leaderboard. Season One is live—and the top spot is still up for grabs.</p><div className="rank-stat"><Crown /><span><b>Season 01</b><small>Ends in 18 days</small></span></div><button className="button button-light" onClick={onCreate}>Claim your rank <ArrowRight /></button></div>
          <div className="leaderboard-card">
            <div className="leader-header"><div><span className="live-pill"><i /> LIVE</span><h3>Global leaderboard</h3></div><span>Season 01</span></div>
            <div className="leader-cols"><span>RANK & PLAYER</span><span>STREAK</span><span>XP</span></div>
            {LEADERS.map((leader) => <div className="leader-row" key={leader.name}><span className={leader.rank <= 3 ? 'leader-rank top' : 'leader-rank'}>{leader.rank}</span><span className="leader-avatar" style={{ background: leader.color }}>{leader.name[0]}</span><strong>{leader.name}{leader.rank === 1 && <Crown size={14} />}</strong><span className="streak"><Zap size={14} fill="currentColor" /> {leader.streak}</span><b>{leader.xp}</b></div>)}
            <div className="your-rank"><span>12,482</span><span className="leader-avatar">Y</span><strong>You could be here</strong><button onClick={onGuest}>PLAY NOW <ArrowRight /></button></div>
          </div>
        </section>

        <section className="final-cta"><div className="cta-orbit orbit-one" /><div className="cta-orbit orbit-two" /><span className="cta-icon"><Rocket /></span><p className="eyebrow">YOUR NEXT RIVAL IS ONLINE</p><h2>Ready to put your<br />brain on the board?</h2><p>One name. Five questions. Infinite bragging rights.</p><button className="button button-large" onClick={onGuest}><Play fill="currentColor" /> Start battling — it’s free</button></section>
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
  const [result, setResult] = useState(null);
  const handleMatched = useCallback((name) => { setOpponent(name); setScreen('game'); }, []);
  const handleFinish = useCallback((data) => { setResult(data); setScreen('results'); }, []);

  function start(name) { setPlayer(name); setModal(null); setScreen('matchmaking'); }
  function rematch() { setResult(null); setScreen('matchmaking'); }
  function home() { setScreen('landing'); setResult(null); setOpponent(''); }

  if (screen === 'matchmaking') return <Matchmaking name={player} onMatched={handleMatched} onCancel={home} />;
  if (screen === 'game') return <Game player={player} opponent={opponent} onFinish={handleFinish} />;
  if (screen === 'results') return <Results player={player} opponent={opponent} result={result} onRematch={rematch} onHome={home} />;
  return <><Landing onGuest={() => setModal('guest')} onCreate={() => setModal('create')} />{modal && <EntryModal mode={modal} onClose={() => setModal(null)} onStart={start} />}</>;
}
