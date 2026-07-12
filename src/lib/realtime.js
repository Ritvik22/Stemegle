const DEFAULT_PATH = '/api/realtime';
const DEFAULT_ACK_TIMEOUT_MS = 5000;
const DEFAULT_SUBSCRIBE_TIMEOUT_MS = 10000;
const DEFAULT_RECONNECT_DELAY_MS = 250;
const MAX_QUEUED_BROADCASTS = 100;

const buildEnv = import.meta.env ?? {};
const configuredUrl = buildEnv.VITE_REALTIME_URL || '';

function asWebSocketUrl(value) {
  const base = typeof window !== 'undefined' ? window.location.href : undefined;
  if (!value && !base) return '';

  const url = new URL(value || DEFAULT_PATH, base);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  return url.toString();
}

function randomId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseSocketData(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return String(data);
}

function reportListenerError(error) {
  setTimeout(() => {
    throw error;
  }, 0);
}

export class RealtimeChannel {
  constructor(client, topic, options = {}) {
    this.client = client;
    this.topic = topic;
    this.options = options;
    this.channelId = randomId();
    this.presenceKey = options.config?.presence?.key ?? null;
    this.selfBroadcast = options.config?.broadcast?.self !== false;
    this.listeners = [];
    this.statusListeners = new Set();
    this.state = {};
    this.socket = null;
    this.subscribed = false;
    this.destroyed = false;
    this.manuallyClosed = false;
    this.trackedState = null;
    this.pending = new Map();
    this.queue = [];
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.subscribeTimer = null;
    this.errorNotified = false;
    this.matchTicket = null;
  }

  on(type, filter, callback) {
    if (typeof callback === 'function') this.listeners.push({ type, filter: filter ?? {}, callback });
    return this;
  }

  subscribe(callback) {
    if (typeof callback === 'function') this.statusListeners.add(callback);
    if (!this.socket && !this.destroyed) this.connect();
    return this;
  }

  presenceState() {
    return this.state;
  }

  matchAuthorization() {
    return this.matchTicket ? { ...this.matchTicket } : null;
  }

  async track(payload) {
    this.trackedState = payload;
    if (!this.subscribed) return 'ok';
    return this.sendWithAck({
      type: 'presence.track',
      channelId: this.channelId,
      state: payload,
    });
  }

  async untrack() {
    this.trackedState = null;
    if (!this.subscribed) {
      this.state = {};
      return 'ok';
    }
    return this.sendWithAck({ type: 'presence.untrack', channelId: this.channelId });
  }

  send(message) {
    if (message?.type !== 'broadcast' || typeof message.event !== 'string') {
      return Promise.resolve('error');
    }

    const entry = {
      message: {
        type: 'broadcast',
        channelId: this.channelId,
        event: message.event,
        payload: message.payload ?? {},
        eventId: message.eventId || randomId(),
      },
      resolve: null,
    };

    return new Promise((resolve) => {
      entry.resolve = resolve;
      if (this.subscribed) {
        this.transmitEntry(entry);
        return;
      }
      if (this.destroyed) {
        resolve('error');
        return;
      }
      if (this.queue.length >= MAX_QUEUED_BROADCASTS) {
        this.queue.shift()?.resolve('error');
      }
      this.queue.push(entry);
      if (!this.socket) this.connect();
    });
  }

  connect() {
    if (this.destroyed || this.socket) return;

    const url = this.client.resolveUrl();
    if (!url) {
      this.notifyStatus('CHANNEL_ERROR', new Error('Realtime URL is not configured.'));
      return;
    }

    let socket;
    try {
      socket = this.client.createSocket(url);
    } catch (error) {
      this.notifyStatus('CHANNEL_ERROR', error);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    this.errorNotified = false;
    socket.onopen = () => {
      if (this.socket !== socket || this.destroyed) return;
      socket.send(JSON.stringify({
        type: 'subscribe',
        ref: randomId(),
        channelId: this.channelId,
        topic: this.topic,
        presenceKey: this.presenceKey,
        presence: Boolean(this.presenceKey),
        selfBroadcast: this.selfBroadcast,
      }));
      this.subscribeTimer = setTimeout(() => {
        if (this.socket !== socket || this.subscribed) return;
        this.notifyStatus('TIMED_OUT');
        socket.close();
      }, this.client.subscribeTimeoutMs);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.destroyed) return;
      this.handleMessage(parseSocketData(event.data));
    };
    socket.onerror = () => {
      if (this.socket !== socket || this.destroyed || this.errorNotified) return;
      this.errorNotified = true;
      this.notifyStatus('CHANNEL_ERROR');
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.subscribed = false;
      clearTimeout(this.subscribeTimer);
      this.subscribeTimer = null;
      this.resolvePending('error');
      if (Object.keys(this.state).length) {
        this.state = {};
        this.emitPresenceSync();
      }
      if (!this.manuallyClosed && !this.destroyed) {
        this.notifyStatus('CLOSED');
        this.scheduleReconnect();
      }
    };
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.channelId && message.channelId !== this.channelId) return;

    if (message.type === 'subscribed') {
      clearTimeout(this.subscribeTimer);
      this.subscribeTimer = null;
      this.subscribed = true;
      this.reconnectAttempt = 0;
      if (this.trackedState !== null) {
        void this.sendWithAck({
          type: 'presence.track',
          channelId: this.channelId,
          state: this.trackedState,
        });
      }
      const queued = this.queue.splice(0);
      queued.forEach((entry) => this.transmitEntry(entry));
      this.notifyStatus('SUBSCRIBED');
      return;
    }

    if (message.type === 'ack') {
      this.settlePending(message.ref, 'ok');
      return;
    }

