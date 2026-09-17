import { ETrackingPoint, IEngine, IFS, IPath, UI_ROOT_NAME, UI_SPLASH_NAME, UI_SPLASH_PREFAB_PATH } from "./Define";

export const CS_GAME_OBJECT = CS.UnityEngine.GameObject;
const CS_IO_FILE = CS.System.IO.File;
const CS_IO_DIRECTORY = CS.System.IO.Directory;

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

export async function waitFileReadyToRead(_filePath: string) {
    // 被逼无奈，不延迟c#那边解压会失败
    await delay(100);
}

export function trackPoint(engine: IEngine, tag: string, info?: string) {
    if (!tag.startsWith("debug_")) engine.onTrackPoint(tag, info);
}

export function getUIResolutionController() {
    let uiRoot = CS_GAME_OBJECT.Find(UI_ROOT_NAME);
    assert(uiRoot, `${UI_ROOT_NAME} not found`);
    return uiRoot.GetComponent(puer.$typeof(CS.KingSoft.UI.UIResolutionController)) as CS.KingSoft.UI.UIResolutionController;
}

export function createUI(path: string, name: string) {
    let uiResolutionController = getUIResolutionController();
    let ui = CS.NewResourceUtil.LoadSyncAndInstantiate(path, uiResolutionController.gameObject, name);
    uiResolutionController.AddToScreen(ui);
    return ui;
}

export function destroyUI(ui: CS.UnityEngine.GameObject) {
    let uiResolutionController = getUIResolutionController();
    uiResolutionController.RemoveFromScreen(ui);
    CS.UnityEngine.GameObject.Destroy(ui);
}

export async function openSplashUI(engine: IEngine) {
    return new Promise<void>((resolve) => {
        let splashUI = createUI(UI_SPLASH_PREFAB_PATH, UI_SPLASH_NAME);
        assert(splashUI, "SplashUI load failed");

        let anim = splashUI.GetComponent(puer.$typeof(CS.UnityEngine.Animation)) as CS.UnityEngine.Animation;
        let eventHandler = splashUI.GetComponent(puer.$typeof(CS.AnimationEventDispatcher)) as CS.AnimationEventDispatcher;
        eventHandler.AddCompleteCallback((_eventName: string) => {
            console.log("SplashUI destroyed");
            destroyUI(splashUI);
            resolve();
        });

        anim.Play();
        console.log(`SplashUI play, anim length: ${anim.clip.length}`);
        trackPoint(engine, ETrackingPoint.SplashUIOpen);
    });
}

export async function waitSplashUIClosed() {
    while (CS_GAME_OBJECT.Find(UI_SPLASH_NAME) !== null) {
        await delay(100);
    }
}

