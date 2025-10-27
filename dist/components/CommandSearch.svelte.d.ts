export default CommandSearch;
type CommandSearch = {
    $on?(type: string, callback: (e: any) => void): () => void;
    $set?(props: Partial<Record<string, never>>): void;
};
declare const CommandSearch: import("svelte").Component<Record<string, never>, {}, "">;
