import { bindComposer, connect, messageEl, scrollToBottom, typingEl } from './shared.js';

const CURRENT_KEY = 'annagpt.conversationId';
const HISTORY_KEY = 'annagpt.history';

const $ = (id) => document.getElementById(id);
const thread = $('thread');
const scroller = $('messages');
const status = $('status');
const sidebar = $('sidebar');
const typing = typingEl();

let currentId = localStorage.getItem(CURRENT_KEY);
let socket;
let typingTimer;

// History lives in this browser only: [{ id, title, updatedAt }].
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? [];
  } catch {
    return [];
  }
}

function touchHistory(id, firstText, ts) {
  const history = loadHistory();
  let entry = history.find((h) => h.id === id);
  if (!entry) {
    entry = { id, title: firstText.slice(0, 60) };
    history.push(entry);
  }
  entry.updatedAt = ts;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function renderHistory() {
  const items = loadHistory().sort((a, b) => b.updatedAt - a.updatedAt);
  $('history-label').hidden = items.length === 0;
  $('history').replaceChildren(
    ...items.map((h) => {
      const btn = document.createElement('button');
      btn.className = `sidebar-btn${h.id === currentId ? ' active' : ''}`;
      btn.textContent = h.title;
      btn.addEventListener('click', () => switchTo(h.id));
      return btn;
    }),
  );
}

function setCurrent(id) {
  currentId = id;
  if (id) localStorage.setItem(CURRENT_KEY, id);
  else localStorage.removeItem(CURRENT_KEY);
}

function setOnline(online) {
  status.textContent = online ? 'Anna is online' : "Anna is away, she'll reply when she's back";
  status.classList.toggle('online', online);
}

function addMessage(message) {
  typing.remove();
  clearTimeout(typingTimer);
  $('empty').hidden = true;
  thread.append(messageEl(message));
  scrollToBottom(scroller);
}

function onEvent(event) {
  if (event.type === 'init') {
    setCurrent(event.id);
    thread.replaceChildren();
    $('empty').hidden = event.messages.length > 0;
    event.messages.forEach((m) => addMessage(m));
    if (event.messages.length) {
      const firstUser = event.messages.find((m) => m.role === 'user');
      touchHistory(event.id, firstUser?.text ?? 'Chat', event.messages.at(-1).ts);
    }
    setOnline(event.online);
    renderHistory();
  } else if (event.type === 'session') {
    setCurrent(event.id);
  } else if (event.type === 'message') {
    addMessage(event.message);
    touchHistory(currentId, event.message.text, event.message.ts);
    renderHistory();
  } else if (event.type === 'presence') {
    setOnline(event.online);
  } else if (event.type === 'blocked') {
    status.textContent = 'Messaging is unavailable';
    status.classList.remove('online');
  } else if (event.type === 'typing') {
    thread.append(typing);
    scrollToBottom(scroller);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => typing.remove(), 4000);
  }
}

function start() {
  socket = connect({
    path: () => `/ws${currentId ? `?cid=${encodeURIComponent(currentId)}` : ''}`,
    onClose: () => {
      status.textContent = 'Reconnecting…';
      status.classList.remove('online');
    },
    onEvent,
  });
}

// id = null opens an empty draft; the server creates the conversation on the first message.
function switchTo(id) {
  sidebar.classList.remove('open');
  if (id === currentId) return;
  socket.close();
  typing.remove();
  setCurrent(id);
  renderHistory();
  start();
}

start();
renderHistory();

bindComposer({
  form: $('composer'),
  input: $('input'),
  onSend: (text) => socket.send({ type: 'message', text }),
  onTyping: () => socket.send({ type: 'typing' }),
});

$('new-chat').addEventListener('click', () => switchTo(null));
$('menu').addEventListener('click', () => sidebar.classList.toggle('open'));
document.querySelector('.main').addEventListener('click', () => sidebar.classList.remove('open'));
