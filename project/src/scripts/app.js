import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { html } from 'htm/react';
import { tokenize, completion } from './endpoints.js';
import { InputBox, SelectBox, Checkbox } from './components.js'

const defaultPrompt = `[INST] <<SYS>>
You are a talented writing assistant. Always respond by incorporating the instructions into expertly written prose that is highly detailed, evocative, vivid and engaging.
<</SYS>>

Write a story about Hatsune Miku and Kagamine Rin. [/INST]  Sure, how about this:

Chapter 1
`;

function joinPrompt(prompt) {
	return prompt.map(p => p.content).join('');
}

export function App() {
	const promptArea = useRef();
	const promptOverlay = useRef();
	const [currentPromptChunk, setCurrentPromptChunk] = useState(undefined);
	const [cancel, setCancel] = useState(null);
	const [endpoint, setEndpoint] = useState('http://localhost:8080');
	const [prompt, setPrompt] = useState(() => [{ type: 'user', content: defaultPrompt }]);
	const [temperature, setTemperature] = useState(0.7); // llama.cpp default 0.8
	const [repeatPenalty, setRepeatPenalty] = useState(1.1);
	const [repeatLastN, setRepeatLastN] = useState(256); // llama.cpp default 64
	const [penalizeNl, setPenalizeNl] = useState(true);
	const [presencePenalty, setPresencePenalty] = useState(0);
	const [frequencyPenalty, setFrequencyPenalty] = useState(0);
	const [topK, setTopK] = useState(40);
	const [topP, setTopP] = useState(0.95);
	const [typicalP, setTypicalP] = useState(1);
	const [tfsZ, setTfsZ] = useState(1);
	const [mirostat, setMirostat] = useState(2); // llama.cpp default 0
	const [mirostatTau, setMirostatTau] = useState(5.0);
	const [mirostatEta, setMirostatEta] = useState(0.1);
	const [ignoreEos, setIgnoreEos] = useState(false);
	const [tokens, setTokens] = useState(0);

	const promptText = useMemo(() => joinPrompt(prompt), [prompt]);

	async function predict(prompt = promptText) {
		const ac = new AbortController();
		const cancel = () => ac.abort();
		setCancel(() => cancel);
		try {
			const { tokens } = await tokenize({
				endpoint,
				content: ` ${prompt}`,
				signal: ac.signal,
			});
			setTokens(tokens.length + 1);

			for await (const chunk of completion({
				endpoint,
				prompt,
				temperature,
				repeat_penalty: repeatPenalty,
				repeat_last_n: repeatLastN,
				penalize_nl: penalizeNl,
				presence_penalty: presencePenalty,
				frequency_penalty: frequencyPenalty,
				mirostat,
				...(mirostat ? {
					mirostat_tau: mirostatTau,
					mirostat_eta: mirostatEta,
				} : {
					top_k: topK,
					top_p: topP,
					typical_p: typicalP,
					tfs_z: tfsZ,
				}),
				ignore_eos: ignoreEos,
				n_probs: 10,
				signal: ac.signal,
			})) {
				ac.signal.throwIfAborted();
				if (!chunk.content)
					continue;
				setPrompt(p => [...p, chunk]);
				setTokens(t => t + (chunk?.completion_probabilities?.length ?? 1));
			}
		} catch (e) {
			if (e.name !== 'AbortError')
				reportError(e);
		} finally {
			setCancel(c => c === cancel ? null : c);
		}
	}

	// Update the textarea in an uncontrolled way so the user doesn't lose their
	// selection or cursor position during prediction
	useEffect(() => {
		const elem = promptArea.current;
		if (elem.value === promptText) {
			return;
		} else if (promptText.startsWith(elem.value)) {
			const oldHeight = elem.scrollHeight;
			const atBottom = elem.scrollTop + elem.clientHeight + 1 > oldHeight;
			const oldLen = elem.value.length;
			elem.setRangeText(promptText.slice(oldLen), oldLen, oldLen, 'preserve');
			const newHeight = elem.scrollHeight;
			if (atBottom && oldHeight !== newHeight) {
				elem.scrollTo({
					top: newHeight - elem.clientHeight,
					behavior: 'smooth',
				});
			}
		} else {
			elem.value = promptText;
		}
	}, [promptText]);

	useEffect(() => {
		if (cancel)
			return;
		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
				const { tokens } = await tokenize({
					endpoint,
					content: ` ${promptText}`,
					signal: ac.signal,
				});
				setTokens(tokens.length + 1);
			} catch (e) {
				if (e.name !== 'AbortError')
					reportError(e);
			}
		}, 500);
		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [promptText, cancel]);

	useEffect(() => {
		function onKeyDown(e) {
			const { altKey, ctrlKey, shiftKey, key, defaultPrevented } = e;
			if (defaultPrevented)
				return;
			switch (`${altKey}:${ctrlKey}:${shiftKey}:${key}`) {
			case 'false:false:true:Enter':
			case 'false:true:false:Enter':
				predict();
				break;
			case 'false:false:false:Escape':
				cancel();
				break;
			default:
				return;
			}
			e.preventDefault();
		}

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [predict, cancel]);

	function onInput({ target }) {
		setPrompt(oldPrompt => {
			const start = [];
			const end = [];
			oldPrompt = [...oldPrompt];
			let newValue = target.value;

			while (oldPrompt.length) {
				const chunk = oldPrompt[0];
				if (!newValue.startsWith(chunk.content))
					break;
				oldPrompt.shift();
				start.push(chunk);
				newValue = newValue.slice(chunk.content.length);
			}

			while (oldPrompt.length) {
				const chunk = oldPrompt.at(-1);
				if (!newValue.endsWith(chunk.content))
					break;
				oldPrompt.pop();
				end.unshift(chunk);
				newValue = newValue.slice(0, -chunk.content.length);
			}

			return [
				...start,
				...(newValue ? [{ type: 'user', content: newValue }] : []),
				...end,
			];
		});
	}

	function onScroll({ target }) {
		promptOverlay.current.scrollTop = target.scrollTop;
		promptOverlay.current.scrollLeft = target.scrollLeft;
	}

	function onPromptMouseMove({ clientX, clientY }) {
		promptOverlay.current.style.pointerEvents = 'auto';
		const elem = document.elementFromPoint(clientX, clientY);
		const pc = elem?.closest?.('[data-promptchunk]');
		const probs = elem?.closest?.('#probs');
		promptOverlay.current.style.pointerEvents = 'none';
		if (probs)
			return;
		if (!pc) {
			setCurrentPromptChunk(undefined);
			return;
		}
		const rect = [...pc.getClientRects()].at(-1);
		const index = +pc.dataset.promptchunk;
		const top = rect.top;
		const left = rect.x + rect.width / 2;
		setCurrentPromptChunk(cur => {
			if (cur && cur.index === index && cur.top === top && cur.left === left)
				return cur;
			return { index, top, left };
		});
	}

	async function switchCompletion(i, tok) {
		if (cancel) {
			cancel?.();

			// llama.cpp server sometimes generates gibberish if we stop and
			// restart right away (???)
			await new Promise(res => setTimeout(res, 500));
		}

		const newPrompt = [
			...prompt.slice(0, i),
			{
				...prompt[i],
				content: tok,
			},
		];
		setPrompt(newPrompt);
		predict(joinPrompt(newPrompt));
	}

	const probs = useMemo(() =>
		prompt[currentPromptChunk?.index]?.completion_probabilities?.[0]?.probs,
		[prompt, currentPromptChunk]);

	return html`
		<div id="prompt-container" onMouseMove=${onPromptMouseMove}>
			<textarea
				ref=${promptArea}
				readOnly=${!!cancel}
				id="prompt-area"
				onInput=${onInput}
				onScroll=${onScroll}/>
			<div ref=${promptOverlay} id="prompt-overlay">
				${prompt.map((chunk, i) => {
					const isCurrent = currentPromptChunk && currentPromptChunk.index === i;
					return html`
						<span
							key=${i}
							data-promptchunk=${i}
							className=${`${chunk.type === 'user' ? 'user' : 'machine'} ${isCurrent ? 'current' : ''}`}>
							${chunk.content + (i === prompt.length - 1 && chunk.content.endsWith('\n') ? '\u00a0' : '')}
						</span>`;
				})}
			</div>
		</div>
		${probs ? html`
			<div
				id="probs"
				style=${{
					'--probs-top': `${currentPromptChunk.top}px`,
					'--probs-left': `${currentPromptChunk.left}px`,
				}}>
				${probs.map((prob, i) =>
					html`<button key=${i} onClick=${() => switchCompletion(currentPromptChunk?.index, prob.tok_str)}>
						<div className="tok">${prob.tok_str}</div>
						<div className="prob">${(prob.prob * 100).toFixed(2)}%</div>
					</button>`)}
			</div>` : null}
		<div id="sidebar">
			<${InputBox} label="Server"
				value=${endpoint} onValueChange=${setEndpoint}/>
			<${InputBox} label="Temperature" type="number" step="0.01"
				value=${temperature} onValueChange=${setTemperature}/>
			<div className="sidebar-hbox">
				<${InputBox} label="Repeat penalty" type="number" step="0.01"
					value=${repeatPenalty} onValueChange=${setRepeatPenalty}/>
				<${InputBox} label="Repeat last n" type="number" step="1"
					value=${repeatLastN} onValueChange=${setRepeatLastN}/>
			</div>
			<${Checkbox} label="Penalize NL"
				value=${penalizeNl} onValueChange=${setPenalizeNl}/>
			<div className="sidebar-hbox">
				<${InputBox} label="Presence penalty" type="number" step="0.01"
					value=${presencePenalty} onValueChange=${setPresencePenalty}/>
				<${InputBox} label="Frequency penalty" type="number" step="1"
					value=${frequencyPenalty} onValueChange=${setFrequencyPenalty}/>
			</div>
			${temperature <= 0 ? null : html`
				<${SelectBox}
					label="Mirostat"
					value=${mirostat}
					onValueChange=${setMirostat}
					options=${[
						{ name: 'Off', value: 0 },
						{ name: 'Mirostat', value: 1 },
						{ name: 'Mirostat 2.0', value: 2 },
					]}/>
				${mirostat ? html`
					<div className="sidebar-hbox">
						<${InputBox} label="Mirostat τ" type="number" step="0.01"
							value=${mirostatTau} onValueChange=${setMirostatTau}/>
						<${InputBox} label="Mirostat η" type="number" step="0.01"
							value=${mirostatEta} onValueChange=${setMirostatEta}/>
					</div>
				` : html`
					<div className="sidebar-hbox">
						<${InputBox} label="Top K" type="number" step="1"
							value=${topK} onValueChange=${setTopK}/>
						<${InputBox} label="Top P" type="number" step="1"
							value=${topP} onValueChange=${setTopP}/>
					</div>
					<div className="sidebar-hbox">
						<${InputBox} label="Typical p" type="number" step="0.01"
							value=${typicalP} onValueChange=${setTypicalP}/>
						<${InputBox} label="Tail Free Sampling z" type="number" step="0.01"
							value=${tfsZ} onValueChange=${setTfsZ}/>
					</div>
				`}
			`}
			<${Checkbox} label="Ignore <eos>"
				value=${ignoreEos} onValueChange=${setIgnoreEos}/>
			${!!tokens && html`
				<${InputBox} label="Tokens" value=${tokens} readOnly/>`}
			<div className="buttons">
				<button
					className=${cancel ? 'completing' : ''}
					disabled=${!!cancel}
					onClick=${() => predict()}>
					Predict
				</button>
				<button disabled=${!cancel} onClick=${cancel}>Cancel</button>
			</div>
		</div>`;
}