export function createProjector({ db, pod, containerUrl, context, emit, retryBaseMs }: {
    db: any;
    pod: any;
    containerUrl: any;
    context: any;
    emit?: () => void;
    retryBaseMs?: number;
}): {
    projectDoc: (doc: any) => Promise<"deleted" | "skipped" | "conflicted" | "unchanged" | "outside-change" | "behind" | "requeued" | "projected">;
    projectAll: () => Promise<void>;
    start: () => Promise<void>;
    stop: () => void;
    idle: () => Promise<void>;
    enqueue: (id: any) => Promise<void>;
    pendingRetries: () => number;
};
