// eslint-disable-next-line no-undef
export const STACKTRACE_ERROR_TAG = "StacktraceError";

if (Error.hasOwnProperty("stackTraceLimit")) {
    (Error as any).stackTraceLimit = 30;
}

export function assert(condition: any, msg?: string): asserts condition {
    if (!condition) {
        throw new Error(msg);
    }
}

/*
https://stackoverflow.com/questions/591857/how-can-i-get-a-javascript-stack-trace-when-i-throw-an-exception
*/
// export function stacktrace(): string {
//     // 比较费
//     function st2(f: any): string {
//       return !f ? "" :
//           st2(f.caller) + f.toString().split('(')[0].substring(9) + '(' + f.arguments.join(',') + ')\r\n'
//     }
//     return st2(arguments.callee.caller)
// }

export function stacktrace(start: number = 2, depth?: number): string {
    let error = new Error(STACKTRACE_ERROR_TAG);
    return error.stack
        ? error.stack
              .split("\n")
              .slice(start, depth ? start + depth : undefined)
              .join("\n")
        : "";
}

let enableDebugStackTrace = false;
export function setDebugStackTraceEnabled(enabled: boolean) {
    enableDebugStackTrace = enabled;
}

export function getDebugStackTrace(start: number = 2, depth?: number) {
    if (enableDebugStackTrace) return stacktrace(start, depth);
    else return "";
}

export type IStackTraceInfo = string | { stack?: string };

// 因为v8中构造error很快，但访问stack很慢，所以这里只构造error，不访问stack
export function getStackTraceInfo(): IStackTraceInfo {
    return new Error(STACKTRACE_ERROR_TAG);
}

export function getStackTraceInfoString(info?: IStackTraceInfo): string {
    if (!info) return "";
    else if (typeof info === "string") return info;
    else return info.stack || "";
}

let rootType = Object.getPrototypeOf(Object);
export function isChildOf(childCtor: any, parentCtor: any): boolean {
    let ctor = childCtor;
    while (ctor !== rootType) {
        if (ctor === parentCtor) {
            return true;
        }
        ctor = Object.getPrototypeOf(ctor);
    }
    return false;
}

export function statTimeBegin() {
    return new Date().getTime();
}

export function statTimeEnd(startTime: number, info: string) {
    let endTime = new Date().getTime();
    console.log(`stat time info: ${info}, time: ${endTime - startTime} ms`);
}

export function statTimeScope(func: () => void, info: string) {
    let now = statTimeBegin();
    func();
    statTimeEnd(now, info);
}
