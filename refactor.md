# ARXCESS — Windsurf AI Refactor Prompt
> Copy seluruh isi prompt ini dan paste ke Windsurf AI

---

## KONTEKS PROYEK

Kamu adalah senior frontend engineer yang bertugas melakukan **full UI/UX refactor** pada proyek `Arxcess` — sebuah **encrypted digital goods marketplace** berbasis **Solana blockchain**. Proyek ini dibangun dengan Next.js 14, React 18, TypeScript, dan Solana wallet adapter.

Repositori memiliki 4 halaman utama:
- `/` → **Home** (landing page)
- `/explore` → **Explore** (storefront, browse & beli produk)
- `/launch` → **Launch** (creator upload & publish produk)
- `/library` → **Library** (purchased items & delivery hub)

Tugasmu adalah **refactor total visual dan struktur frontend** tanpa mengubah logika on-chain, transaksi Solana, atau koneksi ke Pinata/IPFS/Supabase yang sudah ada.

---

## DESIGN SYSTEM

### Filosofi Visual
> **Dark Elegant + Glassmorphism** — Premium, crypto-native, Web3 feel.
> Terinspirasi dari: Linear.app meets OpenSea meets Vercel Dashboard.
> Tone: sophisticated, trustworthy, encrypted, futuristic tapi clean.

### Color Palette
```css
:root {
  /* Backgrounds */
  --bg:        #030712;   /* base background */
  --bg2:       #060d1a;   /* secondary bg */
  --surface:   #0c1525;   /* card surface */
  --surface2:  #111e33;   /* elevated surface */

  /* Borders */
  --border:    rgba(99, 120, 180, 0.15);
  --border2:   rgba(99, 120, 180, 0.28);

  /* Brand */
  --violet:    #7c3aed;
  --violet2:   #a78bfa;   /* light violet */
  --cyan:      #06b6d4;
  --cyan2:     #67e8f9;   /* light cyan */

  /* Semantic */
  --green:     #10b981;   /* success / active */
  --amber:     #f59e0b;   /* warning / pending */
  --red:       #ef4444;   /* danger / revoked */
  --pink:      #ec4899;   /* highlight accent */

  /* Text */
  --text:      #e2e8f0;   /* primary text */
  --text2:     #94a3b8;   /* secondary text */
  --text3:     #475569;   /* muted text */

  /* Effects */
  --glow-v:   0 0 30px rgba(124, 58, 237, 0.35);
  --glow-c:   0 0 30px rgba(6, 182, 212, 0.35);
}
```

### Typography
```css
/* Import di globals.css */
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

--font-head: 'Syne', sans-serif;      /* Headings, logo, titles */
--font-body: 'Outfit', sans-serif;    /* Body text, UI labels */
--font-mono: 'JetBrains Mono', mono;  /* Wallet address, price, hash */
```

### Spacing & Radius
```css
--radius-sm: 8px;
--radius:    12px;
--radius-lg: 20px;
--radius-xl: 28px;
```

### Background Effects
Tambahkan efek berikut ke `body` atau wrapper utama:
1. **Grid pattern** — garis grid tipis `rgba(99,120,180,0.04)` ukuran `40px x 40px`
2. **Noise texture** — SVG fractal noise dengan opacity 0.03 sebagai `::after` pseudo-element
3. **Radial glow** — violet glow di pojok kiri atas, cyan glow di pojok kanan bawah, keduanya `position: fixed`, `pointer-events: none`

---

## KOMPONEN GLOBAL

Buat semua komponen ini di `frontend/components/ui/`. Gunakan Tailwind CSS utility classes untuk semua styling.

---

### 1. `Navbar.tsx`
```
Struktur:
[Logo "Arxcess"] ←→ [Nav Links] ←→ [Wallet Button]

Behavior:
- sticky top-0 dengan backdrop-filter: blur(20px)
- Background: rgba(3,7,18,0.85) + border-bottom 1px --border
- Logo: gradient text violet → cyan, font Syne weight 800
- Nav links: Home | Explore | Launch | Library
  - Active state: warna violet2, background rgba(124,58,237,0.12)
  - Hover: background surface, warna text
- Wallet Button:
  - Jika TIDAK terkoneksi: gradient button violet→cyan, label "Connect Wallet"
  - Jika TERKONEKSI: tampilkan dot hijau (animated pulse) + alamat wallet disingkat (4...4 karakter), dropdown saat klik
- Mobile: hamburger menu collapse
```

---

