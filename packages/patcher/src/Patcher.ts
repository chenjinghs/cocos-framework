// import * as http2 from "http2";

/* eslint-disable complexity */
import { ENTRY_PATCH_URL, ETrackingPoint, FILE_LIST_FILE_NAME, IEngine, IPatchApplyResult, MANIFEST_FILE_NAME, PATCH_SCRIPT_FILE_NAME } from "./Define";
import { DEFAULT_GAME_LANGUAGE, EGameLanguage, findGameLanguage, HiddenLanguages } from "./LanguageDefine";
import { IFileInfo, IManifestInfo, IPatchInfo, getBestPatchFileInfo, resolveTargetLanguage } from "patch-common";
// import * as https from "https";
import { assert, calculateFileSha256, delay, fs, getSystemLanguage, keyValueStorage, path, trackPoint } from "./Util";

const LANGUAGE_MATCHER_TEMPLATES = ["^packages/<lang>/", "^packages/deflate_config_<lang>\\.zip$"];

type TOrganizeStatus = "success" | "missing-source" | "failed";

interface IOrganizeDownloadFolderResult {
    status: TOrganizeStatus;
    applyResult?: IPatchApplyResult;
    info?: string;
}

export async function startPatcher(engine: IEngine, localBuiltinLanguages: string[] = [], localDefaultLanguage?: EGameLanguage) {
    try {
        return await startImp(engine, localBuiltinLanguages, localDefaultLanguage);
    } catch (err: any) {
        let info = `error: ${err.message}, stack: ${err.stack}`;
        trackPoint(engine, ETrackingPoint.UnknownError, info);
        await engine.onError(ETrackingPoint.UnknownError, info);
        throw err;
    }
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// 主流程就这一个函数
async function startImp(engine: IEngine, localBuiltinLanguages: string[], localDefaultLanguage?: EGameLanguage) {
    console.log(`patcher start ...`);
    trackPoint(engine, ETrackingPoint.PatchStart);

    // 读本地manifest
    let manifestInfo: IManifestInfo | undefined;
    let manifestPath = path.join(engine.applyPath, MANIFEST_FILE_NAME);
    // 上次 updateManifestFile 中途崩溃时，尝试从 .tmp 或 .bak 恢复
    let tmpPath = `${manifestPath}.tmp`;
    let bakPath = `${manifestPath}.bak`;
    if (!fs.existsSync(manifestPath)) {
        let recoverySource = fs.existsSync(tmpPath) ? tmpPath : fs.existsSync(bakPath) ? bakPath : undefined;
        if (recoverySource) {
            try {
                fs.replaceFileSync(recoverySource, manifestPath);
                console.log(`manifest recovered from ${path.basename(recoverySource)}`);
            } catch {
                // 恢复失败，后续会走 createBaseManifest 重建基线
            }
        }
    }
    if (fs.existsSync(manifestPath)) {
        try {
            let parsedManifest = JSON.parse(fs.readFileTextSync(manifestPath)) as IManifestInfo | undefined;
            assert(parsedManifest !== undefined && Number.isFinite(parsedManifest.currentVersion) && isFileInfoArray(parsedManifest.files), "local manifest format invalid");
            manifestInfo = parsedManifest;
        } catch {
            // 如果本地manifest有错误，则重新更新
            trackPoint(engine, ETrackingPoint.LocalManifestReadFailed, `path: ${manifestPath}`);
        }
    }

    let localAppVersion = engine.localResVersion; // app内版本号
    console.log(`local app version: ${localAppVersion}, local manifest version: ${manifestInfo?.currentVersion}`);

    if (manifestInfo !== undefined) {
        ensureLanguageVersions(manifestInfo);
    }

    let manifestReset = false;
    if (manifestInfo === undefined || localAppVersion > manifestInfo.currentVersion) {
        console.log(`local manifest is undefined or local app version > current version, localAppVersion: ${localAppVersion}, currentVersion: ${manifestInfo?.currentVersion}`);

        // 先缓存下patcher信息
        let previousManifest = manifestInfo;
        let currentPatcherScriptInfo = manifestInfo?.files.find((v) => v.path === PATCH_SCRIPT_FILE_NAME);
        manifestInfo = createBaseManifest(localAppVersion, previousManifest, localBuiltinLanguages);

        let retainedRelativePaths = new Set(manifestInfo.files.map((info) => normalizePatchPath(info.path)));
        if (currentPatcherScriptInfo && currentPatcherScriptInfo.version > localAppVersion) {
            // 如果patcher脚本的版本号大于app内版本号，那么保留patcher脚本
            manifestInfo.files.push(currentPatcherScriptInfo);
            retainedRelativePaths.add(PATCH_SCRIPT_FILE_NAME);
        }

        // 删除本地缓存
        if (fs.existsSync(engine.applyPath)) {
            trackPoint(engine, ETrackingPoint.RemoveOldData);
            let toBeDeleted = fs.getAllFilesInDirectory(engine.applyPath).filter((file) => {
                let relativePath = getApplyRelativePath(engine, file);
                if (relativePath === MANIFEST_FILE_NAME) return false;
                return !retainedRelativePaths.has(relativePath);
            });
            for (let file of toBeDeleted) {
                console.log(`remove old file: ${file}`);
                await fs.rmAsync(file);
            }
        }
        manifestReset = true;
    }

    // 转成map
    let fileToInfo = new Map<string, IFileInfo>();
    manifestInfo.files.forEach((info) => {
        fileToInfo.set(info.path, info);
    });
    if (manifestReset) {
        if (!updateManifestFile(engine, manifestInfo, fileToInfo, "reset_base_manifest")) {
            await engine.onError(ETrackingPoint.UpdateManifestFile, "reason: reset_base_manifest");
            return;
        }
    }

    let currentVersion = manifestInfo.currentVersion; // 当前patch版本号
    let entryUrl = engine.entryUrl;
    trackPoint(
        engine,
        ETrackingPoint.ReadManifest,
        `localAppVersion: ${localAppVersion}, currentVersion: ${currentVersion}, patcher version: ${fileToInfo.get(PATCH_SCRIPT_FILE_NAME)?.version ?? engine.localResVersion}, entryUrl: ${entryUrl}`,
    );

    if (engine.apply) {
        // 旧脚本可能先写入 redirect，随后才发现下载文件损坏。恢复时不能直接安装它。
        const pendingPatcher = fileToInfo.get(PATCH_SCRIPT_FILE_NAME);
        if (pendingPatcher?.redirect !== undefined && !isPendingPatcherValid(engine, pendingPatcher)) {
            fileToInfo.delete(PATCH_SCRIPT_FILE_NAME);
            if (!updateManifestFile(engine, manifestInfo, fileToInfo, "discard_invalid_pending_patcher")) {
                await engine.onError(ETrackingPoint.UpdateManifestFile, "reason: discard_invalid_pending_patcher");
                return;
            }
            // 不删除正式脚本；撤销待安装记录后，后面的自更新流程会重新下载。
            trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, "invalid pending patcher discarded; retry script update");
        }
        let recoveringMissingSource = false;
        // 先查一把patcher.js，如果有重定向路径，那么就重启patcher
        let newPatcherScript = fileToInfo.get(PATCH_SCRIPT_FILE_NAME);
        let needRestartPatcher = newPatcherScript !== undefined && newPatcherScript.redirect !== undefined;

        // 刚启动patcher时，啥都没加载，所以这里可以将之前没整理的资源整理好
        let organizeResult = await organizeDownloadFolder(engine, manifestInfo, fileToInfo, ETrackingPoint.ApplyCurrentManifest, `needRestartPatcher: ${needRestartPatcher}`);
        if (organizeResult.status === "missing-source") {
            // manifest 仍指向已丢失的下载文件时，不能继续 apply 失效路径，否则资源加载阶段会永久卡死。
            // 磁盘上的 manifest 保持不变，以便下次仍由当前热更 patcher 接管；本次仅在内存回退到包内资源并重新走更新。
            manifestInfo = createMissingSourceRecoveryManifest(engine, localAppVersion, localBuiltinLanguages, manifestInfo);
            fileToInfo = createFileInfoMap(manifestInfo);
            currentVersion = localAppVersion;
            recoveringMissingSource = true;
            needRestartPatcher = false;
            trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, `recover with builtin resources, ${organizeResult.info ?? ""}`);
            engine.onApplyCurrentManifest(getPatchApplyResult(engine, manifestInfo), currentVersion);
        } else if (organizeResult.status === "failed") {
            await engine.onError(ETrackingPoint.OrganizeDownloadFolderFailed, organizeResult.info ?? ETrackingPoint.ApplyCurrentManifest);
            return;
        } else {
            // patcher之前没有apply过，这里apply完重启patcher
            if (needRestartPatcher) {
                let patcherPath = path.join(engine.applyPath, PATCH_SCRIPT_FILE_NAME);
                trackPoint(engine, ETrackingPoint.RestartPatcherWhenApply, `version: ${newPatcherScript?.version}, path: ${patcherPath}`);
                engine.onRestartPatcher(patcherPath);
                return;
            }
            engine.onApplyCurrentManifest(organizeResult.applyResult, currentVersion);
        }

        if (!recoveringMissingSource) {
            keepPatcherUpdateRetryable(engine, manifestInfo, fileToInfo, localAppVersion);
        }
    }

    // 检查网络状态，如果是没联网则退出
    if (!(await engine.onCheckNetwork())) {
        trackPoint(engine, ETrackingPoint.CheckNetworkFailed);
        return;
    }

    // 检查是否需要更新
    let fetchPatchInfo = async (entryUrl: string): Promise<IPatchInfo | undefined> => {
        let fetchResult: string | undefined;

        // 拉取patch-info
        if (engine.localCheckMode) {
            // 本地模式下，entryUrl就是patch-info的下载地址，直接下
            fetchResult = await fetchRemoteData(engine, entryUrl, {
                start: ETrackingPoint.FetchPatchInfo,
                succeed: ETrackingPoint.FetchPatchInfoSucceed,
                failed: ETrackingPoint.FetchPatchInfoFailed,
                retry: ETrackingPoint.FetchPatchInfoRetry,
            });
        } else {
            // server模式下，entryUrl + ENTRY_PATCH_URL 是服务器请求地址
            let lastAccountId = keyValueStorage.getString("global.LastAccountId", "");
            console.log(`lastAccountId: ${lastAccountId}`);
            fetchResult = await fetchRemoteData(
                engine,
                entryUrl + ENTRY_PATCH_URL,
                {
                    start: ETrackingPoint.FetchPatchInfo,
                    succeed: ETrackingPoint.FetchPatchInfoSucceed,
                    failed: ETrackingPoint.FetchPatchInfoFailed,
                    retry: ETrackingPoint.FetchPatchInfoRetry,
                },
                undefined,
                false,
                "POST",
                // 发给服务器的是分支版本号，用于区别提审分支还是正式分支
                JSON.stringify({ version: engine.branchVersion, os: engine.getOSType(), account_id: lastAccountId }),
            );
        }

        // 拉取失败
        if (fetchResult === undefined) {
            return;
        }

        try {
            let newPatchInfo: IPatchInfo | undefined;
            if (engine.localCheckMode) {
                newPatchInfo = JSON.parse(fetchResult) as IPatchInfo;
            } else {
                let content = JSON.parse(fetchResult) as { data: IPatchInfo; status: number };
                if (content.status !== 0) {
                    let info = `server error, status: ${content.status}`;
                    trackPoint(engine, ETrackingPoint.FetchPatchInfoFailed, info);
                    await engine.onError(ETrackingPoint.FetchPatchInfoFailed, info);

                    return;
                }

                newPatchInfo = content.data;
                engine.setPreRelease(!!newPatchInfo.pre_release);
            }
            trackPoint(engine, ETrackingPoint.RemotePatchInfo, fetchResult);
            engine.onFetchNewPatchInfoResult(newPatchInfo);
            return newPatchInfo;
        } catch (err: any) {
            let info = `parse fetch result failed: ${fetchResult},\n error: ${err.message}`;
            trackPoint(engine, ETrackingPoint.ParseRemotePatchInfoFailed, info);
            await engine.onError(ETrackingPoint.ParseRemotePatchInfoFailed, info);
            return;
        }
    };

    let newPatchInfo = await fetchPatchInfo(entryUrl);
    if (newPatchInfo === undefined) {
        return;
    }

    let newEntryUrl = newPatchInfo.entry_url;
    if (newEntryUrl && newEntryUrl !== entryUrl && newEntryUrl !== "") {
        // entry发生改变，重新拉patch info
        entryUrl = newEntryUrl;
        engine.setNewEntryUrl(entryUrl);

        newPatchInfo = await fetchPatchInfo(entryUrl);
        if (newPatchInfo === undefined) {
            return;
        }
    }

    engine.setPatchInfo(newPatchInfo);

    if (newPatchInfo.versionInfos !== null && newPatchInfo.versionInfos !== undefined && !Array.isArray(newPatchInfo.versionInfos)) {
        let info = "remote patch info versionInfos format invalid";
        trackPoint(engine, ETrackingPoint.ParseRemotePatchInfoFailed, info);
        await engine.onError(ETrackingPoint.ParseRemotePatchInfoFailed, info);
        return;
    }
    let distro = engine.getDistroName();
    let versionInfo = newPatchInfo.versionInfos?.find((info) => {
        // version/distro 类型支持标量或数组(IVersionInfo)，统一按数组处理，
        // 避免运营用数组形态(多版本/多渠道)配置时 标量 !== 恒不命中而静默失效。
        let versions = Array.isArray(info.version) ? info.version : [info.version];
        if (!versions.includes(localAppVersion)) return false;
        let distros = !info.distro ? [] : Array.isArray(info.distro) ? info.distro : [info.distro];
        if (distros.length > 0 && !distros.includes(distro)) return false;
        return true;
    });
    console.log(`appVersion: ${localAppVersion}, distro: ${distro}, found version info: ${versionInfo ? JSON.stringify(versionInfo) : "Not found"}`);

    // 检查是否需要更新app
    if (localAppVersion < newPatchInfo.oldestVersion) {
        trackPoint(engine, ETrackingPoint.NeedUpdateApp, `newAppDownloadUrl: ${newPatchInfo.newAppDownloadUrl}`);
        await engine.onNewAppNeedDownload(newPatchInfo.newAppDownloadUrl);
        return;
    }

    if (versionInfo?.isReviewMode) {
        engine.setIsReviewMode(true);
        if (versionInfo.forcePatchInReview !== true) {
            // 仅检查更新时，保留游戏正在使用的资源，不能清理或切换补丁。
            if (!engine.apply) {
                engine.onComplete(undefined, ETrackingPoint.ExitPatchWithoutApply, currentVersion);
                return;
            }

            // 审核模式使用包内资源。先解除旧补丁挂载并卸载缓存，再删除文件，
            // 避免同版本覆盖安装后，本次启动仍从已删除的热更脚本包加载入口。
            engine.onResetToBuiltinResources();
            let organizeResult = await organizeDownloadFolder(engine, undefined, fileToInfo, ETrackingPoint.NoUpdate);
            if (organizeResult.status !== "success") {
                await engine.onError(ETrackingPoint.OrganizeDownloadFolderFailed, organizeResult.info ?? ETrackingPoint.NoUpdate);
                return;
            }
            engine.onComplete(organizeResult.applyResult, ETrackingPoint.NoUpdate, localAppVersion);
            return;
        }
    }

    let newVersion = newPatchInfo.currentVersion;
    // 确认路径
    let downloadPath = path.join(engine.downloadPath, String(newVersion)).replaceAll("\\", "/");
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath);
    }
    if (!fs.existsSync(engine.applyPath)) {
        fs.mkdirSync(engine.applyPath);
    }
    trackPoint(engine, ETrackingPoint.EnsureDownloadPathAndApplyPath, `downloadPath: ${engine.downloadPath}, applyPath: ${engine.applyPath}`);

    // 检查是否需要更新patcher.js
    if (newPatchInfo.patchScript) {
        let currentPatcherJsInfo = fileToInfo.get(PATCH_SCRIPT_FILE_NAME);
        let currentPatchVersion = currentPatcherJsInfo?.version ?? localAppVersion;
        console.log(`currentPatchVersion ${currentPatchVersion}, newPatchScriptVersion: ${newPatchInfo.patchScript.version} `);

        if (currentPatchVersion < newPatchInfo.patchScript.version) {
            let installedPatcherInfo: IFileInfo = {
                path: PATCH_SCRIPT_FILE_NAME,
                version: newPatchInfo.patchScript.version,
                sha256: newPatchInfo.patchScript.sha256,
                size: newPatchInfo.patchScript.size,
            };
            if (isAppliedFileValid(engine, installedPatcherInfo)) {
                // patcher 安装事务会故意从磁盘 manifest 中省略该项，确保资源版本提交前被杀仍可重试。
                // 新 patcher 重启后若物理文件校验通过，直接复用，避免再次下载和重启形成循环。
                currentPatcherJsInfo = installedPatcherInfo;
                currentPatchVersion = installedPatcherInfo.version;
                fileToInfo.set(PATCH_SCRIPT_FILE_NAME, installedPatcherInfo);
                trackPoint(engine, ETrackingPoint.PatchScriptExistsLocally, `path: ${path.join(engine.applyPath, PATCH_SCRIPT_FILE_NAME)}, version: ${installedPatcherInfo.version}`);
            }
        }

        if (currentPatchVersion < newPatchInfo.patchScript.version) {
            let previousPatcherJsInfo = currentPatcherJsInfo;
            // 下载patcher.js
            // 这里写了两步，第一步是写到download目录下，第二步是写到apply目录下，这样做的目的是为了防止直接写到apply目录下失败，导致原有的patcher.js坏了无法更新
            let patchScriptSavePath = path.join(downloadPath, PATCH_SCRIPT_FILE_NAME);
            let result = await fetchRemoteData(
                engine,
                newPatchInfo.patchScript.path,
                {
                    start: ETrackingPoint.FetchPatchScript,
                    succeed: ETrackingPoint.FetchPatchScriptSucceed,
                    failed: ETrackingPoint.FetchPatchScriptFailed,
                    existsLocally: ETrackingPoint.PatchScriptExistsLocally,
                    retry: ETrackingPoint.FetchPatchScriptRetry,
                },
                {
                    savePath: patchScriptSavePath,
                    sha256: newPatchInfo.patchScript.sha256,
                    size: newPatchInfo.patchScript.size,
                },
            );
            if (result === undefined) {
                return;
            }

            // 更新manifest
            currentPatcherJsInfo = {
                path: PATCH_SCRIPT_FILE_NAME,
                version: newPatchInfo.patchScript.version,
                sha256: newPatchInfo.patchScript.sha256,
                size: newPatchInfo.patchScript.size,
                redirect: patchScriptSavePath,
            };
            fileToInfo.set(PATCH_SCRIPT_FILE_NAME, currentPatcherJsInfo);
            if (!updateManifestFile(engine, manifestInfo, fileToInfo, ETrackingPoint.PatchScriptWriteSucceed)) {
                restoreFileInfo(fileToInfo, PATCH_SCRIPT_FILE_NAME, previousPatcherJsInfo);
                await engine.onError(ETrackingPoint.UpdateManifestFile, `reason: ${ETrackingPoint.PatchScriptWriteSucceed}`);
                return;
            }

            // 将新的patcher.js挪到apply目录下
            let applyPatcherPath = path.join(engine.applyPath, PATCH_SCRIPT_FILE_NAME);
            let tempPatcherPath = `${applyPatcherPath}.patching`;
            try {
                if (fs.existsSync(tempPatcherPath)) {
                    await fs.rmAsync(tempPatcherPath);
                }
                fs.copyFileSync(patchScriptSavePath, tempPatcherPath);
                if (calculateFileSha256(tempPatcherPath) !== currentPatcherJsInfo.sha256) {
                    throw new Error(`staged patcher hash mismatch: ${tempPatcherPath}`);
                }
                fs.replaceFileSync(tempPatcherPath, applyPatcherPath);
            } catch (error: unknown) {
                let info = `path: ${applyPatcherPath}, error: ${getErrorMessage(error)}`;
                trackPoint(engine, ETrackingPoint.MoveScriptToApplyPath, info);
                if (fs.existsSync(tempPatcherPath)) {
                    try {
                        await fs.rmAsync(tempPatcherPath);
                    } catch (cleanupError: unknown) {
                        trackPoint(engine, ETrackingPoint.MoveScriptToApplyPath, `cleanup failed, path: ${tempPatcherPath}, error: ${getErrorMessage(cleanupError)}`);
                    }
                }
                await engine.onError(ETrackingPoint.MoveScriptToApplyPath, info);
                return;
            }
            currentPatcherJsInfo.redirect = undefined; // 重定向路径置空
            trackPoint(engine, ETrackingPoint.MoveScriptToApplyPath, `path: ${applyPatcherPath}`);

            // 再次更新manifest
            let manifestWriteSucceed =
                manifestInfo.currentVersion === localAppVersion
                    ? writePatcherRetryManifest(engine, manifestInfo, localAppVersion)
                    : updateManifestFile(engine, manifestInfo, fileToInfo, ETrackingPoint.MoveScriptToApplyPath);
            if (!manifestWriteSucceed) {
                currentPatcherJsInfo.redirect = patchScriptSavePath;
                await engine.onError(ETrackingPoint.UpdateManifestFile, `reason: ${ETrackingPoint.MoveScriptToApplyPath}`);
                return;
            }
            try {
                await fs.rmAsync(patchScriptSavePath);
            } catch (error: unknown) {
                trackPoint(engine, ETrackingPoint.MoveScriptToApplyPath, `cleanup failed, path: ${patchScriptSavePath}, error: ${getErrorMessage(error)}`);
            }

            trackPoint(engine, ETrackingPoint.RestartPatcher, `path: ${applyPatcherPath}, version: ${currentPatcherJsInfo.version}`);
            engine.onRestartPatcher(applyPatcherPath);
            return;
        }
    }
    trackPoint(engine, ETrackingPoint.NoPatchScriptUpdate);

    let builtinLanguageSet = new Set(localBuiltinLanguages);
    let patchLanguages = Object.keys(newPatchInfo.channels?.languages ?? {});
    let availableLanguages = Array.from(new Set([...patchLanguages, ...builtinLanguageSet]));
    let builtinLanguageVersionUpdated = await resetBuiltinLanguageBaseline(engine, manifestInfo, fileToInfo, builtinLanguageSet, localAppVersion);
    if (builtinLanguageVersionUpdated) {
        if (!updateManifestFile(engine, manifestInfo, fileToInfo, "reset_builtin_language_baseline")) {
            await engine.onError(ETrackingPoint.UpdateManifestFile, "reason: reset_builtin_language_baseline");
            return;
        }
    }
    let currentLanguage = getCurrentGameLanguage(engine.getRegion());
    // 老包玩家的 patcher-settings.json 不进热更包，localDefaultLanguage 恒为 undefined；
    // 这里用编译期烘焙的 DEFAULT_GAME_LANGUAGE(=配置 defaultLanguage) 兜底，避免 ZH_CN(项目/common 语言)
    // 被 resolveTargetLanguage 误回退到 availableLanguages[0](EN_US) 而白下一份用不到的语言渠道。
    let targetLanguage = resolveTargetLanguage(currentLanguage, localBuiltinLanguages as EGameLanguage[], availableLanguages as EGameLanguage[], localDefaultLanguage ?? DEFAULT_GAME_LANGUAGE);
    let commonPatches = newPatchInfo.channels?.common.patches;
    let currentCommonVersion = manifestInfo.currentVersion;
    let needCommonUpdate = currentCommonVersion < newVersion;
    // oldestVersion === currentVersion 时生成器不会生成 common patch；只有实际需要更新 common 渠道时才要求列表非空。
    if (!isFileInfoArray(commonPatches) || (needCommonUpdate && commonPatches.length <= 0)) {
        let info = "remote patch info common channel patches format invalid";
        trackPoint(engine, ETrackingPoint.ParseRemotePatchInfoFailed, info);
        await engine.onError(ETrackingPoint.ParseRemotePatchInfoFailed, info);
        return;
    }
    let hasLanguageChannel = patchLanguages.includes(targetLanguage);
    let hasCurrentLanguageVersion = hasLanguageChannel ? hasLanguageVersion(manifestInfo, targetLanguage) : false;
    let currentLanguageVersion = hasLanguageChannel ? getLanguageVersion(manifestInfo, targetLanguage, localAppVersion) : undefined;
    let needLanguageUpdate = hasLanguageChannel && (!hasCurrentLanguageVersion || (currentLanguageVersion ?? localAppVersion) < newVersion);
    console.log(
        `patch channels info: builtinLanguages=${localBuiltinLanguages}, currentLanguage=${currentLanguage}, targetLanguage=${targetLanguage}, commonVersion=${currentCommonVersion}, languageVersion=${currentLanguageVersion}, hasCurrentLanguageVersion=${hasCurrentLanguageVersion}, needCommonUpdate=${needCommonUpdate}, needLanguageUpdate=${needLanguageUpdate}`,
    );
    if (!needCommonUpdate && !needLanguageUpdate) {
        let needWriteNoUpdateManifest = manifestInfo.currentVersion < newVersion || builtinLanguageVersionUpdated;
        if (manifestInfo.currentVersion < newVersion) {
            manifestInfo.currentVersion = newVersion;
        }
        if (needWriteNoUpdateManifest) {
            if (!updateManifestFile(engine, manifestInfo, fileToInfo, ETrackingPoint.NoUpdate)) {
                await engine.onError(ETrackingPoint.UpdateManifestFile, `reason: ${ETrackingPoint.NoUpdate}`);
                return;
            }
        }
        let organizeResult = await organizeDownloadFolder(engine, manifestInfo, fileToInfo, ETrackingPoint.NoUpdate, `targetLanguage: ${targetLanguage}`);
        if (organizeResult.status !== "success") {
            await engine.onError(ETrackingPoint.OrganizeDownloadFolderFailed, organizeResult.info ?? ETrackingPoint.NoUpdate);
            return;
        }
        engine.onComplete(organizeResult.applyResult, ETrackingPoint.NoUpdate, manifestInfo.currentVersion);
        return;
    }

    // 如果不应用，那么到这里就结束了
    if (!engine.apply) {
        trackPoint(engine, ETrackingPoint.ExitPatchWithoutApply);
        engine.onComplete(getPatchApplyResult(engine, manifestInfo), ETrackingPoint.ExitPatchWithoutApply, currentVersion);
        return;
    }

    if (needCommonUpdate) {
        let commonUpdateSucceed = await updateChannel(
            engine,
            manifestInfo,
            fileToInfo,
            "common",
            commonPatches,
            currentCommonVersion,
            newVersion,
            path.join(downloadPath, "common").replaceAll("\\", "/"),
        );
        if (!commonUpdateSucceed) return;
    }

    if (needLanguageUpdate) {
        let languagePatches = newPatchInfo.channels?.languages?.[targetLanguage]?.patches;
        if (!isFileInfoArray(languagePatches) || languagePatches.length <= 0) {
            let info = `remote patch info language patches format invalid, language: ${targetLanguage}`;
            trackPoint(engine, ETrackingPoint.ParseRemotePatchInfoFailed, info);
            await engine.onError(ETrackingPoint.ParseRemotePatchInfoFailed, info);
            return;
        }
        let languageUpdateSucceed = await updateChannel(
            engine,
            manifestInfo,
            fileToInfo,
            targetLanguage,
            languagePatches,
            currentLanguageVersion ?? localAppVersion,
            newVersion,
            path.join(downloadPath, "lang", targetLanguage).replaceAll("\\", "/"),
            !hasCurrentLanguageVersion,
        );
        if (!languageUpdateSucceed) {
            // 语言渠道下载失败：不允许降级使用本地旧版语言资源（会导致 common 新版 + 语言旧版的版本错配）。
            // 直接返回失败，下次启动重新下载。common 渠道已落盘(currentVersion 已抬到 newVersion)，
            // 下次启动只需重试语言渠道下载，不会重复下载 common。
            // currentVersion 已在 common 更新时抬到 newVersion，无需额外同步。
            trackPoint(
                engine,
                ETrackingPoint.LanguageUpdateFailedUseLocal,
                `targetLanguage: ${targetLanguage}, commonVersion: ${manifestInfo.currentVersion}, languageVersion: ${currentLanguageVersion}`,
            );
            return;
        }
    }

    manifestInfo.currentVersion = newVersion;
    if (!updateManifestFile(engine, manifestInfo, fileToInfo, ETrackingPoint.PatchFinish)) {
        await engine.onError(ETrackingPoint.UpdateManifestFile, `reason: ${ETrackingPoint.PatchFinish}`);
        return;
    }
    trackPoint(engine, ETrackingPoint.PatchFinish, `targetLanguage: ${targetLanguage}`);
    engine.onComplete(getPatchApplyResult(engine, manifestInfo), ETrackingPoint.PatchFinish, newVersion);
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// 辅助函数

