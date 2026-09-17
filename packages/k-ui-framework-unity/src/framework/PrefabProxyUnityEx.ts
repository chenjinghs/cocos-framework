import { F } from "k-ts-framework";
import { CSArrayUtil, CSListUtil, GameObjectUtil, PrefabProxy, UnityTypeUtil } from "k-ts-framework-unity";
import { bindPrefab, RUIStore } from "k-ui-framework";

import { bindPrefabsWithChildren } from "./Util";

declare module "k-ts-framework-unity" {
    interface PrefabProxy<T = unknown, K extends Extract<keyof T, string> = Extract<keyof T, string>> {
        getText: (name: K) => CS.UnityEngine.UI.Text;
        getImage: (name: K) => CS.UnityEngine.UI.Image;
        getRawImage: (name: K) => CS.UnityEngine.UI.RawImage;
        getButton: (name: K) => CS.UnityEngine.UI.Button;
        getToggle: (name: K) => CS.UnityEngine.UI.Toggle;
        getSlider: (name: K) => CS.UnityEngine.UI.Slider;
        getScrollbar: (name: K) => CS.UnityEngine.UI.Scrollbar;
        getDropdown: (name: K) => CS.UnityEngine.UI.Dropdown;
        getInputField: (name: K) => CS.UnityEngine.UI.InputField;
        getScrollRect: (name: K) => CS.UnityEngine.UI.ScrollRect;
        getRectTransform: (name: K) => CS.UnityEngine.RectTransform;
        getCanvasGroup: (name: K) => CS.UnityEngine.CanvasGroup;
        getAnimation: (name: K) => CS.UnityEngine.Animation;

        bindPrefab: <P extends {}>(name: K, owner: F.RStore, tag: string, params?: P) => RUIStore;
        bindChildrenPrefab: <P extends {}>(parentName: K, owner: F.RStore, tag: string, params?: P | P[]) => RUIStore[];
        destroyChildren: (name: K, childrenName?: string) => void;

        // Text
        setTextField: (name: K, text: any) => void;
        getTextField: (name: K) => string;
        setTextColor: (name: K, color: CS.UnityEngine.Color) => void;
        getTextColor: (name: K) => CS.UnityEngine.Color;
        setTextAnchor: (name: K, anchor: CS.UnityEngine.TextAnchor) => void;
        getTextAnchor: (name: K) => CS.UnityEngine.TextAnchor;
        setHorizontalOverflow: (name: K, overflow: CS.UnityEngine.HorizontalWrapMode) => void;
        getHorizontalOverflow: (name: K) => CS.UnityEngine.HorizontalWrapMode;
        setVerticalOverflow: (name: K, overflow: CS.UnityEngine.VerticalWrapMode) => void;
        getVerticalOverflow: (name: K) => CS.UnityEngine.VerticalWrapMode;

        // InputField
        setInputFieldContent: (name: K, content: any, withoutNotify?: boolean) => void;
        getInputFieldContent: (name: K) => string;
        setInputFieldPlaceholderContent: (name: K, content: any) => void;

        // Slider
        setSliderValue: (name: K, value: number) => void;
        getSliderValue: (name: K) => number;

        // Image
        setImageSprite: (name: K, spritePath: string, withNativeSize?: boolean) => void;
        setImageAlpha: (name: K, alpha: number) => void;
        getImageAlpha: (name: K) => number;
        setImageColor: (name: K, color: CS.UnityEngine.Color) => void;
        getImageColor: (name: K) => CS.UnityEngine.Color;
        setImageNativeSize: (name: K) => void;
        getImageMaterial: (name: K) => CS.UnityEngine.Material;
        setImageMaterial: (name: K, material: CS.UnityEngine.Material | null) => void;
        setImageFillAmount: (name: K, fillAmount: number) => void;

        // RawImage
        setRawImageAlpha: (name: K, alpha: number) => void;
        getRawImageAlpha: (name: K) => number;
        setRawImageColor: (name: K, color: CS.UnityEngine.Color) => void;
        getRawImageColor: (name: K) => CS.UnityEngine.Color;
        setRawImageMaterial: (name: K, material: CS.UnityEngine.Material | null) => void;

        // Button
        setButtonEnabled: (name: K, enable: boolean) => void;

        // Scroll
        setScrollNormalizedPosition: (name: K, position: CS.UnityEngine.Vector2) => void;

        // Toggle
        setToggleIsOn: (name: K, isOn: boolean) => void;
        setToggleIsOnWithoutNotify: (name: K, isOn: boolean) => void;
        getToggleIsOn: (name: K) => boolean;

        // Dropdown
        setDropdownOptions: (name: K, options: string[], defaultValue?: number) => void;

