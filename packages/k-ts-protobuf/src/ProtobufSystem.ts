import { D, F } from "k-ts-framework";
import { Field, FieldBase, IConversionOptions, MapField, Root, Type, util } from "protobufjs";

import { Constructor, EngineBuffer, HeaderType, MESSAGE_COVERT_OPTIONS, PROTOBUF_SYSTEM_TAG, ValueType } from "./Define";
import { TArray } from "./Engine";
import { MapInfo, PackageInfo, ProtoBufRegistry, ProtobufStore } from "./ProtobufStore";
import { arrayBufferToUint8Array, decode, decodeFromPBMessageObject, decodeFromPBRawBuffer, encodePBRawBuffer, encodeToArrayBuffer, encodeToEngineBuffer, encodeToPBMessageObject, EngineBufferToUint8Array } from "./Util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Long = require("long");

const HEADER_ID_SIZE = 2;
const MAX_HEADER_ID = 65535;

// TODO：待优化，贼费
@D.system(PROTOBUF_SYSTEM_TAG, ProtobufStore)
class ProtobufSystem extends F.System {
    public init() {
        this.modify(ProtobufStore.getSingleton(), (store) => {
            store.root = new Root();
            store.ctorToPBMessageType.clear();
            store.ctorToMessageId.clear();
            store.messageIdToCtor.clear();
            store.nameToCtor.clear();
            constructProtobuf(store);
            return true;
        });

        return true;
    }

    /**
     * 编码
     * @param target 要编码的object，必须以decorator message 标注
     * @param headerType 包头如何存储
     * @param canHaveNoBody 如果object为空，是否只打包头
     * @param ignoreError 是否忽略错误
     * @returns EngineBuffer
     */
    @D.linkUtil(encodeToEngineBuffer)
    public encodeToEngineBuffer(target: object, headerType: HeaderType, canHaveNoBody: boolean, ignoreError?: boolean): TArray<number> | undefined {
        return this.encode(target, headerType, canHaveNoBody, ignoreError, uint8Buffer2EngineBufferWithHeader);
    }

    /**
     * 编码
     * @param target 要编码的object，必须以decorator message 标注
     * @param headerType 包头如何存储
     * @param canHaveNoBody 如果object为空，是否只打包头
     * @param ignoreError 是否忽略错误
     * @returns ArrayBuffer
     */
    @D.linkUtil(encodeToArrayBuffer)
    public encodeToArrayBuffer(target: object, headerType: HeaderType, canHaveNoBody: boolean, ignoreError?: boolean): Array<number> | undefined {
        return this.encode(target, headerType, canHaveNoBody, ignoreError, uint8Buffer2ArrayBufferWithHeader);
    }

    @D.linkUtil(encodePBRawBuffer)
    public encodePBRawBuffer(target: object, messageType: Type) {
        // 要对object做深拷贝，不然map2object会导致原数据变化
        const cloneObject = cloneMessage(target, messageType, MESSAGE_COVERT_OPTIONS);

        // 验证数据有效性
        let err = messageType.verify(cloneObject);
        if (err) {
            this.error(err);
            return undefined;
        }

        // 创建Message实例，并序列化
        let message = messageType.create(cloneObject);
        return messageType.encode(message).finish();
    }

    public encode(
        target: object,
        headerType: HeaderType,
        canHaveNoBody: boolean,
        ignoreError: boolean | undefined,
        convertFunc: (ctor: Constructor, messageType: Type, rawBuffer?: Uint8Array, headerType?: HeaderType) => any,
    ) {
        let ctor = target.constructor as Constructor;
        let messageType = ProtobufStore.getSingleton().ctorToPBMessageType?.get(ctor);
        if (!messageType) {
            if (!ignoreError) this.error(`can not find protobuf ${ctor.name} declaration when encode`);
            return;
        }

        if (canHaveNoBody) {
            let messageInfo = F.Env.getCurrentData(ProtoBufRegistry).ctorToMessageInfo.get(ctor);
            F.assert(messageInfo);

            if (messageInfo.fields.length === 0) return convertFunc(ctor, messageType, undefined, headerType);
        }

        let rawBuffer = this.encodePBRawBuffer(target, messageType);
        return convertFunc(ctor, messageType, rawBuffer, headerType);
    }

