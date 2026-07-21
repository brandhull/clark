(() => {
  const $ = (sel) => document.querySelector(sel);
  const PIN_KEY = 'clark_pin';

  const state = {
    pin: localStorage.getItem(PIN_KEY) || '',
    books: [],
    highlights: [],
    activeTab: 'shelf',
    searchResults: [],
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'X-Pin': state.pin,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function tryPin(pin) {
    const res = await fetch('/api/ping', { headers: { 'X-Pin': pin } });
    return res.ok;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  // ---------- Auth ----------

  function showApp() {
    $('#pin-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
  }

  function showPinScreen() {
    $('#app').classList.add('hidden');
    $('#pin-screen').classList.remove('hidden');
  }

  function initPinGate() {
    const form = $('#pin-form');
    const input = $('#pin-input');
    const error = $('#pin-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = input.value.trim();
      if (!pin) return;
      const ok = await tryPin(pin);
      if (!ok) {
        error.textContent = 'Incorrect PIN';
        return;
      }
      error.textContent = '';
      state.pin = pin;
      localStorage.setItem(PIN_KEY, pin);
      showApp();
      start();
    });

    if (state.pin) {
      tryPin(state.pin).then((ok) => {
        if (ok) {
          showApp();
          start();
        } else {
          localStorage.removeItem(PIN_KEY);
          state.pin = '';
          showPinScreen();
        }
      });
    } else {
      showPinScreen();
    }
  }

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        state.activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
        if (tab === 'highlights') {
          populateHighlightsBookFilter();
          renderHighlightsList();
        }
      });
    });
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  }

  // ---------- Shelf ----------

  async function loadBooks() {
    try {
      state.books = await api('/api/books');
    } catch (e) {
      state.books = [];
    }
    renderShelf();
    renderSearchResults(); // refresh action buttons against the up-to-date shelf
  }

  function findBook(gutenbergId) {
    return state.books.find((b) => b.gutenberg_id === gutenbergId);
  }

  function bookStatusLabel(book) {
    if (book.status === 'reading') return 'Reading';
    if (book.status === 'finished') return 'Finished';
    return 'On shelf';
  }

  function renderShelf() {
    const reading = state.books.filter((b) => b.status === 'reading');
    const others = state.books.filter((b) => b.status !== 'reading');

    const readingSection = $('#currently-reading-section');
    const readingList = $('#currently-reading-list');
    readingList.innerHTML = '';
    if (reading.length === 0) {
      readingSection.classList.add('hidden');
    } else {
      readingSection.classList.remove('hidden');
      reading.forEach((book) => readingList.appendChild(shelfCard(book)));
    }

    const shelfList = $('#shelf-list');
    shelfList.innerHTML = '';
    if (others.length === 0) {
      shelfList.innerHTML = '<div class="empty-state">Search above to add your first book.</div>';
    } else {
      others.forEach((book) => shelfList.appendChild(shelfCard(book)));
    }
  }

  function shelfCard(book) {
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header';

    const titleBlock = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = book.title;
    const author = document.createElement('div');
    author.className = 'card-author';
    author.textContent = book.author;
    titleBlock.appendChild(title);
    titleBlock.appendChild(author);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.textContent = bookStatusLabel(book);

    header.appendChild(titleBlock);
    header.appendChild(meta);
    card.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (book.status === 'available') {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'Start Reading';
      startBtn.addEventListener('click', () => startReading(book));
      actions.appendChild(startBtn);
    } else if (book.status === 'reading') {
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => openReader(book));
      actions.appendChild(openBtn);

      const finishBtn = document.createElement('button');
      finishBtn.textContent = 'Mark Finished';
      finishBtn.addEventListener('click', () => finishBook(book));
      actions.appendChild(finishBtn);
    }

    if (actions.children.length > 0) card.appendChild(actions);
    return card;
  }

  async function addToShelf(result) {
    if (findBook(result.gutenberg_id)) return; // already on shelf, no-op
    try {
      const row = await api('/api/books', {
        method: 'POST',
        body: JSON.stringify({
          title: result.title,
          author: result.author,
          gutenberg_id: result.gutenberg_id,
          status: 'available',
        }),
      });
      state.books.push(row);
      renderShelf();
      renderSearchResults();
    } catch (e) {
      alert('Could not add to shelf — check connection.');
    }
  }

  async function startReading(book) {
    try {
      const row = await api(`/api/books/${book.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'reading', date_started: todayISO() }),
      });
      Object.assign(book, row);
      renderShelf();
    } catch (e) {
      alert('Could not update status — check connection.');
    }
  }

  async function finishBook(book) {
    try {
      const row = await api(`/api/books/${book.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'finished', date_finished: todayISO() }),
      });
      Object.assign(book, row);
      renderShelf();
    } catch (e) {
      alert('Could not update status — check connection.');
    }
  }

  // ---------- Reader ----------

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Blank-line-delimited chunks — the anchor unit for plaintext books.
  function extractTextBlocks(raw) {
    return raw
      .split(/\n\s*\n+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => ({ lines: chunk.split('\n').map((l) => l.trimEnd()) }));
  }

  function renderTextBlockHtml(lines, mode) {
    if (mode === 'preserve') return lines.map(escapeHtml).join('<br>');
    return escapeHtml(lines.join(' '));
  }

  // Gutenberg wraps whole chapters in wrapper <div class="chapter"> elements,
  // so only walking body's direct children would give chapter-sized blocks.
  // Instead, find leaf content elements anywhere in the tree and keep only
  // the outermost match in each nested chain (so a <p> inside a matched
  // <blockquote> isn't double-counted as its own block).
  const HTML_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, li';

  function extractHtmlBlocks(doc) {
    const candidates = Array.from(doc.body.querySelectorAll(HTML_BLOCK_SELECTOR));
    return candidates
      .filter((el) => {
        if (el.closest('.pg-boilerplate')) return false; // license header/footer
        if (!el.textContent.trim()) return false; // image-only decorative elements
        let parent = el.parentElement;
        while (parent && parent !== doc.body) {
          if (parent.matches(HTML_BLOCK_SELECTOR)) return false; // keep only outermost
          parent = parent.parentElement;
        }
        return true;
      })
      .map((el) => ({ html: el.outerHTML, text: el.textContent }));
  }

  function parseBlockOverrides(book) {
    if (!book.block_overrides) return {};
    try {
      return JSON.parse(book.block_overrides);
    } catch (e) {
      return {};
    }
  }

  function blockRenderMode(book, index) {
    const overrides = parseBlockOverrides(book);
    return overrides[index] || book.render_mode || 'reflow';
  }

  function buildBlocks(content) {
    if (content.source_type === 'html') {
      const doc = new DOMParser().parseFromString(content.raw, 'text/html');
      return extractHtmlBlocks(doc).map((b, i) => ({ index: i, kind: 'html', ...b }));
    }
    return extractTextBlocks(content.raw).map((b, i) => ({
      index: i,
      kind: 'text',
      lines: b.lines,
      text: b.lines.join(' '),
    }));
  }

  // ---------- Highlights ----------

  async function loadHighlights() {
    try {
      state.highlights = await api('/api/highlights');
    } catch (e) {
      state.highlights = [];
    }
  }

  function findHighlight(bookId, blockIndex) {
    return state.highlights.find((h) => h.book[0] === bookId && h.block_index === blockIndex);
  }

  function blockPlainText(block) {
    return block.text.trim();
  }

  async function onBlockClick(book, block) {
    if (findHighlight(book.id, block.index)) return; // already highlighted — use the panel to edit/remove
    try {
      const row = await api('/api/highlights', {
        method: 'POST',
        body: JSON.stringify({
          book: [book.id],
          block_index: block.index,
          passage_text: blockPlainText(block),
          comment: '',
        }),
      });
      state.highlights.push(row);
      const wrapper = document.querySelector(`#reader-content .block[data-block-index="${block.index}"]`);
      if (wrapper) {
        wrapper.classList.add('highlighted');
        wrapper.insertAdjacentElement('afterend', highlightPanel(row));
      }
    } catch (e) {
      alert('Could not save highlight — check connection.');
    }
  }

  async function removeHighlight(highlight) {
    try {
      await api(`/api/highlights/${highlight.id}`, { method: 'DELETE' });
    } catch (e) {
      alert('Could not remove highlight — check connection.');
      return;
    }
    state.highlights = state.highlights.filter((h) => h.id !== highlight.id);
    const wrapper = document.querySelector(`#reader-content .block[data-block-index="${highlight.block_index}"]`);
    if (wrapper) wrapper.classList.remove('highlighted');
    const panel = document.querySelector(`.highlight-panel[data-highlight-id="${highlight.id}"]`);
    if (panel) panel.remove();
    if (state.activeTab === 'highlights') renderHighlightsList();
  }

  async function saveHighlightComment(highlight, value) {
    highlight.comment = value;
    try {
      const row = await api(`/api/highlights/${highlight.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ comment: value }),
      });
      Object.assign(highlight, row);
    } catch (e) {
      alert('Could not save comment — check connection.');
    }
  }

  function highlightPanel(highlight) {
    const panel = document.createElement('div');
    panel.className = 'highlight-panel';
    panel.dataset.highlightId = highlight.id;

    const commentBox = document.createElement('textarea');
    commentBox.className = 'comment-box';
    commentBox.placeholder = 'Add a note...';
    commentBox.value = highlight.comment || '';
    let debounceTimer;
    commentBox.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => saveHighlightComment(highlight, commentBox.value), 800);
    });
    panel.appendChild(commentBox);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'highlight-remove-btn';
    removeBtn.textContent = 'Remove highlight';
    removeBtn.addEventListener('click', () => removeHighlight(highlight));
    panel.appendChild(removeBtn);

    return panel;
  }

  function renderHighlightsList() {
    const container = $('#highlights-list');
    const searchTerm = ($('#highlights-search-input').value || '').trim().toLowerCase();
    const bookFilter = $('#highlights-book-filter').value;

    let highlights = state.highlights;
    if (bookFilter) highlights = highlights.filter((h) => String(h.book[0]) === bookFilter);
    if (searchTerm) {
      highlights = highlights.filter(
        (h) =>
          h.passage_text.toLowerCase().includes(searchTerm) || (h.comment || '').toLowerCase().includes(searchTerm)
      );
    }

    container.innerHTML = '';
    if (highlights.length === 0) {
      container.innerHTML = '<div class="empty-state">No highlights yet — tap a paragraph while reading to save one.</div>';
      return;
    }

    const byBook = new Map();
    highlights.forEach((h) => {
      const bookId = h.book[0];
      if (!byBook.has(bookId)) byBook.set(bookId, []);
      byBook.get(bookId).push(h);
    });

    byBook.forEach((list, bookId) => {
      const book = state.books.find((b) => b.id === bookId);
      const group = document.createElement('div');
      group.className = 'book-group';
      const heading = document.createElement('h2');
      heading.textContent = book ? book.title : 'Unknown book';
      group.appendChild(heading);
      list.forEach((h) => group.appendChild(highlightCard(h, book)));
      container.appendChild(group);
    });
  }

  function highlightCard(highlight, book) {
    const card = document.createElement('div');
    card.className = 'card';

    const passage = document.createElement('div');
    passage.className = 'card-text';
    passage.textContent = highlight.passage_text;
    card.appendChild(passage);

    if (highlight.comment) {
      const comment = document.createElement('div');
      comment.className = 'card-meta';
      comment.textContent = highlight.comment;
      card.appendChild(comment);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const jumpBtn = document.createElement('button');
    jumpBtn.textContent = 'Go to passage';
    jumpBtn.disabled = !book;
    jumpBtn.addEventListener('click', () => jumpToHighlight(highlight, book));
    actions.appendChild(jumpBtn);
    card.appendChild(actions);

    return card;
  }

  async function jumpToHighlight(highlight, book) {
    if (!book) return;
    if (!state.currentBook || state.currentBook.id !== book.id) {
      await openReader(book, { skipResume: true });
    } else {
      switchTab('reading');
    }
    scrollToBlock(highlight.block_index, { block: 'center' });
    setTimeout(() => {
      const target = document.querySelector(`#reader-content .block[data-block-index="${highlight.block_index}"]`);
      if (!target) return;
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1200);
    }, 0);
  }

  function populateHighlightsBookFilter() {
    const select = $('#highlights-book-filter');
    const current = select.value;
    select.innerHTML = '<option value="">All books</option>';
    const bookIdsWithHighlights = new Set(state.highlights.map((h) => h.book[0]));
    state.books
      .filter((b) => bookIdsWithHighlights.has(b.id))
      .forEach((b) => {
        const opt = document.createElement('option');
        opt.value = String(b.id);
        opt.textContent = b.title;
        select.appendChild(opt);
      });
    select.value = current;
  }

  function initHighlightsTab() {
    $('#highlights-search-input').addEventListener('input', renderHighlightsList);
    $('#highlights-book-filter').addEventListener('change', renderHighlightsList);
  }

  function renderBlockText(wrapper, block, book) {
    const textEl = wrapper.querySelector('.block-text');
    if (block.kind === 'html') {
      // Illustrated editions embed <img> with paths relative to gutenberg.org,
      // which resolve against *our* origin once inserted here — forbid them
      // outright rather than flooding the dev server with broken requests.
      textEl.innerHTML = DOMPurify.sanitize(block.html, { FORBID_TAGS: ['img'] });
    } else {
      const mode = blockRenderMode(book, block.index);
      textEl.innerHTML = renderTextBlockHtml(block.lines, mode);
    }
  }

  function renderReaderContent(content, book) {
    const container = $('#reader-content');
    container.innerHTML = '';
    const blocks = buildBlocks(content);
    state.currentBlocks = blocks;

    blocks.forEach((block) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'block';
      wrapper.dataset.blockIndex = block.index;

      const textEl = document.createElement('div');
      textEl.className = 'block-text';
      wrapper.appendChild(textEl);
      renderBlockText(wrapper, block, book);

      wrapper.addEventListener('click', (e) => {
        if (e.target.closest('a')) return; // don't hijack in-text links
        onBlockClick(book, block);
      });

      // Per-block render-mode override — text books only (HTML sources never
      // need it, see M4). A separate small control, not the block click
      // itself, since that's already claimed by highlight creation.
      if (block.kind === 'text') {
        const overrideBtn = document.createElement('button');
        overrideBtn.className = 'block-override-btn';
        overrideBtn.title = 'Fix this paragraph\'s line breaks independently of the book default';
        overrideBtn.textContent = '¶';
        overrideBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleBlockOverride(book, block, wrapper);
        });
        wrapper.appendChild(overrideBtn);
      }

      container.appendChild(wrapper);

      const existing = findHighlight(book.id, block.index);
      if (existing) {
        wrapper.classList.add('highlighted');
        container.appendChild(highlightPanel(existing));
      }
    });
  }

  async function toggleBlockOverride(book, block, wrapper) {
    const overrides = parseBlockOverrides(book);
    const defaultMode = book.render_mode || 'reflow';
    if (overrides[block.index]) {
      delete overrides[block.index]; // already overridden — revert to book default
    } else {
      overrides[block.index] = defaultMode === 'reflow' ? 'preserve' : 'reflow';
    }
    try {
      const row = await api(`/api/books/${book.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ block_overrides: JSON.stringify(overrides) }),
      });
      Object.assign(book, row);
    } catch (e) {
      alert('Could not save this override — check connection.');
      return;
    }
    renderBlockText(wrapper, block, book);
  }

  function updateRenderModeControl(book, content) {
    const control = $('#render-mode-control');
    const btn = $('#render-mode-btn');
    if (content.source_type !== 'text') {
      control.classList.add('hidden');
      return;
    }
    control.classList.remove('hidden');
    const mode = book.render_mode || 'reflow';
    btn.textContent = mode === 'reflow' ? 'Flowing prose (tap for verse)' : 'Verse lines (tap for prose)';
    btn.onclick = async () => {
      const newMode = mode === 'reflow' ? 'preserve' : 'reflow';
      try {
        const row = await api(`/api/books/${book.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ render_mode: newMode }),
        });
        Object.assign(book, row);
        renderReaderContent(content, book);
        updateRenderModeControl(book, content);
      } catch (e) {
        alert('Could not save render mode — check connection.');
      }
    };
  }

  async function openReader(book, { skipResume = false } = {}) {
    switchTab('reading');
    $('#reader-empty').classList.add('hidden');
    $('#reader-view').classList.remove('hidden');
    $('#reader-title').textContent = book.title;
    $('#reader-author').textContent = book.author;
    $('#reader-content').innerHTML = '<div class="empty-state">Loading…</div>';
    $('#render-mode-control').classList.add('hidden');

    let content;
    try {
      content = await api(`/api/books/${book.gutenberg_id}/content`);
    } catch (e) {
      $('#reader-content').innerHTML = '<div class="empty-state">Could not load this book — check connection.</div>';
      return;
    }

    if (!book.source_type) {
      try {
        const row = await api(`/api/books/${book.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ source_type: content.source_type }),
        });
        Object.assign(book, row);
      } catch (e) {
        // non-fatal — proceed with rendering using the fetched content anyway
      }
    }

    state.currentBook = book;
    state.currentContent = content;
    renderReaderContent(content, book);
    updateRenderModeControl(book, content);
    // Skipped when jumping straight to a specific highlight — scrolling here
    // and then scrolling again to the highlight's block in the same tick
    // triggers the browser's scroll-anchoring to snap back to this position.
    if (!skipResume) resumePosition(book);
    else lastSavedBlockIndex = book.last_block_index ?? null;
  }

  // ---------- Position tracking ----------

  let lastSavedBlockIndex = null;
  let scrollDebounceTimer;

  function scrollToBlock(index, opts) {
    // Deferred a tick so layout has settled before scrolling — calling
    // scrollIntoView synchronously right after inserting ~thousands of fresh
    // block elements is exactly what triggers the scroll-anchoring snap-back
    // described above. setTimeout rather than requestAnimationFrame — rAF is
    // spec'd to pause in backgrounded/non-visible tabs, which a scroll this
    // user just asked for shouldn't depend on.
    setTimeout(() => {
      const target = document.querySelector(`#reader-content .block[data-block-index="${index}"]`);
      if (target) target.scrollIntoView(opts);
    }, 0);
  }

  function resumePosition(book) {
    lastSavedBlockIndex = book.last_block_index ?? null;
    if (book.last_block_index === null || book.last_block_index === undefined) return;
    scrollToBlock(book.last_block_index);
  }

  // The block whose top edge is at or just above the reading viewport's top
  // edge — i.e. whatever's currently at the top of the screen. Blocks are in
  // document order, so this can stop at the first one that's still below the
  // threshold rather than scanning the whole book every time.
  function currentTopBlockIndex() {
    const topbar = document.querySelector('.topbar');
    const threshold = (topbar ? topbar.getBoundingClientRect().height : 0) + 20;
    const blocks = document.querySelectorAll('#reader-content .block');
    let current = null;
    for (const el of blocks) {
      if (el.getBoundingClientRect().top <= threshold) {
        current = el;
      } else {
        break;
      }
    }
    return current ? Number(current.dataset.blockIndex) : 0;
  }

  async function savePosition(index) {
    if (!state.currentBook || index === lastSavedBlockIndex) return;
    lastSavedBlockIndex = index;
    try {
      const row = await api(`/api/books/${state.currentBook.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_block_index: index }),
      });
      Object.assign(state.currentBook, row);
    } catch (e) {
      // non-fatal — next scroll-stop or backgrounding will retry with the latest position
    }
  }

  function isReaderActive() {
    return state.activeTab === 'reading' && !!state.currentBook;
  }

  function initPositionTracking() {
    window.addEventListener('scroll', () => {
      if (!isReaderActive()) return;
      clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = setTimeout(() => savePosition(currentTopBlockIndex()), 800);
    });

    // iOS Safari doesn't reliably fire beforeunload/unload when a tab or PWA
    // is backgrounded — visibilitychange is what actually fires, so flush
    // immediately here rather than waiting on the scroll-stop debounce.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && isReaderActive()) {
        clearTimeout(scrollDebounceTimer);
        savePosition(currentTopBlockIndex());
      }
    });
  }

  function initReader() {
    $('#reader-back-btn').addEventListener('click', () => switchTab('shelf'));
  }

  // ---------- Search ----------

  function renderSearchResults() {
    const container = $('#search-results');
    container.innerHTML = '';
    state.searchResults.forEach((result) => {
      const existing = findBook(result.gutenberg_id);
      container.appendChild(searchResultCard(result, existing));
    });
  }

  function searchResultCard(result, existing) {
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header';

    const titleBlock = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = result.title;
    const author = document.createElement('div');
    author.className = 'card-author';
    author.textContent = result.author;
    titleBlock.appendChild(title);
    titleBlock.appendChild(author);

    const badge = document.createElement('span');
    badge.className = `format-badge ${result.format}`;
    badge.textContent = result.format === 'html' ? 'HTML' : 'text-only';

    header.appendChild(titleBlock);
    header.appendChild(badge);
    card.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const btn = document.createElement('button');
    if (existing) {
      btn.textContent = bookStatusLabel(existing);
      btn.disabled = true;
    } else {
      btn.textContent = 'Add to Shelf';
      btn.addEventListener('click', () => addToShelf(result));
    }
    actions.appendChild(btn);
    card.appendChild(actions);

    return card;
  }

  function initSearch() {
    const input = $('#search-input');
    let debounceTimer;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (!q) {
        state.searchResults = [];
        renderSearchResults();
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
          state.searchResults = data.results;
          renderSearchResults();
        } catch (e) {
          // leave previous results in place on transient failure
        }
      }, 400);
    });
  }

  // ---------- Boot ----------

  async function start() {
    initSearch();
    initReader();
    initPositionTracking();
    initHighlightsTab();
    await Promise.all([loadBooks(), loadHighlights()]);
    populateHighlightsBookFilter();
  }

  initPinGate();
  initTabs();
})();
