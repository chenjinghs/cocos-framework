import * as crypto from "crypto";
import * as fs from "fs-extra";
import { globSync } from "glob";
import * as path from "path";
import { classifyLanguageChannelPath, IResolvedLanguageChannelConfig, loadLanguageChannelConfig } from "./LanguageChannelConfig";

// 与 patch-common 的 EGameLanguage 对齐的语言标识类型。
// 不能直接 import patch-common（其 LanguageDefine.ts 顶层引用了 Unity 运行时 CS），
// 故用本地类型别名保持语义一致，实际值由 LanguageChannelConfig 的校验保证。
type GameLanguage = string;

const archiver = require("archiver");
const jsonStableStringify = require("json-stable-stringify");
const { program } = require("commander");

const DEFAULT_COMPRESSION_LEVEL = 7;
const DEFAULT_FILE_HASH_CONCURRENCY = 64;
const DEFAULT_ZIP_CONCURRENCY = 2;

program
    .option("--build <path>", "build patch")
    .option("--manifest-file <path>", "manifest file")
    .option("--current-version <version>", "current version")
    .option("--increment-last-version", "increment the previous version number")
    .option("--resource-path <path>", "resource path")
    .option("--resource-postfix <postfix>", "resource postfix, separated by '|''")
    .option("--recent-patch-count <count>", "recent patch count")
    // .requiredOption("--branch <name>", "branch name")
    .option("--base-version-interval <count>", "set base versions automatically by interval patch count from oldest version to current version")
    .option("--oldest-version <version>", "oldest version, update forcedly when client below this version")
    .option("--zip-compression-level <level>", `zip compression level, 0-9, default ${DEFAULT_COMPRESSION_LEVEL}`)
    .option("--new-app-download-url <url>", `new app download url`)
    .option("--patch-script <path>", `patch script file`)
    .option("--patch-root-url <path>", `patch root url`)
    .option("--ignore-files-with-hash <path>", `ignore files with hash, file path relative to resource path`)
    .option("--thin-enabled <enabled>", "enable patch thinning, true|false, default true")
    .option("--thin-report-file <path>", "patch thinning report file name, default patch-thin-report.json")
    .option("--hash-concurrency <count>", `file hash concurrency, default ${DEFAULT_FILE_HASH_CONCURRENCY}`)
    .option("--zip-concurrency <count>", `patch zip concurrency, default ${DEFAULT_ZIP_CONCURRENCY}`)
    .option("--language-runtime-config <path>", "language runtime config file")
    .option("--skip-version-check", "skip version check when build patch, for dev env use only")

    .option("--set-base-versions <versions>", "set base versions, separated by '|'")
    .option("--append-base-version <version>", "append base version")
    .option("--ignore-files <files>", "ignore files, separated by '|'")
    .option("--build-number <number>", "build number")
    .option("--distro <distro>", "distro")

    // preview环境和prod环境切换相关命令
    .option("--merge", "merge manifest")
    .option("--merge-check", "merge check manifest")
    .option("--merge-from-self-manifest <path>", "merge manifest file")
    .option("--merge-from-self-patch-info <path>", "merge patch info file")
    .option("--merge-from-other-manifest <path>", "merge manifest file")
    .option("--merge-from-other-patch-info <path>", "merge patch info file")
    .option("--merge-to-manifest <path>", "merge to manifest file")
    .option("--merge-to-patch-info <path>", "merge to patch info file");

// ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function main() {
    program.parse(process.argv);
    const opts = program.opts();

    if (opts.setBaseVersions) {
        await setBaseVersions(opts);
    } else if (opts.appendBaseVersion) {
        await appendBaseVersion(opts);
    }

    if (opts.build) {
        await build(opts);
    } else if (opts.merge) {
        await merge(opts);
    } else if (opts.mergeCheck) {
        await mergeCheck(opts);
    }
}
main();

// ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
interface IFileInfo {
    path: string;
    version: number; // 带正负号的，负号代表删除
    sha256: string;
    size: number;
}

interface IManifestInfo {
    oldestVersion: number;
    currentVersion: number;
    // branch: string;
    files: IFileInfo[];
    historyVersions: number[];
    baseVersions: number[];
}

interface IPatchInfo {
    oldestVersion: number; // 最老的版本号，低于此版本强更
    currentVersion: number;
    newAppDownloadUrl?: string; // 强更地址
    patchScript?: IFileInfo; // 补丁脚本
    // 旧版 patcher 会先读取 channelConfig 再下载新版 patcher.js。
    // 保留该字段用于跨版本升级兼容，不能删除。
    channelConfig?: {
        builtinLanguage: GameLanguage;
        languages: GameLanguage[];
    };
    channels?: {
        common: {
            patches: IFileInfo[];
        };
        languages: Record<GameLanguage, { patches: IFileInfo[] }>;
    };
    buildNumber: number;
    distro: string;
}

interface IChannelPatchArtifacts {
    patchInfos: IFileInfo[];
    thinReport: IThinReport;
}

interface IAggregateThinReport {
    common: IThinReport;
    languages: Record<GameLanguage, IThinReport>;
}

function isDeletedFile(file: IFileInfo) {
    return file.version < 0;
}

function isPatchFile(file: IFileInfo, patchScript: string) {
    return path.basename(file.path) === patchScript;
}

function getVersion(file: IFileInfo) {
    return Math.abs(file.version);
}

const MIB = 1024 * 1024;

function toMiB(size: number) {
    return size / MIB;
}

type ThinRange = "0_30" | "30_100" | "100_500" | "500_1000" | "gt_1000" | "none";

interface IThinPatchInfo {
    version: number;
    path: string;
    size: number;
    sizeMiB: number;
    deltaMiB: number;
}

