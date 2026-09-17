import * as jsonUtil from "json-util";
import { F } from "k-ts-framework";

import { DataTableTemplateInfo, EDataTableKeyType, IDataTableTemplate } from "../data-table";
import { IIniTemplate } from "../ini";
import { registerTemplateInfo } from "../Util";
import { JSON_DATA_TYPE, JsonData, JsonDataTemplateInfo } from "./Define";

// const SuperJSON = require("superjson-webpack");

const NEXT = Symbol("next");
const DATA_TABLE_LIBS = new Array<IJsonDataTableLib>();
// const FUNC_MAKE_TEXT = UE.KLocalizationLibrary.MakeText;

// export const setJsonDataExtraDataKey = F.createUtilLinker<(key?: string) => void>();
// export const setJsonDataMapMarker = F.createUtilLinker<(marker?: string) => void>();
// export const setJsonDataBigIntMarker = F.createUtilLinker<(marker?: string) => void>();
export const fetchJsonData = F.createUtilLinker<(path: string) => JsonData | undefined>();
export const setJsonLoadFunc = F.createUtilLinker<(func: (path: string) => any | undefined) => void>();

// ////////////////////////////////////////////////////////////////////////////////////////
export function generateJsonIniWrapper(path: string, tag?: string) {
    registerTemplateInfo(JSON_DATA_TYPE, new JsonDataTemplateInfo(path, tag));

    let data: JsonData | undefined;
    return function () {
        if (!data?.valid) {
            data = fetchJsonData(path);
        }
        F.assert(data?.valid, `JsonIniWrapper: ${path} is not loaded`);
        return data;
    };
}

export function getJsonIniTemplate<T extends IIniTemplate>(data: JsonData | undefined) {
    return data?.obj as T;
}

// 全局注册l10n类型
// type L10NType = object;
// function registerL10N() {
//     SuperJSON.registerCustom<L10NType, string>(
//         {
//             isApplicable: (v: any): v is L10NType =>
//                 typeof v === "object" && "namespace" in v && "key" in v && "text" in v,
//             serialize: (v: any) => v,
//             deserialize: (v: any) => {
//                 return FUNC_MAKE_TEXT(v.namespace, v.key, v.text);
//             },
//         },
//         "l10n",
//     );
// }
// registerL10N();

// 用于superjson注册custom类型的结构
export interface ICustomJsonType {
    name: string;
    isApplicable: (v: any) => boolean;
    serialize: (v: any) => any;
    deserialize: (v: any) => any;
}

export function registerCustomJsonType(type: ICustomJsonType) {
    throw new Error("not implemented");
    // SuperJSON.registerCustom(
    //     {
    //         isApplicable: (v: any): v is object => {
    //             return type.isApplicable(v);
    //         },
    //         serialize: type.serialize,
    //         deserialize: type.deserialize,
    //     },
    //     type.name,
    // );
}

export function parseJson(path: string) {
    let data = CS.NewResourceUtil.ReadTextFile(path);
    return jsonUtil.parse(data);
    // return SuperJSON.parse(data);

    // let data = UE.ExtendLibrary.GetFileContent(path);
    // const EXTRA_DATA_KEY = "__extra__";
    // let extraData;

    // let obj = JSON.parse(data, (_, value: any) => {
    //     if (typeof value === "object" && value !== null) {
    //         if ("namespace" in value && "key" in value && "text" in value) {
    //             return FUNC_MAKE_TEXT(value.namespace, value.key, value.text);
    //         } else {
    //             extraData = Object.getOwnPropertyDescriptor(value, EXTRA_DATA_KEY)?.value;
    //             if (extraData === "map") {
    //                 return new Map(value.data);
    //             } else if (extraData === "bigint") {
    //                 return BigInt(value.data);
    //             }
    //         }
    //     }
    //     return value;
    // });
    // return obj;
}

// ////////////////////////////////////////////////////////////////////////////////////////
export interface IJsonDataTableLib {
    convertWithKey: (rawData: any, keyType: EDataTableKeyType) => any;
    findByKey: (data: JsonData, ...keys: any[]) => IDataTableTemplate | undefined;
    count: (data: JsonData) => number;
    find: (data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean) => IDataTableTemplate | undefined;
    foreach: (data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => void) => void;
    every: (data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean) => boolean;
}

