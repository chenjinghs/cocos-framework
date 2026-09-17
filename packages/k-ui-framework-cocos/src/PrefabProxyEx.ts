import { F } from "k-ts-framework";
import { cc, PrefabProxy } from "k-ts-framework-cocos";
import { bindPrefab, RUIStore } from "k-ui-framework";

/**
 * PrefabProxy 的常用控件扩展子集（对齐 Unity 版 PrefabProxyUnityEx 的常用方法）。
 * 同时通过 declare module 增强基类，使 getPrefabProxy 返回值直接具备这些方法。
 */
export class PrefabProxyEx<T = unknown, K extends Extract<keyof T, string> = Extract<keyof T, string>> extends PrefabProxy<T, K> {
    // //////////////////////////////////////////////////////
    // prefab 绑定
    public bindPrefab<P = undefined>(name: K, owner: F.RStore, tag: string, params?: P extends undefined ? undefined : P): RUIStore {
        let child = this.getChild(name);
        F.assert(child, `bindPrefab failed, cannot find [${String(name)}]`);
        return bindPrefab(owner, child.getNode(), tag, params);
    }

    public bindChildrenPrefab<P = undefined>(parentName: K, owner: F.RStore, tag: string, params?: (P extends undefined ? undefined : P) | (P extends undefined ? undefined : P)[]): RUIStore[] {
        let parent = this.getChild(parentName);
        F.assert(parent, `bindChildrenPrefab failed, cannot find [${String(parentName)}]`);
        let children = parent.getNode().children;
        return children.map((child, index) => bindPrefab(owner, child, tag, params ? (Array.isArray(params) ? params[index] : params) : undefined));
    }

    public destroyChildren(name?: K) {
        let root = name !== undefined ? this.getChild(name) : this;
        if (root === null) return;
        for (let child of [...root.getNode().children]) child.destroy();
    }

    // //////////////////////////////////////////////////////
    // Label
    public getLabel(name: K): cc.Label | null {
        return this.getChild(name)?.getComponent(cc.Label) ?? null;
    }

    public setText(name: K, text: unknown) {
        let label = this.mustComponent(name, cc.Label);
        label.string = String(text);
    }

    public getText(name: K): string {
        return this.mustComponent(name, cc.Label).string;
    }

    // //////////////////////////////////////////////////////
    // Sprite
    public setSpriteFrame(name: K, spriteFrame: cc.SpriteFrame | null) {
        let sprite = this.mustComponent(name, cc.Sprite);
        sprite.spriteFrame = spriteFrame;
    }

    public getSpriteFrame(name: K): cc.SpriteFrame | null {
        return this.mustComponent(name, cc.Sprite).spriteFrame;
    }

    // //////////////////////////////////////////////////////
    // Button
    /** 挂接按钮点击事件（cc.Button 的 click 事件） */
    public onClick(name: K, callback: (event?: unknown) => void, target?: unknown) {
        let child = this.mustChild(name);
        child.on("click", callback, target);
    }

    public offClick(name: K, callback?: (event?: unknown) => void, target?: unknown) {
        let child = this.getChild(name);
        child?.off("click", callback, target);
    }

    public setButtonEnabled(name: K, enable: boolean) {
        let button = this.mustComponent(name, cc.Button);
        button.interactable = enable;
    }

    // //////////////////////////////////////////////////////
    // Toggle
    public setToggleIsOn(name: K, isOn: boolean) {
        this.mustComponent(name, cc.Toggle).isChecked = isOn;
    }

    public getToggleIsOn(name: K): boolean {
        return this.mustComponent(name, cc.Toggle).isChecked;
    }

    // //////////////////////////////////////////////////////
    // Slider
    public setSliderValue(name: K, value: number) {
        this.mustComponent(name, cc.Slider).progress = value;
    }

    public getSliderValue(name: K): number {
        return this.mustComponent(name, cc.Slider).progress;
    }

    // //////////////////////////////////////////////////////
    // EditBox
    public setEditBoxString(name: K, content: unknown) {
        this.mustComponent(name, cc.EditBox).string = String(content);
    }

    public getEditBoxString(name: K): string {
        return this.mustComponent(name, cc.EditBox).string;
    }

    // //////////////////////////////////////////////////////
    // ScrollView
    public scrollToTop(name: K, time?: number) {
        this.mustComponent(name, cc.ScrollView).scrollToTop(time);
    }

    public scrollToBottom(name: K, time?: number) {
        this.mustComponent(name, cc.ScrollView).scrollToBottom(time);
    }

    public scrollToOffset(name: K, offset: cc.Vec2, time?: number) {
        this.mustComponent(name, cc.ScrollView).scrollToOffset(offset, time);
    }

    // //////////////////////////////////////////////////////
    private mustChild(name: K): cc.Node {
        let child = this.getChild(name);
        F.assert(child, `cannot find child [${String(name)}] in [${this.getNode().name}]`);
        return child.getNode();
    }

    private mustComponent<CT extends cc.Component>(name: K, ctor: new (...args: never[]) => CT): CT {
        let component = this.getChild(name)?.getComponent(ctor) ?? null;
        F.assert(component, `cannot find component [${ctor.name}] in [${this.getNode().name}][${String(name)}]`);
        return component;
    }
}
