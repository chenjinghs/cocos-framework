import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as nodeFS from "node:fs";
import * as nodePath from "node:path";
import { test } from "node:test";
import type { IEngine, IFS, IPatchApplyResult } from "../src/Define";
import type { IFileInfo, IManifestInfo } from "patch-common";
import { setFS, setKeyValueStorage, setPath, setSystemLanguageProvider } from "../src/Util";

// 用真实文件和"Move 不覆盖"语义执行生产 Patcher，替换的只有引擎桥接（经 setFS/setPath 注入）。
let observeIO: ((operation: string, source: string, target?: string) => void) | undefined;
let beforeIO: typeof observeIO;
const io = (operation: string, source: string, target: string | undefined, action: () => void) => {
    beforeIO?.(operation, source, target);
    action();
    observeIO?.(operation, source, target);
};

const exists = (path: string, directory: boolean) => nodeFS.existsSync(path) && nodeFS.statSync(path).isDirectory() === directory;

function topFilesInDirectory(dirPath: string): string[] {
    if (!exists(dirPath, true)) return [];
    return nodeFS.readdirSync(dirPath).map((name) => nodePath.join(dirPath, name));
}

function allFilesInDirectory(dirPath: string): string[] {
    let ret: string[] = [];
    for (let file of topFilesInDirectory(dirPath)) {
        if (exists(file, true)) ret.push(...allFilesInDirectory(file));
        else ret.push(file);
    }
    return ret;
}

setFS({
    readFileTextSync: (filePath) => nodeFS.readFileSync(filePath, "utf8"),
    readFileBufferSync: (filePath) => nodeFS.readFileSync(filePath),
    mkdirSync: (dirPath) => {
        nodeFS.mkdirSync(dirPath, { recursive: true });
    },
    copyFileSync: (source, target) => {
        assert.equal(nodePath.basename(source), "patcher.js", "整理阶段不应复制资源内容");
        nodeFS.copyFileSync(source, target);
    },
    moveFileSync: (source, target) => {
        io("move", source, target, () => {
            assert.equal(nodeFS.existsSync(target), false, `move target already exists: ${target}`);
            nodeFS.renameSync(source, target);
        });
    },
    replaceFileSync: (source, target) => {
        assert(nodeFS.existsSync(source), `replaceFileSync source not exists: ${source}`);
        // 三步原子替换：先备份目标，再移动源，最后删除备份
        let backupPath = target + ".bak";
        if (nodeFS.existsSync(backupPath))
            io("delete", backupPath, undefined, () => {
                nodeFS.rmSync(backupPath, { force: true });
            });
        if (nodeFS.existsSync(target)) io("move", target, backupPath, () => nodeFS.renameSync(target, backupPath));
        io("move", source, target, () => nodeFS.renameSync(source, target));
        if (nodeFS.existsSync(backupPath))
            io("delete", backupPath, undefined, () => {
                nodeFS.rmSync(backupPath, { force: true });
            });
    },
    rmSync: (path) =>
        io("delete", path, undefined, () => {
            nodeFS.rmSync(path, { force: true, recursive: true });
        }),
    rmAsync: async (path) =>
        io("delete", path, undefined, () => {
            nodeFS.rmSync(path, { force: true, recursive: true });
        }),
    existsSync: (path) => nodeFS.existsSync(path),
    writeTextFileSync: (filePath, data) =>
        io("write", filePath, undefined, () => {
            nodeFS.writeFileSync(filePath, data);
        }),
    getTopFilesInDirectory: topFilesInDirectory,
    getAllFilesInDirectory: allFilesInDirectory,
} satisfies IFS);
setPath(nodePath);
setKeyValueStorage({ getString: (_key, fallback) => fallback });
setSystemLanguageProvider(() => "ChineseSimplified");

const patcher = import("../src/Patcher");
const tmpRoot = nodePath.resolve(__dirname, "../../../../../.codex/tmp");
type Snapshot = Map<string, Buffer>;

class Fixture {
    readonly root: string;
    readonly applyPath: string;
    readonly downloadPath: string;
    readonly manifestPath: string;
    readonly infos: IFileInfo[] = [];
    readonly expected = new Map<string, Buffer>();
    readonly progress: number[] = [];
    readonly errors: string[] = [];
    readonly applied: (IPatchApplyResult | undefined)[] = [];

