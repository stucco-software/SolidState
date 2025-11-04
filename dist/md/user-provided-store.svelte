<script context="module">
	export const metadata = {"title":"User Provided Store","type":"Documentation"};
	const { title, type } = metadata;
</script>

<p>SolidState can sync it’s local data to a user-provided data store via the <a
  href="https://solidproject.org/"
  rel="nofollow"
>Solid Protocol</a>.</p>
<p>Provide a <code>Session</code> object to the <a href="#create-a-store">init options</a> that has, at least, a <code>webID</code> string and a <code>fetch</code> function that can make requests against provided webID.</p>
<p>A straight-forward way to create this session object is with the <a
  href="https://www.npmjs.com/package/@inrupt/solid-client-authn-browser"
  rel="nofollow"
>Solid Client Authentication Library from Inrupt</a>, as demonstrated in the <a
  href="https://stucco.software/pocket-change-part-2"
  rel="nofollow"
>Pocket Change sample project</a>. This can also be done <a
  href="https://solid-authentication.rdf.systems/"
  rel="nofollow"
>without libraries</a> if you’re feeling brave.</p>
<p>If you’ve provided a <code>Session</code> object, SolidState will create the graph in the user-provided store at <code>&lt;webid&gt;/&lt;graph&gt;</code>. It will sync the currents state of the local store to this graph, and replicate any changes made locally upstream to this graph.</p>
<p>SolidState will not pro-actively live sync <em>from</em> this upstream store. It will download the store and sync it to it’s local state on initialization. To subscribe to changes live as they happen, use a Sync Server (tk).</p>
<h4 id="options">Options</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token punctuation">&#123;</span>
  session<span class="token operator">:</span> <span class="token punctuation">&#123;</span>
    fetch<span class="token operator">:</span> <span class="token function">fn</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">,</span>
    webID<span class="token operator">:</span> String
  <span class="token punctuation">&#125;</span><span class="token punctuation">,</span>
  graph<span class="token operator">:</span> <span class="token template-string"><span class="token template-punctuation string">&#96;</span><span class="token string">sample-graph</span><span class="token template-punctuation string">&#96;</span></span>
<span class="token punctuation">&#125;</span></code>`}</pre>
<h4 id="example">Example</h4>
<pre class="language-js">{@html `<code class="language-js"><span class="token keyword">import</span> SolidState <span class="token keyword">from</span> <span class="token string">'solidstate-kv'</span>
<span class="token keyword">import</span> <span class="token punctuation">&#123;</span>
  <span class="token constant">EVENTS</span><span class="token punctuation">,</span>
  getDefaultSession
<span class="token punctuation">&#125;</span> <span class="token keyword">from</span> <span class="token string">'@inrupt/solid-client-authn-browser'</span>

<span class="token keyword">let</span> session <span class="token operator">=</span> <span class="token function">getDefaultSession</span><span class="token punctuation">(</span><span class="token punctuation">)</span>

session<span class="token punctuation">.</span>events<span class="token punctuation">.</span><span class="token function">on</span><span class="token punctuation">(</span><span class="token constant">EVENTS</span><span class="token punctuation">.</span><span class="token constant">SESSION_RESTORED</span><span class="token punctuation">,</span> <span class="token punctuation">(</span><span class="token parameter">url</span><span class="token punctuation">)</span> <span class="token operator">=></span> <span class="token punctuation">&#123;</span>
  <span class="token keyword">let</span> db <span class="token operator">=</span> <span class="token function">SetupDB</span><span class="token punctuation">(</span><span class="token punctuation">&#123;</span>
    session<span class="token operator">:</span> session<span class="token punctuation">,</span>
    graph<span class="token operator">:</span> <span class="token template-string"><span class="token template-punctuation string">&#96;</span><span class="token string">sample-graph</span><span class="token template-punctuation string">&#96;</span></span>
  <span class="token punctuation">&#125;</span><span class="token punctuation">)</span>
<span class="token punctuation">&#125;</span><span class="token punctuation">)</span>
</code>`}</pre>
