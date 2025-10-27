<script context="module">
	export const metadata = {"title":"Delete Data","type":"Documentation","exampleCode":"post-code.js"};
	const { title, type, exampleCode } = metadata;
</script>

<p>Delete a key/value off an Entity with <code>db.delete(id, data)</code>.</p>
<p>Delete the entire entity with <code>db.delete(id)</code>.</p>
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
    <span class="token string">"Lemon"</span>
  <span class="token punctuation">]</span>
<span class="token punctuation">&#125;</span>
</code>`}</pre>
