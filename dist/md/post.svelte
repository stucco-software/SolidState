<script context="module">
	export const metadata = {"title":"Post Data","type":"Documentation","exampleCode":"post-code.js"};
	const { title, type, exampleCode } = metadata;
</script>

<p>Create a new entity with <code>db.post</code>. This will return a copy of the document. Note that we have a new property, <code>@id</code>. This is a generated UUID, but you can also provide your own, so long as it’s unique to this entity.</p>
<h4 id="example">Example</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token keyword">let</span> ref <span class="token operator">=</span> <span class="token keyword">await</span> db<span class="token punctuation">.</span><span class="token function">post</span><span class="token punctuation">(</span><span class="token punctuation">&#123;</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Food"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Hummus"</span><span class="token punctuation">,</span>
  <span class="token string">"vegetarian"</span><span class="token operator">:</span> <span class="token boolean">true</span><span class="token punctuation">,</span>
  <span class="token string">"number"</span><span class="token operator">:</span> <span class="token number">10</span><span class="token punctuation">,</span>
  <span class="token string">"ingredient"</span><span class="token operator">:</span> <span class="token punctuation">[</span>
    <span class="token string">"Garbanzo Beans"</span><span class="token punctuation">,</span>
    <span class="token string">"Lemon"</span>
  <span class="token punctuation">]</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span></code>`}</pre>
<h5 id="returns">Returns</h5>
<pre class="language-js">{@html `<code class="language-js"><span class="token comment">// ref</span>
<span class="token punctuation">&#123;</span>
  <span class="token string">"@type"</span><span class="token operator">:</span> <span class="token string">"Food"</span><span class="token punctuation">,</span>
  <span class="token string">"name"</span><span class="token operator">:</span> <span class="token string">"Hummus"</span><span class="token punctuation">,</span>
  <span class="token string">"vegetarian"</span><span class="token operator">:</span> <span class="token boolean">true</span><span class="token punctuation">,</span>
  <span class="token string">"number"</span><span class="token operator">:</span> <span class="token number">10</span><span class="token punctuation">,</span>
  <span class="token string">"ingredient"</span><span class="token operator">:</span> <span class="token punctuation">[</span>
    <span class="token string">"Garbanzo Beans"</span><span class="token punctuation">,</span>
    <span class="token string">"Lemon"</span>
  <span class="token punctuation">]</span><span class="token punctuation">,</span>
  <span class="token string">"@id"</span><span class="token operator">:</span> <span class="token string">"uuid:5974d4a4-4b44-4c2d-a9f5-fbccc8da2760"</span>
<span class="token punctuation">&#125;</span>
</code>`}</pre>
