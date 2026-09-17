/* eslint-disable complexity */
import type { IPatchInfo } from "patch-common";
import { DEFAULT_GAME_LANGUAGE, EGameLanguage, REPAIR_PATCH_KEY } from "patch-common";

import { BRANCH_VERSION_FILE_NAME, ETrackingPoint, GAME_SCENE_NAME, IEngine, IGNORED_ERRORS, IPatchApplyResult, PATCH_SCRIPT_FILE_NAME, SPECIFIC_VERSION_LOCAL_KEY, UI_BACKGROUND_RT, UI_BLACK_BACKGROUND_NAME, UI_CAMERA_NAME, UI_ROOT_NAME } from "./Define";
import { getLocalization } from "./Localization";
import { startPatcher } from "./Patcher";
import { plugin } from "./Plugin";
import { UpdateUI } from "./UpdateUI";
import { assert, CS_GAME_OBJECT, delay, fs } from "./Util";

let updateUI: UpdateUI | undefined;
// let restartTimes = 0;
let csTrackingPointManager = CS.TrackingPointManager.Get();
const STORAGE_ERROR_CODE = -100; // 自定义错误码，表示存储空间不足

interface IPatcherSettings {
    builtinLanguages?: unknown;
    defaultLanguage?: unknown;
}

function isGameLanguage(language: unknown): language is EGameLanguage {
    return typeof language === "string" && Object.values(EGameLanguage).includes(language as EGameLanguage);
}

function normalizePatcherSettings(settings?: IPatcherSettings) {
    let localDefaultLanguage = isGameLanguage(settings?.defaultLanguage) ? settings.defaultLanguage : DEFAULT_GAME_LANGUAGE;
    let localBuiltinLanguages = Array.isArray(settings?.builtinLanguages) ? settings.builtinLanguages.filter(isGameLanguage) : [];
    if (!localBuiltinLanguages.includes(localDefaultLanguage)) {
        localBuiltinLanguages = [localDefaultLanguage, ...localBuiltinLanguages];
    }

    return {
        localBuiltinLanguages: Array.from(new Set(localBuiltinLanguages)),
        localDefaultLanguage,
    };
}

function readLocalPatcherSettings() {
    try {
        let content = CS.NewResourceUtil.ReadTextFromStreamingAssetsOrPersistentPath("patcher-settings.json");
        return normalizePatcherSettings(JSON.parse(content) as IPatcherSettings);
    } catch (err) {
        console.warn(`read patcher-settings.json failed, fallback to default language: ${err}`);
        return normalizePatcherSettings();
    }
}

function trackPoint(tag: string, info?: string) {
    if (tag.startsWith("__")) {
        console.log(`[Patcher] ${tag} ${info ? "info: " + info : ""}`);
    } else if (tag.indexOf("failed") >= 0 || tag.indexOf("error") >= 0) {
        console.warn(`[TrackPoint] ${tag} ${info ? "info: " + info : ""}`);
        csTrackingPointManager.Track2("client_start", "client_event_name", tag, "client_event_failed_msg", info);
    } else {
        console.log(`[TrackPoint] ${tag} ${info ? "info: " + info : ""}`);
        csTrackingPointManager.Track1("client_start", "client_event_name", tag);
    }
}

function findGameObjectInUIRoot(uiRoot: CS.UnityEngine.Transform, name: string) {
    let childCount = uiRoot.childCount;
    for (let i = 0; i < childCount; i++) {
        let child = uiRoot.GetChild(i);
        if (child.name === name) return child.gameObject;
    }
    return undefined;
}

function handleFocusChanged(hasFocus: boolean) {
    CS.TrackingPointManager.Get().Track1("client_start", "client_event_name", hasFocus ? "application_focus" : "application_unfocus");
}

