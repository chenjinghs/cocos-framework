import type { IPatchInfo } from "patch-common";

export const MANIFEST_FILE_NAME = "manifest.json";
export const PATCH_INFO_FILE_NAME = "patch-info.json";
export const PATCH_SCRIPT_FILE_NAME = "patcher.js";
export const FILE_LIST_FILE_NAME = "file-list.json";
export const GAME_SCENE_NAME = "Assets/Scenes/LuaGame.unity";
export const ENTRY_PATCH_URL = "/patch_info";
export const BRANCH_VERSION_FILE_NAME = "branch-version.json";

export enum ETrackingPoint {
    PatcherRestart = "patcher_restart",
    PatchStart = "patch_start",
    RemoveOldData = "remove_old_data",
    ReadManifest = "__read_manifest",
    ApplyCurrentManifest = "apply_current_manifest",
    ApplyPatchResult = "apply_patch_result",

    FetchPatchInfo = "fetch_patch_info",
    FetchPatchInfoRetry = "__fetch_patch_info_failed_and_retry",
    FetchPatchInfoSucceed = "__fetch_patch_info_succeed",
    FetchPatchInfoFailed = "fetch_patch_info_failed",

    EntryUrlChanged = "entry_url_changed",
    ParseRemotePatchInfoFailed = "parse_remote_patch_info_failed",
    RemotePatchInfo = "__remote_patch_info",
    NoUpdate = "no_update",
    NeedUpdateApp = "__need_update_app",
    EnsureDownloadPathAndApplyPath = "__ensure_download_path_and_apply_path",
    CheckNetworkFailed = "__check_network_failed",

    FetchPatchScript = "fetch_patch_script",
    FetchPatchScriptRetry = "__fetch_patch_script_failed_and_retry",
    FetchPatchScriptSucceed = "__fetch_patch_script_succeed",
    FetchPatchScriptFailed = "fetch_patch_script_failed",
    PatchScriptWriteSucceed = "__patch_script_write_succeed",
    PatchScriptExistsLocally = "__patch_script_exists_locally",
    MoveScriptToApplyPath = "__move_script_to_apply_path",
    NoPatchScriptUpdate = "__no_patch_script_update",

    EnsurePatchUrl = "__ensure_patch_url",
    DownloadPatch = "download_patch_start",
    DownloadPatchRetry = "__download_patch_retry",
    DownloadPatchSucceed = "download_patch_finish",
    DownloadPatchFailed = "download_patch_failed",
    PatchExistsLocally = "__patch_exists_locally",
    RestartPatcher = "restart_patcher",
    RestartPatcherWhenApply = "restart_patcher_when_apply",
    DownloadPatchProgress25 = "download_patch_progress_25",
    DownloadPatchProgress50 = "download_patch_progress_50",
    DownloadPatchProgress75 = "download_patch_progress_75",

    UnzipPatchSucceed = "__unzip_patch_succeed",
    UnzipPatchFailed = "unzip_patch_failed",
    ApplyPatchVersion = "apply_patch_version",
    OrganizeDownloadFolderBeforeFinished = "__organize_download_folder_before_finished",
    OrganizeDownloadFolderFailed = "organize_download_folder_failed",

    UpdateManifestFile = "__update_manifest_file",
    ExitPatchWithoutApply = "__exit_patch_without_apply",
    ExitPatchWithDownloadDeny = "__exit_patch_with_download_deny",
    // FallbackToHttps = "FallbackToHttps",
    PatchFinish = "patch_finish",
    // 语言渠道更新失败、降级使用本地已有旧版本语言资源进游戏：common 已是新版而语言渠道停留旧版，版本错配
    LanguageUpdateFailedUseLocal = "language_update_failed_use_local",
    UnknownError = "patch_unknown_error",

    LocalManifestReadFailed = "read_local_manifest_failed",
    LoadGameScene = "load_game_scene",

    // UI
    SplashUIOpen = "splash_ui_open",
    UpdateUIOpen = "update_ui_open",
    UpdateUIClose = "update_ui_close",

    UpdateUINoNetworkDialogShow = "update_ui_no_network_dialog_show",
    UpdateUINoNetworkDialogRetry = "update_ui_no_network_dialog_retry",
    UpdateUIExitGameWhenNetworkIsNotReachable = "update_ui_exit_game_when_network_is_not_reachable",

    UpdateUIShowCanDownloadDialog = "update_ui_show_can_download_dialog",
    // UpdateUIRetryWhenNetworkIsNotReachable = "UpdateUIRetryWhenNetworkIsNotReachable",
    UpdateUICancelDownloadWhenNetworkIsNotWifi = "update_ui_cancel_download_when_network_is_not_wifi",
    UpdateUIConfirmDownloadWhenNetworkIsNotWifi = "update_ui_confirm_download_when_network_is_not_wifi",
    UpdateUIShowAppDownloadDialog = "update_ui_show_app_download_dialog",
    UpdateUIConfirmJumpToNewAppUrl = "update_ui_confirm_jump_to_new_app_url",
    UpdateUICancelJumpToNewAppUrl = "update_ui_cancel_jump_to_new_app_url",
    UpdateUIExitGameWithError = "__update_ui_exit_game_with_error",
    UpdateUIShowErrorDialog = "__update_ui_show_error_dialog",
    StorageInsufficient = "storage_insufficient",
    LimitedCountry = "limited_country",

