// src/ai/llm.js — pemanggil LLM via Cloudflare Workers AI (gratis, stabil)
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast"; // cepat & hemat; ganti ke @cf/meta/llama-3.3-70b-instruct-fp8-fast utk lebih pintar

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function chatJSON(messages, retry = 0) {
	const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${MODEL}`;
	try {
		const resp = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: "Bearer " + CF_API_TOKEN,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ messages, max_tokens: 2500 }),
		});
		if (!resp.ok) {
			const txt = await resp.text();
			throw new Error(`CF ${resp.status}: ${txt.slice(0, 200)}`);
		}
		const json = await resp.json();
		return (json && json.result && json.result.response) || "";
	} catch (e) {
		if (retry < 2) {
			await sleep(3000 * (retry + 1));
			return chatJSON(messages, retry + 1);
		}
		throw e;
	}
}

module.exports = { chatJSON, MODEL };