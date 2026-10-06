export function migrateLegacy({ db, pod, rootUrl, legacyUrl, archiveUrl, projector, emit: rawEmit }: {
    db: any;
    pod: any;
    rootUrl: any;
    legacyUrl: any;
    archiveUrl: any;
    projector: any;
    emit?: () => void;
}): Promise<{
    migrated: boolean;
    reason: string;
    pending?: undefined;
    count?: undefined;
} | {
    migrated: boolean;
    reason: string;
    pending: any[];
    count?: undefined;
} | {
    migrated: boolean;
    count: any;
    reason?: undefined;
    pending?: undefined;
}>;
