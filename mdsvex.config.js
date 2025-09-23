import { defineMDSveXConfig as defineConfig } from "mdsvex";
import rehypeSlug from 'rehype-slug'

const config = defineConfig({
  extensions: [".svelte.md", ".md", ".svx"],
  smartypants: {
    dashes: "oldschool",
  },
  rehypePlugins: [rehypeSlug]
});

export default config;
