export function createFakePod({ origin, advertiseStorage, etagOnWrite, autoCreateParents, containerEtagMoves, listModified, noEtags, ignoreIfMatch, weakEtags, pageSize, truncateListing, now, }?: {
    origin?: string;
    advertiseStorage?: boolean;
    etagOnWrite?: boolean;
    autoCreateParents?: boolean;
    containerEtagMoves?: boolean;
    listModified?: any;
    noEtags?: boolean;
    ignoreIfMatch?: boolean;
    weakEtags?: boolean;
    pageSize?: any;
    truncateListing?: any;
    now?: () => number;
}): {
    fetch: (input: any, init?: {}) => Promise<Response>;
    files: Map<any, any>;
    log: any[];
    requests: (method: any, match: any) => any[];
    webId: string;
    origin: string;
    storage: string;
    profileUrl: string;
    touch: (url: any, body: any) => void;
    remove: (url: any) => void;
    failNext: (method: any, status: any, times: number, match: any, headers?: {}) => number;
    before: (method: any, match: any, fn: any) => number;
};
