import { program } from "commander";
import { glob, globSync } from "glob";
import * as path from "path";
import * as fs from "fs-extra";
// import * as xlsx from "xlsx";
// import { parse } from "csv-parse";
import * as ExcelJS from "exceljs";
import chokidar from "chokidar";
import { fastHash } from "./fast-hash";

const papa = require("papaparse");
const clone = require("rfdc")();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PACKAGE_INFO = require("../package.json");
const INCREMENT_BUILD_INFO_NAME = "export-csv-increment-info.json";

// Debug helper: set ENABLE_DEBUG and point DEBUG_FILE at a local xlsx to force single-file conversion
let DEBUG_FILE = "";
let ENABLE_DEBUG = false;

export type Logger = (message: string) => void;
export const defaultLogger: Logger = (message: string) => console.log(message);

program
    .name(PACKAGE_INFO.name)
    .version(PACKAGE_INFO.version, "-v, --version", "output the current version")
    .requiredOption("--source-base-dir <path>", "source base directory")
    .requiredOption("--pattern <pattern>", "find pattern")
    .requiredOption("--target-base-dir <path>", "target base directory")
    .option("--ignore <pattern>", "ignore pattern")
    .option("--clear-target-files", "clear target files before copy")
    .option("--output-log", "output log")
    .option("--sheet-name", "sheet name")
    .option("--ignore-data-after-empty-line", "ignore data after empty line")
    .option("--increment-build <bool>", "increment build")
    .option("--replace-name-string <replace1:to1;replace2:to2;...>", "replace name string")
    .option("--increment-build-info-path <bool>", "increment build info path")
    .option("--watch", "watch mode")
    .option("--watch-worker-path <path>", "watch worker path")
    .parse();

async function verifySourceFileNeedExport(file: string, incrementBuildInfo: Map<string, string>) {
    let filePath = file.replaceAll("\\", "/");
    if (!fs.existsSync(filePath)) {
        incrementBuildInfo.delete(filePath);
        return true;
    }

    let hash = calculateSha256(await fs.readFile(filePath));
    let oldHash = incrementBuildInfo.get(filePath);
    if (oldHash != hash) {
        incrementBuildInfo.set(filePath, hash);
        return true;
    } else {
        return false;
    }
}

async function removeInvalidIncrementInfos(params: IConvertParams) {
    if (params.incrementBuild && params.incrementBuildInfoPath !== undefined) {
        let infos = await readIncrementBuildInfo(params.incrementBuildInfoPath);
        let changed = false;
        const log = params.logger ?? defaultLogger;
        for (const [filePath, _] of infos) {
            if (!fs.existsSync(filePath)) {
                let targetFile = await verifyTargetFile(params, filePath);
                if (fs.existsSync(targetFile)) {
                    fs.rmSync(targetFile);
                    if (params.outputLog) log(`delete ${targetFile}`);
                }
                infos.delete(filePath);
                changed = true;
            }
        }

        if (changed) await writeIncrementBuildInfo(params.incrementBuildInfoPath, infos);
    }
}

async function removeIncrementInfos(params: IConvertParams, files: Array<string>) {
    if (params.incrementBuild && params.incrementBuildInfoPath !== undefined) {
        let infos = await readIncrementBuildInfo(params.incrementBuildInfoPath);
        for (const file of files) {
            let filePath = file.replaceAll("\\", "/");
            infos.delete(filePath);
        }
        await writeIncrementBuildInfo(params.incrementBuildInfoPath, infos);
    }
}

async function readIncrementBuildInfo(targetBaseDir: string) {
    let ret = new Map<string, string>();
    let infoPath = path.join(targetBaseDir, INCREMENT_BUILD_INFO_NAME);

    if (await fs.exists(infoPath)) {
        let jsonObj = JSON.parse(await fs.readFile(infoPath, "utf-8"));
        for (const key in jsonObj) {
            if (jsonObj.hasOwnProperty(key)) {
                ret.set(key, jsonObj[key]);
            }
        }
    }
    return ret;
}