interface IThinReport {
    enabled: boolean;
    basePatch: IThinPatchInfo | undefined;
    beforeCount: number;
    afterCount: number;
    removedCount: number;
    beforeSize: number;
    afterSize: number;
    savedSize: number;
    beforeSizeMiB: number;
    afterSizeMiB: number;
    savedSizeMiB: number;
    kept: IThinPatchInfo[];
    removed: IThinPatchInfo[];
}

function getThinRange(deltaMiB: number): ThinRange {
    if (deltaMiB <= 0) return "none";
    if (deltaMiB <= 30) return "0_30";
    if (deltaMiB <= 100) return "30_100";
    if (deltaMiB <= 500) return "100_500";
    if (deltaMiB <= 1000) return "500_1000";
    return "gt_1000";
}

function getMinGapByRange(range: ThinRange, deltaMiB: number): number | undefined {
    if (range === "0_30") {
        if (deltaMiB <= 5) return undefined;
        return 5;
    }
    if (range === "30_100") return 10;
    if (range === "100_500") return 100;
    if (range === "500_1000") return 200;
    return undefined;
}

function thinPatchInfosByDelta(patchFileInfos: IFileInfo[]) {
    if (patchFileInfos.length <= 2) {
        return {
            kept: patchFileInfos,
            removed: [] as IFileInfo[],
        };
    }

    let sortedByVersion = Array.from(patchFileInfos).sort((a, b) => a.version - b.version);
    let firstPatch = sortedByVersion[0];
    let latestPatch = sortedByVersion[sortedByVersion.length - 1];
    let baseSizeMiB = toMiB(latestPatch.size);

    let keepMap = new Map<string, IFileInfo>();
    keepMap.set(firstPatch.path, firstPatch); // 首热更包
    keepMap.set(latestPatch.path, latestPatch); // 尾热更包(L)

    let deltaInfos = sortedByVersion.map((info) => {
        return {
            info,
            deltaMiB: toMiB(info.size) - baseSizeMiB,
            range: getThinRange(toMiB(info.size) - baseSizeMiB),
        };
    });

    // Δ > 1000: 只保留最早版本的包
    let gt1000Infos = deltaInfos.filter((x) => x.range === "gt_1000");
    if (gt1000Infos.length > 0) {
        let earliest = gt1000Infos.reduce((prev, cur) => {
            return cur.info.version < prev.info.version ? cur : prev;
        });
        keepMap.set(earliest.info.path, earliest.info);
    }

    const processRange = (range: ThinRange) => {
        let candidates = deltaInfos.filter((x) => x.range === range);
        candidates.sort((a, b) => a.deltaMiB - b.deltaMiB || a.info.version - b.info.version);

        let kept: Array<{ info: IFileInfo; deltaMiB: number }> = [];
        for (let candidate of candidates) {
            let minGap = getMinGapByRange(range, candidate.deltaMiB);
            if (minGap === undefined) continue;

            if (kept.length === 0) {
                kept.push({ info: candidate.info, deltaMiB: candidate.deltaMiB });
                continue;
            }

            let last = kept[kept.length - 1];
            if (candidate.deltaMiB - last.deltaMiB >= minGap) {
                kept.push({ info: candidate.info, deltaMiB: candidate.deltaMiB });
                continue;
            }

            // 冲突时保留版本号更大的文件
            if (candidate.info.version > last.info.version) {
                kept[kept.length - 1] = { info: candidate.info, deltaMiB: candidate.deltaMiB };
            }
        }

        for (let item of kept) {
            keepMap.set(item.info.path, item.info);
        }
    };

    processRange("0_30");
    processRange("30_100");
    processRange("100_500");
    processRange("500_1000");

    let kept = sortedByVersion.filter((info) => keepMap.has(info.path));
    let removed = sortedByVersion.filter((info) => !keepMap.has(info.path));
    return {
        kept,
        removed,
    };
}

function parseBooleanOption(value: any, defaultValue: boolean) {
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;

    let normalized = String(value).trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;

    throw new Error(`invalid boolean option value: ${value}`);
}

function parseIntOption(name: string, value: any, defaultValue: number, min?: number, max?: number) {
    let target = value !== undefined && value !== null && value !== "" ? Number(value) : defaultValue;
    assert(Number.isInteger(target), `${name} must be an integer`);
    if (min !== undefined) assert(target >= min, `${name} must be >= ${min}`);
    if (max !== undefined) assert(target <= max, `${name} must be <= ${max}`);
    return target;
}

function parseOptionalIntOption(name: string, value: any, min?: number, max?: number): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    return parseIntOption(name, value, 0, min, max);
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
    assert(concurrency >= 1, `concurrency must be >= 1, got ${concurrency}`);
    let nextIndex = 0;
    let runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
        while (nextIndex < items.length) {
            let current = nextIndex;
            nextIndex += 1;
            await worker(items[current], current);
        }
    });
    await Promise.all(runners);
}

function sumPatchSize(patches: IFileInfo[]) {
    return patches.reduce((sum, patch) => sum + patch.size, 0);
}

function sortPatchInfosByVersionDesc(patches: IFileInfo[]) {
    patches.sort((a, b) => b.version - a.version);
    return patches;
}

function readIgnoreFileInfos(ignoreFilePath: string | undefined): IFileInfo[] | undefined {
    if (!ignoreFilePath) return undefined;
    assert(fs.existsSync(ignoreFilePath), `ignore-files-with-hash file not found: ${ignoreFilePath}`);

    try {
        let text = fs.readFileSync(ignoreFilePath, "utf-8");
        let parsed = JSON.parse(text);
        assert(Array.isArray(parsed), `ignore-files-with-hash must be a JSON array: ${ignoreFilePath}`);
        return parsed as IFileInfo[];
    } catch (error: any) {
        throw new Error(`failed to read --ignore-files-with-hash: ${ignoreFilePath}, reason: ${error.message}`);
    }
}

