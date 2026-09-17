/**
 * NativeTsGenerator
 *
 * 将 proto Root 导出为原生 TypeScript 多文件（阶段二）。
 *
 * 输出结构（以 nativeTsPath 为根目录）：
 *   <namespace/package>.ts   —— 一个 package 对应一个文件
 *   index.ts                 —— 重导出所有类型
 *
 * 每个文件包含：
 *   - 接口定义 (IXxx)
 *   - 类定义（含完整 encode / decode / toObject 方法）
 *   - 枚举定义
 *
 * 约束：
 *   - 仅生成静态代码，不使用 eval / new Function，兼容微信小游戏
 *   - encode/decode 实现等价于 pbjs --no-create --no-verify --no-delimited static-module 输出
 *   - 按 proto 文件分组，支持增量导出（跳过未变更 proto 文件对应的输出文件）
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Enum, Field, MapField, Namespace, NamespaceBase, Root, Type } from "protobufjs";

// ============================================================
//  类型工具
// ============================================================

const NUMBER_TYPES = new Set(["double", "float", "int32", "uint32", "sint32", "fixed32", "sfixed32"]);
const BIGINT_TYPES = new Set(["int64", "uint64", "sint64", "fixed64", "sfixed64"]);

/** proto 基础类型 → 对应 Writer/Reader 方法名 */
const WIRE_METHOD: Record<string, string> = {
    double: "double", float: "float",
    int32: "int32", uint32: "uint32", sint32: "sint32",
    fixed32: "fixed32", sfixed32: "sfixed32",
    int64: "int64", uint64: "uint64", sint64: "sint64",
    fixed64: "fixed64", sfixed64: "sfixed64",
    bool: "bool",
    string: "string",
    bytes: "bytes",
};

/** proto 基础类型 → TypeScript 类型名 */
function protoTypeToTs(protoType: string, forceBigint = true): string {
    if (NUMBER_TYPES.has(protoType)) return "number";
    if (BIGINT_TYPES.has(protoType)) return forceBigint ? "bigint" : "number";
    if (protoType === "bool") return "boolean";
    if (protoType === "string") return "string";
    if (protoType === "bytes") return "Uint8Array";
    return "unknown";
}

/** wireType for a proto scalar type */
function wireType(protoType: string): number {
    if (["double", "fixed64", "sfixed64"].includes(protoType)) return 1;
    if (["float", "fixed32", "sfixed32"].includes(protoType)) return 5;
    if (["string", "bytes"].includes(protoType)) return 2;
    return 0; // varint
}

/** (fieldId << 3) | wt */
function makeTag(fieldId: number, wt: number): number {
    return (fieldId << 3) | wt;
}

// ============================================================
//  限定名工具
// ============================================================

function qualName(obj: NamespaceBase): string {
    const parts: string[] = [];
    let cur: NamespaceBase | null = obj;
    while (cur && !(cur instanceof Root)) {
        parts.unshift(cur.name);
        cur = cur.parent;
    }
    return parts.join(".");
}

function ifaceName(obj: NamespaceBase): string {
    const parts: string[] = [];
    let cur: NamespaceBase | null = obj;
    while (cur && !(cur instanceof Root)) {
        parts.unshift(cur === obj ? "I" + cur.name : cur.name);
        cur = cur.parent;
    }
    return parts.join(".");
}

// ============================================================
//  Proto 文件 → 输出文件分组
// ============================================================

/** 收集 root 中所有类型，按 filename 分组 */
function groupByProtoFile(root: Root): Map<string, (Type | Enum)[]> {
    const map = new Map<string, (Type | Enum)[]>();

    function walk(ns: NamespaceBase) {
        for (const child of ns.nestedArray) {
            if (child instanceof Type || child instanceof Enum) {
                const file = (child as any).filename as string | undefined;
                const key = file ? path.normalize(file) : "__unknown__";
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(child);
                if (child instanceof Type) walk(child); // 处理嵌套 type
            } else if (child instanceof Namespace) {
                walk(child);
            }
        }
    }
    walk(root);
    return map;
}

/** proto 文件路径 → 输出 .ts 相对路径（保留目录结构，扩展名换 .ts） */
function protoFileToTsPath(protoFile: string, protoRootPath: string): string {
    const rel = path.relative(protoRootPath, protoFile);
    return rel.replace(/\\/g, "/").replace(/\.proto$/, ".ts");
}

// ============================================================
//  代码生成器
// ============================================================

