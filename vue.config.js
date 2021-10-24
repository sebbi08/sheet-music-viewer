// eslint-disable-next-line @typescript-eslint/no-var-requires
const WorkerPlugin = require("worker-plugin");

module.exports = {
  transpileDependencies: ["vuetify", "pdfjs-dist"],
  pluginOptions: {
    electronBuilder: {
      preload: "src/preload.js",
    },
  },
  configureWebpack: {
    plugins: [new WorkerPlugin()],
    devtool: "source-map",
  },
  chainWebpack: (config) => {
    config.module
      .rule("images")
      .use("url-loader")
      .loader("url-loader")
      .tap((options) => Object.assign(options, { limit: 2097152 }));
  },
};
