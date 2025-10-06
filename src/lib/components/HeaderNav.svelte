<script>
  import CommandSearch from "$lib/components/CommandSearch.svelte"
</script>

<header>
  <nav>
    <a href="/">SolidState</a>
    <a href="/api">Docs</a>
  </nav>
  <CommandSearch />
</header>

<style>
  header {
    display: flex;
    justify-content: space-between;
  }
</style>