export const fs: IFS = {
    readFileTextSync: (filePath: string) => {
        return CS_IO_FILE.ReadAllText(filePath);
    },
    readFileBufferSync: (filePath: string): Uint8Array => {
        // BufferUtil.ToBuffer 把 C# byte[] 一次性转成 JS ArrayBuffer。
        // 不能逐字节 get_Item：那是每字节一次跨界调用，大文件会把主线程冻住几十分钟（实测 83KB 约 2.3 秒，曾致启动 ANR）。
        return new Uint8Array(CS.BufferUtil.ToBuffer(CS_IO_FILE.ReadAllBytes(filePath)));
    },
    mkdirSync: (dirPath: string) => {
        CS_IO_DIRECTORY.CreateDirectory(dirPath);
    },
    copyFileSync: (srcPath: string, destPath: string) => {
        assert(CS_IO_FILE.Exists(srcPath), `copyFileSync srcPath not exists: ${srcPath}`);
        CS_IO_FILE.Copy(srcPath, destPath, true);
    },
    moveFileSync: (srcPath: string, destPath: string) => {
        // download 和 data 均位于 persistentDataPath，同盘 rename 避免重新读写整份资源。
        CS_IO_FILE.Move(srcPath, destPath);
    },
    replaceFileSync: (srcPath: string, destPath: string) => {
        assert(CS_IO_FILE.Exists(srcPath), `replaceFileSync srcPath not exists: ${srcPath}`);
        // 三步原子替换：先 rename dest 为 .bak，再 move src 到 dest，最后 delete .bak。
        // 避免 Delete + Move 两步操作在进程崩溃时丢失目标文件。
        let backupPath = destPath + ".bak";
        if (CS_IO_FILE.Exists(backupPath)) {
            CS_IO_FILE.Delete(backupPath);
        }
        if (CS_IO_FILE.Exists(destPath)) {
            CS_IO_FILE.Move(destPath, backupPath);
        }
        CS_IO_FILE.Move(srcPath, destPath);
        if (CS_IO_FILE.Exists(backupPath)) {
            CS_IO_FILE.Delete(backupPath);
        }
    },
    rmSync: (path: string) => {
        if (CS_IO_DIRECTORY.Exists(path)) {
            try {
                CS_IO_DIRECTORY.Delete(path, true);
            } catch (e) {
                // 如果删除失败，可能是因为目录不为空，尝试删除目录下的所有文件
                let files = CS_IO_DIRECTORY.GetFiles(path);
                for (let i = 0; i < files.Length; i++) {
                    CS_IO_FILE.Delete(files.get_Item(i));
                }
                // 再次尝试删除目录
                CS_IO_DIRECTORY.Delete(path, true);
            }
        } else if (CS_IO_FILE.Exists(path)) {
            CS_IO_FILE.Delete(path);
        }
    },
    rmAsync: async (path: string) => {
        let lastError;
        for (let i = 0; i < 10; i++) {
            try {
                fs.rmSync(path);
                return;
            } catch (e) {
                lastError = e;
                await sleep(100);
            }
        }
        throw lastError;
    },
    existsSync: (path: string): boolean => {
        return CS_IO_FILE.Exists(path) || CS_IO_DIRECTORY.Exists(path);
    },
    writeTextFileSync: (filePath: string, data: string) => {
        CS_IO_FILE.WriteAllText(filePath, data);
    },
    getTopFilesInDirectory: (dirPath: string): string[] => {
        const tempDirPath = dirPath.replaceAll("\\", "/");
        if (!CS_IO_DIRECTORY.Exists(tempDirPath)) return [];

        let files = CS_IO_DIRECTORY.GetFileSystemEntries(tempDirPath, "*", CS.System.IO.SearchOption.TopDirectoryOnly);
        let ret: string[] = [];

        let count = files.Length;
        for (let i = 0; i < count; i++) {
            ret.push(files.get_Item(i).replaceAll("\\", "/"));
        }

        return ret;
    },
    getAllFilesInDirectory: (dirPath: string): string[] => {
        const tempDirPath = dirPath.replaceAll("\\", "/");
        if (!CS_IO_DIRECTORY.Exists(tempDirPath)) return [];

        let files = CS_IO_DIRECTORY.GetFiles(tempDirPath, "*", CS.System.IO.SearchOption.AllDirectories);
        let ret: string[] = [];
        let count = files.Length;
        for (let i = 0; i < count; i++) {
            ret.push(files.get_Item(i).replaceAll("\\", "/"));
        }
        return ret;
    },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jsSha256 = require("js-sha256").sha256 as (data: string | Uint8Array) => string;

// System.Security.Cryptography.SHA256 没有生成 wrapper/RegisterInfo，Puerts(v2) 运行时解析不到（MuMu 实测），
// 所以哈希在 JS 侧算；性能关键在 readFileBufferSync 必须走 BufferUtil 整块传输，而不是逐字节 interop。
export function calculateFileSha256(filePath: string): string {
    return jsSha256(fs.readFileBufferSync(filePath));
}

export const path: IPath = {
    basename: (path: string) => {
        return CS.System.IO.Path.GetFileName(path);
    },
    join: (...paths: string[]) => {
        return CS.System.IO.Path.Combine(...paths);
    },
    resolve: (...paths: string[]) => {
        return CS.System.IO.Path.GetFullPath(CS.System.IO.Path.Combine(...paths));
    },
    dirname: (path: string) => {
        return CS.System.IO.Path.GetDirectoryName(path);
    },
};

export function sleep(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}