    constructor(count = 3) {
        nodeFS.mkdirSync(tmpRoot, { recursive: true });
        this.root = nodeFS.mkdtempSync(nodePath.join(tmpRoot, "patcher-organize-"));
        this.applyPath = nodePath.join(this.root, "data");
        this.downloadPath = nodePath.join(this.root, "download");
        this.manifestPath = nodePath.join(this.applyPath, "manifest.json");
        for (let i = 0; i < count; i++) {
            const relative = `packages/group-${i % 3}/bundle-${i}`;
            const body = Buffer.from(`new resource ${i}`);
            const redirect = nodePath.join(this.downloadPath, "2/common", relative);
            this.write(redirect, body);
            this.write(nodePath.join(this.applyPath, relative), Buffer.from(`old resource ${i}`));
            this.expected.set(relative, body);
            this.infos.push({ path: relative, version: 2, appliedVersion: 2, redirect, size: body.length, sha256: createHash("sha256").update(body).digest("hex") });
        }
        this.saveManifest();
    }

    write(path: string, body: Buffer | string) {
        nodeFS.mkdirSync(nodePath.dirname(path), { recursive: true });
        nodeFS.writeFileSync(path, body);
    }

    saveManifest() {
        this.write(this.manifestPath, JSON.stringify({ currentVersion: 2, files: this.infos } satisfies IManifestInfo));
    }

    engine(overrides: Partial<IEngine> = {}): IEngine {
        return {
            entryUrl: "https://patch.invalid",
            downloadPath: this.downloadPath,
            applyPath: this.applyPath,
            apply: true,
            localResVersion: 1,
            maxRetryCount: 2,
            retryIntervalMS: 1,
            branchVersion: 1,
            onApplyCurrentManifest: (result) => {
                this.applied.push(result);
            },
            onResetToBuiltinResources: () => {},
            onCheckNetwork: async () => false,
            onTrackPoint: () => {},
            onDownloadProgressChanged: () => {},
            onOrganizeProgressChanged: (current) => {
                this.progress.push(current);
            },
            onComplete: () => {},
            onError: async (tag, message) => {
                this.errors.push(`${tag}: ${message}`);
            },
            onNewAppNeedDownload: async () => {},
            onRestartPatcher: () => {},
            onPatchCanDownload: async () => true,
            onUnzipFile: async () => {},
            onFetchRemoteText: async () => {
                throw new Error("unexpected network request");
            },
            onDownloadFile: async () => {
                throw new Error("unexpected download");
            },
            getOSType: () => "android",
            getDistroName: () => "",
            getRegion: () => "cn",
            setPreRelease: () => {},
            setIsReviewMode: () => {},
            onFetchNewPatchInfoResult: () => {},
            setNewEntryUrl: () => {},
            setPatchInfo: () => {},
            ...overrides,
        };
    }

    async run(overrides: Partial<IEngine> = {}) {
        const { startPatcher } = await patcher;
        await startPatcher(this.engine(overrides));
    }

    assertApplied() {
        assert.deepEqual(this.errors, []);
        assert.ok(this.applied.at(-1));
        const manifest: IManifestInfo = JSON.parse(nodeFS.readFileSync(this.manifestPath, "utf8"));
        assert.equal(manifest.currentVersion, 2);
        for (const [relative, body] of this.expected) {
            assert.deepEqual(nodeFS.readFileSync(nodePath.join(this.applyPath, relative)), body);
            assert.equal(manifest.files.find((info) => info.path === relative)?.redirect, undefined);
        }
    }

    snapshot(): Snapshot {
        const result: Snapshot = new Map();
        const walk = (dir: string) => {
            for (const item of nodeFS.readdirSync(dir, { withFileTypes: true })) {
                const path = nodePath.join(dir, item.name);
                if (item.isDirectory()) walk(path);
                else result.set(nodePath.relative(this.root, path), nodeFS.readFileSync(path));
            }
        };
        walk(this.root);
        return result;
    }

    restore(snapshot: Snapshot) {
        this.remove();
        for (const [relative, body] of snapshot) this.write(nodePath.join(this.root, relative), body);
        this.progress.length = 0;
        this.errors.length = 0;
        this.applied.length = 0;
    }