        // RectTransform
        setRectLocalScale: (name: K, scale: CS.UnityEngine.Vector3 | number[]) => void;
        getRectLocalScale: (name: K) => CS.UnityEngine.Vector3;
        setRectLocalPosition: (name: K, position: CS.UnityEngine.Vector3 | number[]) => void;
        getRectLocalPosition: (name: K) => CS.UnityEngine.Vector3;
        setRectLocalRotation: (name: K, rotation: CS.UnityEngine.Quaternion) => void;
        setRectAnchoredPosition: (name: K, position: CS.UnityEngine.Vector2 | number[]) => void;
        setRectPivot: (name: K, pivot: CS.UnityEngine.Vector2 | number[]) => void;
        setRectAngleDegree: (name: K, angleDegree: number) => void;
        setRectSizeDelta: (name: K, sizeDelta: CS.UnityEngine.Vector2 | number[]) => void;
        getRectSizeDelta: (name: K) => CS.UnityEngine.Vector2;
        getRectSize: (name: K) => CS.UnityEngine.Vector2;
        setRectWidth: (name: K, width: number) => void;
        getRectWidth: (name: K) => number;
        setRectHeight: (name: K, height: number) => void;
        getRectHeight: (name: K) => number;

        // CanvasGroup
        setCanvasGroupAlpha: (name: K, alpha: number) => void;
        getCanvasGroupAlpha: (name: K) => number;

        // Particle
        playParticle: (name: K) => void;
        stopParticle: (name: K) => void;
        reactiveParticleGo: (name: K) => void;

        // Animation
        playAnimation: (name: K, animName?: string) => void;
        stopAnimation: (name: K, animName?: string) => void;
        isAnimationPlaying: (name: K) => boolean;
    }
}

PrefabProxy.prototype.getText = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.Text);
};

PrefabProxy.prototype.getImage = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.Image);
};

PrefabProxy.prototype.getRawImage = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.RawImage);
};

PrefabProxy.prototype.getButton = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.Button);
};

PrefabProxy.prototype.getToggle = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.Toggle);
};

PrefabProxy.prototype.getSlider = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.Slider);
};

PrefabProxy.prototype.getScrollbar = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.Scrollbar);
};

PrefabProxy.prototype.getDropdown = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.Dropdown);
};

PrefabProxy.prototype.getInputField = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.InputField);
};

PrefabProxy.prototype.getScrollRect = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.UI.ScrollRect);
};

PrefabProxy.prototype.getRectTransform = function (this, name: string) {
    return this.getTransform<typeof CS.UnityEngine.RectTransform>(name);
};

PrefabProxy.prototype.getCanvasGroup = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.CanvasGroup);
};

PrefabProxy.prototype.getAnimation = function (this, name: string) {
    return this.getComponent(name, CS.UnityEngine.Animation);
};

PrefabProxy.prototype.bindPrefab = function (this, name: string, owner: F.RStore, tag: string, params?: {}) {
    return bindPrefab(owner, this.getGameObject(name), tag, params);
};

PrefabProxy.prototype.bindChildrenPrefab = function (this, parentName: string, owner: F.RStore, tag: string, params?: {} | {}[]) {
    return bindPrefabsWithChildren(owner, this.getTransform(parentName), tag, params);
};

PrefabProxy.prototype.destroyChildren = function (this, name: string, childName?: string) {
    GameObjectUtil.destroyChildren(this.getGameObject(name), childName);
};

PrefabProxy.prototype.setTextField = function (this, name: string, text: any) {
    this.getText(name).text = String(text);
};

PrefabProxy.prototype.getTextField = function (this, name: string) {
    return this.getText(name).text;
};

PrefabProxy.prototype.setTextColor = function (this, name: string, color: CS.UnityEngine.Color) {
    this.getText(name).color = color;
};

PrefabProxy.prototype.getTextColor = function (this, name: string) {
    return this.getText(name).color;
};

PrefabProxy.prototype.setTextAnchor = function (this, name: string, anchor: CS.UnityEngine.TextAnchor) {
    this.getText(name).alignment = anchor;
};

PrefabProxy.prototype.getTextAnchor = function (this, name: string) {
    return this.getText(name).alignment;
};

PrefabProxy.prototype.setHorizontalOverflow = function (this, name: string, overflow: CS.UnityEngine.HorizontalWrapMode) {
    this.getText(name).horizontalOverflow = overflow;
};

PrefabProxy.prototype.getHorizontalOverflow = function (this, name: string) {
    return this.getText(name).horizontalOverflow;
};

PrefabProxy.prototype.setVerticalOverflow = function (this, name: string, overflow: CS.UnityEngine.VerticalWrapMode) {
    this.getText(name).verticalOverflow = overflow;
};

PrefabProxy.prototype.getVerticalOverflow = function (this, name: string) {
    return this.getText(name).verticalOverflow;
};

