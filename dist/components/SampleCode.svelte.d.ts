export default SampleCode;
type SampleCode = {
    $on?(type: string, callback: (e: any) => void): () => void;
    $set?(props: Partial<$$ComponentProps>): void;
};
declare const SampleCode: import("svelte").Component<{
    source: any;
}, {}, "">;
type $$ComponentProps = {
    source: any;
};
