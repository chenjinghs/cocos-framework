module.exports = {
    entry: "./path-entry.js", // 插件入口文件
    output: {
        filename: 'path-bundle.js',
        path: __dirname + '/../../../client/src/immortal/builtin',
        library: {
            type: 'commonjs'
        }
    },
    optimization: { minimize: false },
    mode: 'production',
};