export interface INativeTsGenerateOptions {
    protoRootPath: string;
    nativeTsPath: string;
    /** 若提供，比较 hash 决定是否跳过未变更文件 */
    incrementalHashes?: Map<string, string>;
}

export class NativeTsGenerator {
    private protoRootPath: string;
    private nativeTsPath: string;

    constructor(opts: INativeTsGenerateOptions) {
        this.protoRootPath = opts.protoRootPath;
        this.nativeTsPath = opts.nativeTsPath;
    }

    generate(root: Root, opts: INativeTsGenerateOptions): Map<string, string> {
        const fileHashes = new Map<string, string>();
        const groups = groupByProtoFile(root);
        const allTsFiles: string[] = [];

        for (const [protoFile, nodes] of groups) {
            if (protoFile === "__unknown__") continue;

            const relTs = protoFileToTsPath(protoFile, this.protoRootPath);
            const absTs = path.join(this.nativeTsPath, relTs);
            allTsFiles.push(relTs);

            // 计算 proto 文件内容 hash 决定是否增量跳过
            const protoHash = fileHash(protoFile);
            fileHashes.set(relTs, protoHash);

            if (opts.incrementalHashes?.get(relTs) === protoHash && fs.existsSync(absTs)) {
                continue; // 文件未变更，跳过
            }

            const code = this.emitFile(nodes, root, relTs);
            fs.mkdirSync(path.dirname(absTs), { recursive: true });
            fs.writeFileSync(absTs, code, "utf8");
        }

        // 生成 index.ts（重导出所有模块）
        this.writeIndexTs(allTsFiles);

        return fileHashes;
    }

    // ── 单个文件 ────────────────────────────────────────────────────

    private emitFile(nodes: (Type | Enum)[], root: Root, relTs: string): string {
        const writer = new CodeWriter();

        // 收集本文件需要从其他模块 import 的类型
        const imports = this.collectImports(nodes, relTs);

        // 文件头
        writer.ln(`import * as $protobuf from "protobufjs/minimal";`);
        // BigInt hooks（放在共享文件里也行，这里简单内联）
        writer.ln(`import Long from "long";`);
        writer.ln(`$protobuf.util.Long = Long as any;`);
        writer.ln(`($protobuf as any).configure();`);
        writer.ln(``);

        // 来自其他 .ts 文件的 import
        for (const [importPath, names] of imports) {
            writer.ln(`import { ${[...names].join(", ")} } from "${importPath}";`);
        }
        if (imports.size > 0) writer.ln(``);

        // 按命名空间层级分组输出
        const namespaceTree = buildNamespaceTree(nodes);
        this.emitNamespaceTree(namespaceTree, writer, /* depth */ 0);

        return writer.toString();
    }

    private emitNamespaceTree(tree: INamespaceTree, writer: CodeWriter, depth: number) {
        for (const [ns, { children, items }] of tree) {
            const keyword = depth === 0 ? "export namespace" : "namespace";
            writer.push(`${keyword} ${ns} {`);

            // 先输出嵌套命名空间
            if (children.size > 0) {
                this.emitNamespaceTree(children, writer, depth + 1);
            }

            // 再输出类型
            for (const node of items) {
                writer.ln(``);
                if (node instanceof Enum) {
                    this.emitEnum(node, writer);
                } else {
                    this.emitType(node, writer);
                }
            }

            writer.pop(`}`);
            writer.ln(``);
        }
    }

    private emitEnum(obj: Enum, writer: CodeWriter) {
        writer.push(`export enum ${obj.name} {`);
        const entries = Object.entries(obj.values);
        for (let i = 0; i < entries.length; i++) {
            const [key, val] = entries[i];
            writer.ln(`${key} = ${val}${i < entries.length - 1 ? "," : ""}`);
        }
        writer.pop(`}`);
    }

    private emitType(obj: Type, writer: CodeWriter) {
        const qn = qualName(obj);   // e.g. zero.common.ActiveBattlePass
        const ifn = ifaceName(obj); // e.g. zero.common.IActiveBattlePass

        // ── interface ──
        writer.push(`export interface I${obj.name} {`);
        for (const field of obj.fieldsArray) {
            writer.ln(`${field.name}?: ${this.interfaceFieldType(field)};`);
        }
        writer.pop(`}`);
        writer.ln(``);

        // ── class ──
        writer.push(`export class ${obj.name} implements I${obj.name} {`);

        // 属性声明
        for (const field of obj.fieldsArray) {
            const { decl } = this.classFieldDecl(field);
            writer.ln(`${decl}`);
        }
        writer.ln(``);

        // constructor
        writer.push(`constructor(properties?: ${ifn}) {`);
        writer.push(`if (properties) {`);
        writer.ln(`for (const key of Object.keys(properties) as (keyof ${ifn})[]) {`);
        writer.ln(`    (this as any)[key] = (properties as any)[key];`);
        writer.ln(`}`);
        writer.pop(`}`);
        writer.pop(`}`);
        writer.ln(``);

        // encode
        this.emitEncode(obj, writer);
        writer.ln(``);

        // decode
        this.emitDecode(obj, writer);
        writer.ln(``);

        // toObject
        this.emitToObject(obj, writer);

        writer.pop(`}`);
    }

