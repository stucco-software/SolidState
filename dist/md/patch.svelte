<script context="module">
	export const metadata = {"title":"Patch Data","type":"Documentation"};
	const { title, type } = metadata;
</script>

<p>Add to the existing value of an Entity with <code>db.patch()</code>.</p>
<p>Note: If the original value was a single scalar, the new value will be an Array. This can be tricky and also confusing.</p>
<h4 id="example">Example</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token keyword">await</span> db<span class="token punctuation">.</span><span class="token function">post</span><span class="token punctuation">(</span><span class="token punctuation">&#123;</span>
  <span class="token string">"@id"</span><span class="token operator">:</span> <span class="token string">"hummus"</span><span class="token punctuation">,</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Food"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Hummus"</span><span class="token punctuation">,</span>
  <span class="token string">"vegetarian"</span><span class="token operator">:</span> <span class="token boolean">true</span><span class="token punctuation">,</span>
  <span class="token string">"number"</span><span class="token operator">:</span> <span class="token number">10</span><span class="token punctuation">,</span>
  <span class="token string">"ingredient"</span><span class="token operator">:</span> <span class="token punctuation">[</span>
    <span class="token string">"Garbanzo Beans"</span><span class="token punctuation">,</span>
    <span class="token string">"Lemon"</span>
  <span class="token punctuation">]</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span>

<span class="token keyword">let</span> ref <span class="token operator">=</span> <span class="token keyword">await</span> db<span class="token punctuation">.</span><span class="token function">patch</span><span class="token punctuation">(</span><span class="token string">'hummus'</span><span class="token punctuation">,</span> <span class="token punctuation">&#123;</span>
  <span class="token string">"ingredient"</span><span class="token operator">:</span> <span class="token string">"Olive Oil"</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span></code>`}</pre>
<h5 id="returns">Returns</h5>
<pre class="language-js">{@html `<code class="language-js"><span class="token comment">// ref</span>
<span class="token punctuation">&#123;</span>
  <span class="token string">"@id"</span><span class="token operator">:</span> <span class="token string">"hummus"</span><span class="token punctuation">,</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Food"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Hummus"</span><span class="token punctuation">,</span>
  <span class="token string">"vegetarian"</span><span class="token operator">:</span> <span class="token boolean">true</span><span class="token punctuation">,</span>
  <span class="token string">"number"</span><span class="token operator">:</span> <span class="token number">10</span><span class="token punctuation">,</span>
  <span class="token string">"ingredient"</span><span class="token operator">:</span> <span class="token punctuation">[</span>
    <span class="token string">"Garbanzo Beans"</span><span class="token punctuation">,</span>
    <span class="token string">"Lemon"</span><span class="token punctuation">,</span>
    <span class="token string">"Olive Oil"</span>
  <span class="token punctuation">]</span>
<span class="token punctuation">&#125;</span></code>`}</pre>
