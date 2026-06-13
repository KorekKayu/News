/**
 * TeleMirror News — Frontend Application
 * Professional news portal with real-time SSE updates.
 */

const API_BASE = window.location.origin;
const STORAGE_KEY = 'telemirror_channels';
const DEFAULT_CHANNELS = ['durov', 'telegram'];
const REFRESH_INTERVAL = 5 * 60 * 1000;
const POSTS_PER_PAGE = 12;

// ── State ────────────────────────────────────
let channels = loadChannels();
let allPosts = [];
let channelInfoMap = {};
let searchQuery = '';
let activeCategory = 'all';
let visibleCount = POSTS_PER_PAGE;
let refreshTimer = null;
let eventSource = null;
let pendingNewPosts = [];
let newPostIds = new Set();

// ── DOM ──────────────────────────────────────
const $ = id => document.getElementById(id);
const $grid = $('newsGrid');
const $count = $('postCount');
const $search = $('searchInput');
const $empty = $('emptyState');
const $modal = $('modalOverlay');
const $channelInput = $('channelInput');
const $channelList = $('channelList');
const $status = $('statusBar');
const $banner = $('newPostsBanner');
const $bannerText = $('bannerText');
const $sseIndicator = $('sseIndicator');
const $sseStatus = $('sseStatus');
const $readerOverlay = $('readerOverlay');
const $readerContent = $('readerContent');
const $heroSection = $('heroSection');
const $heroCard = $('heroCard');
const $heroSidebar = $('heroSidebar');
const $tickerBar = $('tickerBar');
const $tickerText = $('tickerText');
const $loadMoreWrap = $('loadMoreWrap');

// ── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTopbarDate();
  setupEvents();
  if (channels.length === 0) {
    channels = [...DEFAULT_CHANNELS];
    saveChannels();
  }
  fetchAllChannels();
  startAutoRefresh();
});

function setTopbarDate() {
  const d = new Date();
  $('topbarDate').textContent = d.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ── Events ───────────────────────────────────
function setupEvents() {
  $('addChannelBtn').addEventListener('click', openModal);
  $('modalCancel').addEventListener('click', closeModal);
  $('modalAdd').addEventListener('click', addChannel);
  $('loadMoreBtn').addEventListener('click', loadMore);

  $modal.addEventListener('click', e => { if (e.target === $modal) closeModal(); });
  $channelInput.addEventListener('keydown', e => { if (e.key === 'Enter') addChannel(); });
  $search.addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase().trim();
    visibleCount = POSTS_PER_PAGE;
    renderAll();
  });
  $banner.addEventListener('click', injectPendingPosts);
  $('readerClose').addEventListener('click', closeReader);
  $readerOverlay.addEventListener('click', e => { if (e.target === $readerOverlay) closeReader(); });

  // Nav category links
  document.querySelectorAll('.nav-link[data-cat]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      activeCategory = link.dataset.cat;
      visibleCount = POSTS_PER_PAGE;
      renderAll();
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($readerOverlay.classList.contains('active')) closeReader();
      else if ($modal.classList.contains('active')) closeModal();
    }
  });
}

// ── Channel Management ───────────────────────
function loadChannels() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveChannels() { localStorage.setItem(STORAGE_KEY, JSON.stringify(channels)); }

function openModal() {
  $modal.classList.add('active');
  $channelInput.value = '';
  renderChannelList();
  setTimeout(() => $channelInput.focus(), 200);
}

function closeModal() { $modal.classList.remove('active'); }

function renderChannelList() {
  if (!channels.length) {
    $channelList.innerHTML = '<div style="font-size:12px;color:#999;padding:8px 0">Belum ada sumber.</div>';
    return;
  }
  $channelList.innerHTML = channels.map(ch =>
    `<div class="channel-list-item"><span>@${esc(ch)}</span><button class="ch-remove" data-ch="${ch}">✕</button></div>`
  ).join('');
  $channelList.querySelectorAll('.ch-remove').forEach(b =>
    b.addEventListener('click', () => { removeChannel(b.dataset.ch); renderChannelList(); })
  );
}

