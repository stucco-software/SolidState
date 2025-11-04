<script context="module">
	export const metadata = {"title":"Create A Store","type":"Documentation"};
	const { title, type } = metadata;
</script>

<p>Create a new interface to a graph by calling <code>SolidState(options)</code>.</p>
<h4 id="options">Options</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token punctuation">&#123;</span>
  graph<span class="token operator">:</span> <span class="token string">'string'</span><span class="token punctuation">,</span>
  session<span class="token operator">:</span> <span class="token punctuation">&#123;</span>optional<span class="token punctuation">&#125;</span>
<span class="token punctuation">&#125;</span></code>`}</pre>
<h4 id="example">Example</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token keyword">import</span> SolidState <span class="token keyword">from</span> <span class="token string">'solidstate-kv'</span>

<span class="token keyword">const</span> db <span class="token operator">=</span> <span class="token function">SolidState</span><span class="token punctuation">(</span><span class="token punctuation">&#123;</span>
  graph<span class="token operator">:</span> <span class="token string">'test-graph'</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span></code>`}</pre>