    if (message.type === 'match_ticket'
      && typeof message.ticket === 'string'
      && typeof message.matchId === 'string'
      && typeof message.playerId === 'string') {
      this.matchTicket = {
        ticket: message.ticket,
        matchId: message.matchId,
        playerId: message.playerId,
        ranked: message.ranked === true,
        expiresAt: Number(message.expiresAt) || 0,
      };
      return;
    }

    if (message.type === 'error') {
      if (message.ref) this.settlePending(message.ref, 'error');
      if (message.fatal) this.notifyStatus('CHANNEL_ERROR', new Error(message.message || 'Realtime channel error.'));
      return;
    }

    if (message.type === 'presence.sync' && message.state && typeof message.state === 'object') {
      this.state = message.state;
      this.emitPresenceSync();
      return;
    }

    if (message.type === 'broadcast') {
      this.listeners.forEach((listener) => {
        if (listener.type !== 'broadcast' || listener.filter?.event !== message.event) return;
        this.invoke(listener.callback, { payload: message.payload });
      });
      return;
    }

    if (message.type === 'db_change') {
      this.listeners.forEach((listener) => {
        if (listener.type !== 'postgres_changes') return;
        const filter = listener.filter ?? {};
        if (filter.schema && filter.schema !== message.schema) return;
        if (filter.table && filter.table !== message.table) return;
        if (filter.event && filter.event !== '*' && filter.event !== message.event) return;
        this.invoke(listener.callback, message);
      });
    }
  }

  emitPresenceSync() {
    this.listeners.forEach((listener) => {
      if (listener.type === 'presence' && listener.filter?.event === 'sync') {
        this.invoke(listener.callback);
      }
    });
  }

  invoke(callback, ...args) {
    try {
      callback(...args);
    } catch (error) {
      reportListenerError(error);
    }
  }

  notifyStatus(status, error) {
    this.statusListeners.forEach((callback) => this.invoke(callback, status, error));
  }

  sendWithAck(message) {
    if (!this.subscribed) return Promise.resolve('error');
    return new Promise((resolve) => this.transmitEntry({ message, resolve }));
  }

  transmitEntry(entry) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.subscribed) {
      entry.resolve('error');
      return;
    }

    const ref = entry.message.ref || randomId();
    const timer = setTimeout(() => this.settlePending(ref, 'timed out'), this.client.ackTimeoutMs);
    this.pending.set(ref, { resolve: entry.resolve, timer });
    try {
      socket.send(JSON.stringify({ ...entry.message, ref }));
    } catch {
      this.settlePending(ref, 'error');
    }
  }

  settlePending(ref, result) {
    const entry = this.pending.get(ref);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(ref);
    entry.resolve(result);
  }

  resolvePending(result) {
    [...this.pending.keys()].forEach((ref) => this.settlePending(ref, result));
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.destroyed || this.manuallyClosed) return;
    const attempt = this.reconnectAttempt++;
    const delay = Math.min(
      this.client.maxReconnectDelayMs,
      this.client.reconnectDelayMs * (2 ** Math.min(attempt, 6)),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  async unsubscribe() {
    if (this.destroyed) return 'ok';
    this.destroyed = true;
    this.manuallyClosed = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.subscribeTimer);
    this.reconnectTimer = null;
    this.subscribeTimer = null;
    this.trackedState = null;
    this.matchTicket = null;
    this.queue.splice(0).forEach((entry) => entry.resolve('error'));
    this.resolvePending('error');

    const socket = this.socket;
    this.socket = null;
    this.subscribed = false;
    if (socket && socket.readyState === 1) {
      try {
        socket.send(JSON.stringify({ type: 'unsubscribe', channelId: this.channelId }));
      } catch {
        // Closing the socket below provides the same server-side cleanup.
      }
    }
    socket?.close();
    return 'ok';
  }
}

export class RealtimeClient {
  constructor(options = {}) {
    const normalized = typeof options === 'string' ? { url: options } : options;
    this.url = normalized.url || configuredUrl;
    this.WebSocketImpl = normalized.WebSocketImpl || globalThis.WebSocket;
    this.webSocketFactory = normalized.webSocketFactory;
    this.ackTimeoutMs = normalized.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.subscribeTimeoutMs = normalized.subscribeTimeoutMs ?? DEFAULT_SUBSCRIBE_TIMEOUT_MS;
    this.reconnectDelayMs = normalized.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.maxReconnectDelayMs = normalized.maxReconnectDelayMs ?? 10000;
    this.channels = new Set();
  }

  resolveUrl() {
    return asWebSocketUrl(this.url);
  }

  createSocket(url) {
    if (this.webSocketFactory) return this.webSocketFactory(url);
    if (!this.WebSocketImpl) throw new Error('WebSocket is not available in this environment.');
    return new this.WebSocketImpl(url);
  }

  channel(topic, options) {
    const channel = new RealtimeChannel(this, topic, options);
    this.channels.add(channel);
    return channel;
  }

  getChannels() {
    return [...this.channels];
  }

  async removeChannel(channel) {
    if (!channel) return 'ok';
    this.channels.delete(channel);
    return channel.unsubscribe();
  }

  async removeAllChannels() {
    const channels = [...this.channels];
    this.channels.clear();
    await Promise.all(channels.map((channel) => channel.unsubscribe()));
    return 'ok';
  }
}

export function createRealtimeClient(options) {
  return new RealtimeClient(options);
}

export function getPresencePlayers(channel) {
  return Object.values(channel.presenceState())
    .flat()
    .filter((presence) => presence?.playerId && presence?.name);
}

export const hasRealtimeConfig = Boolean(configuredUrl || typeof window !== 'undefined');
export const realtime = createRealtimeClient();
