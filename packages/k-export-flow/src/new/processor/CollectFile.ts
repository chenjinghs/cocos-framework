import * as path from "path";

import { FilePathData } from "../data";
import { assertWithLoc, createRegExpFromString, getFileExtension, md5File, walkParallel } from "../misc";
import { ExportLogger } from "../misc/ExportLogger";
import { IProcessorConfig, Processor } from "./Base";

interface IConfig extends IProcessorConfig {
    rootPaths: string[];
    includeExtensions?: string[];
    includeRegex?: string;
    excludeExtensions?: string[];
    excludeRegex?: string;
}

class CollectFile extends Processor<CollectFile> {
    public inputDataType = undefined;
    public outputDataType = FilePathData;

    public async processSingle() {
        let config = this.getConfig<IConfig>();
        let ret = new Array<FilePathData>();
        let filePromises = new Array<Promise<void>>();
        let md5Promises = new Array<Promise<void>>();
        let _md5FileCount = 0;

        for (let dir of config.rootPaths) {
            let promise = new Promise<void>((resolve, reject) => {
                walkParallel(path.resolve(dir), (err: any, results: string[]) => {
                    try {
                        assertWithLoc(err === null, `iterate-dir-file-failed`, { dir: dir, error: String(err) });

                        let includeReg = config.includeRegex ? createRegExpFromString(config.includeRegex) : undefined;
                        let excludeReg = config.excludeRegex ? createRegExpFromString(config.excludeRegex) : undefined;
                        for (const file of results) {
                            let filePath = file.replaceAll("\\", "/");
                            let valid = true;
                            let ext = getFileExtension(filePath);
                            if (config.excludeExtensions) {
                                for (let v of config.excludeExtensions) {
                                    if (ext.indexOf(v) >= 0) {
                                        valid = false;
                                        break;
                                    }
                                }
                            }
                            if (valid && includeReg) {
                                valid = includeReg.test(filePath);
                            }

                            if (valid && config.includeExtensions) {
                                valid = false;
                                for (let v of config.includeExtensions) {
                                    if (ext.indexOf(v) >= 0) {
                                        valid = true;
                                        break;
                                    }
                                }
                            }
                            if (valid && excludeReg) {
                                valid = !excludeReg.test(filePath);
                            }

                            if (!valid) continue;

                            _md5FileCount++;
                            md5Promises.push(
                                md5File(filePath).then((md5) => {
                                    ret.push(new FilePathData(filePath, md5));
                                }),
                            );
                        }

                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            filePromises.push(promise);
        }

        await Promise.all(filePromises);
        const _md5Start = Date.now();
        await Promise.all(md5Promises);
        const _md5Time = (Date.now() - _md5Start) / 1000;
        ExportLogger.logVerbose(`CollectFile MD5, time: ${_md5Time} s, files: ${_md5FileCount}`);
        return ret;
    }
}
CollectFile.register();