export function generateJsonDataTableWrapper(path: string, keyType: EDataTableKeyType, tag?: string) {
    registerTemplateInfo(JSON_DATA_TYPE, new DataTableTemplateInfo(path, keyType, tag));

    let data: JsonData | undefined;
    return function () {
        if (!data?.valid) {
            data = fetchJsonData(path);
        }
        F.assert(data?.valid, `JsonDataTableWrapper: ${path} is not loaded`);
        return data;
    };
}

export function convertJsonTemplateWithKey(rawData: any, keyType: EDataTableKeyType) {
    let lib = DATA_TABLE_LIBS[keyType];
    return lib.convertWithKey(rawData, keyType);
}

export function findJsonDataTableTemplateByKey<T extends IDataTableTemplate>(data: JsonData | undefined, ...keys: any[]): T | undefined {
    if (!data?.valid) return undefined;
    let lib = DATA_TABLE_LIBS[(data.info as DataTableTemplateInfo).keyType];
    return lib.findByKey(data, ...keys) as T;
}

export function countJsonDataTableTemplate(data: JsonData | undefined): number {
    if (!data?.valid) return 0;
    let lib = DATA_TABLE_LIBS[(data.info as DataTableTemplateInfo).keyType];
    return lib.count(data);
}

export function findJsonDataTableTemplate<T extends IDataTableTemplate>(data: JsonData | undefined, callback: (template: any, ...keys: any[]) => boolean): T | undefined {
    if (!data?.valid) return undefined;
    let lib = DATA_TABLE_LIBS[(data.info as DataTableTemplateInfo).keyType];
    return lib.find(data, callback) as T;
}

export function foreachJsonDataTableTemplate<T extends IDataTableTemplate>(data: JsonData | undefined, callback: (template: T, ...keys: any[]) => void): void {
    if (!data?.valid) return;
    let lib = DATA_TABLE_LIBS[(data.info as DataTableTemplateInfo).keyType];
    lib.foreach(data, callback as any);
}

export function everyJsonDataTableTemplate<T extends IDataTableTemplate>(data: JsonData | undefined, callback: (template: T, ...keys: any[]) => boolean): boolean {
    if (!data?.valid) return false;
    let lib = DATA_TABLE_LIBS[(data.info as DataTableTemplateInfo).keyType];
    return lib.every(data, callback as any);
}

// ////////////////////////////////////////////////////////////////////////////////////////////
DATA_TABLE_LIBS[EDataTableKeyType.Custom] = {
    convertWithKey(rawData: any): any {
        return rawData;
    },
    findByKey(data: JsonData, ...keys: any[]): IDataTableTemplate | undefined {
        F.assert(false, `custom data table not support get`);
    },
    count(data: JsonData): number {
        F.assert(false, `custom data table not support count`);
    },
    find(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean): IDataTableTemplate | undefined {
        F.assert(false, `custom data table not support find`);
    },
    foreach(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => void): void {
        F.assert(false, `custom data table not support foreach`);
    },
    every(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean): boolean {
        F.assert(false, `custom data table not support every`);
    },
};

// ////////////////////////////////////////////////////////////////////////////////////////////
DATA_TABLE_LIBS[EDataTableKeyType.Array] = {
    convertWithKey(rawData: any): any {
        return Array.isArray(rawData) ? rawData : new Array(Object.entries(rawData).values());
    },
    findByKey(data: JsonData, index: number): IDataTableTemplate | undefined {
        let d = data.obj as Array<IDataTableTemplate>;
        if (typeof index !== "number" || index < 0 || index >= d.length) return;
        return d[index];
    },
    count(data: JsonData): number {
        return (data.obj as Array<IDataTableTemplate>).length;
    },
    find(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean): IDataTableTemplate | undefined {
        let d = data.obj as Array<IDataTableTemplate>;
        for (let i = 0; i < d.length; ++i) {
            if (callback(d[i], i)) return d[i];
        }
        return;
    },
    foreach(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => void): void {
        let d = data.obj as Array<IDataTableTemplate>;
        for (let i = 0; i < d.length; ++i) {
            callback(d[i], i);
        }
    },
    every(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean): boolean {
        let d = data.obj as Array<IDataTableTemplate>;
        for (let i = 0; i < d.length; ++i) {
            if (callback(d[i], i)) return false;
        }
        return true;
    },
};