function addChannel() {
  const name = $channelInput.value.trim().replace(/^@/, '').toLowerCase();
  if (!name) return;
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(name)) {
    toast('❌ Username tidak valid', 'error'); return;
  }
  if (channels.includes(name)) { toast(`⚠️ Sudah ada`, 'error'); return; }
  channels.push(name);
  saveChannels();
  $channelInput.value = '';
  renderChannelList();
  fetchChannel(name);
  connectSSE();
  toast(`✅ Sumber ditambahkan`, 'success');
}

function removeChannel(name) {
  channels = channels.filter(c => c !== name);
  saveChannels();
  allPosts = allPosts.filter(p => p._channel !== name);
  delete channelInfoMap[name];
  renderAll();
  connectSSE();
}

// ── Fetch ────────────────────────────────────
async function fetchAllChannels() {
  if (!channels.length) { $empty.style.display = ''; $grid.innerHTML = ''; return; }
  $empty.style.display = 'none';
  showSkeletons();
  try {
    const res = await fetch(`${API_BASE}/api/multi?channels=${channels.join(',')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    channelInfoMap = data.channels || {};
    allPosts = (data.posts || []).map(p => ({
      ...p,
      _channel: p.channelInfo?.username || (p.id || '').split('/')[0],
    }));
    renderAll();
    toast(`✅ ${allPosts.length} berita dimuat`, 'success');
    connectSSE();
  } catch (err) {
    toast(`❌ Gagal memuat: ${err.message}`, 'error');
    $grid.innerHTML = ''; $empty.style.display = '';
  }
}

async function fetchChannel(name) {
  try {
    const res = await fetch(`${API_BASE}/api/posts?channel=${name}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.channel) channelInfoMap[name] = data.channel;
    const posts = (data.posts || []).map(p => ({ ...p, _channel: name, channelInfo: data.channel }));
    allPosts = allPosts.filter(p => p._channel !== name);
    allPosts.push(...posts);
    allPosts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    renderAll();
  } catch (err) { toast(`❌ ${err.message}`, 'error'); }
}

// ── SSE ──────────────────────────────────────
function connectSSE() {
  if (eventSource) { eventSource.close(); eventSource = null; }
  if (!channels.length) { setSse('disconnected', 'Offline'); return; }
  eventSource = new EventSource(`${API_BASE}/api/stream?channels=${channels.join(',')}`);
  setSse('reconnecting', 'Menghubungkan...');
  eventSource.onopen = () => setSse('connected', 'Live');
  eventSource.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'connected') setSse('connected', 'Live');
      if (d.type === 'new_posts') onNewPosts(d);
    } catch {}
  };
  eventSource.onerror = () => setSse('reconnecting', 'Reconnecting...');
}

function setSse(s, t) { $sseIndicator.className = `sse-indicator ${s}`; $sseStatus.textContent = t; }

function onNewPosts(data) {
  const { posts, channelInfo, channel } = data;
  if (!posts?.length) return;
  if (channelInfo) channelInfoMap[channel] = channelInfo;
  const processed = posts.map(p => ({ ...p, _channel: channel, channelInfo }));
  const existing = new Set(allPosts.map(p => p.id));
  const fresh = processed.filter(p => !existing.has(p.id));
  if (!fresh.length) return;
  pendingNewPosts.push(...fresh);
  $bannerText.textContent = `🔴 ${pendingNewPosts.length} berita baru — klik untuk melihat`;
  $banner.classList.add('visible');
  // Update ticker
  updateTicker(fresh);
  document.title = `(${pendingNewPosts.length}) TeleMirror News`;
  toast(`🔴 ${fresh.length} berita baru!`, 'success');
}

function injectPendingPosts() {
  if (!pendingNewPosts.length) return;
  newPostIds = new Set(pendingNewPosts.map(p => p.id));
  allPosts.unshift(...pendingNewPosts);
  const seen = new Set();
  allPosts = allPosts.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  allPosts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  pendingNewPosts = [];
  $banner.classList.remove('visible');
  document.title = 'TeleMirror News — Berita Terkini';
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => { newPostIds.clear(); document.querySelectorAll('.new-highlight').forEach(e => e.classList.remove('new-highlight')); }, 5000);
}

function updateTicker(posts) {
  const headlines = posts.map(p => getHeadline(p)).filter(Boolean);
  if (!headlines.length) return;
  $tickerText.textContent = headlines.join('  •  ');
  $tickerBar.style.display = '';
}

