import type { IFS } from "patcher";

/** 非 jsb 运行时（编辑器预览/web）统一外抛，消费项目可经 registerPatcherCocos({...}) 覆盖 */
function unavailable(method: string): never {
    throw new Error(`IFS.${method}: file system unavailable in this runtime, inject via registerPatcherCocos engine overrides`);
}

function hasJSB(): boolean {
    return typeof jsb !== "undefined";
}

/**
 * Cocos 原生（jsb）文件系统实现。
 * 与 Unity 版语义对齐：Move 不覆盖目标；replaceFileSync 走 .bak 三步原子替换。
 */
export function createCocosFS(): IFS {
    return {
        readFileTextSync: (filePath) => {
            if (!hasJSB()) unavailable("readFileTextSync");
            let content = jsb.fileUtils.getStringFromFile(filePath);
            if (content === null) throw new Error(`readFileTextSync failed, path not exists: ${filePath}`);
            return content;
        },
        readFileBufferSync: (filePath) => {
            if (!hasJSB()) unavailable("readFileBufferSync");
            let content = jsb.fileUtils.getDataFromFile(filePath);
            if (content === null) throw new Error(`readFileBufferSync failed, path not exists: ${filePath}`);
            return content;
        },
        mkdirSync: (dirPath) => {
            if (!hasJSB()) unavailable("mkdirSync");
            jsb.fileUtils.createDirectory(dirPath);
        },
        copyFileSync: (srcPath, destPath) => {
            if (!hasJSB()) unavailable("copyFileSync");
            if (!jsb.fileUtils.copyFile(srcPath, destPath)) throw new Error(`copyFileSync failed: ${srcPath} -> ${destPath}`);
        },
        moveFileSync: (srcPath, destPath) => {
            if (!hasJSB()) unavailable("moveFileSync");
            if (!jsb.fileUtils.renameFile(srcPath, destPath)) throw new Error(`moveFileSync failed: ${srcPath} -> ${destPath}`);
        },
        replaceFileSync: (srcPath, destPath) => {
            if (!hasJSB()) unavailable("replaceFileSync");
            if (!jsb.fileUtils.isFileExist(srcPath)) throw new Error(`replaceFileSync srcPath not exists: ${srcPath}`);
            // 三步原子替换：先备份目标，再移动源，最后删除备份，避免中途崩溃丢失目标文件
            let backupPath = `${destPath}.bak`;
            if (jsb.fileUtils.isFileExist(backupPath)) jsb.fileUtils.removeFile(backupPath);
            if (jsb.fileUtils.isFileExist(destPath) && !jsb.fileUtils.renameFile(destPath, backupPath)) {
                throw new Error(`replaceFileSync backup failed: ${destPath}`);
            }
            if (!jsb.fileUtils.renameFile(srcPath, destPath)) throw new Error(`replaceFileSync move failed: ${srcPath} -> ${destPath}`);
            if (jsb.fileUtils.isFileExist(backupPath)) jsb.fileUtils.removeFile(backupPath);
        },
        rmSync: (path) => {
            if (!hasJSB()) unavailable("rmSync");
            if (jsb.fileUtils.isDirectoryExist(path)) jsb.fileUtils.removeDirectory(path);
            else jsb.fileUtils.removeFile(path);
        },
        rmAsync: async (path) => {
            if (!hasJSB()) unavailable("rmAsync");
            if (jsb.fileUtils.isDirectoryExist(path)) jsb.fileUtils.removeDirectory(path);
            else jsb.fileUtils.removeFile(path);
        },
        existsSync: (path) => {
            if (!hasJSB()) unavailable("existsSync");
            return jsb.fileUtils.isFileExist(path) || jsb.fileUtils.isDirectoryExist(path);
        },
        writeTextFileSync: (filePath, data) => {
            if (!hasJSB()) unavailable("writeTextFileSync");
            if (!jsb.fileUtils.writeStringToFile(data, filePath)) throw new Error(`writeTextFileSync failed: ${filePath}`);
        },
        getTopFilesInDirectory: (dirPath) => {
            if (!hasJSB()) unavailable("getTopFilesInDirectory");
            let files = jsb.fileUtils.listFiles(dirPath);
            if (files === null) return [];
            return files.filter((file) => jsb.fileUtils.isFileExist(file));
        },
        getAllFilesInDirectory: (dirPath) => {
            if (!hasJSB()) unavailable("getAllFilesInDirectory");
            let ret: string[] = [];
            let walk = (dir: string) => {
                let files = jsb.fileUtils.listFiles(dir);
                if (files === null) return;
                for (let file of files) {
                    if (jsb.fileUtils.isDirectoryExist(file)) walk(file);
                    else ret.push(file);
                }
            };
            walk(dirPath);
            return ret;
        },
    };
}