function normalizePatchPath(filePath: string) {
    return filePath.replaceAll("\\", "/");
}

function createFileInfoMap(manifestInfo: IManifestInfo) {
    let fileToInfo = new Map<string, IFileInfo>();
    manifestInfo.files.forEach((info) => {
        fileToInfo.set(info.path, info);
    });
    return fileToInfo;
}

function restoreFileInfo(fileToInfo: Map<string, IFileInfo>, filePath: string, previousInfo: IFileInfo | undefined) {
    if (previousInfo === undefined) {
        fileToInfo.delete(filePath);
    } else {
        fileToInfo.set(filePath, previousInfo);
    }
}

function isAppliedFileValid(engine: IEngine, info: IFileInfo) {
    let applyFilePath = path.join(engine.applyPath, info.path);
    if (!fs.existsSync(applyFilePath)) return false;
    try {
        return calculateFileSha256(applyFilePath) === info.sha256;
    } catch {
        return false;
    }
}

function createMissingSourceRecoveryManifest(engine: IEngine, localAppVersion: number, localBuiltinLanguages: string[], previousManifest: IManifestInfo) {
    let recoveryManifest = createBaseManifest(localAppVersion, undefined, localBuiltinLanguages);
    let patcherInfo = previousManifest.files.find((info) => info.path === PATCH_SCRIPT_FILE_NAME);
    if (patcherInfo !== undefined && patcherInfo.version > localAppVersion && isAppliedFileValid(engine, patcherInfo)) {
        let retainedPatcherInfo = { ...patcherInfo };
        delete retainedPatcherInfo.redirect;
        recoveryManifest.files.push(retainedPatcherInfo);
    }
    return recoveryManifest;
}

