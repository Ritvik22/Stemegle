import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) throw new Error('Missing Supabase public environment variables.');

const playerId = `smoke-${crypto.randomUUID()}`;
const name = 'RealtimeRobot';
const supabase = createClient(url, key, { auth: { persistSession: false } });
let lobby;
let match;
let paired = false;

function players(channel) {
  return Object.values(channel.presenceState()).flat().filter((presence) => presence?.playerId);
}

async function cleanup(code = 0) {
  if (lobby) await supabase.removeChannel(lobby);
  if (match) await supabase.removeChannel(match);
  await supabase.removeAllChannels();
  process.exit(code);
}

function joinMatch(pair) {
  if (paired) return;
  paired = true;
  const ordered = [...pair].sort((a, b) => a.playerId.localeCompare(b.playerId));
  const opponent = ordered.find((candidate) => candidate.playerId !== playerId);
  const matchId = ordered.map((candidate) => candidate.playerId).join('--');

  match = supabase.channel(`stemegle:match:${matchId}`, {
    config: { presence: { key: playerId }, broadcast: { self: true, ack: true } },
  });

  match
    .on('broadcast', { event: 'start' }, async () => {
      console.log(`MATCHED:${opponent.name}`);
      await lobby.untrack();
      await supabase.removeChannel(lobby);
      setTimeout(async () => {
        await match.send({
          type: 'broadcast',
          event: 'score',
          payload: { playerId, score: 777, questionIndex: 0 },
        });
        console.log('SCORE_SENT:777');
        setTimeout(async () => {
          await match.send({
            type: 'broadcast',
            event: 'finish',
            payload: { playerId, score: 777 },
          });
          console.log('FINISH_SENT:777');
        }, 1000);
      }, 2500);
    })
    .on('broadcast', { event: 'score' }, ({ payload }) => {
      if (payload.playerId !== playerId) console.log(`SCORE_RECEIVED:${payload.score}`);
    })
    .on('broadcast', { event: 'finish' }, async ({ payload }) => {
      if (payload.playerId === playerId) return;
      console.log(`FINISH_RECEIVED:${payload.score}`);
      await cleanup(0);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await match.track({ playerId, name, joinedAt: Date.now() });
      }
    });
}

lobby = supabase.channel('stemegle:lobby:v1', {
  config: { presence: { key: playerId } },
});

lobby
  .on('presence', { event: 'sync' }, () => {
    if (paired) return;
    const queued = players(lobby)
      .sort((a, b) => a.joinedAt - b.joinedAt || a.playerId.localeCompare(b.playerId));
    const ownIndex = queued.findIndex((candidate) => candidate.playerId === playerId);
    const partnerIndex = ownIndex % 2 === 0 ? ownIndex + 1 : ownIndex - 1;
    if (queued[partnerIndex]) joinMatch([queued[ownIndex], queued[partnerIndex]]);
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      console.log('LOBBY_READY');
      await lobby.track({ playerId, name, joinedAt: Date.now() });
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error(`LOBBY_ERROR:${status}`);
      await cleanup(1);
    }
  });

setTimeout(() => cleanup(1), 120000);
process.on('SIGINT', () => cleanup(0));
