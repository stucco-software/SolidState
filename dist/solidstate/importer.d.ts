export function importContainer({ db, pod, containerUrl, context, emit }: {
    db: any;
    pod: any;
    containerUrl: any;
    context: any;
    emit?: () => void;
}): Promise<{
    added: number;
}>;