### 2. `Button.tsx`
```
Variants:
- primary   → gradient violet, hover: glow-v + translateY(-1px)
- secondary → surface2 bg, border border2, hover: border violet
- ghost     → transparent, border border, hover: surface bg
- cyan      → gradient cyan, hover: glow-c
- danger    → red tinted bg, red border
- outline   → transparent, border violet/cyan

Sizes:
- sm  → padding: 6px 14px, font: 13px
- md  → padding: 10px 20px, font: 14px (default)
- lg  → padding: 14px 28px, font: 16px
- icon → 38x38px, centered icon only

States:
- disabled: opacity 0.4, cursor not-allowed
- loading: spinner icon + teks "Loading..."
```

---

### 3. `Badge.tsx`
```
Variants: violet | cyan | green | amber | red | gray
Semua: border radius 999px, uppercase, letter-spacing 0.5px, font 11px
Masing-masing punya background tinted + border tinted dari warna yang sama
```

---

### 4. `Input.tsx`
```
Struktur:
[Label]
[Input / Textarea / Select]
[Hint text atau error text]

Styling:
- Background: surface
- Border: border2, fokus: violet + box-shadow 0 0 0 3px rgba(124,58,237,0.12)
- Placeholder: text3
- Error state: border merah + hint teks merah
- Prefix icon support (icon di dalam input, padding kiri 42px)
- Suffix support (contoh: "SOL" label di kanan)
```

---

### 5. `Card.tsx`
```
glass variant:
- background: rgba(12,21,37,0.7)
- backdrop-filter: blur(16px)
- border: 1px solid --border
- hover: border-color → --border2

solid variant:
- background: surface
- border: 1px solid --border

Semua card: border-radius --radius, overflow hidden
```

---

### 6. `ProductCard.tsx`
```
Layout vertikal:
┌─────────────────────────┐
│  THUMBNAIL (16:9)        │  ← gradient bg, emoji/icon di tengah
│  [🔒 Encrypted]  badge  │  ← top-right absolute badge
├─────────────────────────┤
│  [Category badge]        │
│  Product Title           │  ← Syne font, bold
│  Short description       │  ← 2 baris max, text2
├─────────────────────────┤
│  ◈ 0.05 SOL    [Buy →]  │  ← price mono font violet2 | btn cyan sm
│  by 3xKp...f7           │  ← publisher address mono text3
└─────────────────────────┘

Hover effect:
- translateY(-3px)
- border: rgba(124,58,237,0.4)
- box-shadow: 0 8px 32px rgba(0,0,0,0.4)

Extras:
- Jika sudah dibeli: overlay "Purchased ✓" hijau di thumbnail
- Jika revocable: badge "Revocable" amber
```

---

### 7. `StatCard.tsx`
```
Layout:
┌──────────────────────────────┐
│ ▬▬ (gradient top border 2px) │
│ LABEL (uppercase 12px text2)  │
│ VALUE (Syne 28px bold)        │
│ +12% dari kemarin (green)    │
└──────────────────────────────┘
Top border: gradient violet → cyan
```

---

### 8. `StepIndicator.tsx`
```
Props: steps: string[], currentStep: number

Visual:
● ──── ● ──── ● ──── ●
1      2      3      4
Done  Active  Pending Pending

- Done: lingkaran hijau + checkmark
- Active: lingkaran gradient violet+cyan, glow effect
- Pending: lingkaran surface2, text3
- Connector line: 1px, done = hijau, pending = border
```

---

### 9. `StatusIndicator.tsx`
```
Variants:
- pending_seal → dot amber (pulse) + label "Awaiting Delivery"
- delivered    → dot green (pulse) + label "Delivered"
- locked       → dot violet + label "Encrypted"
- revoked      → dot red + label "Access Revoked"

Semua dot: 8px circle, pulse animation untuk active states
```

---

### 10. `WalletAddress.tsx`
```
Props: address: string, shortened?: boolean, copyable?: boolean

Display: font-mono, text2, bg surface, border border, radius sm, padding 4px 10px
Shortened: tampilkan 4 karakter awal + "..." + 4 karakter akhir
Copyable: icon copy di kanan, onClick → copy to clipboard + tooltip "Copied!"
```

---

### 11. `Modal.tsx`
```
- Overlay: rgba(0,0,0,0.7) + backdrop-filter blur(8px)
- Panel: glass card, max-width 480px, center screen
- Animasi: scale 0.95→1 + opacity 0→1 saat buka
- Header: title + X button
- Body: scrollable jika konten panjang
- Footer: action buttons
```

---

