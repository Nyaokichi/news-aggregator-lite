const OpenAI = require("openai");

// ⚠️ Pakai model yang SAMA dengan yang ada di src/ai/processor.js Anda
const MODEL = "glm-4.7-flash";

const client = new OpenAI({
	apiKey: process.env.ZAI_API_KEY,
	baseURL: "https://api.z.ai/api/paas/v4",
	timeout: 40000,
	maxRetries: 0,
});

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function callWithRetry(messages, retry = 0) {
	try {
		return await client.chat.completions.create({
			model: MODEL,
			messages,
			response_format: { type: "json_object" },
			timeout: 40000,
		});
	} catch (e) {
		const status = e && (e.status || e.statusCode);
		const transient =
			status === 429 ||
			(status >= 500 && status < 600) ||
			(e && (e.name === "APIConnectionTimeoutError" || e.name === "APIConnectionError"));
		if (transient && retry < 2) {
			await sleep(status === 429 ? 15000 : 3000);
			return callWithRetry(messages, retry + 1);
		}
		throw e;
	}
}

// members = array berita SATU cluster, urut lama -> baru
async function generateNarrative(members) {
	const daftar = members
		.map((m, i) => {
			const tgl = String(m.pub_date || "").slice(0, 16).replace("T", " ");
			const ring = m.summary ? " — " + m.summary : "";
			return `${i + 1}. [${tgl}] (${m.source || "?"}) ${m.title || ""}${ring}`;
		})
		.join("\n");

	const prompt = `Anda editor berita. Berita-berita berikut membahas SATU peristiwa yang sama. Rangkum jadi satu cerita.

Berita (urut waktu, lama ke baru):
${daftar}

Balas HANYA JSON valid dengan format:
{
  "title": "judul peristiwa ringkas, maksimal 12 kata, bahasa Indonesia",
  "summary": "ringkasan 1 kalimat inti peristiwa",
  "timeline": [
    { "waktu": "tanggal singkat mis. 27 Jun", "teks": "perkembangan singkat" }
  ]
}
Aturan: timeline maksimal 5 poin, urut lama ke baru, ringkas, faktual, tanpa opini.`;

	const resp = await callWithRetry([
		{ role: "system", content: "Anda asisten yang HANYA membalas JSON valid." },
		{ role: "user", content: prompt },
	]);

	const txt = (resp.choices && resp.choices[0] && resp.choices[0].message.content) || "{}";
	let obj = null;
	try {
		obj = JSON.parse(txt);
	} catch (e) {
		obj = null;
	}
	if (!obj || !obj.title) return null;

	return {
		title: String(obj.title).slice(0, 140),
		summary: String(obj.summary || "").slice(0, 300),
		timeline: Array.isArray(obj.timeline)
			? obj.timeline.slice(0, 5).map((t) => ({
					waktu: String((t && t.waktu) || "").slice(0, 40),
					teks: String((t && t.teks) || "").slice(0, 200),
				}))
			: [],
	};
}

module.exports = { generateNarrative };