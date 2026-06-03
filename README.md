# Shopify Featured Collection — Infinite Scroll with Pinned Products

## Live Preview
🔗 **Preview Link:** _[Add after deploying to Shopify]_

## GitHub Repository
🔗 **Repo:** _[This repository]_

---

## Overview

A Shopify collection page that always shows all featured products at the top, followed by a seamless infinite scroll for remaining products. Built with Liquid, vanilla JavaScript, and CSS — no dependencies.

**Key behaviour at a glance:**

| Condition | Behaviour |
|---|---|
| Default sort, no filters | 15 featured products pinned at top, then infinite scroll of non-featured |
| Sort applied | Normal infinite scroll — no pinning |
| Filter (tag) applied | Normal Shopify behaviour — no pinning |
| No featured products in collection | Normal infinite scroll |
| All products are featured | All shown at top, no further scroll content |

---

## Architecture

### Two Modes

**Pinned mode** activates when: no `?sort_by` param AND no active tag filter.

```
Liquid renders 15 featured products (server-side, instant paint)
       ↓
JS fetches /products.json, skips featured IDs, loads 5 non-featured
       ↓ Total on screen: 20 (15 featured + 5 non-featured)
User scrolls
       ↓
JS loads 20 more non-featured products
       ↓
Repeat until exhausted
```

**Normal mode** activates when: any sort_by OR any active tag filter.

```
Grid starts empty
       ↓
JS fetches /products.json?sort_by=X, loads first 20
       ↓
User scrolls → loads 20 more
       ↓
Repeat until exhausted
```

---

## How Each Requirement Was Met

### 1. Loading and separating featured vs non-featured

**Liquid side:**
Inside a single `{% paginate collection.products by 250 %}` block, we loop through all products and check `product.tags contains 'featured'`. This gives us:
- The featured product IDs (stored as a comma-separated string in a `data-featured-ids` attribute)
- Server-side HTML rendering of all 15 featured cards (pinned mode only)

The 250 limit covers our 100-product collection on a single page. For larger collections (250+), the paginate block would need multiple pages — see scaling section.

**JavaScript side:**
The `featuredIds` Set is parsed from the `data-featured-ids` attribute on page load. Every product fetched from the API is checked against this Set.

### 2. Infinite scroll implementation

We use the **IntersectionObserver API** to watch a sentinel `<div>` at the bottom of the page. When the sentinel enters the viewport (with a 400px lookahead margin), we trigger a fetch:

```javascript
observer = new IntersectionObserver(
  (entries) => {
    if (entries[0].isIntersecting) onScrollTrigger();
  },
  { rootMargin: '400px 0px' }
);
observer.observe(sentinel);
```

The fetch calls Shopify's storefront endpoint:
```
/collections/{handle}/products.json?limit=50&page=N&sort_by=X
```

We fetch 50 at a time from the API but display only 20 at a time — this "queue" approach means we buffer ahead, so users never see a blank screen while waiting.

### 3. Preventing duplicate products

Two-layer deduplication:

**Layer 1 — Featured guard (pinned mode only):**
```javascript
if (pinnedMode && featuredIds.has(p.id)) continue;
```
This prevents featured products (already rendered by Liquid) from appearing again in the JS-loaded batches.

**Layer 2 — Global shownIds Set:**
```javascript
if (shownIds.has(p.id)) continue;
```
Every product ID that has been rendered to the DOM is added to `shownIds`. This Set is seeded with all featured IDs at init time, so even if the API returns featured products in later pages, they are silently skipped.

### 4. Scaling for large collections

