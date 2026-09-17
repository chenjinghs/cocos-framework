import { cc } from "k-ts-framework-cocos";

export const UPDATE_UI_NAME = "PatcherUpdateUI";

/**
 * 补丁更新最小 UI：一个标题 Label、一个进度百分比 Label 和一个进度 Slider。
 * 挂载到场景 Canvas 下，显隐由 onDownloadProgressChanged / onOrganizeProgressChanged 驱动。
 */
export class UpdateUI {
    private root: cc.Node | null = null;
    private titleLabel: cc.Label | null = null;
    private progressLabel: cc.Label | null = null;
    private slider: cc.Slider | null = null;

    public open(title: string) {
        if (this.root && cc.isValid(this.root)) return;

        let scene = cc.director.getScene();
        if (!scene) return;
        let canvas = scene.getComponentInChildren(cc.Canvas);

        let root = new cc.Node(UPDATE_UI_NAME);
        (canvas ? canvas.node : scene).addChild(root);
        this.root = root;

        let titleNode = new cc.Node("title");
        root.addChild(titleNode);
        this.titleLabel = titleNode.addComponent(cc.Label);
        this.titleLabel.string = title;

        let sliderNode = new cc.Node("slider");
        root.addChild(sliderNode);
        this.slider = sliderNode.addComponent(cc.Slider);

        let progressNode = new cc.Node("progress");
        root.addChild(progressNode);
        this.progressLabel = progressNode.addComponent(cc.Label);
        this.progressLabel.string = "0%";
    }

    public close() {
        if (this.root && cc.isValid(this.root)) this.root.destroy();
        this.root = null;
        this.titleLabel = null;
        this.progressLabel = null;
        this.slider = null;
    }

    public setDownloadProgress(current: bigint, total: bigint) {
        if (!this.slider || !this.progressLabel) return;
        let ratio = total > 0 ? Number(current) / Number(total) : 0;
        this.slider.progress = ratio;
        this.progressLabel.string = `${Math.floor(ratio * 100)}%`;
    }

    public setOrganizeProgress(currentFiles: number, totalFiles: number) {
        if (!this.progressLabel) return;
        let ratio = totalFiles > 0 ? currentFiles / totalFiles : 0;
        this.progressLabel.string = `${Math.floor(ratio * 100)}% (${currentFiles}/${totalFiles})`;
    }

    public showError(msg: string) {
        if (!this.titleLabel || !this.progressLabel) return;
        this.progressLabel.string = msg;
    }
}
