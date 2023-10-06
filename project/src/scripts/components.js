import { html } from 'htm/react';

export function InputBox({ label, value, type, onValueChange, ...props }) {
	return html`
		<label className="InputBox">
			${label}
			<input
				type=${type || 'text'}
				value=${value}
				size="1"
				onChange=${({ target }) => {
					let value = type === 'number' ? target.valueAsNumber : target.value;
					if (props.inputmode === 'numeric') {
						props.pattern = '^-?[0-9]*$';
						if (value && !isNaN(+value))
							value = +target.value;
					}
					if (props.pattern && !new RegExp(props.pattern).test(value))
						return;
					onValueChange(value);
				}}
				...${props}/>
		</label>`;
}

export function SelectBox({ label, value, onValueChange, options, ...props }) {
	return html`
		<label className="SelectBox">
			${label}
			<select
				value=${value}
				onChange=${({ target }) => onValueChange(JSON.parse(target.value))}
				...${props}>
				${options.map(o => html`<option
					key=${JSON.stringify(o.value)}
					value=${JSON.stringify(o.value)}>${o.name}</option>`)}
			</select>
		</label>`;
}

export function Checkbox({ label, value, onValueChange, ...props }) {
	return html`
		<label className="Checkbox">
			<input
				type="checkbox"
				checked=${value}
				onChange=${({ target }) => onValueChange(target.checked)}
				...${props}/>
			${label}
		</label>`;
}