function keepPatcherUpdateRetryable(engine: IEngine, manifestInfo: IManifestInfo, fileToInfo: Map<string, IFileInfo>, localAppVersion: number) {
    if (!shouldOmitInstalledPatcher(engine, manifestInfo, fileToInfo, localAppVersion)) return;

    // C# 在 currentVersion === appVersion 时会改用包内旧 patcher。资源事务提交前如果进程退出，
    // 磁盘 manifest 不记录新 patcher，下一次旧 patcher 就会重新下载它；当前进程继续使用内存中的新信息。
    writePatcherRetryManifest(engine, manifestInfo, localAppVersion);
}

function shouldOmitInstalledPatcher(engine: IEngine, manifestInfo: IManifestInfo, fileToInfo: Map<string, IFileInfo>, localAppVersion: number) {
    if (manifestInfo.currentVersion !== localAppVersion) return false;
    let patcherInfo = fileToInfo.get(PATCH_SCRIPT_FILE_NAME);
    if (patcherInfo === undefined || patcherInfo.version <= localAppVersion || patcherInfo.redirect !== undefined) return false;
    if (Array.from(fileToInfo.values()).some((info) => info.path !== PATCH_SCRIPT_FILE_NAME && info.version > localAppVersion)) return false;
    if (Object.values(manifestInfo.languageVersions ?? {}).some((version) => version !== undefined && version > localAppVersion)) return false;
    return isAppliedFileValid(engine, patcherInfo);
}

