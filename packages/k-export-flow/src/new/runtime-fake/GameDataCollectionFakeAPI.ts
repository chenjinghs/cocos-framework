/* eslint-disable @typescript-eslint/no-empty-interface */
// 为了编辑器能编过
// data table

export interface IDataTableTemplate {}
export interface IIniTemplate {}

export function findTemplate(...keys: any[]): any {
    throw new Error("Method not implemented.");
}

export function getTemplate(...keys: any[]): any {
    throw new Error("Method not implemented.");
}

export function getTemplateCount(): number {
    throw new Error("Method not implemented.");
}

export function findTemplateWithCallback(callback: (template: any, ...keys: any[]) => boolean): any {
    throw new Error("Method not implemented.");
}

export function foreachTemplate(callback: (template: any, ...keys: any[]) => boolean) {
    throw new Error("Method not implemented.");
}

export function everyTemplate(callback: (template: any, ...keys: any[]) => boolean): boolean {
    throw new Error("Method not implemented.");
}

export function getAllCustomData<T>(): T {
    throw new Error("Method not implemented.");
}

export function dataTable(): any {
    throw new Error("Method not implemented.");
}