function toThinPatchInfo(info: IFileInfo, baseSizeMiB: number): IThinPatchInfo {
    let sizeMiB = toMiB(info.size);
    return {
        version: info.version,
        path: info.path,
        size: info.size,
        sizeMiB,
        deltaMiB: sizeMiB - baseSizeMiB,
    };
}

function buildThinReport(enabled: boolean, beforePatches: IFileInfo[], afterPatches: IFileInfo[], removedPatches: IFileInfo[]): IThinReport {
    let sorted = Array.from(beforePatches).sort((a, b) => a.version - b.version);
    let basePatch = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
    let baseSizeMiB = basePatch ? toMiB(basePatch.size) : 0;
    let beforeSize = sumPatchSize(beforePatches);
    let afterSize = sumPatchSize(afterPatches);
    let savedSize = beforeSize - afterSize;

    return {
        enabled,
        basePatch: basePatch ? toThinPatchInfo(basePatch, baseSizeMiB) : undefined,
        beforeCount: beforePatches.length,
        afterCount: afterPatches.length,
        removedCount: removedPatches.length,
        beforeSize,
        afterSize,
        savedSize,
        beforeSizeMiB: toMiB(beforeSize),
        afterSizeMiB: toMiB(afterSize),
        savedSizeMiB: toMiB(savedSize),
        kept: afterPatches.map((info) => toThinPatchInfo(info, baseSizeMiB)),
        removed: removedPatches.map((info) => toThinPatchInfo(info, baseSizeMiB)),
    };
}

function writeJsonFile(file: string, data: any) {
    if (!fs.existsSync(path.dirname(file))) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    fs.writeFileSync(file, jsonStableStringify(data, { space: 4 }));
    console.log(`write json file: ${file}`);
}

function calculateSha256(data: Buffer) {
    return crypto
        .createHash("sha256")
        .update(data as any)
        .digest("hex");
}

function cloneFileInfo(info: IFileInfo): IFileInfo {
    return {
        path: info.path,
        version: info.version,
        sha256: info.sha256,
        size: info.size,
    };
}

function createEmptyManifest(oldestVersion: number, currentVersion: number, sourceManifest?: IManifestInfo): IManifestInfo {
    let historyVersions = Array.from(sourceManifest?.historyVersions ?? []);
    if (!historyVersions.includes(currentVersion)) {
        historyVersions.push(currentVersion);
        historyVersions.sort((a, b) => a - b);
    }

    return {
        oldestVersion,
        currentVersion,
        files: [],
        historyVersions,
        baseVersions: Array.from(sourceManifest?.baseVersions ?? []),
    };
}

function createManifestFileMap(manifestInfo: IManifestInfo | undefined) {
    let ret = new Map<string, IFileInfo>();
    for (let info of manifestInfo?.files ?? []) {
        ret.set(info.path, cloneFileInfo(info));
    }
    return ret;
}

function buildNextManifest(previousManifest: IManifestInfo | undefined, currentFiles: Map<string, IFileInfo>, oldestVersion: number, currentVersion: number) {
    let manifestInfo = createEmptyManifest(oldestVersion, currentVersion, previousManifest);
    let fileInfos = createManifestFileMap(previousManifest);
    let currentFileSet = new Set<string>();

    currentFiles.forEach((info, filePath) => {
        currentFileSet.add(filePath);
        fileInfos.set(filePath, cloneFileInfo(info));
    });

    fileInfos.forEach((info, filePath) => {
        if (currentFileSet.has(filePath)) return;
        if (isDeletedFile(info)) return;

        info.version = -currentVersion;
    });

    manifestInfo.files = Array.from(fileInfos.values()).sort((a, b) => a.path.localeCompare(b.path));
    return manifestInfo;
}

function splitFileInfosByChannel(fileInfos: Iterable<IFileInfo>, config: IResolvedLanguageChannelConfig) {
    let commonFiles = new Map<string, IFileInfo>();
    let ignoredFiles = new Map<string, IFileInfo>();
    let languageFiles = new Map<string, Map<string, IFileInfo>>();
    let shippingFiles = new Map<string, IFileInfo>();

    for (let language of config.activeLanguages) {
        languageFiles.set(language, new Map<string, IFileInfo>());
    }

    for (let info of fileInfos) {
        let clonedInfo = cloneFileInfo(info);
        let result = classifyLanguageChannelPath(clonedInfo.path, config);
        if (result.kind === "ignored") {
            ignoredFiles.set(clonedInfo.path, clonedInfo);
            continue;
        }

        shippingFiles.set(clonedInfo.path, clonedInfo);
        if (result.kind === "common") {
            commonFiles.set(clonedInfo.path, clonedInfo);
            continue;
        }

        languageFiles.get(result.language)?.set(clonedInfo.path, clonedInfo);
    }

    return {
        commonFiles,
        ignoredFiles,
        languageFiles,
        shippingFiles,
    };
}

