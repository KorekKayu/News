# 📰 TeleMirror News

Portal berita dan informasi real-time yang meng-mirror konten dari channel Telegram publik. Tampil sebagai website berita profesional — tanpa menampilkan sumber channel.

![TeleMirror News](https://img.shields.io/badge/Status-Active-22c55e?style=flat-square) ![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white) ![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

## ✨ Fitur

- 📰 **Tampilan Website Berita Profesional** — Hero section, sidebar trending, grid artikel, breaking news ticker
- 🔴 **Real-time Auto-fetch** — Server-Sent Events (SSE) mendeteksi post baru setiap 30 detik
- 🔒 **Sumber Tersembunyi** — Tidak ada referensi ke Telegram di tampilan publik
- 📖 **Reader Panel** — Slide-in panel untuk membaca artikel lengkap
- 🔍 **Search & Filter** — Cari berita + filter per kategori (Artikel, Foto & Video, Link)
- 📱 **Responsive** — Desktop, tablet, dan mobile
- ⚡ **Caching** — Server-side cache 5 menit untuk mengurangi request ke Telegram
- 💾 **LocalStorage** — Sumber berita tersimpan di browser

## 🛠️ Tech Stack

| Komponen | Teknologi |
|----------|-----------|
| Backend | Node.js, Express.js |
| Scraper | node-html-parser (parsing `t.me/s/`) |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Font | Merriweather (heading), Inter (body) |
| Real-time | Server-Sent Events (SSE) |

## 🚀 Instalasi & Menjalankan

### Prasyarat

- [Node.js](https://nodejs.org/) versi 18 atau lebih baru

### Langkah

```bash
# 1. Clone atau download repository
git clone https://github.com/username/telemirror-news.git
cd telemirror-news

# 2. Install dependencies
cd server
npm install

# 3. Jalankan server
npm start
```

Buka **http://localhost:3001** di browser.

### Mode Development

```bash
cd server
npm run dev
```

Server akan otomatis restart saat file berubah (menggunakan `--watch`).

## 📋 Cara Pakai

1. Buka website di browser
2. Klik ikon **⚙️** di kanan atas (topbar)
3. Masukkan username channel Telegram publik (contoh: `durov`, `telegram`)
4. Klik **Tambahkan**
5. Berita akan otomatis muncul dan di-refresh secara real-time

## 📁 Struktur Proyek

```
telemirror-news/
├── index.html          # Halaman utama (news portal)
├── style.css           # Styling (light theme, responsive)
├── app.js              # Frontend logic (SSE, rendering, reader)
├── server/
│   ├── package.json    # Dependencies
│   ├── index.js        # Express server + SSE endpoint
│   └── scraper.js      # Telegram channel scraper
├── README.md
├── LICENSE
└── .gitignore
```

## ⚙️ Konfigurasi

| Environment Variable | Default | Deskripsi |
|---------------------|---------|-----------|
| `PORT` | `3001` | Port server |

Contoh:

```bash
PORT=8080 npm start
```

## 🔧 API Endpoints

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/api/posts?channel=name` | GET | Ambil post dari satu channel |
| `/api/multi?channels=a,b,c` | GET | Ambil post dari beberapa channel |
| `/api/stream?channels=a,b` | GET | SSE stream untuk post baru real-time |

## ⚠️ Limitasi

- Hanya mendukung channel Telegram **publik**
- Menampilkan ~20 post terbaru per channel (batasan web preview Telegram)
- Channel dengan "Restrict saving content" mungkin tidak bisa di-scrape
- Rate limiting dari Telegram jika terlalu sering request

## 📄 Lisensi

Proyek ini dilisensikan di bawah [MIT License](LICENSE).
