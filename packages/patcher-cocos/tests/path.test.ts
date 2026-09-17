import assert from "node:assert/strict";
import { test } from "node:test";

import { path } from "../src/Path";
import { createCocosFS } from "../src/FS";

test("IPath.basename 常规与边界", () => {
    assert.equal(path.basename("/a/b/c.txt"), "c.txt");
    assert.equal(path.basename("c.txt"), "c.txt");
    assert.equal(path.basename("/a/b/"), "b");
    assert.equal(path.basename("a\\b\\c.txt"), "c.txt", "反斜杠按 POSIX 归一");
    assert.equal(path.basename("/"), "");
});

test("IPath.join 常规与边界", () => {
    assert.equal(path.join("/a", "b", "c"), "/a/b/c");
    assert.equal(path.join("a", "b"), "a/b");
    assert.equal(path.join("/a/", "/b/"), "/a/b", "重复与首尾斜杠收敛");
    assert.equal(path.join("a\\b", "c"), "a/b/c", "反斜杠归一");
    assert.equal(path.join("", "a"), "a", "空段被忽略");
});

test("IPath.resolve 常规与边界", () => {
    assert.equal(path.resolve("/a", "b", "c"), "/a/b/c");
    assert.equal(path.resolve("/a", "/b", "c"), "/b/c", "绝对段重置前缀");
    assert.equal(path.resolve("/a", "b/../c"), "/a/c", ".. 收敛");
    assert.equal(path.resolve("a", "b"), "/a/b", "相对路径锚定根");
    assert.equal(path.resolve("/a/./b"), "/a/b", ". 收敛");
});

test("IPath.dirname 常规与边界", () => {
    assert.equal(path.dirname("/a/b/c.txt"), "/a/b");
    assert.equal(path.dirname("/a"), "/");
    assert.equal(path.dirname("a.txt"), "");
    assert.equal(path.dirname("a\\b\\c"), "a/b", "反斜杠归一");
});

test("IFS 在非 jsb 运行时统一外抛（设计行为）", () => {
    let fs = createCocosFS();
    assert.throws(() => fs.existsSync("/any"), /unavailable/);
    assert.throws(() => fs.readFileTextSync("/any"), /unavailable/);
});
