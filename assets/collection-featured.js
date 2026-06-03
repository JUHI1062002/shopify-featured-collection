/**
 * collection-featured.js
 *
 * Infinite scroll with featured-product pinning.
 *
 * PINNED MODE (default sort, no filters):
 *   - Liquid has already rendered 15 featured products server-side.
 *   - JS loads non-featured products, shows first 5 (total = 20 visible).
 *   - Each scroll event loads 20 more non-featured products.
 *   - Featured products are NEVER shown again via JS.
 *
 * NORMAL MODE (any sort_by or active filter):
 *   - Grid starts empty; JS fetches all products without filtering.
 *   - First 20 shown immediately, then 20 per scroll.
 *   - No featured pinning.
 *
 * DEDUP:
 *   - shownIds (Set) tracks every product ID ever rendered.
 *   - Every batch from the API is filtered against shownIds.
 *   - shownIds is seeded with featuredIds in pinned mode.
 */

(function () {
  'use strict';

  /* ─── Constants ──────────────────────────────────────────────────── */
  const API_PAGE_SIZE   = 50;   // How many products to fetch per API call
  const INITIAL_NORMAL  = 20;   // Products shown on first load (normal mode)
  const INITIAL_PINNED  = 5;    // Non-featured products shown on first load (pinned mode)
  const PER_SCROLL      = 20;   // Products per scroll trigger

  /* ─── DOM references ─────────────────────────────────────────────── */
  const wrapper  = document.getElementById('cf-wrapper');
  const grid     = document.getElementById('cf-grid');
  const loading  = document.getElementById('cf-loading');
  const endMsg   = document.getElementById('cf-end');
  const emptyMsg = document.getElementById('cf-empty');
  const sentinel = document.getElementById('cf-sentinel');
  const sortSel  = document.getElementById('cf-sort-by');
  const tagSel   = document.getElementById('cf-tag-filter');

  if (!wrapper || !grid || !sentinel) return;

  /* ─── Configuration from server ─────────────────────────────────── */
  const handle      = wrapper.dataset.handle;
  const pinnedMode  = wrapper.dataset.pinned === 'true';
  const initialSort = wrapper.dataset.sort || '';
  const featuredIds = new Set(
    (wrapper.dataset.featuredIds || '')
      .split(',')
      .filter(Boolean)
      .map(Number)
  );

  /* ─── State ──────────────────────────────────────────────────────── */
  let apiPage       = 1;          // Next page to fetch from Shopify products.json
  let queue         = [];         // Buffer: fetched but not yet displayed
  let shownIds      = new Set(pinnedMode ? featuredIds : []); // Rendered product IDs
  let apiExhausted  = false;      // true when last fetch returned < API_PAGE_SIZE
  let isLoading     = false;      // Prevent concurrent fetches
  let sortBy        = initialSort;
  let observer      = null;

  /* ─── Boot ───────────────────────────────────────────────────────── */
  async function init() {
    const initialCount = pinnedMode ? INITIAL_PINNED : INITIAL_NORMAL;
    await fillQueue(initialCount);

    if (queue.length === 0 && apiExhausted) {
      // Check if there are server-rendered featured products already
      const serverCards = grid.querySelectorAll('.cf-card').length;
      if (serverCards === 0) showEmpty();
      else showEnd();
      return;
    }

    displayFromQueue(initialCount);
    setupObserver();
    setupSortListener();
    setupTagListener();
  }

  /* ─── Queue management ───────────────────────────────────────────── */

  /**
   * Fetch API pages until queue has ≥ needed products, or API is exhausted.
   */
  async function fillQueue(needed) {
    while (queue.length < needed && !apiExhausted) {
      await fetchNextPage();
    }
  }

  /**
   * Fetch one page from /collections/handle/products.json,
   * filter out already-shown IDs (and featured IDs in pinned mode),
   * push the remainder into the queue.
   */
  async function fetchNextPage() {
    const params = new URLSearchParams({ limit: API_PAGE_SIZE, page: apiPage });
    if (sortBy) params.set('sort_by', sortBy);

    let products = [];
    try {
      showLoader(true);
      const url = `/collections/${handle}/products.json?${params}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      products = data.products || [];
    } catch (err) {
      console.error('[CF] Fetch error:', err);
      apiExhausted = true;
      return;
    } finally {
      showLoader(false);
    }

    if (products.length < API_PAGE_SIZE) {
      apiExhausted = true;
    }

    for (const p of products) {
      // Skip already-shown products (dedup guard)
      if (shownIds.has(p.id)) continue;
      // In pinned mode, skip featured products (they were rendered by Liquid)
      if (pinnedMode && featuredIds.has(p.id)) continue;
      queue.push(p);
    }

    apiPage++;
  }

  /* ─── Display ────────────────────────────────────────────────────── */

  /**
   * Move up to `count` items from the front of the queue into the DOM.
   */
  function displayFromQueue(count) {
    const batch = queue.splice(0, count);

    batch.forEach(p => {
      shownIds.add(p.id);
      grid.appendChild(buildCard(p));
    });

    // If we consumed the entire queue AND the API is exhausted, show end message
    if (queue.length === 0 && apiExhausted) {
      showEnd();
    }
  }

  /**
   * Build a product card DOM node from the products.json shape.
   * Mirrors the Liquid cf-product-card snippet.
   */
  function buildCard(product) {
    const isFeatured = featuredIds.has(product.id);
    const variant    = product.variants && product.variants[0];
    const price      = variant ? parseFloat(variant.price) : 0;
    const compareAt  = variant ? parseFloat(variant.compare_at_price) : 0;
    const hasImg     = product.images && product.images.length > 0;
    const imgSrc     = hasImg ? addImageSize(product.images[0].src, '400x400') : '';
    const imgAlt     = esc(product.featured_image ? product.featured_image.alt : product.title);

    // Badge
    let badge = '';
    if (isFeatured) {
      badge = '<span class="cf-badge--featured">Featured</span>';
    } else if (compareAt > price) {
      badge = '<span class="cf-badge--sale">Sale</span>';
    }

    // Price HTML
    let priceHtml = '';
    if (compareAt > price) {
      priceHtml += `<span class="cf-price--compare">${formatMoney(compareAt)}</span>`;
    }
    priceHtml += `<span class="cf-price--current">${formatMoney(price)}</span>`;

    const article = document.createElement('article');
    article.className = `cf-card${isFeatured ? ' cf-card--featured' : ''}`;
    article.dataset.productId = product.id;
    article.dataset.handle    = product.handle;
    article.innerHTML = `
      <a href="/products/${esc(product.handle)}" class="cf-card__link">
        <div class="cf-card__image-wrap">
          ${hasImg
            ? `<img class="cf-card__image" src="${imgSrc}" alt="${imgAlt}" width="400" height="400" loading="lazy">`
            : `<div class="cf-card__no-image"><span>${esc(product.title.substring(0, 20))}</span></div>`
          }
          ${badge}
        </div>
        <div class="cf-card__info">
          <p class="cf-card__vendor">${esc(product.vendor)}</p>
          <h3 class="cf-card__title">${esc(product.title)}</h3>
          <div class="cf-card__price">${priceHtml}</div>
        </div>
      </a>`;
    return article;
  }

  /* ─── IntersectionObserver ───────────────────────────────────────── */

  function setupObserver() {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onScrollTrigger();
      },
      { rootMargin: '400px 0px' }   // start loading 400px before bottom
    );
    observer.observe(sentinel);
  }

  async function onScrollTrigger() {
    if (isLoading) return;

    // Nothing left at all
    if (queue.length === 0 && apiExhausted) {
      showEnd();
      observer.disconnect();
      return;
    }

    isLoading = true;
    await fillQueue(PER_SCROLL);
    displayFromQueue(PER_SCROLL);
    isLoading = false;
  }

  /* ─── Sort & filter ─────────────────────────────────────────────── */

  function setupSortListener() {
    if (!sortSel) return;
    sortSel.addEventListener('change', () => {
      const val = sortSel.value;
      const url = new URL(window.location.href);
      if (val) {
        url.searchParams.set('sort_by', val);
      } else {
        url.searchParams.delete('sort_by');
      }
      // Preserve active tag filter if any
      window.location.href = url.toString();
    });
  }

  function setupTagListener() {
    if (!tagSel) return;
    tagSel.addEventListener('change', () => {
      const tag = tagSel.value;
      const base = `/collections/${handle}`;
      if (tag) {
        window.location.href = `${base}/${tag}`;
      } else {
        window.location.href = base;
      }
    });
  }

  /* ─── UI helpers ─────────────────────────────────────────────────── */

  function showLoader(show) {
    if (loading) loading.style.display = show ? 'flex' : 'none';
  }

  function showEnd() {
    if (endMsg)   endMsg.style.display   = 'block';
    if (loading)  loading.style.display  = 'none';
    if (observer) observer.disconnect();
  }

  function showEmpty() {
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (loading)  loading.style.display  = 'none';
    if (observer) observer.disconnect();
  }

  /* ─── Utility ────────────────────────────────────────────────────── */

  function esc(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function formatMoney(amount) {
    // products.json returns price as a decimal string e.g. "19.99"
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(num);
  }

  function addImageSize(src, size) {
    // Add Shopify image size to URL
    return src.replace(/(\.[a-z]+)(\?.*)?$/i, `_${size}$1$2`);
  }

  /* ─── Start ──────────────────────────────────────────────────────── */
  init().catch(err => console.error('[CF] Init error:', err));

})();
