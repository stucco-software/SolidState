<script context="module">
	export const metadata = {"title":"Entities","type":"Documentation"};
	const { title, type } = metadata;
</script>

<p>Entities are stored as flat objects, that is sets of key:value pairs. Values can be of any given type. Nested objects are created by managing relationships between entities.</p>
<p>Entities have three special keys: <code>@id</code>, <code>@type</code> and <code>_rev</code>.</p>
<p>The <code>@id</code> key is used to uniquely identify the entity.</p>
<p>The <code>@type</code> key is used to classify or attach a schema to the entity.</p>
<p>The <code>_rev</code> key is used to sync documents across user provided store and local devices.</p>