- **Liquid:** `paginate by 250` limits Liquid loops to 250 products per page. For collections with >250 products, the template only renders featured products from the first 250. However, since we check featured products across ALL pages via JS, any featured products beyond position 250 will be caught by the API layer and deduplicated (they appear in JS fetches but get filtered by `featuredIds`). For a truly large store (10,000+ products), an alternative is to fetch featured products via the Storefront API using `tag:featured` — but this is overkill for typical use.
- **JavaScript:** The queue-based approach fetches in batches of 50 and displays 20 at a time. This keeps memory usage low and avoids rendering 1000 DOM nodes at once.
- **DOM performance:** `loading="lazy"` on all images. Cards are only inserted when needed.
- **API pagination:** Uses `page` parameter (Shopify's offset pagination) which works well up to ~5000 products per collection.

### 5. Filtering and sorting

**Sorting:**
The `<select>` sort dropdown changes the URL (`?sort_by=price-ascending`) and triggers a full page reload. Shopify then renders the page with the new sort order. Since `sort_by` is now set, `pinned_mode` evaluates to `false` and the featured logic is disabled. The JS fetches from the API with `?sort_by=price-ascending` to match.

**Filtering (tag filters):**
Tag filters navigate to `/collections/handle/tag-name`. The Liquid checks `current_tags.size > 0` — if any tags are active, `pinned_mode = false`. The page behaves as normal Shopify collection browsing with our infinite scroll on top.

**When sort/filter is cleared:**
Navigating back to `/collections/handle` (no query params, no tags) re-activates pinned mode on the next page load.

### 6. Liquid limitations and workarounds

**Limitation 1: `paginate` can only be used once per template.**
*Workaround:* We do everything in a single paginate block — one loop to build the `featured_ids_str` for the JS data attribute, and a second loop to render the featured cards.

**Limitation 2: No native array manipulation for tags.**
Liquid's `where` filter only checks property equality, not array inclusion. `collection.products | where: "tags", "featured"` does not work for tags.
*Workaround:* Use `product.tags contains 'featured'` inside a `for` loop.

**Limitation 3: Liquid can't do complex pagination + custom sorting.**
We cannot tell Liquid "give me products 16–20 sorted by featured-first then price".
*Workaround:* Liquid handles only the initial featured batch (server-rendered for instant paint). All subsequent pagination is handled by JavaScript via the products.json API.

**Limitation 4: Liquid arrays are awkward to build dynamically.**
*Workaround:* We build a comma-separated ID string (`featured_ids_str`) and pass it as a data attribute. JavaScript parses it into a `Set` with `.split(',').map(Number)`.

---

## File Structure

```
├── assets/
│   ├── collection-featured.js    ← Infinite scroll + dedup logic
│   └── collection-featured.css   ← Styles for grid, cards, toolbar
│
├── sections/
│   └── main-collection-featured.liquid  ← Main section (Liquid logic + HTML)
│
├── snippets/
│   └── cf-product-card.liquid    ← Reusable product card (server-side)
│
├── templates/
│   └── collection.featured.json  ← OS2.0 template pointing to the section
│
└── README.md
```

---

## Setup Instructions

### 1. Create a Shopify development store

1. Sign up at [partners.shopify.com](https://partners.shopify.com)
2. Stores → Add store → Development store

### 2. Generate and import 100 products

```bash
node generate-products.js
```

Then: Shopify Admin → Products → Import → upload `shopify-products.csv`

15 products will have the `featured` tag at positions: 4, 11, 18, 25, 31, 38, 44, 50, 56, 62, 68, 74, 80, 87, 94

### 3. Create a collection

Shopify Admin → Products → Collections → Create collection → **Manual** collection  
Name it "All Products" and add all 100 products.

### 4. Upload theme files

**Option A — Shopify CLI (recommended):**
```bash
npm install -g @shopify/cli @shopify/theme
shopify theme push --store=your-store.myshopify.com
```

**Option B — Manual upload:**
Go to Online Store → Themes → Edit code → upload each file to the correct folder.

### 5. Assign the template

Online Store → Themes → Customize → navigate to your collection → Template → select `collection.featured`

### 6. Preview

Visit `/collections/all-products` on your development store.

---

## Edge Cases Handled

| Edge Case | Behaviour |
|---|---|
| Featured product appears on page 2+ of API | Filtered by `featuredIds` Set |
| Same product fetched twice from API | Filtered by `shownIds` Set |
| API returns 0 products | Shows "No products found" message |
| All products are featured | Featured rendered by Liquid; JS shows end-of-list immediately |
| No featured products in collection | Pinned mode active but `featured_ids_str` is empty; JS does normal infinite scroll |
| Sort/filter applied | `pinned_mode = false`; standard infinite scroll, featured badge still shows on cards |
| User on slow connection | 400px lookahead margin pre-fetches before they hit the bottom |

---

## Limitations

- The `products.json` endpoint's `page` parameter has an unofficial limit of ~100 pages (5000 products with limit=50). For collections above this size, cursor-based pagination via the Storefront API would be needed.
- Images use Shopify's CDN with `_400x400` size parameter. Very large images are automatically cropped.
- Tag filtering navigates to a new URL — the filter dropdown does not dynamically update the grid without a page reload. This matches standard Shopify behaviour.