    remove() {
        // 只清理本测试在工作区 tmp 下创建的唯一目录。
        assert.equal(nodePath.dirname(this.root), tmpRoot);
        assert.ok(nodePath.basename(this.root).startsWith("patcher-organize-"));
        nodeFS.rmSync(this.root, { recursive: true, force: true });
    }
}

async function withFixture(action: (fixture: Fixture) => Promise<void>, count = 3) {
    const fixture = new Fixture(count);
    try {
        await action(fixture);
    } finally {
        observeIO = undefined;
        beforeIO = undefined;
        fixture.remove();
    }
}

test("批量移动真实文件，主线程定时器持续运行，进度按文件数单调增加", async () => {
    await withFixture(async (f) => {
        let ticks = 0;
        let ticksAtFirstMove = -1;
        let ticksAtLastMove = -1;
        const timer = setInterval(() => {
            ticks++;
        }, 0);
        observeIO = (operation, source) => {
            if (operation === "move" && source.startsWith(f.downloadPath)) {
                if (ticksAtFirstMove < 0) ticksAtFirstMove = ticks;
                ticksAtLastMove = ticks;
            }
        };
        try {
            await f.run();
        } finally {
            clearInterval(timer);
        }
        f.assertApplied();
        assert.ok(ticksAtLastMove > ticksAtFirstMove, "文件处理期间必须主动让出事件循环");
        assert.equal(f.progress[0], 0);
        assert.equal(f.progress.at(-1), 256);
        assert.ok(f.progress.some((value) => value > 0 && value < 256));
        assert.ok(f.progress.every((value, index) => index === 0 || value >= f.progress[index - 1]));
        assert.equal(nodeFS.existsSync(f.downloadPath), false);
    }, 256);
});

test("每次移动、备份替换、manifest 写入之后退出，重启仍能恢复完整资源", async () => {
    await withFixture(async (f) => {
        const snapshots: Snapshot[] = [];
        observeIO = () => {
            snapshots.push(f.snapshot());
        };
        await f.run();
        observeIO = undefined;
        assert.ok(snapshots.length > 12);
        for (const snapshot of snapshots) {
            f.restore(snapshot);
            await f.run();
            f.assertApplied();
        }
    });
});

test("替换失败保留唯一的 .patching 文件，下一次启动可恢复", async () => {
    await withFixture(async (f) => {
        const target = nodePath.join(f.applyPath, f.infos[0].path);
        beforeIO = (operation, source) => {
            if (operation === "move" && source === `${target}.patching`) throw new Error("simulated file lock");
        };
        await f.run({ maxRetryCount: 1 });
        assert.equal(f.errors.length, 1);
        assert.equal(nodeFS.existsSync(f.infos[0].redirect!), false);
        assert.equal(nodeFS.existsSync(`${target}.patching`), true);
        beforeIO = undefined;
        f.errors.length = 0;
        await f.run();
        f.assertApplied();
    });
});

test("本轮重试跳过已完成的文件，并恢复尚未完成的替换", async () => {
    await withFixture(async (f) => {
        const target = nodePath.join(f.applyPath, f.infos[1].path);
        let failures = 0;
        beforeIO = (operation, source) => {
            if (operation === "move" && source === `${target}.patching` && failures++ === 0) throw new Error("transient file lock");
        };
        await f.run();
        f.assertApplied();
    });
});

test("损坏的暂存文件不能作为成功更新，原下载文件仍在时可重新暂存", async () => {
    await withFixture(async (f) => {
        f.write(nodePath.join(f.applyPath, `${f.infos[0].path}.patching`), "corrupt staged file");
        await f.run();
        f.assertApplied();
    });
    await withFixture(async (f) => {
        nodeFS.unlinkSync(f.infos[0].redirect!);
        f.write(nodePath.join(f.applyPath, `${f.infos[0].path}.patching`), "corrupt staged file");
        await f.run();
        // missing-source 会退回包内挂载，磁盘事务保留等待重新下载。
        assert.equal(f.applied.at(-1)?.files.size, 0);
        assert.notEqual(nodeFS.readFileSync(nodePath.join(f.applyPath, f.infos[0].path), "utf8"), f.expected.get(f.infos[0].path)?.toString());
    });
});