    // ── encode ────────────────────────────────────────────────────────

    private emitEncode(obj: Type, writer: CodeWriter) {
        const ifn = ifaceName(obj);
        writer.push(`static encode(message: ${ifn}, writer?: $protobuf.Writer): $protobuf.Writer {`);
        writer.ln(`if (!writer) writer = $protobuf.Writer.create();`);

        for (const field of obj.fieldsArray) {
            this.emitEncodeField(field, writer);
        }

        writer.ln(`return writer;`);
        writer.pop(`}`);
    }

    private emitEncodeField(field: Field, writer: CodeWriter) {
        const name = field.name;
        const guard = `message.${name} != null && Object.hasOwnProperty.call(message, "${name}")`;

        if (field.repeated) {
            writer.push(`if (${guard})`);
            writer.push(`for (let i = 0; i < message.${name}!.length; ++i) {`);
            this.emitScalarOrMessageWrite(field, `message.${name}![i]`, writer, field.id);
            writer.pop(`}`);
            writer.pop(``);
            return;
        }

        if ((field as MapField).map) {
            this.emitMapEncodeField(field as MapField, writer);
            return;
        }

        // 普通字段
        writer.push(`if (${guard}) {`);
        this.emitScalarOrMessageWrite(field, `message.${name}!`, writer, field.id);
        writer.pop(`}`);
    }

    private emitScalarOrMessageWrite(
        field: Field,
        valueExpr: string,
        writer: CodeWriter,
        fieldId: number,
    ) {
        const resolved = (field as any).resolvedType;
        if (resolved instanceof Type) {
            const refClass = qualName(resolved);
            const tag = makeTag(fieldId, 2);
            writer.ln(`${refClass}.encode(${valueExpr}, writer!.uint32(${tag}).fork()).ldelim();`);
        } else if (resolved instanceof Enum) {
            const tag = makeTag(fieldId, 0);
            writer.ln(`writer!.uint32(${tag}).int32(${valueExpr});`);
        } else {
            const wt = wireType(field.type);
            const tag = makeTag(fieldId, wt);
            const method = WIRE_METHOD[field.type] ?? "bytes";
            writer.ln(`writer!.uint32(${tag}).${method}(${valueExpr});`);
        }
    }

    private emitMapEncodeField(field: MapField, writer: CodeWriter) {
        const name = field.name;
        const outerTag = makeTag(field.id, 2);
        const keyTag = makeTag(1, wireType(field.keyType));
        const keyMethod = WIRE_METHOD[field.keyType] ?? "string";

        writer.push(`if (message.${name} != null && message.${name}.size) {`);
        writer.push(`for (const [k, v] of message.${name}!) {`);

        const resolved = (field as any).resolvedType;
        if (resolved instanceof Type) {
            const refClass = qualName(resolved);
            const valTag = makeTag(2, 2);
            writer.ln(`writer!.uint32(${outerTag}).fork().uint32(${keyTag}).${keyMethod}(k);`);
            writer.ln(`${refClass}.encode(v, writer!.uint32(${valTag}).fork()).ldelim().ldelim();`);
        } else if (resolved instanceof Enum) {
            const valTag = makeTag(2, 0);
            writer.ln(`writer!.uint32(${outerTag}).fork().uint32(${keyTag}).${keyMethod}(k).uint32(${valTag}).int32(v).ldelim();`);
        } else {
            const valWt = wireType(field.type);
            const valTag = makeTag(2, valWt);
            const valMethod = WIRE_METHOD[field.type] ?? "bytes";
            writer.ln(`writer!.uint32(${outerTag}).fork().uint32(${keyTag}).${keyMethod}(k).uint32(${valTag}).${valMethod}(v).ldelim();`);
        }

        writer.pop(`}`);
        writer.pop(`}`);
    }

