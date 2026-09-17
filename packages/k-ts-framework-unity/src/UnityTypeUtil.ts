const CSVector2 = CS.UnityEngine.Vector2;
const CSVector3 = CS.UnityEngine.Vector3;
const CSVector4 = CS.UnityEngine.Vector4;
const CSQuaternion = CS.UnityEngine.Quaternion;
const CSColor = CS.UnityEngine.Color;
const CSRect = CS.UnityEngine.Rect;

type CSVector2 = CS.UnityEngine.Vector2;
type CSVector3 = CS.UnityEngine.Vector3;
type CSVector4 = CS.UnityEngine.Vector4;
type CSQuaternion = CS.UnityEngine.Quaternion;
type CSColor = CS.UnityEngine.Color;
type CSRect = CS.UnityEngine.Rect;

export namespace UnityTypeUtil {

    export const zeroVector2 = CSVector2.zero;
    export const zeroVector3 = CSVector3.zero;
    export const zeroVector4 = CSVector4.zero;
    export const oneVector2 = CSVector2.one;
    export const oneVector3 = CSVector3.one;
    export const oneVector4 = CSVector4.one;

    export function vector2(value: number | number[], defaultValue = 0): CSVector2 {
        if (typeof value === "number") {
            return new CSVector2(value, value);
        }
        return new CSVector2(value[0] ?? defaultValue, value[1] ?? defaultValue);
    }

    export function vector3(value: number | number[], defaultValue = 0): CSVector3 {
        if (typeof value === "number") {
            return new CSVector3(value, value, value);
        }
        return new CSVector3(value[0] ?? defaultValue, value[1] ?? defaultValue, value[2] ?? defaultValue);
    }

    export function vector4(value: number | number[], defaultValue = 0): CSVector4 {
        if (typeof value === "number") {
            return new CSVector4(value, value, value, value);
        }
        return new CSVector4(value[0] ?? defaultValue, value[1] ?? defaultValue, value[2] ?? defaultValue, value[3] ?? defaultValue);
    }

    export function rotator(value: number | number[], defaultValue = 0): CSQuaternion {
        if (typeof value === "number") {
            return CSQuaternion.Euler(value, value, value);
        }
        return CSQuaternion.Euler(value[0] ?? defaultValue, value[1] ?? defaultValue, value[2] ?? defaultValue);
    }

    export function color(value: number | number[], defaultValue = 0): CSColor {
        if (typeof value === "number") {
            return new CSColor(value, value, value, value);
        }
        return new CSColor(value[0] ?? defaultValue, value[1] ?? defaultValue, value[2] ?? defaultValue, value[3] ?? defaultValue);
    }

    export function rect(value: number | number[], defaultValue = 0): CSRect {
        if (typeof value === "number") {
            return new CSRect(value, value, value, value);
        }
        return new CSRect(value[0] ?? defaultValue, value[1] ?? defaultValue, value[2] ?? defaultValue, value[3] ?? defaultValue);
    }
}
