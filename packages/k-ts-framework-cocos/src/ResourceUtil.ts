import { cc } from "./cc";

/** cc load 路径不允许带扩展名，这里做兜底剥离 */
export function normalizeResourcePath(path: string): string {
    return path.replace(/\.(prefab|png|jpg|jpeg|json|txt|textasset|spriteframe|asset)$/i, "");
}

async function loadBundle(bundleName: string): Promise<cc.Bundle> {
    if (bundleName === "resources") return cc.resources;

    const { promise, resolve, reject } = Promise.withResolvers<cc.Bundle>();
    cc.assetManager.loadBundle(bundleName, (err, bundle) => {
        if (err || bundle === null) reject(err ?? new Error(`loadBundle failed: ${bundleName}`));
        else resolve(bundle);
    });
    return promise;
}

/**
 * 经 cc.assetManager 加载资源：
 * 先 loadBundle(bundleName)，再 bundle.load(normalizedPath)。
 */
export async function loadAsset<T extends cc.Asset>(bundleName: string, path: string): Promise<T> {
    let normalizedPath = normalizeResourcePath(path);
    let bundle = await loadBundle(bundleName);

    const { promise, resolve, reject } = Promise.withResolvers<T>();
    bundle.load(normalizedPath, (err, asset) => {
        if (err || asset === null) reject(err ?? new Error(`load asset failed: ${bundleName}/${normalizedPath}`));
        else resolve(asset as T);
    });
    return promise;
}

/** 加载场景，err 时 reject */
export function loadScene(sceneName: string): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    cc.director.loadScene(sceneName, (err) => {
        if (err) reject(err);
        else resolve();
    });
    return promise;
}

/** 实例化 prefab 为节点 */
export function instantiatePrefab(prefab: cc.Prefab): cc.Node {
    return cc.instantiate(prefab);
}
