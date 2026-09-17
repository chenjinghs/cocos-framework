import { EGameLanguage, HiddenLanguages } from "./LanguageDefine";

export * from "./LanguageDefine";

export interface IFileInfo {
    path: string;
    version: number;
    sha256: string;
    size: number;
    redirect?: string;
    appliedVersion?: number;
}

export interface IManifestInfo {
    currentVersion: number;
    appliedVersions?: number[];
    languageVersions?: Partial<Record<EGameLanguage, number>>;
    appliedLanguageVersions?: Partial<Record<EGameLanguage, number[]>>;
    files: IFileInfo[];
}

export interface IVersionInfo {
    version: number | number[];
    distro?: string | string[];
    isReviewMode?: boolean;
    forcePatchInReview?: boolean;
    entryUrl?: string;
}

export interface IPatchChannels {
    common: {
        patches: IFileInfo[];
    };
    languages: Record<EGameLanguage, { patches: IFileInfo[] }>;
}

export interface IPatchInfo {
    oldestVersion: number;
    currentVersion: number;
    newAppDownloadUrl?: string;
    patchScript?: IFileInfo | null;
    channels?: IPatchChannels;
    pre_release?: boolean;
    entry_url?: string;
    versionInfos: IVersionInfo[] | null | undefined;
}

export function getAllGameLanguages() {
    return Object.values(EGameLanguage).filter((lang) => !HiddenLanguages.has(lang));
}

export function getBestPatchFileInfo(patches: IFileInfo[], currentVersion: number) {
    let bestPatch: IFileInfo | undefined;
    for (let patch of patches) {
        if (patch.version > currentVersion) continue;
        if (bestPatch === undefined || patch.version > bestPatch.version) {
            bestPatch = patch;
        }
    }
    return bestPatch;
}

export function getPatchAvailableLanguages(patchInfo?: Pick<IPatchInfo, "channels">) {
    if (!patchInfo?.channels?.languages) return undefined;
    return Object.keys(patchInfo.channels.languages) as EGameLanguage[];
}

export function resolveTargetLanguage(currentLanguage: EGameLanguage, builtinLanguages: EGameLanguage[], availableLanguages: EGameLanguage[], defaultLanguage?: EGameLanguage) {
    let fallback = defaultLanguage ?? builtinLanguages[0] ?? availableLanguages[0] ?? currentLanguage;
    if (!currentLanguage || HiddenLanguages.has(currentLanguage)) return fallback;
    if (currentLanguage === fallback) return currentLanguage;
    if (availableLanguages.includes(currentLanguage)) return currentLanguage;
    return fallback;
}

export const REPAIR_PATCH_KEY = "repairPatch";
