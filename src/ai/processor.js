require('dotenv').config();
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const client = new OpenAI({
  apiKey: process.env.ZAI_API_KEY,
  baseURL: 'https://api.z.ai/api/paas/v4'
});

// === Daftar channel sosmed berisiko tinggi (hoax/propaganda) ===
// Nama HARUS sama persis dengan "name" di config/rss-sources.json
const RISIKO_TINGGI = [
  'Telegram - Disclose.tv',
  'Telegram - Intel Slava Z',
  'Telegram - RT News',
  'Telegram - Zero Hedge'
];

// Redam skor + beri penanda untuk artikel kategori sosmed
function terapkanTierSosmed(result, berita, category) {
  if (category !== 'sosmed') return result;
  const skor = Number(result.skor) || 0;
  if (RISIKO_TINGGI.includes(berita.source)) {
    // Tier 2: risiko tinggi -> diredam kuat (x0.4, maks 4) + tanda peringatan
    result.skor = Math.min(Math.round(skor * 0.4), 4);
    result.ringkasan = '🚩 SUMBER BERISIKO TINGGI — wajib verifikasi ulang. ' + (result.ringkasan || '');
  } else {
    // Tier 1: sosmed biasa -> diredam sedang (x0.6, maks 6) + tanda hati-hati
    result.skor = Math.min(Math.round(skor * 0.6), 6);
    result.ringkasan = '⚠️ Belum terverifikasi. ' + (result.ringkasan || '');
  }
  return result;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callOpenAIWithRetry(berita, retryCount = 0) {
  try {
    const completion = await client.chat.completions.create({
      messages: [{
        role: "system",
        content: `Anda adalah analis makro. Analisis berita berikut. Berikan skor dampak 1-10 bagi investor/analis makro.
Skor 8-10: Berita kebijakan penting, perubahan harga komoditas signifikan, eskalasi geopolitik, data makro penting yang baru dan mendesak.
Skor 1-3: Artikel evergreen, edukasi, seremonial, berita ulang tahun, atau tidak mendesak.
Ekstraksi lokasi:
- Ambil tempat PALING SPESIFIK: kota/kabupaten/provinsi + negara. Contoh: "Morowali, Sulawesi Tengah, Indonesia", "Tanjung Priok, Jakarta, Indonesia", "Washington, USA".
- Untuk lokasi Indonesia, SELALU akhiri dengan ", Indonesia".
- Gunakan "Indonesia (Nasional)" HANYA jika berita berskala nasional tanpa lokasi spesifik (mis. kebijakan suku bunga BI, APBN).
- Gunakan "Global" hanya untuk isu lintas-negara tanpa titik lokasi spesifik.
Ekstraksi entitas:
- array 1-4 tag kunci (komoditas/perusahaan/negara).
Balas HANYA JSON: {"ringkasan": "...", "skor": N, "location": "...", "entities": ["..."]}`
      }, {
        role: "user",
        content: `Judul: ${berita.title}`
      }],
      model: 'glm-4.7-flash',
      response_format: { type: "json_object" }
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (e) {
    if (e.status === 429 && retryCount < 3) {
      console.log(`Rate limited (429). Menunggu 30 detik sebelum mencoba ulang (percobaan ${retryCount + 1})...`);
      await sleep(30000);
      return callOpenAIWithRetry(berita, retryCount + 1);
    }
    throw e;
  }
}

async function prosesBerita() {
  const categories = ['indonesia', 'geopolitik', 'komoditas', 'sosmed'];
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  let totalBerhasil = 0;
  for (const category of categories) {
    console.log(`--- Memproses kategori: ${category} ---`);

    // Ambil berita yang belum lengkap: ringkasan OR lokasi kosong
    const { data: beritaList, error: fetchError } = await supabase
      .from('articles')
      .select('*')
      .eq('category', category)
      .gte('pub_date', fourteenDaysAgo.toISOString())
      .or('summary.is.null,location.is.null')
      .order('pub_date', { ascending: false })
      .limit(10);
    if (fetchError) {
      console.error(`Gagal fetch ${category}:`, fetchError);
      continue;
    }
    for (const berita of beritaList) {
      try {
        const result = await callOpenAIWithRetry(berita);

        // Terapkan tier sosmed (redam skor + tanda peringatan) SEBELUM disimpan
        terapkanTierSosmed(result, berita, category);

        await supabase
          .from('articles')
          .update({
            summary: result.ringkasan,
            impact_score: result.skor,
            location: result.location,
            entities: JSON.stringify(result.entities),
            processed: true
          })
          .eq('id', berita.id);
        console.log(`${berita.title} -> skor ${result.skor} | lokasi: ${result.location} | entitas: [${result.entities.join(', ')}]`);

        totalBerhasil++;
        await sleep(3000); // Throttling 3 detik
      } catch (e) {
        console.error(`Gagal proses ${berita.title}: ${e.message}`);
      }
    }
  }
  return totalBerhasil;
}

module.exports = { prosesBerita };