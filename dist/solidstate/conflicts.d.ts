export function conflicts(db: any, id: any, { remote }?: {}): Promise<{
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
export function resolveIfIdentical(db: any, id: any): Promise<boolean>;
export function resolve(db: any, id: any, merged: any, based: any): Promise<any>;
export function hasConflicts(db: any): Promise<any>;
