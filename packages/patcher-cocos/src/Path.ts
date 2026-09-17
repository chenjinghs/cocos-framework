import type { IPath } from "patcher";

/** POSIX 风格纯 JS 路径实现，不依赖引擎 */
export const path: IPath = {
    basename: (path) => {
        let normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
        let index = normalized.lastIndexOf("/");
        return index >= 0 ? normalized.slice(index + 1) : normalized;
    },
    join: (...paths) => {
        let joined = paths
            .filter((v) => v.length > 0)
            .join("/")
            .replace(/\\/g, "/")
            .replace(/\/+/g, "/");
        if (joined.length > 1) joined = joined.replace(/\/+$/, "");
        return joined;
    },
    resolve: (...paths) => {
        let resolved = "";
        for (let segment of paths) {
            segment = segment.replace(/\\/g, "/");
            if (segment.startsWith("/")) resolved = segment;
            else resolved = resolved ? `${resolved}/${segment}` : segment;
        }
        resolved = resolved.replace(/\/+/g, "/");
        let parts = resolved.split("/");
        let out: string[] = [];
        for (let part of parts) {
            if (part === "" || part === ".") continue;
            if (part === "..") out.pop();
            else out.push(part);
        }
        return "/" + out.join("/");
    },
    dirname: (path) => {
        let normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
        let index = normalized.lastIndexOf("/");
        if (index < 0) return "";
        if (index === 0) return "/";
        return normalized.slice(0, index);
    },
};
