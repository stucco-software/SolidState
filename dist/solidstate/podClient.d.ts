export class PodError extends Error {
    constructor(method: any, url: any, status: any, detail?: string);
    status: any;
    retryable: boolean;
}
export function createPodClient(rawFetch: any, { timeoutMs }?: {
    timeoutMs?: number;
}): {
    get: (url: any) => Promise<{
        body: any;
        etag: any;
    }>;
    put: (url: any, body: any, { etag: expected, create, overwrite, contentType }?: {
        create?: boolean;
        overwrite?: boolean;
        contentType?: string;
    }) => Promise<{
        conflict: boolean;
        etag?: undefined;
    } | {
        etag: any;
        conflict?: undefined;
    }>;
    remove: (url: any, { etag: expected }?: {}) => Promise<{
        conflict: boolean;
    } | {
        conflict?: undefined;
    }>;
    list: (containerUrl: any) => Promise<string[]>;
    etag: (url: any) => Promise<any>;
    ensurePath: (rootUrl: any, containerUrl: any) => Promise<void>;
};
