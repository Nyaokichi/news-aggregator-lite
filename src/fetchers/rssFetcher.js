const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const parser = new Parser();

async function fetchFeed(feedConfig) {
  const feed = await parser.parseURL(feedConfig.url);
  return feed.items.map((item) => ({
    title: item.title,
    link: item.link,
    published: item.pubDate,
    source: feedConfig.name,
    category: feedConfig.category,
  }));
}

async function fetchAllRssFeeds() {
  const configPath = path.join(__dirname, '../../config/rss-sources.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const allArticles = [];
  for (const feed of config.feeds) {
    console.log(`Mengambil dari: ${feed.name}...`);
    try {
      const articles = await fetchFeed(feed);
      allArticles.push(...articles);
    } catch (err) {
      console.log(`Sumber ${feed.name} tidak bisa diakses`);
    }
  }
  return allArticles;
}

module.exports = { fetchAllRssFeeds };