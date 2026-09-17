import { Enum, Field, Namespace, NamespaceBase, OneOf, Root, Type } from "protobufjs";

// ============================================================
// 字段基础类型映射（与 static.js forceLong=true 保持一致）
// ============================================================

const NUMBER_TYPES = new Set(["double", "float", "int32", "uint32", "sint32", "fixed32", "sfixed32"]);
const BIGINT_TYPES = new Set(["int64", "uint64", "sint64", "fixed64", "sfixed64"]);
const BOOL_TYPES = new Set(["bool"]);
const STRING_TYPES = new Set(["string"]);
const BYTES_TYPES = new Set(["bytes"]);

// 来自 protobufjs util.safeProp —— 这些名称在属性位置需要加引号
const JS_RESERVED = new Set([
    "do","if","in","for","let","new","try","var","case","else","enum","eval","false","null",
    "this","true","void","with","break","catch","class","const","super","throw","while",
    "yield","delete","export","import","public","return","static","switch","typeof","default",
    "extends","finally","package","private","abstract","boolean","debugger","function",
    "arguments","interface","protected","instanceof","implements","continue",
]);

function primitiveType(protoType: string): string | null {
    if (NUMBER_TYPES.has(protoType)) return "number";
    if (BIGINT_TYPES.has(protoType)) return "bigint";
    if (BOOL_TYPES.has(protoType)) return "boolean";
    if (STRING_TYPES.has(protoType)) return "string";
    if (BYTES_TYPES.has(protoType)) return "Uint8Array";
    return null;
}

/** 将字段名安全化：保留字加双引号 */
function safeFieldName(name: string): string {
    return JS_RESERVED.has(name) ? `"${name}"` : name;
}

/** 生成完整限定名，如 zero.common.ActiveBattlePass */
function qualifiedName(obj: NamespaceBase): string {
    const parts: string[] = [];
    let cur: NamespaceBase | null = obj;
    while (cur && !(cur instanceof Root)) {
        parts.unshift(cur.name);
        cur = cur.parent;
    }
    return parts.join(".");
}

/** 接口名加 I 前缀 */
function interfaceName(obj: NamespaceBase): string {
    const parts: string[] = [];
    let cur: NamespaceBase | null = obj;
    while (cur && !(cur instanceof Root)) {
        if (cur === obj) parts.unshift("I" + cur.name);
        else parts.unshift(cur.name);
        cur = cur.parent;
    }
    return parts.join(".");
}

/** 提取 proto comment 第一行（pbts 对多行注释只取第一行） */
function firstLine(comment: string | null | undefined): string | null {
    if (!comment) return null;
    return comment.split("\n")[0];
}

// ============================================================
// 字段类型解析
// ============================================================

interface IFieldTypeDesc {
    /** 接口中使用的类型字符串，含 ()|null 包裹 */
    interfaceType: string;
    /** 类 public property 使用的类型字符串 */
    classType: string;
    /** 类属性是否可选（? 修饰） */
    classOptional: boolean;
}

function resolveFieldType(field: Field): IFieldTypeDesc {
    // repeated
    if (field.repeated) {
        const elem = elementType(field);
        return {
            interfaceType: `(${elem}[]|null)`,
            classType: `${elem}[]`,
            classOptional: false,
        };
    }

    // map
    if (field.map) {
        const mapField = field as any;
        const keyT = mapKeyType(mapField.keyType as string);
        const valT = elementType(field);
        return {
            interfaceType: `(Map<${keyT}, ${valT}>|null)`,
            classType: `Map<${keyT}, ${valT}>`,
            classOptional: false,
        };
    }

    // oneof 成员（partOf 不为 null）
    if (field.partOf) {
        const base = singleType(field);
        return {
            interfaceType: `(${base}|null)`,
            classType: `(${base}|null)`,
            classOptional: true,
        };
    }

    // 消息类型（非 oneof）：运行时默认 null，class 属性也 optional
    const resolved = (field as any).resolvedType;
    if (resolved instanceof Type) {
        const base = singleType(field);
        return {
            interfaceType: `(${base}|null)`,
            classType: `(${base}|null)`,
            classOptional: true,
        };
    }

    // bigint 类型：默认 BigInt(0)，class 属性非 optional
    if (BIGINT_TYPES.has(field.type)) {
        return {
            interfaceType: `(bigint|null)`,
            classType: "bigint",
            classOptional: false,
        };
    }

    // 其他基础类型 / 枚举：有默认值，class 属性非 optional
    const base = singleType(field);
    return {
        interfaceType: `(${base}|null)`,
        classType: base,
        classOptional: false,
    };
}

