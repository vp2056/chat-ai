/* ============================================================
   API — camada fina sobre o back-end FastAPI.
   Streaming usa fetch + ReadableStream para poder abortar
   (EventSource não permite POST nem cancelamento limpo).
   ============================================================ */
const API = (() => {
  'use strict';

  const BASE = '';

  async function request(path, options = {}) {
    const resp = await fetch(BASE + path, {
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      ...options,
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const data = await resp.json();
        detail = data.detail || detail;
      } catch { /* resposta sem corpo JSON */ }
      throw new Error(detail);
    }

    if (resp.status === 204) return null;
    const type = resp.headers.get('content-type') || '';
    return type.includes('application/json') ? resp.json() : resp.text();
  }

  const json = (body) => ({ body: JSON.stringify(body) });

  /** Lê um corpo text/event-stream e dispara os callbacks por evento. */
  async function consumeSSE(resp, handlers, signal) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          let event = 'message';
          const data = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trim());
          }
          if (!data.length) continue;
          let payload;
          try { payload = JSON.parse(data.join('\n')); } catch { continue; }
          handlers[event]?.(payload);
        }
      }
    } catch (err) {
      if (signal?.aborted || err.name === 'AbortError') return;
      throw err;
    }
  }

  async function stream(path, body, handlers, signal) {
    const resp = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try { detail = (await resp.json()).detail || detail; } catch { /* sem JSON */ }
      throw new Error(detail);
    }

    await consumeSSE(resp, handlers, signal);
  }

  return {
    // sistema
    health:       () => request('/api/health'),
    models:       () => request('/api/models'),
    modelInfo:    (name) => request(`/api/models/${encodeURIComponent(name)}/info`),
    deleteModel:  (name) => request(`/api/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    pullModel:    (name, handlers, signal) => stream('/api/models/pull', { name }, handlers, signal),
    getSettings:  () => request('/api/settings'),
    saveSettings: (values) => request('/api/settings', { method: 'PUT', ...json({ values }) }),
    search:       (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
    wipeChats:    () => request('/api/chats', { method: 'DELETE' }),

    // conversas
    listChats:   (q) => request(`/api/chats${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    createChat:  (payload = {}) => request('/api/chats', { method: 'POST', ...json(payload) }),
    getChat:     (id) => request(`/api/chats/${id}`),
    updateChat:  (id, patch) => request(`/api/chats/${id}`, { method: 'PATCH', ...json(patch) }),
    deleteChat:  (id) => request(`/api/chats/${id}`, { method: 'DELETE' }),
    deleteMessage: (chatId, msgId) => request(`/api/chats/${chatId}/messages/${msgId}`, { method: 'DELETE' }),
    exportUrl:   (id, fmt = 'markdown') => `/api/chats/${id}/export?fmt=${fmt}`,

    // geração
    send:       (id, payload, handlers, signal) => stream(`/api/chats/${id}/messages`, payload, handlers, signal),
    regenerate: (id, payload, handlers, signal) => stream(`/api/chats/${id}/regenerate`, payload, handlers, signal),
    editMessage: (id, msgId, payload, handlers, signal) =>
      stream(`/api/chats/${id}/messages/${msgId}/edit`, payload, handlers, signal),
  };
})();
