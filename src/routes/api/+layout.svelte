<script>
  import SideNav from "$lib/components/SideNav.svelte"
  let { children, data } = $props()
</script>

<div class="layout">
  <aside>
    <SideNav sections={data.hasPart} />
  </aside>
  <main>
    {@render children?.()}
  </main>
</div>


<style>
  .layout {
    display: grid;
    grid-template-columns: 2fr 6fr;
    gap: var(--lead-1);
  }
</style>