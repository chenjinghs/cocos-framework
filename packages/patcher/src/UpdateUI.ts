import { ETrackingPoint, IEngine, ILocalResourceSettings, UI_DIALOG_NAME, UI_DIALOG_PREFAB_PATH, UI_UPDATE_NAME, UI_UPDATE_PREFAB_PATH } from "./Define";
import { ILocalization } from "./LanguageDefine";
import { getLocalization, getLocalizationByKey } from "./Localization";
import { assert, createUI, delay, trackPoint } from "./Util";

const CS_GAME_OBJECT = CS.UnityEngine.GameObject;

const accessRestrictedTitle = "Access Restricted";
const accessRestrictedContent = `Due to operational and compliance requirements, the game is only available in selected regions.
The service is currently not available in your region.

If you have any questions, please feel free to contact our customer service team.
Thank you for your understanding.

Sincerely,
Motto Immortal Team`;
type AccessRestrictedLocalization = Partial<Record<"access_restricted_title" | "access_restricted_content", string>>;

// //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
export class UpdateUI {
    private localization: ILocalization;
    private engine: IEngine;

    private uiUpdate!: CS.UnityEngine.GameObject;
    private uiDialog!: CS.UnityEngine.GameObject;
    private progressText!: CS.UnityEngine.UI.Text;
    private progressSlider!: CS.UnityEngine.UI.Slider;

    private startDownloadTimestamp?: number;
    private startSize?: number;

    public constructor(engine: IEngine) {
        this.engine = engine;
        this.localization = getLocalization();
    }

    public hasOpened() {
        let uiUpdate = CS_GAME_OBJECT.Find(UI_UPDATE_NAME);
        return CS.KTSLauncher.KTSLibrary.IsNullObject(uiUpdate);
    }

    public open(localSettings: ILocalResourceSettings, currentVersion: number) {
        this.uiUpdate = CS_GAME_OBJECT.Find(UI_UPDATE_NAME);
        if (CS.KTSLauncher.KTSLibrary.IsNullObject(this.uiUpdate)) {
            this.uiUpdate = createUI(UI_UPDATE_PREFAB_PATH, UI_UPDATE_NAME);
        }
        assert(this.uiUpdate, "UpdateUI load failed");

        this.progressText = this.getComponent("progress_text", CS.UnityEngine.UI.Text);
        this.progressSlider = this.getComponent("progress_slider", CS.UnityEngine.UI.Slider);
        this.progressText.text = this.localization.check_patch;
        this.progressSlider.value = 0;

        let environment = localSettings.environment.replaceAll("-", "_");
        let bundleVersion = CS.UnityEngine.Application.version;
        let appVersion = localSettings.localResVersion;
        let resVersion = currentVersion;

        let versionText = this.getComponent("version_text", CS.UnityEngine.UI.Text);
        versionText.text = `${environment}_${bundleVersion}_${appVersion}_${resVersion}`;

        trackPoint(this.engine, ETrackingPoint.UpdateUIOpen);
        this.setProgress(0n, 1n);
    }

    public close() {
        // this.uiUpdate.SetActive(false);
        if (this.uiUpdate) CS_GAME_OBJECT.DestroyImmediate(this.uiUpdate);
        trackPoint(this.engine, ETrackingPoint.UpdateUIClose);
    }

    public setProgress(current: bigint, total: bigint, showDownloadSpeed?: boolean) {
        if ((showDownloadSpeed || current === total) && this.startDownloadTimestamp === undefined) {
            this.startSize = Number(current); // 因为有可能断点续传，所以第一次下载时不计算速度
            this.startDownloadTimestamp = Date.now();

            if (total > 0n && current < total) return;
        }

        if (current < total) {
            this.updataProgressText(Number(current), Number(total));
        } else {
            this.progressSlider.value = 1;
            this.progressText.text = this.localization.enter_gaming;
        }
    }

    public setOrganizeProgress(currentFiles: number, totalFiles: number) {
        // 整理使用文件数，不沿用下载速度和“下载完成即进入游戏”的文案。
        this.progressSlider.DOKill(false);
        this.progressSlider.value = totalFiles > 0 ? currentFiles / totalFiles : 0;
        this.progressText.text = `${this.localization.unzipping} ${currentFiles}/${totalFiles}`;
        this.startDownloadTimestamp = undefined;
        this.startSize = undefined;
    }