### 12. `Toast.tsx` / Notification System
```
Posisi: bottom-right, stacked
Variants: success (green) | error (red) | warning (amber) | info (cyan)
Setiap toast: icon + message + progress bar countdown
Auto dismiss: 4 detik
```

---

### 13. `EmptyState.tsx`
```
Props: icon, title, description, action?: {label, onClick}

Visual: centered, icon besar (64px emoji atau SVG), title Syne bold, desc text2
Contoh: "No products found" untuk Explore kosong
```

---

### 14. `LoadingSkeleton.tsx`
```
Shimmer animation: background gradient dari surface → surface2 → surface
Bergerak dari kiri ke kanan (background-position animation)
Gunakan untuk: ProductCard skeleton, LibraryItem skeleton
```

---

### 15. `Tooltip.tsx`
```
Muncul saat hover di atas elemen
Background: surface2, border: border2, text: 12px
Animasi: fadeIn + translateY kecil
```

---

## HALAMAN — HOME `/`

### SEO Meta Tags
```tsx
<title>Arxcess — Encrypted Digital Goods on Solana</title>
<meta name="description" content="Buy and sell encrypted digital products trustlessly on Solana. Files stay private until payment is finalized." />
<meta property="og:title" content="Arxcess — Encrypted Marketplace" />
<meta property="og:description" content="The first encrypted digital goods marketplace on Solana." />
<meta property="og:image" content="/og-image.png" />  {/* buat placeholder */}
<meta name="twitter:card" content="summary_large_image" />
```

### Layout Sections

#### HERO SECTION
```
Full viewport height, centered content

Background:
- Grid pattern aktif
- Radial gradient violet di kiri atas
- Radial gradient cyan di kanan bawah
- Noise overlay

Content (stagger animation, setiap elemen delay 0.1s):
[Badge: "Built on Solana ◎ Devnet"]
[H1: "The Encrypted\nDigital Marketplace"]
  → "Encrypted" dalam gradient violet→cyan
[Subtitle: "Sell any digital file. Buyers only decrypt after payment is confirmed on-chain. Zero trust required."]
[CTA Row: [Explore Products →] [Launch Your Product]]
[Stats row: "0 Products Listed" | "0 SOL Volume" | "End-to-End Encrypted"]

Decorative:
- Floating card mockup (ProductCard) di sebelah kanan, animasi float
- Glow orbs di background
```

#### HOW IT WORKS SECTION
```
[Section Tag: "How It Works"]
[Title: "Simple. Encrypted. Trustless."]

3 kolom cards (staggered fade-up on scroll):

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  🔐  step 01     │  │  ◎   step 02     │  │  📦  step 03     │
│  Creator         │  │  Buyer           │  │  Delivery        │
│  Encrypts &      │  │  Purchases on    │  │  Decryption key  │
│  uploads file    │  │  Solana          │  │  revealed        │
│  in browser      │  │                  │  │  on-chain        │
└──────────────────┘  └──────────────────┘  └──────────────────┘

Setiap card: glass variant, icon besar gradient, nomor step kecil (font-mono)
Connector arrows antara card di desktop
```

#### FEATURES SECTION
```
[Title: "Why Arxcess?"]

Grid 2x2 feature cards:
1. 🔒 Browser-side Encryption   — "Files encrypted before upload. Never stored as plaintext."
2. ◎  On-chain Payments         — "Solana transactions. Instant, low-fee, verifiable."  
3. 📦 Conditional Delivery      — "Decryption only after on-chain confirmation."
4. 🔄 Revocable Access          — "Publishers can revoke time-limited access."

Setiap card: gradient border hover (violet atau cyan), icon dengan colored glow
```

#### CTA SECTION
```
Full-width banner dengan gradient background (violet→bg via diagonal)
[Title: "Ready to sell encrypted?"]
[Subtitle: "Connect wallet dan publish produk pertamamu dalam menit."]
[Button: "Launch Your First Product →"]
```

#### FOOTER
```
[Logo + tagline "Encrypted marketplace on Solana"]
[Links: Explore | Launch | Library | GitHub]
[Bottom: "© 2025 Arxcess · MIT License · Built on Solana Devnet"]
```

---

## HALAMAN — EXPLORE `/explore`

### SEO
```tsx
<title>Explore Products — Arxcess</title>
<meta name="description" content="Browse encrypted digital products. Buy with your Solana wallet." />
```

### Layout

#### Header Bar
```
[H1: "Explore"] [Badge: "N products"]
[Search input dengan icon 🔍]     [Filter dropdown: All | eBook | Code | Design | Media]
[Sort: Latest | Price Low→High | Price High→Low]
```