// ── Render ───────────────────────────────────
function renderAll() {
  const filtered = getFiltered();
  if (!filtered.length) {
    $heroSection.style.display = 'none';
    $grid.innerHTML = '';
    $empty.style.display = '';
    $count.textContent = '0 artikel';
    $loadMoreWrap.style.display = 'none';
    return;
  }
  $empty.style.display = 'none';
  $count.textContent = `${filtered.length} artikel`;

  // Hero = first post with image
  const heroPost = filtered.find(p => p.photo || p.videoThumb || p.linkPreview?.image);
  const heroIndex = heroPost ? filtered.indexOf(heroPost) : -1;

  if (heroPost && !searchQuery) {
    renderHero(heroPost, heroIndex);
    $heroSection.style.display = '';
  } else {
    $heroSection.style.display = 'none';
  }

  // Grid = remaining posts
  const gridPosts = filtered.filter((_, i) => i !== heroIndex);
  const sidebarPosts = gridPosts.slice(0, 4); // sidebar top 4
  const mainPosts = searchQuery ? gridPosts : gridPosts.slice(4);
  const visible = mainPosts.slice(0, visibleCount);

  // Sidebar
  if (!searchQuery && sidebarPosts.length) {
    renderSidebar(sidebarPosts);
  }

  // Grid
  $grid.innerHTML = visible.map((p, i) => renderCard(p, filtered.indexOf(p), i)).join('');
  $grid.querySelectorAll('.news-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      openReader(parseInt(card.dataset.idx, 10));
    });
  });

  // Load more
  $loadMoreWrap.style.display = visibleCount < mainPosts.length ? '' : 'none';
}

function getFiltered() {
  let posts = allPosts;
  if (activeCategory === 'text') posts = posts.filter(p => p.text && !p.photo && !p.videoThumb);
  else if (activeCategory === 'media') posts = posts.filter(p => p.photo || p.videoThumb);
  else if (activeCategory === 'link') posts = posts.filter(p => p.linkPreview?.url);
  if (searchQuery) {
    posts = posts.filter(p => {
      const t = (p.text || '').toLowerCase();
      const lp = ((p.linkPreview?.title || '') + ' ' + (p.linkPreview?.description || '')).toLowerCase();
      return t.includes(searchQuery) || lp.includes(searchQuery);
    });
  }
  return posts;
}

function loadMore() {
  visibleCount += POSTS_PER_PAGE;
  renderAll();
}

