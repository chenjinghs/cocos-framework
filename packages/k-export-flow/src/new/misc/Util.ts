import * as fs from "fs";
import * as jsonUtil from "json-util";
import * as path from "path";
// import * as JsonBigInt from "@pgherveou/json-bigint";
import { Md5 } from "ts-md5";

import { formatLoc, newLocError } from "./Localization";

export function assert(condition: any, msg: string): asserts condition {
    if (!condition) throw new Error(msg);
}

export function getFileExtension(file: string) {
    return path.extname(file);
    // const basename = path.basename(file);
    // const firstDot = basename.indexOf(".");
    // const lastDot = basename.lastIndexOf(".");
    // const extname = path.extname(basename).replace(/(\.[a-z0-9]+).*/i, "$1");

    // if (firstDot === lastDot) {
    //     return extname;
    // }

    // return basename.slice(firstDot, lastDot) + extname;
}

export function getFileBaseName(file: string) {
    return path.basename(file).replace(getFileExtension(file), "");
}

// https://stackoverflow.com/questions/5827612/node-js-fs-readdir-recursive-directory-search
export function walkParallel(dir: string, done: any) {
    let results = new Array<string>();
    fs.readdir(dir, (err: any, list: string[]) => {
        if (err !== null) return done(err);

        let pending = list.length;
        if (!pending) return done(null, results);
        list.forEach((inFile) => {
            let file = path.resolve(dir, inFile);
            fs.stat(file, (err: any, stat: any) => {
                if (stat?.isDirectory()) {
                    // eslint-disable-next-line max-nested-callbacks
                    walkParallel(file, (err: any, res: any) => {
                        results = results.concat(res);
                        if (!--pending) done(null, results);
                    });
                } else {
                    results.push(file);
                    if (!--pending) done(null, results);
                }
            });
        });
    });
}

export async function walkParallelPromise(dir: string) {
    return new Promise<string[]>((resolve, reject) => {
        walkParallel(dir, (err: any, list: string[]) => {
            if (err !== null) reject(err);
            else resolve(list);
        });
    });
}

export function deepCopy<T>(source: T): T {
    return structuredClone(source);
}

export function convertMapToObject(map: Map<any, any>) {
    let temp = [];
    for (let kv of map) temp.push(kv);
    return temp;
}

export interface JsonOptions {
    jsonType?: string;
    convertObj?: boolean;
}

export function convertObjWithMarker(obj: any, key: any, marker: any) {
    return {
        [key]: marker,
        data: obj,
    };
}

// export interface IConvertObjectConfig {
//     exportMap?: boolean;
//     removeUndefined?: boolean;
//     useSuperJson?: boolean;
// }

// function verifyInvalidKey(arr: Array<any>, key: any, value: any, config: IConvertObjectConfig) {
//     let temp = convertObject(value, config);
//     if (config.removeUndefined === false) return temp;
//     if (temp === null || temp === undefined) arr.push(key);
//     return temp;
// }

// // TODO: 写的太丑，待优化
// export function convertObject(obj: any, config: IConvertObjectConfig) {
//     if (typeof obj !== "object") return obj;

//     let ret = obj;
//     let arr;

//     if (obj instanceof Map) {
//         if (config.exportMap && !config.useSuperJson) {
//             let removeUndefined = config.removeUndefined !== false;
//             let temp;
//             ret = {} as any;

//             let keyType = EMapKeyType.String;
//             for (let [k, v] of obj) {
//                 if (typeof k === "number") keyType = EMapKeyType.Number;
//                 temp = convertObject(v, config);
//                 if ((temp === null || temp === undefined) && removeUndefined) continue;
//                 ret[k] = temp;
//             }
//             ret.__m = keyType;
//             return ret;
//         } else {
//             arr = new Array<any>();
//             for (let [k, v] of ret) ret.set(k, verifyInvalidKey(arr, k, v, config));
//             arr.forEach((v) => ret.delete(v));
//         }
//     } else if (Array.isArray(ret)) {
//         arr = new Array<any>();
//         for (let i = 0; i < obj.length; ++i) ret[i] = verifyInvalidKey(arr, i, obj[i], config);
//         arr.forEach((v) => ret.splice(v, 1));
//     } else {
//         arr = new Array<any>();
//         for (let [key, value] of Object.entries(ret)) ret[key] = verifyInvalidKey(arr, key, value, config);
//         arr.forEach((v) => delete ret[v]);
//     }