test("最终 manifest 写入失败时保留 pending，重启验证已移动文件后提交", async () => {
    await withFixture(async (f) => {
        let writes = 0;
        beforeIO = (operation, path) => {
            if (operation === "write" && path === `${f.manifestPath}.tmp` && ++writes === 2) throw new Error("simulated disk error");
        };
        await f.run();
        assert.equal(f.errors.length, 1);
        const pending: IManifestInfo = JSON.parse(nodeFS.readFileSync(f.manifestPath, "utf8"));
        assert.ok(pending.files.every((info) => info.redirect));
        beforeIO = undefined;
        f.errors.length = 0;
        await f.run();
        f.assertApplied();
    });
});

test("不需要移动文件时不显示虚假的整理进度", async () => {
    await withFixture(async (f) => {
        await f.run();
        assert.deepEqual(f.progress, []);
        f.assertApplied();
    }, 0);
});

test("新文件及删除标记沿用原 manifest 语义", async () => {
    await withFixture(async (f) => {
        nodeFS.unlinkSync(nodePath.join(f.applyPath, f.infos[0].path));
        f.infos.push({ path: "packages/removed", version: 0, size: 0, sha256: "", redirect: nodePath.join(f.downloadPath, "absent") });
        f.saveManifest();
        await f.run();
        f.assertApplied();
        const manifest: IManifestInfo = JSON.parse(nodeFS.readFileSync(f.manifestPath, "utf8"));
        assert.equal(manifest.files.at(-1)?.version, 0);
        assert.equal(manifest.files.at(-1)?.redirect, undefined);
        assert.equal(f.progress.at(-1), 3);
    });
});

test("common 和语言包依次下载整理，全部完成后才提交 PatchFinish", async () => {
    await withFixture(async (f) => {
        const { startPatcher } = await patcher;
        const { EGameLanguage } = await import("patch-common");
        const { ETrackingPoint } = await import("../src/Define");
        f.write(f.manifestPath, JSON.stringify({ currentVersion: 1, files: [] }));
        const downloads: string[] = [];
        let finishVersion = 0;
        await startPatcher(
            f.engine({
                localCheckMode: true,
                onCheckNetwork: async () => true,
                onFetchRemoteText: async () =>
                    JSON.stringify({
                        oldestVersion: 1,
                        currentVersion: 2,
                        channels: {
                            common: { patches: [{ path: "https://patch.invalid/common.zip", version: 1, size: 1, sha256: "" }] },
                            languages: { RU_RU: { patches: [{ path: "https://patch.invalid/ru.zip", version: 1, size: 1, sha256: "" }] } },
                        },
                    }),
                onDownloadFile: async (url, target) => {
                    downloads.push(url);
                    f.write(target, "zip fixture");
                },
                onUnzipFile: async (zip, target) => {
                    const files = zip.endsWith("common.zip") ? f.infos.slice(0, 2) : f.infos.slice(2);
                    for (const info of files) f.write(nodePath.join(target, info.path), f.expected.get(info.path)!);
                    f.write(nodePath.join(target, "file-list.json"), JSON.stringify(files.map(({ redirect: _redirect, ...info }) => info)));
                },
                onComplete: (result, reason, version) => {
                    assert.equal(reason, ETrackingPoint.PatchFinish);
                    f.applied.push(result);
                    finishVersion = version;
                },
            }),
            [EGameLanguage.RU_RU],
            EGameLanguage.RU_RU,
        );
        f.assertApplied();
        assert.equal(finishVersion, 2);
        assert.equal(downloads.length, 2);
        const manifest: IManifestInfo = JSON.parse(nodeFS.readFileSync(f.manifestPath, "utf8"));
        assert.equal(manifest.languageVersions?.RU_RU, 2);
        assert.deepEqual(manifest.appliedVersions, [2]);
        assert.deepEqual(manifest.appliedLanguageVersions?.RU_RU, [2]);
    });
});