async function collectFileInfo(targetPath: string, resourcePostfix: string, fileInfos: Map<string, IFileInfo>, currentVersion: number, hashConcurrency: number, ignoreFiles?: string[], ignoreFileInfos?: IFileInfo[]) {
    console.log(`start collect file info from ${targetPath}`);

    let pattern = resourcePostfix === "*" ? "**/*" : `**/*.@(${resourcePostfix})`;
    let files = await globSync(path.join(targetPath, pattern).replaceAll("\\", "/"), {
        nodir: true,
        ignore: {
            ignored: (p) => {
                return p.name.endsWith(".meta") || p.name.endsWith(".manifest");
            },
        },
    });
    let oldInfos = new Map<string, IFileInfo>(fileInfos);
    let completed = 0;
    await runWithConcurrency(files, hashConcurrency, async (file) => {
        let data = await fs.readFile(file);
        let relativePath = path.relative(targetPath, file).replaceAll("\\", "/");
        let info = fileInfos.get(relativePath);
        let sha256 = calculateSha256(data);

        if (!info) {
            info = {
                path: relativePath,
                sha256: "",
                version: 0,
                size: 0,
            };
            fileInfos.set(relativePath, info);
        }

        if (info.sha256 !== sha256 || info.version <= 0) {
            info.sha256 = sha256;
            info.version = currentVersion;
            info.size = data.length;
            console.log(`file ${relativePath} was marked with changed version: ${currentVersion}`);
        }
        oldInfos.delete(relativePath);
        completed += 1;
        if (completed % 1000 === 0 || completed === files.length) {
            console.log(`collect file info percentage: ${((completed / files.length) * 100).toFixed(2)}%, progress: ${completed} / ${files.length}`);
        }
    });
    console.log(`collect file info finished, file total count: ${files.length}`);

    // 如果还剩下，那么就是删除了，将version改成负的
    for (let oldInfo of oldInfos.values()) {
        if (!isDeletedFile(oldInfo)) {
            oldInfo.version = -currentVersion;
            console.log(`file ${oldInfo.path} was marked with deleted version: ${oldInfo.version}`);
        }
    }

    if (ignoreFiles) {
        for (let ignoreFile of ignoreFiles) {
            fileInfos.delete(ignoreFile);
        }
    }

    if (ignoreFileInfos && ignoreFileInfos.length > 0) {
        let hashToFileMap = new Map<string, string>();
        for (let [filePath, fileInfo] of fileInfos) {
            hashToFileMap.set(fileInfo.sha256, filePath);
        }
        for (let info of ignoreFileInfos) {
            let filePath = hashToFileMap.get(info.sha256);
            if (filePath) {
                let foundInfo = fileInfos.get(filePath);
                if (foundInfo?.path === info.path) {
                    fileInfos.delete(filePath);
                    console.log(`ignore file with hash: ${filePath}, sha256: ${info.sha256}`);
                }
            }
        }
    }
}

function collectPatchVersions(manifestInfo: IManifestInfo, baseVersionInterval: number | undefined, recentPatchCount: number) {
    let patchVersions = new Array<number>();
    let oldestVersion = manifestInfo.oldestVersion;
    let currentVersion = manifestInfo.currentVersion;

    if (oldestVersion == currentVersion) {
        // 只有一个版本，不需要打patch
        return [];
    }

    let historyVersions = manifestInfo.historyVersions;
    let versionSet = new Set(historyVersions);

    // 处理base
    if (baseVersionInterval !== undefined) {
        for (let i = baseVersionInterval; i < historyVersions.length; i += baseVersionInterval) {
            patchVersions.push(historyVersions[i]);
        }
    } else {
        for (let baseVersion of manifestInfo.baseVersions) {
            if (baseVersion < oldestVersion || baseVersion > currentVersion) continue;
            assert(versionSet.has(baseVersion), `base version ${baseVersion} not found`);
            patchVersions.push(baseVersion);
        }
    }

    // 处理recent
    let recentVersions = historyVersions.slice(-recentPatchCount - 1); // 因为最新版本不需要打patch，所以要多取一个
    for (let version of recentVersions) {
        if (patchVersions.indexOf(version) < 0) patchVersions.push(version);
    }

    // 最老版本必须入patch，也就是说无论打什么包都有最老包到最新包的patch
    if (patchVersions.indexOf(oldestVersion) < 0) patchVersions.push(oldestVersion);
    let currentIndex = patchVersions.indexOf(currentVersion);
    if (currentIndex >= 0) patchVersions.splice(currentIndex, 1); // 最新版本不需要打patch

    patchVersions.sort();
    return patchVersions;
}

async function createPatchZip(basePath: string, fileInfos: IFileInfo[], outputZipPath: string, compressionLevel: number, info: IFileInfo, patchScript: string) {
    let patchFiles = new Array<string>();

    for (let fileInfo of fileInfos) {
        if (isDeletedFile(fileInfo) || isPatchFile(fileInfo, patchScript)) continue;
        patchFiles.push(fileInfo.path);
    }

    patchFiles.sort();

    return new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(outputZipPath);
        const archive = archiver("zip", { zlib: { level: compressionLevel } }); // 设置压缩级别

        output.on("error", reject);
        output.on("close", async () => {
            if (!output.writableFinished) return;
            try {
                // ZIP 可能超过 2 GiB，分块计算哈希，避免整文件读取的大小限制。
                const hash = crypto.createHash("sha256");
                let size = 0;
                for await (const chunk of fs.createReadStream(outputZipPath)) {
                    hash.update(chunk);
                    size += chunk.length;
                }
                info.sha256 = hash.digest("hex");
                info.size = size;
                console.log(`zip success: ${outputZipPath}, sha256: ${info.sha256}`);
                resolve();
            } catch (err) {
                reject(err);
            }
        });

        archive.on("error", (err: any) => {
            reject(err);
        });

        archive.pipe(output);

        // 删掉含有patch脚本的文件
        let infos = Array.from(fileInfos);
        let index = infos.findIndex((info) => isPatchFile(info, patchScript));
        if (index >= 0) {
            infos.splice(index, 1);
        }
        let fileListContent = jsonStableStringify(infos);
        archive.append(fileListContent, { name: "file-list.json" });
        patchFiles.forEach((filePath) => {
            archive.append(fs.createReadStream(path.join(basePath, filePath)), { name: filePath });
        });

        archive.finalize();
    });
}

