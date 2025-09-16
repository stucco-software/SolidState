<script>
	import favicon from '$lib/assets/favicon.svg';
	import HeaderNav from "$lib/components/HeaderNav.svelte"
	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<HeaderNav />

<div class="layout">

<aside>
	<nav>
		side navigation
	</nav>
</aside>

<main>
	{@render children?.()}
</main>

</div>

<footer>
	footer!
</footer>

<style>
	.layout {
		display: grid;
		grid-template-columns: 1fr 5fr;
	}

	main {
		display: grid;
		grid-template-columns: 5fr 2fr;
	}
</style>