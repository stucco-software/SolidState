export function createFakePod({ origin, advertiseStorage, etagOnWrite, autoCreateParents, }?: {
    origin?: string;
    advertiseStorage?: boolean;
    etagOnWrite?: boolean;
    autoCreateParents?: boolean;
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
    failNext: (method: any, status: any, times: number, match: any) => number;
};
