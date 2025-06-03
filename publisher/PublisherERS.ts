import {
  PublisherBase,
  PublisherOptions,
} from "@electron-forge/publisher-base";
import { ForgeArch, ForgePlatform } from "@electron-forge/shared-types";
import axios, { AxiosRequestConfig } from "axios";
import debug from "debug";
import FormData from "form-data";
import fs from "fs";

import { basename } from "node:path";
import { PublisherERSConfig } from "./Config";

const d = debug("electron-forge:publish:ers");

interface ERSVersion {
  name: string;
  assets: {
    name: string;
    platform: string;
  }[];
  flavor: { name: string };
}

async function fetchAndCheckStatus<T>(url: string,
  init?: AxiosRequestConfig): Promise<T> {
  const result = await axios(url, init);
  if (result.status >= 200 && result.status < 300) {
    // res.status >= 200 && res.status < 300
    return result.data;
  }
  throw new Error(
    `ERS publish failed with status code: ${result.status} (${url})`
  );
}

export const ersPlatform = (
  platform: ForgePlatform,
  arch: ForgeArch
): string => {
  switch (platform) {
    case "darwin":
      return "osx_64";
    case "linux":
      return arch === "ia32" ? "linux_32" : "linux_64";
    case "win32":
      return arch === "ia32" ? "windows_32" : "windows_64";
    default:
      return platform;
  }
};

export default class PublisherERS extends PublisherBase<PublisherERSConfig> {
  name = "electron-release-server";

  async publish({
    makeResults,
    setStatusLine,
  }: PublisherOptions): Promise<void> {
    const { config } = this;

    if (!(config.baseUrl && config.username && config.password)) {
      throw new Error(
        'In order to publish to ERS you must set the "electronReleaseServer.baseUrl", "electronReleaseServer.username" and "electronReleaseServer.password" properties in your Forge config. See the docs for more info'
      );
    }

    d("attempting to authenticate to ERS");

    const api = (apiPath: string) => `${config.baseUrl}/${apiPath}`;

    const { token } = await await fetchAndCheckStatus<{ token: string }>(
      api("api/auth/login"),
      {
        method: "POST",
        data: JSON.stringify({
          username: config.username,
          password: config.password,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    function authFetch<T>(apiPath: string, options?: AxiosRequestConfig) {
      return fetchAndCheckStatus<T>(api(apiPath), {
        ...(options || {}),
        headers: {
          ...(options || {}).headers,
          Authorization: `Bearer ${token}`,
        },
      });
    }

    const flavor = config.flavor || "default";

    for (const makeResult of makeResults) {
      const { packageJSON } = makeResult;
      const artifacts = makeResult.artifacts.filter(
        (artifactPath) => basename(artifactPath).toLowerCase() !== "releases"
      );

      const versions = (await (
        await authFetch<ERSVersion[]>("api/version")
      )) ;
      const existingVersion = versions.find((version) => {
        return (
          version.name === packageJSON.version && version.flavor.name === flavor
        );
      });

      let channel = "stable";
      if (config.channel) {
        channel = config.channel;
      } else if (packageJSON.version.includes("rc")) {
        channel = "rc";
      } else if (packageJSON.version.includes("beta")) {
        channel = "beta";
      } else if (packageJSON.version.includes("alpha")) {
        channel = "alpha";
      }

      if (!existingVersion) {
        await authFetch("api/version", {
          method: "POST",
          data: JSON.stringify({
            channel: channel,
            flavor: flavor,
            name: packageJSON.version,
            notes: "",
            id: packageJSON.version + "_" + channel,
          }),
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      let uploaded = 0;
      const updateStatusLine = () =>
        setStatusLine(
          `Uploading distributable (${uploaded}/${artifacts.length})`
        );
      updateStatusLine();

      await Promise.all(
        artifacts.map(async (artifactPath: string) => {
          const platform = ersPlatform(makeResult.platform, makeResult.arch);
          if (existingVersion) {
            const existingAsset = existingVersion.assets.find(
              (asset) =>
                asset.name === basename(artifactPath) &&
                asset.platform === platform
            );

            if (existingAsset) {
              d("asset at path:", artifactPath, "already exists on server");
              uploaded += 1;
              updateStatusLine();
              return;
            }
          }
          d("attempting to upload asset:", artifactPath);
          const artifactForm = new FormData();
          artifactForm.append("token", token);
          artifactForm.append("version", `${packageJSON.version}_${flavor}`);
          artifactForm.append("platform", platform);

          // see https://github.com/form-data/form-data/issues/426
          const fileOptions = {
            knownLength: fs.statSync(artifactPath).size,
          };
          artifactForm.append(
            "file",
            fs.createReadStream(artifactPath),
            fileOptions
          );

          await authFetch("api/asset", {
            method: "POST",
            data: artifactForm,
            headers: artifactForm.getHeaders(),
          });
          d("upload successful for asset:", artifactPath);
          uploaded += 1;
          updateStatusLine();
        })
      );
    }
  }
}
