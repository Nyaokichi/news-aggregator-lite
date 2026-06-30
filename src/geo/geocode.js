require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const USER_AGENT = 'DataminrLite/1.0 (iadhityaa@gmail.com)';

// Batas lokasi yang di-geocode per run, supaya run cepat selesai & tidak
// kena batas waktu 30 menit. Sisa lokasi diambil di run berikutnya.
const MAX_LOKASI_PER_RUN = 40;

// === Penerjemah lokasi ID -> internasional, agar Photon mengenali ===
const NEGARA_ID_EN = {
  "tiongkok": "China", "cina": "China", "rrt": "China",
  "jepang": "Japan", "korea selatan": "South Korea", "korea utara": "North Korea",
  "inggris": "United Kingdom", "britania raya": "United Kingdom", "skotlandia": "Scotland",
  "jerman": "Germany", "prancis": "France", "perancis": "France",
  "belanda": "Netherlands", "belgia": "Belgium", "spanyol": "Spain",
  "italia": "Italy", "yunani": "Greece", "swiss": "Switzerland", "austria": "Austria",
  "polandia": "Poland", "ceko": "Czechia", "hungaria": "Hungary", "irlandia": "Ireland",
  "swedia": "Sweden", "norwegia": "Norway", "denmark": "Denmark", "finlandia": "Finland",
  "rusia": "Russia", "ukraina": "Ukraine", "turki": "Turkey", "suriah": "Syria",
  "mesir": "Egypt", "arab saudi": "Saudi Arabia", "uni emirat arab": "United Arab Emirates",
  "amerika serikat": "United States", "as": "United States", "afrika selatan": "South Africa",
  "selandia baru": "New Zealand", "filipina": "Philippines", "kanada": "Canada",
  "brasil": "Brazil", "meksiko": "Mexico", "kolombia": "Colombia", "kamboja": "Cambodia",
  "singapura": "Singapore", "thailand": "Thailand", "myanmar": "Myanmar", "india": "India",
};
const KOTA_ID_EN = {
  "jenewa": "Geneva", "damaskus": "Damascus", "kairo": "Cairo",
  "moskwa": "Moscow", "moskow": "Moscow", "den haag": "The Hague",
  "muenchen": "Munich", "munchen": "Munich", "roma": "Rome", "wina": "Vienna",
  "praha": "Prague", "warsawa": "Warsaw", "lisabon": "Lisbon", "athena": "Athens",
};
// Label tak layak peta (placeholder/region samar/event) -> dilewati
const LOKASI_SAMPAH = /(tidak disebutkan|tidak diketahui|^lokal\b|forum|expo|^(global|dunia|asia|asia selatan|asia tenggara|timur tengah|amerika latin|eropa|afrika)$)/i;

function normalisasiLokasi(loc) {
  return loc.split(",").map(s => s.trim()).filter(Boolean).map(b => {
    const low = b.toLowerCase();
    return NEGARA_ID_EN[low] || KOTA_ID_EN[low] || b;
  }).join(", ");
}

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
  const bersih = semuaLokasiUnik.filter(
  loc => loc && loc.trim().length > 1 && !LOKASI_SAMPAH.test(loc)
);
  const uniqueLocations = bersih.slice(0, MAX_LOKASI_PER_RUN);

  console.log(
    `Total lokasi belum ber-koordinat: ${bersih.length}. ` +
    `Diproses run ini: ${uniqueLocations.length} (sisanya menyusul run berikutnya).`
  );

  for (const location of uniqueLocations) {
    const query = normalisasiLokasi(location);
    console.log(`Geocoding: ${location} (cari: ${query})...`);
    const coords = await geocodeLocation(query);
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