function writePatcherRetryManifest(engine: IEngine, manifestInfo: IManifestInfo, localAppVersion: number) {
    let retryManifest: IManifestInfo = {
        ...manifestInfo,
        files: manifestInfo.files.filter((info) => info.path !== PATCH_SCRIPT_FILE_NAME).map((info) => ({ ...info })),
    };
    let retryFileToInfo = createFileInfoMap(retryManifest);
    return updateManifestFile(engine, retryManifest, retryFileToInfo, `keep_patcher_update_retryable_${localAppVersion}`);
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function isFileInfoArray(value: unknown): value is IFileInfo[] {
    if (!Array.isArray(value)) return false;
    return value.every((item: unknown) => {
        if (typeof item !== "object" || item === null) return false;
        let info = item as Partial<IFileInfo>;
        return typeof info.path === "string" && Number.isFinite(info.version) && typeof info.sha256 === "string" && Number.isFinite(info.size);
    });
}

function getApplyRelativePath(engine: IEngine, filePath: string) {
    let applyPath = normalizePatchPath(engine.applyPath);
    let normalizedPath = normalizePatchPath(filePath);
    if (normalizedPath.startsWith(applyPath + "/")) {
        return normalizedPath.substring(applyPath.length + 1);
    }
    return normalizedPath;
}

function escapeRegExpForLanguage(input: string) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLanguageMatchPath(filePath: string) {
    let normalized = normalizePatchPath(filePath);
    if (normalized.endsWith(".meta")) {
        normalized = normalized.substring(0, normalized.length - ".meta".length);
    }
    if (normalized.endsWith(".manifest")) {
        normalized = normalized.substring(0, normalized.length - ".manifest".length);
    }
    return normalized;
}

function getFileLanguage(filePath: string, languages: string[]) {
    let normalizedPath = normalizeLanguageMatchPath(filePath);
    for (let language of languages) {
        for (let matcherTemplate of LANGUAGE_MATCHER_TEMPLATES) {
            let matcher = new RegExp(matcherTemplate.replaceAll("<lang>", escapeRegExpForLanguage(language)), "i");
            if (matcher.test(normalizedPath)) return language;
        }
    }
    return undefined;
}

function getPossibleLanguageChannels() {
    return Object.values(EGameLanguage).filter((language) => language !== DEFAULT_GAME_LANGUAGE && !HiddenLanguages.has(language));
}

function inferLanguageVersionsFromFiles(manifestInfo: IManifestInfo | undefined, languageNames: string[]) {
    let versions = { ...(manifestInfo?.languageVersions ?? {}) } as Partial<Record<EGameLanguage, number>>;
    for (let info of manifestInfo?.files ?? []) {
        let language = getFileLanguage(info.path, languageNames);
        if (language === undefined || info.version <= 0) continue;
        versions[language as EGameLanguage] = Math.max(versions[language as EGameLanguage] ?? 0, info.version);
    }
    return versions;
}

function createBaseManifest(localAppVersion: number, previousManifest?: IManifestInfo, builtinLanguages?: string[]): IManifestInfo {
    let languageNames = Array.from(new Set([...Object.keys(previousManifest?.languageVersions ?? {}), ...getPossibleLanguageChannels()]));
    let languages = inferLanguageVersionsFromFiles(previousManifest, languageNames);
    let builtinSet = new Set(builtinLanguages ?? []);
    // builtin languages are in StreamingAssets, set their version to localAppVersion
    for (let lang of builtinSet) {
        languages[lang as EGameLanguage] = localAppVersion;
    }
    return {
        currentVersion: localAppVersion,
        languageVersions: { ...languages },
        // exclude builtin language files (they're in StreamingAssets, not in applyPath hot-update)
        files:
            previousManifest?.files.filter((info) => {
                let lang = getFileLanguage(info.path, languageNames);
                return lang !== undefined && !builtinSet.has(lang);
            }) ?? [],
    };
}

async function resetBuiltinLanguageBaseline(engine: IEngine, manifestInfo: IManifestInfo, fileToInfo: Map<string, IFileInfo>, builtinLanguages: Set<string>, localAppVersion: number) {
    let changed = false;
    let builtinLanguageList = Array.from(builtinLanguages);
    if (builtinLanguageList.length <= 0) return false;

    for (let language of builtinLanguageList) {
        let currentLanguageVersion = manifestInfo.languageVersions?.[language as EGameLanguage];
        if (currentLanguageVersion === undefined || currentLanguageVersion < localAppVersion) {
            setLanguageVersion(manifestInfo, language, localAppVersion);
            changed = true;
        }
    }
    return changed;
}

function ensureLanguageVersions(manifestInfo: IManifestInfo) {
    if (!manifestInfo.languageVersions) {
        manifestInfo.languageVersions = {};
    }
    if (!manifestInfo.appliedLanguageVersions) {
        manifestInfo.appliedLanguageVersions = {};
    }
    if (!manifestInfo.appliedVersions) {
        manifestInfo.appliedVersions = [];
    }
    return manifestInfo;
}

function hasLanguageVersion(manifestInfo: IManifestInfo, language: EGameLanguage) {
    return manifestInfo.languageVersions?.[language] !== undefined;
}

function getLanguageVersion(manifestInfo: IManifestInfo, language: EGameLanguage, localAppVersion: number) {
    return manifestInfo.languageVersions?.[language] ?? localAppVersion;
}

function setLanguageVersion(manifestInfo: IManifestInfo, language: string, version: number) {
    ensureLanguageVersions(manifestInfo);
    manifestInfo.languageVersions![language as EGameLanguage] = version;
}

function getCurrentGameLanguage(region?: string) {
    let savedLanguage = keyValueStorage.getString("global.GameLanguage", "") as EGameLanguage;
    if (savedLanguage && savedLanguage.length > 0 && !HiddenLanguages.has(savedLanguage)) return savedLanguage;
    return findGameLanguage(getSystemLanguage(), region) ?? DEFAULT_GAME_LANGUAGE;
}

async function updateChannel(
    engine: IEngine,
    manifestInfo: IManifestInfo,
    fileToInfo: Map<string, IFileInfo>,
    channelName: string | EGameLanguage,
    patches: IFileInfo[],
    currentChannelVersion: number,
    newVersion: number,
    channelDownloadPath: string,
    preferFullPatch = false,
): Promise<boolean> {
    let isCommonChannel = channelName === "common";
    let originalChannelVersion = isCommonChannel ? manifestInfo.currentVersion : manifestInfo.languageVersions?.[channelName as EGameLanguage];
    let touchedFiles = new Map<string, IFileInfo | undefined>();
    let restoreChannelChanges = () => {
        if (isCommonChannel) {
            manifestInfo.currentVersion = originalChannelVersion ?? manifestInfo.currentVersion;
        } else if (originalChannelVersion === undefined) {
            delete ensureLanguageVersions(manifestInfo).languageVersions![channelName as EGameLanguage];
        } else {
            setLanguageVersion(manifestInfo, channelName, originalChannelVersion);
        }
        touchedFiles.forEach((oldInfo, filePath) => {
            if (oldInfo === undefined) fileToInfo.delete(filePath);
            else fileToInfo.set(filePath, oldInfo);
        });
    };

    let patchFileInfo = preferFullPatch ? patches.find((patch) => patch.version === newVersion) : undefined;
    if (!patchFileInfo) {
        patchFileInfo = getBestPatchFileInfo(patches, currentChannelVersion);
    }
    if (!patchFileInfo) {
        patchFileInfo = patches.find((patch) => patch.version === newVersion);
    }
    assert(patchFileInfo !== undefined, `patchFileInfo is undefined, channel: ${channelName}, currentChannelVersion: ${currentChannelVersion}, patches: ${JSON.stringify(patches)}`);

    if (!fs.existsSync(channelDownloadPath)) {
        fs.mkdirSync(channelDownloadPath);
    }

    let patchFileDownloadPath = path.join(channelDownloadPath, path.basename(patchFileInfo.path)).replaceAll("\\", "/");
    trackPoint(engine, ETrackingPoint.EnsurePatchUrl, `channel: ${channelName}, url: ${patchFileInfo.path}, downloadPath: ${patchFileDownloadPath}`);

    let patchDownloadResult = await fetchRemoteData(
        engine,
        patchFileInfo.path,
        {
            start: ETrackingPoint.DownloadPatch,
            succeed: ETrackingPoint.DownloadPatchSucceed,
            failed: ETrackingPoint.DownloadPatchFailed,
            existsLocally: ETrackingPoint.PatchExistsLocally,
            retry: ETrackingPoint.DownloadPatchRetry,
        },
        {
            savePath: patchFileDownloadPath,
            sha256: patchFileInfo.sha256,
            size: patchFileInfo.size,
        },
        true,
    );
    if (patchDownloadResult === undefined) {
        return false;
    }

    let unzipSuccess = false;
    for (let i = 0; i < engine.maxRetryCount; i++) {
        try {
            await engine.onUnzipFile(patchFileDownloadPath, channelDownloadPath);
            unzipSuccess = true;
            break;
        } catch (err: any) {
            console.log(`onUnzipFile failed, retry index: ${i}, channel: ${channelName}, error: ${err.message}`);
            await delay(engine.retryIntervalMS);
        }
    }
    if (!unzipSuccess) {
        let info = `channel: ${channelName}, path: ${patchFileDownloadPath}, targetPath: ${channelDownloadPath}`;
        trackPoint(engine, ETrackingPoint.UnzipPatchFailed, info);
        await engine.onError(ETrackingPoint.UnzipPatchFailed, info);
        return false;
    }
    trackPoint(engine, ETrackingPoint.UnzipPatchSucceed, `channel: ${channelName}, path: ${patchFileDownloadPath}, targetPath: ${channelDownloadPath}`);

    let fileListPath = path.join(channelDownloadPath, FILE_LIST_FILE_NAME);
    let parsedFileInfos: unknown;
    try {
        parsedFileInfos = JSON.parse(fs.readFileTextSync(fileListPath)) as unknown;
    } catch (error: unknown) {
        let info = `patch file list parse failed, channel: ${channelName}, path: ${fileListPath}, error: ${getErrorMessage(error)}`;
        trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, info);
        await engine.onError(ETrackingPoint.OrganizeDownloadFolderFailed, info);
        return false;
    }
    if (!isFileInfoArray(parsedFileInfos)) {
        let info = `patch file list format invalid, channel: ${channelName}, path: ${fileListPath}`;
        trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, info);
        await engine.onError(ETrackingPoint.OrganizeDownloadFolderFailed, info);
        return false;
    }
    let newFileInfos = parsedFileInfos;
    newFileInfos.forEach((info) => {
        if (!touchedFiles.has(info.path)) {
            let oldInfo = fileToInfo.get(info.path);
            touchedFiles.set(info.path, oldInfo ? { ...oldInfo } : undefined);
        }
        info.redirect = path.join(channelDownloadPath, info.path).replaceAll("\\", "/");
        info.appliedVersion = newVersion;
        fileToInfo.set(info.path, info);
    });

    if (isCommonChannel) {
        manifestInfo.currentVersion = newVersion;
    } else {
        setLanguageVersion(manifestInfo, channelName, newVersion);
    }
    trackPoint(engine, ETrackingPoint.ApplyPatchVersion, `channel: ${channelName}, newVersion: ${newVersion}`);
    let organizeResult = await organizeDownloadFolder(engine, manifestInfo, fileToInfo, ETrackingPoint.OrganizeDownloadFolderBeforeFinished, `channel: ${channelName}`, channelDownloadPath, true);
    if (organizeResult.status !== "success") {
        restoreChannelChanges();
        await engine.onError(ETrackingPoint.OrganizeDownloadFolderFailed, organizeResult.info ?? `channel: ${channelName}`);
        return false;
    }
    if (hasPendingRedirects(fileToInfo, channelDownloadPath)) {
        let info = `channel: ${channelName}, downloadPath: ${channelDownloadPath}`;
        trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, info);
        await engine.onError(ETrackingPoint.OrganizeDownloadFolderFailed, info);
        restoreChannelChanges();
        return false;
    }

    // 更新 applied 状态（organizeDownloadFolder 已成功落盘）
    ensureLanguageVersions(manifestInfo);
    if (isCommonChannel) {
        if (!manifestInfo.appliedVersions!.includes(newVersion)) {
            manifestInfo.appliedVersions!.push(newVersion);
        }
    } else {
        let lang = channelName as EGameLanguage;
        let langApplied = manifestInfo.appliedLanguageVersions![lang];
        if (!langApplied) {
            manifestInfo.appliedLanguageVersions![lang] = [newVersion];
        } else if (!langApplied.includes(newVersion)) {
            langApplied.push(newVersion);
        }
    }

    return true;
}