    FatalError = "patch_fatal_error",

    // Repair
    RepairPatchStart = "repair_patch_start",
    RepairPatchFailed = "repair_patch_failed",
    RepairPatchComplete = "repair_patch_complete",

    // Http2Error = "Http2Error",
    // HttpsError = "HttpsError",
}

export enum EGameErrorCode {
    GEC_MIN_CLIENT_VERSION = 115, // 客户端版本过低
}

export const IGNORED_ERRORS = new Set<string>([
    ETrackingPoint.FetchPatchInfoFailed,
    ETrackingPoint.CheckNetworkFailed,
    ETrackingPoint.ExitPatchWithDownloadDeny,
    ETrackingPoint.DownloadPatchFailed,
    ETrackingPoint.UnzipPatchFailed,
]);

export interface IPatchApplyResult {
    files: Map<string, string | undefined>; // key: relative path, value: real path，如果是undefined则代表删除
}

export interface IFS {
    readFileTextSync: (filePath: string) => string;
    readFileBufferSync: (filePath: string) => Uint8Array;
    mkdirSync: (dirPath: string) => void;
    copyFileSync: (srcPath: string, destPath: string) => void;
    moveFileSync: (srcPath: string, destPath: string) => void;
    replaceFileSync: (srcPath: string, destPath: string) => void;
    rmSync: (path: string) => void;
    rmAsync: (path: string) => Promise<void>;
    existsSync: (path: string) => boolean;
    writeTextFileSync: (filePath: string, data: string) => void;
    getTopFilesInDirectory: (dirPath: string) => string[];
    getAllFilesInDirectory: (dirPath: string) => string[];
}

export interface IPath {
    basename: (path: string) => string;
    join: (...paths: string[]) => string;
    resolve: (...paths: string[]) => string;
    dirname: (path: string) => string;
}

export interface IEngine {
    entryUrl: string;
    downloadPath: string;
    applyPath: string;
    apply: boolean;
    localResVersion: number; // app内版本号
    localCheckMode?: boolean;
    maxRetryCount: number;
    retryIntervalMS: number;
    branchVersion: number;
    isReviewMode?: boolean;

    onApplyCurrentManifest: (result: IPatchApplyResult | undefined, currentResVersion: number) => void;
    onResetToBuiltinResources: () => void;
    onCheckNetwork: () => Promise<boolean>;
    onTrackPoint: (tag: string, info?: string) => void;
    onDownloadProgressChanged: (current: bigint, total: bigint) => void;
    onOrganizeProgressChanged?: (currentFiles: number, totalFiles: number) => void;
    onComplete: (result: IPatchApplyResult | undefined, reason: ETrackingPoint, newVersion: number) => void;
    onError: (tag: string, msg: string) => Promise<void>;
    onNewAppNeedDownload: (url: string | undefined) => Promise<void>;
    onRestartPatcher: (newScriptPath: string) => void;
    onPatchCanDownload: (dataSize: number) => Promise<boolean>;
    onUnzipFile: (filePath: string, savePath: string) => Promise<void>; // 引入一个解压库有点太大了，所以转到外面去搞
    onFetchRemoteText: (url: string, fetchType?: string, data?: string) => Promise<string>;
    onDownloadFile: (url: string, savePath: string, onProgressChanged?: (current: bigint, total: bigint) => void) => Promise<void>;
    getOSType: () => string;
    getDistroName: () => string;
    getRegion: () => string;
    setPreRelease: (value: boolean) => void;
    setIsReviewMode: (value: boolean) => void;
    onFetchNewPatchInfoResult: (result: IPatchInfo) => void;
    setNewEntryUrl(entryUrl: string): void;
    setPatchInfo(patchInfo: IPatchInfo): void;
}

export interface ILocalResourceSettings {
    localResVersion: number;
    entryUrl: string;
    environment: string;
    buildNumber: string;
    distro?: string;
}

export interface IPlugin {
    start: (engine: IEngine) => Promise<void>;
}

export const UI_ROOT_NAME = "UpdateUIRoot";
export const UI_CAMERA_NAME = "UpdateUICamera";
export const UI_BLACK_BACKGROUND_NAME = "UpdateBlackBackground";
export const UI_UPDATE_PREFAB_PATH = "Assets/New/Cooperation/UI/Patcher/Update.prefab";
export const UI_DIALOG_PREFAB_PATH = "Assets/New/Cooperation/UI/Patcher/UpdateDialogBoard.prefab";
export const UI_SPLASH_PREFAB_PATH = "Assets/New/Cooperation/UI/Patcher/Splash.prefab";
export const UI_SPLASH_NAME = "Splash";
export const UI_UPDATE_NAME = "Update";
export const UI_DIALOG_NAME = "UpdateDialogBoard";
export const UI_BACKGROUND_RT = "UpdateBackgroundRT";
export const UI_CONTAINER = "Container";

export const SPECIFIC_VERSION_LOCAL_KEY = "patcher_specific_version";