    /**
     * 解码
     * @param buffer Buffer
     * @param headerType 包头如何存储
     * @param targetCtor 如果包头是HeadType.none，那么需要手动传入object的constructor
     * @param bufferOffset 可使用的buffer起始偏移量
     * @param bufferLen 可使用的buffer长度
     */
    @D.linkUtil(decode)
    public decode<T>(buffer: EngineBuffer | Array<number>, headerType: HeaderType, targetCtor?: Constructor, bufferOffset?: number, bufferLen?: number): T | undefined {
        let offset = [0]; // 为了传out搞了这么个奇怪的玩意儿
        let isEngineBuffer = "Num" in buffer;

        let ctor = findCtorFromBuffer(buffer, isEngineBuffer, headerType, targetCtor, bufferOffset, bufferLen, offset);
        if (!ctor) return;

        let messageType = ProtobufStore.getSingleton().ctorToPBMessageType?.get(ctor);
        if (!messageType) return;

        // 反序列化buffer为object
        let rawBuffer = isEngineBuffer ? EngineBufferToUint8Array(buffer as EngineBuffer, offset[0], bufferLen) : arrayBufferToUint8Array(buffer as Array<number>, offset[0], bufferLen);
        // if (!rawBuffer) return new ctor();

        let object = this.decodeFromPBRawBuffer(rawBuffer, messageType);
        Object.setPrototypeOf(object, ctor.prototype);
        return object;
    }

    @D.linkUtil(decodeFromPBRawBuffer)
    public decodeFromPBRawBuffer(rawBuffer: Uint8Array, messageType: Type, opts?: IConversionOptions) {
        let options = opts ?? MESSAGE_COVERT_OPTIONS;
        let message = messageType.decode(rawBuffer);
        let object = messageType.toObject(message, options);
        return rebuildMessage(object, messageType, MESSAGE_COVERT_OPTIONS);
    }

    @D.linkUtil(decodeFromPBMessageObject)
    public decodeFromPBMessageObject(target: object, messageType: Type, allowUnknownFields?: boolean) {
        return rebuildMessage(target, messageType, MESSAGE_COVERT_OPTIONS, allowUnknownFields);
    }

    @D.linkUtil(encodeToPBMessageObject)
    public encodeToPBMessageObject(target: object, messageType: Type) {
        let cloneObject = cloneMessage(target, messageType, MESSAGE_COVERT_OPTIONS);
        // 验证数据有效性
        let err = messageType.verify(cloneObject);
        if (err) {
            this.error(err);
            return undefined;
        }
        return cloneObject;
    }
}

