require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const USER_AGENT = 'DataminrLite/1.0 (iadhityaa@gmail.com)';

// Batas lokasi yang di-geocode per run, supaya run cepat selesai & tidak
// kena batas waktu 30 menit. Sisa lokasi diambil di run berikutnya.
const MAX_LOKASI_PER_RUN = 40;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeLocation(locationName) {
  try {
    const response = await axios.get(`https://photon.komoot.io/api/`, {
      params: { q: locationName, limit: 1 },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000, // batas 10 detik per permintaan, biar tidak menggantung
    });
    if (response.data && response.data.features && response.data.features.length > 0) {
      const [lon, lat] = response.data.features[0].geometry.coordinates;
      return { lat, lon };
    }
  } catch (error) {
    console.error(`Error geocoding ${locationName}:`, error.message);
  }
  return null;
}

async function runGeocoding() {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // 1. Ambil lokasi yang belum punya koordinat (yang terbaru lebih dulu)
  const { data: articles, error } = await supabase
    .from('articles')
    .select('location')
    .is('lat', null)
    .gte('pub_date', fourteenDaysAgo.toISOString())
    .not('location', 'in', '("Global", "Indonesia (Nasional)")')
    .not('location', 'is', 'null')
    .order('pub_date', { ascending: false });

  if (error) {
    console.error('Error fetching locations:', error);
    return;
  }

  // Lokasi unik (urutan terbaru dipertahankan), lalu DIBATASI per run.
  const semuaLokasiUnik = [...new Set(articles.map(a => a.location))];
  const uniqueLocations = semuaLokasiUnik.slice(0, MAX_LOKASI_PER_RUN);

  console.log(
    `Total lokasi belum ber-koordinat: ${semuaLokasiUnik.length}. ` +
    `Diproses run ini: ${uniqueLocations.length} (sisanya menyusul run berikutnya).`
  );

  for (const location of uniqueLocations) {
    console.log(`Geocoding: ${location}...`);
    const coords = await geocodeLocation(location);
    if (coords) {
      // Update semua artikel dengan lokasi yang sama
      await supabase
        .from('articles')
        .update({ lat: coords.lat, lon: coords.lon })
        .eq('location', location);

      console.log(`  -> ${location} ditemukan: ${coords.lat}, ${coords.lon}`);
    } else {
      console.log(`  -> ${location} tidak ditemukan.`);
    }
    // Jeda 1,1 detik agar tidak kena blokir
    await sleep(1100);
  }

  console.log('Geocoding selesai (batch ini).');
}

module.exports = { runGeocoding };