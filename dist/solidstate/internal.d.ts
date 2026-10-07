export const INTERNAL_PREFIX: "solidstate:";
export const PROJECTION_PREFIX: "solidstate:projection:";
export function projectionId(id: any): string;
export function isInternal(id: any): boolean;
export function isProjectable(id: any): boolean;
export function generation(rev: any): number;
export function revList(doc: any): any;
