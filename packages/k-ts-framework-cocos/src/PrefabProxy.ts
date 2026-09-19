import { cc } from "./cc.js";

import { isValidNode } from "./NodeUtil.js";

/**
 * 面板/ prefab 节点的代理对象，对齐 Unity 版 PrefabProxy 的常用子集。
 * 查找走 node.getChildByName 递归（含整个子树）。
 */
export class PrefabProxy<T = unknown, K extends Extract<keyof T, string> = Extract<keyof T, string>> {
    public constructor(public readonly rootNode: cc.Node) {}

    /** 获取根节点 */
    public getNode(): cc.Node {
        return this.rootNode;
    }

    /**
     * 在子树中按名字递归查找子节点代理，找不到返回 null。
     */
    public getChild(name: K | (string & {})): PrefabProxy | null {
        let node = findNodeByName(this.rootNode, name);
        return node ? new PrefabProxy(node) : null;
    }

    /** 获取根节点上的组件（无断言，找不到返回 null） */
    public getComponent<CT extends cc.Component>(ctor: new (...args: never[]) => CT): CT | null {
        if (!isValidNode(this.rootNode)) return null;
        return this.rootNode.getComponent(ctor);
    }

    /** 订阅节点事件（cc.EventTarget.on） */
    public on(eventName: string, callback: (...args: unknown[]) => void, target?: unknown) {
        if (isValidNode(this.rootNode)) this.rootNode.on(eventName, callback, target);
    }

    /** 取消订阅节点事件 */
    public off(eventName: string, callback?: (...args: unknown[]) => void, target?: unknown) {
        if (isValidNode(this.rootNode)) this.rootNode.off(eventName, callback, target);
    }

    /** 设置根节点显隐 */
    public setActive(active: boolean) {
        if (isValidNode(this.rootNode)) this.rootNode.active = active;
    }
}

/** 深度优先在子树内按名字找节点 */
export function findNodeByName(root: cc.Node, name: string): cc.Node | null {
    if (!isValidNode(root)) return null;

    let directChild = root.getChildByName(name);
    if (directChild) return directChild;

    for (let child of root.children) {
        let found = findNodeByName(child, name);
        if (found) return found;
    }
    return null;
}
