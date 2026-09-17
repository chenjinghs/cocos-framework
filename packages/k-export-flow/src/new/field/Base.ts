/* eslint-disable @typescript-eslint/member-ordering */
import type { Constructor } from "../data/Define";
import { assertWithLoc, formatLoc } from "../misc/Localization";
import { Registry } from "../misc/Registry";
import { StringReader } from "../serializer/StringSerializer";
import { Validator } from "../validator/Base";

import type { Serializer } from "../serializer/Base";
import type { IValidatorConfig } from "../validator/Base";
export enum EFieldType {
    // 基础类型
    Int = "int",
    UInt = "uint",
    Float = "float",
    BigInt = "bigint",
    String = "string",
    Bool = "bool",

    Struct = "struct",
    OneOf = "oneof",
    Array = "array",
    Map = "map",

    // 扩展类型
    // L10N = "L10N",
    DataTableKey = "DataTableKey",
    // UEResource = "UEResource",
}

// 这个其实和ISerializeConfig有共同属性，但这里没继承，因为这个类也有很多种，ISerializeConfig也有很多种
export interface IFieldConfig {
    type: string;
    name: string;
    alias?: string;
    validator?: IValidatorConfig[];
    default?: string | number;
    optional?: boolean; // 对应代码中的问号，没有就是undefined，默认是false
    required?: boolean; // 对应代码中的感叹号，没有就是undefined，默认是false
    [key: string]: unknown;
}

export class FieldDeclaration {
    public constructor(public type: string, public optional: boolean | undefined) {}
}

export abstract class InterfaceDeclaration extends FieldDeclaration {
    public fields = new Map<string, FieldDeclaration>();
}

export class TemplateDeclarationSet extends InterfaceDeclaration {
    public interfaces = new Map<string, InterfaceDeclaration>();
    public custom = false;
    public constructor() {
        super(EFieldType.Struct, false);
    }
}

// 用于临时构建struct用，未来如果想搞全局struct，也可以用这玩意
export class TypeCache {
    public types = new Map<string, Field>();
}

export class SerializeContext {
    // 存这么多都是为了报错用。。
    public namespace: string = "";
    public rootDesc?: string;
    public currentObject?: any;
    public fieldStack = new Array<Field>();
    public dataStack = new Array<any>();
    public extraDataStack = new Array<any>();
    public pendingExtraData: any;
    public overriddenConfig: any;

    public init(namespace: string) {
        this.namespace = namespace;
    }

    public pushInfo(field: Field, data: any, extraData?: any) {
        this.fieldStack.push(field);
        this.dataStack.push(data);
        this.extraDataStack.push(this.pendingExtraData ?? extraData);
        this.pendingExtraData = undefined;
        this.overriddenConfig = undefined;
    }

    public popInfo() {
        this.fieldStack.pop();
        this.dataStack.pop();
        this.extraDataStack.pop();
    }

    public newObjInfo(rootDesc?: string) {
        this.fieldStack.length = 0;
        this.dataStack.length = 0;
        this.extraDataStack.length = 0;
        this.currentObject = undefined;
        this.pendingExtraData = undefined;
        this.overriddenConfig = undefined;
        this.rootDesc = rootDesc;
    }

    public getCurrentDesc() {
        let ret = this.rootDesc ? this.rootDesc + "." : "";
        for (let i = 0; i < this.fieldStack.length; i++) {
            ret += this.fieldStack[i].config.alias;
            if (this.extraDataStack[i]) ret += String(this.extraDataStack[i]);
            if (i < this.fieldStack.length - 1) ret += ".";
        }
        return ret;
    }

    public get currentExtraData() {
        return this.extraDataStack.length > 0 ? this.extraDataStack[this.extraDataStack.length - 1] : undefined;
    }

    public set currentExtraData(v: any) {
        if (this.extraDataStack.length > 0) this.extraDataStack[this.extraDataStack.length - 1] = v;
    }

    public get currentField() {
        return this.fieldStack.length > 0 ? this.fieldStack[this.fieldStack.length - 1] : undefined;
    }
    public set currentField(value: Field | undefined) {
        this.fieldStack.length = 0;
        this.dataStack.length = 0;
        this.extraDataStack.length = 0;
        if (value) this.fieldStack.push(value);
    }
    public getInfo(): string {
        return "";
    }
}

export interface IFieldOwner {
    addOwnedField: (field: Field) => void;
}

// ///////////////////////////////////////////////////////////////////
export abstract class Field {
    protected static contexts = new Array<TypeCache>();
    protected static defaultValueReader = new StringReader(); // 这里假设了config中的defaultvalue是字符串
    private static fieldTypes = new Set<string>(Object.values(EFieldType));
    private static allTypesKeyInConfig = new Map<string, string>();

