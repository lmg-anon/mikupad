# mikupad

**mikupad** is a user-friendly, browser-based interface for interacting with language models. It's built with ReactJS and supports various text generation backends, all within a single HTML file.

![image](https://github.com/user-attachments/assets/4c5fa8ff-5926-4a4b-807b-34e4f36a032c)

## Features

* **Multiple Backends**: Supports **llama.cpp**, **koboldcpp**, **AI Horde**, and any **OpenAI Compatible** API.
* **Session Persistence**: Your prompt is automatically saved and restored, allowing you to continue seamlessly across multiple sessions. Import and export sessions for sharing or maintaining backups.
* **Optional Server**: Can be hosted on a local Node.js server, enabling database access remotely or across your local network.
* **Persistent Context**:
  * **Memory**: Seamlessly inject a text of your choice at the beginning of the context.
  * **Author's Note**: Seamlessly inject a text of your choice at the end of the context, with adjustable depth.
  * **World Info**: Dynamically include extra information in the context, triggered by specific keywords.
* **Prediction Undo/Redo**: Easily experiment and refine your generated text with the ability to undo and redo predictions.
* **Token Probability**: Hover over any token to reveal the top 10 most probable tokens at that point. Click on a probability to regenerate the text from that specific token.
  * If you're using oobabooga, make sure to use an \_HF sampler for this feature to function properly.
  * If you're using koboldcpp, token probabilities are only available with Token Streaming disabled.
* **Logit Bias**: Fine-tune the generation process by adjusting the likelihood bias of specific tokens on-the-fly.
* **Completion/Chat Modes**:
  * **Completion**: Have the language model directly continue your prompt.
  * **Chat**: Mikupad simplifies using instruct models. It automatically adds the right delimiters when you start or stop generating, based on your selected template. This also structures your prompt into messages, making it compatible with the Chat Completions API (for OpenAI-compatible backends).
* **Themes**: Customize your environment by choosing from a variety of themes.

## Getting Started

You can easily run **mikupad** by opening the `mikupad.html` file in your web browser. No additional installation is required. Choose your preferred backend and start generating text!

```shell
git clone https://github.com/lmg-anon/mikupad.git
cd mikupad
open mikupad.html
```
To use **mikupad** fully offline, run the provided `compile` script or download the pre-compiled `mikupad_compiled.html` file from [Releases](https://github.com/lmg-anon/mikupad/releases/latest).

You can also [try it on GitHub Pages](https://lmg-anon.github.io/mikupad/mikupad.html).

## Contributing

Contributions from the open-source community are welcome. Whether it's fixing a bug, adding a feature, or improving the documentation, your contributions are greatly appreciated. To contribute to **mikupad**, follow these steps:

1. Fork the repository.
2. Create a new branch for your changes: `git checkout -b feature/your-feature-name`
3. Make your changes and commit them: `git commit -m 'Add your feature'`
4. Push your changes to your forked repository: `git push origin feature/your-feature-name`
5. Open a pull request on the main repository, explaining your changes.

## License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