/** 返回单个（非 repeated/map）字段的基础类型字符串（接口侧使用 I 前缀） */
function singleType(field: Field): string {
    const prim = primitiveType(field.type);
    if (prim) return prim;

    const resolved = (field as any).resolvedType as NamespaceBase | null;
    if (!resolved) return "any";

    if (resolved instanceof Enum) return qualifiedName(resolved);
    // Type（消息）在接口中使用 IXxx 前缀
    return interfaceName(resolved);
}

/** repeated / map 值的元素类型（接口侧使用 I 前缀） */
function elementType(field: Field): string {
    return singleType(field);
}

function mapKeyType(protoType: string): string {
    const prim = primitiveType(protoType);
    return prim ?? "string";
}

// ============================================================
// 生成器主体
// ============================================================

export class DtsGenerator {
    private lines: string[] = [];
    private indent = 0;

    generate(root: Root): string {
        this.lines = [];
        this.indent = 0;

        this.push(`import * as $protobuf from "protobufjs";`);
        this.push(`import Long = require("long");`);

        for (const nested of root.nestedArray) {
            this.emitNamespace(nested, /* isTopLevel */ true);
        }

        return this.lines.join("\n") + "\n";
    }

    // ---- namespace / enum / type 分发 ----

    private emitNamespace(node: NamespaceBase, isTopLevel: boolean) {
        if (node instanceof Type) {
            this.emitType(node);
        } else if (node instanceof Enum) {
            this.emitEnum(node);
        } else if (node instanceof Namespace) {
            const keyword = isTopLevel ? "export namespace" : "namespace";
            this.pushComment(`Namespace ${node.name}.`);
            this.push(`${keyword} ${node.name} {`);
            this.indent++;
            for (const child of node.nestedArray) {
                this.push("");
                this.emitNamespace(child, /* isTopLevel */ false);
            }
            this.indent--;
            this.push(`}`);
        }
    }

    // ---- 枚举 ----

    private emitEnum(obj: Enum) {
        // 有 proto 注释时，pbts 无法解析 @desc 前缀，输出 undefined（与 pbts 行为一致）
        const comment = obj.comment ? "undefined" : `${obj.name} enum.`;
        this.pushComment(comment);
        this.push(`enum ${obj.name} {`);
        this.indent++;
        const entries = Object.entries(obj.values);
        for (let i = 0; i < entries.length; i++) {
            const [key, val] = entries[i];
            const comma = i < entries.length - 1 ? "," : "";
            this.push(`${key} = ${val}${comma}`);
        }
        this.indent--;
        this.push(`}`);
    }

    // ---- 消息类型 ----

