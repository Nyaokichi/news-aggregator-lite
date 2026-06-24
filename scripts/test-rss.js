const { fetchAllRssFeeds } = require('../src/fetchers/rssFetcher');

async function main() {
  const articles = await fetchAllRssFeeds();
  console.log(`\nTotal berita: ${articles.length}\n`);

  articles.slice(0, 5).forEach((article, index) => {
    console.log(`${index + 1}. [${article.source}] ${article.title}`);
  });
}

main().catch((err) => {
  console.error('Gagal:', err.message);
});