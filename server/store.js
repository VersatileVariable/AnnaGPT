import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// In-memory conversations persisted to a JSON file (debounced).
const ADJECTIVES = ['Quiet', 'Curious', 'Gentle', 'Bright', 'Swift', 'Cozy', 'Clever', 'Brave', 'Sleepy', 'Merry', 'Misty', 'Sunny', 'Wandering', 'Velvet', 'Amber', 'Silver'];
const ANIMALS = ['Otter', 'Fox', 'Heron', 'Badger', 'Finch', 'Hare', 'Lynx', 'Wren', 'Owl', 'Seal', 'Moth', 'Newt', 'Robin', 'Stoat', 'Swan', 'Vole'];

// Deterministic from the id, so it never needs to be stored to stay stable.
export function labelFor(id) {
  const n = parseInt(id.replace(/-/g, '').slice(0, 8), 16);
  const adjective = ADJECTIVES[n % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(n / 16) % ANIMALS.length];
  return `${adjective} ${animal} ${(Math.floor(n / 256) % 90) + 10}`;
}

export function createStore(file) {
  const conversations = new Map();
  const blockedIps = new Set();

  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    // Older files were a bare array of conversations.
    for (const c of Array.isArray(saved) ? saved : saved.conversations) {
      c.label ??= labelFor(c.id);
      conversations.set(c.id, c);
    }
    for (const ip of saved.blockedIps ?? []) blockedIps.add(ip);
  }

  let timer;
  function flush() {
    clearTimeout(timer);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ conversations: [...conversations.values()], blockedIps: [...blockedIps] }));
    renameSync(tmp, file);
  }
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 200);
  };

  return {
    get: (id) => conversations.get(id),

    // Conversations with at least one message, as shown in the admin inbox.
    adminView: () =>
      [...conversations.values()]
        .filter((c) => c.messages.length)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => ({ ...c, blocked: blockedIps.has(c.ip) })),

    meta(id) {
      const { label, ip, geo, device } = conversations.get(id);
      return { label, ip, geo, device, blocked: blockedIps.has(ip) };
    },

    isBlocked: (ip) => blockedIps.has(ip),

    setBlocked(ip, blocked) {
      if (blocked) blockedIps.add(ip);
      else blockedIps.delete(ip);
      scheduleSave();
    },

    // Keeps the latest IP/location/device so a block targets where they are now.
    updateVisitor(id, { ip, geo, device }) {
      Object.assign(conversations.get(id), { ip, geo, device });
      scheduleSave();
    },

    create({ ip = null, geo = null, device = null } = {}) {
      const now = Date.now();
      const id = randomUUID();
      const conversation = { id, label: labelFor(id), ip, geo, device, createdAt: now, updatedAt: now, unread: 0, messages: [] };
      conversations.set(id, conversation);
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