//     return ret;
// }

// // type L10NType = object;
// // function registerJsonL10n() {
// //     SuperJSON.registerCustom<L10NType, string>(
// //         {
// //             isApplicable: (v: any): v is L10NType =>
// //                 typeof v === "object" && "namespace" in v && "key" in v && "text" in v,
// //             serialize: (v: any) => v,
// //             deserialize: (v: any) => v,
// //         },
// //         "l10n",
// //     );
// // }
// // registerJsonL10n();

// 用于superjson注册custom类型的结构
export interface ICustomJsonTransformer {
    name: string;
    isApplicable: (v: any) => boolean;
    serialize: (v: any) => any;
    deserialize: (v: any) => any;
}

export function registerCustomJsonType(transformer: ICustomJsonTransformer) {
    throw new Error("not implemented");
    // SuperJSON.registerCustom(
    //     {
    //         isApplicable: (v: any): v is object => {
    //             return transformer.isApplicable(v);
    //         },
    //         serialize: transformer.serialize,
    //         deserialize: transformer.deserialize,
    //     },
    //     transformer.name,
    // );
}

export const jsonStringify = jsonUtil.stringify;
export const jsonParse = jsonUtil.parse;
export const convertFromJsonObject = jsonUtil.convertFromJsonObject;
export const convertToJsonObject = jsonUtil.convertToJsonObject;

// export function jsonStringify(obj: unknown, opts?: JsonOptions) {
//     let config = getGlobalConfig();
//     let exportMap = config.defaultExportMapInJson;

//     // if (opts?.jsonType !== undefined) exportMap = opts?.jsonType === "map";
//     // else exportMap = config.defaultExportMapInJson;

//     // let useSuperJson = opts ? opts.jsonType !== "jsonObject" : true;
//     let useSuperJson = false;

//     let ret = obj;
//     if (opts?.convertObj !== false) {
//         ret = convertObject(obj, {
//             exportMap: exportMap,
//             useSuperJson: useSuperJson,
//         });
//     }
//     return useSuperJson ? SuperJSON.stringify(ret) : JSON.stringify(ret);

//     // return JSON.stringify(
//     //     obj,
//     //     (k: any, v: any) => {
//     //         if (v instanceof Map) {
//     //             let ret = convertMapToObject(v);
//     //             if (exportMap) return convertObjWithMarker(ret, config.defaultExtraDataKeyInJson, "map");
//     //             else return ret;
//     //         } else if (typeof v === "bigint") {
//     //             return convertObjWithMarker(v, config.defaultExtraDataKeyInJson, "bigint");
//     //         } else {
//     //             return v;
//     //         }
//     //     },
//     //     "\t",
//     // );
// }

// export function parseJson(data: string, opts?: JsonOptions) {
//     let config = getGlobalConfig();
//     let useSuperJson = opts ? opts.jsonType !== "jsonObject" : true;

//     let obj = useSuperJson ? SuperJSON.parse(data) : JSON.parse(data);

//     // let data = UE.ExtendLibrary.GetFileContent(path);
//     // const EXTRA_DATA_KEY = "__extra__";
//     // let extraData;

//     // let obj = JSON.parse(data, (_, value: any) => {
//     //     if (typeof value === "object" && value !== null) {
//     //         if ("namespace" in value && "key" in value && "text" in value) {
//     //             return FUNC_MAKE_TEXT(value.namespace, value.key, value.text);
//     //         } else {
//     //             extraData = Object.getOwnPropertyDescriptor(value, EXTRA_DATA_KEY)?.value;
//     //             if (extraData === "map") {
//     //                 return new Map(value.data);
//     //             } else if (extraData === "bigint") {
//     //                 return BigInt(value.data);
//     //             }
//     //         }
//     //     }
//     //     return value;
//     // });
//     return obj;
// }

export async function loadTextFileData(file: string, config?: unknown) {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(file, "utf-8", (err: any, data: string) => {
            if (err === null) resolve(data);
            else reject(formatLoc(`read-text-file-failed`, { file: file, error: err }));
        });
    });
}