// 整理下载目录，将下载目录下的文件移动到apply目录下
async function organizeDownloadFolder(
    engine: IEngine,
    manifestInfo: IManifestInfo | undefined,
    fileToInfo: Map<string, IFileInfo>,
    tag: string,
    info?: string,
    cleanupPath = engine.downloadPath,
    alwaysCleanup = false,
): Promise<IOrganizeDownloadFolderResult> {
    trackPoint(engine, tag, info);

    if (manifestInfo === undefined) {
        // 说明不需要下载目录
        try {
            if (fs.existsSync(engine.applyPath)) {
                await fs.rmAsync(engine.applyPath);
            }
            if (fs.existsSync(engine.downloadPath)) {
                await fs.rmAsync(engine.downloadPath);
            }
            return { status: "success" };
        } catch (error: unknown) {
            let errorInfo = `reason: ${tag}, cleanup failed: ${getErrorMessage(error)}`;
            trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, errorInfo);
            return { status: "failed", info: errorInfo };
        }
    }

    let pendingInfos = Array.from(fileToInfo.values()).filter((info) => info.redirect !== undefined);
    const filesToMove = pendingInfos.filter((info) => info.version > 0);
    const completedFiles = new Set<IFileInfo>();
    const startedAt = Date.now();
    let batchStartedAt = startedAt;
    let batchFiles = 0;
    let lastLogAt = startedAt;
    // 老安装包没有后台文件任务接口；累计 8ms 或 32 个文件后让出主线程，供 Unity 渲染和响应输入。
    const yieldIfNeeded = async () => {
        batchFiles++;
        if (batchFiles < 32 && Date.now() - batchStartedAt < 8) return;
        engine.onOrganizeProgressChanged?.(completedFiles.size, filesToMove.length);
        if (Date.now() - lastLogAt >= 1000) {
            console.log(`organizeDownloadFolder progress: ${completedFiles.size}/${filesToMove.length}, elapsed: ${Date.now() - startedAt}ms`);
            lastLogAt = Date.now();
        }
        await delay(1);
        batchFiles = 0;
        batchStartedAt = Date.now();
    };
    if (filesToMove.length > 0) {
        console.log(`organizeDownloadFolder start: ${filesToMove.length} files, mode: move`);
        engine.onOrganizeProgressChanged?.(0, filesToMove.length);
        await delay(1);
    }
    let missingSourceInfo = await findMissingRedirectSource(engine, pendingInfos, yieldIfNeeded);
    if (missingSourceInfo !== undefined) {
        let errorInfo = `reason: ${tag}, missing source: ${missingSourceInfo.redirect}, target: ${path.join(engine.applyPath, missingSourceInfo.path)}`;
        trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, errorInfo);
        return { status: "missing-source", info: errorInfo };
    }

    if (pendingInfos.length > 0) {
        if (!updateManifestFile(engine, manifestInfo, fileToInfo, `${tag}_pending`)) {
            return { status: "failed", info: `reason: ${tag}, write pending manifest failed` };
        }
    }

    let succeed = pendingInfos.length === 0;
    let lastError = "";
    for (let retryIndex = 0; retryIndex < engine.maxRetryCount; retryIndex++) {
        succeed = true;
        try {
            for (let pendingInfo of filesToMove) {
                if (pendingInfo.redirect === undefined || completedFiles.has(pendingInfo)) continue;

                let targetPath = path.join(engine.applyPath, pendingInfo.path);
                let tempPath = `${targetPath}.patching`;
                if (fs.existsSync(pendingInfo.redirect)) {
                    let targetDir = path.dirname(targetPath);
                    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir);
                    // 只有源文件仍在时才可丢弃旧暂存文件。
                    if (fs.existsSync(tempPath)) await fs.rmAsync(tempPath);
                    fs.moveFileSync(pendingInfo.redirect, tempPath);
                } else if (!isStagedFileValid(engine, pendingInfo)) {
                    if (!isAppliedFileValid(engine, pendingInfo)) {
                        throw new Error(`redirect source missing: ${pendingInfo.redirect}`);
                    }
                    // 上次已完成替换但尚未提交 manifest，校验正式文件后继续。
                    completedFiles.add(pendingInfo);
                    await yieldIfNeeded();
                    continue;
                }

                // pending manifest 保留原 redirect；中断后可从 .patching 或已替换的正式文件恢复。
                // 正常路径只做 rename，SHA 仅用于校验中断留下的文件。
                if (pendingInfo.path === PATCH_SCRIPT_FILE_NAME && !isStagedFileValid(engine, pendingInfo)) {
                    throw new Error(`staged patcher hash mismatch: ${tempPath}`);
                }
                fs.replaceFileSync(tempPath, targetPath);
                completedFiles.add(pendingInfo);
                await yieldIfNeeded();
            }

            break;
        } catch (error: unknown) {
            succeed = false;
            lastError = getErrorMessage(error);
            console.log(`organizeDownloadFolder failed: ${lastError}`);
            // move 后 .patching 可能是唯一的新文件；失败时必须保留，供本轮重试或下次启动恢复。
            if (retryIndex + 1 < engine.maxRetryCount) {
                await delay(engine.retryIntervalMS);
            }
        }
    }

    if (!succeed) {
        missingSourceInfo = await findMissingRedirectSource(engine, pendingInfos, yieldIfNeeded);
        let errorInfo =
            missingSourceInfo !== undefined
                ? `reason: ${tag}, missing source: ${missingSourceInfo.redirect}, target: ${path.join(engine.applyPath, missingSourceInfo.path)}`
                : `reason: ${tag}, error: ${lastError}`;
        trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, errorInfo);
        return { status: missingSourceInfo !== undefined ? "missing-source" : "failed", info: errorInfo };
    }

    let redirects = new Map<IFileInfo, string>();
    for (let pendingInfo of pendingInfos) {
        if (pendingInfo.redirect === undefined) continue;
        redirects.set(pendingInfo, pendingInfo.redirect);
        delete pendingInfo.redirect;
    }

    if (redirects.size > 0 && !updateManifestFile(engine, manifestInfo, fileToInfo, tag)) {
        redirects.forEach((redirect, pendingInfo) => {
            pendingInfo.redirect = redirect;
        });
        return { status: "failed", info: `reason: ${tag}, commit manifest failed` };
    }

    if (filesToMove.length > 0) {
        engine.onOrganizeProgressChanged?.(filesToMove.length, filesToMove.length);
        console.log(`organizeDownloadFolder complete: ${filesToMove.length} files, elapsed: ${Date.now() - startedAt}ms`);
        await delay(1);
    }

    if ((redirects.size > 0 || alwaysCleanup) && fs.existsSync(cleanupPath)) {
        try {
            await fs.rmAsync(cleanupPath);
            console.log(`organizeDownloadFolder delete folder: ${cleanupPath}`);
        } catch (error: unknown) {
            // manifest 已经提交，清理失败只会残留无引用缓存；不能把已生效的资源事务回滚。
            trackPoint(engine, ETrackingPoint.OrganizeDownloadFolderFailed, `reason: ${tag}, cleanup failed: ${getErrorMessage(error)}, path: ${cleanupPath}`);
        }
    }

    return { status: "success", applyResult: getPatchApplyResult(engine, manifestInfo) };
}

