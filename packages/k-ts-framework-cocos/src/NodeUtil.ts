import { cc } from "./cc";

/** 判断一个对象是否仍然是有效的 Node（已销毁/伪空返回 false） */
export function isValidNode(value: unknown): value is cc.Node {
    return !!value && cc.isValid(value);
}

/**
 * 按相对路径查找子节点，路径形如 "a/b/c"；空路径返回 root 自身。
 * root 已销毁或路径不存在时返回 null。
 */
export function findNode(root: cc.Node, path: string): cc.Node | null {
    if (!isValidNode(root)) return null;
    if (!path) return root;

    let node = root.getChildByPath(path);
    return node ?? null;
}

/** 设置节点显隐（对无效节点静默） */
export function setActive(node: cc.Node | null | undefined, active: boolean) {
    if (isValidNode(node)) node.active = active;
}

/** 销毁节点（对无效节点静默） */
export function destroy(node: cc.Node | null | undefined) {
    if (isValidNode(node)) node.destroy();
}
