export const context: {
    "@base": string;
    "@vocab": string;
    _rev: {
        "@type": string;
        "@id": string;
    };
    _id: {
        "@reverse": string;
    };
};
export function createGraph({ url, userFetch, body }: {
    url: any;
    userFetch: any;
    body?: any[];
}): Promise<any>;
export function updateGraph({ url, userFetch, body }: {
    url: any;
    userFetch: any;
    body?: any[];
}): Promise<any>;
export function getGraph({ userFetch, graph, db }: {
    userFetch: any;
    graph: any;
    db: any;
}): Promise<any>;
