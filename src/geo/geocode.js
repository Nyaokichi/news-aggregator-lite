require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const USER_AGENT = 'DataminrLite/1.0 (iadhityaa@gmail.com)';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeLocation(locationName) {
  try {
    const response = await axios.get(`https://photon.komoot.io/api/`, {
      params: {
        q: locationName,
        limit: 1
      },
      headers: {
        'User-Agent': USER_AGENT
      }
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

  // 1. Ambil lokasi unik yang belum punya koordinat
  const { data: articles, error } = await supabase
    .from('articles')
    .select('location')
    .is('lat', null)
    .gte('pub_date', fourteenDaysAgo.toISOString())
    .not('location', 'in', '("Global", "Indonesia (Nasional)")')
    .not('location', 'is', 'null');

  if (error) {
    console.error('Error fetching locations:', error);
    return;
  }

  const uniqueLocations = [...new Set(articles.map(a => a.location))];
  console.log(`Menemukan ${uniqueLocations.length} lokasi baru untuk geocoding.`);

  for (const location of uniqueLocations) {
    console.log(`Geocoding: ${location}...`);
    const coords = await geocodeLocation(location);

    if (coords) {
      // 3. Update semua artikel dengan lokasi yang sama
      await supabase
        .from('articles')
        .update({ lat: coords.lat, lon: coords.lon })
        .eq('location', location);
      
      console.log(`  -> ${location} ditemukan: ${coords.lat}, ${coords.lon}`);
    } else {
      console.log(`  -> ${location} tidak ditemukan.`);
    }

    // 2. Jeda 1.1 detik agar tidak kena blokir
    await sleep(1100);
  }
  
  console.log('Geocoding selesai.');
}

module.exports = { runGeocoding };