for (const invalidChannels of [false, true]) {
    test(`资源版本已最新时仍能自更新脚本，旧协议=${invalidChannels}`, async () => {
        await withFixture(async (f) => {
            f.write(f.manifestPath, JSON.stringify({ currentVersion: 2, files: [] }));
            const body = Buffer.from("new patcher");
            let restarted = false;
            await f.run({
                localCheckMode: true,
                onCheckNetwork: async () => true,
                onFetchRemoteText: async () =>
                    JSON.stringify({
                        oldestVersion: 1,
                        currentVersion: 2,
                        patchScript: { path: "https://patch.invalid/patcher.js", version: 3, size: body.length, sha256: createHash("sha256").update(body).digest("hex") },
                        ...(invalidChannels ? { patches: null } : { channels: { common: { patches: [] }, languages: {} } }),
                    }),
                onDownloadFile: async (_url, target) => {
                    f.write(target, body);
                },
                onRestartPatcher: (path) => {
                    assert.deepEqual(nodeFS.readFileSync(path), body);
                    restarted = true;
                },
            });
            assert.equal(restarted, true);
            assert.deepEqual(f.errors, []);
        }, 0);
    });
}

test("下载截断即使持续上报进度也只有限重试，不安装坏脚本", async () => {
    await withFixture(async (f) => {
        f.write(f.manifestPath, JSON.stringify({ currentVersion: 2, files: [] }));
        let attempts = 0;
        let restarted = false;
        const body = Buffer.from("complete patcher");
        await f.run({
            localCheckMode: true,
            onCheckNetwork: async () => true,
            onFetchRemoteText: async () =>
                JSON.stringify({
                    oldestVersion: 1,
                    currentVersion: 3,
                    patchScript: { path: "https://patch.invalid/patcher.js", version: 3, size: body.length, sha256: createHash("sha256").update(body).digest("hex") },
                }),
            onDownloadFile: async (_url, target, progress) => {
                attempts++;
                await progress?.(1n, 1n);
                f.write(target, body.subarray(0, 4));
            },
            onRestartPatcher: () => {
                restarted = true;
            },
        });
        assert.equal(attempts, 2);
        assert.equal(restarted, false);
        assert.ok(f.errors.some((error) => error.includes("hash mismatch")));
        assert.equal(nodeFS.existsSync(nodePath.join(f.applyPath, "patcher.js")), false);
        const manifest: IManifestInfo = JSON.parse(nodeFS.readFileSync(f.manifestPath, "utf8"));
        assert.equal(
            manifest.files.some((info) => info.path === "patcher.js"),
            false,
        );
    }, 0);
});

for (const source of ["download", "staged", "missing"] as const) {
    test(`坏脚本恢复撤销待安装记录并重新下载，来源=${source}`, async () => {
        await withFixture(async (f) => {
            const body = Buffer.from("complete new patcher");
            const oldBody = Buffer.from("usable old patcher");
            const target = nodePath.join(f.applyPath, "patcher.js");
            const redirect = nodePath.join(f.downloadPath, "patcher.js");
            const info: IFileInfo = { path: "patcher.js", version: 3, size: body.length, sha256: createHash("sha256").update(body).digest("hex"), redirect };
            f.infos.push(info);
            f.saveManifest();
            f.write(target, oldBody);
            if (source !== "missing") f.write(source === "download" ? redirect : `${target}.patching`, "truncated");
            let restarts = 0;
            // 离线恢复也必须落盘撤销坏记录，同时保持原有资源版本和正式脚本。
            await f.run({
                onRestartPatcher: () => {
                    restarts++;
                },
            });
            assert.equal(restarts, 0);
            assert.deepEqual(nodeFS.readFileSync(target), oldBody);
            const recovered: IManifestInfo = JSON.parse(nodeFS.readFileSync(f.manifestPath, "utf8"));
            assert.equal(recovered.currentVersion, 2);
            assert.equal(
                recovered.files.some((file) => file.path === "patcher.js"),
                false,
            );
            for (const [relative, content] of f.expected) {
                assert.deepEqual(nodeFS.readFileSync(nodePath.join(f.applyPath, relative)), content);
            }
            let downloads = 0;
            await f.run({
                localCheckMode: true,
                onCheckNetwork: async () => true,
                onFetchRemoteText: async () =>
                    JSON.stringify({ oldestVersion: 1, currentVersion: 2, patchScript: { ...info, path: "https://patch.invalid/patcher.js" }, channels: { common: { patches: [] }, languages: {} } }),
                onDownloadFile: async (_url, path) => {
                    downloads++;
                    f.write(path, body);
                },
                onRestartPatcher: (path) => {
                    restarts++;
                    assert.deepEqual(nodeFS.readFileSync(path), body);
                },
            });
            assert.equal(downloads, 1);
            assert.equal(restarts, 1);
            assert.deepEqual(f.errors, []);
        });
    });
}

