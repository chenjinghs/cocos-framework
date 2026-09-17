import { F } from "k-ts-framework";
import * as protobuf from "protobufjs";

const Long = require("long");

import { EngineBuffer, HeaderType, MESSAGE_COVERT_OPTIONS } from "./Define";

/**
 * 强制使用number替代long
 */
export function useNumberInsteadOfLong() {
    protobuf.util.Long = undefined as any;
    MESSAGE_COVERT_OPTIONS.longs = Number;
    MESSAGE_COVERT_OPTIONS.useBigIntInsteadOfLong = false;
    protobuf.configure();
}

/**
 * 使用bigint代替所有pb中64位的整数类型(int64, sint64, uint64, fixed64, sfixed64)
 * 开启此选项后默认开启convertPBMapToJSMap，因为object的key只能为string，number和symbol，bigint和long都无法作为object的key
 */
export function useBigIntInsteadOfLong() {
    protobuf.util.Long = Long;
    MESSAGE_COVERT_OPTIONS.longs = Long as any;
    MESSAGE_COVERT_OPTIONS.useBigIntInsteadOfLong = true;
    MESSAGE_COVERT_OPTIONS.convertPBMapToJSMap = true;
    protobuf.configure();
}

/**
 * 将PBMap直接转换为JSMap
 */
export function convertPBMapToJSMap() {
    MESSAGE_COVERT_OPTIONS.convertPBMapToJSMap = true;
}

/**
 * 将一个ue buffer转化为ts buffer
 * @param buffer
 * @returns
 */
export function EngineBufferToUint8Array(buffer: EngineBuffer, offset: number = 0, bufferLen: number = -1): Uint8Array {
    let length = bufferLen < 0 ? buffer.Num() : bufferLen;
    F.assert(offset <= length);
    if (offset === length) return new Uint8Array();

    let retBufferLen = length - offset;
    let ret = new Uint8Array(retBufferLen);
    for (let i = 0; i < retBufferLen; i++) {
        ret[i] = buffer.Get(i + offset);
    }
    return ret;
}

/**
 * 将array buffer转换成ue buffer
 * @param buffer
 * @param offset
 * @param bufferLen
 * @returns
 */
export function arrayBufferToUint8Array(buffer: Array<number>, offset: number, bufferLen?: number): Uint8Array {
    let length = bufferLen || buffer.length;
    F.assert(offset <= length);
    if (offset === length) return new Uint8Array();

    // let retBufferLen = length - offset;
    return new Uint8Array(buffer.slice(offset, bufferLen));
}

/**
 * 编码
 * @param target 要编码的object，必须以decorator message 标注
 * @param headerType 包头如何存储
 * @param canHaveNoBody 如果object为空，是否只打包头
 * @param ignoreError 是否忽略错误
 * @returns EngineBuffer
 */
export const encodeToEngineBuffer = F.createUtilLinker<(target: object, headerType: HeaderType, canHaveNoBody: boolean, ignoreError?: boolean) => EngineBuffer | undefined>();

/**
 * 编码
 * @param target 要编码的object，必须以decorator message 标注
 * @param headerType 包头如何存储
 * @param canHaveNoBody 如果object为空，是否只打包头
 * @param ignoreError 是否忽略错误
 * @returns Array<number>
 */
export const encodeToArrayBuffer = F.createUtilLinker<(target: object, headerType: HeaderType, canHaveNoBody: boolean, ignoreError?: boolean) => Array<number> | undefined>();

/**
 * 编码
 * @param target 要编码的object，必须以decorator message 标注
 * @param messageType protobufjs的message type
 * @returns protobufjs 直接输出的buffer
 */

export const encodePBRawBuffer = F.createUtilLinker<(target: object, messageType: protobuf.Type) => Uint8Array | undefined>();

/**
 * 解码
 * @param buffer Buffer
 * @param headerType 包头如何存储
 * @param targetCtor 如果包头是HeadType.none，那么需要手动传入object的constructor
 * @param bufferOffset 可使用的buffer起始偏移量
 * @param bufferLen 可使用的buffer长度
 * @returns 解码出来的object
 */
export const decode = F.createUtilLinker<<T>(buffer: EngineBuffer | Array<number>, headerType: HeaderType, targetCtor?: F.Constructor, bufferOffset?: number, bufferLen?: number) => T | undefined>();

/**
 * 解码
 * @param messageType: protobuf message type
 * @param rawBuffer protobuf Buffer
 * @returns 解码出来的object
 */
export const decodeFromPBRawBuffer = F.createUtilLinker<(rawBuffer: Uint8Array, messageType: protobuf.Type, opts?: protobuf.IConversionOptions) => { [k: string]: any }>();

export const decodeFromPBMessageObject = F.createUtilLinker<(target: object, messageType: protobuf.Type, allowUnknownFields?: boolean) => object | undefined>();

export const encodeToPBMessageObject = F.createUtilLinker<(target: object, messageType: protobuf.Type) => object | undefined>();
