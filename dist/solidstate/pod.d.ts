export function getResourceURL(config: any): string;
export const context: {
    "@base": string;
    "@vocab": string;
};
export function createGraph({ url, userFetch, body }: {
    url: any;
    userFetch: any;
    body?: any[];
}): Promise<any>;
export function updateGraph({ url, userFetch, body }: {
    url: any;
    userFetch: any;
    body?: {};
}): Promise<any>;
export function getNodeArray(ld: any): any;
export function transformQuads(nquads?: string): Promise<any>;
export function addToPouch({ docs, db }: {
    docs: any;
    db: any;
}): Promise<void>;
export function checkGraph({ userFetch, graph }: {
    userFetch: any;
    graph: any;
}): Promise<boolean>;
export function getGraph({ userFetch, graph }: {
    userFetch: any;
    graph: any;
}): Promise<any>;
