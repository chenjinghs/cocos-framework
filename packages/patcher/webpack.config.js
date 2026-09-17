/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const nodeExternals = require("webpack-node-externals");
const WebpackObfuscator = require("webpack-obfuscator");
const fs = require("fs");

const productionBuild = process.argv.includes("--mode=production");
const outputPath = path.resolve(__dirname, "../../../Assets/StreamingAssets");

module.exports = {
  entry: "../../../TypeScripts/packages/patcher/src/index.ts", // 插件入口文件
  output: {
    filename: "patcher.js", // 输出的文件名
    path: outputPath, // 输出的文件夹
    libraryTarget: "commonjs",
    // library: "superjson",
    // enabledChunkLoadingTypes: ["require"],
  },
  mode: productionBuild ? "production" : "development",
  devtool: productionBuild ? false : "source-map",
  plugins: productionBuild
    ? [
        new WebpackObfuscator({
          compact: true,
          renameGlobals: false,
          renameProperties: false,
          selfDefending: false,
          stringArray: true,
          stringArrayThreshold: 0.5,
          target: "browser-no-eval",
        }),
        {
          apply(compiler) {
            compiler.hooks.afterEmit.tap("RemovePatcherSourceMap", () => {
              fs.rmSync(path.join(outputPath, "patcher.js.map"), { force: true });
              fs.rmSync(path.join(outputPath, "patcher.js.map.meta"), { force: true });
            });
          },
        },
      ]
    : [],
  externalsPresets: { node: true },
  externals: [nodeExternals({ allowlist: ["patch-common"] })],
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".json"], // 指定可以省略的文件后缀
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/, // 匹配 .ts 或 .tsx 文件
        use: {
          loader: "oxc-webpack-loader",
          options: {
            target: "es2022",
          },
        },
        exclude: /node_modules/,
      },
    ],
  }
};
