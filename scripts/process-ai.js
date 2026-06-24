const { prosesBerita } = require('../src/ai/processor');

async function main() {
  console.log("Memulai proses AI...");
  try {
    const total = await prosesBerita();
    console.log(`Selesai. Total berita diproses: ${total}`);
  } catch (error) {
    console.error("Kesalahan fatal:", error);
    process.exit(1);
  }
}

main();
