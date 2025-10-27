export default SideNav;
type SideNav = {
    $on?(type: string, callback: (e: any) => void): () => void;
    $set?(props: Partial<$$ComponentProps>): void;
};
declare const SideNav: import("svelte").Component<{
    sections: any;
}, {}, "">;
type $$ComponentProps = {
    sections: any;
};