async function generatePatches(
    outputPath: string,
    manifestInfo: IManifestInfo,
    patchVersions: Array<number>,
    resourceBasePath: string,
    zipCompressionLevel: number,
    patchScript: string,
    zipConcurrency: number,
    options?: {
        allowEmptyPatch?: boolean;
        includeSelfVersionFullPatch?: boolean;
    },
) {
    let patchFileInfos = new Array<IFileInfo>();

    let allowEmptyPatch = options?.allowEmptyPatch === true;
    let includeSelfVersionFullPatch = options?.includeSelfVersionFullPatch === true;

    if (patchVersions.length === 0 && !includeSelfVersionFullPatch) {
        console.log(`no patch need to generate`);
        return patchFileInfos;
    }

    console.log(`start generate patches to ${outputPath}, patch versions: ${patchVersions}`);
    // let promises = new Array<Promise<void>>();
    let files = Array.from(manifestInfo.files);
    files.sort((a, b) => getVersion(a) - getVersion(b)); // 小version在前

    await runWithConcurrency(patchVersions, zipConcurrency, async (patchVersion) => {
        // files
        // 1    1   1   1   2   2   2   3   3   3
        // ^                ^
        // index            index
        // patchVersion为n时，需要找出所有version >= n + 1的file
        let index = files.findIndex((file) => getVersion(file) >= patchVersion + 1);
        let patchFiles = index < 0 ? [] : files.slice(index, files.length);
        if (index < 0 && !allowEmptyPatch) {
            console.log(`patch version ${patchVersion} not found, skip`);
            return;
        }

        let zipPath = `${patchVersion}-${manifestInfo.currentVersion}.zip`;
        let info = {
            version: patchVersion,
            path: zipPath,
            sha256: "",
            size: 0,
        };
        patchFileInfos.push(info);
        await createPatchZip(resourceBasePath, patchFiles, path.join(outputPath, zipPath), zipCompressionLevel, info, patchScript);
    });

    if (includeSelfVersionFullPatch) {
        let info = {
            version: manifestInfo.currentVersion,
            path: `${manifestInfo.currentVersion}-${manifestInfo.currentVersion}.zip`,
            sha256: "",
            size: 0,
        };
        let liveFiles = manifestInfo.files.filter((file) => file.version > 0);
        patchFileInfos.push(info);
        await createPatchZip(resourceBasePath, liveFiles, path.join(outputPath, info.path), zipCompressionLevel, info, patchScript);
    }

    // let sha256s = await Promise.all(promises);
    console.log(`generate patches finished, patch total count: ${patchFileInfos.length}`);

    // 大的在前面，方便运行时查找
    return sortPatchInfosByVersionDesc(patchFileInfos);
}

async function buildPatchArtifacts(
    outputPath: string,
    manifestInfo: IManifestInfo,
    resourceBasePath: string,
    zipCompressionLevel: number,
    patchScript: string,
    zipConcurrency: number,
    baseVersionInterval: number | undefined,
    recentPatchCount: number,
    thinEnabled: boolean,
    patchOptions?: {
        allowEmptyPatch?: boolean;
        includeSelfVersionFullPatch?: boolean;
    },
): Promise<IChannelPatchArtifacts> {
    if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
    }

    let patchVersions = collectPatchVersions(manifestInfo, baseVersionInterval, recentPatchCount);
    let patchFileInfos = await generatePatches(outputPath, manifestInfo, patchVersions, resourceBasePath, zipCompressionLevel, patchScript, zipConcurrency, patchOptions);

    let selfVersionPatch = patchOptions?.includeSelfVersionFullPatch
        ? patchFileInfos.find((patch) => patch.version === manifestInfo.currentVersion)
        : undefined;
    let diffPatchInfos = selfVersionPatch ? patchFileInfos.filter((patch) => patch.path !== selfVersionPatch.path) : Array.from(patchFileInfos);
    let beforeThinPatches = Array.from(patchFileInfos);
    let removedPatches: IFileInfo[] = [];
    if (thinEnabled) {
        let thinResult = thinPatchInfosByDelta(diffPatchInfos);
        patchFileInfos = thinResult.kept;
        removedPatches = thinResult.removed;
        if (selfVersionPatch) {
            patchFileInfos.push(selfVersionPatch);
        }
        for (let removedPatch of removedPatches) {
            let removePath = path.join(outputPath, removedPatch.path);
            if (fs.existsSync(removePath)) {
                fs.rmSync(removePath);
                console.log(`remove redundant patch zip: ${removePath}`);
            }
        }
        console.log(`patch thinning finished, kept: ${patchFileInfos.length}, removed: ${removedPatches.length}`);
    } else {
        console.log(`patch thinning skipped, --thin-enabled=false`);
    }

    sortPatchInfosByVersionDesc(patchFileInfos);
    let thinReport = buildThinReport(thinEnabled, beforeThinPatches, patchFileInfos, removedPatches);
    return {
        patchInfos: patchFileInfos,
        thinReport,
    };
}

