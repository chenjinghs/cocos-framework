import { F } from "k-ts-framework";

import { Constructor, DEFAULT_PB_PACKAGE_NAME, RuleType, ValueType } from "./Define";
import { FieldInfo, MapInfo, MessageInfo, PackageInfo, ProtoBufRegistry } from "./ProtobufStore";

// 参考 https://developers.google.com/protocol-buffers/docs/proto3?hl=en#scalar

function verifyMessageInfo(registry: ProtoBufRegistry, target: Constructor, id?: number): MessageInfo {
    let info = registry.ctorToMessageInfo.get(target);
    if (!info) {
        info = new MessageInfo(target, target.name, id);
        registry.ctorToMessageInfo.set(target, info);
    }
    return info;
}

export function registerMessage(target: Constructor, name: string, inPackageName?: string, id?: number) {
    let registry = F.Env.getCurrentData(ProtoBufRegistry);
    let packageInfos = registry.packageInfos;
    let packageName = inPackageName || DEFAULT_PB_PACKAGE_NAME;

    let packageInfo = packageInfos.find((v) => v.name === packageName);
    if (!packageInfo) {
        packageInfo = new PackageInfo(packageName);
        packageInfos.push(packageInfo);
    }

    let messages = packageInfo.messages;
    F.assert(
        !messages.find((v) => v.name === name),
        `register protobuf message failed, duplicated name: ${name}, package: ${packageName}`,
    );

    let info = verifyMessageInfo(registry, target, id);
    info.id = id;
    messages.push(info);
    return info;
}

export function registerField(
    target: Constructor,
    name: string,
    valueType: ValueType | Constructor,
    rule?: RuleType,
    id?: number,
) {
    let registry = F.Env.getCurrentData(ProtoBufRegistry);

    // 属性的decorator要先于class的decorator执行，所以这里是空
    let messageInfo = verifyMessageInfo(registry, target, id);
    F.assert(
        !messageInfo.fields.find((v) => v.name === name),
        `duplicated field name ${name} in message ${messageInfo.name}`,
    );

    let newField = new FieldInfo(name, valueType, rule || RuleType.optional, id);
    messageInfo.fields.push(newField);
    return newField;
}

// proto3 不支持repeated map，所以rule去掉了
// key in map fields cannot be float/double, bytes or message types.
// value 不能是 map
// https://developers.google.com/protocol-buffers/docs/proto3#maps
export function registerFieldMap(
    target: Constructor,
    name: string,
    keyType: ValueType,
    valueType: ValueType | Constructor,
    id?: number,
) {
    F.assert(
        keyType !== ValueType.Float && keyType !== ValueType.Double && keyType !== ValueType.Bytes,
        "Key in map fields cannot be float/double, bytes or message types.",
    );

    let registry = F.Env.getCurrentData(ProtoBufRegistry);

    // 属性的decorator要先于class的decorator执行，所以这里是空
    let messageInfo = verifyMessageInfo(registry, target, id);
    F.assert(
        !messageInfo.fields.find((v) => v.name === name),
        `duplicated field name ${name} in message ${messageInfo.name}`,
    );

    let newField = new MapInfo(name, keyType, valueType, RuleType.optional, id);
    messageInfo.fields.push(newField);
    return newField;
}

// ////////////////////////////////////////////////////////////////////////////////////////////
// decorators
/**
 * 标注protobuf message
 * @param packageName protobuf package name
 * @param index 强制索引
 * @returns
 */
export function message(packageName?: string, index?: number) {
    return function (target: Constructor) {
        registerMessage(target, target.name, packageName, index);
    };
}

/**
 * 标注protobuf field
 * @param valueType 类型
 * @param rule repeated or optional
 * @param id 索引
 * @returns
 */
export function field(valueType: ValueType | Constructor, rule?: RuleType, id?: number) {
    return function (target: any, propertyName: string) {
        registerField(target.constructor, propertyName, valueType, rule, id);
    };
}

/**
 * 标注protobuf map filed
 * @param keyType key 类型
 * @param valueType value 类型
 * @param id 索引
 * @returns
 */
export function fieldMap(keyType: ValueType, valueType: ValueType | Constructor, id?: number) {
    return function (target: any, propertyName: string) {
        registerFieldMap(target.constructor, propertyName, keyType, valueType, id);
    };
}

// constructor里拿不到propertyName，查了下人家就是不支持
// https://github.com/microsoft/TypeScript/issues/15904

// /**
//  * 为了方便在constructor里进行标注，功能同field
//  * @param valueType 类型
//  * @param rule repeated or optional
//  * @param id 索引
//  * @returns
//  */
// export function param(valueType: ValueType | Constructor, rule?: RuleType, id?: number) {
//     return function (target: any, propertyName: string, _paramIndex: number) {
//         registerField(target.constructor, propertyName, valueType, rule, id);
//     };
// }

// /**
//  * 为了方便在constructor里进行标注，功能同field map
//  * @param keyType key 类型
//  * @param valueType value 类型
//  * @param id 索引
//  * @returns
//  */
// export function paramMap(keyType: ValueType, valueType: ValueType | Constructor, id?: number) {
//     return function (target: any, propertyName: string, _paramIndex: number) {
//         registerFieldMap(target.constructor, propertyName, keyType, valueType, id);
//     };
// }