// ////////////////////////////////////////////////////////////////////////////////////////////
DATA_TABLE_LIBS[EDataTableKeyType.Single] = {
    convertWithKey(rawData: any): any {
        return rawData instanceof Map ? rawData : new Map(Object.entries(rawData));
    },
    findByKey(data: JsonData, key: any): IDataTableTemplate | undefined {
        let d = data.obj as Map<any, IDataTableTemplate>;
        return d.get(key);
    },
    count(data: JsonData): number {
        return (data.obj as Map<any, IDataTableTemplate>).size;
    },
    find(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean): IDataTableTemplate | undefined {
        let d = data.obj as Map<any, IDataTableTemplate>;
        for (let [key, value] of d) {
            if (callback(value, key)) return value;
        }
        return;
    },
    foreach(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => void): void {
        let d = data.obj as Map<any, IDataTableTemplate>;
        for (let [k, v] of d) {
            callback(v, k);
        }
    },
    every(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean): boolean {
        let d = data.obj as Map<any, IDataTableTemplate>;
        for (let [k, v] of d) {
            if (!callback(v, k)) return false;
        }
        return true;
    },
};

// ////////////////////////////////////////////////////////////////////////////////////////////
const MULTI_KEY_LIB = {
    convertWithKey(rawData: any, keyType: EDataTableKeyType): any {
        return convertMap(rawData, keyType);
    },
    findByKey(data: JsonData, ...keys: any[]): IDataTableTemplate | undefined {
        let d = data.obj as Map<any, any>;
        return findWithMultiKey(d, keys.length, ...keys);
    },
    count(data: JsonData): number {
        return countWithMultiKey(data.obj as Map<any, IDataTableTemplate>, (data.info as DataTableTemplateInfo).keyType);
    },
    find(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean): IDataTableTemplate | undefined {
        let ret = iterateWithMultiKey(data.obj as Map<any, any>, (data.info as DataTableTemplateInfo).keyType, callback, true) as IDataTableTemplate;
        return ret === NEXT ? undefined : ret;
    },
    foreach(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => void): void {
        iterateWithMultiKey(data.obj as Map<any, any>, (data.info as DataTableTemplateInfo).keyType, callback, undefined);
    },
    every(data: JsonData, callback: (template: IDataTableTemplate, ...keys: any[]) => boolean): boolean {
        return NEXT === iterateWithMultiKey(data.obj as Map<any, any>, (data.info as DataTableTemplateInfo).keyType, callback, false);
    },
};
DATA_TABLE_LIBS[EDataTableKeyType.Double] = MULTI_KEY_LIB;
DATA_TABLE_LIBS[EDataTableKeyType.Triple] = MULTI_KEY_LIB;
DATA_TABLE_LIBS[EDataTableKeyType.Quadruple] = MULTI_KEY_LIB;

function convertMap(data: any, keyCount: number) {
    if (keyCount === 0) return data;

    if (data instanceof Map) {
        for (let [k, v] of data) {
            data.set(k, convertMap(v, keyCount - 1));
        }
        return data;
    } else {
        let map = new Map();
        for (let [key, value] of Object.entries(data)) {
            map.set(key, convertMap(value, keyCount - 1));
        }
        return map;
    }
}

function findWithMultiKey(data: Map<any, any> | undefined, keyCount: number, ...keys: any[]): any {
    if (!data || keyCount === 0 || keys.length === 0) return data;

    F.assert(data instanceof Map, `data is not a Map, keys: ${keys}`);

    let key = keys[0];
    if (!data.has(key)) return;

    return findWithMultiKey(data.get(key), keyCount - 1, ...keys.slice(1));
}

function countWithMultiKey(data: Map<any, any>, keyCount: number) {
    if (keyCount === 0) return 1;

    let size = 0;
    for (let [_, value] of data) {
        size += countWithMultiKey(value, keyCount - 1);
    }
    return size;
}

export function iterateWithMultiKey(
    data: Map<any, any>,
    keyCount: number,
    callback: (template: IDataTableTemplate, ...keys: any[]) => boolean | void,
    breakCallbackValue: boolean | undefined,
    ...keys: any[]
): IDataTableTemplate | symbol {
    let ret;
    if (keyCount === 0) {
        ret = callback(data, ...keys);
        if (breakCallbackValue !== undefined && ret === breakCallbackValue) return data;
        else return NEXT;
    }

    for (let [key, value] of data) {
        ret = iterateWithMultiKey(value, keyCount - 1, callback, breakCallbackValue, ...keys, key);
        if (ret !== NEXT) return ret;
    }
    return NEXT;
}

// ////////////////////////////////////////////////////////////////////////////////////////////
