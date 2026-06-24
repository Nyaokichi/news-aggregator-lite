const { runGeocoding } = require('../src/geo/geocode');

async function main() {
  console.log("Memulai proses Geocoding...");
  await runGeocoding();
  console.log("Selesai.");
}

main();