PrefabProxy.prototype.setInputFieldContent = function (this, name: string, content: any, withoutNotify?: boolean) {
    let textField = this.getInputField(name);
    if (withoutNotify) textField.SetTextWithoutNotify(String(content));
    else textField.text = String(content);
};

PrefabProxy.prototype.setInputFieldPlaceholderContent = function (this, name: string, content: any) {
    let textField = this.getInputField(name);
    let placeholder = GameObjectUtil.getComponent(textField.placeholder, CS.UnityEngine.UI.Text);
    placeholder.text = String(content);
};

PrefabProxy.prototype.getInputFieldContent = function (this, name: string) {
    return this.getInputField(name).text;
};

PrefabProxy.prototype.setSliderValue = function (this, name: string, value: number) {
    this.getSlider(name).value = value;
};

PrefabProxy.prototype.getSliderValue = function (this, name: string) {
    return this.getSlider(name).value;
};

PrefabProxy.prototype.setImageSprite = function (this, name: string, spritePath: string, withNativeSize = false) {
    let loader = this.findOrAddComponent(name, CS.KingSoft.UI.SpriteAsyncLoader);
    loader.Load(spritePath, withNativeSize);
};

PrefabProxy.prototype.setImageAlpha = function (this, name: string, alpha: number) {
    let image = this.getImage(name);
    image.color = new CS.UnityEngine.Color(image.color.r, image.color.g, image.color.b, alpha);
};

PrefabProxy.prototype.getImageAlpha = function (this, name: string) {
    return this.getImage(name).color.a;
};

PrefabProxy.prototype.setImageColor = function (this, name: string, color: CS.UnityEngine.Color) {
    this.getImage(name).color = color;
};

PrefabProxy.prototype.getImageColor = function (this, name: string) {
    return this.getImage(name).color;
};

PrefabProxy.prototype.setImageNativeSize = function (this, name: string) {
    this.getImage(name).SetNativeSize();
};

PrefabProxy.prototype.getImageMaterial = function (this, name: string) {
    return this.getImage(name).material;
};

PrefabProxy.prototype.setImageMaterial = function (this, name: string, material: CS.UnityEngine.Material | null) {
    this.getImage(name).material = material as CS.UnityEngine.Material;
};

PrefabProxy.prototype.setImageFillAmount = function (this, name: string, fillAmount: number) {
    this.getImage(name).fillAmount = Math.max(0, Math.min(1, fillAmount));
};

PrefabProxy.prototype.setRawImageAlpha = function (this, name: string, alpha: number) {
    let rawImage = this.getRawImage(name);
    rawImage.color = new CS.UnityEngine.Color(rawImage.color.r, rawImage.color.g, rawImage.color.b, alpha);
};

PrefabProxy.prototype.getRawImageAlpha = function (this, name: string) {
    return this.getRawImage(name).color.a;
};

PrefabProxy.prototype.setRawImageColor = function (this, name: string, color: CS.UnityEngine.Color) {
    this.getRawImage(name).color = color;
};

PrefabProxy.prototype.getRawImageColor = function (this, name: string) {
    return this.getRawImage(name).color;
};

PrefabProxy.prototype.setRawImageMaterial = function (this, name: string, material: CS.UnityEngine.Material | null) {
    this.getRawImage(name).material = material as CS.UnityEngine.Material;
};

PrefabProxy.prototype.setButtonEnabled = function (this, name: string, enabled: boolean) {
    this.getButton(name).enabled = enabled;
};

PrefabProxy.prototype.setScrollNormalizedPosition = function (this, name: string, position: CS.UnityEngine.Vector2) {
    this.getScrollRect(name).normalizedPosition = position;
};

PrefabProxy.prototype.setToggleIsOn = function (this, name: string, isOn: boolean) {
    this.getToggle(name).isOn = isOn;
};

PrefabProxy.prototype.setToggleIsOnWithoutNotify = function (this, name: string, isOn: boolean) {
    this.getToggle(name).SetIsOnWithoutNotify(isOn);
};

PrefabProxy.prototype.getToggleIsOn = function (this, name: string) {
    return this.getToggle(name).isOn;
};

PrefabProxy.prototype.setDropdownOptions = function (this, name: string, options: string[], defaultValue?: number) {
    let typeOptions = CSListUtil.convertToCSStringList(options);
    let typeRequirementDropdown = this.getDropdown(name);
    typeRequirementDropdown.ClearOptions();
    typeRequirementDropdown.AddOptions(typeOptions);
    defaultValue !== undefined && typeRequirementDropdown.SetValueWithoutNotify(defaultValue);
};

PrefabProxy.prototype.setRectLocalScale = function (this, name: string, scale: CS.UnityEngine.Vector3 | number[]) {
    this.getRectTransform(name).localScale = convertVector3(scale, 1);
};