    // ── decode ────────────────────────────────────────────────────────

    private emitDecode(obj: Type, writer: CodeWriter) {
        const qn = qualName(obj);
        writer.push(`static decode(reader: $protobuf.Reader | Uint8Array, length?: number): ${obj.name} {`);
        writer.ln(`if (!(reader instanceof $protobuf.Reader)) reader = $protobuf.Reader.create(reader);`);
        writer.ln(`const end = length === undefined ? reader.len : reader.pos + length;`);
        writer.ln(`const message = new ${obj.name}();`);
        writer.push(`while (reader.pos < end) {`);
        writer.ln(`const tag = reader.uint32();`);
        writer.push(`switch (tag >>> 3) {`);

        for (const field of obj.fieldsArray) {
            this.emitDecodeCase(field, writer);
        }

        writer.push(`default:`);
        writer.ln(`reader.skipType(tag & 7);`);
        writer.ln(`break;`);
        writer.pop(``);

        writer.pop(`}`); // switch
        writer.pop(`}`); // while

        writer.ln(`return message;`);
        writer.pop(`}`);
    }

    private emitDecodeCase(field: Field, writer: CodeWriter) {
        writer.push(`case ${field.id}: {`);

        const name = field.name;

        if ((field as MapField).map) {
            this.emitMapDecodeCase(field as MapField, writer);
        } else if (field.repeated) {
            writer.push(`if (!message.${name}) message.${name} = [];`);
            const resolved = (field as any).resolvedType;
            if (resolved instanceof Type) {
                const refClass = qualName(resolved);
                writer.ln(`message.${name}!.push(${refClass}.decode(reader, reader.uint32()));`);
            } else if (resolved instanceof Enum) {
                writer.ln(`message.${name}!.push(reader.int32());`);
            } else {
                const method = WIRE_METHOD[field.type] ?? "bytes";
                writer.ln(`message.${name}!.push(reader.${method}());`);
            }
            writer.pop(``);
        } else {
            const resolved = (field as any).resolvedType;
            if (resolved instanceof Type) {
                const refClass = qualName(resolved);
                writer.ln(`message.${name} = ${refClass}.decode(reader, reader.uint32());`);
            } else if (resolved instanceof Enum) {
                writer.ln(`message.${name} = reader.int32();`);
            } else {
                const method = WIRE_METHOD[field.type] ?? "bytes";
                writer.ln(`message.${name} = reader.${method}();`);
            }
        }

        writer.ln(`break;`);
        writer.pop(`}`);
    }

    private emitMapDecodeCase(field: MapField, writer: CodeWriter) {
        const name = field.name;
        const keyMethod = WIRE_METHOD[field.keyType] ?? "string";
        const resolved = (field as any).resolvedType;

        writer.ln(`if (!(message.${name} instanceof Map)) message.${name} = new Map();`);
        writer.ln(`const end2 = reader.uint32() + reader.pos;`);
        writer.ln(`let key: any = ${defaultValueExpr(field.keyType)};`);
        writer.ln(`let value: any = null;`);
        writer.push(`while (reader.pos < end2) {`);
        writer.ln(`const tag2 = reader.uint32();`);
        writer.push(`switch (tag2 >>> 3) {`);

        // key = field 1
        writer.push(`case 1:`);
        writer.ln(`key = reader.${keyMethod}();`);
        writer.ln(`break;`);
        writer.pop(``);

        // value = field 2
        writer.push(`case 2:`);
        if (resolved instanceof Type) {
            const refClass = qualName(resolved);
            writer.ln(`value = ${refClass}.decode(reader, reader.uint32());`);
        } else if (resolved instanceof Enum) {
            writer.ln(`value = reader.int32();`);
        } else {
            const method = WIRE_METHOD[field.type] ?? "bytes";
            writer.ln(`value = reader.${method}();`);
        }
        writer.ln(`break;`);
        writer.pop(``);

        writer.push(`default:`);
        writer.ln(`reader.skipType(tag2 & 7);`);
        writer.ln(`break;`);
        writer.pop(``);

        writer.pop(`}`); // switch
        writer.pop(`}`); // while
        writer.ln(`message.${name}!.set(key, value);`);
    }

    // ── toObject ──────────────────────────────────────────────────────