async function writeIncrementBuildInfo(targetDir: string, info: Map<string, string>) {
    let infoPath = path.join(targetDir, INCREMENT_BUILD_INFO_NAME);

    const jsonObject = {} as any;
    info.forEach((value, key) => {
        jsonObject[key] = value;
    });
    await fs.writeFile(infoPath, JSON.stringify(jsonObject), "utf-8");
}

export interface IConvertParams {
    sourceBaseDir: string;
    targetBaseDir: string;
    sourceFiles: string[];
    clearTargetFiles?: boolean;
    incrementBuild?: boolean;
    incrementBuildInfoPath?: string;
    replaceNameString: string[];
    outputLog?: boolean;
    needIgnoreDataAfterEmptyLine?: boolean;
    sheetName?: string;
    ignore?: string[];
    watchWorkerPath?: string;
    /** Optional logger callback. Defaults to console.log when outputLog is true. */
    logger?: Logger;
    /** Concurrency limit for p-limit. Defaults to 4. */
    concurrency?: number;
}

async function verifyTargetFile(params: IConvertParams, sourceFile: string) {
    let relativeDir = path.relative(params.sourceBaseDir, path.dirname(sourceFile));
    let targetFileDir = path.join(params.targetBaseDir, relativeDir);
    let targetFile = path.join(targetFileDir, path.basename(sourceFile, ".xlsx") + ".csv");
    if (params.replaceNameString.length > 0) {
        for (let r of params.replaceNameString) {
            targetFile = targetFile.replaceAll(r[0], r[1]);
        }
    }
    await fs.ensureDir(targetFileDir);
    return targetFile;
}

export async function convertExcelToCsv(params: IConvertParams) {
    if (params.clearTargetFiles) {
        const log = params.logger ?? defaultLogger;
        log("clear target files");
        const rimraf = require("rimraf");
        rimraf.sync(params.targetBaseDir);
    }

    let incrementBuildInfo = params.incrementBuild && params.incrementBuildInfoPath !== undefined ? await readIncrementBuildInfo(params.incrementBuildInfoPath) : new Map<string, string>();

    const pLimit = require('p-limit');
    const concurrency = params.concurrency ?? 4;
    const limit = pLimit(concurrency);
    const log = params.logger ?? defaultLogger;

    await Promise.all(params.sourceFiles.map(sourceFile => limit(async () => {
        if (path.basename(sourceFile).startsWith("~$")) return;
        if (ENABLE_DEBUG) sourceFile = DEBUG_FILE;
        if (!(await verifySourceFileNeedExport(sourceFile, incrementBuildInfo))) return;

        let targetFile = await verifyTargetFile(params, sourceFile);
        if (!fs.existsSync(sourceFile)) {
            // 删除旧的csv
            if (fs.existsSync(targetFile)) {
                fs.rmSync(targetFile);
                if (params.outputLog) log(`delete ${targetFile}`);
            }
            return;
        }

        if (params.outputLog) log(`convert ${sourceFile} to ${targetFile}`);

        // var workbook = xlsx.readFile(sourceFile, {
        //     // bookDeps: true,
        //     sheets: sheetName ?? 0,
        // });
        // let worksheet = sheetName ? workbook.Sheets[sheetName] : workbook.Sheets[workbook.SheetNames[0]];
        // let csvData = xlsx.utils.sheet_to_csv(worksheet);

        let processValue = (value: any) => {
            if (value) {
                if (value.text || value.hyperlink) {
                    return value.hyperlink || value.text || "";
                }
                if (value.formula || value.result) {
                    return value.result || "";
                }
                // if (value instanceof Date) {
                //     if (dateFormat) {
                //         return dateUTC ? dayjs.utc(value).format(dateFormat) : dayjs(value).format(dateFormat);
                //     }
                //     return dateUTC ? dayjs.utc(value).format() : dayjs(value).format();
                // }
                if (value.error) {
                    return value.error;
                }
                if (typeof value === "object") {
                    let json = JSON.stringify(value);
                    let text = "";
                    for (let key in value) {
                        let o = value[key];
                        if (Array.isArray(o)) {
                            for (let i = 0; i < o.length; i++) {
                                if (o[i] && o[i].hasOwnProperty("text")) text += o[i].text;
                            }
                        } else {
                            if (o && o.hasOwnProperty("text")) {
                                text += o.text;
                            }
                        }
                    }
                    return text.length > 0 ? text : json;
                }
            }
            return value;
        };

        const workbook = new ExcelJS.Workbook();
        const fileBuffer = await fs.readFile(sourceFile);
        await workbook.xlsx.load(fileBuffer as any);
        // 由于 ExcelJS 底层依赖的解压流库（如 unzipper）在处理某些异常中断时存在缺陷,处理流中断了却没有触发 reject()。
        // 这就导致 await 永远等不到结果，Node.js 发现处理流没了、又没有其他任务，就会直接以状态码 0 静默退出
        // await workbook.xlsx.readFile(sourceFile); 

        if (params.needIgnoreDataAfterEmptyLine) {
            let worksheet = params.sheetName ? workbook.getWorksheet(params.sheetName)! : workbook.worksheets[0];
            let validRowCount = 0;
            let lastRow = -1;
            let skipRow = false;
            worksheet.eachRow((row, rowNumber) => {
                if (lastRow >= 0 && lastRow + 1 !== rowNumber && !skipRow) skipRow = true;

                if (!skipRow) {
                    lastRow = rowNumber;
                    ++validRowCount;
                }
            });

            // api有bug，spliceRows会导致行数不对，所以只能一个一个来
            while (skipRow && worksheet.rowCount > validRowCount) worksheet.spliceRows(worksheet.rowCount, 1);
        }

        let buffer = await workbook.csv.writeBuffer({
            encoding: "utf-8",
            sheetName: params.sheetName,
            sheetId: 1,
            map: (value) => {
                let v = processValue(value);
                return v;
            },
        });
        let csvData = buffer.toString();
        await fs.writeFile(targetFile, csvData, "utf-8");
    })));

    if (params.incrementBuildInfoPath && incrementBuildInfo) await writeIncrementBuildInfo(params.incrementBuildInfoPath, incrementBuildInfo);
}

