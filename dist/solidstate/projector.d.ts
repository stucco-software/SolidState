export function createProjector({ db, pod, containerUrl, context, emit, retryBaseMs, podOnly, pullNode, gate, }: {
    db: any;
    pod: any;
    containerUrl: any;
    context: any;
    emit?: () => void;
    retryBaseMs?: number;
    podOnly?: boolean;
    pullNode?: () => Promise<void>;
    gate?: {
        pausedUntil: number;
    };
}): {
    projectDoc: (doc: any) => Promise<"deleted" | "skipped" | "conflicted" | "unchanged" | "pulled" | "outside-change" | "behind" | "requeued" | "projected">;
    projectAll: () => Promise<void>;
    start: () => Promise<void>;
    stop: () => void;
    idle: () => Promise<void>;
    enqueue: (id: any) => Promise<void>;
    pendingRetries: () => number;
    run: (fn: any) => Promise<void>;
};
