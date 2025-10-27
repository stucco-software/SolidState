<script context="module">
	export const metadata = {"title":"Get Data","type":"Documentation"};
	const { title, type } = metadata;
</script>

<p>Get a single item by <code>@id</code> with <code>db.get()</code></p>
<h4 id="example">Example</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token keyword">let</span> ref <span class="token operator">=</span> <span class="token keyword">await</span> db<span class="token punctuation">.</span><span class="token function">post</span><span class="token punctuation">(</span><span class="token punctuation">&#123;</span>
  <span class="token string">"@id"</span><span class="token operator">:</span> <span class="token string">"chickpeas"</span><span class="token punctuation">,</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Ingredient"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Chickpeas"</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span>
<span class="token keyword">let</span> checkpeas <span class="token operator">=</span> <span class="token keyword">await</span> db<span class="token punctuation">.</span><span class="token function">get</span><span class="token punctuation">(</span><span class="token string">"chickpeas"</span><span class="token punctuation">)</span></code>`}</pre>
<h5 id="returns">Returns</h5>
<pre class="language-js">{@html `<code class="language-js"><span class="token comment">// ref</span>
<span class="token punctuation">&#123;</span>
  <span class="token string">"@id"</span><span class="token operator">:</span> <span class="token string">"chickpeas"</span><span class="token punctuation">,</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Ingredient"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Chickpeas"</span>
<span class="token punctuation">&#125;</span></code>`}</pre>
