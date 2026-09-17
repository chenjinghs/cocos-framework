import type { IEngine, IFS, IPath } from "./Define";

export function assert(condition: any, msg?: string | undefined): asserts condition {
    if (!condition) throw new Error(msg);
}

export async function delay(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

export function sleep(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function waitFileReadyToRead(_filePath: string) {
    // 被逼无奈，不延迟解压那边会失败
    await delay(100);
}

export function trackPoint(engine: IEngine, tag: string, info?: string) {
    if (!tag.startsWith("debug_")) engine.onTrackPoint(tag, info);
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// 文件系统与路径：引擎实现注入（patcher-cocos 经 jsb.fileUtils 注入 IFS，纯 JS 注入 IPath）。
// 默认实现一律外抛，沿用 Unity 版"实现转到外面去搞"的模式。
function unavailableFS(method: string): never {
    throw new Error(`IFS.${method}: file system unavailable, inject via setFS() (e.g. patcher-cocos in native runtime)`);
}

export let fs: IFS = {
    readFileTextSync: (filePath) => unavailableFS("readFileTextSync"),
    readFileBufferSync: (filePath) => unavailableFS("readFileBufferSync"),
    mkdirSync: (dirPath) => unavailableFS("mkdirSync"),
    copyFileSync: (srcPath, destPath) => unavailableFS("copyFileSync"),
    moveFileSync: (srcPath, destPath) => unavailableFS("moveFileSync"),
    replaceFileSync: (srcPath, destPath) => unavailableFS("replaceFileSync"),
    rmSync: (path) => unavailableFS("rmSync"),
    rmAsync: async (path) => unavailableFS("rmAsync"),
    existsSync: (path) => unavailableFS("existsSync"),
    writeTextFileSync: (filePath, data) => unavailableFS("writeTextFileSync"),
    getTopFilesInDirectory: (dirPath) => unavailableFS("getTopFilesInDirectory"),
    getAllFilesInDirectory: (dirPath) => unavailableFS("getAllFilesInDirectory"),
};

export function setFS(impl: IFS): void {
    fs = impl;
}

export let path: IPath = {
    basename: (path) => unavailablePath("basename"),
    join: (...paths) => unavailablePath("join"),
    resolve: (...paths) => unavailablePath("resolve"),
    dirname: (path) => unavailablePath("dirname"),
};

function unavailablePath(method: string): never {
    throw new Error(`IPath.${method}: path utils unavailable, inject via setPath() (e.g. patcher-cocos pure JS implementation)`);
}

export function setPath(impl: IPath): void {
    path = impl;
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// 持久化存储与系统语言：原 Unity KPlayerPrefs / Application.systemLanguage 的引擎无关替代，由引擎实现注入。
export interface IKeyValueStorage {
    getString: (key: string, defaultValue: string) => string;
}

export let keyValueStorage: IKeyValueStorage = {
    getString: (_key, defaultValue) => defaultValue,
};

export function setKeyValueStorage(impl: IKeyValueStorage): void {
    keyValueStorage = impl;
}

export let getSystemLanguage: () => string = () => "";

export function setSystemLanguageProvider(provider: () => string): void {
    getSystemLanguage = provider;
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jsSha256 = require("js-sha256").sha256 as (data: string | Uint8Array) => string;

// 哈希在 JS 侧算；性能关键在 readFileBufferSync 必须整块传输，而不是逐字节拷贝。
export function calculateFileSha256(filePath: string): string {
    return jsSha256(fs.readFileBufferSync(filePath));
}
