export class PodError extends Error {
    constructor(method: any, url: any, status: any, detail?: string, { retryAfterMs }?: {
        retryAfterMs?: any;
    });
    status: any;
    retryable: boolean;
    retryAfterMs: any;
}
export function parseRetryAfter(value: any, now?: number): number;
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
        body?: undefined;
    } | {
        etag: any;
        conflict?: undefined;
        body?: undefined;
    } | {
        etag: any;
        body: any;
        conflict?: undefined;
    }>;
    remove: (url: any, { etag: expected }?: {}) => Promise<{
        conflict?: undefined;
    } | {
        conflict: boolean;
    }>;
    list: (containerUrl: any) => Promise<string[]>;
    listing: (containerUrl: any) => Promise<{
        etag: any;
        date: number;
        members: {
            url: string;
            modified: any;
        }[];
    }>;
    etag: (url: any) => Promise<any>;
    stat: (url: any) => Promise<{
        exists: boolean;
        etag: any;
    }>;
    ensurePath: (rootUrl: any, containerUrl: any) => Promise<void>;
};
