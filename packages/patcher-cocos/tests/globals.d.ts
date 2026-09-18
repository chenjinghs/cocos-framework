/** 测试用全局声明：node 类型没有的最小 web/jsb 形状（fileUtils 与 typing/cocos/cc.d.ts 保持一致）。 */

declare const jsb: {
    fileUtils: {
        isFileExist(path: string): boolean;
        isDirectoryExist(path: string): boolean;
        createDirectory(path: string): boolean;
        removeFile(path: string): boolean;
        removeDirectory(path: string): boolean;
        renameFile(oldPath: string, newPath: string): boolean;
        copyFile(srcPath: string, dstPath: string): boolean;
        writeStringToFile(data: string, path: string): boolean;
        writeDataToFile(data: Uint8Array, path: string): boolean;
        getStringFromFile(path: string): string;
        getDataFromFile(path: string): Uint8Array;
        listFiles(path: string): string[] | null;
        getWritablePath(): string;
    };
};

declare class XMLHttpRequest {
    public status: number;
    public response: unknown;
    public responseType: string;
    public onprogress: ((event: { loaded: number; total: number }) => void) | null;
    public onload: (() => void) | null;
    public onerror: (() => void) | null;
    public open(method: string, url: string, async: boolean): void;
    public send(body?: unknown): void;
}

interface Navigator {
    onLine: boolean;
}

declare const window: { open(url: string, target?: string): unknown };
