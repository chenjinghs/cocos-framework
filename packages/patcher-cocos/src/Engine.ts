import { IEngine, IPatchApplyResult, setFS, setKeyValueStorage, setPath, setSystemLanguageProvider } from "patcher";
import type { IPatchInfo } from "patch-common";

import { cc } from "k-ts-framework-cocos";

import { createCocosFS } from "./FS";
import { path } from "./Path";
import { UpdateUI } from "./UpdateUI";

let preRelease = false;
let reviewMode = false;

/** 下载进度的 XHR 实现：onprogress 换算 current/total 喂进度回调，完成后写入 jsb 文件系统 */
function downloadFileWithXHR(url: string, savePath: string, onProgressChanged?: (current: bigint, total: bigint) => void): Promise<void> {
    if (typeof XMLHttpRequest === "undefined") {
        return Promise.reject(new Error("onDownloadFile: XMLHttpRequest unavailable in this runtime, override via registerPatcherCocos"));
    }

    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    let promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    let xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onprogress = (event) => onProgressChanged?.(BigInt(event.loaded), BigInt(event.total));
    xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(`download failed: ${url}, status: ${xhr.status}`));
            return;
        }
        try {
            if (typeof jsb === "undefined") throw new Error("onDownloadFile: jsb file system unavailable, override via registerPatcherCocos");
            let data = new Uint8Array(xhr.response as ArrayBuffer);
            if (!jsb.fileUtils.writeDataToFile(data, savePath)) throw new Error(`writeDataToFile failed: ${savePath}`);
            resolve();
        } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    };
    xhr.onerror = () => reject(new Error(`download error: ${url}`));
    xhr.send();
    return promise;
}

/**
 * 构造 Cocos 默认补丁引擎实现（IEngine 全量，回调签名对齐 patcher/Define.ts）。
 * 消费项目可按回调覆盖：registerPatcherCocos({ onUnzipFile: ... })。
 */
export function buildDefaultCocosEngine(overrides: Partial<IEngine> = {}): IEngine {
    let updateUI = new UpdateUI();

    // 最小 UI 惰性打开：首次进度/错误回调时挂载（open 内部幂等）；
    // Unity 版在 onApplyCurrentManifest 显式打开，Cocos 默认实现不处理 manifest 挂载语义，故改为惰性
    let ensureUpdateUIOpen = () => updateUI.open("更新中");

    let engine: IEngine = {
        entryUrl: "",
        downloadPath: "patch/download",
        applyPath: "patch/apply",
        apply: true,
        localResVersion: 0,
        maxRetryCount: 3,
        retryIntervalMS: 1000,
        branchVersion: 0,

        onApplyCurrentManifest: (_result: IPatchApplyResult | undefined, _currentResVersion: number) => {
            // 资源挂载语义随引擎实现不同，默认不处理，由消费项目覆盖
        },
        onResetToBuiltinResources: () => {},
        onCheckNetwork: async () => typeof navigator === "undefined" || navigator.onLine !== false,
        onTrackPoint: (tag, info) => console.log(`[TrackPoint] ${tag} ${info ?? ""}`),
        onDownloadProgressChanged: (current, total) => {
            ensureUpdateUIOpen();
            updateUI.setDownloadProgress(current, total);
        },
        onOrganizeProgressChanged: (currentFiles, totalFiles) => {
            ensureUpdateUIOpen();
            updateUI.setOrganizeProgress(currentFiles, totalFiles);
        },
        onComplete: (_result, reason, newVersion) => {
            console.log(`[Patcher] complete: ${reason}, newVersion: ${newVersion}`);
            updateUI.close();
        },
        onError: async (tag, msg) => {
            console.error(`[Patcher] error: ${tag}, msg: ${msg}`);
            ensureUpdateUIOpen();
            updateUI.showError(msg);
        },
        onNewAppNeedDownload: async (url) => {
            if (url && typeof window !== "undefined") window.open(url, "_blank");
        },
        onRestartPatcher: (_newScriptPath) => {
            // 重载当前场景完成补丁脚本重启
            let scene = cc.director.getScene();
            if (scene) cc.director.loadScene(scene.name);
        },
        onPatchCanDownload: async (_dataSize) => true,
        // 引入一个解压库有点大，所以转到外面去搞（与 Unity 版注释一致）
        onUnzipFile: (_filePath, _savePath) => Promise.reject(new Error("onUnzipFile: unzip is delegated to consumer project, override via registerPatcherCocos")),
        onFetchRemoteText: async (url, fetchType, data) => {
            let response = await fetch(url, { method: fetchType ?? "GET", body: data });
            if (!response.ok) throw new Error(`fetch failed: ${url}, status: ${response.status}`);
            return await response.text();
        },
        onDownloadFile: downloadFileWithXHR,
        getOSType: () => String(cc.sys.os),
        getDistroName: () => "",
        getRegion: () => (typeof navigator !== "undefined" ? navigator.language : ""),
        setPreRelease: (value) => {
            preRelease = value;
        },
        setIsReviewMode: (value) => {
            reviewMode = value;
        },
        onFetchNewPatchInfoResult: (result) => {
            savedPatchInfoRef = result;
        },
        setNewEntryUrl: (entryUrl) => {
            engine.entryUrl = entryUrl;
        },
        setPatchInfo: (patchInfo) => {
            savedPatchInfoRef = patchInfo;
        },

        ...overrides,
    };

    return engine;
}

export function isPreRelease(): boolean {
    return preRelease;
}

export function isReviewMode(): boolean {
    return reviewMode;
}

export function getSavedPatchInfo(): IPatchInfo | undefined {
    return savedPatchInfoRef;
}

let savedPatchInfoRef: IPatchInfo | undefined;

/** 装配 patcher 核心所需的引擎实现（IFS/IPath/存储/系统语言），返回最终 IEngine 供 startPatcher 使用 */
export function registerPatcherCocos(engineOverrides: Partial<IEngine> = {}): IEngine {
    setFS(createCocosFS());
    setPath(path);
    setKeyValueStorage({
        // PlayerPrefs 语义对应 cc.sys.localStorage（web/原生均可用）；运行时缺失时退回默认值
        getString: (key, defaultValue) => {
            if (typeof cc.sys.localStorage === "undefined") return defaultValue;
            return cc.sys.localStorage.getItem(key) ?? defaultValue;
        },
    });
    setSystemLanguageProvider(() => {
        if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
        if (typeof jsb !== "undefined") return cc.sys.language;
        return "";
    });

    return buildDefaultCocosEngine(engineOverrides);
}
