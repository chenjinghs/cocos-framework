// 基础类型

import { deepCopy } from "../misc";
import { assertWithLoc } from "../misc/Localization";
import { BigIntValidator, CollectionValidator, EValidatorNumberType } from "../validator/Validator";
import { ContainerField, EFieldType, Field, FieldDeclaration, InterfaceDeclaration } from "./Base";
import { verifyNumberValidator, verifyValidator } from "./Util";

import type { Serializer } from "../serializer/Base";
import type { IFieldConfig, SerializeContext } from "./Base";
import type { IStructConfig, OneOfType, StructType } from "./Type";
export class IntField extends Field {
    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return new FieldDeclaration(this.config.type, this.config.optional);
    }

    protected serialize(s: Serializer, value: number, context: SerializeContext) {
        return s.serialize(value, this.getDefaultValueFromConfig(context, 0), this.config);
    }

    protected onCreateValidator() {
        verifyNumberValidator(this, EValidatorNumberType.Int);
        verifyValidator(this, CollectionValidator);
    }
}
IntField.register(EFieldType.Int);

export class UIntField extends Field {
    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return new FieldDeclaration(this.config.type, this.config.optional);
    }

    protected serialize(s: Serializer, value: number, context: SerializeContext) {
        return s.serialize(value, this.getDefaultValueFromConfig(context, 0), this.config);
    }

    protected onCreateValidator() {
        verifyNumberValidator(this, EValidatorNumberType.UInt);
        verifyValidator(this, CollectionValidator);
    }
}
UIntField.register(EFieldType.UInt);

// ///////////////////////////////////////////////////////////////////
export class BigIntField extends Field {
    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return new FieldDeclaration(this.config.type, this.config.optional);
    }

    protected serialize(s: Serializer, value: bigint, context: SerializeContext) {
        return s.serialize(value, this.getDefaultValueFromConfig(context, 0n), this.config);
    }

    protected onCreateValidator() {
        verifyValidator(this, BigIntValidator);
        verifyValidator(this, CollectionValidator);
    }
}
BigIntField.register(EFieldType.BigInt);

// ///////////////////////////////////////////////////////////////////
export class FloatField extends Field {
    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return new FieldDeclaration(this.config.type, this.config.optional);
    }

    protected serialize(s: Serializer, value: number, context: SerializeContext) {
        return s.serialize(value, this.getDefaultValueFromConfig(context, 0), this.config);
    }

    protected onCreateValidator() {
        verifyNumberValidator(this, EValidatorNumberType.Float);
    }
}
FloatField.register(EFieldType.Float);

// ///////////////////////////////////////////////////////////////////
export class StringField extends Field {
    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return new FieldDeclaration(this.config.type, this.config.optional);
    }

    protected serialize(s: Serializer, value: string, context: SerializeContext) {
        return s.serialize(value, this.getDefaultValueFromConfig(context, ""), this.config);
    }

    protected onCreateValidator() {
        verifyValidator(this, CollectionValidator);
    }
}
StringField.register(EFieldType.String);

// ///////////////////////////////////////////////////////////////////
export class BoolField extends Field {
    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return new FieldDeclaration(this.config.type, this.config.optional);
    }

    protected serialize(s: Serializer, value: boolean, context: SerializeContext) {
        return s.serialize(value, this.getDefaultValueFromConfig(context, false), this.config);
    }
}
BoolField.register(EFieldType.Bool);

// ///////////////////////////////////////////////////////////////////
export interface IArrayFieldConfig extends IFieldConfig {
    inner: IFieldConfig;
}

export class ArrayFieldDeclaration extends FieldDeclaration {
    public constructor(public inner: FieldDeclaration, optional?: boolean) {
        super(EFieldType.Array, optional);
    }
}

export class ArrayField extends ContainerField {
    public static defaultValue = [];
    public innerField!: Field;

    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return new ArrayFieldDeclaration(this.innerField.generateDeclaration(interfaces), this.config.optional);
    }

    public onCreate() {
        let config = this.getConfig<IArrayFieldConfig>();

        assertWithLoc(config.inner, `array-inner-missing`);
        config.inner.name = config.inner.name ?? `${config.name}_Inner`;
        config.inner.alias = config.inner.alias ?? `${config.alias}_Inner`;
        this.innerField = Field.create(config.inner, this);
        assertWithLoc(this.innerField, `array-inner-create-failed`);
    }

    protected serialize(s: Serializer, value: Array<any>, context: SerializeContext) {
        let dataIndex = 0;
        return s.serializeArray(value, this.getDefaultValueFromConfig(context, ArrayField.defaultValue), this.config, (sr: Serializer, element: unknown) => {
            context.pendingExtraData = dataIndex++;
            return this.innerField.serializeValue(sr, element, context);
        });
    }
}
ArrayField.register(EFieldType.Array);