for (const source of ["download", "staged", "applied"] as const) {
    test(`完整待安装脚本仍可恢复，来源=${source}`, async () => {
        await withFixture(async (f) => {
            const body = Buffer.from("valid pending patcher");
            const target = nodePath.join(f.applyPath, "patcher.js");
            const redirect = nodePath.join(f.downloadPath, "patcher.js");
            f.infos.push({ path: "patcher.js", version: 3, size: body.length, sha256: createHash("sha256").update(body).digest("hex"), redirect });
            f.saveManifest();
            f.write(source === "download" ? redirect : source === "staged" ? `${target}.patching` : target, body);
            let restarts = 0;
            await f.run({
                onRestartPatcher: (path) => {
                    restarts++;
                    assert.deepEqual(nodeFS.readFileSync(path), body);
                },
            });
            assert.equal(restarts, 1);
            assert.deepEqual(f.errors, []);
        }, 0);
    });
}

test("补齐包内语言版本后中断，磁盘仍允许旧脚本自更新，完成资源后保留脚本记录", async () => {
    await withFixture(async (f) => {
        const { startPatcher } = await patcher;
        const { EGameLanguage } = await import("patch-common");
        const body = Buffer.from("installed new patcher");
        const scriptInfo: IFileInfo = { path: "patcher.js", version: 2, size: body.length, sha256: createHash("sha256").update(body).digest("hex") };
        f.write(nodePath.join(f.applyPath, scriptInfo.path), body);
        f.write(f.manifestPath, JSON.stringify({ currentVersion: 1, files: [scriptInfo] }));
        const remote = {
            oldestVersion: 1,
            currentVersion: 2,
            patchScript: { ...scriptInfo, path: "https://patch.invalid/patcher.js" },
            channels: { common: { patches: [{ path: "https://patch.invalid/common.zip", version: 1, size: 1, sha256: "" }] }, languages: {} },
        };
        let downloadAttempts = 0;
        const engine = f.engine({
            localCheckMode: true,
            onCheckNetwork: async () => true,
            maxRetryCount: 1,
            onFetchRemoteText: async () => JSON.stringify(remote),
            onDownloadFile: async () => {
                downloadAttempts++;
                throw new Error("simulated interruption before resource download");
            },
        });
        await startPatcher(engine, [EGameLanguage.RU_RU], EGameLanguage.RU_RU);
        assert.equal(downloadAttempts, 1);
        const interrupted: IManifestInfo = JSON.parse(nodeFS.readFileSync(f.manifestPath, "utf8"));
        assert.equal(interrupted.currentVersion, 1);
        assert.equal(interrupted.languageVersions?.RU_RU, 1);
        // 旧包按 manifest 中的脚本版本决定是否自更新；不能再次把 2 写回而跳过更新。
        assert.equal(interrupted.files.find((info) => info.path === "patcher.js")?.version ?? engine.localResVersion, 1);
        assert.deepEqual(nodeFS.readFileSync(nodePath.join(f.applyPath, scriptInfo.path)), body);

        f.errors.length = 0;
        await startPatcher(
            {
                ...engine,
                onDownloadFile: async (_url, target) => {
                    f.write(target, "zip fixture");
                },
                onUnzipFile: async (_zip, target) => {
                    f.write(nodePath.join(target, "file-list.json"), "[]");
                },
            },
            [EGameLanguage.RU_RU],
            EGameLanguage.RU_RU,
        );
        assert.deepEqual(f.errors, []);
        const completed: IManifestInfo = JSON.parse(nodeFS.readFileSync(f.manifestPath, "utf8"));
        assert.equal(completed.currentVersion, 2);
        assert.equal(completed.files.find((info) => info.path === "patcher.js")?.version, 2);
    }, 0);
});