#### Product Grid
```
Responsive grid: 1 col mobile → 2 col tablet → 3 col desktop → 4 col xl
Gap: 20px

Setiap item: ProductCard component (lihat komponen di atas)
Loading state: ProductCard skeleton (shimmer)
Empty state: EmptyState component "No products yet. Be the first to launch!"
```

#### Purchase Flow (Modal)
```
Klik "Buy" → buka Modal konfirmasi:

┌─────────────────────────────────┐
│ Confirm Purchase                 │
├─────────────────────────────────┤
│ [Product Thumbnail]              │
│ Product Name                     │
│ Publisher: [WalletAddress]       │
│                                  │
│ Price:     0.05 SOL              │
│ Fee:       0.001 SOL             │
│ Total:     0.051 SOL             │
│                                  │
│ Access window: 30 days           │
│ Reveal limit:  1 download        │
│ Revocable:     Yes               │
│                                  │
│ ⚠ Your delivery key will be     │
│   auto-generated in browser.     │
├─────────────────────────────────┤
│ [Cancel]          [Confirm & Pay]│
└─────────────────────────────────┘

After buy: Toast "Purchase confirmed! Check your Library."
```

---

## HALAMAN — LAUNCH `/launch`

### SEO
```tsx
<title>Launch a Product — Arxcess</title>
<meta name="description" content="Publish encrypted digital products on Solana. Your files are encrypted in the browser before upload." />
```

### Layout: Multi-Step Form

#### Step Indicator (top)
```
① Product Info → ② Upload & Encrypt → ③ Set Terms → ④ Publish
```

#### Step 1 — Product Info
```
[Input: Product Name *]
[Textarea: Description *]
[Select: Category (eBook | Code | Design | Media | Other)]
[Input: Cover Image URL atau upload]
```

#### Step 2 — Upload & Encrypt
```
┌─────────────────────────────────────────┐
│   Drag & drop your file here             │
│   atau                                   │
│   [Browse Files]                         │
│                                          │
│   Supported: PDF, ZIP, PNG, MP4, etc    │
│   Max size: 100MB                        │
└─────────────────────────────────────────┘

After file selected:
[File icon] filename.pdf (2.4 MB) [×]
[Badge cyan: "Will be encrypted in browser before upload"]

Progress saat encrypt+upload:
[🔐 Encrypting...    ████████░░  80%]
[☁  Uploading...     ░░░░░░░░░░   0%]
```

#### Step 3 — Set Terms
```
[Input: Price (SOL) *]  ← suffix "SOL", mono font
[Input: Access Window (days)]  ← helper: "Buyer's access expires after N days"
[Input: Reveal Limit]  ← helper: "Max times buyer can download"
[Toggle: Revocable Access]  ← dengan penjelasan singkat

Preview box:
┌──────────────────────────────┐
│  Listing Preview              │
│  Price:         0.05 SOL      │
│  Access:        30 days       │
│  Reveal limit:  1             │
│  Revocable:     Yes           │
└──────────────────────────────┘
```

#### Step 4 — Publish
```
[Summary card semua detail produk]
[Wallet confirmation info]
[Button: "Sign & Publish on Solana"]  ← btn-primary lg, gradient

Loading state:
[Spinner] "Waiting for wallet signature..."
[Spinner] "Creating on-chain product..."
[Spinner] "Activating listing..."

Success state:
✅ [Title: "Product Published!"]
[Product details summary]
[Links: "View in Explore →" | "Launch Another →"]
```

---

## HALAMAN — LIBRARY `/library`

### SEO
```tsx
<title>My Library — Arxcess</title>
<meta name="description" content="Access your purchased encrypted products and manage deliveries." />
```

### Layout

#### Tabs (top)
```
[Purchased (buyer view)] [Published (creator view)]
Aktif tab: border-bottom violet, teks violet2
```

#### Tab: Purchased
```
List of LibraryItem:
┌──────────────────────────────────────────────────────────┐
│ [thumb] Product Name              [StatusBadge]  [Action] │
│         by Publisher              Access: 29d left        │
└──────────────────────────────────────────────────────────┘

Status & Action matrix:
- pending_seal   → Badge amber "Awaiting Delivery"  | [no action]
- delivered      → Badge green "Ready"              | [Reveal & Download] btn-cyan
- revealed       → Badge gray  "Downloaded"         | [Download Again] btn-ghost sm
- revoked        → Badge red   "Revoked"            | [no action]

Reveal flow:
- Klik "Reveal & Download" → loading "Decrypting..."
- Setelah sukses: file langsung download + Toast "File decrypted and downloaded!"
```

