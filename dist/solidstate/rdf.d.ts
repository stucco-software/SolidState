export const XSD: "http://www.w3.org/2001/XMLSchema#";
export const NQUADS: "application/n-quads";
export const legacyContext: {
    '@base': string;
    '@vocab': string;
};
export function stripPouch(doc: any): any;
export function nodeToNQuads(doc: any, context: any): any;
export function sameGraph(a: any, b: any): Promise<boolean>;
export function nativize(node: any, context: any): any;
export function nquadsToNodes(nquads: any, context: any): Promise<any>;
export function nquadsToNode(nquads: any, context: any, id: any): Promise<any>;
