<script context="module">
	export const metadata = {"title":"Get All","type":"Documentation"};
	const { title, type } = metadata;
</script>

<p>Get all items in the graph with <code>db.getAll()</code></p>
<h4 id="example">Example</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token keyword">let</span> items <span class="token operator">=</span> <span class="token keyword">await</span> db<span class="token punctuation">.</span><span class="token function">getAll</span><span class="token punctuation">(</span><span class="token punctuation">)</span></code>`}</pre>
<h5 id="returns">Returns</h5>
<pre class="language-js">{@html `<code class="language-js"><span class="token comment">// items</span>
<span class="token punctuation">[</span><span class="token punctuation">&#123;</span>
  <span class="token string">"@id"</span><span class="token operator">:</span> <span class="token string">"chickpeas"</span><span class="token punctuation">,</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Ingredient"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Chickpeas"</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">,</span><span class="token punctuation">&#123;</span>
  <span class="token string">"@id"</span><span class="token operator">:</span> <span class="token string">"lemon"</span><span class="token punctuation">,</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Ingredient"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Lemon"</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">]</span></code>`}</pre>
