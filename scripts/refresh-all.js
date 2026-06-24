require('dotenv').config();

const { fetchRSS } = require('../src/fetchers/rssFetcher');
const { prosesBerita } = require('../src/ai/processor');
const { geocodeBerita } = require('../src/geo/geocode');

async function runAll() {
  console.log('--- Memulai proses: Ambil RSS ---');
  try {
    await fetchRSS();
    console.log('Berhasil mengambil RSS.');
  } catch (error) {
    console.error('Gagal mengambil RSS:', error);
    process.exit(1);
  }

  console.log('\n--- Memulai proses: Analisis AI ---');
  try {
    await prosesBerita();
    console.log('Berhasil memproses AI.');
  } catch (error) {
    console.error('Gagal memproses AI:', error);
    process.exit(1);
  }

  console.log('\n--- Memulai proses: Geocode ---');
  try {
    await geocodeBerita();
    console.log('Berhasil melakukan geocode.');
  } catch (error) {
    console.error('Gagal melakukan geocode:', error);
    process.exit(1);
  }

  console.log('\nSemua proses selesai dengan sukses.');
  process.exit(0);
}

runAll();
