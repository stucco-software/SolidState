export function memoryDb(): any;
export function events(): {
    emit: (name: any, detail: any) => number;
    seen: any[];
    named: (name: any) => any[];
};
