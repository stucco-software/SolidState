<script>
  import { arrayify } from "$lib/helpers.js"
  import SampleCode from "$lib/components/SampleCode.svelte"
  let { children, data } = $props()
  console.log(data)
</script>

<div>
  <header>
    <h1>Solid<b>State</b></h1>
    <p>
      <a href="/api">Get Started</a>
    </p>
  </header>

  {#each arrayify(data) as section}
    <h2 id={section.id}>{section.title}</h2>
    {@html section.html}

    {#each arrayify(section.hasPart) as subsection}
      {#if subsection}
        <h3 id={subsection.id}>{subsection.title}</h3>
        {@html subsection.html}
      {/if}
    {/each}
  {/each}
</div>

<style>
  div {
    max-width: 46rem;
    margin: auto;
  }
  header {
    padding-block: var(--lead-6);
  }
</style>
