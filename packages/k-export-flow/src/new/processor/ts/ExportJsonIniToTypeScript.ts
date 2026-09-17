import { DataWithSchema } from "../../data";
import { IniSchema } from "../../schema";
import { ExportInfoToTypeScript, GENERATED_TS_FILE_HEADER } from "./ExportInfoToTypeScript";

class ExportJsonIniToTypeScript extends ExportInfoToTypeScript {
    public constructor() {
        super();
        this.schemaType = IniSchema;
    }

    protected exportTS(data: DataWithSchema, tableName: string, jsonPath: string, out: Array<string>) {
        let schema = data.schema as IniSchema;

        out.push(GENERATED_TS_FILE_HEADER);
        out.push(`import { F } from "k-ts-framework";`);
        out.push(`import * as GDC from "game-data-collection";`);
        out.push("");

        let templateName = this.exportInterface(
            tableName.replace("Ini", ""),
            data.schema.declarationSet,
            "GDC.IIniTemplate",
            out,
        );

        out.push(`let ini = GDC.generateJsonIniWrapper(`);
        out.push(`\t"${jsonPath}",`);
        if (schema.config.tag) out.push(`\t"${schema.config.tag}",`);
        out.push(`);`);
        out.push(``);

        out.push(`export function getTemplate(): ${templateName} {`);
        out.push(`\tlet ret = GDC.getJsonIniTemplate<${templateName}>(ini());`);
        out.push(`\tF.assert(ret, "invalid ini template data, name: ${tableName}");`);
        out.push(`\treturn ret;`);
        out.push(`}`);
        out.push(``);
    }
}
ExportJsonIniToTypeScript.register();