    public static register<T extends Field>(this: Constructor<T>, key: string) {
        Registry.get(Field).register(this, key);
    }

    public static registerType<T extends Field>(this: Constructor<T>, type: string, keyInConfig: string) {
        Registry.get(TypeCache).register(this, type);
        Field.allTypesKeyInConfig.set(keyInConfig, type);
    }

    public static createContext() {
        let r = new TypeCache();
        this.contexts.push(r);
        return r;
    }

    public static destroyContext(context: TypeCache) {
        let index = this.contexts.indexOf(context);
        if (index >= 0) this.contexts.splice(index);
    }

    public static create(config: IFieldConfig, owner: IFieldOwner, contextToSave?: TypeCache, delayOnCreate?: boolean) {
        let type;
        if (!this.fieldTypes.has(config.type)) {
            for (const context of this.contexts) {
                type = context.types.get(config.type);
                if (type) break;
            }
        }

        let ret = Registry.get(Field).create<Field>(type?.config.type ?? config.type);
        assertWithLoc(ret, `create-field-failed`, { name: config.name, type: config.type });
        ret.config = config;
        owner.addOwnedField(ret);
        ret.createValidator();
        if (delayOnCreate === undefined || delayOnCreate === false) ret.onCreate();
        return ret;
    }

    public static createType(config: IFieldConfig, owner: IFieldOwner, contextToSave?: TypeCache, delayOnCreate?: boolean) {
        let ret = Registry.get(TypeCache).create<Field>(config.type);
        assertWithLoc(ret, `create-type-failed`, { name: config.name, type: config.type });
        ret.config = config;
        owner.addOwnedField(ret);
        ret.createValidator();
        if (delayOnCreate === undefined || delayOnCreate === false) ret.onCreate();

        for (const context of this.contexts) {
            assertWithLoc(!context.types.has(config.name), `create-field-failed-with-duplicated-field`, {
                name: config.name,
                type: config.type,
            });
        }
        contextToSave?.types.set(config.name, ret);
        return ret;
    }

    public static findType(name: string) {
        for (const context of this.contexts) {
            let ret = context.types.get(name);
            if (ret) return ret;
        }
        return undefined;
    }

    public static getAllTypeKeysInConfig() {
        return this.allTypesKeyInConfig;
    }

    // //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public config!: IFieldConfig;
    public validators = new Array<Validator>();

    public abstract generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>): FieldDeclaration;
    protected abstract serialize(s: Serializer, v: unknown, c: SerializeContext): unknown;

    protected onCreateValidator() {}
    public onCreate() {}

    public serializeValue(s: Serializer, v: unknown, sc: SerializeContext): unknown {
        sc.pushInfo(this, s.getData<any>());

        try {
            let ret = this.serialize(s, v, sc);
            this.validate(ret, sc);
            return ret;
        } finally {
            sc.popInfo();
        }
    }

    public getDescription() {
        return formatLoc("field-description", { name: this.config.name, type: this.config.type });
    }

    public getType() {
        return this.config.type as EFieldType;
    }

    public getValidatorConfigs() {
        return this.config.validator;
    }

    public validate(v: unknown, c: SerializeContext) {
        for (const validator of this.validators) {
            validator.validate(v, c);
        }
    }

    public getConfig<T extends IFieldConfig>() {
        return this.config as T;
    }

    public hasValidator(type: Constructor) {
        return this.validators.some((v) => v instanceof type);
    }

    protected getDefaultValueFromConfig<T>(context: SerializeContext, defaultValue: T): T {
        let config = context.overriddenConfig ?? this.config;
        let configDefaultValue = config.default;
        if (configDefaultValue === undefined) return defaultValue;

        config.default = undefined;
        let rawValue = String(configDefaultValue);
        Field.defaultValueReader.setData(rawValue);
        let ret = this.serializeValue(Field.defaultValueReader, rawValue, context);
        config.default = configDefaultValue;
        return ret as T;
    }

    private createValidator() {
        let validatorConfigs = this.getValidatorConfigs();
        if (validatorConfigs) {
            for (const validatorConfig of validatorConfigs) {
                let validator = Validator.create(validatorConfig);
                this.validators.push(validator);
            }
        }

        this.onCreateValidator();
    }
}

export abstract class ContainerField extends Field {
    public fields = new Array<Field>();
    public addOwnedField(field: Field) {
        if (this.fields.indexOf(field) >= 0) throw new Error(`add owned field failed, name: ${field.config.name}`);
        this.fields.push(field);
    }
}
