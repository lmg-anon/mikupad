# mikupad

**mikupad** is a lightweight and efficient language model front-end powered by ReactJS, all packed into a single HTML file. This project is inspired by the likes of NovelAI and provides a simple yet powerful interface for generating text with the help of various backends, such as **llamacpp**, **oobabooga**, and **koboldcpp**.

## Features

* **Multiple Backends**: Multiple backends are supported, namely **llamacpp**, **oobabooga**, and **koboldcpp**. You can seamlessly switch between these backends to get different text generation experiences.
  * The OpenAI API is also available, but currently, its primary focus is on providing support for oobabooga since its old WebSocket backend has been deprecated.
* **Session Persistence**: Your text generation sessions are automatically saved and restored. This means you can work on your text in multiple sittings and continue right where you left off. Import and export your sessions to share your creative work or switch devices effortlessly.
* **Prediction Undo/Redo**: It's possible to undo and redo predictions, making it easy to experiment and fine-tune your generated text until it's just right.
* **Token Probability** *(llamacpp/openai backend)*: When you hover over a token in the generated text, a list will show at most 10 tokens with their probabilities. This information can be a valuable aid in refining your text. Moreover, you can click on another token's probability to restart text generation from that point.
  * If you're using oobabooga's OpenAI API extension, make sure to use an _HF sampler for this feature to function properly.
* **Dark Mode Switch**: Customize your environment to suit your preferences with a convenient dark mode switch.

## Getting Started

You can easily run **mikupad** by opening the `mikupad.html` file in your web browser. No additional installation is required. Choose your preferred backend and start generating text!

```shell
git clone https://github.com/lmg-anon/mikupad.git
cd mikupad
open mikupad.html
```

You can also [try it on GitHub Pages](https://lmg-anon.github.io/mikupad/mikupad.html).

## Contributing

Contributions from the open-source community are welcome. Whether it's fixing a bug, adding a feature, or improving the documentation, your contributions are greatly appreciated. To contribute to **mikupad**, follow these steps:

1. Fork the repository.
2. Create a new branch for your changes: `git checkout -b feature/your-feature-name`
3. Make your changes and commit them: `git commit -m 'Add your feature'`
4. Push your changes to your forked repository: `git push origin feature/your-feature-name`
5. Open a pull request on the main repository, explaining your changes.

## License

This project is released to the public domain under the CC0 License - see the [LICENSE](LICENSE) file for details.
