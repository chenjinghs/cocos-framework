export function parseVerbose(value?: unknown) {
    if (value === undefined || value === null) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        throw new Error(`invalid verbose value: ${value}`);
    }

    if (typeof value !== "string") throw new Error(`invalid verbose value: ${String(value)}`);

    let normalized = value.trim().toLowerCase();
    if (normalized === "" || normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;

    throw new Error(`invalid verbose value: ${value}`);
}

export class ExportLogger {
    private static verbose = false;

    public static setVerbose(value?: unknown) {
        this.verbose = parseVerbose(value);
    }

    public static isVerbose() {
        return this.verbose;
    }

    public static logKey(message: string) {
        console.log(message);
    }

    public static logVerbose(message: string) {
        if (this.verbose) console.log(message);
    }
}