function isPendingPatcherValid(engine: IEngine, info: IFileInfo) {
    // 与整理流程选择源文件的顺序一致；源文件存在时不能用另一份有效副本替它通过校验。
    if (info.redirect !== undefined && fs.existsSync(info.redirect)) {
        try {
            return calculateFileSha256(info.redirect) === info.sha256;
        } catch {
            return false;
        }
    }
    return isStagedFileValid(engine, info) || isAppliedFileValid(engine, info);
}

function isStagedFileValid(engine: IEngine, info: IFileInfo) {
    let tempPath = `${path.join(engine.applyPath, info.path)}.patching`;
    if (!fs.existsSync(tempPath)) return false;
    try {
        return calculateFileSha256(tempPath) === info.sha256;
    } catch {
        return false;
    }
}

async function findMissingRedirectSource(engine: IEngine, pendingInfos: IFileInfo[], yieldIfNeeded: () => Promise<void>) {
    for (let pendingInfo of pendingInfos) {
        if (pendingInfo.redirect === undefined || pendingInfo.version <= 0) continue;
        if (!fs.existsSync(pendingInfo.redirect) && !isStagedFileValid(engine, pendingInfo) && !isAppliedFileValid(engine, pendingInfo)) {
            return pendingInfo;
        }
        await yieldIfNeeded();
    }
    return undefined;
}

