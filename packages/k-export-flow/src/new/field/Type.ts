import { getGlobalConfig } from "../data";
import { assert, assertWithLoc } from "../misc";
import { ContainerField, EFieldType, Field, FieldDeclaration, InterfaceDeclaration } from "./Base";

import type { IOneOfSerializeConfig, Serializer } from "../serializer";
import type { IFieldConfig, SerializeContext } from "./Base";
// ///////////////////////////////////////////////////////////////////
export interface IStructConfig extends IFieldConfig {
    fields: Array<IFieldConfig>;
}

export class StructDeclaration extends InterfaceDeclaration {
    public constructor() {
        super(EFieldType.Struct, false);
    }
}

export class StructType extends ContainerField {
    public static defaultValue = {};
    public nameToFields = new Map<string, Field>();
    public aliasToFields = new Map<string, Field>();

    public onCreate() {
        // assertWithLoc(this.config.alias !== undefined, `struct-field-alias-missing`);
        if (this.config.alias === undefined) this.config.alias = this.config.name;

        let config = this.getConfig<IStructConfig>();
        for (let i = 0; i < config.fields.length; ++i) {
            let fc = config.fields[i];
            fc.alias = fc.alias ?? fc.name ?? `${config.alias}_${i}`;
            fc.name = fc.name ?? `${config.name}_${i}`;
            let subField = Field.create(fc, this);
            this.nameToFields.set(fc.name, subField);
            this.aliasToFields.set(fc.alias, subField);
        }
    }

    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>, overriddenConfig?: IFieldConfig) {
        let found = interfaces.get(this);
        if (!found) {
            let decl = new StructDeclaration();
            interfaces.set(this, decl);

            let alias;
            for (let field of this.fields) {
                alias = field.config.alias!;
                assertWithLoc(!decl.fields.has(alias), `struct-field-alias-conflict`, {
                    structName: this.config.name,
                    alias: alias,
                });
                decl.fields.set(alias, field.generateDeclaration(interfaces));
            }
        }

        return new FieldDeclaration(this.config.alias!, overriddenConfig ? overriddenConfig.optional : this.config.optional);
    }

    public serialize(s: Serializer, value: object, context: SerializeContext) {
        let dataIndex = 0;
        let config = context.overriddenConfig ?? (this.config as unknown as IStructConfig);

        return s.serializeStruct(
            value,
            this.getDefaultValueFromConfig(context, StructType.defaultValue),
            config,
            (sr: Serializer, name: string | number, _value: unknown) => {
                if (sr.isReader()) {
                    let field;
                    let t = typeof name;
                    if (t === "string") {
                        field = this.nameToFields.get(name as string);
                    } else if (t === "number") {
                        field = this.fields[name as number];
                    } else {
                        throw new Error(`StructField serialize failed, invalid key type ${String(name)}`);
                    }

                    return field?.config.alias ?? String(name);
                } else {
                    // TODO: 暂时没想好咋写，有实际需求再说
                    return String(name);
                }
            },
            (sr: Serializer, key: string, value: unknown) => {
                let field = this.aliasToFields.get(key);
                assert(field, `struct-field-not-found, name: ${key}`);

                context.pendingExtraData = dataIndex++;
                return field.serializeValue(sr, value, context);
            },
        );
    }
}
StructType.registerType(EFieldType.Struct, "structs");

// ///////////////////////////////////////////////////////////////////
export interface IOneOfMappingConfig {
    key: string | number | boolean;
    type: string;
    alias?: string;
}

export interface IOneOfConfig extends IFieldConfig {
    key?: IFieldConfig;
    paramPrefix?: string;
    mapping: Array<IOneOfMappingConfig>;
}

export class OneOfDeclaration extends InterfaceDeclaration {
    public constructor(public keyName: string) {
        super(EFieldType.OneOf, false);
    }
}

