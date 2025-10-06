import mdsvexConfig from "./mdsvex.config.js";
import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-netlify';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: { adapter: adapter() },
	preprocess: [mdsvex(mdsvexConfig)],
	extensions: ['.svelte', '.svx', '.md']
};

export default config;