function updateManifestFile(engine: IEngine, manifestInfo: IManifestInfo, fileToInfo: Map<string, IFileInfo>, reason: string) {
    let manifestPath = path.join(engine.applyPath, MANIFEST_FILE_NAME);
    manifestInfo.files = [];
    fileToInfo.forEach((info) => {
        manifestInfo.files.push(info);
    });
    // manifestInfo.files.sort((a, b) => {
    //     return a.path.localeCompare(b.path);
    // });
    let tempManifestPath = `${manifestPath}.tmp`;
    try {
        if (!fs.existsSync(path.dirname(manifestPath))) fs.mkdirSync(path.dirname(manifestPath));
        // 后续补齐语言基线等操作也会保存 manifest，不能把内存中的新脚本记录重新写回。
        // 只过滤落盘副本；内存仍用于当前更新流程，pending redirect 和已更新资源的记录保持完整。
        let persistedManifest = shouldOmitInstalledPatcher(engine, manifestInfo, fileToInfo, engine.localResVersion)
            ? { ...manifestInfo, files: manifestInfo.files.filter((info) => info.path !== PATCH_SCRIPT_FILE_NAME) }
            : manifestInfo;
        fs.writeTextFileSync(tempManifestPath, JSON.stringify(persistedManifest));
        fs.replaceFileSync(tempManifestPath, manifestPath);
    } catch (error: unknown) {
        // replaceFileSync 失败（进程在三步原子替换中间被杀等），保留 .tmp 供下次启动恢复
        trackPoint(engine, ETrackingPoint.UpdateManifestFile, `write failed: ${getErrorMessage(error)}, reason: ${reason}`);
        return false;
    }
    trackPoint(engine, ETrackingPoint.UpdateManifestFile, `reason: ${reason}`);
    return true;
}

function hasPendingRedirects(fileToInfo: Map<string, IFileInfo>, channelDownloadPath: string) {
    let normalizedChannelPath = channelDownloadPath.replaceAll("\\", "/");
    let hasPending = false;
    fileToInfo.forEach((info) => {
        if (!info.redirect) return;
        let redirectPath = info.redirect.replaceAll("\\", "/");
        if (redirectPath.startsWith(normalizedChannelPath + "/") || redirectPath === normalizedChannelPath) {
            hasPending = true;
        }
    });
    return hasPending;
}

function getPatchApplyResult(engine: IEngine, manifestInfo: IManifestInfo) {
    let ret: IPatchApplyResult = {
        files: new Map<string, string | undefined>(),
    };
    manifestInfo.files.forEach((info) => {
        let realPath: string | undefined;
        if (info.version >= 0) {
            realPath = getRealPath(engine, info);
            ret.files.set(info.path, realPath);
        }
    });
    return ret;
}

