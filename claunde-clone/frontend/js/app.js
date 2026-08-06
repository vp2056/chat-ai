/* ============================================================
   Claunde — lógica da interface.
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = {
    app:          $('#app'),
    sidebar:      $('#sidebar'),
    scrim:        $('#sidebarScrim'),
    chatList:     $('#chatList'),
    searchInput:  $('#searchInput'),
    newChatBtn:   $('#newChatBtn'),
    collapseBtn:  $('#collapseBtn'),
    menuBtn:      $('#menuBtn'),
    chatTitle:    $('#chatTitle'),
    messages:     $('#messages'),
    welcome:      $('#welcome'),
    input:        $('#input'),
    sendBtn:      $('#sendBtn'),
    stopBtn:      $('#stopBtn'),
    composerHint: $('#composerHint'),
    modelBtn:     $('#modelBtn'),
    modelBtnLabel:$('#modelBtnLabel'),
    modelDropdown:$('#modelDropdown'),
    exportBtn:    $('#exportBtn'),
    themeBtn:     $('#themeBtn'),
    deleteChatBtn:$('#deleteChatBtn'),
    scrollBottom: $('#scrollBottomBtn'),
    statusDot:    $('#statusDot'),
    statusText:   $('#statusText'),
    settingsBtn:  $('#settingsBtn'),
    settingsModal:$('#settingsModal'),
    closeSettings:$('#closeSettings'),
    toastStack:   $('#toastStack'),
    modelTable:   $('#modelTable'),
    statGrid:     $('#statGrid'),
  };

  const state = {
    chats: [],
    chat: null,
    settings: {},
    models: [],
    streaming: false,
    controller: null,
    autoScroll: true,
  };

  // ==================================================================
  // Utilidades
  // ==================================================================
  function toast(message, kind = '') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    el.toastStack.appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity .2s';
      setTimeout(() => node.remove(), 200);
    }, kind === 'error' ? 5200 : 2800);
  }

  function formatBytes(bytes) {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let value = bytes;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function groupLabel(timestamp) {
    const date = new Date(timestamp * 1000);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const days = Math.floor((startOfToday - date) / 86400000);
    if (days < 0) return 'Hoje';
    if (days === 0) return 'Hoje';
    if (days === 1) return 'Ontem';
    if (days < 7) return 'Últimos 7 dias';
    if (days < 30) return 'Últimos 30 dias';
    return 'Mais antigas';
  }

  const icon = (paths) => `<svg viewBox="0 0 24 24">${paths}</svg>`;
  const ICONS = {
    copy:   '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    check:  '<path d="M20 6L9 17l-5-5"/>',
    edit:   '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    redo:   '<path d="M21 12a9 9 0 11-3-6.7M21 3v6h-6"/>',
    trash:  '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    pin:    '<path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3-1-7z"/>',
    chev:   '<path d="M9 6l6 6-6 6"/>',
  };

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para contextos sem clipboard API (http em rede local).
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    if (button) {
      const original = button.innerHTML;
      button.innerHTML = `${icon(ICONS.check)}Copiado`;
      setTimeout(() => { button.innerHTML = original; }, 1400);
    }
  }

  // ==================================================================
  // Tema
  // ==================================================================
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('claunde-theme', theme);
    $('#themeIcon').innerHTML = theme === 'dark'
      ? '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  }

  // ==================================================================
  // Barra lateral
  // ==================================================================
  async function loadChats(query = '') {
    try {
      state.chats = await API.listChats(query);
      renderChatList();
    } catch (err) {
      toast(`Não foi possível carregar as conversas: ${err.message}`, 'error');
    }
  }

  function renderChatList() {
    el.chatList.innerHTML = '';
    if (!state.chats.length) {
      el.chatList.innerHTML = '<p class="empty-note">Nenhuma conversa ainda.</p>';
      return;
    }

    let lastGroup = null;
    for (const chat of state.chats) {
      const label = chat.pinned ? 'Fixadas' : groupLabel(chat.updated_at);
      if (label !== lastGroup) {
        const header = document.createElement('div');
        header.className = 'chat-group-label';
        header.textContent = label;
        el.chatList.appendChild(header);
        lastGroup = label;
      }

      const item = document.createElement('div');
      item.className = `chat-item${state.chat?.id === chat.id ? ' active' : ''}`;
      item.dataset.id = chat.id;

      const body = document.createElement('div');
      body.className = 'chat-item-body';
      const title = document.createElement('div');
      title.className = 'chat-item-title';
      title.textContent = chat.title;
      const meta = document.createElement('div');
      meta.className = 'chat-item-meta';
      meta.textContent = chat.preview ? chat.preview.slice(0, 60) : `${chat.message_count} mensagens`;
      body.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'chat-item-actions';
      actions.innerHTML = `
        <button class="icon-btn" data-act="pin" title="${chat.pinned ? 'Desafixar' : 'Fixar'}">${icon(ICONS.pin)}</button>
        <button class="icon-btn danger" data-act="del" title="Excluir">${icon(ICONS.trash)}</button>`;

      item.append(body, actions);
      if (chat.pinned) {
        const mark = document.createElement('span');
        mark.className = 'pin-mark';
        mark.innerHTML = icon(ICONS.pin);
        item.prepend(mark);
      }
      el.chatList.appendChild(item);
    }
  }

  el.chatList.addEventListener('click', async (event) => {
    const item = event.target.closest('.chat-item');
    if (!item) return;
    const id = item.dataset.id;
    const action = event.target.closest('[data-act]')?.dataset.act;

    if (action === 'pin') {
      const chat = state.chats.find((c) => c.id === id);
      await API.updateChat(id, { pinned: !chat.pinned });
      await loadChats(el.searchInput.value.trim());
      return;
    }
    if (action === 'del') {
      if (!confirm('Excluir esta conversa? Não há como desfazer.')) return;
      await API.deleteChat(id);
      if (state.chat?.id === id) { state.chat = null; showWelcome(); }
      await loadChats(el.searchInput.value.trim());
      toast('Conversa excluída');
      return;
    }
    openChat(id);
    el.app.classList.remove('mobile-open');
  });

  // ==================================================================
  // Mensagens
  // ==================================================================
  function showWelcome() {
    el.messages.innerHTML = '';
    el.messages.appendChild(el.welcome);
    el.welcome.hidden = false;
    el.chatTitle.textContent = 'Nova conversa';
    updateModelLabel();
  }

  async function openChat(id) {
    try {
      const chat = await API.getChat(id);
      state.chat = chat;
      el.chatTitle.textContent = chat.title;
      renderMessages(chat.messages);
      renderChatList();
      updateModelLabel();
      el.input.focus();
    } catch (err) {
      toast(`Erro ao abrir conversa: ${err.message}`, 'error');
    }
  }

  function renderMessages(messages) {
    el.messages.innerHTML = '';
    if (!messages.length) {
      el.messages.appendChild(el.welcome);
      el.welcome.hidden = false;
      return;
    }
    el.welcome.hidden = true;
    for (const msg of messages) el.messages.appendChild(messageElement(msg));
    scrollToBottom(true);
  }

  function messageElement(msg) {
    const row = document.createElement('article');
    row.className = 'msg-row';
    row.dataset.id = msg.id;
    row.dataset.role = msg.role;

    const wrap = document.createElement('div');
    wrap.className = `msg ${msg.role}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${msg.role}`;
    avatar.textContent = msg.role === 'assistant' ? '✳' : 'V';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const name = document.createElement('div');
    name.className = 'msg-name';
    name.textContent = msg.role === 'assistant' ? 'Claunde' : 'Você';

    const content = document.createElement('div');
    content.className = 'msg-content';
    if (msg.role === 'assistant') content.classList.add('md');

    body.append(name);

    if (msg.thinking) body.appendChild(thinkingBlock(msg.thinking));
    body.appendChild(content);

    setContent(content, msg);

    body.appendChild(actionsBar(msg));

    if (msg.stats?.tokens_per_second) {
      const stats = document.createElement('div');
      stats.className = 'msg-stats';
      stats.textContent = `${msg.stats.eval_count} tokens · ${msg.stats.tokens_per_second} tok/s · ${(msg.stats.total_ms / 1000).toFixed(1)}s`;
      body.appendChild(stats);
    }

    wrap.append(avatar, body);
    row.appendChild(wrap);
    return row;
  }

  function setContent(node, msg) {
    if (msg.error) {
      node.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'msg-error';
      error.textContent = `⚠ ${msg.error}`;
      node.appendChild(error);
      return;
    }
    if (msg.role === 'assistant') node.innerHTML = Markdown.render(msg.content);
    else node.textContent = msg.content;
  }

  function thinkingBlock(text) {
    const block = document.createElement('div');
    block.className = 'thinking-block';
    block.innerHTML = `
      <button class="thinking-head" type="button">${icon(ICONS.chev).replace('<svg', '<svg class="chev"')}Raciocínio do modelo</button>
      <div class="thinking-body" hidden></div>`;
    $('.thinking-body', block).textContent = text;
    $('.thinking-head', block).addEventListener('click', () => {
      const body = $('.thinking-body', block);
      body.hidden = !body.hidden;
      block.classList.toggle('open', !body.hidden);
    });
    return block;
  }

  function actionsBar(msg) {
    const bar = document.createElement('div');
    bar.className = 'msg-actions';

    const copy = document.createElement('button');
    copy.className = 'icon-btn';
    copy.title = 'Copiar';
    copy.innerHTML = icon(ICONS.copy);
    copy.addEventListener('click', async () => { await copyText(msg.content); toast('Copiado'); });
    bar.appendChild(copy);

    if (msg.role === 'user') {
      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.title = 'Editar e reenviar';
      edit.innerHTML = icon(ICONS.edit);
      edit.addEventListener('click', () => startEdit(msg));
      bar.appendChild(edit);
    } else {
      const redo = document.createElement('button');
      redo.className = 'icon-btn';
      redo.title = 'Gerar outra resposta';
      redo.innerHTML = icon(ICONS.redo);
      redo.addEventListener('click', () => regenerate(msg.id));
      bar.appendChild(redo);
    }

    const del = document.createElement('button');
    del.className = 'icon-btn danger';
    del.title = 'Excluir mensagem';
    del.innerHTML = icon(ICONS.trash);
    del.addEventListener('click', async () => {
      await API.deleteMessage(state.chat.id, msg.id);
      document.querySelector(`.msg-row[data-id="${msg.id}"]`)?.remove();
    });
    bar.appendChild(del);

    return bar;
  }

  function startEdit(msg) {
    const row = document.querySelector(`.msg-row[data-id="${msg.id}"]`);
    const content = $('.msg-content', row);
    const original = msg.content;

    const area = document.createElement('textarea');
    area.className = 'edit-area';
    area.value = original;

    const actions = document.createElement('div');
    actions.className = 'edit-actions';
    actions.innerHTML = '<button class="btn primary" data-save>Salvar e enviar</button><button class="btn" data-cancel>Cancelar</button>';

    content.replaceWith(area);
    area.after(actions);
    area.focus();
    area.style.height = `${area.scrollHeight}px`;

    $('[data-cancel]', actions).addEventListener('click', () => {
      actions.remove();
      area.replaceWith(content);
    });
    $('[data-save]', actions).addEventListener('click', async () => {
      const text = area.value.trim();
      if (!text) return;
      actions.remove();
      area.replaceWith(content);
      await submitEdit(msg.id, text);
    });
  }

  // ==================================================================
  // Rolagem
  // ==================================================================
  function scrollToBottom(force = false) {
    if (!force && !state.autoScroll) return;
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  el.messages.addEventListener('scroll', () => {
    const distance = el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
    state.autoScroll = distance < 120;
    el.scrollBottom.hidden = distance < 200;
  });
  el.scrollBottom.addEventListener('click', () => { state.autoScroll = true; scrollToBottom(true); });

  // ==================================================================
  // Envio e streaming
  // ==================================================================
  function setStreaming(on) {
    state.streaming = on;
    el.sendBtn.hidden = on;
    el.stopBtn.hidden = !on;
    el.input.disabled = false;
  }

  /** Cria o bloco da resposta e devolve funções para alimentá-lo. */
  function createAssistantSlot() {
    const placeholder = messageElement({ id: 'pending', role: 'assistant', content: '', stats: null });
    $('.msg-content', placeholder).innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
    $('.msg-actions', placeholder).style.display = 'none';
    el.messages.appendChild(placeholder);
    scrollToBottom(true);

    let text = '';
    let reasoning = '';
    let frame = null;
    const content = $('.msg-content', placeholder);

    const paint = () => {
      frame = null;
      content.innerHTML = Markdown.render(text) + '<span class="typing-cursor"></span>';
      scrollToBottom();
    };

    return {
      node: placeholder,
      appendDelta(delta) {
        text += delta;
        if (frame === null) frame = requestAnimationFrame(paint);
      },
      appendThinking(delta) {
        reasoning += delta;
        let block = $('.thinking-block', placeholder);
        if (!block) {
          block = thinkingBlock('');
          block.classList.add('open');
          $('.thinking-body', block).hidden = false;
          content.before(block);
        }
        $('.thinking-body', block).textContent = reasoning;
        scrollToBottom();
      },
      finish(msg) {
        if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
        const final = { ...msg, role: 'assistant', content: msg.content ?? text, thinking: reasoning || null };
        const replacement = messageElement(final);
        placeholder.replaceWith(replacement);
        scrollToBottom();
      },
      get text() { return text; },
    };
  }

  async function runStream(call) {
    const controller = new AbortController();
    state.controller = controller;
    setStreaming(true);

    const slot = createAssistantSlot();
    let failed = null;

    try {
      await call({
        handlers: {
          delta:    (data) => slot.appendDelta(data.delta),
          thinking: (data) => slot.appendThinking(data.delta),
          error:    (data) => { failed = data; },
          done:     (data) => {
            slot.finish({ id: data.message_id, content: data.content, stats: data.stats });
            setStreaming(false); // libera o composer mesmo que o título ainda venha
          },
          // O título chega depois do "done" para não segurar a interface.
          title:    (data) => {
            el.chatTitle.textContent = data.title;
            if (state.chat) state.chat.title = data.title;
            loadChats(el.searchInput.value.trim());
          },
        },
        signal: controller.signal,
      });

      if (failed) {
        slot.finish({ id: failed.message_id, content: slot.text, error: failed.error });
        toast(failed.error, 'error');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        slot.finish({ id: 'error', content: slot.text, error: err.message });
        toast(err.message, 'error');
      } else {
        slot.finish({ id: 'stopped', content: slot.text || '_(geração interrompida)_' });
      }
    } finally {
      // Só reverte o estado se nenhuma outra geração tiver começado no meio-tempo.
      if (state.controller === controller) {
        setStreaming(false);
        state.controller = null;
      }
      loadChats(el.searchInput.value.trim());
    }
  }

  function generationPayload() {
    return {
      model: state.chat?.model || state.settings.default_model,
      options: state.settings.options || {},
      history_limit: state.settings.history_limit || 40,
    };
  }

  async function send() {
    const text = el.input.value.trim();
    if (!text || state.streaming) return;

    if (!state.chat) {
      try {
        state.chat = await API.createChat({ model: state.settings.default_model });
      } catch (err) {
        toast(`Não foi possível criar a conversa: ${err.message}`, 'error');
        return;
      }
    }

    el.welcome.hidden = true;
    if (el.welcome.parentElement === el.messages) el.messages.removeChild(el.welcome);

    el.messages.appendChild(messageElement({ id: `local-${Date.now()}`, role: 'user', content: text }));
    el.input.value = '';
    autoResize();
    state.autoScroll = true;
    scrollToBottom(true);

    await runStream(({ handlers, signal }) =>
      API.send(state.chat.id, { content: text, ...generationPayload() }, handlers, signal));

    // Sincroniza os ids reais das mensagens gravadas no banco.
    await refreshMessages();
  }

  async function regenerate(messageId) {
    if (state.streaming || !state.chat) return;
    document.querySelector(`.msg-row[data-id="${messageId}"]`)?.remove();
    state.autoScroll = true;
    await runStream(({ handlers, signal }) =>
      API.regenerate(state.chat.id, { message_id: messageId, ...generationPayload() }, handlers, signal));
    await refreshMessages();
  }

  async function submitEdit(messageId, text) {
    if (state.streaming || !state.chat) return;

    // Remove da tela a mensagem editada e tudo o que veio depois.
    const rows = $$('.msg-row', el.messages);
    const index = rows.findIndex((r) => r.dataset.id === messageId);
    if (index >= 0) rows.slice(index).forEach((r) => r.remove());

    el.messages.appendChild(messageElement({ id: `local-${Date.now()}`, role: 'user', content: text }));
    state.autoScroll = true;
    scrollToBottom(true);

    await runStream(({ handlers, signal }) =>
      API.editMessage(state.chat.id, messageId, { content: text, resend: true }, handlers, signal));
    await refreshMessages();
  }

  async function refreshMessages() {
    if (!state.chat) return;
    try {
      const chat = await API.getChat(state.chat.id);
      state.chat = chat;
      el.chatTitle.textContent = chat.title;
      renderMessages(chat.messages);
    } catch { /* mantém o que já está na tela */ }
  }

  el.stopBtn.addEventListener('click', () => {
    state.controller?.abort();
    toast('Geração interrompida');
  });

  // ==================================================================
  // Composer
  // ==================================================================
  function autoResize() {
    el.input.style.height = 'auto';
    el.input.style.height = `${Math.min(el.input.scrollHeight, 260)}px`;
    el.sendBtn.disabled = !el.input.value.trim();
  }

  el.input.addEventListener('input', autoResize);
  el.input.addEventListener('keydown', (event) => {
    const enterSends = state.settings.send_on_enter !== false;
    const isSubmit = enterSends
      ? event.key === 'Enter' && !event.shiftKey
      : event.key === 'Enter' && (event.ctrlKey || event.metaKey);
    if (isSubmit) {
      event.preventDefault();
      send();
    }
  });
  el.sendBtn.addEventListener('click', send);

  el.messages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const code = button.closest('.code-block')?.querySelector('code');
    if (code) copyText(code.textContent, button);
  });

  $$('.suggestion').forEach((button) => {
    button.addEventListener('click', () => {
      el.input.value = button.dataset.prompt;
      autoResize();
      send();
    });
  });

  // ==================================================================
  // Título, exportação, exclusão
  // ==================================================================
  el.chatTitle.addEventListener('dblclick', () => {
    if (!state.chat) return;
    el.chatTitle.contentEditable = 'true';
    el.chatTitle.focus();
    document.execCommand?.('selectAll', false, null);
  });

  async function commitTitle() {
    if (el.chatTitle.contentEditable !== 'true') return;
    el.chatTitle.contentEditable = 'false';
    const title = el.chatTitle.textContent.trim() || 'Nova conversa';
    el.chatTitle.textContent = title;
    if (state.chat && title !== state.chat.title) {
      await API.updateChat(state.chat.id, { title });
      state.chat.title = title;
      loadChats(el.searchInput.value.trim());
    }
  }

  el.chatTitle.addEventListener('blur', commitTitle);
  el.chatTitle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); el.chatTitle.blur(); }
    if (event.key === 'Escape') { el.chatTitle.textContent = state.chat?.title ?? ''; el.chatTitle.blur(); }
  });

  el.exportBtn.addEventListener('click', () => {
    if (!state.chat) return toast('Abra uma conversa primeiro');
    window.open(API.exportUrl(state.chat.id), '_blank');
  });

  el.deleteChatBtn.addEventListener('click', async () => {
    if (!state.chat) return;
    if (!confirm('Excluir esta conversa? Não há como desfazer.')) return;
    await API.deleteChat(state.chat.id);
    state.chat = null;
    showWelcome();
    await loadChats();
    toast('Conversa excluída');
  });

  el.newChatBtn.addEventListener('click', async () => {
    state.chat = null;
    showWelcome();
    renderChatList();
    el.input.focus();
  });

  // ==================================================================
  // Seletor de modelos
  // ==================================================================
  function updateModelLabel() {
    const model = state.chat?.model || state.settings.default_model || '—';
    el.modelBtnLabel.textContent = model;
  }

  async function loadModels() {
    try {
      const data = await API.models();
      state.models = data.models;
    } catch (err) {
      state.models = [];
      toast(err.message, 'error');
    }
    renderModelDropdown();
    renderModelTable();
    renderDefaultModelSelect();
  }

  function renderModelDropdown() {
    el.modelDropdown.innerHTML = '';
    if (!state.models.length) {
      el.modelDropdown.innerHTML = '<div class="dropdown-empty">Nenhum modelo instalado.<br>Use Configurações → Modelos.</div>';
      return;
    }
    const current = state.chat?.model || state.settings.default_model;
    for (const model of state.models) {
      const item = document.createElement('button');
      item.className = `dropdown-item${model.name === current ? ' selected' : ''}`;
      item.innerHTML = `${Markdown.escapeHtml(model.name)}<small>${[model.parameter_size, model.quantization, formatBytes(model.size)].filter(Boolean).join(' · ')}</small>`;
      item.addEventListener('click', async () => {
        el.modelDropdown.hidden = true;
        if (state.chat) {
          await API.updateChat(state.chat.id, { model: model.name });
          state.chat.model = model.name;
        } else {
          state.settings.default_model = model.name;
          await API.saveSettings({ default_model: model.name });
        }
        updateModelLabel();
        renderModelDropdown();
      });
      el.modelDropdown.appendChild(item);
    }
  }

  el.modelBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    el.modelDropdown.hidden = !el.modelDropdown.hidden;
    el.modelBtn.setAttribute('aria-expanded', String(!el.modelDropdown.hidden));
  });
  document.addEventListener('click', (event) => {
    if (!el.modelDropdown.hidden && !event.target.closest('#modelSelectWrap')) el.modelDropdown.hidden = true;
  });

  // ==================================================================
  // Configurações
  // ==================================================================
  const SETTING_FIELDS = {
    setSystemPrompt:  ['system_prompt', 'value'],
    setTheme:         ['theme', 'value'],
    setSendOnEnter:   ['send_on_enter', 'checked'],
    setAutoTitle:     ['auto_title', 'checked'],
    setHistoryLimit:  ['history_limit', 'number'],
    setDefaultModel:  ['default_model', 'value'],
  };
  const OPTION_FIELDS = {
    setTemperature:   ['temperature', 'float'],
    setTopP:          ['top_p', 'float'],
    setTopK:          ['top_k', 'number'],
    setNumPredict:    ['num_predict', 'number'],
    setNumCtx:        ['num_ctx', 'number'],
    setRepeatPenalty: ['repeat_penalty', 'float'],
  };

  const DEFAULT_OPTIONS = { temperature: 0.7, top_p: 0.9, top_k: 40, num_predict: -1, num_ctx: 4096, repeat_penalty: 1.1 };

  function fillSettingsForm() {
    const s = state.settings;
    const options = { ...DEFAULT_OPTIONS, ...(s.options || {}) };

    $('#setSystemPrompt').value = s.system_prompt ?? '';
    $('#setTheme').value = s.theme ?? 'dark';
    $('#setSendOnEnter').checked = s.send_on_enter !== false;
    $('#setAutoTitle').checked = s.auto_title !== false;
    $('#setHistoryLimit').value = s.history_limit ?? 40;

    $('#setTemperature').value = options.temperature;
    $('#setTopP').value = options.top_p;
    $('#setTopK').value = options.top_k;
    $('#setNumPredict').value = options.num_predict;
    $('#setNumCtx').value = options.num_ctx;
    $('#setRepeatPenalty').value = options.repeat_penalty;
    $('#outTemp').textContent = options.temperature;
    $('#outTopP').textContent = options.top_p;

    renderDefaultModelSelect();
  }

  function renderDefaultModelSelect() {
    const select = $('#setDefaultModel');
    if (!select) return;
    select.innerHTML = '';
    const names = state.models.length ? state.models.map((m) => m.name) : [state.settings.default_model].filter(Boolean);
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    select.value = state.settings.default_model ?? names[0] ?? '';
  }

  async function persistSettings() {
    const values = { options: { ...DEFAULT_OPTIONS, ...(state.settings.options || {}) } };

    for (const [id, [key, kind]] of Object.entries(SETTING_FIELDS)) {
      const node = $(`#${id}`);
      if (!node) continue;
      values[key] = kind === 'checked' ? node.checked : kind === 'number' ? Number(node.value) : node.value;
    }
    for (const [id, [key, kind]] of Object.entries(OPTION_FIELDS)) {
      const node = $(`#${id}`);
      if (!node || node.value === '') continue;
      values.options[key] = kind === 'float' ? parseFloat(node.value) : parseInt(node.value, 10);
    }

    try {
      state.settings = await API.saveSettings(values);
      applyTheme(state.settings.theme);
      updateModelLabel();
      renderModelDropdown();
    } catch (err) {
      toast(`Falha ao salvar: ${err.message}`, 'error');
    }
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistSettings, 350);
  }

  $('.modal-body')?.addEventListener('input', (event) => {
    if (event.target.id === 'setTemperature') $('#outTemp').textContent = event.target.value;
    if (event.target.id === 'setTopP') $('#outTopP').textContent = event.target.value;
    if (event.target.closest('#pullInput')) return;
    if (event.target.matches('input, select, textarea')) scheduleSave();
  });

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
      if (tab.dataset.tab === 'data') loadStats();
      if (tab.dataset.tab === 'models') loadModels();
    });
  });

  function openSettings() {
    fillSettingsForm();
    loadStats();
    el.settingsModal.hidden = false;
  }
  function closeSettings() {
    el.settingsModal.hidden = true;
    persistSettings();
  }

  el.settingsBtn.addEventListener('click', openSettings);
  el.closeSettings.addEventListener('click', closeSettings);
  el.settingsModal.addEventListener('click', (event) => {
    if (event.target === el.settingsModal) closeSettings();
  });

  async function loadStats() {
    try {
      const health = await API.health();
      const db = health.database;
      el.statGrid.innerHTML = `
        <div class="stat-card"><div class="k">Conversas</div><div class="v">${db.chats}</div></div>
        <div class="stat-card"><div class="k">Mensagens</div><div class="v">${db.messages}</div></div>
        <div class="stat-card"><div class="k">Tamanho do banco</div><div class="v">${formatBytes(db.db_bytes)}</div></div>
        <div class="stat-card"><div class="k">Ollama</div><div class="v">${health.ollama.online ? 'online' : 'offline'}</div></div>`;
    } catch (err) {
      el.statGrid.innerHTML = `<p class="empty-note">${err.message}</p>`;
    }
  }

  $('#wipeBtn').addEventListener('click', async () => {
    if (!confirm('Apagar TODAS as conversas? Essa ação não pode ser desfeita.')) return;
    await API.wipeChats();
    state.chat = null;
    showWelcome();
    await loadChats();
    await loadStats();
    toast('Todas as conversas foram apagadas', 'success');
  });

  // ------------------------------------------------ modelos instalados
  function renderModelTable() {
    if (!el.modelTable) return;
    if (!state.models.length) {
      el.modelTable.innerHTML = '<p class="empty-note">Nenhum modelo instalado.</p>';
      return;
    }
    el.modelTable.innerHTML = '';
    for (const model of state.models) {
      const row = document.createElement('div');
      row.className = 'model-row';
      row.innerHTML = `
        <div class="name">
          <strong>${Markdown.escapeHtml(model.name)}</strong>
          <small>${[model.parameter_size, model.quantization, formatBytes(model.size)].filter(Boolean).join(' · ')}</small>
        </div>
        <button class="btn" data-use>Usar</button>
        <button class="btn danger" data-remove>Remover</button>`;

      $('[data-use]', row).addEventListener('click', async () => {
        state.settings.default_model = model.name;
        await API.saveSettings({ default_model: model.name });
        if (state.chat) {
          await API.updateChat(state.chat.id, { model: model.name });
          state.chat.model = model.name;
        }
        updateModelLabel();
        renderModelDropdown();
        renderDefaultModelSelect();
        toast(`Modelo ativo: ${model.name}`, 'success');
      });

      $('[data-remove]', row).addEventListener('click', async () => {
        if (!confirm(`Remover o modelo ${model.name} do disco?`)) return;
        try {
          await API.deleteModel(model.name);
          toast('Modelo removido', 'success');
          await loadModels();
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      el.modelTable.appendChild(row);
    }
  }

  $('#pullBtn').addEventListener('click', async () => {
    const name = $('#pullInput').value.trim();
    if (!name) return;
    const progress = $('#pullProgress');
    const fill = $('#pullBarFill');
    const status = $('#pullStatus');
    progress.hidden = false;
    $('#pullBtn').disabled = true;
    status.textContent = 'iniciando…';

    try {
      await API.pullModel(name, {
        message: (data) => {
          if (data.total) {
            const pct = Math.round(((data.completed || 0) / data.total) * 100);
            fill.style.width = `${pct}%`;
            status.textContent = `${data.status} — ${pct}% (${formatBytes(data.completed)} / ${formatBytes(data.total)})`;
          } else {
            status.textContent = data.status || '';
          }
        },
        error: (data) => toast(data.error, 'error'),
      });
      fill.style.width = '100%';
      status.textContent = 'concluído';
      toast(`Modelo ${name} pronto para uso`, 'success');
      await loadModels();
    } catch (err) {
      toast(`Falha no download: ${err.message}`, 'error');
    } finally {
      $('#pullBtn').disabled = false;
      setTimeout(() => { progress.hidden = true; fill.style.width = '0'; }, 2500);
    }
  });

  // ==================================================================
  // Busca, navegação, atalhos
  // ==================================================================
  let searchTimer = null;
  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadChats(el.searchInput.value.trim()), 220);
  });

  el.collapseBtn.addEventListener('click', () => el.app.classList.toggle('collapsed'));
  el.menuBtn.addEventListener('click', () => el.app.classList.toggle('mobile-open'));
  el.scrim.addEventListener('click', () => el.app.classList.remove('mobile-open'));

  el.themeBtn.addEventListener('click', async () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    state.settings.theme = next;
    await API.saveSettings({ theme: next });
  });

  document.addEventListener('keydown', (event) => {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key === 'k') { event.preventDefault(); el.searchInput.focus(); }
    if (meta && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); el.newChatBtn.click(); }
    if (meta && event.key === '/') { event.preventDefault(); el.input.focus(); }
    if (event.key === 'Escape') {
      if (!el.settingsModal.hidden) closeSettings();
      else if (state.streaming) el.stopBtn.click();
      else if (!el.modelDropdown.hidden) el.modelDropdown.hidden = true;
    }
  });

  // ==================================================================
  // Saúde do Ollama
  // ==================================================================
  async function pollHealth() {
    try {
      const health = await API.health();
      const online = health.ollama.online;
      el.statusDot.className = `dot ${online ? 'online' : 'offline'}`;
      el.statusText.textContent = online
        ? `Ollama ${health.ollama.version ?? ''}`.trim()
        : 'Ollama offline';
      el.statusText.title = online ? health.ollama.host : (health.ollama.error || '');
    } catch {
      el.statusDot.className = 'dot offline';
      el.statusText.textContent = 'API offline';
    }
  }

  // ==================================================================
  // Início
  // ==================================================================
  async function init() {
    applyTheme(localStorage.getItem('claunde-theme') || 'dark');
    autoResize();

    try {
      state.settings = await API.getSettings();
      applyTheme(state.settings.theme || 'dark');
    } catch {
      state.settings = { options: DEFAULT_OPTIONS };
      toast('Back-end indisponível. Verifique se o servidor está rodando.', 'error');
    }

    el.composerHint.textContent = state.settings.send_on_enter === false
      ? 'Ctrl+Enter envia'
      : 'Enter envia · Shift+Enter quebra linha';

    await Promise.all([loadChats(), loadModels()]);
    updateModelLabel();
    pollHealth();
    setInterval(pollHealth, 20000);
    el.input.focus();
  }

  init();
})();
