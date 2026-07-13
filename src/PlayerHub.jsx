import {
  ArrowLeft,
  ArrowRight,
  Award,
  Bot,
  Brain,
  Check,
  CircleAlert,
  Flame,
  Gamepad2,
  GraduationCap,
  LoaderCircle,
  LockKeyhole,
  Medal,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy,
  UserRound,
  Users,
  Zap,
} from 'lucide-react';
import { getCompetitiveRatingTier } from './lib/playerProgression';
import './player-hub.css';

const SUBJECT_TONES = ['lime', 'cyan', 'gold', 'coral', 'violet'];

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, asNumber(value)));
}

function formatNumber(value) {
  return asNumber(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatMonthYear(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);
}

function titleCase(value, fallback = '') {
  if (!value) return fallback;
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeMastery(input) {
  const source = Array.isArray(input) ? input : [];
  return source.flatMap((entry, subjectIndex) => {
    const subject = firstValue(entry.subject, entry.category, entry.name, 'General STEM');
    const difficulties = Array.isArray(entry.difficulties) ? entry.difficulties : [entry];
    return difficulties.map((row, difficultyIndex) => {
      const attempted = asNumber(firstValue(row.attempted, row.attempts, row.questions_attempted, row.total));
      const correct = asNumber(firstValue(row.correct, row.correctAnswers, row.correct_answers));
      const derived = attempted > 0 ? (correct / attempted) * 100 : 0;
      return {
        key: `${subject}-${firstValue(row.difficulty, row.level, difficultyIndex)}`,
        subject: titleCase(subject, 'General STEM'),
        difficulty: titleCase(firstValue(row.difficulty, row.level), 'All levels'),
        attempted,
        correct,
        percent: clamp(firstValue(row.mastery, row.masteryScore, row.mastery_score, row.accuracy, row.percentage, derived)),
        tone: SUBJECT_TONES[subjectIndex % SUBJECT_TONES.length],
      };
    });
  });
}

function normalizeMatches(input) {
  return (Array.isArray(input) ? input : []).map((match, index) => {
    const rawOutcome = String(firstValue(match.outcome, match.result, match.status, '')).toLowerCase();
    const drawn = ['draw', 'tie', 'tied'].includes(rawOutcome);
    const won = match.won === true || ['win', 'won', 'victory'].includes(rawOutcome);
    const lost = !drawn && (match.won === false || ['loss', 'lost', 'defeat'].includes(rawOutcome));
    const opponentType = String(firstValue(match.opponent_type, match.kind, match.mode, '')).toLowerCase();
    const isBot = match.is_bot === true || opponentType.includes('bot');
    const opponent = match.opponent && typeof match.opponent === 'object' ? match.opponent : {};
    const rawRatingChange = firstValue(match.rating_change, match.ratingChange, match.elo_change, match.mmr_change);
    return {
      key: firstValue(match.id, match.match_id, `${index}-${match.created_at || ''}`),
      opponent: firstValue(match.opponent_name, match.opponentName, opponent.battleName, opponent.name, match.rival_name, isBot ? 'Stemegle Bot' : 'Unknown rival'),
      subject: titleCase(firstValue(match.subject, match.category), 'Mixed STEM'),
      difficulty: titleCase(firstValue(match.difficulty, match.level), 'Mixed'),
      playerScore: asNumber(firstValue(match.player_score, match.score, match.your_score)),
      opponentScore: asNumber(firstValue(match.opponent_score, match.opponentScore, match.rival_score)),
      ratingChange: rawRatingChange === undefined ? null : asNumber(rawRatingChange),
      outcome: won ? 'Win' : lost ? 'Loss' : 'Draw',
      isBot,
      date: firstValue(match.completed_at, match.completedAt, match.created_at, match.played_at),
    };
  });
}

function normalizeGoals(input) {
  return (Array.isArray(input) ? input : []).map((goal, index) => {
    const target = Math.max(1, asNumber(firstValue(goal.target, goal.total, goal.required), 1));
    const progress = Math.max(0, asNumber(firstValue(goal.progress, goal.current, goal.completed_count)));
    return {
      key: firstValue(goal.id, `${index}-${goal.title || goal.name || ''}`),
      title: firstValue(goal.title, goal.name, goal.label, 'Daily goal'),
      detail: firstValue(goal.description, goal.detail, `${Math.min(progress, target)} of ${target}`),
      progress,
      target,
      complete: goal.complete === true || goal.completed === true || progress >= target,
    };
  });
}

function normalizeAchievements(input) {
  return (Array.isArray(input) ? input : []).map((achievement, index) => ({
    key: firstValue(achievement.id, `${index}-${achievement.title || achievement.name || ''}`),
    title: firstValue(achievement.title, achievement.name, achievement.label, 'Achievement'),
    detail: firstValue(achievement.description, achievement.detail, achievement.requirement, 'Keep playing to unlock.'),
    unlocked: achievement.unlocked === true || achievement.earned === true || Boolean(achievement.unlocked_at),
    unlockedAt: firstValue(achievement.unlocked_at, achievement.earned_at),
  }));
}

function normalizeHub(data, session) {
  const source = data && typeof data === 'object' ? data : {};
  const player = source.player || source.profile || source.user || {};
  const stats = source.stats || source.progression || source.summary || {};
  const rank = source.rank || {};
  const rating = (source.rating && typeof source.rating === 'object' ? source.rating : null) || source.competitive || {};
  const mastery = normalizeMastery(firstValue(source.mastery, source.category_mastery, source.subjects, []));
  const matches = normalizeMatches(firstValue(source.recent_matches, source.recentMatches, source.matches, source.history, []));
  const goals = normalizeGoals(firstValue(source.daily_goals, source.dailyGoals, source.goals, []));
  const achievements = normalizeAchievements(firstValue(source.achievements, source.badges, []));
  const sessionUser = session?.user || session || {};
  const rawRatingValue = firstValue(rating.value, rating.rating, player.competitive_rating, player.competitiveRating, stats.rating, source.rating_value, typeof source.rating === 'number' ? source.rating : undefined);
  const ratingGames = asNumber(firstValue(rating.games, rating.rating_games, player.rating_games, player.ratingGames));
  const ratingTier = getCompetitiveRatingTier(rawRatingValue, ratingGames);
  const weakest = mastery.filter((row) => row.attempted > 0).sort((a, b) => a.percent - b.percent)[0];
  const recommendation = source.recommendation || source.recommended_practice || {};
  const recommendationSubject = firstValue(recommendation.subject, recommendation.category, weakest?.subject);
  const recommendationDifficulty = firstValue(recommendation.difficulty, recommendation.level, weakest?.difficulty);
  const wins = asNumber(firstValue(stats.wins, player.wins));
  const losses = asNumber(firstValue(stats.losses, player.losses));
  const reportedMatchesPlayed = firstValue(
    stats.matchesPlayed,
    stats.matches_played,
    player.matchesPlayed,
    player.matches_played,
    source.matchesPlayed,
    source.matches_played,
  );
  const reportedDraws = firstValue(stats.draws, player.draws, source.draws);
  const draws = reportedDraws === undefined
    ? Math.max(0, asNumber(reportedMatchesPlayed, wins + losses) - wins - losses)
    : Math.max(0, asNumber(reportedDraws));
  const matchesPlayed = Math.max(
    wins + losses + draws,
    asNumber(reportedMatchesPlayed, wins + losses + draws),
  );

  return {
    player: {
      name: firstValue(player.battle_name, player.battleName, player.name, sessionUser.name, 'STEM challenger'),
      joinedAt: firstValue(player.created_at, player.joined_at, sessionUser.createdAt),
    },
    rating: {
      value: ratingTier.value,
      tier: ratingTier.name,
      provisional: ratingTier.provisional,
      placementGames: ratingTier.placementGames,
      percentile: clamp(firstValue(rating.percentile, rating.top_percent)),
    },
    stats: {
      xp: asNumber(firstValue(stats.xp, player.xp, player.total_score, player.totalScore, source.xp)),
      level: asNumber(firstValue(stats.level, player.level, source.level), Math.max(1, Math.floor(asNumber(firstValue(player.total_score, player.totalScore)) / 1000) + 1)),
      globalRank: asNumber(firstValue(stats.global_rank, stats.rank, player.global_rank, player.rank_position, rank.xp)),
      wins,
      losses,
      draws,
      matchesPlayed,
      streak: asNumber(firstValue(stats.current_streak, stats.streak, player.streak)),
      bestStreak: asNumber(firstValue(stats.best_streak, player.best_streak)),
    },
    mastery,
    matches,
    goals,
    achievements,
    recommendation: {
      personalized: Boolean(recommendationSubject),
      subject: titleCase(recommendationSubject, 'Mathematics'),
      difficulty: titleCase(recommendationDifficulty, 'Easy'),
      reason: firstValue(
        recommendation.reason,
        recommendation.description,
        weakest ? `${Math.round(weakest.percent)}% mastery across ${weakest.attempted} answered questions.` : 'Start with a baseline lesson, then Stemegle can recommend the subjects that need the most attention.',
      ),
    },
  };
}

function Brand({ value }) {
  return value || <span className="ph-fallback-brand"><i>St</i> Stemegle</span>;
}

function HubState({ type, brand, onBack, onRetry, message }) {
  const loading = type === 'loading';
  const Icon = loading ? LoaderCircle : CircleAlert;
  return (
    <main className="player-hub ph-state-page">
      <header className="ph-header">
        <Brand value={brand} />
        <button className="ph-icon-button" type="button" onClick={onBack} aria-label="Back to Stemegle">
          <ArrowLeft aria-hidden="true" />
        </button>
      </header>
      <section className="ph-state" aria-live="polite">
        <span className={`ph-state-icon ${loading ? 'is-loading' : ''}`}><Icon aria-hidden="true" /></span>
        <h1>{loading ? 'Building your player hub' : 'Your progress could not load'}</h1>
        <p>{loading ? 'Rating, mastery, and recent matches are on the way.' : message || 'Try opening the hub again in a moment.'}</p>
        {!loading && (
          <div className="ph-state-actions">
            <button className="button" type="button" onClick={onRetry}><RefreshCw /> Try again</button>
            <button className="button button-secondary" type="button" onClick={onBack}><ArrowLeft /> Back to Stemegle</button>
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({ icon: Icon, label, value, note }) {
  return (
    <article className="ph-stat">
      <Icon aria-hidden="true" />
      <p>{label}</p>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}

function EmptyBlock({ icon: Icon, title, children }) {
  return (
    <div className="ph-empty">
      <Icon aria-hidden="true" />
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

export default function PlayerHub({
  brand,
  session,
  data,
  loading = false,
  error = '',
  onBack,
  onPlay,
  onLearn,
  onRetry,
}) {
  if (loading) return <HubState type="loading" brand={brand} onBack={onBack} />;
  if (error) return <HubState type="error" brand={brand} onBack={onBack} onRetry={onRetry} message={error} />;

  const hub = normalizeHub(data, session);
  const winRate = hub.stats.matchesPlayed ? Math.round((hub.stats.wins / hub.stats.matchesPlayed) * 100) : 0;
  const initials = hub.player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const joinedLabel = formatMonthYear(hub.player.joinedAt);

  return (
    <main className="player-hub">
      <header className="ph-header">
        <Brand value={brand} />
        <button className="ph-back-button" type="button" onClick={onBack}><ArrowLeft /> Back to site</button>
      </header>

      <div className="ph-shell">
        <section className="ph-welcome">
          <div className="ph-identity">
            <span className="ph-avatar" aria-hidden="true">{initials || 'S'}</span>
            <div>
              <p className="ph-kicker">PLAYER HUB</p>
              <h1>{hub.player.name}</h1>
              <span>{joinedLabel ? `Competing since ${joinedLabel}` : 'Your STEM progress, all in one place.'}</span>
            </div>
          </div>
          <div className="ph-primary-actions">
            <button className="button button-secondary" type="button" onClick={() => onLearn?.()}><GraduationCap /> Learn</button>
            <button className="button" type="button" onClick={() => onPlay?.()}><Swords /> Play ranked</button>
          </div>
        </section>

        <section className="ph-rating-band" aria-labelledby="ph-rating-title">
          <div className="ph-rating-copy">
            <span className="ph-rating-icon"><ShieldCheck aria-hidden="true" /></span>
            <div>
              <p id="ph-rating-title">Competitive rating</p>
              <strong>{formatNumber(hub.rating.value)}</strong>
              <span>{hub.rating.tier}</span>
            </div>
          </div>
          <div className="ph-rating-status">
            {hub.rating.provisional ? (
              <>
                <span className="ph-status-label"><Sparkles /> Provisional</span>
                <p>{hub.rating.placementGames > 0 ? `${hub.rating.placementGames} placement ${hub.rating.placementGames === 1 ? 'match' : 'matches'} left` : 'Complete placement matches to earn your first division.'}</p>
              </>
            ) : (
              <>
                <span className="ph-status-label is-ranked"><Trophy /> Ranked</span>
                <p>{hub.rating.percentile ? `Performing above ${hub.rating.percentile}% of ranked players.` : 'Your rating changes with every competitive match.'}</p>
              </>
            )}
          </div>
          <button className="ph-band-action" type="button" onClick={() => onPlay?.()} aria-label="Start a ranked match"><ArrowRight /></button>
        </section>

        <section className="ph-stat-grid" aria-label="Player statistics">
          <Stat icon={Zap} label="Total XP" value={formatNumber(hub.stats.xp)} note={`Level ${formatNumber(hub.stats.level)}`} />
          <Stat icon={Medal} label="Global rank" value={hub.stats.globalRank ? `#${formatNumber(hub.stats.globalRank)}` : 'Unranked'} note={hub.stats.globalRank ? 'Across all players' : 'Play to enter the board'} />
          <Stat icon={Trophy} label="Win / loss" value={`${formatNumber(hub.stats.wins)} / ${formatNumber(hub.stats.losses)}`} note={`${winRate}% win rate · ${formatNumber(hub.stats.draws)} draws`} />
          <Stat icon={Flame} label="Current streak" value={formatNumber(hub.stats.streak)} note={`Best: ${formatNumber(hub.stats.bestStreak)}`} />
        </section>

        <div className="ph-main-grid">
          <section className="ph-section ph-mastery" aria-labelledby="ph-mastery-title">
            <div className="ph-section-head">
              <div><p>LEARNING PROFILE</p><h2 id="ph-mastery-title">Category mastery</h2></div>
              <Brain aria-hidden="true" />
            </div>
            {hub.mastery.length ? (
              <div className="ph-mastery-list">
                {hub.mastery.map((row) => (
                  <div className="ph-mastery-row" key={row.key}>
                    <div className="ph-mastery-label"><strong>{row.subject}</strong><span>{row.difficulty}</span></div>
                    <div className="ph-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(row.percent)} aria-label={`${row.subject}, ${row.difficulty} mastery`}>
                      <i className={`is-${row.tone}`} style={{ width: `${row.percent}%` }} />
                    </div>
                    <strong className="ph-mastery-value">{Math.round(row.percent)}%</strong>
                    <small>{row.attempted ? `${row.correct}/${row.attempted} correct` : 'No attempts yet'}</small>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyBlock icon={Brain} title="No mastery profile yet">Finish a learning round to start mapping your strengths.</EmptyBlock>
            )}
          </section>

          <aside className="ph-recommendation" aria-labelledby="ph-rec-title">
            <span><Target aria-hidden="true" /></span>
            <p>{hub.recommendation.personalized ? 'NEXT BEST STEP' : 'BUILD YOUR BASELINE'}</p>
            <h2 id="ph-rec-title">{hub.recommendation.personalized ? `Practice ${hub.recommendation.subject}` : 'Start with Mathematics'}</h2>
            <strong>{hub.recommendation.difficulty} difficulty</strong>
            <div className="ph-rec-reason">{hub.recommendation.reason}</div>
            <button className="button button-wide" type="button" onClick={() => onLearn?.({ subject: hub.recommendation.subject, difficulty: hub.recommendation.difficulty })}>
              <GraduationCap /> Start focused practice
            </button>
          </aside>
        </div>

        <section className="ph-section ph-history" aria-labelledby="ph-history-title">
          <div className="ph-section-head">
            <div><p>COMPETITIVE HISTORY</p><h2 id="ph-history-title">Recent matches</h2></div>
            <Gamepad2 aria-hidden="true" />
          </div>
          {hub.matches.length ? (
            <div className="ph-match-list">
              <div className="ph-match-header" aria-hidden="true"><span>Opponent</span><span>Round</span><span>Score</span><span>Rating</span></div>
              {hub.matches.map((match) => (
                <div className="ph-match-row" key={match.key}>
                  <span className={`ph-outcome is-${match.outcome.toLowerCase()}`}>{match.outcome[0]}</span>
                  <div className="ph-opponent">
                    <span className="ph-opponent-icon">{match.isBot ? <Bot /> : <UserRound />}</span>
                    <div><strong>{match.opponent}</strong><small>{formatDate(match.date)}</small></div>
                  </div>
                  <div className="ph-round"><strong>{match.subject}</strong><small>{match.difficulty}</small></div>
                  <strong className="ph-score">{match.playerScore} - {match.opponentScore}</strong>
                  <strong className={`ph-rating-change ${match.ratingChange > 0 ? 'is-positive' : match.ratingChange < 0 ? 'is-negative' : ''}`}>
                    {match.isBot
                      ? 'Practice'
                      : match.ratingChange === null
                        ? 'Pending'
                        : `${match.ratingChange > 0 ? '+' : ''}${match.ratingChange}`}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock icon={Swords} title="No matches played yet">Your finished bot and player matches will appear here.</EmptyBlock>
          )}
        </section>

        <div className="ph-lower-grid">
          <section className="ph-section" aria-labelledby="ph-goals-title">
            <div className="ph-section-head">
              <div><p>TODAY</p><h2 id="ph-goals-title">Daily goals</h2></div>
              <Target aria-hidden="true" />
            </div>
            {hub.goals.length ? (
              <div className="ph-goal-list">
                {hub.goals.map((goal) => {
                  const progress = clamp((goal.progress / goal.target) * 100);
                  return (
                    <div className={`ph-goal ${goal.complete ? 'is-complete' : ''}`} key={goal.key}>
                      <span>{goal.complete ? <Check /> : <Target />}</span>
                      <div><strong>{goal.title}</strong><small>{goal.detail}</small><i role="progressbar" aria-valuemin="0" aria-valuemax={goal.target} aria-valuenow={Math.min(goal.progress, goal.target)} aria-label={`${goal.title} progress`}><b style={{ width: `${progress}%` }} /></i></div>
                      <em>{Math.min(goal.progress, goal.target)}/{goal.target}</em>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyBlock icon={Target} title="Fresh goals arrive daily">Play or learn today to begin a new progress streak.</EmptyBlock>
            )}
          </section>

          <section className="ph-section" aria-labelledby="ph-achievements-title">
            <div className="ph-section-head">
              <div><p>MILESTONES</p><h2 id="ph-achievements-title">Achievements</h2></div>
              <Award aria-hidden="true" />
            </div>
            {hub.achievements.length ? (
              <div className="ph-achievement-list">
                {hub.achievements.map((achievement) => (
                  <div className={`ph-achievement ${achievement.unlocked ? 'is-unlocked' : ''}`} key={achievement.key}>
                    <span>{achievement.unlocked ? <Award /> : <LockKeyhole />}</span>
                    <div><strong>{achievement.title}</strong><small>{achievement.unlockedAt ? `Earned ${formatDate(achievement.unlockedAt)}` : achievement.detail}</small></div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyBlock icon={Award} title="Your trophy shelf is ready">Win matches and build mastery to unlock achievements.</EmptyBlock>
            )}
          </section>
        </div>

        <section className="ph-finish-band">
          <div><Users aria-hidden="true" /><span><strong>Ready for the next challenge?</strong><small>Improve your rating or work on a weak category.</small></span></div>
          <div><button className="button button-secondary" type="button" onClick={() => onLearn?.()}><Brain /> Learning mode</button><button className="button" type="button" onClick={() => onPlay?.()}><Swords /> Find a rival</button></div>
        </section>
      </div>
    </main>
  );
}
