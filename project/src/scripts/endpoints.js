import { EventIterator } from "event-iterator"

export async function tokenize({ endpoint, endpointAPI, signal, ...options }) {
	console.log(endpointAPI);
	switch (endpointAPI) {
		case 0: // llama.cpp
			return await llamaCppTokenize({ endpoint, signal, ...options });
		case 1: // oobabooga
			return await new Promise((resolve) => resolve({ tokens: [] })); // i don't know if ooba support this.
		case 2: // koboldcpp
			return await new Promise((resolve) => resolve({ tokens: [] })); // koboldcpp doesn't support this.
	}
}

export async function* completion({ endpoint, endpointAPI, signal, ...options }) {
	switch (endpointAPI) {
		case 0: // llama.cpp
			return yield* await llamaCppCompletion({ endpoint, signal, ...options });
		case 1: // oobabooga
			return yield* await oobaCompletion({ endpoint, signal, ...options });
		case 2: // koboldcpp
			return yield* await koboldCppCompletion({ endpoint, signal, ...options });
	}
}

export async function abortCompletion({ endpoint, endpointAPI }) {
	switch (endpointAPI) {
		case 2: // koboldcpp
			return await koboldCppAbortCompletion({ endpoint });
	}
}

// Function to parse text/event-stream data and yield JSON objects
async function* parseEventStream(eventStream) {
	let buf = '';
	let ignoreNextLf = false;

	for await (let chunk of eventStream.pipeThrough(new TextDecoderStream())) {
		// A CRLF could be split between chunks, so if the last chunk ended in
		// CR and this chunk started with LF, trim the LF
		if (ignoreNextLf && /^\n/.test(chunk)) {
			chunk = chunk.slice(1);
		}
		ignoreNextLf = /\r$/.test(chunk);

		// Event streams must be parsed line-by-line (ending in CR, LF, or CRLF)
		const lines = (buf + chunk).split(/\n|\r\n?/);
		buf = lines.pop();
		let type, data;

		for (const line of lines) {
			if (!line) {
				// We only emit message-type events for now (and assume JSON)
				if (data && (type || 'message') === 'message') {
					const json = JSON.parse(data);
					// Both Chrome and Firefox suck at debugging
					// text/event-stream, so make it easier by logging events
					console.log('event', json);
					yield json;
				}
				type = undefined;
				data = undefined;
				continue;
			}
			const { name, value } = /^(?<name>.*?)(?:: ?(?<value>.*))?$/s.exec(line).groups;
			switch (name) {
				case 'event':
					type = (value ?? '');
					break;
				case 'data':
					data = data === undefined ? (value ?? '') : `${data}\n${value}`;
					break;
			}
		}
	}
}

async function llamaCppTokenize({ endpoint, signal, ...options }) {
	const res = await fetch(new URL('/tokenize', endpoint), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(options),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	return await res.json();
}

async function* llamaCppCompletion({ endpoint, signal, ...options }) {
	const res = await fetch(new URL('/completion', endpoint), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			...options,
			stream: true,
		}),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	return yield* await parseEventStream(res.body);
}

function oobaConvertOptions(options) {
	const swapOption = (lhs, rhs) => {
		if (lhs in options) {
			options[rhs] = options[lhs];
			delete options[lhs];
		}
	};
	swapOption("n_ctx", "truncation_length");
	swapOption("n_predict", "max_new_tokens");
	swapOption("repeat_penalty", "repetition_penalty");
	swapOption("repeat_last_n", "repetition_penalty_range");
	swapOption("stop", "stopping_strings");
	return options;
}

async function* oobaCompletion({ endpoint, signal, ...options }) {
	const ws = new WebSocket(new URL('/api/v1/stream', endpoint));

	ws.onopen = () => {
		ws.send(JSON.stringify(options));
	};

	const wsStream = () => new EventIterator(
		queue => {
			ws.onmessage = queue.push;
			ws.onclose = queue.stop;
			ws.onerror = queue.fail;
			if (signal) {
				signal.addEventListener("abort", queue.stop);
			}

			return () => {
				ws.close();
				if (signal) {
					signal.removeEventListener("abort", queue.stop);
				}
			}
		}
	);

	for await (const event of wsStream()) {
		const data = JSON.parse(event.data);
		console.log('event', data);

		if (data.event === "text_stream") {
			yield { content: data.text };
		} else if (data.event === "stream_end") {
			break;
		}
	}
}

function koboldCppConvertOptions(options) {
	const swapOption = (lhs, rhs) => {
		if (lhs in options) {
			options[rhs] = options[lhs];
			delete options[lhs];
		}
	};
	swapOption("n_ctx", "max_context_length");
	swapOption("n_predict", "max_tokens");
	swapOption("repeat_penalty", "rep_pen");
	swapOption("repeat_last_n", "rep_pen_range");
	swapOption("tfs_z", "tfs");
	swapOption("typical_p", "typical");
	swapOption("seed", "sampler_seed");
	swapOption("stop", "stop_sequence");
	return options;
}

async function* koboldCppCompletion({ endpoint, signal, ...options }) {
	const res = await fetch(new URL('/api/extra/generate/stream', endpoint), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			...koboldCppConvertOptions(options),
			stream: true,
		}),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	for await (const chunk of parseEventStream(res.body)) {
		yield { content: chunk.token };
	}
}

async function koboldCppAbortCompletion({ endpoint }) {
	await fetch(new URL('/api/extra/abort', endpoint), {
		method: 'POST',
	});
}