async function build(opts: any) {
    let lastManifestFile = opts.manifestFile;
    let currentVersion = opts.currentVersion !== undefined ? Number(opts.currentVersion) : undefined;
    if (Number.isNaN(currentVersion)) currentVersion = undefined;
    let incrementLastVersion = opts.incrementLastVersion;
    let resourcePath = opts.resourcePath;
    let resourcePostfix = opts.resourcePostfix ?? "*";
    let oldestVersion = opts.oldestVersion !== undefined ? Number(opts.oldestVersion) : undefined;
    if (Number.isNaN(oldestVersion)) oldestVersion = undefined;

    // let branchName = opts.branch;
    let outputPath = path.join(opts.build, String(currentVersion)).replaceAll("\\", "/");
    if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { recursive: true });
    fs.mkdirSync(outputPath, { recursive: true });

    let zipCompressionLevel = parseIntOption("--zip-compression-level", opts.zipCompressionLevel, DEFAULT_COMPRESSION_LEVEL, 0, 9);
    let newAppDownloadUrl = opts.newAppDownloadUrl;
    let recentPatchCount = parseIntOption("--recent-patch-count", opts.recentPatchCount, 0, 0);
    // let baseVersions = opts.baseVersions ? (opts.baseVersions as string).split(";").map((v) => Number(v)) : undefined;
    let baseVersionInterval = parseOptionalIntOption("--base-version-interval", opts.baseVersionInterval, 1);
    let patchScript = opts.patchScript;
    let patchRootUrl = opts.patchRootUrl ? opts.patchRootUrl + "/" + String(currentVersion) + "/" : "";
    let ignoreFiles = opts.ignoreFiles ? (opts.ignoreFiles as string).split("|") : undefined;
    let buildNumber = opts.buildNumber;
    let distro = opts.distro;
    let ignoreFileInfos: IFileInfo[] | undefined = readIgnoreFileInfos(opts.ignoreFilesWithHash);
    let thinEnabled = parseBooleanOption(opts.thinEnabled, true);
    let thinReportFile = opts.thinReportFile ? String(opts.thinReportFile) : "patch-thin-report.json";
    let hashConcurrency = parseIntOption("--hash-concurrency", opts.hashConcurrency, DEFAULT_FILE_HASH_CONCURRENCY, 1);
    let zipConcurrency = parseIntOption("--zip-concurrency", opts.zipConcurrency, DEFAULT_ZIP_CONCURRENCY, 1);
    let languageChannelConfig = loadLanguageChannelConfig(opts.languageRuntimeConfig);

    assert(resourcePath && String(resourcePath).length > 0, "--resource-path must be set");
    assert(fs.existsSync(resourcePath), `resource path not found: ${resourcePath}`);
    console.log(`language runtime config: ${languageChannelConfig.sourcePath}`);

    let previousRootManifest: IManifestInfo;
    if (lastManifestFile !== undefined && oldestVersion !== currentVersion) {
        console.log(`last manifest file: ${lastManifestFile}`);
        assert(fs.existsSync(lastManifestFile), `last manifest file ${lastManifestFile} not found`);

        let jsonString = fs.readFileSync(lastManifestFile).toString();
        jsonString = jsonString.replace(`path">"`,`path":"`);
        previousRootManifest = JSON.parse(jsonString) as IManifestInfo;
        if (oldestVersion === undefined) oldestVersion = previousRootManifest.oldestVersion;
        if (incrementLastVersion) currentVersion = previousRootManifest.currentVersion + 1;
    } else {
        previousRootManifest = {
            oldestVersion: 0,
            currentVersion: 0,
            // branch: branchName,
            files: [],
            historyVersions: [],
            baseVersions: [],
        };
        if (incrementLastVersion) currentVersion = oldestVersion;
    }
    assert(currentVersion !== undefined, "currentVersion must be set");
    assert(oldestVersion !== undefined, "oldestVersion must be set");
    assert(oldestVersion <= currentVersion, `oldestVersion must not be greater than currentVersion, oldest: ${oldestVersion}, current: ${currentVersion}`);
    assert(
        opts.skipVersionCheck ||
        previousRootManifest.currentVersion <= 0 || currentVersion > previousRootManifest.currentVersion,
        `currentVersion must be higher than previous manifest, current: ${currentVersion}, previous: ${previousRootManifest.currentVersion}`,
    );
    console.log(`current version: ${currentVersion}, oldest version: ${oldestVersion}`);

    let canReusePreviousChannelManifest = true;
    if (oldestVersion !== undefined && previousRootManifest.oldestVersion !== oldestVersion) {
        // 强更版本号变化，清空文件列表
        previousRootManifest.oldestVersion = oldestVersion;
        previousRootManifest.files = [];
        canReusePreviousChannelManifest = false;
    }

    let fileInfos = new Map<string, IFileInfo>();
    for (let fileInfo of previousRootManifest.files) {
        fileInfos.set(fileInfo.path, fileInfo);
    }

    // 收集文件信息
    await collectFileInfo(resourcePath, resourcePostfix, fileInfos, currentVersion!, hashConcurrency, ignoreFiles, ignoreFileInfos);
    let currentSplit = splitFileInfosByChannel(fileInfos.values(), languageChannelConfig);
    let splitCount = currentSplit.commonFiles.size + currentSplit.ignoredFiles.size;
    currentSplit.languageFiles.forEach((files) => {
        splitCount += files.size;
    });
    assert(splitCount === fileInfos.size, `split file count mismatch, expected: ${fileInfos.size}, actual: ${splitCount}`);

    let previousSplit = splitFileInfosByChannel(previousRootManifest.files, languageChannelConfig);
    let previousCommonManifest = undefined as IManifestInfo | undefined;
    if (canReusePreviousChannelManifest && previousRootManifest.files.length > 0) {
        previousCommonManifest = createEmptyManifest(previousRootManifest.oldestVersion, previousRootManifest.currentVersion, previousRootManifest);
        previousCommonManifest.files = Array.from(previousSplit.commonFiles.values()).sort((a, b) => a.path.localeCompare(b.path));
    }

    let previousLanguageManifestMap = new Map<string, IManifestInfo | undefined>();
    for (let language of languageChannelConfig.activeLanguages) {
        let manifest = undefined as IManifestInfo | undefined;
        if (canReusePreviousChannelManifest && previousRootManifest.files.length > 0) {
            manifest = createEmptyManifest(previousRootManifest.oldestVersion, previousRootManifest.currentVersion, previousRootManifest);
            manifest.files = Array.from(previousSplit.languageFiles.get(language)?.values() ?? []).sort((a, b) => a.path.localeCompare(b.path));
        }
        previousLanguageManifestMap.set(language, manifest);
    }

    let rootManifestInfo = buildNextManifest(previousRootManifest, currentSplit.shippingFiles, oldestVersion, currentVersion);
    let commonManifestInfo = buildNextManifest(previousCommonManifest, currentSplit.commonFiles, oldestVersion, currentVersion);
    let languageManifestInfos = new Map<string, IManifestInfo>();
    for (let language of languageChannelConfig.activeLanguages) {
        let currentLanguageFiles = currentSplit.languageFiles.get(language) ?? new Map<string, IFileInfo>();
        let manifestInfo = buildNextManifest(previousLanguageManifestMap.get(language), currentLanguageFiles, oldestVersion, currentVersion);
        languageManifestInfos.set(language, manifestInfo);
    }

    writeJsonFile(path.join(outputPath, "manifest.json"), rootManifestInfo);

    let commonPatchArtifacts = await buildPatchArtifacts(
        path.join(outputPath, "common"),
        commonManifestInfo,
        resourcePath,
        zipCompressionLevel,
        patchScript,
        zipConcurrency,
        baseVersionInterval,
        recentPatchCount,
        thinEnabled,
        {
            allowEmptyPatch: true,
        },
    );
    let languagePatchArtifacts = new Map<string, IChannelPatchArtifacts>();
    for (let [language, manifestInfo] of languageManifestInfos) {
        let patchArtifacts = await buildPatchArtifacts(
            path.join(outputPath, "lang", language),
            manifestInfo,
            resourcePath,
            zipCompressionLevel,
            patchScript,
            zipConcurrency,
            baseVersionInterval,
            recentPatchCount,
            thinEnabled,
            {
                allowEmptyPatch: true,
                includeSelfVersionFullPatch: true,
            },
        );
        languagePatchArtifacts.set(language, patchArtifacts);
    }

    // 处理热更脚本逻辑
    let patchScriptInfo = undefined;
    if (patchScript !== undefined) {
        let found = currentSplit.shippingFiles.get(patchScript);
        assert(found, `patch file ${patchScript} not found`);

        if (found!.version > rootManifestInfo.oldestVersion) {
            // 只要patch脚本有变化则写入
            if (!fs.existsSync(path.dirname(path.join(outputPath, found!.path)))) {
                fs.mkdirSync(path.dirname(path.join(outputPath, found!.path)), { recursive: true });
            }
            fs.copyFileSync(path.join(resourcePath, found!.path), path.join(outputPath, found!.path));
            patchScriptInfo = {
                path: patchRootUrl + found!.path.replaceAll("\\", "/"),
                sha256: found!.sha256,
                version: found!.version,
                size: found!.size,
            };
        }
    }
    // 整理下路径
    for (let info of commonPatchArtifacts.patchInfos) {
        info.path = patchRootUrl + path.join("common", info.path).replaceAll("\\", "/");
    }
    let languagePatchInfoRecord: Record<string, { patches: IFileInfo[] }> = {};
    for (let [language, artifacts] of languagePatchArtifacts) {
        for (let info of artifacts.patchInfos) {
            info.path = patchRootUrl + path.join("lang", language, info.path).replaceAll("\\", "/");
        }
        languagePatchInfoRecord[language] = {
            patches: artifacts.patchInfos,
        };
    }

    let legacyBuiltinLanguage = languageChannelConfig.defaultLanguage ?? languageChannelConfig.builtinLanguages[0];
    assert(legacyBuiltinLanguage, "runtime.defaultLanguage or runtime.builtinLanguages[0] must be set for legacy channelConfig");

    let patchInfo: IPatchInfo = {
        oldestVersion: rootManifestInfo.oldestVersion,
        currentVersion: rootManifestInfo.currentVersion,
        newAppDownloadUrl: newAppDownloadUrl,
        patchScript: patchScriptInfo,
        channelConfig: {
            builtinLanguage: legacyBuiltinLanguage,
            languages: languageChannelConfig.activeLanguages,
        },
        channels: {
            common: {
                patches: commonPatchArtifacts.patchInfos,
            },
            languages: languagePatchInfoRecord,
        },
        buildNumber: buildNumber,
        distro: distro,
    };
    let aggregateThinReport: IAggregateThinReport = {
        common: commonPatchArtifacts.thinReport,
        languages: {},
    };
    for (let [language, artifacts] of languagePatchArtifacts) {
        aggregateThinReport.languages[language] = artifacts.thinReport;
    }

    let patchPath = path.join(outputPath, "patch-info.json");
    writeJsonFile(patchPath, patchInfo);
    writeJsonFile(path.join(outputPath, thinReportFile), aggregateThinReport);

    console.log(`build patch success, output path: ${outputPath}`);
}