export async function loadBinaryFileData(file: string, config?: unknown) {
    return new Promise((resolve, reject) => {
        fs.readFile(file, (err: any, data: unknown) => {
            if (err === null) resolve(data);
            else reject(formatLoc(`read-binary-file-failed`, { file: file, error: err }));
        });
    });
}

export async function pathExists(path: string) {
    return new Promise<boolean>((resolve) => {
        fs.stat(path, (err, stat) => {
            resolve(err === null);
        });
    });
}

async function rmPathImp(path: string) {
    return new Promise<void>((resolve, reject) => {
        fs.rm(path, { recursive: true, force: true }, (err: any) => {
            if (err === null) resolve();
            else reject(err);
        });
    });
}

export async function rmPath(path: string) {
    let lastError: any;
    for (let i = 0; i < 10; i++) {
        try {
            await rmPathImp(path);
            return;
        } catch (e: any) {
            lastError = e;
            if (e.code !== "EBUSY") break;
            await sleep(100);
        }
    }

    throw newLocError(`rm-path-failed`, { path: path, error: lastError });
}

export async function mkDir(path: string) {
    return new Promise<void>((resolve, reject) => {
        fs.mkdir(path, { recursive: true }, (err: any) => {
            if (err === null) resolve();
            else reject(formatLoc(`mk-dir-failed`, { path: path, error: err }));
        });
    });
}

export async function writeFile(path: string, data: any) {
    return new Promise<void>((resolve, reject) => {
        fs.writeFile(path, data, (err: any) => {
            if (err === null) resolve();
            else reject(formatLoc(`write-file-failed`, { file: path, error: err }));
        });
    });
}

export async function ensureDir(path: string) {
    if (!(await pathExists(path))) {
        await mkDir(path);
    }
}

export async function ensureFile(path: string) {
    if (!(await pathExists(path))) {
        await writeFile(path, "");
    }
}

export async function md5File(path: string) {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(path, (err, data) => {
            if (err !== null) reject(err);
            else {
                let ret = new Md5().appendByteArray(data).end() as string;
                if (ret !== undefined) resolve(ret);
                // eslint-disable-next-line prefer-promise-reject-errors
                else reject(`md5 failed, path: ${path}`);
            }
        });
    });
}

export function md5FileSync(path: string) {
    let data = fs.readFileSync(path);
    return new Md5().appendByteArray(data).end() as string;
}

import { fastHash } from "./FastHash";

export function generateMD5(data: string) {
    return fastHash(data);
}

export function createRegExpFromString(reg: string) {
    let ret = reg.match(/^\/(.+)\/([a-z]*)$/);
    if (!ret) return new RegExp(reg, "g");
    else return new RegExp(ret[1], ret[2]);
}

export function getExcelColumName(col: number) {
    let result = "";
    let c = col;
    while (c > 0) {
        const remainder = (c - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        c = Math.floor((c - remainder) / 26);
    }
    return result;
}

export async function copyDir(from: string, to: string) {
    // 读取源目录中的文件列表
    const files = await fs.promises.readdir(from);
    await ensureDir(to);

    // 遍历文件列表
    for (const file of files) {
        // 构建源文件和目标文件的完整路径
        const sourcePath = path.join(from, file);
        const targetPath = path.join(to, file);

        // 获取文件的状态信息
        const stats = await fs.promises.stat(sourcePath);

        if (stats.isFile()) {
            // 如果是文件，则进行拷贝
            await fs.promises.copyFile(sourcePath, targetPath);
        } else if (stats.isDirectory()) {
            // 如果是目录，则递归调用 copyFiles 函数拷贝子目录
            await fs.promises.mkdir(targetPath, { recursive: true });
            await copyDir(sourcePath, targetPath);
        }
    }
}

export async function copyFile(from: string, to: string) {
    await ensureDir(path.dirname(to));
    await fs.promises.copyFile(from, to);
}

export function getErrorInfo(exception: any) {
    return exception ? (typeof exception === "string" ? exception : `${exception.message}\n${exception.stack}\n`) : "none";
}

export function sleep(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}
