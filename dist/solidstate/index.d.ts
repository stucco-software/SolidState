export const VERSION: "0.4.0";
export default SolidState;
declare function SolidState(config: any): {
    version: string;
    config: any;
    ready: Promise<{
        ok: boolean;
        disposed: boolean;
        containerUrl?: undefined;
    } | {
        ok: boolean;
        containerUrl: string;
        disposed?: undefined;
    } | {
        ok: boolean;
        error: any;
    }> | Promise<{
        ok: boolean;
        local: boolean;
    }>;
    on: (name: any, listener: any) => () => any;
    changes: (options?: {}) => any;
    info: () => any;
    idle: () => Promise<void>;
    dispose: () => Promise<void>;
    close: () => Promise<void>;
    conflicts: (id: any) => Promise<{
        winner: {
            [x: string]: any;
        };
        others: {
            doc: {
                [x: string]: any;
            };
            base: {
                [x: string]: any;
            };
        }[];
    }>;
    resolve: (id: any, merged: any, based: any) => Promise<any>;
    resync: () => void;
    post: (doc: any) => Promise<any>;
    put: (id: any, update: any) => Promise<any>;
    patch: (id: any, update: any) => Promise<any>;
    get: (id: any) => Promise<any>;
    getAll: () => Promise<any>;
    query: (frame: any) => Promise<any[]>;
    delete: (id: any, remove: any) => Promise<any>;
    clear: () => Promise<boolean>;
};
