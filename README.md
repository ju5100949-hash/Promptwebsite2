# KAZEPROMPT

Static web app — jailbreak prompt library. 100% client-side, tanpa build step, tanpa PHP, tanpa database SQL.

## File

| File | Fungsi |
|------|--------|
| `index.html` | Halaman utama: intro video, name modal, navbar, hero, grid, bottom nav, prompt viewer modal |
| `style.css` | Dark glassmorphism #08080a, responsive grid, modal, bottom nav |
| `script.js` | localStorage CRUD, Supabase sync, render grid, viewer, author display, owner trigger |
| `supabase.js` | Dual Supabase client via pure fetch (SB1 primary, SB2 mirror) |
| `azee.html` | Owner panel (guarded) |
| `azee.js` | Owner CRUD, statistik, export JSON & CSV |
| `prompts.json` | 10 seed prompt (termasuk kolom `author`) |
| `prompts.csv` | RFC 4180 — UTF-8 BOM, CRLF, kolom author |

## Menjalankan

Cukup buka `index.html` di browser (double-click). Tidak perlu server.

Jika ingin fetch `prompts.json` via `fetch()`, beberapa browser memblokir `file://`. Jalankan server statis sederhana:

```bash
python3 -m http.server 8080
# lalu buka http://localhost:8080