    private emitType(obj: Type) {
        const qName = qualifiedName(obj);   // e.g. zero.common.ActiveBattlePass
        const iName = interfaceName(obj);   // e.g. zero.common.IActiveBattlePass

        // --- interface ---
        this.pushComment(`Properties of ${aOrAn(obj.name)} ${obj.name}.`);
        this.push(`interface I${obj.name} {`);
        this.indent++;
        for (const field of obj.fieldsArray) {
            this.push("");
            this.pushComment(`${obj.name} ${field.name}`);
            const { interfaceType } = resolveFieldType(field);
            this.push(`${safeFieldName(field.name)}?: ${interfaceType};`);
        }
        this.indent--;
        this.push(`}`);

        this.push("");

        // --- class ---
        // 有 proto 注释时取第一行（pbts 行为）；否则用标准 Represents 格式
        const rawComment = firstLine(obj.comment);
        const classComment = rawComment ? rawComment : `Represents ${aOrAn(obj.name)} ${obj.name}.`;
        this.pushComment(classComment);
        this.push(`class ${obj.name} implements I${obj.name} {`);
        this.indent++;

        // constructor
        this.push("");
        this.pushMultilineComment([
            `Constructs a new ${obj.name}.`,
            `@param [properties] Properties to set`,
        ]);
        this.push(`constructor(properties?: ${iName});`);

        // public properties（class 属性位置不需要对保留字加引号）
        for (const field of obj.fieldsArray) {
            this.push("");
            this.pushComment(`${obj.name} ${field.name}.`);
            const { classType, classOptional } = resolveFieldType(field);
            const opt = classOptional ? "?" : "";
            this.push(`public ${field.name}${opt}: ${classType};`);
        }

        // oneof discriminator properties（跳过以 _ 开头的合成 oneof，即 proto3 optional 字段）
        for (const oneof of (obj.oneofsArray as OneOf[])) {
            if (oneof.name.startsWith("_")) continue;
            this.push("");
            this.pushComment(`${obj.name} ${oneof.name}.`);
            const fieldNames = oneof.fieldsArray.map((f) => `"${f.name}"`).join("|");
            // 单字段 oneof 不加括号，多字段才加括号（与 pbts 行为一致）
            const typeStr = oneof.fieldsArray.length === 1 ? fieldNames : `(${fieldNames})`;
            this.push(`public ${oneof.name}?: ${typeStr};`);
        }

        // encode
        this.push("");
        this.pushMultilineComment([
            `Encodes the specified ${obj.name} message. Does not implicitly {@link ${qName}.verify|verify} messages.`,
            `@param message ${obj.name} message or plain object to encode`,
            `@param [writer] Writer to encode to`,
            `@returns Writer`,
        ]);
        this.push(`public static encode(message: ${iName}, writer?: $protobuf.Writer): $protobuf.Writer;`);

        // decode
        this.push("");
        this.pushMultilineComment([
            `Decodes ${aOrAn(obj.name)} ${obj.name} message from the specified reader or buffer.`,
            `@param reader Reader or buffer to decode from`,
            `@param [length] Message length if known beforehand`,
            `@returns ${obj.name}`,
            `@throws {Error} If the payload is not a reader or valid buffer`,
            `@throws {$protobuf.util.ProtocolError} If required fields are missing`,
        ]);
        this.push(`public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ${qName};`);

        // toObject
        this.push("");
        this.pushMultilineComment([
            `Creates a plain object from ${aOrAn(obj.name)} ${obj.name} message. Also converts values to other types if specified.`,
            `@param message ${obj.name}`,
            `@param [options] Conversion options`,
            `@returns Plain object`,
        ]);
        this.push(`public static toObject(message: ${qName}, options?: $protobuf.IConversionOptions): { [k: string]: any };`);

        this.indent--;
        this.push(`}`);

        // 嵌套类型放在 namespace TypeName {} 中（pbts 行为）
        if (obj.nestedArray.length > 0) {
            this.push("");
            this.push(`namespace ${obj.name} {`);
            this.indent++;
            for (const child of obj.nestedArray) {
                this.push("");
                this.emitNamespace(child, false);
            }
            this.indent--;
            this.push(`}`);
        }
    }

    // ---- 辅助输出 ----

    private push(line: string) {
        const prefix = "    ".repeat(this.indent);
        this.lines.push(line === "" ? "" : prefix + line);
    }

    private pushComment(text: string) {
        this.push(`/** ${text} */`);
    }

    private pushMultilineComment(lines: string[]) {
        this.push(`/**`);
        for (const line of lines) {
            this.push(` * ${line}`);
        }
        this.push(` */`);
    }
}

/** 与 protobufjs/cli/targets/static.js aOrAn 保持一致 */
function aOrAn(name: string): string {
    const isVowelStart = (/^[hH](?:ou|on|ei)/.test(name) || /^[aeiouAEIOU][a-z]/.test(name)) && !/^us/i.test(name);
    return isVowelStart ? "an" : "a";
}

export function generateDts(root: Root): string {
    return new DtsGenerator().generate(root);
}
