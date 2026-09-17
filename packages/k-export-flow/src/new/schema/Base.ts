import type { FilePathData } from "../data/Data";
import type { Constructor, IData } from "../data/Define";
import type { FieldDeclaration, IFieldConfig, InterfaceDeclaration } from "../field/Base";
import { Field, TemplateDeclarationSet } from "../field/Base";
import { assertWithLoc, newLocError } from "../misc/Localization";
import { RawDataPreProcessHelper } from "../misc/PreProcessRawData";
import { Registry } from "../misc/Registry";
import { assert } from "../misc/Util";
import type { Serializer } from "../serializer/Base";

export interface ISchemaConfig {
    type: string;
    name: string;
    tag?: string;
    fields: Array<IFieldConfig>;
    [key: string]: unknown;
}

export enum ESchemaDataType {
    DataTable = "data-table",
    DataTableIni = "data-table-ini",
    Ini = "ini",
}

export const EXTENSION_TO_SCHEMA_TYPE = new Map<string, string>([
    [".xlsx", ESchemaDataType.DataTable],
    [".tab", ESchemaDataType.DataTable],
    [".ini", ESchemaDataType.Ini],
    [".csv", ESchemaDataType.DataTable],
]);

// ///////////////////////////////////////////////////////////////////////////////////////////////////
export class Schema implements IData {
    public static register<T extends Schema>(this: Constructor<T>, key: string) {
        Registry.get(Schema).register(this, key);
    }
    public static create(key: string) {
        return Registry.get(Schema).create<Schema>(key);
    }

    public config!: ISchemaConfig;
    public source!: FilePathData;
    public schemaFiles!: string[];
    public fields = new Array<Field>();
    public nameToFields = new Map<string, Field>();
    public aliasToFields = new Map<string, Field>();
    public declarationSet!: TemplateDeclarationSet;
    public rawDataPreProcess!: RawDataPreProcessHelper;
    public configHash?: string;

    public async generateFields() {
        // 构建临时用的context，存储生成的struct和oneof
        let tempContext = Field.createContext();
        let config = this.config;
        let delayOnCreateFields = new Array<Field>();
        let currentFieldConfig: IFieldConfig | undefined;
        let names = new Set<string>();

        try {
            let setCurrentConfig = function (config: IFieldConfig) {
                currentFieldConfig = config;
                assertWithLoc(!names.has(currentFieldConfig.name), "field-name-conflict", {
                    name: currentFieldConfig.name,
                });
                names.add(currentFieldConfig.name);
            };

            let typeKeys = Field.getAllTypeKeysInConfig();
            for (let [key, type] of typeKeys) {
                let typeConfigs = config[key] as Array<any>;
                if (!typeConfigs) continue;

                for (let typeConfig of typeConfigs) {
                    typeConfig.type = type;
                    setCurrentConfig(typeConfig);
                    delayOnCreateFields.push(Field.createType(typeConfig, this, tempContext, true));
                }
            }

            // 最后在掉，防止循环依赖
            for (let field of delayOnCreateFields) {
                currentFieldConfig = field.config;
                field.onCreate();
            }

            let field;
            for (const fieldConfig of config.fields) {
                setCurrentConfig(fieldConfig);
                // assert(fieldConfig.alias, "field alias not set");
                if (fieldConfig.alias === undefined) fieldConfig.alias = fieldConfig.name;
                assertWithLoc(!this.aliasToFields.has(fieldConfig.alias!), "duplicated-field-alias-in-schema", {
                    alias: fieldConfig.alias,
                    schema: this.schemaFiles.toString(),
                });

                field = Field.create(fieldConfig, this);
                this.fields.push(field);
                this.nameToFields.set(fieldConfig.name, field);
                this.aliasToFields.set(fieldConfig.alias!, field);
            }
        } catch (err: any) {
            throw newLocError(
                "schema-generate-field-failed",
                {
                    field: currentFieldConfig?.name,
                    files: this.schemaFiles.toString(),
                    error: err.message,
                },
                err,
            );
        }

        Field.destroyContext(tempContext);

        this.declarationSet = this.generateDeclarationSet();
        this.rawDataPreProcess = RawDataPreProcessHelper.create(this.fields);
    }

    public generateRawData(data: object, serializer: Serializer): Promise<object> {
        throw new Error("method not implemented.");
    }

    public getDescription(): string {
        return `schema ${this.schemaFiles}`;
    }

    public copyDeclaration(source: Schema) {}

    public addOwnedField(field: Field) {}

    public getConfig<T extends ISchemaConfig>() {
        return this.config as T;
    }

    protected generateDeclarationSet(): TemplateDeclarationSet {
        try {
            let interfaces = new Map<Field, InterfaceDeclaration>();
            let decls = new Array<[string, FieldDeclaration]>();
            for (let fieldConfig of this.config.fields) {
                let field = this.aliasToFields.get(fieldConfig.alias!);
                assert(field, `field alias ${fieldConfig.alias} not found`);
                decls.push([fieldConfig.alias!, field.generateDeclaration(interfaces)]);
            }

            let ret = new TemplateDeclarationSet();
            let alias;

            for (let [field, decl] of interfaces) {
                alias = field.config.alias!;
                assertWithLoc(!ret.interfaces.has(alias), "duplicated-interface-alias-in-schema", {
                    alias: alias,
                    schema: this.schemaFiles.toString(),
                });
                ret.interfaces.set(alias, decl);
            }

            for (let [alias, decl] of decls) {
                ret.fields.set(alias, decl);
            }

            return ret;
        } catch (err: any) {
            throw newLocError(
                "data-table-error",
                {
                    error: err.message,
                    info: this.schemaFiles.toString(),
                },
                err,
            );
        }
    }
}
