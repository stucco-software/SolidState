<script context="module">
	export const metadata = {"title":"Get Started","type":"Documentation","lastUpdated":"2025.11-03","order":1};
	const { title, type, lastUpdated, order } = metadata;
</script>

<pre class="language-js">{@html `<code class="language-js"><span class="token keyword">import</span> SolidState <span class="token keyword">from</span> <span class="token string">"solidstate-kv"</span>

<span class="token keyword">const</span> db <span class="token operator">=</span> <span class="token function">SolidState</span><span class="token punctuation">(</span><span class="token punctuation">&#123;</span>
  graph<span class="token operator">:</span> <span class="token string">"your-graph-name"</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span>

<span class="token keyword">const</span> reference <span class="token operator">=</span> <span class="token keyword">await</span> db<span class="token punctuation">.</span><span class="token function">post</span><span class="token punctuation">(</span><span class="token punctuation">&#123;</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Document"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Your Document Goes Here"</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span></code>`}</pre>
<p><a href="/api">Read The Docs</a> <a href="https://www.npmjs.com/package/solidstate-kv" rel="nofollow">Install</a></p>