// ////////////////////////////////////////////////////////////////////////
function constructProtobuf(store: ProtobufStore) {
    let root = store.root;
    let ctorToPBMessageType = store.ctorToPBMessageType;
    let ctorToMessageId = store.ctorToMessageId;
    let messageIdToCtor = store.messageIdToCtor;
    let nameToCtor = store.nameToCtor;

    let packageInfos = F.Env.getCurrentData(ProtoBufRegistry).packageInfos;
    packageInfos.sort((s: PackageInfo, t: PackageInfo) => {
        let a = s.name.toLowerCase();
        let b = t.name.toLowerCase();
        return a < b ? -1 : a > b ? 1 : 0;
    });
    // registry.forEach((v) => console.log(`protobuf define message ${v.name}`));

    let getValueTypeString = function (type: ValueType | Constructor) {
        return typeof type === "string" ? type : type.name;
    };

    interface info {
        id?: number;
        name: string;
    }
    let fnSort = (s: info, t: info): number => {
        // 有id就比id，没id比name，有id的永远排前面
        if (s.id !== undefined || t.id !== undefined) {
            if (s.id !== undefined && t.id !== undefined) return s.id < t.id ? -1 : s.id > t.id ? 1 : 0;
            else if (s.id !== undefined) return -1;
            else return 1;
        } else {
            let a = s.name.toLowerCase();
            let b = t.name.toLowerCase();
            return a < b ? -1 : a > b ? 1 : 0;
        }
    };

    let messageId = 0;
    for (let packageInfo of packageInfos) {
        let newPackage = root!.define(packageInfo.name);

        packageInfo.messages.sort(fnSort);

        // 开始攒message
        for (let messageInfo of packageInfo.messages) {
            console.log(`protobuf define message ${messageInfo.name}`);
            let newMessage = new Type(messageInfo.name);
            newPackage.add(newMessage);

            let ctor = messageInfo.target;
            // 这里先直接用name，理论上name冲突比较低
            // let fullName = packageInfo.name + "." + messageInfo.name;
            let fullName = messageInfo.name;
            F.assert(fullName.length < MAX_HEADER_ID);
            F.assert(!nameToCtor.has(fullName));
            F.assert(messageId < MAX_HEADER_ID);

            ctorToPBMessageType.set(ctor, newMessage);
            ctorToMessageId.set(ctor, messageId);
            messageIdToCtor.set(messageId, ctor);
            nameToCtor.set(fullName, ctor);
            ++messageId;

            messageInfo.fields.sort(fnSort);
            messageInfo.fields.forEach((fieldInfo, index) => {
                if (fieldInfo.constructor === MapInfo) {
                    let mapInfo = fieldInfo as MapInfo;
                    newMessage.add(new MapField(mapInfo.name, index, getValueTypeString(mapInfo.keyType), getValueTypeString(mapInfo.valueType)));
                } else {
                    newMessage.add(new Field(fieldInfo.name, index, getValueTypeString(fieldInfo.valueType), fieldInfo.rule));
                } // if (Object.getPrototypeOf(fieldInfo) === MapInfo)
            }); // messageInfo.fields.forEach((fieldInfo, index)
        } // for(let messageInfo of packageInfo.messages) {
    } // for (let packageInfo of registry) {
}

function writeUInt16ToEngineBuffer(id: number, buffer: EngineBuffer) {
    F.assert(id !== undefined && id < MAX_HEADER_ID);
    buffer.Add((id >> 8) & 255);
    buffer.Add(id & 255);
}

function writeUInt16ToArrayBuffer(id: number, buffer: Array<number>) {
    F.assert(id !== undefined && id < MAX_HEADER_ID);
    buffer.push((id >> 8) & 255);
    buffer.push(id & 255);
}

function readUInt16FromEngineBuffer(rawBuffer: EngineBuffer, offset: number = 0): number {
    F.assert(offset + HEADER_ID_SIZE <= rawBuffer.Num());
    return ((rawBuffer.Get(offset) as number) << 8) | rawBuffer.Get(offset + 1);
}

function readUInt16FromArrayBuffer(rawBuffer: Array<number>, offset: number = 0): number {
    F.assert(offset + HEADER_ID_SIZE <= rawBuffer.length);
    return ((rawBuffer[offset] as number) << 8) | rawBuffer[offset + 1];
}

function uint8Buffer2EngineBufferWithHeader(ctor: Constructor, messageType: Type, rawBuffer?: Uint8Array, headerType?: HeaderType) {
    let ret = F.Engine.NewByteArray();
    switch (headerType) {
        case HeaderType.Id: {
            let id = ProtobufStore.getSingleton()?.ctorToMessageId.get(ctor);
            F.assert(id !== undefined && id < MAX_HEADER_ID);
            writeUInt16ToEngineBuffer(id, ret);
            break;
        }

        case HeaderType.Name: {
            let nameLen = messageType.name.length;
            F.assert(nameLen < MAX_HEADER_ID);
            writeUInt16ToEngineBuffer(nameLen, ret);
            for (let i = 0; i < nameLen; i++) {
                ret.Add(messageType.name.charCodeAt(i));
            }
            break;
        }
    }

    if (rawBuffer) {
        for (const v of rawBuffer) {
            ret.Add(v);
        }
    }

    return ret;
}

