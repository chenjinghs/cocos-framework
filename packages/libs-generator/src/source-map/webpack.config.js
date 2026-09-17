/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable prefer-arrow-callback */
const webpack = require('webpack')

module.exports = {
    mode: 'production',

    target: 'es2022',
    entry: {
        'source-map-support': './source-map-support-entry.js'
    },
    output: {
        filename: 'source-map-support-bundle.mjs',
        path: __dirname + '/../../../../../Packages/com.kingsoft.kts.core/Runtime/Resources/dev-tools',
        library: {
            type: 'commonjs'
        }
    },
    experiments: { outputModule: true },
    optimization: { minimize: false },
    plugins: [
        new webpack.NormalModuleReplacementPlugin(
          /^path$/,
          function (resource) {
            resource.request = __dirname + '/../_node-shims/path.js'
          }
        ),
        new webpack.NormalModuleReplacementPlugin(
          /^fs$/,
          function (resource) {
            resource.request = __dirname + '/../_node-shims/fs.js'
          }
        ),
    ],
    externals: [
        // 'fs',
        // 'path',
        'crypto',
        'dns',
        'http',
        'http2',
        'https',
        'net',
        'os',
        'querystring',
        'stream',
        'repl',
        'readline',
        'tls',
        'dgram',
        'url',
        'v8',
        'vm',
        'zlib',
        'util',
        'assert',
        'events',
        'tty'
    ].reduce((prev, v) => { prev[v] = 'commonjs ' + v; return prev }, {})
}