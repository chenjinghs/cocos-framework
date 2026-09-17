import { CONFIG } from "./Define";

export namespace Logger {
    export function info(...args: any[]) {
        console.log(...args);
    }

    export function debug(...args: any[]) {
        CONFIG.DEBUG_MODE && info(...args);
    }

    export function splitLine() {
        info("------------------------------------------------");
    }
}
