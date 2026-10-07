export function readProjection(db: any, id: any): Promise<any>;
export function writeProjection(db: any, id: any, { rev, etag }: {
    rev: any;
    etag: any;
}): Promise<void>;
export function dropProjection(db: any, id: any): Promise<void>;
export function listProjections(db: any): Promise<any>;