function uint8Buffer2ArrayBufferWithHeader(ctor: Constructor, messageType: Type, rawBuffer?: Uint8Array, headerType?: HeaderType) {
    let ret = new Array<number>();
    switch (headerType) {
        case HeaderType.Id: {
            let id = ProtobufStore.getSingleton()?.ctorToMessageId.get(ctor);
            F.assert(id !== undefined && id < MAX_HEADER_ID);
            writeUInt16ToArrayBuffer(id, ret);
            break;
        }

        case HeaderType.Name: {
            let nameLen = messageType.name.length;
            F.assert(nameLen < MAX_HEADER_ID);
            writeUInt16ToArrayBuffer(nameLen, ret);
            for (let i = 0; i < nameLen; i++) {
                ret.push(messageType.name.charCodeAt(i));
            }
            break;
        }
    }

    if (rawBuffer) {
        ret = ret.concat(...rawBuffer);
    }

    return ret;
}

function findCtorFromBuffer(
    inputBuffer: EngineBuffer | Array<number>,
    isUEBuffer: boolean,
    headerType: HeaderType,
    targetCtor: Constructor | undefined,
    bufferOffset: number | undefined,
    bufferLen: number | undefined,
    outOffset: number[],
): Constructor | undefined {
    let offset = bufferOffset || 0;
    let EngineBuffer = inputBuffer as EngineBuffer;
    let arrayBuffer = inputBuffer as Array<number>;
    let len = bufferLen || (isUEBuffer ? EngineBuffer.Num() : arrayBuffer.length);
    if (offset + HEADER_ID_SIZE > len) return;

    if (headerType === HeaderType.None) {
        return targetCtor;
    } else if (headerType === HeaderType.Id) {
        let id = isUEBuffer ? readUInt16FromEngineBuffer(EngineBuffer, offset) : readUInt16FromArrayBuffer(arrayBuffer, offset);
        outOffset[0] = offset + HEADER_ID_SIZE;
        return ProtobufStore.getSingleton().messageIdToCtor?.get(id);
    } else if (headerType === HeaderType.Name) {
        // 贼费！！
        let nameLen = isUEBuffer ? readUInt16FromEngineBuffer(EngineBuffer, offset) : readUInt16FromArrayBuffer(arrayBuffer, offset);
        let name = "";
        for (let i = 0; i < nameLen; i++) {
            name += String.fromCharCode(isUEBuffer ? EngineBuffer.Get(i + HEADER_ID_SIZE) : arrayBuffer[i + HEADER_ID_SIZE]);
        }
        outOffset[0] = offset + HEADER_ID_SIZE + nameLen;
        return ProtobufStore.getSingleton().nameToCtor.get(name);
    }
    return undefined;
}

// /////////////////////////////////////////////////////////////////////////////////////
interface BuildOpts {
    useBigIntInsteadOfLong: boolean;
    convertPBMapToJSMap: boolean;
}

const KEY_TYPE_64 = new Set<string>(["int64", "uint64", "sint64", "fixed64", "sfixed64"]);
const UNSIGNED_TYPE_64 = "uint64";

function isUnsigned(type: string) {
    return type === UNSIGNED_TYPE_64;
}

function verifyResolveType(field: FieldBase) {
    if (!field.resolved) field.resolve();
    return field.resolvedType as Type;
}

function bigInt2Long(v: bigint, unsigned: boolean) {
    if (v === 0n) return Long.ZERO;
    let hi = v >> 32n;
    let lo = v & ~(hi << 32n);
    let ret = Long.fromBits(Number(lo), Number(hi), unsigned);
    return ret;
}