export class OneOfType extends ContainerField {
    public static defaultValue = {};
    public keyField!: Field;
    public keyAliasToMappingField = new Map<string | number | boolean, Field>();
    public typeValueToKeyAlias = new Map<string, string>();
    public serializeConfig!: IOneOfSerializeConfig;

    public onCreate() {
        let config = this.getConfig<IOneOfConfig>();
        let keyType = config.key?.type;
        assertWithLoc(keyType === undefined || keyType === "string" || keyType === "int" || keyType === "bool", "invalid-oneof-key-type");
        assertWithLoc(config.mapping, "oneof-mapping-missing");

        let keyConfig = config.key;
        if (!keyConfig) {
            keyConfig = {
                name: getGlobalConfig().defaultOneOfKeyName,
                type: EFieldType.String,
            };
        }

        keyConfig.name = keyConfig.name ?? getGlobalConfig().defaultOneOfKeyName;
        keyConfig.alias = keyConfig.alias ?? getGlobalConfig().defaultOneOfKeyName;
        this.keyField = Field.create(keyConfig, this);

        for (let mc of config.mapping as any[]) {
            assertWithLoc(mc.key !== undefined, "oneof-mapping-key-missing");
            assertWithLoc(mc.type, "oneof-mapping-type-missing", { name: mc.key });
            let name = String(mc.key) || mc.alias;
            mc.name = name;
            mc.alias = mc.alias ?? name;
            this.keyAliasToMappingField.set(mc.alias, Field.create(mc, this));
            this.typeValueToKeyAlias.set(String(mc.key), mc.alias);
        }

        // IOneOfSerializeConfig
        config.paramPrefix = config.paramPrefix ?? getGlobalConfig().defaultOneOfParamPrefix;
    }

    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>, overriddenConfig?: IFieldConfig) {
        let found = interfaces.get(this);
        if (!found) {
            let decl = new OneOfDeclaration(this.keyField.config.alias ?? this.keyField.config.name);
            interfaces.set(this, decl);

            let alias;
            for (let field of this.fields) {
                alias = field.config.alias!;
                assertWithLoc(!decl.fields.has(alias), `oneof-field-alias-conflict`, {
                    oneOfName: this.config.name,
                    alias: alias,
                });
                let fd = field.generateDeclaration(interfaces);
                if (field !== this.keyField) fd.optional = true;
                decl.fields.set(alias, fd);
            }
        }

        return new FieldDeclaration(this.config.alias!, overriddenConfig ? overriddenConfig.optional : this.config.optional);
    }

    public serialize(s: Serializer, value: object, context: SerializeContext) {
        let dataIndex = 0;
        let config = context.overriddenConfig ?? (this.config as unknown as IOneOfSerializeConfig);

        return s.serializeOneOf(
            value,
            this.getDefaultValueFromConfig(context, OneOfType.defaultValue),
            config,
            (sr: Serializer, value: unknown) => {
                return this.keyField.config.alias!;
            },
            (sr: Serializer, typeKey: string, value: unknown) => {
                context.pendingExtraData = [dataIndex++, 0];
                let typeValue = this.keyField.serializeValue(sr, value, context) as any;

                if (sr.isReader()) {
                    let alias = this.typeValueToKeyAlias.get(typeValue);
                    assertWithLoc(alias, "oneof-mapping-field-not-found", { field: this.config.name, name: typeValue });
                    return alias;
                } else {
                    return typeValue;
                }
            },
            (sr: Serializer, typeValue: string, value: unknown) => {
                return typeValue;
            },
            (sr: Serializer, key: string, value: unknown) => {
                context.pendingExtraData = [dataIndex - 1, 1];

                let field = this.keyAliasToMappingField.get(key);
                assertWithLoc(field, "oneof-mapping-field-not-found", { field: this.config.name, name: key });

                return field.serializeValue(sr, value, context);
            },
        );
    }
}
OneOfType.registerType(EFieldType.OneOf, "oneofs");

// ///////////////////////////////////////////////////////////////////