async function work() {
    console.log(`patcher work start `);

    const UnityEngine = CS.UnityEngine;
    let csPatcher = CS.Patcher.FindPatcher();
    assert(csPatcher, "csPatcher is null");

    let csPatcherInfo = CS.PatcherInfo.Get();
    CS.SentryUtil.SetTag("app_res_version", String(csPatcherInfo.localResVersion));
    CS.SentryUtil.SetTag("env", csPatcherInfo.environment);
    CS.SentryUtil.SetTag("build_number", csPatcherInfo.buildNumber);
    console.log(`patcher set sentry tags: app_res_version: ${csPatcherInfo.localResVersion}, env: ${csPatcherInfo.environment}, buildNumber: ${csPatcherInfo.buildNumber}`);

    if (csPatcherInfo.localResVersion < 74883) {
        handleFocusChanged(CS.UnityEngine.Application.isFocused);
        CS.UnityEngine.Application.add_focusChanged(handleFocusChanged);
    }

    let downloadPath = UnityEngine.Application.persistentDataPath + "/" + csPatcher.downloadPath;
    let applyPath = CS.ResourceRuleSettings.GetPersistentDataPath();
    let needRepair = CS.KPlayerPrefs.GetInt(REPAIR_PATCH_KEY, 0) === 1;
    if (needRepair) {
        let repairSuccess = await repairPatch(downloadPath, applyPath, csPatcherInfo.localResVersion);
        if (repairSuccess) {
            console.log(`[RepairPatch] Repair succeeded, clearing repair flag`);
            CS.KPlayerPrefs.SetInt(REPAIR_PATCH_KEY, 0);
            await restart();
            return;
        }
        console.error(`[RepairPatch] Repair failed, will continue with normal patch flow`);
    }

    let engine: IEngine;
    // let finished = false;
    let showUI = csPatcher.showUI;
    let uiRoot = CS_GAME_OBJECT.Find(UI_ROOT_NAME).transform;
    let bg = findGameObjectInUIRoot(uiRoot, UI_BLACK_BACKGROUND_NAME);
    bg?.SetActive(showUI);
    let bgRT = findGameObjectInUIRoot(uiRoot, UI_BACKGROUND_RT);
    bgRT?.SetActive(false);
    console.log(`showUI: ${showUI}, bg: ${!!bg}, bgRT: ${!!bgRT}`);

    let lastProgress = 0;
    let specificVersion = verifySpecificVersion(downloadPath);
    let branchVersionInfo = (JSON.parse(CS.NewResourceUtil.ReadTextFromStreamingAssetsOrPersistentPath(BRANCH_VERSION_FILE_NAME)) as { version?: string }) ?? {};
    let branchVersion = Number(getParamFromCommandLine("branch_version") ?? branchVersionInfo.version ?? 0);
    csPatcherInfo.branchVersion = branchVersion;
    console.log(`branchVersion: ${branchVersion}, specificVersion: ${specificVersion}`);

    let { localBuiltinLanguages, localDefaultLanguage } = readLocalPatcherSettings();
    console.log(`localBuiltinLanguages: ${JSON.stringify(localBuiltinLanguages)}, localDefaultLanguage: ${localDefaultLanguage}`);

    verifySavedResolution();

    function applyResult(result: IPatchApplyResult | undefined, version: number, reset: boolean) {
        CS.NewResourceUtil.ClearMountPackages();
        if (result) {
            let resourceRoot = CS.ResourceRuleSettings.GetRootPath() + "/";
            for (let [k, v] of result.files) {
                let key = k.replace("\\", "/").replace(resourceRoot, "");
                CS.NewResourceUtil.MountPackage(key, v as string);
            }
        }
        csPatcherInfo.currentResVersion = version;
        CS.SentryUtil.SetTag("current_res_version", String(version));

        if (reset) {
            CS.NewResourceUtil.Reset(csPatcherInfo.localResVersion === version, true);
        } else {
            CS.ResourceManager.Get().ResetResourceRule(csPatcherInfo.localResVersion === version, true);
            CS.ResourceManager.Get().LoadDependency();
        }
    }

    engine = {
        entryUrl: getParamFromCommandLine("entry_url") ?? csPatcherInfo.entryUrl,
        downloadPath,
        applyPath,
        apply: csPatcher.applyAfterDownload,
        localResVersion: csPatcherInfo.localResVersion,
        localCheckMode: csPatcher.localCheckMode,
        maxRetryCount: csPatcher.maxRetryCount,
        retryIntervalMS: csPatcher.retryIntervalMS,
        branchVersion: branchVersion,

        onApplyCurrentManifest: (result: IPatchApplyResult | undefined, currentResVersion: number) => {
            trackPoint(ETrackingPoint.ApplyPatchResult, `currentResVersion: ${currentResVersion}`);
            applyResult(result, currentResVersion, false);

            // 必须apply后才开UI，否则上一次的热更的UI资源不生效
            if (showUI) {
                bg?.SetActive(false);
                updateUI = new UpdateUI(engine);

                // 跟策划沟通，先不要了
                // if (CS.PatcherInfo.launchTimes === 1 && restartTimes === 0) openSplashUI(engine);
                updateUI.open(csPatcherInfo, currentResVersion);
            }
        },

        onResetToBuiltinResources: () => {
            // Reset 会卸载旧界面依赖的资源，关闭后再用包内资源重建。
            updateUI?.close();
            updateUI = undefined;
            applyResult(undefined, csPatcherInfo.localResVersion, true);
            if (showUI) {
                updateUI = new UpdateUI(engine);
                updateUI.open(csPatcherInfo, csPatcherInfo.localResVersion);
            }
        },

        onCheckNetwork: async () => {
            if (UnityEngine.Application.internetReachability === UnityEngine.NetworkReachability.NotReachable) {
                if (updateUI) return await updateUI.showNoNetworkDialog();
                else return false;
            }
            return true;
        },

        onTrackPoint: trackPoint,

        onOrganizeProgressChanged: (currentFiles, totalFiles) => {
            updateUI?.setOrganizeProgress(currentFiles, totalFiles);
        },

        onDownloadProgressChanged: (current: bigint, total: bigint) => {
            let progress = Number(current) / Number(total);
            if (lastProgress < 0.25 && progress >= 0.25) trackPoint(ETrackingPoint.DownloadPatchProgress25);
            if (lastProgress < 0.5 && progress >= 0.5) trackPoint(ETrackingPoint.DownloadPatchProgress50);
            if (lastProgress < 0.75 && progress >= 0.75) trackPoint(ETrackingPoint.DownloadPatchProgress75);

            lastProgress = progress;
            updateUI?.setProgress(current, total, true);
        },

        onComplete: async (result: IPatchApplyResult | undefined, reason: ETrackingPoint, newVersion: number) => {
            updateUI?.setProgress(1n, 1n);
            await delay(10); // 等一针，让UI显示

            const snapshot = async () => {
                // 不等camera render不对
                // await delay(1000);

                let camera = CS_GAME_OBJECT.Find(UI_CAMERA_NAME).GetComponent(puer.$typeof(CS.UnityEngine.Camera)) as CS.UnityEngine.Camera;
                let bgRT = findGameObjectInUIRoot(uiRoot, UI_BACKGROUND_RT)!;
                let bg = bgRT.GetComponent(puer.$typeof(CS.UnityEngine.UI.RawImage)) as CS.UnityEngine.UI.RawImage;
                bg.texture = CS.SnapshotUtil.SnapshotWithoutRectTransform(camera);
                bgRT.SetActive(true);
                console.log(`snapshot complete`);
            };

            // await waitSplashUIClosed();

            if (updateUI) {
                if (reason === ETrackingPoint.PatchFinish && engine.apply) {
                    await snapshot();
                }
                updateUI.setProgressText(getLocalization().enter_gaming);
                updateUI.updateProgressValueForEnterGame(0, 1);
            }

            if (reason === ETrackingPoint.PatchFinish && engine.apply) {
                applyResult(result, newVersion, true);
            }

            // finished = true;
            if (showUI) {
                CS.HttpHelper.Destroy();
                csPatcher.SetFinished();
                // 切图
                trackPoint(ETrackingPoint.LoadGameScene, GAME_SCENE_NAME);
                CS.NewResourceUtil.LoadSceneAsync(GAME_SCENE_NAME, () => {
                    let newLauncher = CS_GAME_OBJECT.Find("GameCenter")?.GetComponent(puer.$typeof(CS.KFramework.KGameInstance)) as CS.KFramework.KGameInstance;
                    (newLauncher?.OnInitStepChanged as any)?.AddListener((step: number, maxStep: number) => {
                        updateUI?.updateProgressValueForEnterGame(step, maxStep);
                    });

                    // 延迟到登录界面在关闭
                    // 防止花屏延迟关闭
                    // delay(100).then(() => {
                    //     updateUI!.close();
                    //     CS.UnityEngine.GameObject.DestroyImmediate(csPatcher.gameObject);
                    //     CS.NewResourceUtil.GCNextTick();
                    // });
                });
            } else {
                csPatcher.SetFinished();
            }
        },

        onError: async (tag: string, msg: string) => {
            if (IGNORED_ERRORS.has(tag)) console.warn(`Patcher error tag: ${tag},\n${msg}`);
            else console.error(`Patcher error tag: ${tag},\n${msg}`);

            if (tag === ETrackingPoint.FetchPatchInfoFailed) {
                if (msg.indexOf("status: 115") >= 0) {
                    // 客户端版本过低
                    await engine.onNewAppNeedDownload(undefined);
                } else if (msg.indexOf("status: 416") >= 0) {
                    tag = ETrackingPoint.LimitedCountry;
                }
            } else if (tag === ETrackingPoint.ExitPatchWithDownloadDeny) {
                // 退出
                CS.UnityEngine.Application.Quit();
                return;
            }
            csPatcher.SetError(msg);

            if (updateUI) {
                let ret = await updateUI.showErrorDialog(tag, msg);
                if (ret) restart();
                else CS.UnityEngine.Application.Quit();
            } else {
                restart();
            }
        },

        onNewAppNeedDownload: async (url: string | undefined) => {
            await updateUI?.showNewAppDownloadDialog(url);
        },

        onRestartPatcher: (newScriptPath: string) => {
            // 重启后会有新脚本处理UI，这里就不需要了
            let content = CS.NewResourceUtil.ReadTextWithWebRequest(newScriptPath);
            assert(content !== null && content.length > 0, "new patcher script is empty");
            updateUI = undefined;
            CS.PatcherInfo.launchTimes = CS.PatcherInfo.launchTimes + 1;
            CS.UnityEngine.Application.remove_focusChanged(handleFocusChanged);
            console.log(`restart patcher, launchTimes: ${CS.PatcherInfo.launchTimes}`);

            // eslint-disable-next-line no-eval
            eval(`exports = {}; ${content}`);
        },

        onPatchCanDownload: async (dataSize: number) => {
            let internetReachability = UnityEngine.Application.internetReachability;
            if (internetReachability === UnityEngine.NetworkReachability.ReachableViaLocalAreaNetwork) return true;

            if (updateUI) return await updateUI.showCanDownloadDialog(dataSize);
            else return false;
        },

        onFetchRemoteText: async (url: string, fetchType?: string, requestData?: string) => {
            return new Promise<string>((resolve, reject) => {
                let params = new CS.HttpHelper.Params();
                params.url = url;
                params.onComplete = resolve;
                params.onError = (code: number, info: string) => {
                    if (code === STORAGE_ERROR_CODE) {
                        trackPoint(ETrackingPoint.StorageInsufficient, info);
                        reject(new Error(getLocalization().storage_insufficient, { cause: ETrackingPoint.StorageInsufficient }));
                    } else {
                        reject(new Error(`code: ${code}, info: ${info}`));
                    }
                };

                if (fetchType) params.fetchType = fetchType;
                if (requestData) params.data = requestData;

                console.log(`fetch remote text: ${url}`);
                CS.HttpHelper.FetchText(params);
            });
        },

        onDownloadFile: async (url: string, savePath: string, onProgressChanged?: (current: bigint, total: bigint) => void) => {
            return new Promise<void>((resolve, reject) => {
                let time = Date.now();
                let params = new CS.HttpHelper.Params();
                params.url = url;
                params.savePath = savePath;
                params.downloadMultiChunkMaxCount = getDownloadChunkMaxCount();
                // 小体积的自更新脚本直接完整 GET，兼容旧安装包的 HEAD/gzip 长度问题。
                if (savePath.replaceAll("\\", "/").endsWith("/" + PATCH_SCRIPT_FILE_NAME)) {
                    params.fetchHeader = false;
                    params.downloadMultiChunkMaxCount = 1;
                }
                params.progressUpdateIntervalMs = 1000;
                if (onProgressChanged) params.onProgressChanged = onProgressChanged;

                let hasError = false;
                params.onComplete = (_file: string) => {
                    console.log(`[HttpHelper] onComplete, time: ${(Date.now() - time) / 1000}s, hasError: ${hasError}, url: ${url}, savePath: ${savePath}`);
                    if (!hasError) resolve();
                };
                params.onError = (code: number, info: string) => {
                    hasError = true;
                    if (code === STORAGE_ERROR_CODE) {
                        trackPoint(ETrackingPoint.StorageInsufficient, info);
                        reject(new Error(getLocalization().storage_insufficient, { cause: ETrackingPoint.StorageInsufficient }));
                    } else {
                        reject(new Error(`code: ${code}, info: ${info}`));
                    }
                };
                CS.HttpHelper.DownloadFile(params);
            });
        },

        onUnzipFile: async (filePath: string, savePath: string) => {
            updateUI?.setProgressText(getLocalization().unzipping);
            await delay(1); // 等一针，让UI显示
            console.log(`Unzip file: ${filePath} to ${savePath}`);
            csPatcher.ExtractZipToDirectory(filePath, savePath);
        },

        getOSType: () => {
            const platformType = CS.UnityEngine.RuntimePlatform;
            let platform = CS.UnityEngine.Application.platform;
            switch (platform) {
                case platformType.Android:
                    return "android";
                case platformType.IPhonePlayer:
                    return "ios";
                case platformType.WindowsPlayer:
                    return "windows";
                case 51 as number: // 鸿蒙
                    return "openharmony";
                default:
                    return "android";
            }
        },

        getDistroName: () => {
            return "";
        },

        getRegion: () => {
            return "";
        },

        setPreRelease: (value: boolean) => {
            csPatcherInfo.preRelease = value || getParamFromCommandLine("pre_release") === "1";
        },

        setIsReviewMode: (value: boolean) => {
            engine.isReviewMode = value;
        },

        setPatchInfo(patchInfo: IPatchInfo) {
            // 临时补丁
            (globalThis as any).patchInfo = patchInfo;
        },

        onFetchNewPatchInfoResult: (result: IPatchInfo) => {
            if (specificVersion !== undefined) result.currentVersion = specificVersion;
        },

        setNewEntryUrl: (entryUrl: string) => {
            trackPoint(ETrackingPoint.EntryUrlChanged, `newEntryUrl: ${entryUrl}`);
            engine.entryUrl = entryUrl;
            csPatcherInfo.entryUrl = entryUrl;

            let oldEnv = csPatcherInfo.environment;
            if (!oldEnv.endsWith("preview")) {
                csPatcherInfo.environment = oldEnv + "-preview";
            }
        },
    };

    console.log(`plugin start`);
    await plugin.start(engine);

    await startPatcher(engine, localBuiltinLanguages, localDefaultLanguage);
}

