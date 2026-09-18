import assert from "node:assert/strict";
import { test } from "node:test";

import { createCocosFS } from "../src/FS";

/** 安装 jsb fileUtils 假实现到全局，返回清理函数 */
function installJsb(overrides: Partial<(typeof jsb)["fileUtils"]> = {}) {
    let defaults: (typeof jsb)["fileUtils"] = {
        isFileExist: () => false,
        isDirectoryExist: () => false,
        createDirectory: () => true,
        removeFile: () => true,
        removeDirectory: () => true,
        renameFile: () => true,
        copyFile: () => true,
        writeStringToFile: () => true,
        writeDataToFile: () => true,
        getStringFromFile: () => null,
        getDataFromFile: () => null,
        listFiles: () => [],
        getWritablePath: () => "/writable",
    };
    (globalThis as Record<string, unknown>).jsb = { fileUtils: { ...defaults, ...overrides } };
    return () => {
        delete (globalThis as Record<string, unknown>).jsb;
    };
}

test("rmAsync 瞬时失败重试后成功（对齐 Unity 版 10 次重试语义）", async () => {
    let attempts = 0;
    let cleanup = installJsb({
        isFileExist: () => true,
        // 前 2 次瞬时失败，第 3 次成功
        removeFile: () => ++attempts >= 3,
    });
    try {
        await createCocosFS().rmAsync("/x");
        assert.equal(attempts, 3);
    } finally {
        cleanup();
    }
});

test("rmAsync 持续失败耗尽 10 次重试后抛错", async () => {
    let attempts = 0;
    let cleanup = installJsb({
        isFileExist: () => true,
        removeFile: () => {
            attempts++;
            return false;
        },
    });
    try {
        await assert.rejects(createCocosFS().rmAsync("/x"), /cannot remove file/);
        assert.equal(attempts, 10);
    } finally {
        cleanup();
    }
});

test("rmSync 路径不存在视为成功，存在但删除失败抛错", () => {
    let cleanup = installJsb();
    try {
        createCocosFS().rmSync("/not-exist"); // 不抛错
    } finally {
        cleanup();
    }

    cleanup = installJsb({
        isFileExist: () => true,
        removeFile: () => false,
    });
    try {
        assert.throws(() => createCocosFS().rmSync("/x"), /cannot remove file/);
    } finally {
        cleanup();
    }
});

test("mkdirSync 已存在幂等，不存在但创建失败抛错", () => {
    let cleanup = installJsb({ isDirectoryExist: () => true });
    try {
        createCocosFS().mkdirSync("/exist"); // 幂等不抛错
    } finally {
        cleanup();
    }

    cleanup = installJsb({
        isDirectoryExist: () => false,
        createDirectory: () => false,
    });
    try {
        assert.throws(() => createCocosFS().mkdirSync("/x"), /mkdirSync failed/);
    } finally {
        cleanup();
    }
});
