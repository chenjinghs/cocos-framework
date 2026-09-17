import { DataWithSchema, getGlobalConfig, TaggedInfoExtraData } from "../data";
import { getFileExtension } from "../misc";
import { Loader } from "../misc/Loader";
import { assertWithLoc } from "../misc/Localization";
import { ITargetMappingConfig } from "../misc/TargetMapping";
import { IProcessorConfig, Processor } from "./Base";
import { getTargetPathWithMappingBySchemaKey } from "./Util";

interface IConfig extends IProcessorConfig {
    mappingFileKeyInSchema: string;
    targetMapping: ITargetMappingConfig;
}

class CollectTaggedInfoFromFile extends Processor<CollectTaggedInfoFromFile> {
    public inputDataType = DataWithSchema;
    public outputDataType = DataWithSchema;

    private extToLoader = new Map<string, Loader>();

    public async processSingle(data: DataWithSchema) {
        let config = this.getConfig<IConfig>();
        let targetPaths = await getTargetPathWithMappingBySchemaKey(
            data.schema,
            config.mappingFileKeyInSchema,
            config.targetMapping,
        );
        if (!targetPaths) return data;

        let ext, loader, content;
        let exportBeginKey = getGlobalConfig().defaultExportInfoBeginKey;
        let exportEndKey = getGlobalConfig().defaultExportInfoEndKey;
        let exportInfo = new Array<string>();

        for (let targetPath of targetPaths) {
            ext = getFileExtension(targetPath);
            loader = this.extToLoader.get(ext);
            if (!loader) {
                loader = Loader.create(ext);
                assertWithLoc(loader, "invalid-loader", { phase: "CollectTaggedInfoFromFile", ext: ext });
                this.extToLoader.set(ext, loader);
            }

            content = await loader.loadRawDataObject(targetPath, this.config);
            if (typeof content !== "string" || content.length === 0) continue;

            let lines = content.split(/\r\n|\n|\r/);
            let inExportedBlock = false;
            let trimLine;

            lines.forEach((line) => {
                trimLine = line.trim();
                if (trimLine.startsWith(exportBeginKey)) {
                    if (inExportedBlock) {
                        throw new Error(`export block already started ${targetPath}`);
                    }
                    inExportedBlock = true;
                } else if (trimLine.startsWith(exportEndKey)) {
                    if (!inExportedBlock) {
                        throw new Error("export block already ended");
                    }
                    inExportedBlock = false;
                } else if (inExportedBlock) {
                    exportInfo.push(line);
                }
            });
        }

        data.addExtraData(new TaggedInfoExtraData(exportInfo));
        return data;
    }
}
CollectTaggedInfoFromFile.register();
