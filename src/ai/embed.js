// src/ai/embed.js
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const MODEL = "@cf/baai/bge-m3";

async function embedBatch(texts) {
	const url =
		"https://api.cloudflare.com/client/v4/accounts/" +
		CF_ACCOUNT_ID +
		"/ai/run/" +
		MODEL;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: "Bearer " + CF_API_TOKEN,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ text: texts }),
	});
	if (!res.ok) {
		const t = await res.text();
		throw new Error("CF embed " + res.status + ": " + t.slice(0, 200));
	}
	const json = await res.json();
	const data = json && json.result && json.result.data;
	if (!Array.isArray(data)) throw new Error("CF embed: respons tak terduga");
	return data; // array berisi array 1024 angka
}

// embed banyak teks, dibatch + retry
async function embedTexts(texts, batchSize = 50) {
	const out = [];
	for (let i = 0; i < texts.length; i += batchSize) {
		const batch = texts.slice(i, i + batchSize);
		let tries = 0;
		while (true) {
			try {
				const vecs = await embedBatch(batch);
				out.push(...vecs);
				break;
			} catch (e) {
				tries++;
				if (tries >= 3) throw e;
				await new Promise((r) => setTimeout(r, 2000 * tries));
			}
		}
	}
	return out;
}

module.exports = { embedTexts };