async function setBaseVersions(opts: any) {
    let manifestFile = opts.manifestFile;
    let baseVersions = opts.setBaseVersions ? (opts.setBaseVersions as string).split("|").map((v) => Number(v)) : undefined;

    let manifestInfo = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    manifestInfo.baseVersions = baseVersions;
    writeJsonFile(manifestFile, manifestInfo);
}

async function appendBaseVersion(opts: any) {
    let manifestFile = opts.manifestFile;
    let baseVersion = Number(opts.appendBaseVersion);

    let manifestInfo = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    if (manifestInfo.baseVersions.indexOf(baseVersion) < 0) {
        manifestInfo.baseVersions.push(baseVersion);
        manifestInfo.baseVersions.sort();
        writeJsonFile(manifestFile, manifestInfo);
    }
}

// ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
interface IMergeOpts {
    mergeFromSelfManifest: string;
    mergeFromSelfPatchInfo: string;
    mergeFromOtherManifest: string;
    mergeFromOtherPatchInfo: string;
    mergeToManifest?: string;
    mergeToPatchInfo?: string;
}

async function readMergeParams(opts: IMergeOpts) {
    assert(!opts.mergeFromSelfManifest || opts.mergeFromSelfManifest.length > 0, `--merge-from-self-manifest must be set`);
    assert(!opts.mergeFromSelfPatchInfo || opts.mergeFromSelfPatchInfo.length > 0, `--merge-from-self-patch-info must be set`);
    assert(!opts.mergeFromOtherManifest || opts.mergeFromOtherManifest.length > 0, `--merge-from-other-manifest must be set`);
    assert(!opts.mergeFromOtherPatchInfo || opts.mergeFromOtherPatchInfo.length > 0, `--merge-from-other-patch-info must be set`);

    let fromSelfManifest = opts.mergeFromSelfManifest?.length > 0 ? (JSON.parse(fs.readFileSync(opts.mergeFromSelfManifest, "utf-8")) as IManifestInfo) : undefined;
    let fromSelfPatchInfo = opts.mergeFromSelfPatchInfo?.length > 0 ? (JSON.parse(fs.readFileSync(opts.mergeFromSelfPatchInfo, "utf-8")) as IPatchInfo) : undefined;
    let fromOtherManifest = opts.mergeFromOtherManifest?.length > 0 ? (JSON.parse(fs.readFileSync(opts.mergeFromOtherManifest, "utf-8")) as IManifestInfo) : undefined;
    let fromOtherPatchInfo = opts.mergeFromOtherPatchInfo?.length > 0 ? (JSON.parse(fs.readFileSync(opts.mergeFromOtherPatchInfo, "utf-8")) as IPatchInfo) : undefined;

    return {
        fromSelfManifest,
        fromSelfPatchInfo,
        fromOtherManifest,
        fromOtherPatchInfo,
    };
}