    private convertSizeToString(size: number) {
        if (size < 1024) {
            return `${size.toFixed(2)} B`;
        } else if (size < 1024 * 1024) {
            return `${(size / 1024).toFixed(2)} KB`;
        } else if (size < 1024 * 1024 * 1024) {
            return `${(size / 1024 / 1024).toFixed(2)} MB`;
        } else {
            return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
        }
    }

    private updataProgressText(currentSize: number, totalSize: number) {
        if (this.startDownloadTimestamp === undefined) return;

        let progress = currentSize / totalSize;
        if (progress < 1) {
            const now = Date.now();

            // if (now - this.startDownloadTimestamp > updateInterval) {
            this.progressSlider.value = progress;
            this.progressText.text = this.localization.downloading + `${this.convertSizeToString(currentSize)}/${this.convertSizeToString(totalSize)} (${(progress * 100).toFixed(2)}%)`;

            let elapsedTime = now - this.startDownloadTimestamp;
            elapsedTime = Math.max(elapsedTime, 1); // 确保不除以零

            let speed = ((currentSize - this.startSize!) / elapsedTime) * 1000; // 转换为每秒下载速度
            this.progressText.text += ` ${this.convertSizeToString(speed)}/s`;

            // this.startDownloadTimestamp = now; // 重置开始时间戳
            // this.startSize = currentSize; // 重置开始大小
            // }
        } else {
            this.progressSlider.value = 1;
            this.progressText.text = this.localization.enter_gaming;
        }
    }

    public updateProgressValueForEnterGame(current: number, total: number) {
        if (total > 0) {
            let progress = current / total;
            this.progressSlider.DOKill(false);
            this.progressSlider.value = progress;
            this.progressSlider.DOValue(1, 10);
        } else {
            this.progressSlider.value = 0;
        }
    }

    public setProgressText(text: string) {
        if (this.progressText) {
            this.progressText.text = text;
        } else {
            console.warn("Progress text component not found, cannot set progress text.");
        }
    }

    public async showErrorDialog(tag: string, error: string) {
        trackPoint(this.engine, ETrackingPoint.UpdateUIShowErrorDialog, `${tag}\n${error}`);
        let info = getLocalizationByKey(tag);
        let title = this.localization.error_title;
        let confirm: string | undefined = this.localization.retry;
        let cancel: string | undefined = this.localization.exit_game;
        let content = info;
        if (tag === ETrackingPoint.LimitedCountry) {
            let localization = getLocalization() as ILocalization & AccessRestrictedLocalization;
            title = localization.access_restricted_title ?? accessRestrictedTitle;
            content = localization.access_restricted_content ?? accessRestrictedContent;
            confirm = undefined; // no confirm button
        }
        let ret = this.showDialog(confirm, cancel, title, content);
        if (!ret) {
            trackPoint(this.engine, ETrackingPoint.UpdateUIExitGameWithError, tag);
            CS.UnityEngine.Application.Quit();
        }
        return ret;
    }

    public async showNewAppDownloadDialog(url: string | undefined) {
        trackPoint(this.engine, ETrackingPoint.UpdateUIShowAppDownloadDialog, url);
        return this.showDialog(this.localization.confirm, this.localization.exit_game, this.localization.default_title, this.localization.new_app_download).then((confirm) => {
            if (confirm) {
                trackPoint(this.engine, ETrackingPoint.UpdateUIConfirmJumpToNewAppUrl);
                if (url && url.length > 0) CS.UnityEngine.Application.OpenURL(url);
            } else {
                trackPoint(this.engine, ETrackingPoint.UpdateUICancelJumpToNewAppUrl);
            }
            CS.UnityEngine.Application.Quit();
        });
    }

