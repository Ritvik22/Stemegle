import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Gamepad2,
  Globe2,
  Laptop,
  LogIn,
  LogOut,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import { fetchAdminAccess, fetchAdminDashboard } from './lib/api';

const RANGE_OPTIONS = [7, 30, 90, 365];
const STAGE_OPTIONS = [
  ['all', 'All users'],
  ['signed_up', 'Signed up only'],
  ['queued', 'Queued'],
  ['started', 'Started'],
  ['abandoned', 'Abandoned'],
  ['completed', 'Completed'],
];

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en', includeTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function percent(numerator, denominator) {
  if (!Number(denominator)) return '0%';
  return `${Math.round((Number(numerator) / Number(denominator)) * 100)}%`;
}

function friendlyMode(mode) {
  return ({ human: 'Human rival', bot: 'Bot practice', party_team: 'Party team', party_tournament: 'Party tournament' })[mode] || 'Unknown';
}

function stageLabel(user) {
  if (user.highest_stage === 'completed') {
    const modes = [
      Number(user.human_completions) > 0 && 'Human',
      Number(user.bot_completions) > 0 && 'Bot',
      Number(user.party_completions) > 0 && 'Party',
    ].filter(Boolean);
    return `Completed${modes.length ? ` - ${modes.join(' + ')}` : ''}`;
  }
  if (user.highest_stage === 'abandoned') return 'Started, then left';
  if (user.highest_stage === 'started') return 'Game in progress';
  if (user.highest_stage === 'queued') return 'Reached matchmaking';
  return 'Signed up only';
}

