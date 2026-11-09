import { bindComposer, connect, messageEl, scrollToBottom, typingEl } from './shared.js';

const STORAGE_KEY = 'annagpt.conversationId';

const $ = (id) => document.getElementById(id);
const thread = $('thread');
const scroller = $('messages');
const status = $('status');

let typingTimer;
const typing = typingEl();

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

const socket = connect({
  path: () => {
    const id = localStorage.getItem(STORAGE_KEY);
    return `/ws${id ? `?cid=${encodeURIComponent(id)}` : ''}`;
  },
  onClose: () => {
    status.textContent = 'Reconnecting…';
    status.classList.remove('online');
  },
  onEvent(event) {
    if (event.type === 'init') {
      localStorage.setItem(STORAGE_KEY, event.id);
      thread.replaceChildren();
      $('empty').hidden = event.messages.length > 0;
      event.messages.forEach(addMessage);
      setOnline(event.online);
    } else if (event.type === 'message') {
      addMessage(event.message);
    } else if (event.type === 'presence') {
      setOnline(event.online);
    } else if (event.type === 'typing') {
      thread.append(typing);
      scrollToBottom(scroller);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => typing.remove(), 4000);
    }
  },
});

bindComposer({
  form: $('composer'),
  input: $('input'),
  onSend: (text) => socket.send({ type: 'message', text }),
  onTyping: () => socket.send({ type: 'typing' }),
});

// Dropping the stored id makes the server start a fresh conversation.
$('new-chat').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});
