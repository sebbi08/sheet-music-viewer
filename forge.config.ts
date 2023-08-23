import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

import { config as dotenv } from "dotenv";
import PublisherERS from "./publisher/PublisherERS";

dotenv();
const config: ForgeConfig = {
  packagerConfig: {
    icon: "./icons/sheet-music"
  },
  rebuildConfig: {},
  makers: [new MakerSquirrel({
    setupIcon: "./icons/sheet-music.ico"
  }), new MakerZIP({}, ["darwin"]), new MakerRpm({}), new MakerDeb({})],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      devContentSecurityPolicy: "*",
      renderer: {
        config: rendererConfig,

        entryPoints: [
          {
            html: "./src/index.html",
            js: "./src/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/preload.ts"
            }
          }
        ]
      }
    })
  ],
  publishers: [
    new PublisherERS({
      baseUrl: "https://update.sebmahr.de",
      username: "sebbi",
      password: process.env.PASSWORD || ""
    })
  ]
};

export default config;
