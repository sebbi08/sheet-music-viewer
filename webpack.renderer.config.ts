import type {Configuration} from 'webpack';

import {rules} from './webpack.rules';
import {plugins} from './webpack.plugins';
import {VueLoaderPlugin} from "vue-loader";

import WorkerPlugin from "worker-plugin";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { VuetifyLoaderPlugin } = require('vuetify-loader')

rules.push({
    test: /\.vue$/,
    loader: 'vue-loader'
});
rules.push({
    test: /\.css$/,
    use: [
        'vue-style-loader',
        'css-loader'
    ]
});
rules.push({
    test: /\.less$/i,
    use: [
        // compiles Less to CSS
        "style-loader",
        "css-loader",
        "less-loader",
    ],
});
rules.push({
    test: /\.s(c|a)ss$/,
    use: [
        'vue-style-loader',
        'css-loader',
        {
            loader: 'sass-loader',
            options: {
                implementation: require('sass'),
                sassOptions: {
                    indentedSyntax: true // optional
                },
            },
        },
    ],
},);
rules.push( {
    test: /\.(png|jpg|gif|svg|ttf)$/i,
    type: 'asset/resource'
},);

plugins.push(new VueLoaderPlugin())
plugins.push(new WorkerPlugin())
plugins.push(new VuetifyLoaderPlugin())


export const rendererConfig: Configuration = {
    module: {
        rules,
    },
    plugins,
    resolve: {
        extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    },
};
