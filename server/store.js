import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// In-memory conversations persisted to a JSON file (debounced).
export function createStore(file) {
  const conversations = new Map();

  if (existsSync(file)) {
    for (const c of JSON.parse(readFileSync(file, 'utf8'))) conversations.set(c.id, c);
  }

  let timer;
  function flush() {
    clearTimeout(timer);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...conversations.values()]));
    renameSync(tmp, file);
  }
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 200);
  };

  return {
    get: (id) => conversations.get(id),

    all: () => [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt),

    create() {
      const now = Date.now();
      const conversation = { id: randomUUID(), createdAt: now, updatedAt: now, unread: 0, messages: [] };
      conversations.set(conversation.id, conversation);
      scheduleSave();
      return conversation;
    },

    // role: 'user' (the visitor) or 'assistant' (the human behind AnnaGPT)
    addMessage(id, role, text) {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      const message = { id: randomUUID(), role, text, ts: Date.now() };
      conversation.messages.push(message);
      conversation.updatedAt = message.ts;
      if (role === 'user') conversation.unread += 1;
      scheduleSave();
      return message;
    },

    markRead(id) {
      const conversation = conversations.get(id);
      if (conversation) {
        conversation.unread = 0;
        scheduleSave();
      }
    },

    flush,
  };
}