PrefabProxy.prototype.getRectLocalScale = function (this, name: string) {
    return this.getRectTransform(name).localScale;
};

PrefabProxy.prototype.setRectLocalPosition = function (this, name: string, position: CS.UnityEngine.Vector3 | number[]) {
    this.getRectTransform(name).localPosition = convertVector3(position);
};

PrefabProxy.prototype.getRectLocalPosition = function (this, name: string) {
    return this.getRectTransform(name).localPosition;
};

PrefabProxy.prototype.setRectLocalRotation = function (this, name: string, rotation: CS.UnityEngine.Quaternion) {
    this.getRectTransform(name).localRotation = rotation;
};

PrefabProxy.prototype.setRectAnchoredPosition = function (this, name: string, position: CS.UnityEngine.Vector2 | number[]) {
    this.getRectTransform(name).anchoredPosition = convertVector2(position);
};

PrefabProxy.prototype.setRectPivot = function (this, name: string, pivot: CS.UnityEngine.Vector2 | number[]) {
    this.getRectTransform(name).pivot = convertVector2(pivot);
};

PrefabProxy.prototype.setRectAngleDegree = function (this, name: string, angleDegree: number) {
    let rectTransform = this.getRectTransform(name);
    rectTransform.localRotation = CS.UnityEngine.Quaternion.Euler(rectTransform.localRotation.x, rectTransform.localRotation.y, angleDegree);
};

PrefabProxy.prototype.setRectSizeDelta = function (this, name: string, sizeDelta: CS.UnityEngine.Vector2 | number[]) {
    this.getRectTransform(name).sizeDelta = convertVector2(sizeDelta);
};

PrefabProxy.prototype.getRectSizeDelta = function (this, name: string) {
    return this.getRectTransform(name).sizeDelta;
};

PrefabProxy.prototype.getRectSize = function (this, name: string) {
    return this.getRectTransform(name).rect.size;
};

PrefabProxy.prototype.setRectWidth = function (this, name: string, width: number) {
    let rectTransform = this.getRectTransform(name);
    rectTransform.sizeDelta = new CS.UnityEngine.Vector2(width, rectTransform.sizeDelta.y);
};

PrefabProxy.prototype.getRectWidth = function (this, name: string) {
    return this.getRectTransform(name).sizeDelta.x;
};

PrefabProxy.prototype.setRectHeight = function (this, name: string, height: number) {
    let rectTransform = this.getRectTransform(name);
    rectTransform.sizeDelta = new CS.UnityEngine.Vector2(rectTransform.sizeDelta.x, height);
};

PrefabProxy.prototype.getRectHeight = function (this, name: string) {
    return this.getRectTransform(name).sizeDelta.y;
};

PrefabProxy.prototype.setCanvasGroupAlpha = function (this, name: string, alpha: number) {
    this.getCanvasGroup(name).alpha = alpha;
};

PrefabProxy.prototype.getCanvasGroupAlpha = function (this, name: string) {
    return this.getCanvasGroup(name).alpha;
};

PrefabProxy.prototype.playParticle = function (this, name: string) {
    let comps = GameObjectUtil.getComponentsInChildren(this.getGameObject(name), CS.UnityEngine.ParticleSystem);
    CSArrayUtil.foreach(comps, (comp) => comp.Play());
};

PrefabProxy.prototype.stopParticle = function (this, name: string) {
    let comps = GameObjectUtil.getComponentsInChildren(this.getGameObject(name), CS.UnityEngine.ParticleSystem);
    CSArrayUtil.foreach(comps, (comp) => comp.Stop());
};

PrefabProxy.prototype.reactiveParticleGo = function (this, name: string) {
    let go = this.getGameObject(name);
    go.SetActive(false);
    go.SetActive(true);
};

PrefabProxy.prototype.playAnimation = function (this, name: string, animName?: string) {
    if (animName) this.getAnimation(name).Play(animName);
    else this.getAnimation(name).Play();
};

PrefabProxy.prototype.stopAnimation = function (this, name: string, animName?: string) {
    if (animName) this.getAnimation(name).Stop(animName);
    else this.getAnimation(name).Stop();
};

PrefabProxy.prototype.isAnimationPlaying = function (this, name: string) {
    return this.getAnimation(name).isPlaying;
};

function convertVector3(vector: number[] | CS.UnityEngine.Vector3, def: number = 0) {
    return Array.isArray(vector) ? UnityTypeUtil.vector3(vector, def) : vector;
}

function convertVector2(vector: number[] | CS.UnityEngine.Vector2, def: number = 0) {
    return Array.isArray(vector) ? UnityTypeUtil.vector2(vector, def) : vector;
}