#### Tab: Published
```
List of produk yang dipublish oleh wallet ini

Setiap item:
┌──────────────────────────────────────────────────────────┐
│ [thumb] Product Name     [N buyers]  [Status]  [Actions] │
└──────────────────────────────────────────────────────────┘

Actions (sesuai kondisi):
- [Finalize Delivery] → untuk pending_seal purchases (btn-primary sm)
- [Revoke Access]     → jika listing revocable (btn-danger sm)
- [View in Explore]   → btn-ghost sm

Empty state (jika belum publish):
EmptyState: "You haven't published anything yet."
[CTA: "Launch Your First Product →"]
```

---

## ANIMASI & MICRO-INTERACTIONS

```
1. Page transition: fade + slide-up (0.3s ease)
2. Card hover: translateY(-3px) + border brighten (0.2s)
3. Button hover: subtle glow + translateY(-1px) (0.2s)
4. Button click: scale(0.97) (0.1s)
5. Input focus: border violet + box-shadow glow (0.2s)
6. Skeleton shimmer: background slide left→right (1.5s infinite)
7. Toast enter: slide-in dari kanan (0.3s spring)
8. Toast exit: slide-out ke kanan (0.2s)
9. Modal open: scale 0.95→1 + opacity 0→1 (0.25s)
10. Number counter: animate dari 0 ke nilai final di Hero stats
11. Scroll reveal: elemen fade-up saat masuk viewport (IntersectionObserver)
12. Wallet address hover: tooltip muncul dengan full address
```

---

## STRUKTUR FILE YANG DIREKOMENDASIKAN

```
frontend/
├── app/
│   ├── layout.tsx          ← RootLayout + font import + metadata default
│   ├── page.tsx            ← Home
│   ├── explore/
│   │   └── page.tsx
│   ├── launch/
│   │   └── page.tsx
│   └── library/
│       └── page.tsx
│
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Badge.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Toast.tsx
│   │   ├── Tooltip.tsx
│   │   ├── EmptyState.tsx
│   │   ├── LoadingSkeleton.tsx
│   │   └── WalletAddress.tsx
│   ├── ProductCard.tsx
│   ├── StatCard.tsx
│   ├── StepIndicator.tsx
│   ├── StatusIndicator.tsx
│   ├── LibraryItem.tsx
│   └── Navbar.tsx
│
├── styles/
│   └── globals.css         ← CSS variables, fonts, base styles, animations
│
└── lib/
    └── utils.ts            ← cn() helper, formatSOL(), shortenAddress()
```

---

## UTILITIES

```typescript
// lib/utils.ts

// Gabungkan class names (gunakan clsx atau manual)
export function cn(...classes: string[]) { ... }

// Format SOL amount
export function formatSOL(lamports: number): string {
  return `◎ ${(lamports / 1e9).toFixed(4)}`
}

// Shorten wallet address
export function shortenAddress(addr: string, chars = 4): string {
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`
}

// Format relative time
export function relativeTime(date: Date): string { ... }
```

---

## ATURAN PENTING

1. **JANGAN ubah** logika Solana, Anchor, Pinata, atau Supabase yang sudah ada
2. **JANGAN ubah** nama fungsi, hooks, atau context yang sudah dipakai logika
3. **HANYA refactor** visual: className, styling, struktur JSX, layout, animasi
4. Gunakan **Tailwind CSS** untuk semua styling baru
5. Gunakan **CSS Variables** yang didefinisikan di `globals.css` untuk konsistensi
6. Semua komponen harus **TypeScript** dengan props yang di-type dengan benar
7. Semua halaman harus **responsive**: mobile (375px) → tablet (768px) → desktop (1280px+)
8. Tambahkan **SEO meta tags** di setiap page menggunakan Next.js `metadata` export
9. Gunakan **`next/font`** untuk font loading yang optimal
10. Pastikan semua interactive element punya **focus states** yang accessible

---

## REFERENSI INSPIRASI VISUAL

- linear.app — sidebar, card hover, spacing
- opensea.io — product grid, wallet integration feel  
- vercel.com/dashboard — dark surface, clean typography
- pump.fun — crypto-native energy tapi clean

---

*Prompt ini dibuat untuk Arxcess frontend refactor. Implementasikan secara bertahap, mulai dari Design System (globals.css + komponen UI dasar), lalu Navbar, lalu masing-masing halaman.*