export default SolidState;
declare function SolidState(config: any): {
    version: string;
    post: (doc: any) => Promise<any>;
    put: (id: any, update: any) => Promise<any>;
    patch: (id: any, update: any) => Promise<any>;
    get: (id: any) => Promise<any>;
    getAll: () => Promise<any>;
    query: (frame: any) => Promise<any[]>;
    delete: (id: any, remove: any) => Promise<any>;
    clear: () => Promise<boolean>;
};
