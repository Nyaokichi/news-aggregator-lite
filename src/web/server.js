const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { fetchAllRssFeeds } = require('../fetchers/rssFetcher');
const { simpanBerita, ambilBerita } = require('../database/db');
const { prosesBerita } = require('../ai/processor');
const { runGeocoding } = require('../geo/geocode');

const app = express();
const PORT = 3000;

// Fungsi untuk menjalankan seluruh rangkaian tugas
async function runScheduledTasks() {
  const timestamp = new Date().toLocaleTimeString('id-ID');
  console.log(`[Penjadwal ${timestamp}] Memulai tugas otomatis...`);
  try {
    // 1. Ambil RSS
    const articles = await fetchAllRssFeeds();
    await simpanBerita(articles);
    const rssCount = articles.length;

    // 2. Proses AI
    const aiCount = await prosesBerita();

    // 3. Geocoding
    await runGeocoding();
    
    console.log(`[Penjadwal ${timestamp}] RSS: ${rssCount} baru. AI: ${aiCount} diproses. Geocoding selesai.`);
  } catch (error) {
    console.error(`[Penjadwal ${timestamp}] ERROR:`, error.message);
  }
}

// Penjadwal: Setiap 2 jam
cron.schedule('0 */2 * * *', runScheduledTasks);

// Jalankan sekali saat startup (tidak memblokir server karena async)
runScheduledTasks();

app.use(express.static(path.join(__dirname, '../../public')));

// Endpoint untuk memproses berita dengan AI
app.get('/api/process', async (req, res) => {
  try {
    const count = await prosesBerita();
    res.json({ message: `Berhasil memproses ${count} berita` });
  } catch (error) {
    console.error('Error processing news:', error);
    res.status(500).json({ error: 'Gagal memproses berita' });
  }
});

// Endpoint untuk mengambil berita baru dari RSS dan menyimpannya ke DB
app.get('/api/refresh', async (req, res) => {
  try {
    const articles = await fetchAllRssFeeds();
    await simpanBerita(articles);
    res.json({ message: 'Berita berhasil diperbarui ke database' });
  } catch (error) {
    console.error('Error refreshing feeds:', error);
    res.status(500).json({ error: 'Gagal memperbarui berita' });
  }
});

// Endpoint untuk mengambil berita dari database
app.get('/api/news', async (req, res) => {
  try {
    const articles = await ambilBerita();
    res.json(articles);
  } catch (error) {
    console.error('Error fetching news from DB:', error);
    res.status(500).json({ error: 'Gagal mengambil berita' });
  }
});

app.listen(PORT, () => {
  console.log(`Server jalan di http://localhost:${PORT}`);
});
