require("dotenv").config();
const { fetchAllRssFeeds } = require("../src/fetchers/rssFetcher");
const { fetchBMKG } = require("../src/fetchers/bmkgFetcher");
const { simpanBerita } = require("../src/database/db");
const { prosesBerita } = require("../src/ai/processor");
const { runGeocoding } = require("../src/geo/geocode");
const { embedTexts } = require("../src/ai/embed");

// === Supabase client untuk tahap embedding & clustering ===
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_KEY,
);

// === Tahap embedding ===
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

// === BARU: tahap clustering (pgvector) ===
async function runClustering() {
	const THRESHOLD = 0.8; // skor kemiripan minimum (0–1). Turunkan = lebih banyak gabung
	const WINDOW_H = 48; // hanya gabungkan berita dalam rentang 48 jam
	const MAX_PER_RUN = 300;

	const { data: rows, error } = await supabase
		.from("articles")
		.select("link,category,pub_date,embedding")
		.not("embedding", "is", null)
		.is("cluster_id", null)
		.order("pub_date", { ascending: true }) // lama → baru, biar induk = yang lebih dulu
		.limit(MAX_PER_RUN);

	if (error) {
		console.error("Clustering query gagal:", error.message);
		return;
	}
	if (!rows || !rows.length) {
		console.log("Clustering: tidak ada yang baru");
		return;
	}

	let created = 0;
	let joined = 0;
	for (const art of rows) {
		const since = new Date(
			Date.parse(art.pub_date) - WINDOW_H * 3600e3,
		).toISOString();

		const { data: match, error: mErr } = await supabase.rpc("match_cluster", {
			p_embedding: art.embedding,
			p_category: art.category,
			p_since: since,
			p_exclude_link: art.link,
		});
		if (mErr) {
			console.error("match_cluster gagal:", mErr.message);
			continue;
		}

		const best = match && match[0];
		let payload;
		if (best && best.cluster_id && best.similarity >= THRESHOLD) {
			payload = { cluster_id: best.cluster_id, is_primary: false }; // gabung
			joined++;
		} else {
			payload = { cluster_id: art.link, is_primary: true }; // induk cluster baru
			created++;
		}

		const { error: upErr } = await supabase
			.from("articles")
			.update(payload)
			.eq("link", art.link);
		if (upErr) console.error("Update cluster gagal:", upErr.message);
	}
	console.log(`Clustering: ${created} cluster baru, ${joined} gabung`);
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

	console.log("\n--- Memulai proses: Embedding ---");
	try {
		await runEmbeddings();
		console.log("Berhasil membuat embedding.");
	} catch (error) {
		console.error("Gagal membuat embedding:", error);
		// sengaja TIDAK process.exit(1) — biar geocode tetap jalan
	}

	console.log("\n--- Memulai proses: Clustering ---"); // ← BARU
	try {
		await runClustering();
		console.log("Berhasil clustering.");
	} catch (error) {
		console.error("Gagal clustering:", error);
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