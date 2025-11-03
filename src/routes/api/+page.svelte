<script>
  import { arrayify } from "$lib/helpers.js"
  let { children, data } = $props()
</script>

<div>
  <header>
    <h1>API Reference</h1>
    <p>SolidState is built as an HTTP API, with methods for <code>GET</code>, <code>POST</code>, <code>PATCH</code>, <code>PUT</code>, and <code>DELETE</code>.</p>

    <p>
      SolidState is built on with <a href="https://pouchdb.com/">PouchDB</a>.
    </p>
  </header>


  {#each data.hasPart as section}
    <section>
      <div class="content">
        <h2 id={section.id}>{section.title}</h2>
        {@html section.html}
         <section>
          {#each arrayify(section.hasPart) as subsection}
            {#if subsection}
              <h3 id={subsection.id}>{subsection.title}</h3>
              {@html subsection.html}
            {/if}
          {/each}
        </section>
      </div>
    </section>
  {/each}
</div>

<style>
  header,
  section {
    border-bottom: 1px solid var(--gray);
    padding: var(--lead-3);
  }
  section section {
    border: none;
    padding: 0;
  }
  .content {
    max-width: 44rem;
  }
</style>