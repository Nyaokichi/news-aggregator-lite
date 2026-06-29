require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { chatJSON } = require("./llm"); // ← Cloudflare Workers AI (bukan z.ai lagi)

const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_KEY,
);

// === Channel sosmed risiko tinggi (hoax/propaganda) ===
const RISIKO_TINGGI = [
	"Telegram - Disclose.tv",
	"Telegram - Intel Slava Z",
	"Telegram - RT News",
	"Telegram - Zero Hedge",
];

// === Pre-filter: kata kunci berita TIDAK relevan (hemat AI). Boleh Anda edit. ===
const SARING_KELUAR = [
	"world cup", "piala dunia", "fifa", "uefa", "premier league",
	"sepak bola", "sepakbola", "football", "box office", "konser",
	"selebriti", "selebgram", "drakor", "zodiak", "resep masakan", "artis",
	"aktor", "film",
];

function relevan(title) {
	const t = (title || "").toLowerCase();
	if (!t.trim()) return false;
	return !SARING_KELUAR.some((k) => t.includes(k));
}

function terapkanTierSosmed(result, berita, category) {
	if (category !== "sosmed") return result;
	const skor = Number(result.skor) || 0;
	if (RISIKO_TINGGI.includes(berita.source)) {
		result.skor = Math.min(Math.round(skor * 0.4), 4);
		result.ringkasan =
			"🚩 SUMBER BERISIKO TINGGI — wajib verifikasi ulang. " +
			(result.ringkasan || "");
	} else {
		result.skor = Math.min(Math.round(skor * 0.6), 6);
		result.ringkasan = "⚠️ Belum terverifikasi. " + (result.ringkasan || "");
	}
	return result;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Parse JSON defensif (model kadang membungkus teks / pakai ```json)
// Parse JSON defensif (model kadang membungkus teks / pakai ```json / balas objek)
function parseJSONAman(txt) {
	if (!txt) return null;
	// Sudah berupa objek (mis. dari mode JSON Cloudflare) — langsung pakai
	if (typeof txt === "object") return txt;
	// Bukan string & bukan objek — tak bisa diparse
	if (typeof txt !== "string") return null;
	try { return JSON.parse(txt); } catch (e) {}
	const s = txt.indexOf("{");
	const e2 = txt.lastIndexOf("}");
	if (s !== -1 && e2 !== -1 && e2 > s) {
	  try { return JSON.parse(txt.slice(s, e2 + 1)); } catch (e) {}
	}
	return null;
  }

const SISTEM = `Anda analis makro. Untuk SETIAP berita (dikenali dari "nomor"), berikan:
- skor: dampak 1-10 bagi investor/analis makro.
  Skor 8-10: kebijakan penting, perubahan harga komoditas signifikan, eskalasi geopolitik, data makro penting & mendesak.
  Skor 1-3: evergreen, edukasi, seremonial, ulang tahun, tidak mendesak.
- ringkasan: 1 kalimat ringkas.
- location: tempat PALING SPESIFIK (kota/kabupaten/provinsi + negara). Untuk Indonesia akhiri ", Indonesia". Pakai "Indonesia (Nasional)" jika nasional tanpa lokasi spesifik. Pakai "Global" untuk isu lintas-negara tanpa titik spesifik.
- entities: array 1-4 tag kunci (komoditas/perusahaan/negara).
Balas HANYA JSON valid persis: {"hasil":[{"nomor":1,"ringkasan":"...","skor":N,"location":"...","entities":["..."]}]}`;

async function prosesBatch(batch) {
	const daftar = batch
		.map((b, i) => `${i + 1}. ${b.title || "(tanpa judul)"}`)
		.join("\n");
	const txt = await chatJSON([
		{ role: "system", content: SISTEM },
		{ role: "user", content: `Berita:\n${daftar}` },
	]);
	const obj = parseJSONAman(txt);
	const arr = Array.isArray(obj)
		? obj
		: obj && Array.isArray(obj.hasil)
			? obj.hasil
			: [];
	const out = {};
	arr.forEach((r, i) => {
		const n = Number(r && r.nomor) || i + 1;
		out[n] = r;
	});
	return out;
}

async function prosesBerita() {
	const categories = ["indonesia", "geopolitik", "komoditas", "sosmed"];
	const fourteenDaysAgo = new Date();
	fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

	const START = Date.now();
	const MAX_MS = 25 * 60 * 1000;       // anggaran 25 menit
	const MAX_PER_KATEGORI = 20;          // cakupan per kategori per run (naik dari 10)
	const BATCH = 8;                      // jumlah berita per panggilan AI

	let totalBerhasil = 0;
	let totalSaring = 0;

	for (const category of categories) {
		if (Date.now() - START > MAX_MS) {
			console.log("⏱️ Anggaran waktu AI habis — lanjut ke tahap berikutnya.");
			break;
		}
		console.log(`--- Memproses kategori: ${category} ---`);

		const { data: beritaList, error: fetchError } = await supabase
			.from("articles")
			.select("*")
			.eq("category", category)
			.gte("pub_date", fourteenDaysAgo.toISOString())
			.or("summary.is.null,location.is.null")
			.order("pub_date", { ascending: false })
			.limit(MAX_PER_KATEGORI);

		if (fetchError) { console.error(`Gagal fetch ${category}:`, fetchError); continue; }
		if (!beritaList || !beritaList.length) { console.log(`(${category}) tidak ada berita baru.`); continue; }

		// --- Pre-filter: singkirkan yang jelas tak relevan TANPA panggil AI ---
		const layak = [];
		for (const b of beritaList) {
			if (relevan(b.title)) {
				layak.push(b);
			} else {
				await supabase
					.from("articles")
					.update({
						summary: "(disaring otomatis: tidak relevan)",
						impact_score: 1,
						location: "Global",
						entities: JSON.stringify([]),
						processed: true,
					})
					.eq("id", b.id);
				totalSaring++;
			}
		}

		// --- Proses sisanya per BATCH ---
		for (let i = 0; i < layak.length; i += BATCH) {
			if (Date.now() - START > MAX_MS) {
				console.log("⏱️ Anggaran waktu AI habis — berhenti memproses.");
				break;
			}
			const batch = layak.slice(i, i + BATCH);
			try {
				const hasil = await prosesBatch(batch);
				for (let j = 0; j < batch.length; j++) {
					const berita = batch[j];
					const r = hasil[j + 1];
					if (!r) { console.log(`  (tak ada hasil) ${berita.title}`); continue; }
					const result = {
						ringkasan: r.ringkasan || "",
						skor: Number(r.skor) || 1,
						location: r.location || "Global",
						entities: Array.isArray(r.entities) ? r.entities : [],
					};
					terapkanTierSosmed(result, berita, category);
					await supabase
						.from("articles")
						.update({
							summary: result.ringkasan,
							impact_score: result.skor,
							location: result.location,
							entities: JSON.stringify(result.entities),
							processed: true,
						})
						.eq("id", berita.id);
					console.log(
						`${berita.title} -> skor ${result.skor} | lokasi: ${result.location} | entitas: [${result.entities.join(", ")}]`,
					);
					totalBerhasil++;
				}
			} catch (e) {
				console.error(`Gagal proses batch: ${e.message}`);
			}
			await sleep(1500); // jeda kecil antar-batch
		}
	}

	console.log(`AI selesai: ${totalBerhasil} diproses, ${totalSaring} disaring.`);
	return totalBerhasil;
}

module.exports = { prosesBerita };