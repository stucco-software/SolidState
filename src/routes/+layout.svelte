<script>
	import favicon from '$lib/assets/favicon.svg';
	import HeaderNav from "$lib/components/HeaderNav.svelte"
	import SideNav from "$lib/components/SideNav.svelte"
	import Footer from "$lib/components/Footer.svelte"
	let { children, data } = $props()
	console.log(`---`)
	console.log(data)
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<HeaderNav />

{@render children?.()}
<Footer />

<style>
	.layout {
		display: grid;
		grid-template-columns: 2fr 6fr;
		gap: var(--lead-1);
	}

/*	main {
		display: grid;
		grid-template-columns: 5fr 2fr;
	}*/


</style>