    private emitToObject(obj: Type, writer: CodeWriter) {
        writer.push(`static toObject(message: ${obj.name}, options?: $protobuf.IConversionOptions): { [k: string]: any } {`);
        writer.ln(`const object: { [k: string]: any } = {};`);

        // defaults block
        const defaultFields = obj.fieldsArray.filter((f) => {
            if ((f as MapField).map || f.repeated) return false;
            const resolved = (f as any).resolvedType;
            if (resolved instanceof Type) return false;
            return true;
        });

        if (defaultFields.length > 0) {
            writer.push(`if (options?.defaults) {`);
            for (const field of defaultFields) {
                const resolved = (field as any).resolvedType;
                let def: string;
                if (resolved instanceof Enum) {
                    def = "0";
                } else if (BIGINT_TYPES.has(field.type)) {
                    def = "BigInt(0)";
                } else if (field.type === "string") {
                    def = '""';
                } else if (field.type === "bool") {
                    def = "false";
                } else if (field.type === "bytes") {
                    def = "new Uint8Array()";
                } else {
                    def = "0";
                }
                writer.ln(`object.${field.name} = ${def};`);
            }
            writer.pop(`}`);
        }

        // 字段赋值
        for (const field of obj.fieldsArray) {
            this.emitToObjectField(field, writer);
        }

        writer.ln(`return object;`);
        writer.pop(`}`);
    }

    private emitToObjectField(field: Field, writer: CodeWriter) {
        const name = field.name;
        const resolved = (field as any).resolvedType;

        if ((field as MapField).map) {
            writer.push(`if (message.${name} && message.${name}.size) {`);
            writer.ln(`const map: { [k: string]: any } = {};`);
            writer.push(`for (const [k, v] of message.${name}) {`);
            if (resolved instanceof Type) {
                const refClass = qualName(resolved);
                writer.ln(`map[String(k)] = ${refClass}.toObject(v, options);`);
            } else {
                writer.ln(`map[String(k)] = v;`);
            }
            writer.pop(`}`);
            writer.ln(`object.${name} = map;`);
            writer.pop(`}`);
            return;
        }

        writer.push(`if (message.${name} != null && message.hasOwnProperty("${name}")) {`);
        if (field.repeated) {
            if (resolved instanceof Type) {
                const refClass = qualName(resolved);
                writer.ln(`object.${name} = message.${name}!.map((v) => ${refClass}.toObject(v, options));`);
            } else {
                writer.ln(`object.${name} = message.${name}!.slice();`);
            }
        } else if (resolved instanceof Type) {
            const refClass = qualName(resolved);
            writer.ln(`object.${name} = ${refClass}.toObject(message.${name}!, options);`);
        } else {
            writer.ln(`object.${name} = message.${name};`);
        }
        writer.pop(`}`);
    }

    // ── 接口/类字段类型 ───────────────────────────────────────────────

    private interfaceFieldType(field: Field): string {
        if (field.repeated) return `(${this.elemType(field)}[]|null)`;
        if ((field as MapField).map) {
            const keyT = protoTypeToTs(field.keyType ?? "string");
            const valT = this.elemType(field);
            return `(Map<${keyT}, ${valT}>|null)`;
        }
        const base = this.elemType(field);
        return `(${base}|null)`;
    }

    private classFieldDecl(field: Field): { decl: string } {
        const name = field.name;
        if (field.repeated) {
            const elem = this.elemType(field);
            return { decl: `${name}: ${elem}[] = [];` };
        }
        if ((field as MapField).map) {
            const keyT = protoTypeToTs(field.keyType ?? "string");
            const valT = this.elemType(field);
            return { decl: `${name}: Map<${keyT}, ${valT}> = new Map();` };
        }
        const resolved = (field as any).resolvedType;
        if (resolved instanceof Type) {
            return { decl: `${name}?: ${ifaceName(resolved)} | null;` };
        }
        if (field.partOf) {
            const base = this.elemType(field);
            return { decl: `${name}?: ${base} | null;` };
        }
        if (BIGINT_TYPES.has(field.type)) {
            return { decl: `${name}: bigint = BigInt(0);` };
        }
        const base = this.elemType(field);
        return { decl: `${name}: ${base} = ${defaultValueExpr(field.type)};` };
    }

    private elemType(field: Field): string {
        const resolved = (field as any).resolvedType;
        if (resolved instanceof Enum) return qualName(resolved);
        if (resolved instanceof Type) return ifaceName(resolved);
        return protoTypeToTs(field.type);
    }

    // ── import 收集 ────────────────────────────────────────────────────

