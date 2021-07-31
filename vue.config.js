module.exports = {
  transpileDependencies: ["vuetify", "pdfjs-dist"],
  pluginOptions: {
    electronBuilder: {
      preload: "src/preload.js",
    },
  },
};