async function merge(opts: IMergeOpts) {
    const toManifestFile: string = opts.mergeToManifest!;
    const toPatchInfoFile: string = opts.mergeToPatchInfo!;
    assert(toManifestFile && toManifestFile.length >= 0, `--merge-to-manifest must be set`);
    assert(toPatchInfoFile && toPatchInfoFile.length >= 0, `--merge-to-patch-info must be set`);

    let params = await readMergeParams(opts);

    if (params.fromSelfManifest) {
        // 有自己的manifest
        if (params.fromOtherManifest) {
            // 别人也有
            if (params.fromSelfManifest.oldestVersion > params.fromOtherManifest.oldestVersion || params.fromSelfManifest.currentVersion > params.fromOtherManifest.currentVersion) {
                // 自己强更版本或者自身版本号高，用自己的
                fs.copyFileSync(opts.mergeFromSelfManifest, toManifestFile);
                fs.copyFileSync(opts.mergeFromSelfPatchInfo, toPatchInfoFile);
            } else {
                // 否则用别人版本
                fs.copyFileSync(opts.mergeFromOtherManifest, toManifestFile);
                fs.copyFileSync(opts.mergeFromOtherPatchInfo, toPatchInfoFile);
            }
        } else {
            // 自己有，别人没有，用自己的
            fs.copyFileSync(opts.mergeFromSelfManifest, toManifestFile);
            fs.copyFileSync(opts.mergeFromSelfPatchInfo, toPatchInfoFile);
        }
    } else {
        if (params.fromOtherManifest) {
            // 自己没有，别人有, 用别人的
            fs.copyFileSync(opts.mergeFromOtherManifest, toManifestFile);
            fs.copyFileSync(opts.mergeFromOtherPatchInfo, toPatchInfoFile);
        } else {
            // 自己别人都没有，写个空出去
            fs.writeFileSync(toManifestFile, "{}", "utf-8");
            fs.writeFileSync(toPatchInfoFile, "{}", "utf-8");
        }
    }
}

async function mergeCheck(opts: IMergeOpts) {
    let params = await readMergeParams(opts);

    // 自己一定得有
    assert(params.fromSelfManifest, `--merge-from-self-manifest must be set`);
    assert(params.fromSelfPatchInfo, `--merge-from-self-patch-info must be set`);

    if (params.fromSelfPatchInfo) {
        console.log(`fromSelfPatchInfo: ${JSON.stringify(params.fromSelfPatchInfo, null, 4)}`);
    }
    if (params.fromOtherPatchInfo) {
        console.log(`fromOtherPatchInfo: ${JSON.stringify(params.fromOtherPatchInfo, null, 4)}`);
    }

    if (params.fromOtherManifest) {
        // 自己的版本号必须大于别人的
        assert(
            params.fromSelfManifest!.currentVersion > params.fromOtherManifest.currentVersion,
            `self version must be higher than other version, self: ${params.fromSelfManifest!.currentVersion}, other: ${params.fromOtherManifest.currentVersion}`,
        );
    }
    assert(
        params.fromSelfManifest.oldestVersion <= params.fromSelfManifest.currentVersion,
        `oldestVersion must not be greater than currentVersion, oldest: ${params.fromSelfManifest.oldestVersion}, current: ${params.fromSelfManifest.currentVersion}`,
    );
    assert(params.fromSelfPatchInfo.currentVersion === params.fromSelfManifest.currentVersion, "patch-info currentVersion must match manifest currentVersion");
    assert(params.fromSelfPatchInfo.oldestVersion === params.fromSelfManifest.oldestVersion, "patch-info oldestVersion must match manifest oldestVersion");

    // channels 结构校验：channels 架构下 patch-info 的有效性命门已从顶层 patches 迁到 channels，
    // common 渠道在 oldestVersion === currentVersion 时允许为空（生成器不会为单版本生成 patch）。
    // 其他情况下仍在 preview→prod 的 CI 守门拦截缺失/为空的 patch-info。
    let selfPatchInfo = params.fromSelfPatchInfo!;
    assert(selfPatchInfo.channels, "patch-info must contain channels");
    let commonPatches = selfPatchInfo.channels.common?.patches;
    assert(
        Array.isArray(commonPatches) && (commonPatches.length > 0 || selfPatchInfo.oldestVersion === selfPatchInfo.currentVersion),
        "channels.common.patches must be a non-empty array unless oldestVersion equals currentVersion",
    );
    for (let [language, channel] of Object.entries(selfPatchInfo.channels.languages ?? {})) {
        assert(Array.isArray(channel?.patches) && channel.patches.length > 0, `channels.languages.${language}.patches must be a non-empty array`);
    }
    if (selfPatchInfo.patchScript) {
        assert(typeof selfPatchInfo.patchScript.version === "number" && selfPatchInfo.patchScript.version > 0, "patchScript.version must be a positive number");
    }
}

function assert(condition: any, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}