async function wait(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

async function watch(pattern: string[], params: IConvertParams) {
    const workerName = "convert-csv";
    const lockFile = path.join(params.watchWorkerPath ?? params.targetBaseDir, `${workerName}.lock`);
    const workerFile = path.join(params.watchWorkerPath ?? params.targetBaseDir, `${workerName}.worker`);
    const fileContent = Date.now().toString();
    const log = params.logger ?? defaultLogger;

    params.clearTargetFiles = false;
    params.incrementBuild = true;

    const tryRmFile = (filePath: string) => {
        if (fs.existsSync(filePath) && fs.readFileSync(workerFile, "utf-8") === fileContent) fs.rmSync(filePath);
    };

    try {
        const watcher = chokidar.watch(params.sourceBaseDir, {
            persistent: true,
            atomic: true,
            awaitWriteFinish: true,
            ignoreInitial: true,
            interval: 100,
            binaryInterval: 100,
            ignored: (file, status) => {
                return file.startsWith("~$") || (status !== undefined && status.isFile() && !file.endsWith(".xlsx"));
            },
        });

        let changedFiles = new Map<string, boolean>();
        let onFileChanged = async (file: string, remove: boolean) => {
            let filePath = file.replaceAll("\\", "/");
            changedFiles.set(filePath, remove);
        };

        // 第一次手动来，防止分多帧触发
        let files = globSync(pattern, { cwd: path.resolve(params.sourceBaseDir).replaceAll("\\", "/"), nodir: true }).filter((f) => !f.startsWith("~$"));
        for (let file of files) {
            onFileChanged(file, false);
        }

        watcher
            .on("add", (file) => onFileChanged(file, false))
            .on("change", (file) => onFileChanged(file, false))
            .on("unlink", (file) => onFileChanged(file, true))
            .on("error", (error) => console.warn(`csv watcher error: ${error}`));

        if (fs.existsSync(workerFile)) {
            // 如果已有lock文件，说明有可能有别的进程在，这里直接删掉
            fs.rmSync(workerFile);
        }

        // 保持进程运行
        log("csv watching...");
        fs.ensureDirSync(path.dirname(lockFile));
        fs.writeFileSync(lockFile, fileContent, "utf-8");
        fs.writeFileSync(workerFile, fileContent, "utf-8");

        log(`csv watcher start ${lockFile}, ${workerFile}`);

        while (fs.existsSync(workerFile) && fs.readFileSync(workerFile, "utf-8") === fileContent) {
            await wait(100);

            if (changedFiles.size > 0) {
                await removeInvalidIncrementInfos(params);

                fs.writeFileSync(lockFile, fileContent, "utf-8");

                let newParams = clone(params);
                let sourceFiles = new Set();
                let deletedFiles = new Array<string>();
                for (const [changedFile, removed] of changedFiles) {
                    if (removed) {
                        deletedFiles.push(changedFile);
                        let targetFile = await verifyTargetFile(params, changedFile);
                        if (fs.existsSync(targetFile)) {
                            fs.rmSync(targetFile);
                            if (params.outputLog) log(`delete ${targetFile}`);
                        }
                    } else {
                        sourceFiles.add(changedFile);
                    }
                }

                changedFiles.clear();
                if (deletedFiles.length > 0) {
                    await removeIncrementInfos(params, deletedFiles);
                }
                if (sourceFiles.size > 0) {
                    try {
                        newParams.sourceFiles = Array.from(sourceFiles);
                        await convertExcelToCsv(newParams);
                    } catch (error: any) {
                        console.error(`csv watcher error: ${error}, stack: ${error.stack}`);
                    }
                }

                log("convert csv finished, waiting for next change...");
            }

            tryRmFile(lockFile);
        }

        log("csv watcher exit");
        watcher.close();
    } catch (error) {
        console.error(`csv watcher error: ${error}`);
    } finally {
        log("csv watcher exit");
        tryRmFile(lockFile);
        tryRmFile(workerFile);
    }
}

async function convert(opts: any) {
    const sourceBaseDir = path.resolve(opts.sourceBaseDir).replaceAll("\\", "/");
    let pattern = (opts.pattern.split(",") ?? []) as Array<string>;
    pattern = pattern.map((p) => path.join(sourceBaseDir, p).replaceAll("\\", "/"));
    const targetBaseDir = opts.targetBaseDir;
    let ignore = (opts.ignore?.split(",") ?? []) as Array<string>;
    ignore = ignore.map((p: any) => path.join(sourceBaseDir, p).replaceAll("\\", "/"));
    const outputLog = opts.outputLog;
    const sheetName = opts.sheetName;
    const needIgnoreDataAfterEmptyLine = opts.ignoreDataAfterEmptyLine;
    const incrementBuild = opts.incrementBuild === "true";
    const incrementBuildInfoPath = opts.incrementBuildInfoPath ?? (incrementBuild ? targetBaseDir : undefined);
    const clearTargetFiles = opts.clearTargetFiles || !incrementBuild;
    let replaceNameString = (opts.replaceNameString?.split(";") as string[]) ?? [];
    replaceNameString = replaceNameString.map((p: any) => p.split(":"));
    const watchMode = opts.watch;
    const watchWorkerPath = opts.watchWorkerPath;

    let sourceFiles = [] as string[];
    let params: IConvertParams = {
        sourceBaseDir,
        targetBaseDir,
        sourceFiles,
        clearTargetFiles,
        incrementBuild,
        incrementBuildInfoPath,
        replaceNameString,
        outputLog,
        sheetName,
        needIgnoreDataAfterEmptyLine,
        ignore,
        watchWorkerPath,
    };

    if (watchMode) {
        await watch(pattern, params);
    } else {
        params.sourceFiles = await glob(pattern, {
            nodir: true,
            ignore: ignore,
        });

        let startTime = Date.now();
        await convertExcelToCsv(params);
        console.log(`convert excel to csv used ${(Date.now() - startTime) / 1000} seconds`);
    }
}

if (require.main === module) {
    convert(program.opts())
        .then(() => {
            console.log("convert excel to csv finished");
        })
        .catch((err) => {
            console.error(err);
        });
}

function calculateSha256(data: Buffer) {
    return fastHash(data);
}
