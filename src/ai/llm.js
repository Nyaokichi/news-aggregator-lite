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
		body: JSON.stringify({
		  messages,
		  max_tokens: 2500,
		  response_format: { type: "json_object" }, // paksa keluaran JSON valid
		}),
	  });
	  if (!resp.ok) {
		const errTxt = await resp.text();
		throw new Error(`CF ${resp.status}: ${errTxt.slice(0, 200)}`);
	  }
	  const json = await resp.json();
	  let out = json && json.result ? json.result.response : "";
	  // Cloudflare bisa balas string ATAU objek (mode JSON) — samakan jadi string
	  if (out && typeof out === "object") out = JSON.stringify(out);
	  return typeof out === "string" ? out : "";
	} catch (e) {
	  if (retry < 2) {
		await sleep(3000 * (retry + 1));
		return chatJSON(messages, retry + 1);
	  }
	  throw e;
	}
  }

module.exports = { chatJSON, MODEL };