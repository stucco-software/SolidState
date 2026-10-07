export function remoteFor(sync: any): any;
export function createReplication({ db, remote, emit, catchUpTimeoutMs }: {
    db: any;
    remote: any;
    emit: any;
    catchUpTimeoutMs?: number;
}): {
    catchUp: () => Promise<boolean>;
    start: () => void;
    stop: () => void;
};