// ── Hero ─────────────────────────────────────
function renderHero(post, idx) {
  const img = post.photo || post.videoThumb || post.linkPreview?.image || '';
  const headline = getHeadline(post);
  const excerpt = (post.text || '').slice(0, 150);
  const time = post.date ? fmtDate(post.date) : '';
  const views = post.views || '';

  $heroCard.innerHTML = `
    ${img ? `<img class="hero-img" src="${attr(img)}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="hero-overlay">
      <span class="hero-tag">Terbaru</span>
      <h1 class="hero-title">${esc(headline)}</h1>
      ${excerpt ? `<p class="hero-excerpt">${esc(excerpt)}</p>` : ''}
      <div class="hero-meta">
        ${time ? `<span>📅 ${time}</span>` : ''}
        ${views ? `<span>👁 ${esc(views)} views</span>` : ''}
      </div>
    </div>`;
  $heroCard.onclick = () => openReader(idx);
}

function renderSidebar(posts) {
  $heroSidebar.innerHTML = posts.map((p, i) => {
    const title = getHeadline(p);
    const time = p.date ? fmtDate(p.date) : '';
    const thumb = p.photo || p.videoThumb || p.linkPreview?.image || '';
    const idx = allPosts.indexOf(p);
    return `
      <div class="sidebar-item" onclick="openReader(${idx})">
        <span class="si-number">${String(i + 1).padStart(2, '0')}</span>
        <div class="si-content">
          <div class="si-title">${esc(title)}</div>
          <div class="si-meta">${time}</div>
        </div>
        ${thumb ? `<img class="si-thumb" src="${attr(thumb)}" alt="" onerror="this.style.display='none'">` : ''}
      </div>`;
  }).join('');
}

// ── Card ─────────────────────────────────────
function renderCard(post, realIdx, renderIdx) {
  const delay = Math.min(renderIdx * 0.04, 0.4);
  const isNew = newPostIds.has(post.id);
  const img = post.photo || post.videoThumb || post.linkPreview?.image || '';
  const headline = getHeadline(post);
  const excerpt = (post.text || '').replace(/\n/g, ' ').slice(0, 120);
  const time = post.date ? fmtDate(post.date) : 'Baru saja';
  const views = post.views || '';
  const category = post.photo || post.videoThumb ? 'FOTO' : post.linkPreview?.url ? 'LINK' : 'ARTIKEL';

  return `
    <article class="news-card${isNew ? ' new-highlight' : ''}" data-idx="${realIdx}" style="animation-delay:${delay}s">
      ${img ? `<img class="card-img" src="${attr(img)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="card-body">
        <div class="card-category">${category}</div>
        <h3 class="card-title">${esc(headline)}</h3>
        ${excerpt ? `<p class="card-excerpt">${esc(excerpt)}</p>` : ''}
        <div class="card-meta">
          <span>${time}${views ? ` · 👁 ${esc(views)}` : ''}</span>
          <span class="card-read-more">Baca →</span>
        </div>
      </div>
    </article>`;
}

// ── Reader ───────────────────────────────────
window.openReader = function(idx) {
  const post = allPosts[idx];
  if (!post) return;

  const img = post.photo || post.videoThumb || '';
  const headline = getHeadline(post);
  const time = post.date ? fmtDateFull(post.date) : '';
  const views = post.views || '';
  const category = post.photo || post.videoThumb ? 'FOTO' : post.linkPreview?.url ? 'LINK' : 'ARTIKEL';

  const textHtml = post.textHtml
    ? `<div class="reader-text">${sanitize(post.textHtml)}</div>`
    : (post.text ? `<div class="reader-text">${esc(post.text).replace(/\n/g, '<br>')}</div>` : '');

  let lpHtml = '';
  if (post.linkPreview && (post.linkPreview.title || post.linkPreview.description)) {
    const lp = post.linkPreview;
    lpHtml = `
      <a class="reader-link-preview" href="${attr(lp.url || '#')}" target="_blank" rel="noopener">
        ${lp.image ? `<img src="${attr(lp.image)}" alt="" onerror="this.style.display='none'">` : ''}
        ${lp.siteName ? `<div class="rlp-site">${esc(lp.siteName)}</div>` : ''}
        ${lp.title ? `<div class="rlp-title">${esc(lp.title)}</div>` : ''}
        ${lp.description ? `<div class="rlp-desc">${esc(lp.description)}</div>` : ''}
      </a>`;
  }

  $readerContent.innerHTML = `
    ${img ? `<img class="reader-img" src="${attr(img)}" alt="" onerror="this.style.display='none'">` : ''}
    <span class="reader-tag">${category}</span>
    <h1 class="reader-headline">${esc(headline)}</h1>
    <div class="reader-meta">
      ${time ? `<span>📅 ${time}</span>` : ''}
      ${views ? `<span>👁 ${esc(views)} views</span>` : ''}
    </div>
    ${textHtml}
    ${lpHtml}`;

  $readerOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
};

function closeReader() {
  $readerOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

// ── Skeletons ────────────────────────────────
function showSkeletons() {
  $heroSection.style.display = 'none';
  const s = `<div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-body"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>`;
  $grid.innerHTML = s.repeat(6);
}

// ── Helpers ──────────────────────────────────
function getHeadline(post) {
  // Use first line or first sentence as headline
  const text = post.text || post.linkPreview?.title || '';
  const firstLine = text.split('\n').filter(Boolean)[0] || text;
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => fetchAllChannels(), REFRESH_INTERVAL);
}

function toast(msg, type = 'info') {
  $status.textContent = msg;
  $status.className = `status-toast visible ${type}`;
  setTimeout(() => $status.classList.remove('visible'), 3000);
}

function fmtDate(d) {
  try {
    const dt = new Date(d), now = new Date(), diff = now - dt;
    if (diff < 60000) return 'Baru saja';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} menit lalu`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} jam lalu`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} hari lalu`;
    return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function fmtDateFull(d) {
  try {
    return new Date(d).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function attr(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitize(h) {
  if (!h) return '';
  return h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/on\w+="[^"]*"/gi, '').replace(/on\w+='[^']*'/gi, '');
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; o.type = 'sine';
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch {}
}
