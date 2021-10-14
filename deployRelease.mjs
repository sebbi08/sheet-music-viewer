// `form-data` library gives us a similar API in Node.js to the `FormData` interface in the browser
import FormData from "form-data";
import fs from "fs-extra";
import glob from "glob";
import path from "path";
import axios from "axios";


glob(path.resolve("./") + "/dist_electron/squirrel-windows/*.exe", async (err, files) => {


    if (err) {
        throw err
    }
    if (files.length > 1) {
        throw new Error("Found more than one .exe pls check");
    }

    const form = new FormData();

    const file = await fs.readFile(files[0]);
    let packageJson = await fs.readJSON("package.json");
    let token = await fs.readJSON("token.json");
    form.append("file", file, path.basename(files[0]));
    form.append("platform", "win32")
    form.append("arch", "x64")

    form.append("version", packageJson.version);
    let url = "https://update.sebmahr.de/rest/app/2/channel/a5ee3785b14c683cf37e2caf9ebb04b1/upload";
    try {
        await axios.post(url, form, {
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
                ...form.getHeaders(),
                Authorization: token.NUCLEUS_TOKEN
            }
        })
    } catch (e) {
        console.log(e);
    }
});


