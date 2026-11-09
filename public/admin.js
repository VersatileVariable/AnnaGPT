import { bindComposer, connect, messageEl, scrollToBottom, typingEl } from './shared.js';

const $ = (id) => document.getElementById(id);
const conversations = new Map(); // id -> conversation
let selected = null;
let socket = null;
let typingTimer;
const typing = typingEl();

const preview = (c) => c.messages.at(-1)?.text ?? 'New conversation';

function renderList() {
  const sorted = [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  $('list').replaceChildren(
    ...sorted.map((c) => {
      const btn = document.createElement('button');
      btn.className = `sidebar-btn conversation${c.id === selected ? ' active' : ''}`;
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = preview(c);
      btn.append(title);
      if (c.unread) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = c.unread;
        btn.append(badge);
      }
      btn.addEventListener('click', () => select(c.id));
      return btn;
    }),
  );
}

function renderThread() {
  const c = conversations.get(selected);
  $('composer').hidden = !c;
  $('title').textContent = c ? `Conversation ${c.id.slice(0, 8)}` : 'Select a conversation';
  $('thread').replaceChildren(...(c?.messages ?? []).map((m) => messageEl(m)));
  scrollToBottom($('messages'));
}

function select(id) {
  selected = id;
  const c = conversations.get(id);
  if (c.unread) {
    c.unread = 0;
    socket.send({ type: 'read', id });
  }
  renderList();
  renderThread();
  $('input').focus();
}

function onEvent(event) {
  if (event.type === 'init') {
    conversations.clear();
    event.conversations.forEach((c) => conversations.set(c.id, c));
    renderList();
    if (selected) renderThread();
  } else if (event.type === 'message') {
    let c = conversations.get(event.id);
    if (!c) {
      c = { id: event.id, createdAt: event.message.ts, unread: 0, messages: [] };
      conversations.set(event.id, c);
    }
    c.messages.push(event.message);
    c.updatedAt = event.message.ts;
    if (event.message.role === 'user') {
      if (event.id === selected) socket.send({ type: 'read', id: event.id });
      else c.unread += 1;
    }
    renderList();
    if (event.id === selected) {
      typing.remove();
      $('thread').append(messageEl(event.message));
      scrollToBottom($('messages'));
    }
  } else if (event.type === 'typing' && event.id === selected) {
    $('thread').append(typing);
    scrollToBottom($('messages'));
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => typing.remove(), 4000);
  }
}

function start() {
  $('login').hidden = true;
  $('app').hidden = false;

  socket = connect({
    path: '/ws?role=admin',
    onOpen: () => {
      $('status').textContent = 'Online';
      $('status').classList.add('online');
    },
    onClose: () => {
      $('status').textContent = 'Reconnecting…';
      $('status').classList.remove('online');
    },
    onEvent,
  });

  bindComposer({
    form: $('composer'),
    input: $('input'),
    onSend: (text) => selected && socket.send({ type: 'reply', id: selected, text }),
    onTyping: () => selected && socket.send({ type: 'typing', id: selected }),
  });
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('password').value }),
  });
  if (res.ok) return start();
  $('login-error').textContent = res.status === 429 ? 'Too many attempts, try later.' : 'Wrong password.';
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.reload();
});

const session = await fetch('/api/admin/session');
if (session.ok) start();
else $('login').hidden = false;
