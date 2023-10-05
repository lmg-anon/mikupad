export async function tokenize({ endpoint, signal, ...options }) {
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

export async function* completion({ endpoint, signal, ...options }) {
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

	// Basic spec-compliant text/event-stream parser
	let buf = '';
	let ignoreNextLf = false;
	for await (let chunk of res.body.pipeThrough(new TextDecoderStream())) {
		// A CRLF could be split between chunks, so if the last chunk ended in
		// CR and this chunk started with LF, trim the LF
		if (ignoreNextLf && /^\n/.test(chunk))
			chunk = chunk.slice(1);
		ignoreNextLf = /\r$/.test(chunk);

		// Event streams must be parsed line-by-line (ending in CR, LF or CRLF)
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