function TrendChart({ rows }) {
  const width = 860;
  const height = 270;
  const inset = { left: 34, right: 18, top: 24, bottom: 42 };
  const maxValue = Math.max(1, ...rows.flatMap((row) => [Number(row.pageviews), Number(row.visitors)]));
  const x = (index) => inset.left + (index / Math.max(1, rows.length - 1)) * (width - inset.left - inset.right);
  const y = (value) => inset.top + (1 - Number(value) / maxValue) * (height - inset.top - inset.bottom);
  const points = (key) => rows.map((row, index) => `${x(index)},${y(row[key])}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));

  return (
    <div className="analytics-chart-wrap">
      <div className="analytics-chart-legend" aria-hidden="true">
        <span><i className="chart-key pageviews" /> Page views</span>
        <span><i className="chart-key visitors" /> Visitors</span>
      </div>
      <svg className="analytics-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily page views and distinct visitors">
        {[0, 0.25, 0.5, 0.75, 1].map((part) => {
          const gridY = inset.top + part * (height - inset.top - inset.bottom);
          return <line key={part} x1={inset.left} x2={width - inset.right} y1={gridY} y2={gridY} className="chart-grid" />;
        })}
        {rows.length > 0 && (
          <polygon
            className="chart-area"
            points={`${inset.left},${height - inset.bottom} ${points('pageviews')} ${width - inset.right},${height - inset.bottom}`}
          />
        )}
        <polyline className="chart-line pageviews" points={points('pageviews')} />
        <polyline className="chart-line visitors" points={points('visitors')} />
        {rows.map((row, index) => index % labelEvery === 0 || index === rows.length - 1 ? (
          <text key={row.day} x={x(index)} y={height - 15} textAnchor="middle" className="chart-label">
            {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(`${row.day}T00:00:00`))}
          </text>
        ) : null)}
      </svg>
    </div>
  );
}

function RankedBars({ rows, valueKey = 'visitors', empty = 'No data in this range.' }) {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey])));
  if (!rows.length) return <p className="analytics-empty">{empty}</p>;
  return (
    <div className="ranked-bars">
      {rows.map((row) => (
        <div className="ranked-bar" key={`${row.label || row.source || row.mode}-${row[valueKey]}`}>
          <div><strong>{row.label || row.source || friendlyMode(row.mode)}</strong><span>{formatNumber(row[valueKey])}</span></div>
          <i><b style={{ width: `${Math.max(3, (Number(row[valueKey]) / max) * 100)}%` }} /></i>
        </div>
      ))}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone }) {
  return (
    <article className={`analytics-metric ${tone || ''}`}>
      <span className="metric-icon"><Icon aria-hidden="true" /></span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AccessGate({ brand, session, denied, error, onBack, onLogin, onLogout }) {
  const title = error ? 'Analytics setup required' : denied ? 'Admin access required' : 'Sign in to view analytics';
  return (
    <main className="analytics-gate">
      <div className="analytics-gate-head">{brand}<button className="admin-icon-button" onClick={onBack} aria-label="Back to Stemegle"><ArrowLeft /></button></div>
      <section>
        <span><ShieldCheck /></span>
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1>{title}</h1>
        <p>{error || (denied
          ? 'This account is signed in, but it is not on the analytics admin list.'
          : 'The dashboard contains private account, referral, and journey data.')}</p>
        <div className="analytics-gate-actions">
          {!session && <button className="button" onClick={onLogin}><LogIn /> Admin login</button>}
          {session && <button className="button" onClick={onLogout}><LogOut /> Sign out</button>}
          <button className="button button-secondary" onClick={onBack}>Back to site</button>
        </div>
      </section>
    </main>
  );
}

function demoData(days) {
  const rows = Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - index - 1));
    const wave = Math.sin(index / 2.8) * 17;
    const pageviews = Math.max(6, Math.round(74 + index * 1.7 + wave));
    return {
      day: date.toISOString().slice(0, 10),
      pageviews,
      visitors: Math.round(pageviews * (0.56 + (index % 3) * 0.03)),
      game_starts: Math.round(pageviews * 0.23),
      game_completions: Math.round(pageviews * 0.16),
    };
  });
  const pageviews = rows.reduce((sum, row) => sum + row.pageviews, 0);
  const visitors = Math.round(pageviews * 0.41);
  const now = new Date();
  const users = [
    ['Maya Chen', 'maya@example.com', 'Google', 'https://www.google.com/search/how-to-learn-physics', 'US', 'New York', 'Mobile', 'Safari', 'iOS', 'completed', 3, 2, 1, 0],
    ['ProtonPilot', 'pilot@example.com', 'Reddit', 'https://www.reddit.com/r/learnmath/', 'CA', 'Toronto', 'Desktop', 'Chrome', 'Windows', 'abandoned', 1, 0, 0, 0],
    ['OrbitKid', 'orbit@example.com', 'Direct', '', 'GB', 'London', 'Desktop', 'Firefox', 'Linux', 'signed_up', 0, 0, 0, 0],
    ['TuringFan', 'turing@example.com', 'YouTube', 'https://www.youtube.com/watch/stem-games', 'US', 'Austin', 'Tablet', 'Safari', 'iOS', 'completed', 6, 5, 2, 2],
    ['NovaByte', 'nova@example.com', 'Discord', 'https://discord.com/channels/stem-club', 'AE', 'Dubai', 'Mobile', 'Chrome', 'Android', 'started', 2, 0, 0, 0],
  ].map((entry, index) => ({
    user_id: `demo-${index}`,
    battle_name: entry[0], email: entry[1], referral_source: entry[2], referrer_url: entry[3],
    country_code: entry[4], city: entry[5], region: '', device_type: entry[6], browser: entry[7], operating_system: entry[8],
    highest_stage: entry[9], game_starts: entry[10], game_completions: entry[11], bot_completions: entry[12], human_completions: entry[13], party_completions: index === 3 ? 1 : 0,
    game_abandonments: entry[9] === 'abandoned' ? 1 : 0, queues: Math.max(entry[10], entry[9] === 'signed_up' ? 0 : 1),
    pageviews: 4 + index * 3, sessions: 1 + index, total_score: index * 2840, wins: index + 1, losses: index,
    campaign: entry[2] === 'Google' ? 'summer-stem' : null, landing_path: '/', last_path: entry[9] === 'signed_up' ? '/' : '/game',
    last_event: entry[9] === 'completed' ? 'game_completed' : entry[9] === 'abandoned' ? 'game_abandoned' : 'page_view',
    created_at: new Date(now - (index + 1) * 86400000 * 3).toISOString(),
    last_sign_in_at: new Date(now - index * 86400000).toISOString(),
    first_seen_at: new Date(now - (index + 1) * 86400000 * 3).toISOString(),
    last_seen_at: new Date(now - index * 3600000 * 4).toISOString(),
  }));
  return {
    generated_at: now.toISOString(), range_days: days,
    overview: { pageviews, visitors, sessions: Math.round(visitors * 1.24), signups: Math.round(visitors * 0.18), total_users: 440, unconverted_visitors: Math.round(visitors * 0.72), active_visitors: 8, game_starts: Math.round(visitors * 0.26), game_completions: Math.round(visitors * 0.18), game_abandonments: Math.round(visitors * 0.05) },
    funnel: { visited: visitors, signed_up: Math.round(visitors * 0.18), queued: Math.round(visitors * 0.31), started: Math.round(visitors * 0.26), completed: Math.round(visitors * 0.18) },
    timeseries: rows,
    sources: [
      { source: 'Google', visitors: 604, signups: 132, game_players: 209, completers: 151 },
      { source: 'Direct', visitors: 418, signups: 78, game_players: 143, completers: 96 },
      { source: 'Reddit', visitors: 287, signups: 71, game_players: 116, completers: 89 },
      { source: 'YouTube', visitors: 194, signups: 49, game_players: 85, completers: 64 },
      { source: 'Discord', visitors: 128, signups: 40, game_players: 62, completers: 47 },
    ],
    top_pages: [
      { path: '/', views: 2125, visitors: 1480 }, { path: '/matchmaking', views: 983, visitors: 691 },
      { path: '/game', views: 744, visitors: 508 }, { path: '/results', views: 529, visitors: 391 }, { path: '/party', views: 302, visitors: 217 },
    ],
    devices: [{ label: 'Desktop', visitors: 980 }, { label: 'Mobile', visitors: 721 }, { label: 'Tablet', visitors: 76 }],
    browsers: [{ label: 'Chrome', visitors: 1012 }, { label: 'Safari', visitors: 544 }, { label: 'Firefox', visitors: 139 }, { label: 'Edge', visitors: 82 }],
    operating_systems: [{ label: 'Windows', visitors: 688 }, { label: 'iOS', visitors: 471 }, { label: 'macOS', visitors: 329 }, { label: 'Android', visitors: 225 }, { label: 'Linux', visitors: 64 }],
    countries: [{ label: 'US', visitors: 1261 }, { label: 'CA', visitors: 149 }, { label: 'GB', visitors: 112 }, { label: 'AE', visitors: 89 }, { label: 'IN', visitors: 75 }],
    game_modes: [{ mode: 'human', starts: 492, completions: 344, abandonments: 59 }, { mode: 'bot', starts: 263, completions: 221, abandonments: 25 }, { mode: 'party_team', starts: 107, completions: 82, abandonments: 16 }, { mode: 'party_tournament', starts: 64, completions: 43, abandonments: 11 }],
    users_total: 440, users_limited: false, users,
  };
}

export default function AdminDashboard({ brand, session, authPending = false, onBack, onLogin, onLogout }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [expandedUser, setExpandedUser] = useState(null);
  const demo = import.meta.env.DEV && new URLSearchParams(window.location.search).get('analytics-demo') === '1';

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      setDenied(false);
      if (demo) {
        setData(demoData(days));
        setLoading(false);
        return;
      }
      if (authPending) {
        setData(null);
        return;
      }
      if (!session) {
        setData(null);
        setLoading(false);
        return;
      }
      try {
        const allowed = await fetchAdminAccess();
        if (!active) return;
        if (!allowed) {
          setDenied(true);
          setData(null);
          return;
        }
        const dashboard = await fetchAdminDashboard(days);
        if (!active) return;
        setData(dashboard);
      } catch (loadError) {
        if (!active) return;
        setData(null);
        if (loadError?.status === 403) {
          setDenied(true);
        } else if (loadError?.status === 401) {
          setError('Your session expired. Sign out, then log in again to reopen analytics.');
        } else {
          setError('Analytics could not be loaded. Check the application backend and database, then refresh.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [authPending, days, demo, refreshKey, session?.user?.id]);

  const users = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.users || []).filter((user) => {
      if (stage !== 'all' && user.highest_stage !== stage) return false;
      if (!normalized) return true;
      return [user.battle_name, user.email, user.referral_source, user.country_code, user.region, user.city]
        .some((value) => String(value || '').toLowerCase().includes(normalized));
    });
  }, [data?.users, query, stage]);

  if (!demo && !authPending && (!session || denied || error)) {
    return <AccessGate brand={brand} session={session} denied={denied} error={error} onBack={onBack} onLogin={onLogin} onLogout={onLogout} />;
  }

  if (loading || !data) {
    return (
      <main className="analytics-loading">
        {brand}
        <span><RefreshCw /></span>
        <p>Building your analytics view...</p>
      </main>
    );
  }

  const overview = data.overview || {};
  const funnel = data.funnel || {};
  const completionRate = percent(overview.game_completions, overview.game_starts);
  const conversionRate = percent(funnel.signed_up, funnel.visited);
  const unattributedSignups = Math.max(0, Number(overview.signups || 0) - Number(funnel.signed_up || 0));
  const pagePerSession = Number(overview.sessions) ? (Number(overview.pageviews) / Number(overview.sessions)).toFixed(1) : '0.0';
  const funnelSteps = [
    ['Visited', funnel.visited, MousePointerClick],
    ['Entered play', funnel.queued, Clock3],
    ['Started', funnel.started, Gamepad2],
    ['Completed', funnel.completed, CheckCircle2],
  ];

  return (
    <main className="analytics-shell">
      <header className="analytics-header">
        <div className="analytics-header-inner">
          <div className="analytics-brand">{brand}<span><i /> Analytics</span></div>
          <div className="analytics-header-actions">
            <div className="analytics-range" role="group" aria-label="Analytics date range">
              {RANGE_OPTIONS.map((range) => <button className={days === range ? 'active' : ''} aria-pressed={days === range} key={range} onClick={() => setDays(range)}>{range === 365 ? '1y' : `${range}d`}</button>)}
            </div>
            <button className="admin-icon-button" onClick={() => setRefreshKey((key) => key + 1)} aria-label="Refresh analytics" title="Refresh"><RefreshCw /></button>
            <button className="admin-icon-button" onClick={onBack} aria-label="Back to Stemegle" title="Back to site"><ArrowLeft /></button>
            {!demo && <button className="admin-icon-button" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut /></button>}
          </div>
        </div>
      </header>

      <div className="analytics-content">
        <section className="analytics-titlebar">
          <div><p className="eyebrow">PRODUCT PULSE</p><h1>What brings players in, and how far do they get?</h1><p>First-party traffic, signup, and gameplay journeys for the last {data.range_days} days.</p></div>
          <span><CalendarDays /> Updated {formatDate(data.generated_at, true)}</span>
        </section>

        <section className="analytics-metrics" aria-label="Analytics overview">
          <MetricCard icon={MousePointerClick} label="Page views" value={formatNumber(overview.pageviews)} detail={`${pagePerSession} views per session`} tone="lime" />
          <MetricCard icon={Users} label="Distinct visitors" value={formatNumber(overview.visitors)} detail={`${formatNumber(overview.active_visitors)} active in the last 5 minutes`} tone="cyan" />
          <MetricCard icon={UserPlus} label="New signups" value={formatNumber(overview.signups)} detail={`${conversionRate} tracked visitor conversion${unattributedSignups ? ` / ${formatNumber(unattributedSignups)} unattributed` : ''}`} tone="violet" />
          <MetricCard icon={CheckCircle2} label="Games completed" value={formatNumber(overview.game_completions)} detail={`${completionRate} of started games`} tone="coral" />
        </section>

        <section className="analytics-main-grid">
          <article className="analytics-panel trend-panel">
            <div className="analytics-panel-head"><div><p className="eyebrow">TRAFFIC TREND</p><h2>Views and visitors</h2></div><span><Activity /> {formatNumber(overview.sessions)} sessions</span></div>
            <TrendChart rows={data.timeseries || []} />
          </article>
          <article className="analytics-panel funnel-panel">
            <div className="analytics-panel-head"><div><p className="eyebrow">JOURNEY</p><h2>Visitor funnel</h2></div><span>{completionRate} finish rate</span></div>
            <div className="analytics-funnel">
              {funnelSteps.map(([label, value, Icon], index) => (
                <div key={label}>
                  <span><Icon /> {label}</span><strong>{formatNumber(value)}</strong>
                  <i><b style={{ width: `${Math.max(3, (Number(value) / Math.max(1, Number(funnel.visited))) * 100)}%` }} /></i>
                  {index > 0 && <small>{percent(value, funnelSteps[index - 1][1])} from prior step</small>}
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="analytics-band-grid acquisition-grid">
          <article className="analytics-panel">
            <div className="analytics-panel-head"><div><p className="eyebrow">ACQUISITION</p><h2>Where players come from</h2></div><Globe2 /></div>
            <div className="source-table" role="table" aria-label="Acquisition source performance">
              <div className="source-table-head" role="row"><span role="columnheader">Source</span><span role="columnheader">Visitors</span><span role="columnheader">Signups</span><span role="columnheader">Completed</span></div>
              {(data.sources || []).map((source) => (
                <div className="source-table-row" role="row" key={source.source}>
                  <strong role="cell">{source.source}</strong><span role="cell">{formatNumber(source.visitors)}</span><span role="cell">{formatNumber(source.signups)} <small>{percent(source.signups, source.visitors)}</small></span><span role="cell">{formatNumber(source.completers)} <small>{percent(source.completers, source.visitors)}</small></span>
                </div>
              ))}
              {!(data.sources || []).length && <p className="analytics-empty">Referral data starts collecting after this release.</p>}
            </div>
          </article>
          <article className="analytics-panel">
            <div className="analytics-panel-head"><div><p className="eyebrow">GAMEPLAY</p><h2>Starts, finishes, and exits</h2></div><Gamepad2 /></div>
            <div className="mode-list">
              {(data.game_modes || []).map((mode) => (
                <div key={mode.mode}><span className="mode-icon">{mode.mode === 'bot' ? <Bot /> : mode.mode.startsWith('party') ? <Users /> : <Zap />}</span><div><strong>{friendlyMode(mode.mode)}</strong><small>{formatNumber(mode.starts)} starts</small></div><b>{formatNumber(mode.completions)}<small> finished</small></b><em>{formatNumber(mode.abandonments)} left</em></div>
              ))}
              {!(data.game_modes || []).length && <p className="analytics-empty">No games were started in this range.</p>}
            </div>
          </article>
        </section>

        <section className="analytics-breakdown-grid">
          <article className="analytics-panel"><div className="analytics-panel-head"><div><p className="eyebrow">TOP SCREENS</p><h2>What visitors open</h2></div><BarChart3 /></div><div className="top-pages">{(data.top_pages || []).map((page) => <div key={page.path}><strong>{page.path}</strong><span>{formatNumber(page.views)} views</span><small>{formatNumber(page.visitors)} visitors</small></div>)}</div></article>
          <article className="analytics-panel"><div className="analytics-panel-head"><div><p className="eyebrow">DEVICES</p><h2>How they play</h2></div><Laptop /></div><RankedBars rows={data.devices || []} /></article>
          <article className="analytics-panel"><div className="analytics-panel-head"><div><p className="eyebrow">BROWSERS</p><h2>Browser families</h2></div><Smartphone /></div><RankedBars rows={data.browsers || []} /></article>
          <article className="analytics-panel"><div className="analytics-panel-head"><div><p className="eyebrow">GEOGRAPHY</p><h2>Country hints</h2></div><MapPin /></div><RankedBars rows={data.countries || []} /></article>
        </section>

        <section className="analytics-users-section">
          <div className="analytics-users-head">
            <div><p className="eyebrow">SIGNED-UP PLAYERS</p><h2>Every account and its journey</h2><p>{formatNumber(data.users_total)} total accounts. Historical accounts show unknown attribution until they return.</p></div>
            <div className="user-filters">
              <label><Search /><span className="sr-only">Search users</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, source, place" /></label>
              <label className="stage-select"><span className="sr-only">Filter by journey stage</span><select value={stage} onChange={(event) => setStage(event.target.value)}>{STAGE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown /></label>
            </div>
          </div>

          <div className="analytics-user-table-wrap">
            <table className="analytics-user-table">
              <thead><tr><th>Player</th><th>Joined</th><th>First touch</th><th>Location</th><th>Device</th><th>Journey</th><th>Activity</th><th><span className="sr-only">Details</span></th></tr></thead>
              <tbody>
                {users.map((user) => {
                  const expanded = expandedUser === user.user_id;
                  const location = [user.city, user.region, user.country_code].filter(Boolean).join(', ') || 'Unknown';
                  const device = [user.device_type, user.browser].filter(Boolean).join(' / ') || 'Unknown';
                  return (
                    <Fragment key={user.user_id}>
                      <tr>
                        <td><span className="user-avatar">{(user.battle_name || user.email || '?')[0].toUpperCase()}</span><span className="user-identity"><strong>{user.battle_name || 'Unnamed player'}</strong><small>{user.email}</small></span></td>
                        <td><strong>{formatDate(user.created_at)}</strong><small>Account active</small></td>
                        <td><span className="source-wrap"><button type="button" className="source-pill" title={user.referrer_url || 'No external referrer recorded'} aria-describedby={`referrer-${user.user_id}`} onClick={() => setExpandedUser(expanded ? null : user.user_id)}>{user.referral_source || 'Unknown'}</button><span className="referrer-tooltip" role="tooltip" id={`referrer-${user.user_id}`}>{user.referrer_url || 'No external referrer recorded'}</span></span><small>{user.campaign ? `Campaign: ${user.campaign}` : user.landing_path || 'Landing unknown'}</small></td>
                        <td><strong>{location}</strong><small>{user.timezone || 'Timezone unknown'}</small></td>
                        <td><strong>{device}</strong><small>{user.operating_system || 'OS unknown'}</small></td>
                        <td><span className={`journey-stage ${user.highest_stage}`}>{user.highest_stage === 'completed' ? <CheckCircle2 /> : user.highest_stage === 'abandoned' ? <XCircle /> : <Activity />}{stageLabel(user)}</span><small>{formatNumber(user.game_starts)} starts / {formatNumber(user.game_completions)} finishes</small></td>
                        <td><strong>{formatDate(user.last_seen_at || user.last_sign_in_at, true)}</strong><small>{formatNumber(user.pageviews)} views / {formatNumber(user.sessions)} sessions</small></td>
                        <td><button className="row-expand" onClick={() => setExpandedUser(expanded ? null : user.user_id)} aria-label={`${expanded ? 'Hide' : 'Show'} details for ${user.battle_name || user.email}`} aria-expanded={expanded}><ChevronDown /></button></td>
                      </tr>
                      {expanded && (
                        <tr className="user-detail-row"><td colSpan="8"><div className="user-detail-grid">
                          <div><span>First-touch referral</span><strong>{user.referrer_url || 'Direct or unavailable'}</strong>{user.referrer_url && <a href={user.referrer_url} target="_blank" rel="noreferrer">Open sanitized referrer <ExternalLink /></a>}</div>
                          <div><span>Acquisition</span><strong>{user.referral_source || 'Unknown'}{user.referral_medium ? ` / ${user.referral_medium}` : ''}</strong><small>{user.campaign ? `Campaign ${user.campaign}` : 'No campaign tagged'}</small></div>
                          <div><span>First device</span><strong>{[user.device_type, user.browser, user.operating_system].filter(Boolean).join(' / ') || 'Unknown'}</strong><small>{[user.city, user.region, user.country_code, user.timezone].filter(Boolean).join(', ') || 'Location unavailable'}</small></div>
                          <div><span>Gameplay</span><strong>{formatNumber(user.game_completions)} completed, {formatNumber(user.game_abandonments)} left</strong><small>{formatNumber(user.human_completions)} human / {formatNumber(user.bot_completions)} bot / {formatNumber(user.party_completions)} party</small></div>
                          <div><span>Ranked record</span><strong>{formatNumber(user.total_score)} score</strong><small>{formatNumber(user.wins)} wins / {formatNumber(user.losses)} losses / {formatNumber(user.ranked_matches)} ranked</small></div>
                          <div><span>Account activity</span><strong>Last sign-in {formatDate(user.last_sign_in_at, true)}</strong><small>First seen {formatDate(user.first_seen_at, true)} / last screen {user.last_path || 'Unknown'}</small></div>
                        </div></td></tr>
                      )}
                    </Fragment>
                  );
                })}
                {!users.length && <tr><td colSpan="8"><p className="analytics-empty">No accounts match these filters.</p></td></tr>}
              </tbody>
            </table>
          </div>
          <div className="analytics-table-foot"><span>Showing {formatNumber(users.length)} of {formatNumber(data.users_total)} accounts</span>{data.users_limited && <span>For performance, the newest 2,000 accounts are loaded.</span>}</div>
        </section>
      </div>
    </main>
  );
}
