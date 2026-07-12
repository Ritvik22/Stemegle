import { pool } from './db.mjs';

export async function getAnalyticsDashboard(requestedDays = 30) {
  const days = Math.max(1, Math.min(Number(requestedDays) || 30, 3650));
  const result = await pool.query(`
    with
    params as (
      select date_trunc('day', now()) - make_interval(days => $1::integer - 1) as range_start
    ),
    window_events as (
      select event.* from analytics_events as event, params
      where event.occurred_at >= params.range_start
    ),
    window_sessions as (
      select session.* from analytics_sessions as session, params
      where session.started_at >= params.range_start
    ),
    visitor_journey as (
      select
        event.visitor_id,
        min(event.occurred_at) filter (
          where event.event_name in ('session_started', 'page_view')
        ) as visited_at,
        min(event.occurred_at) filter (
          where event.event_name in ('queue_started', 'party_joined')
        ) as queued_at,
        min(event.occurred_at) filter (where event.event_name = 'game_started') as started_at,
        min(event.occurred_at) filter (where event.event_name = 'game_completed') as completed_at
      from window_events as event
      group by event.visitor_id
    ),
    signup_cohort as (
      select
        users.id as user_id,
        users.created_at,
        attribution.visitor_id,
        attribution.attributed_at,
        coalesce(attribution.acquisition_source, 'Unknown (pre-tracking)') as source
      from app_users as users
      left join analytics_user_attribution as attribution on attribution.user_id = users.id
      cross join params
      where users.created_at >= params.range_start
    ),
    tracked_signup_cohort as (
      select signup.*
      from signup_cohort as signup
      join visitor_journey as journey on journey.visitor_id = signup.visitor_id
      where journey.visited_at is not null
        and journey.visited_at <= coalesce(signup.attributed_at, signup.created_at)
    ),
    event_user_stats as (
      select
        event.user_id,
        count(*) filter (where event.event_name in ('queue_started', 'party_joined')) as queues,
        count(*) filter (where event.event_name = 'game_started') as game_starts,
        count(*) filter (where event.event_name = 'game_completed') as game_completions,
        count(*) filter (where event.event_name = 'game_abandoned') as game_abandonments,
        count(*) filter (
          where event.event_name = 'game_completed' and event.properties ->> 'mode' = 'bot'
        ) as bot_completions,
        count(*) filter (
          where event.event_name = 'game_completed' and event.properties ->> 'mode' = 'human'
        ) as human_completions,
        count(*) filter (
          where event.event_name = 'game_completed'
            and event.properties ->> 'mode' in ('party_team', 'party_tournament')
        ) as party_completions,
        max(event.occurred_at) as last_event_at
      from analytics_events as event
      where event.user_id is not null
      group by event.user_id
    ),
    session_user_stats as (
      select
        session.user_id,
        count(*) as sessions,
        sum(session.pageview_count) as pageviews
      from analytics_sessions as session
      where session.user_id is not null
      group by session.user_id
    ),
    auth_user_stats as (
      select user_id, max(created_at) as last_sign_in_at
      from auth_sessions
      group by user_id
    ),
    first_touch as (
      select
        attribution.user_id,
        visitor.first_seen_at,
        coalesce(visitor.first_landing_path, attribution.landing_path) as first_landing_path,
        attribution.referrer_url as first_referrer_url,
        attribution.referrer_host as first_referrer_host,
        attribution.acquisition_source as first_source,
        attribution.acquisition_medium as first_medium,
        attribution.acquisition_campaign as first_campaign,
        attribution.country_code as first_country_code,
        attribution.region as first_region,
        attribution.city as first_city,
        attribution.timezone as first_timezone,
        attribution.device_type as first_device_type,
        attribution.browser as first_browser,
        attribution.operating_system as first_os
      from analytics_user_attribution as attribution
      join analytics_visitors as visitor on visitor.visitor_id = attribution.visitor_id
    ),
    latest_touch as (
      select distinct on (event.user_id)
        event.user_id,
        event.occurred_at as last_seen_at,
        event.path as last_path,
        event.event_name as last_event
      from analytics_events as event
      where event.user_id is not null
      order by event.user_id, event.occurred_at desc
    ),
    user_rows as (
      select
        users.id as user_id,
        case
          when right(users.email, 21) = '@players.stemegle.com' then users.contact_email
          else coalesce(users.contact_email, users.email)
        end as email,
        users.contact_email,
        users.name as battle_name,
        users.created_at,
        case when users.email_verified then users.created_at else null end as email_confirmed_at,
        auth_user_stats.last_sign_in_at,
        first_touch.first_seen_at,
        latest_touch.last_seen_at,
        coalesce(first_touch.first_source, 'Unknown (pre-tracking)') as referral_source,
        first_touch.first_referrer_url as referrer_url,
        first_touch.first_referrer_host as referrer_host,
        first_touch.first_medium as referral_medium,
        first_touch.first_campaign as campaign,
        first_touch.first_landing_path as landing_path,
        first_touch.first_country_code as country_code,
        first_touch.first_region as region,
        first_touch.first_city as city,
        first_touch.first_timezone as timezone,
        first_touch.first_device_type as device_type,
        first_touch.first_browser as browser,
        first_touch.first_os as operating_system,
        latest_touch.last_path,
        latest_touch.last_event,
        coalesce(session_user_stats.pageviews, 0) as pageviews,
        coalesce(session_user_stats.sessions, 0) as sessions,
        coalesce(event_user_stats.queues, 0) as queues,
        coalesce(event_user_stats.game_starts, 0) as game_starts,
        coalesce(event_user_stats.game_completions, 0) as game_completions,
        coalesce(event_user_stats.game_abandonments, 0) as game_abandonments,
        coalesce(event_user_stats.bot_completions, 0) as bot_completions,
        coalesce(event_user_stats.human_completions, 0) as human_completions,
        coalesce(event_user_stats.party_completions, 0) as party_completions,
        coalesce(profile.total_score, 0) as total_score,
        coalesce(profile.wins, 0) as wins,
        coalesce(profile.losses, 0) as losses,
        coalesce(profile.matches_played, 0) as ranked_matches,
        case
          when coalesce(event_user_stats.game_completions, 0) > 0 then 'completed'
          when coalesce(event_user_stats.game_abandonments, 0) > 0 then 'abandoned'
          when coalesce(event_user_stats.game_starts, 0) > 0 then 'started'
          when coalesce(event_user_stats.queues, 0) > 0 then 'queued'
          else 'signed_up'
        end as highest_stage
      from app_users as users
      left join player_profiles as profile on profile.user_id = users.id
      left join first_touch on first_touch.user_id = users.id
      left join latest_touch on latest_touch.user_id = users.id
      left join session_user_stats on session_user_stats.user_id = users.id
      left join event_user_stats on event_user_stats.user_id = users.id
      left join auth_user_stats on auth_user_stats.user_id = users.id
      order by users.created_at desc
      limit 2000
    )
    select jsonb_build_object(
      'generated_at', now(),
      'range_days', $1::integer,
      'overview', jsonb_build_object(
        'pageviews', (select count(*) from window_events where event_name = 'page_view'),
        'visitors', (select count(distinct visitor_id) from window_events),
        'sessions', (select count(*) from window_sessions),
        'signups', (select count(*) from signup_cohort),
        'total_users', (select count(*) from app_users),
        'unconverted_visitors', (
          select count(*) from analytics_visitors as visitor, params
          where visitor.first_seen_at >= params.range_start
            and not exists (
              select 1 from analytics_user_attribution as attribution
              where attribution.visitor_id = visitor.visitor_id
            )
        ),
        'active_visitors', (
          select count(distinct visitor_id) from analytics_events
          where occurred_at >= now() - interval '5 minutes'
        ),
        'game_starts', (
          select count(distinct coalesce(properties ->> 'game_id', event_id::text))
          from window_events where event_name = 'game_started'
        ),
        'game_completions', (
          select count(distinct coalesce(properties ->> 'game_id', event_id::text))
          from window_events where event_name = 'game_completed'
        ),
        'game_abandonments', (
          select count(distinct coalesce(properties ->> 'game_id', event_id::text))
          from window_events where event_name = 'game_abandoned'
        )
      ),
      'funnel', jsonb_build_object(
        'visited', (
          select count(*) from visitor_journey where visited_at is not null
        ),
        'signed_up', (select count(*) from tracked_signup_cohort),
        'queued', (
          select count(*) from visitor_journey
          where visited_at is not null and queued_at >= visited_at
        ),
        'started', (
          select count(*) from visitor_journey
          where visited_at is not null and queued_at >= visited_at and started_at >= queued_at
        ),
        'completed', (
          select count(*) from visitor_journey
          where visited_at is not null and queued_at >= visited_at
            and started_at >= queued_at and completed_at >= started_at
        )
      ),
      'timeseries', coalesce((
        select jsonb_agg(to_jsonb(series_row) order by series_row.day)
        from (
          select
            day_series.day::date as day,
            count(event.id) filter (where event.event_name = 'page_view') as pageviews,
            count(distinct event.visitor_id) as visitors,
            count(event.id) filter (where event.event_name = 'game_started') as game_starts,
            count(event.id) filter (where event.event_name = 'game_completed') as game_completions
          from params,
          generate_series(
            date_trunc('day', params.range_start),
            date_trunc('day', now()),
            interval '1 day'
          ) as day_series(day)
          left join analytics_events as event
            on event.occurred_at >= day_series.day
            and event.occurred_at < day_series.day + interval '1 day'
          group by day_series.day
        ) as series_row
      ), '[]'::jsonb),
      'sources', coalesce((
        select jsonb_agg(to_jsonb(source_row) order by source_row.visitors desc, source_row.source)
        from (
          select
            source_parts.source,
            sum(source_parts.visitors) as visitors,
            sum(source_parts.signups) as signups,
            sum(source_parts.game_players) as game_players,
            sum(source_parts.completers) as completers
          from (
            select
              session.acquisition_source as source,
              count(distinct session.visitor_id) as visitors,
              0::bigint as signups,
              count(distinct event.visitor_id) filter (where event.event_name = 'game_started') as game_players,
              count(distinct event.visitor_id) filter (where event.event_name = 'game_completed') as completers
            from window_sessions as session
            left join window_events as event on event.session_id = session.session_id
            group by session.acquisition_source
            union all
            select signup.source, 0::bigint, count(*)::bigint, 0::bigint, 0::bigint
            from tracked_signup_cohort as signup
            group by signup.source
          ) as source_parts
          group by source_parts.source
          order by visitors desc
          limit 12
        ) as source_row
      ), '[]'::jsonb),
      'top_pages', coalesce((
        select jsonb_agg(to_jsonb(page_row) order by page_row.views desc, page_row.path)
        from (
          select event.path, count(*) as views, count(distinct event.visitor_id) as visitors
          from window_events as event
          where event.event_name = 'page_view'
          group by event.path
          order by views desc
          limit 12
        ) as page_row
      ), '[]'::jsonb),
      'devices', coalesce((
        select jsonb_agg(to_jsonb(device_row) order by device_row.visitors desc, device_row.label)
        from (
          select coalesce(device_type, 'Unknown') as label, count(distinct visitor_id) as visitors
          from window_sessions group by coalesce(device_type, 'Unknown')
        ) as device_row
      ), '[]'::jsonb),
      'browsers', coalesce((
        select jsonb_agg(to_jsonb(browser_row) order by browser_row.visitors desc, browser_row.label)
        from (
          select coalesce(browser, 'Unknown') as label, count(distinct visitor_id) as visitors
          from window_sessions group by coalesce(browser, 'Unknown')
          order by visitors desc limit 8
        ) as browser_row
      ), '[]'::jsonb),
      'operating_systems', coalesce((
        select jsonb_agg(to_jsonb(os_row) order by os_row.visitors desc, os_row.label)
        from (
          select coalesce(operating_system, 'Unknown') as label, count(distinct visitor_id) as visitors
          from window_sessions group by coalesce(operating_system, 'Unknown')
          order by visitors desc limit 8
        ) as os_row
      ), '[]'::jsonb),
      'countries', coalesce((
        select jsonb_agg(to_jsonb(country_row) order by country_row.visitors desc, country_row.label)
        from (
          select coalesce(country_code, 'Unknown') as label, count(distinct visitor_id) as visitors
          from window_sessions group by coalesce(country_code, 'Unknown')
          order by visitors desc limit 12
        ) as country_row
      ), '[]'::jsonb),
      'game_modes', coalesce((
        select jsonb_agg(to_jsonb(mode_row) order by mode_row.completions desc, mode_row.mode)
        from (
          select
            coalesce(event.properties ->> 'mode', 'unknown') as mode,
            count(distinct coalesce(event.properties ->> 'game_id', event.event_id::text))
              filter (where event.event_name = 'game_started') as starts,
            count(distinct coalesce(event.properties ->> 'game_id', event.event_id::text))
              filter (where event.event_name = 'game_completed') as completions,
            count(distinct coalesce(event.properties ->> 'game_id', event.event_id::text))
              filter (where event.event_name = 'game_abandoned') as abandonments
          from window_events as event
          where event.event_name in ('game_started', 'game_completed', 'game_abandoned')
          group by coalesce(event.properties ->> 'mode', 'unknown')
        ) as mode_row
      ), '[]'::jsonb),
      'users_total', (select count(*) from app_users),
      'users_limited', (select count(*) > 2000 from app_users),
      'users', coalesce((
        select jsonb_agg(to_jsonb(user_row) order by user_row.created_at desc)
        from user_rows as user_row
      ), '[]'::jsonb)
    ) as payload
  `, [days]);
  return result.rows[0].payload;
}
