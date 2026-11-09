import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createStore } from './store.js';
import { isAdminRequest, login, logout, sessionCookie } from './auth.js';

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DATA_FILE = process.env.DATA_FILE || 'data/conversations.json';
const SECURE = process.env.NODE_ENV === 'production';
const MAX_TEXT = 2000;
const MAX_MSGS_PER_MIN = 20;

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const store = createStore(DATA_FILE);
const visitors = new Map(); // conversation id -> Set<ws>
const admins = new Set();

// ---------- HTTP ----------

const app = express();
app.disable('x-powered-by');
// Behind a hosting proxy, req.ip must be the client for login rate limiting.
if (SECURE) app.set('trust proxy', 1);
app.get('/healthz', (_req, res) => res.send('ok'));
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '1kb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

app.post('/api/admin/login', (req, res) => {
  const result = login(req.ip, req.body?.password, ADMIN_PASSWORD);
  if (result.error === 'rate_limited') return res.status(429).json({ error: 'Too many attempts' });
  if (result.error) return res.status(401).json({ error: 'Wrong password' });
  res.setHeader('Set-Cookie', sessionCookie(result.token, SECURE));
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  logout(req);
  res.setHeader('Set-Cookie', sessionCookie(null, SECURE));
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.status(isAdminRequest(req) ? 200 : 401).json({ ok: isAdminRequest(req) });
});

const server = http.createServer(app);

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

const send = (ws, payload) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
const toAdmins = (payload) => admins.forEach((ws) => send(ws, payload));
const toVisitor = (id, payload) => visitors.get(id)?.forEach((ws) => send(ws, payload));
const toAllVisitors = (payload) => visitors.forEach((set) => set.forEach((ws) => send(ws, payload)));

function allowed(ws) {
  const now = Date.now();
  ws.stamps = (ws.stamps ?? []).filter((t) => now - t < 60_000);
  if (ws.stamps.length >= MAX_MSGS_PER_MIN) return false;
  ws.stamps.push(now);
  return true;
}

const cleanText = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '');

function attach(ws, id) {
  if (!visitors.has(id)) visitors.set(id, new Set());
  visitors.get(id).add(ws);
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();

  const isAdmin = url.searchParams.get('role') === 'admin';
  if (isAdmin) {
    // The admin socket is cookie-authenticated, so reject cross-site origins.
    const sameOrigin = req.headers.origin && new URL(req.headers.origin).host === req.headers.host;
    if (!sameOrigin || !isAdminRequest(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.role = isAdmin ? 'admin' : 'visitor';
    ws.conversationId = url.searchParams.get('cid');
    wss.emit('connection', ws);
  });
});

// Pings keep idle sockets alive through proxies and drop dead ones.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  if (ws.role === 'admin') {
    admins.add(ws);
    send(ws, { type: 'init', conversations: store.all().filter((c) => c.messages.length) });
    toAllVisitors({ type: 'presence', online: true });
  } else {
    const conversation = ws.conversationId && store.get(ws.conversationId);
    ws.conversationId = conversation ? conversation.id : null;
    if (conversation) attach(ws, conversation.id);
    send(ws, { type: 'init', id: ws.conversationId, messages: conversation?.messages ?? [], online: admins.size > 0 });
  }

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (ws.role === 'admin') onAdminEvent(ws, data);
    else onVisitorEvent(ws, data);
  });

  ws.on('close', () => {
    if (ws.role === 'admin') {
      admins.delete(ws);
      if (admins.size === 0) toAllVisitors({ type: 'presence', online: false });
    } else {
      const set = visitors.get(ws.conversationId);
      set?.delete(ws);
      if (set?.size === 0) visitors.delete(ws.conversationId);
    }
  });
});

function onVisitorEvent(ws, data) {
  if (data?.type === 'typing') return ws.conversationId && toAdmins({ type: 'typing', id: ws.conversationId });
  if (data?.type !== 'message') return;

  const text = cleanText(data.text);
  if (!text || !allowed(ws)) return;

  // Conversations are created on the first message, so empty chats never exist.
  if (!ws.conversationId) {
    ws.conversationId = store.create().id;
    attach(ws, ws.conversationId);
    send(ws, { type: 'session', id: ws.conversationId });
  }
  const id = ws.conversationId;
  const message = store.addMessage(id, 'user', text);
  toVisitor(id, { type: 'message', message });
  toAdmins({ type: 'message', id, message });
}

function onAdminEvent(_ws, data) {
  if (!store.get(data?.id)) return;

  if (data.type === 'typing') return toVisitor(data.id, { type: 'typing' });
  if (data.type === 'read') return store.markRead(data.id);
  if (data.type !== 'reply') return;

  const text = cleanText(data.text);
  if (!text) return;

  const message = store.addMessage(data.id, 'assistant', text);
  toVisitor(data.id, { type: 'message', message });
  toAdmins({ type: 'message', id: data.id, message });
}

// ---------- Lifecycle ----------

server.listen(PORT, () => {
  console.log(`AnnaGPT:  http://localhost:${PORT}`);
  console.log(`Inbox:    http://localhost:${PORT}/admin.html`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    store.flush();
    process.exit(0);
  });
}
