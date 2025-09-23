<script>
  import { arrayify } from "$lib/helpers.js"
  import SampleCode from "$lib/components/SampleCode.svelte"
  let { children, data } = $props()
</script>

<div>
  <h1>SolidState</h1>

  {#each data.hasPart as section}
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
