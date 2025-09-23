<script>
  import { arrayify } from "$lib/helpers.js"
  let { sections } = $props()

  console.log(sections)
</script>

<nav>
  <ul>
    {#each sections as section}
      <li>
        <a href="#{section.id}">{section.title || 'title'}</a>
      </li>
      {#each arrayify(section.hasPart) as subsection}
        {#if subsection}
          <li class="subsection">
            <a href="#{subsection.id}">{subsection.title || 'title'}</a>
          </li>
        {/if}
      {/each}
    {/each}
  </ul>
</nav>

<style>
  nav {
    padding-block-start: var(--lead-3);
  }
  ul {
    margin: 0;
    padding: 0;
  }
  li {
    list-style-type: none;
    font-weight: bold;
  }
  li.subsection {
    font-weight: 400;
  }
</style>