    private collectImports(
        nodes: (Type | Enum)[],
        currentRelTs: string,
    ): Map<string, Set<string>> {
        // 找到所有 Type 字段引用的外部类型
        const imports = new Map<string, Set<string>>();

        const addImport = (refFile: string | undefined, className: string, iface?: string) => {
            if (!refFile) return;
            const refTs = protoFileToTsPath(refFile, this.protoRootPath);
            if (refTs === currentRelTs) return;

            // 相对 import 路径
            let rel = path
                .relative(path.dirname(currentRelTs), refTs)
                .replace(/\\/g, "/")
                .replace(/\.ts$/, "");
            if (!rel.startsWith(".")) rel = "./" + rel;

            if (!imports.has(rel)) imports.set(rel, new Set());
            imports.get(rel)!.add(className);
            if (iface) imports.get(rel)!.add(iface);
        };

        const walkType = (obj: Type) => {
            for (const field of obj.fieldsArray) {
                const resolved = (field as any).resolvedType;
                if (resolved instanceof Type) {
                    const refFile = (resolved as any).filename as string | undefined;
                    addImport(refFile, resolved.name, "I" + resolved.name);
                } else if (resolved instanceof Enum) {
                    const refFile = (resolved as any).filename as string | undefined;
                    addImport(refFile, resolved.name);
                }
            }
        };

        for (const node of nodes) {
            if (node instanceof Type) walkType(node);
        }
        return imports;
    }

    // ── index.ts ───────────────────────────────────────────────────────

    private writeIndexTs(relPaths: string[]) {
        const lines: string[] = [`// Auto generated - do not edit manually`, ``];
        for (const rel of relPaths.sort()) {
            const mod = "./" + rel.replace(/\.ts$/, "");
            lines.push(`export * from "${mod}";`);
        }
        const dest = path.join(this.nativeTsPath, "index.ts");
        fs.mkdirSync(this.nativeTsPath, { recursive: true });
        fs.writeFileSync(dest, lines.join("\n") + "\n", "utf8");
    }
}

// ============================================================
//  命名空间树（用于分层输出 namespace {} 块）
// ============================================================

interface INamespaceNode {
    children: INamespaceTree;
    items: (Type | Enum)[];
}

type INamespaceTree = Map<string, INamespaceNode>;

function buildNamespaceTree(nodes: (Type | Enum)[]): INamespaceTree {
    const tree: INamespaceTree = new Map();

    for (const node of nodes) {
        // 只处理直接从 Type/Enum 向上找到的命名空间层级
        const parts = getNamespaceParts(node);
        let cur = tree;
        for (const part of parts) {
            if (!cur.has(part)) cur.set(part, { children: new Map(), items: [] });
            cur = cur.get(part)!.children;
        }
        // 最终节点放在父命名空间的 items 里
        // （parts 是 node 的父命名空间列表，不含 node 自身）
        // 重新找一遍放入位置
        let target = tree;
        let targetNode: INamespaceNode | undefined;
        for (const part of parts) {
            targetNode = target.get(part)!;
            target = targetNode.children;
        }
        if (targetNode) {
            targetNode.items.push(node);
        } else {
            // 根级别（无命名空间）
            if (!tree.has("__root__")) tree.set("__root__", { children: new Map(), items: [] });
            tree.get("__root__")!.items.push(node);
        }
    }

    return tree;
}

function getNamespaceParts(node: NamespaceBase): string[] {
    const parts: string[] = [];
    let cur = node.parent;
    while (cur && !(cur instanceof Root)) {
        parts.unshift(cur.name);
        cur = cur.parent;
    }
    return parts;
}

// ============================================================
//  工具
// ============================================================

function defaultValueExpr(protoType: string): string {
    if (protoType === "string") return '""';
    if (protoType === "bool") return "false";
    if (protoType === "bytes") return "new Uint8Array()";
    if (BIGINT_TYPES.has(protoType)) return "BigInt(0)";
    return "0";
}

function fileHash(filePath: string): string {
    try {
        return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
    } catch {
        return "";
    }
}

// ============================================================
//  代码输出缓冲
// ============================================================

class CodeWriter {
    private buf: string[] = [];
    private depth = 0;
    private ind = "    "; // 4 spaces

    ln(code: string) {
        if (code === "") {
            this.buf.push("");
        } else {
            this.buf.push(this.ind.repeat(this.depth) + code);
        }
    }

    push(code: string) {
        this.ln(code);
        this.depth++;
    }

    pop(code: string) {
        this.depth = Math.max(0, this.depth - 1);
        if (code !== "") this.ln(code);
    }

    toString() {
        return this.buf.join("\n") + "\n";
    }
}
