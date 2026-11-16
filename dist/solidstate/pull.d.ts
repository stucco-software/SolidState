export function createPuller({ db, pod, containerUrl, context, emit, enqueue, gate }: {
    db: any;
    pod: any;
    containerUrl: any;
    context: any;
    emit?: () => void;
    enqueue?: () => void;
    gate?: {
        pausedUntil: number;
    };
}): {
    pull: ({ budget }?: {
        budget?: number;
    }) => Promise<{
        added: number;
        updated: number;
        merged: number;
        conflicted: number;
        deleted: number;
        recreated: number;
        checked: number;
    }>;
    pullNode: (id: any) => Promise<{
        added: number;
        updated: number;
        merged: number;
        conflicted: number;
        deleted: number;
        recreated: number;
        checked: number;
    }>;
    podShape: (doc: any) => Promise<any>;
};
