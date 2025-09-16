<script>
  let open = $state(false)
  let search = $state()
  let dialog

  const show = (e) => {
    dialog.showModal()
  }

  const searchFor = (e) => {
    dialog.showModal()
  }
</script>

<form onsubmit={searchFor}>
  <input
    bind:value={search}
    onclick={show}
    placeholder="search"
    type="text"
    name="command">
    <kbd class="svelte-1n4a6ey">⌘k</kbd>
</form>

<dialog bind:this={dialog}>
  <form method="dialog">
    <input
      bind:value={search}
      placeholder="search"
      type="text"
      name="search">
    <button>
      <kbd>esc</kbd>
    </button>
  </form>
</dialog>