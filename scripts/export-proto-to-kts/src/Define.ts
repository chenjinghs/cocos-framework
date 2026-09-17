export const PROTO_NUMBER_TYPE = ["double", "float", "int32", "uint32", "sint32", "fixed32", "sfixed32"];
export const PROTO_STRING_TYPE = ["string"];
export const PROTO_BOOLEAN_TYPE = ["bool"];
export const PROTO_NUMBER64_TYPE = ["int64", "uint64", "sint64", "fixed64", "sfixed64"];
export const PROTO_UINT8ARRAY_TYPE = ["bytes"];

export const TYPE_PREFIX_ENUM = "E";
export const TYPE_PREFIX_INTERFACE = "I";

export enum EProtocolType {
    C2S,
    S2C,
    C2G,
    G2C,
    C2I,
    I2C,
}

export const PROTOCOL_REGISTER_FUNC_MAP = new Map<EProtocolType, string>([
    [EProtocolType.C2S, "registerC2SProtocol"],
    [EProtocolType.S2C, "registerS2CProtocol"],
    [EProtocolType.C2G, "registerC2SProtocol"],
    [EProtocolType.G2C, "registerS2CProtocol"],
    [EProtocolType.C2I, "registerC2SProtocol"],
    [EProtocolType.I2C, "registerS2CProtocol"],
]);