function getDownloadChunkMaxCount() {
    const platformType = CS.UnityEngine.RuntimePlatform;
    switch (CS.UnityEngine.Application.platform) {
        case platformType.Android:
        case platformType.IPhonePlayer:
        case 51 as number: // 鸿蒙
            return 5;
    }
    return 10;
}

function getParamFromCommandLine(key: string): string | undefined {
    if (!CS.CommandLineUtil.HasArg(key)) return;

    let ret = CS.CommandLineUtil.GetArg(key);
    console.log(`getParamFromCommandLine: key: ${key}, value: ${ret}`);
    return ret;
}

function verifySpecificVersion(downloadPath: string) {
    if (!CS.KPlayerPrefs.HasKey(SPECIFIC_VERSION_LOCAL_KEY)) return;

    let version: number | undefined = CS.KPlayerPrefs.GetInt(SPECIFIC_VERSION_LOCAL_KEY, 0);
    if (version <= 0) {
        CS.KPlayerPrefs.DeleteKey(SPECIFIC_VERSION_LOCAL_KEY);
        version = undefined;
    }

    // 清空所有缓存
    if (fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath);
    }

    return version;
}

function verifySavedResolution() {
    // if (!CS.KPlayerPrefs.HasKey("savedResolutionWidth") || !CS.KPlayerPrefs.HasKey("savedResolutionHeight")) return;
    // let width = CS.KPlayerPrefs.GetInt("savedResolutionWidth", 1080);
    // let height = CS.KPlayerPrefs.GetInt("savedResolutionHeight", 2160);
    // console.info(`[PATCHER] set resolution to ${width}x${height}`);
    // CS.UnityEngine.Screen.SetResolution(width, height, CS.UnityEngine.Screen.fullScreen);
}

