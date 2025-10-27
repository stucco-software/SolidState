<script context="module">
	export const metadata = {"title":"Put Data","type":"Documentation"};
	const { title, type } = metadata;
</script>

<p>Update an Entity with the <code>db.put()</code> function, passing the Entities <code>@id</code> as the first parameter, and the new keys as the second.</p>
<h4 id="example">Example</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token keyword">let</span> ref <span class="token operator">=</span> <span class="token keyword">await</span> db<span class="token punctuation">.</span><span class="token function">put</span><span class="token punctuation">(</span><span class="token string">"chickpeas"</span><span class="token punctuation">,</span> <span class="token punctuation">&#123;</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Garbanzo Beans"</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span>
</code>`}</pre>
<h5 id="returns">Returns</h5>
<pre class="language-js">{@html `<code class="language-js"><span class="token punctuation">&#123;</span>
  <span class="token string">"@id"</span><span class="token operator">:</span> <span class="token string">"chickpeas"</span><span class="token punctuation">,</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Ingredient"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Garbanzo Beans"</span>
<span class="token punctuation">&#125;</span></code>`}</pre>