// ///////////////////////////////////////////////////////////////////
export interface IMapFieldConfig extends IFieldConfig {
    innerKey: IFieldConfig;
    innerValue: IFieldConfig;
    separator?: string;
}

export class MapFieldDeclaration extends FieldDeclaration {
    public constructor(public innerKey: FieldDeclaration, public innerValue: FieldDeclaration, optional?: boolean) {
        super(EFieldType.Map, optional);
    }
}

export class MapField extends ContainerField {
    public static defaultValue = new Map();
    public keyField!: Field;
    public valueField!: Field;

    public onCreate() {
        let config = this.getConfig<IMapFieldConfig>();

        assertWithLoc(config.innerKey, `map-key-missing`);
        config.innerKey.name = config.innerKey.name ?? `${config.name}_Key`;
        config.innerKey.alias = config.innerKey.alias ?? `${config.alias}_Key`;
        this.keyField = Field.create(config.innerKey, this);

        assertWithLoc(config.innerValue, `map-value-missing`);
        config.innerValue.name = config.innerValue.name ?? `${config.name}_Value`;
        this.valueField = Field.create(config.innerValue, this);
    }

    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return new MapFieldDeclaration(this.keyField.generateDeclaration(interfaces), this.valueField.generateDeclaration(interfaces), this.config.optional);
    }

    public serialize(s: Serializer, value: Map<any, any>, context: SerializeContext) {
        let dataIndex = 0;
        return s.serializeMap(
            value,
            this.getDefaultValueFromConfig(context, MapField.defaultValue),
            this.config,
            (sr: Serializer, k: unknown) => {
                context.pendingExtraData = [dataIndex++, 0];
                return this.keyField.serializeValue(sr, k, context);
            },
            (sr: Serializer, v: unknown) => {
                context.pendingExtraData = [dataIndex - 1, 1];
                return this.valueField.serializeValue(sr, v, context);
            },
        );
    }
}
MapField.register(EFieldType.Map);

// ///////////////////////////////////////////////////////////////////
export class StructFieldDeclaration extends InterfaceDeclaration {
    public constructor() {
        super(EFieldType.Struct, false);
    }
}

export class StructField extends ContainerField {
    public selfType!: StructType;
    public nameToFields = new Map<string, Field>();
    public overriddenConfig!: any;

    public onCreate() {
        // assertWithLoc(this.config.alias !== undefined, `struct-field-alias-missing`);
        if (this.config.alias === undefined) this.config.alias = this.config.name;

        this.selfType = Field.findType(this.config.type) as StructType;
        assertWithLoc(this.selfType, `can-not-find-struct-type`, { name: this.config.name, type: this.config.type });
        this.fields = this.selfType.fields;
        this.overriddenConfig = mergeConfigOptions(deepCopy(this.selfType.config), this.config);
    }

    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return this.selfType.generateDeclaration(interfaces, this.overriddenConfig);
    }

    public serialize(s: Serializer, value: object, context: SerializeContext) {
        context.overriddenConfig = this.overriddenConfig;
        return this.selfType.serialize(s, value, context);
    }
}
StructField.register(EFieldType.Struct);

// ///////////////////////////////////////////////////////////////////
export class OneOfField extends ContainerField {
    public selfType!: OneOfType;
    public overriddenConfig!: any;

    public onCreate() {
        // assertWithLoc(this.config.alias !== undefined, `struct-field-alias-missing`);
        if (this.config.alias === undefined) this.config.alias = this.config.name;

        this.selfType = Field.findType(this.config.type) as OneOfType;
        assertWithLoc(this.selfType, `can-not-find-type`, { name: this.config.name, type: this.config.type });
        this.fields = this.selfType.fields;
        this.overriddenConfig = mergeConfigOptions(deepCopy(this.selfType.config), this.config);
    }

    public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
        return this.selfType.generateDeclaration(interfaces, this.overriddenConfig);
    }

    public serialize(s: Serializer, value: object, context: SerializeContext) {
        context.overriddenConfig = this.overriddenConfig;
        return this.selfType.serialize(s, value, context);
    }
}
OneOfField.register(EFieldType.OneOf);

// ///////////////////////////////////////////////////////////////////
function mergeConfigOptions(config: IFieldConfig, override: IFieldConfig) {
    config.validator = override.validator ?? config.validator;
    config.default = override.default ?? config.default;
    config.optional = override.optional ?? config.optional;
    config.required = override.required ?? config.required;
    return config;
}