async function repairPatch(downloadPath: string, applyPath: string, localResVersion: number): Promise<boolean> {
    trackPoint(ETrackingPoint.RepairPatchStart);

    try {
        if (fs.existsSync(downloadPath)) {
            await fs.rmAsync(downloadPath);
            console.log(`[RepairPatch] Removed download cache: ${downloadPath}`);
        }

        if (fs.existsSync(applyPath)) {
            await fs.rmAsync(applyPath);
            console.log(`[RepairPatch] Removed apply cache: ${applyPath}`);
        }
    } catch (e) {
        trackPoint(ETrackingPoint.RepairPatchFailed, `Failed to remove cache directories, error: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }

    trackPoint(ETrackingPoint.RepairPatchComplete, `Removed local hot-update files, restart to re-download from version ${localResVersion}`);
    return true;
}

async function restart() {
    await delay(1000);

    trackPoint(ETrackingPoint.PatcherRestart, `restartTimes: ${CS.PatcherInfo.launchTimes + 1}`);
    let csPatcher = CS.Patcher.FindPatcher();
    let patcherRoot = csPatcher.gameObject;
    if (patcherRoot) CS.UnityEngine.GameObject.Destroy(patcherRoot);

    CS.UnityEngine.Application.remove_focusChanged(handleFocusChanged);
    CS.GameRestartHelper.Restart("NewLauncher");
    // await start();
}

async function start() {
    work()
        .catch((e) => {
            console.error(`message: ${e.message}, stack: ${e.stack}`);
            let csPatcher = CS.Patcher.FindPatcher();
            csPatcher.SetEvalScriptFailed(String(e), false);

            // if (csPatcher.evalOriginalPatcher === true) {
            // 已经在执行原始脚本了，还出错的话说明有严重问题，这会只能提示重下新包了
            if (updateUI) {
                updateUI.showErrorDialog(ETrackingPoint.FatalError, String(e)).then((ret) => { if (ret) restart(); else CS.UnityEngine.Application.Quit(); });
            } else {
                restart();
            }
            // }
        })
        .finally(() => {
            CS.UnityEngine.Application.remove_focusChanged(handleFocusChanged);

            let newLauncher = CS_GAME_OBJECT.Find("GameCenter")?.GetComponent(puer.$typeof(CS.KFramework.KGameInstance)) as CS.KFramework.KGameInstance;
            newLauncher?.OnInitStepChanged?.RemoveAllListeners();
            console.log(`remove OnInitStepChanged listeners and patcher work complete`);
        });
}

start();
