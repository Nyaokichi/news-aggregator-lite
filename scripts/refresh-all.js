require("dotenv").config();
const { fetchAllRssFeeds } = require("../src/fetchers/rssFetcher");
const { fetchBMKG } = require("../src/fetchers/bmkgFetcher");
const { simpanBerita } = require("../src/database/db");
const { prosesBerita } = require("../src/ai/processor");
const { runGeocoding } = require("../src/geo/geocode");
const { embedTexts } = require("../src/ai/embed"); // ← BARU

// === Supabase client untuk tahap embedding ===
// (pakai kredensial yang sama dengan modul lain)
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_KEY,
);

// === BARU: tahap embedding ===
async function runEmbeddings() {
	const MAX_PER_RUN = 100; // batasi agar runtime aman
	const since = new Date(Date.now() - 14 * 864e5).toISOString();

	const { data: rows, error } = await supabase
		.from("articles")
		.select("link,title,summary")
		.is("embedding", null)
		.gte("pub_date", since)
		.order("pub_date", { ascending: false })
		.limit(MAX_PER_RUN);

	if (error) {
		console.error("Embedding query gagal:", error.message);
		return;
	}
	if (!rows || !rows.length) {
		console.log("Embedding: tidak ada berita baru");
		return;
	}

	const texts = rows.map((r) =>
		((r.title || "") + ". " + (r.summary || "")).slice(0, 1000),
	);

	let vecs;
	try {
		vecs = await embedTexts(texts);
	} catch (e) {
		console.error("Embedding gagal:", e.message);
		return; // jangan hentikan pipeline
	}

	for (let i = 0; i < rows.length; i++) {
		const vecStr = "[" + vecs[i].join(",") + "]"; // format pgvector
		const { error: upErr } = await supabase
			.from("articles")
			.update({ embedding: vecStr })
			.eq("link", rows[i].link);
		if (upErr) console.error("Update embedding gagal:", upErr.message);
	}
	console.log("Embedding: " + rows.length + " berita diproses");
}

async function runAll() {
	console.log("--- Memulai proses: Ambil RSS & BMKG ---");
	try {
		const rssArticles = await fetchAllRssFeeds();
		const bmkgArticles = await fetchBMKG();

		const allArticles = [...rssArticles, ...bmkgArticles];
		await simpanBerita(allArticles);
		console.log(
			`Berhasil mengambil & menyimpan ${rssArticles.length} RSS dan ${bmkgArticles.length} BMKG berita.`,
		);
	} catch (error) {
		console.error("Gagal mengambil data:", error);
		process.exit(1);
	}

	console.log("\n--- Memulai proses: Analisis AI ---");
	try {
		await prosesBerita();
		console.log("Berhasil memproses AI.");
	} catch (error) {
		console.error("Gagal memproses AI:", error);
		process.exit(1);
	}

	console.log("\n--- Memulai proses: Embedding ---"); // ← BARU
	try {
		await runEmbeddings();
		console.log("Berhasil membuat embedding.");
	} catch (error) {
		console.error("Gagal membuat embedding:", error);
		// sengaja TIDAK process.exit(1) — biar geocode tetap jalan
	}

	console.log("\n--- Memulai proses: Geocode ---");
	try {
		await runGeocoding();
		console.log("Berhasil melakukan geocode.");
	} catch (error) {
		console.error("Gagal melakukan geocode:", error);
		process.exit(1);
	}

	console.log("\nSemua proses selesai dengan sukses.");
	process.exit(0);
}

runAll();