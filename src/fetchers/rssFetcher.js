const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const parser = new Parser();

const TIMEOUT_MS = 15000; // batas 15 detik per feed
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchFeed(feedConfig) {
  // Ambil teks pakai fetch bawaan + timeout, supaya feed yang menggantung
  // atau error TIDAK bisa menjatuhkan seluruh proses.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(feedConfig.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const text = await res.text();

  // Lewati respons yang jelas bukan XML (mis. jembatan Telegram balas JSON error)
  if (!text.trim().startsWith('<')) {
    throw new Error('Respons bukan XML (kemungkinan halaman error/JSON)');
  }

  const feed = await parser.parseString(text);

  return feed.items
    .map((item) => {
      // Jamin judul selalu ada: pakai title, kalau kosong ambil cuplikan isi.
      const judul =
        (item.title || '').trim() ||
        (item.contentSnippet || item.content || item.summary || '')
          .trim()
          .slice(0, 200);

      return {
        title: judul,
        link: item.link,
        published: item.pubDate,
        source: feedConfig.name,
        category: feedConfig.category,
      };
    })
    // Buang item yang tetap tak punya judul ATAU tak punya link
    // (mencegah error NOT-NULL di database).
    .filter((artikel) => artikel.title && artikel.link);
}

async function fetchAllRssFeeds() {
  const configPath = path.join(__dirname, '../../config/rss-sources.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const feeds = config.feeds;
  const KONKURENSI = 8;            // ambil 8 feed sekaligus
  const allArticles = [];
  let gagal = 0, idx = 0;

  async function worker() {
    while (idx < feeds.length) {
      const feed = feeds[idx++];
      try {
        const articles = await fetchFeed(feed);
        allArticles.push(...articles);
        console.log(`  ✅ ${feed.name}: ${articles.length} berita`);
      } catch (err) {
        gagal++;
        console.log(`  ⚠️ Sumber ${feed.name} dilewati: ${err.message}`);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(KONKURENSI, feeds.length) },
    () => worker()
  );
  await Promise.all(workers);

  console.log(`Selesai. Total berita: ${allArticles.length} | feed dilewati: ${gagal}`);
  return allArticles;
}

module.exports = { fetchAllRssFeeds };