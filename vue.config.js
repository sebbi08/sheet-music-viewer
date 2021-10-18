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
};
