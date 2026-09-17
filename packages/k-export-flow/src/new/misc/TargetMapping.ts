import * as path from "path";

import { assertWithLoc } from "./Localization";
import { Registry } from "./Registry";
import { assert, createRegExpFromString, getFileBaseName, getFileExtension, loadTextFileData, walkParallel } from "./Util";

import type { Constructor } from "../data/Define";
export interface ITargetMappingConfig {
    type: string;
    [key: string]: unknown;
}

export abstract class TargetMapping {
    protected config!: ITargetMappingConfig;

    public static register<T extends TargetMapping>(this: Constructor<T>) {
        Registry.get(TargetMapping).register(this);
    }
    public static async create(config: ITargetMappingConfig) {
        let fm = Registry.get(TargetMapping).create<TargetMapping>(config.type);
        assertWithLoc(fm, "invalid-file-mapping-type", { type: config.type });

        fm.config = config;
        await fm.init();

        return fm;
    }

    public async init() {}
    public abstract getTarget(source: string): Promise<string | undefined>;
    public async getTargets(source: string): Promise<string[] | undefined> {
        let r = await this.getTarget(source);
        return r ? [r] : undefined;
    }
    protected getConfig<T extends ITargetMappingConfig>() {
        return this.config as T;
    }
}

// ////////////////////////////////////////////////////////////////////////////////
interface ITargetMappingGroupConfig extends ITargetMappingConfig {
    mappings: ITargetMappingConfig[];
}

export class TargetMappingGroup extends TargetMapping {
    protected mappings!: TargetMapping[];

    public async init() {
        let config = this.getConfig<ITargetMappingGroupConfig>();
        this.mappings = await Promise.all(config.mappings.map((v) => TargetMapping.create(v)));
    }

    public async getTarget(source: string) {
        for (let mapping of this.mappings) {
            let ret = await mapping.getTarget(source);
            if (ret) return ret;
        }
        return undefined;
    }
}
TargetMappingGroup.register();

// ////////////////////////////////////////////////////////////////////////////////
interface IFindWithBaseNameConfig extends ITargetMappingConfig {
    targetDir: string;
    excludeNames?: string[];
}

class FindWithBaseName extends TargetMapping {
    protected nameToPath = new Map<string, string>();

    public async init() {
        let config = this.getConfig<IFindWithBaseNameConfig>();
        assertWithLoc(config.targetDir, "find-with-base-name-file-mapping-invalid-target-dir");

        return await new Promise<void>((resolve, reject) => {
            walkParallel(config.targetDir, (err: any, results: string[]) => {
                try {
                    assertWithLoc(err === null, `find-with-base-name-file-mapping-walk-path-failed`, {
                        path: config.targetDir,
                        error: err,
                    });

                    let baseName;
                    let found;
                    let excludeNames = new Set<string>(config.excludeNames ?? []);
                    for (let v of results) {
                        baseName = getFileBaseName(v);
                        if (excludeNames.has(baseName)) continue;

                        found = this.nameToPath.get(baseName);
                        assertWithLoc(!found, `find-with-base-name-file-mapping-duplicate-base-name`, {
                            name: baseName,
                            path1: found,
                            path2: v,
                        });
                        this.nameToPath.set(baseName, v);
                    }
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    public async getTarget(source: string) {
        let baseName = getFileBaseName(source);
        return this.nameToPath.get(baseName);
    }
}
FindWithBaseName.register();

// ////////////////////////////////////////////////////////////////////////////////
interface IGenerateWithBaseNameConfig extends ITargetMappingConfig {
    targetDir: string;
    baseDir?: string;
    extension?: string;
    resolvePath?: boolean;
    checkInBaseDir?: boolean;
}

class GenerateWithBaseName extends TargetMapping {
    // public async init() {
    //     let config = this.getConfig<IGenerateWithBaseNameConfig>();
    //     assertWithLoc(config.targetDir, "generate-with-base-name-file-mapping-invalid-target-dir");

    //     return new Promise<void>((resolve) => {
    //         fs.ensureDir(config.targetDir, (err: any) => {
    //             assertWithLoc(err === null, "generate-with-base-name-file-mapping-ensure-dir-failed", {
    //                 dir: config.targetDir,
    //                 error: err,
    //             });
    //             resolve();
    //         });
    //     });
    // }

    public async getTarget(source: string) {
        let config = this.getConfig<IGenerateWithBaseNameConfig>();
        let baseName = getFileBaseName(source);
        let ret;

        if (config.baseDir) {
            let relativePath = path.dirname(path.relative(config.baseDir, source));
            if (config.checkInBaseDir === true && relativePath.indexOf("..") !== -1) return undefined; // not in base dir, ignore

            ret = path.join(config.targetDir, relativePath, baseName + (config.extension ?? ""));
        } else {
            ret = path.join(config.targetDir, baseName + (config.extension ?? ""));
        }

        if (config.resolvePath === false) return ret;
        else return path.resolve(ret);
    }
}
GenerateWithBaseName.register();

// ////////////////////////////////////////////////////////////////////////////////
class FindTSPathByJSFile extends TargetMapping {
    public async getTarget(source: string) {
        let ext = getFileExtension(source);
        if (ext === ".ts") return source;
        else if (ext !== ".js") return undefined;

        let jsMapFile = source.replace(".js", ".js.map");
        let jsMap = await loadTextFileData(jsMapFile);
        let jsMapObj = JSON.parse(jsMap);
        return path.join(path.dirname(source), jsMapObj.sources[0]);
    }
}
FindTSPathByJSFile.register();

// ////////////////////////////////////////////////////////////////////////////////
interface IReplaceInfo {
    from: string;
    to: string;
}

interface IFindWithReplacedBaseNameConfig extends IFindWithBaseNameConfig {
    replaces: IReplaceInfo[];
}

class FindWithReplacedBaseName extends FindWithBaseName {
    private replaces = new Map<RegExp, string>();

    public async init() {
        let config = this.getConfig<IFindWithReplacedBaseNameConfig>();
        for (let info of config.replaces) {
            let reg = createRegExpFromString(info.from);
            assert(reg, `invalid from regexp: ${info.from}`);

            this.replaces.set(reg, info.to);
        }
        return super.init();
    }

    public async getTarget(source: string) {
        for (let [reg, to] of this.replaces) {
            let match = reg.exec(source);
            if (match) {
                let replacedSource = source.replace(reg, to);
                let baseName = getFileBaseName(replacedSource);
                let ret = this.nameToPath.get(baseName);
                return ret;
            }
        }

        return undefined;
    }
}
FindWithReplacedBaseName.register();