function long2BigInt(v: any, unsigned: boolean) {
    let value = v;
    if (typeof value === "string") value = util.longFromHash(value);
    else if (typeof value === "number") value = Long.fromNumber(value);
    let low = BigInt.asUintN(32, BigInt(value.low));
    let high = BigInt.asUintN(32, BigInt(value.high));
    let combined = (high << 32n) | low;
    return unsigned ? BigInt.asUintN(64, combined) : BigInt.asIntN(64, combined);
}

function rebuildArray(a: Array<any>, field: Field, opts: BuildOpts, allowUnknownFields?: boolean) {
    let length = a.length;
    let needConvertBigInt = opts.useBigIntInsteadOfLong && KEY_TYPE_64.has(field.type);
    let unsigned = isUnsigned(field.type);

    for (let i = 0; i < length; ++i) {
        let cur = a[i];
        if (needConvertBigInt) {
            a[i] = long2BigInt(cur, unsigned);
        } else if (opts.convertPBMapToJSMap && typeof cur === "object" && (field.resolvedType || field.resolve())) {
            a[i] = rebuildMessage(cur, field.resolvedType as Type, opts, allowUnknownFields);
        }
    }
    return a;
}

function convertNothing(...args: any[]) {
    return args[0];
}

function rebuildMap(o: any, field: MapField, opts: BuildOpts) {
    if (!opts.convertPBMapToJSMap && !opts.useBigIntInsteadOfLong) return o;

    let convertKey: any = field.keyType === "string" ? convertNothing : Number;
    let convertValue: any = field.resolvedType !== null ? rebuildMessage : convertNothing;
    let unsignedKey = isUnsigned(field.keyType);
    let unsignedValue = isUnsigned(field.type);

    if (opts.useBigIntInsteadOfLong) {
        F.assert(opts.convertPBMapToJSMap, `using bigint as protobuf decoded type must enable convertPBMapToJSMap`);

        if (KEY_TYPE_64.has(field.keyType)) convertKey = long2BigInt;
        if (KEY_TYPE_64.has(field.type)) convertValue = long2BigInt;
    }

    let entries = Object.entries(o);
    if (convertKey !== convertNothing || convertValue !== convertNothing) {
        for (let v of entries) {
            v[0] = convertKey(v[0], unsignedKey);
            v[1] = convertValue === long2BigInt ? long2BigInt(v[1], unsignedValue) : convertValue(v[1], field.resolvedType, opts);
        }
    }
    return new Map(entries);
}

function rebuildMessage(o: any, type: Type, opts: BuildOpts, allowUnknownFields: boolean = false) {
    if (typeof o !== "object" || o === null) return o;

    let fieldMap = new Map(Object.entries(type.fields));

    for (let k in o) {
        if (o.hasOwnProperty(k) === false) continue;
        let cur = o[k];
        let curField = fieldMap.get(k);
        // if (curField === undefined) curField = type.oneofs[k]?.fieldsArray[0];
        if (curField === undefined) {
            // 允许部分字段不存在，不存在的话
            F.assert(allowUnknownFields || typeof cur !== "object");
            continue;
        }

        if (curField.map) {
            o[k] = rebuildMap(cur, curField as unknown as MapField, opts);
        } else if (curField.repeated) {
            if (Array.isArray(cur)) {
                o[k] = rebuildArray(cur, curField, opts, allowUnknownFields);
            } else if (typeof cur === "object" && Object.keys(cur).length === 0) {
                o[k] = [];
            } else {
                F.assert(false, `repeated field ${k} must be array or empty object`);
            }
        } else if (typeof cur === "object" && !ArrayBuffer.isView(cur)) {
            if (KEY_TYPE_64.has(curField.type)) {
                if (opts.useBigIntInsteadOfLong) o[k] = long2BigInt(cur, isUnsigned(curField.type));
            } else if (curField.resolvedType || curField.resolve()) {
                // 这个时候可能需要自己手动 resolve 一下，如果 resolve 也失败了，那就是真的没有这个类型
                o[k] = rebuildMessage(cur, curField.resolvedType as Type, opts, allowUnknownFields);
            }
        }
    }
    return o;
}