// 这块可以换成cs版的
// 没传saveFilePath就返回拉下来的string data，传了就返回saveFilePath
async function fetchRemoteData(
    engine: IEngine,
    remoteUrl: string,
    tags: {
        start: string;
        succeed: string;
        failed: string;
        retry?: string;
        existsLocally?: string;
    },
    fileInfo?: {
        savePath: string;
        sha256: string;
        size?: number;
    },
    checkDownload?: boolean,
    requestType?: string,
    requestData?: string,
) {
    if (checkDownload && fileInfo?.size !== undefined) {
        if (!(await engine.onPatchCanDownload(fileInfo.size))) {
            trackPoint(engine, ETrackingPoint.ExitPatchWithDownloadDeny, `url: ${remoteUrl}`);
            await engine.onError(ETrackingPoint.ExitPatchWithDownloadDeny, "");
            return;
        }
    }

    trackPoint(engine, tags.start, `fetch url: ${remoteUrl}, requestType: ${requestType}, requestData: ${requestData}`);

    if (fileInfo !== undefined) {
        if (fs.existsSync(fileInfo.savePath)) {
            // 检查文件sha256是否一样，如果一样就不下载了
            if (fileInfo.sha256 !== undefined) {
                let oldFileHash = calculateFileSha256(fileInfo.savePath);
                if (oldFileHash === fileInfo.sha256) {
                    engine.onDownloadProgressChanged(1n, 1n);
                    trackPoint(engine, tags.existsLocally ?? "debug_download_file_already_existed", `url: ${remoteUrl}, saveFilePath: ${fileInfo.savePath}`);
                    trackPoint(engine, tags.succeed, `url: ${remoteUrl}`);
                    return fileInfo.savePath;
                }
            }
        } else if (!fs.existsSync(path.dirname(fileInfo.savePath))) {
            fs.mkdirSync(path.dirname(fileInfo.savePath));
        }
    }

    let lastErrorMsg = "none";
    let isStorageError = false;
    let retryIndex = 0;
    for (retryIndex = 0; retryIndex < engine.maxRetryCount; retryIndex++) {
        try {
            let ret: string;
            if (fileInfo !== undefined) {
                await engine.onDownloadFile(remoteUrl, fileInfo.savePath, async (current: bigint, total: bigint) => {
                    engine.onDownloadProgressChanged(current, total);
                });
                // 自更新脚本必须先验完整性；大资源包仍由解压 CRC 校验，避免主线程全量哈希卡顿。
                if (path.basename(fileInfo.savePath) === PATCH_SCRIPT_FILE_NAME && calculateFileSha256(fileInfo.savePath) !== fileInfo.sha256) {
                    await fs.rmAsync(fileInfo.savePath);
                    throw new Error(`downloaded file hash mismatch: ${remoteUrl}`);
                }
                ret = fileInfo.savePath;
            } else {
                ret = await engine.onFetchRemoteText(remoteUrl, requestType, requestData);
            }
            trackPoint(engine, tags.succeed, `url: ${remoteUrl}`);
            return ret;

            // let context = {
            //     // file: fileInfo !== undefined ? fs.createWriteStream(fileInfo.savePath) : undefined,
            //     file: undefined,
            //     onProgressChanged: fileInfo?.onDownloadProgressChanged,
            //     lastError: undefined,
            //     jsonContent: fileInfo === undefined ? "" : undefined,
            // };

            // // 不知道为啥下载速度特别慢，所以先用https，可能跟nodejs版本低有关系
            // // await fetchRemoteDataWithHttp2(engine, remoteUrl, context);

            // if (context.file) {
            //     // context.file.close();
            //     await waitFileReadyToRead(fileInfo!.savePath);
            // }

            // if (context.lastError === undefined) {
            //     savePoint(engine, tags.succeed, `url: ${remoteUrl}, downloadPath: ${fileInfo?.savePath}, retryIndex: ${retryIndex}`);
            //     return context.jsonContent ?? fileInfo?.savePath;
            // } else {
            //     lastError = context.lastError;
            //     await delay(engine.retryIntervalMS);
            // }
        } catch (err: any) {
            if (tags.retry) trackPoint(engine, tags.retry, `retryIndex: ${retryIndex}, error: ${err}`);
            lastErrorMsg = String(err);
            // 存储空间不足：重试也无济于事（空间不会自己变多），立即跳出并标记为存储错误。
            // 注意 Error 的 cause 在 err.cause 上（原先误写成 err.options.cause，恒判不中→白白重试且丢失存储标识）。
            if (err?.cause === ETrackingPoint.StorageInsufficient) {
                isStorageError = true;
                break;
            }
            await delay(engine.retryIntervalMS);
        }
    }

    // 存储不足用专门的 StorageInsufficient 标签上报，使 showErrorDialog 按 tag 取到“存储空间不足，请清理手机存储后重试”，
    // 而不是笼统的“下载更新包失败”，给玩家可操作的提示。
    let failedTag = isStorageError ? ETrackingPoint.StorageInsufficient : tags.failed;
    trackPoint(engine, failedTag, `url: ${remoteUrl}, error: {${lastErrorMsg}}`);
    await engine.onError(failedTag, lastErrorMsg);
    return undefined;
}

// interface IHttpContext {
//     file?: fs.WriteStream;
//     onProgressChanged?: (progress: number) => void;
//     lastError: string | undefined;
//     jsonContent: string | undefined;
// }

// http2的处理，失败的话会fallback到https
// async function fetchRemoteDataWithHttp2(engine: ISettings, remoteUrl: string, context: IHttpContext) {
//     return new Promise<void>((resolve, reject) => {
//         let dataLength = 0;
//         let downloadedBytes = 0;
//         const url = new URL(remoteUrl);
//         const baseUrl = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;

//         const client = http2.connect(baseUrl);
//         let headers = {
//             [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_GET,
//             [http2.constants.HTTP2_HEADER_PATH]: url.pathname,
//         };
//         if (typeof context.jsonContent == "string") headers[http2.constants.HTTP2_HEADER_ACCEPT] = "application/json";

//         const request = client.request(headers);
//         if (context.file) request.pipe(context.file);
//         request.on("response", (headers, _flags) => {
//             if (request.session?.alpnProtocol !== "h2") {
//                 console.warn("http2 fallback to https");
//                 client.close();
//                 request.close();
//                 savePoint(engine, ESavePoint.FallbackToHttps, `url: ${remoteUrl}`);
//                 fetchRemoteDataWithHttps(engine, remoteUrl, context).then(resolve);
//             } else {
//                 dataLength = parseInt(headers["content-length"]!, 10);
//                 // for (const name in headers) {
//                 //     console.log(`${name}: ${headers[name]}`);
//                 // }
//             }
//         });
//         request.on("data", (chunk) => {
//             if (context.file === undefined) context.jsonContent += chunk;
//             downloadedBytes += chunk.length;
//             if (context.onProgressChanged) context.onProgressChanged(downloadedBytes / dataLength);
//         });
//         request.on("end", () => {
//             client.close();
//             resolve();
//         });
//         request.on("error", (err) => {
//             context.lastError = err;
//             console.error(err);
//             savePoint(engine, ESavePoint.Http2Error, `url: ${remoteUrl}, error: ${err.message}`);
//             reject(err);
//         });

//         request.end();
//     });
// }

// async function fetchRemoteDataWithHttps(engine: ISettings, remoteUrl: string, context: IHttpContext) {
//     return new Promise<void>((resolve, reject) => {
//         let dataLength = 0;
//         let downloadedBytes = 0;
//         let lastPercentage = 0;
//         console.log("[Patcher] 111111111");

//         https.get(remoteUrl, (response) => {
//             if (context.file) response.pipe(context.file);

//             dataLength = parseInt(response.headers["content-length"]!, 10);
//             response.on("data", (chunk) => {
//                 if (context.file === undefined) context.jsonContent += chunk;
//                 downloadedBytes += chunk.length;
//                 // if (context.onProgressChanged) context.onProgressChanged(downloadedBytes / dataLength);
//                 if (context.onProgressChanged) {
//                     let currentPercentage = downloadedBytes / dataLength;
//                     if (currentPercentage - lastPercentage >= 0.5) {
//                         lastPercentage = currentPercentage;
//                         context.onProgressChanged(currentPercentage);
//                     }
//                 }
//             });
//             response.on("end", () => {
//                 if (context.onProgressChanged) context.onProgressChanged(1);
//                 resolve();
//             });
//             response.on("error", (err) => {
//                 context.lastError = err.message;
//                 savePoint(engine, ESavePoint.HttpsError, `url: ${remoteUrl}, error: ${err.message}`);
//                 reject(err);
//             });
//         });
//     });
// }

function getRealPath(engine: IEngine, info: IFileInfo) {
    return info.redirect ? info.redirect : path.join(engine.applyPath, info.path);
}