    public async showCanDownloadDialog(dataSize: number) {
        let application = CS.UnityEngine.Application;
        let NetworkReachability = CS.UnityEngine.NetworkReachability;
        let i = 0;
        while (application.internetReachability === NetworkReachability.NotReachable) {
            trackPoint(this.engine, ETrackingPoint.UpdateUINoNetworkDialogShow, String(i));
            let retry = await this.showDialog(this.localization.retry, this.localization.exit_game, this.localization.default_title, this.localization.no_network);
            if (!retry) {
                trackPoint(this.engine, ETrackingPoint.UpdateUIExitGameWhenNetworkIsNotReachable);
                application.Quit();
                return false;
            }
            trackPoint(this.engine, ETrackingPoint.UpdateUINoNetworkDialogRetry);
            await delay(1000 * Math.min(++i, this.engine.maxRetryCount));
        }

        if (this.engine.isReviewMode || application.internetReachability === NetworkReachability.ReachableViaCarrierDataNetwork) {
            trackPoint(this.engine, ETrackingPoint.UpdateUIShowCanDownloadDialog, dataSize.toString());
            let confirm = await this.showDialog(
                this.localization.confirm,
                this.localization.cancel,
                this.localization.default_title,
                this.localization.can_download((dataSize / 1024 / 1024).toFixed(2)),
            );
            if (!confirm) {
                trackPoint(this.engine, ETrackingPoint.UpdateUICancelDownloadWhenNetworkIsNotWifi);
                CS.UnityEngine.Application.Quit();
                return false;
            }
            trackPoint(this.engine, ETrackingPoint.UpdateUIConfirmDownloadWhenNetworkIsNotWifi);
        }
        return true;
    }

    public async showNoNetworkDialog() {
        trackPoint(this.engine, ETrackingPoint.UpdateUINoNetworkDialogShow);

        let application = CS.UnityEngine.Application;
        let NetworkReachability = CS.UnityEngine.NetworkReachability;
        while (application.internetReachability === NetworkReachability.NotReachable) {
            let retry = await this.showDialog(this.localization.retry, this.localization.exit_game, this.localization.default_title, this.localization.no_network);
            if (retry) {
                trackPoint(this.engine, ETrackingPoint.UpdateUINoNetworkDialogRetry);
                await delay(1000);
            } else {
                trackPoint(this.engine, ETrackingPoint.UpdateUIExitGameWhenNetworkIsNotReachable);
                CS.UnityEngine.Application.Quit();
                return false;
            }
        }
        return true;
    }

    private async showDialog(confirmText: string | undefined, cancelText: string | undefined, titleText: string, contentText: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            if (this.uiDialog === undefined) {
                this.uiDialog = createUI(UI_DIALOG_PREFAB_PATH, UI_DIALOG_NAME);
            }
            this.uiDialog.SetActive(true);

            let title = this.getComponent("title_text", CS.UnityEngine.UI.Text);
            title.text = titleText;

            let content = this.getComponent("content_text", CS.UnityEngine.UI.Text);
            content.text = contentText;
            content.alignment = contentText.includes("\n") ? CS.UnityEngine.TextAnchor.MiddleLeft : CS.UnityEngine.TextAnchor.MiddleCenter;

            let confirmButton = this.getComponent("confirm_btn", CS.UnityEngine.UI.Button);
            confirmButton.gameObject.SetActive(!!confirmText);
            if (confirmText) {
                let confirm = this.getComponent("confirm_btn_text", CS.UnityEngine.UI.Text);
                confirm.text = confirmText;
                confirmButton.onClick.RemoveAllListeners();
                confirmButton.onClick.AddListener(() => {
                    this.closeDialog();
                    resolve(true);
                });
            }

            let cancelButton = this.getComponent("cancel_btn", CS.UnityEngine.UI.Button);
            cancelButton.gameObject.SetActive(!!cancelText);
            if (cancelText) {
                let cancel = this.getComponent("cancel_btn_text", CS.UnityEngine.UI.Text);
                cancel.text = cancelText;
                cancelButton.onClick.RemoveAllListeners();
                cancelButton.onClick.AddListener(() => {
                    this.closeDialog();
                    resolve(false);
                });
            }
        });
    }

    private closeDialog() {
        if (this.uiDialog) {
            CS.UnityEngine.GameObject.Destroy(this.uiDialog);
            this.uiDialog = undefined as any;
        }
    }

    private getComponent<CC extends typeof CS.UnityEngine.Component>(objPath: string, type: CC): InstanceType<CC> {
        let obj = CS_GAME_OBJECT.Find(objPath);
        let component = typeof type === "string" ? obj.GetComponent(type) : obj.GetComponent(puer.$typeof(type));
        assert(component, `cannot find component, objPath:${objPath}, type:${type}`);
        return component as InstanceType<CC>;
    }
}