// 抄的rfdc，因为要替换long类型，所以这里改了下
function copyBuffer(cur: any) {
    // Node 类型
    // if (cur instanceof Buffer) {
    //     return Buffer.from(cur);
    // }

    return new cur.constructor(cur.buffer.slice(), cur.byteOffset, cur.length);
}

function cloneArray(a: Array<unknown>, field: FieldBase, opts: BuildOpts) {
    let length = a.length;
    let unsigned = isUnsigned(field.type);
    let a2 = new Array(length);
    for (let i = 0; i < length; ++i) {
        let cur = a[i];
        if (typeof cur !== "object" || cur === null) {
            if (opts.useBigIntInsteadOfLong && typeof cur === "bigint") a2[i] = bigInt2Long(cur, unsigned);
            else a2[i] = cur;
            // } else if (Array.isArray(cur)) {
            //     a2[i] = cloneArray(cur, field, opts);
        } else if (ArrayBuffer.isView(cur)) {
            a2[i] = copyBuffer(cur);
        } else {
            a2[i] = cloneMessage(cur, field, opts);
        }
    }
    return a2;
}

function cloneRawMap(m: object, field: MapField, opts: BuildOpts) {
    let type = verifyResolveType(field);
    let entries = Object.entries(m);
    let r = {} as any;
    entries.forEach(([key, value]) => {
        key = String(key);
        r[key] = cloneMessage(value, type ?? field, opts);
    });
    return r;
}

function cloneMap(m: Map<any, any>, field: MapField, opts: BuildOpts) {
    // return new Map(cloneArray(Array.from(m.entries()), opts));
    let type = verifyResolveType(field);

    let r = {} as any;
    for (let [key, value] of m) {
        if (opts.useBigIntInsteadOfLong && typeof key === "bigint") key = bigInt2Long(key, isUnsigned(field.keyType)).toString();
        else key = String(key);

        r[key] = cloneMessage(value, type ?? field, opts);
    }
    return r;
}

function cloneMessage(o: any, typeOrField: Type | FieldBase, opts: BuildOpts) {
    let type: Type;
    if (!(typeOrField instanceof Type)) {
        if (typeof o !== "object" || o === null) {
            if (opts.useBigIntInsteadOfLong && typeof o === "bigint") return bigInt2Long(o, isUnsigned(typeOrField.type));
            else return o;
        }
        if (Array.isArray(o)) return cloneArray(o, typeOrField, opts);
        if (typeOrField.map) {
            if (opts.convertPBMapToJSMap) return cloneMap(o, typeOrField as MapField, opts);
            else return cloneRawMap(o, typeOrField as MapField, opts);
        }

        type = verifyResolveType(typeOrField);
    } else {
        type = typeOrField;
    }

    F.assert(type.fields);
    let fieldMap = new Map(Object.entries(type.fields));

    let o2 = {} as any;
    for (let k in o) {
        if (o.hasOwnProperty(k) === false) continue;
        let cur = o[k];
        let field = fieldMap.get(k);
        if (!field) continue;

        if (typeof cur !== "object" || cur === null) {
            if (opts.useBigIntInsteadOfLong && typeof cur === "bigint") o2[k] = bigInt2Long(cur, isUnsigned(field.type));
            else o2[k] = cur;
        } else if (cur instanceof Map) {
            o2[k] = cloneMap(cur, field as unknown as MapField, opts);
        } else if (Array.isArray(cur)) {
            o2[k] = cloneArray(cur, field, opts);
        } else if (ArrayBuffer.isView(cur)) {
            o2[k] = copyBuffer(cur);
        } else {
            o2[k] = cloneMessage(cur, field, opts);
        }
    }
    return o2;
}
