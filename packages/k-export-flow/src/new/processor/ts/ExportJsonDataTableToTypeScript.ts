import type { DataWithSchema } from "../../data";
import { assert } from "../../misc/Util";
import { DataTableSchema, EDataTableKeyType } from "../../schema/DataTableSchema";
import { ExportInfoToTypeScript, GENERATED_TS_FILE_HEADER } from "./ExportInfoToTypeScript";

import type { IConfig } from "./ExportInfoToTypeScript";
const sprintf = require("sprintf-js").sprintf;

class ExportJsonDataTableToTypeScript extends ExportInfoToTypeScript {
    public constructor() {
        super();
        this.schemaType = DataTableSchema;
    }

    protected exportTS(data: DataWithSchema, tableName: string, jsonPath: string, out: Array<string>) {
        let schema = data.schema as DataTableSchema;
        let keyType = schema.declarationSet.custom ? EDataTableKeyType.Custom : schema.getKeyType();
        let keyField = keyType === EDataTableKeyType.Custom ? undefined : schema.getKeyField();
        let config = this.getConfig<IConfig>();

        out.push(GENERATED_TS_FILE_HEADER);
        out.push(`import { F } from "k-ts-framework";`);
        out.push(`import * as GDC from "game-data-collection";`);
        out.push("");

        // this.hasL10n = false;
        let templateName = this.exportInterface(tableName.replace("DataTable", ""), data.schema.declarationSet, "GDC.IDataTableTemplate", out);

        // if (this.hasL10n) {
        //     out.splice(insertIndex, 0, `import { FText } from "cpp";`);
        // }

        out.push(`export const DATA_FILE = "${jsonPath}"`);
        out.push(``);
        out.push(`let dataTable = GDC.generateJsonDataTableWrapper(`);
        out.push(`\tDATA_FILE,`);
        out.push(`\tGDC.EDataTableKeyType.${EDataTableKeyType[keyType]},`);
        if (schema.config.tag) out.push(`\t"${schema.config.tag}",`);
        out.push(`);`);
        out.push(``);

        if (keyType === EDataTableKeyType.Custom) {
            // Custom 只导出最基本的
            out.push(`function getAllCustomData<T>(): T {`);
            out.push(`\treturn dataTable()?.obj as unknown as T;`);
            out.push(`}`);
        } else {
            assert(keyField, `invalid key field`);
            let decl = "";
            let args = "";
            let argsDesc = "";
            let tempKeyName;
            let tempKeyType;
            let isVersionedFallbackTable = schema.config.versionFallback === true;
            let versionFallbackArgs = "";
            let versionArgName = "";

            if (Array.isArray(keyField)) {
                let keyCount = keyField.length;
                let end;
                for (let i = 0; i < keyCount; ++i) {
                    tempKeyName = this.getFieldExportName(keyField[i]);
                    tempKeyType = this.getFieldExportType(keyField[i].config);
                    end = i < keyCount - 1 ? ", " : "";
                    decl += `${tempKeyName}: ${tempKeyType}` + end;
                    args += `${tempKeyName}` + end;
                    argsDesc += `${tempKeyName}: \$\{${tempKeyName}\}` + end;
                }
            } else {
                tempKeyName = this.getFieldExportName(keyField!);
                tempKeyType = this.getFieldExportType(keyField!.config);
                decl = `${tempKeyName}: ${tempKeyType}`;
                args = `${tempKeyName}`;
                argsDesc += `${tempKeyName}: \$\{${tempKeyName}\}`;
            }

            if (isVersionedFallbackTable) {
                if (Array.isArray(keyField)) {
                    assert(keyField.length > 0 && keyField[0].config.name === "version", `${tableName} config.versionFallback requires the first key to be version`);
                    versionArgName = this.getFieldExportName(keyField[0]);
                    versionFallbackArgs = ["0"]
                        .concat(keyField.slice(1).map((field) => this.getFieldExportName(field)))
                        .join(", ");
                } else {
                    assert(keyField!.config.name === "version", `${tableName} config.versionFallback requires the key to be version`);
                    versionArgName = tempKeyName!;
                    versionFallbackArgs = "0";
                }
            }

            if (schema.config.exportTemplateCountToTS) {
                let templates = data.data;
                if (templates) {
                    let count = 0;
                    if (Array.isArray(templates)) count = templates.length;
                    else if (templates instanceof Map) count = templates.size;
                    else if (typeof templates === "object") count = Object.keys(templates).length;

                    out.push(`export const TEMPLATE_COUNT = ${count};`);
                    out.push(``);
                }
            }

            out.push(`export function findTemplate(${decl}): ${templateName} | undefined {`);
            if (schema.config.findTemplateFuncBody !== undefined) {
                out.push(sprintf(schema.config.findTemplateFuncBody, templateName, args));
            } else if (isVersionedFallbackTable) {
                out.push(`\tlet ret = GDC.findJsonDataTableTemplateByKey<${templateName}>(dataTable(), ${args});`);
                out.push(`\tif (ret || ${versionArgName} === 0) return ret;`);
                out.push(`\treturn GDC.findJsonDataTableTemplateByKey<${templateName}>(dataTable(), ${versionFallbackArgs});`);
            } else {
                out.push(`\treturn GDC.findJsonDataTableTemplateByKey<${templateName}>(dataTable(), ${args});`);
            }
            out.push(`}`);
            out.push(``);

            if (config.exportIterateFunc || schema.config.exportIterateFunc) {
                out.push(`export function findTemplateWithCallback(`);
                out.push(`\tcallback: (template: ${templateName}, ${decl}) => boolean,`);
                out.push(`): ${templateName} | undefined {`);
                out.push(`\treturn GDC.findJsonDataTableTemplate<${templateName}>(dataTable(), callback);`);
                out.push(`}`);
                out.push(``);

                out.push(`export function getTemplateCount(): number {`);
                out.push(`\treturn GDC.countJsonDataTableTemplate(dataTable());`);
                out.push(`}`);
                out.push(``);

                out.push(`export function foreachTemplate(`);
                out.push(`\tcallback: (template: ${templateName}, ${decl}) => void,`);
                out.push(`): void {`);
                out.push(`\tGDC.foreachJsonDataTableTemplate<${templateName}>(dataTable(), callback);`);
                out.push(`}`);
                out.push(``);

                out.push(`export function everyTemplate(`);
                out.push(`\tcallback: (template: ${templateName}, ${decl}) => boolean,`);
                out.push(`): boolean {`);
                out.push(`\treturn GDC.everyJsonDataTableTemplate<${templateName}>(dataTable(), callback);`);
                out.push(`}`);
                out.push(``);
            }

            if (config.supportOldFeatures) {
                out.push(`export function getTemplate(${decl}): ${templateName} | undefined {`);
                out.push(`\tlet ret = findTemplate(${args});`);
                out.push(`\tif (!ret) console.error(\`getTemplate result in ${tableName} is invalid, please use findTemplate, ${argsDesc}\`);`);
                out.push(`\treturn ret;`);
                out.push(`}`);
                out.push(``);

                if (config.exportIterateFunc || schema.config.exportIterateFunc) {
                    this.exportFunctionDeprecatedDesc(out, "getAllTemplates", "foreachTemplate");
                    out.push(`export function getAllTemplates(): Map<${tempKeyType}, ${templateName}> {`);
                    out.push(`\treturn dataTable().obj as unknown as Map<${tempKeyType}, ${templateName}>;`);
                    out.push(`}`);
                    out.push(``);

                    this.exportFunctionDeprecatedDesc(out, "getAllTemplateList", "foreachTemplate");
                    out.push(`export function getAllTemplateList(): ${templateName}[] {`);
                    out.push(`\treturn Array.from((dataTable().obj as any).values());`);
                    out.push(`}`);
                    out.push(``);

                    this.exportFunctionDeprecatedDesc(out, "getTemplatesCount", "getTemplateCount");
                    out.push(`export function getTemplatesCount(): number {`);
                    out.push(`\treturn getTemplateCount();`);
                    out.push(`}`);
                    out.push(``);
                }
            } else {
                out.push(`export function getTemplate(${decl}): ${templateName} {`);
                out.push(`\tlet ret = findTemplate(${args});`);
                out.push(`\tF.assert(ret, \`template is not found in ${tableName}, ${argsDesc}\`);`);
                out.push(`\treturn ret;`);
                out.push(`}`);
                out.push(``);
            }
        }
    }
}
ExportJsonDataTableToTypeScript.register();
