// `form-data` library gives us a similar API in Node.js to the `FormData` interface in the browser
import FormData from "form-data";
import fs from "fs-extra";
import glob from "glob";
import path from "path";
import axios from "axios";


glob(path.resolve("./") + "/dist_electron/squirrel-windows/*", async (err, files) => {


    if (err) {
        throw err
    }


    const form = new FormData();

    for (let i = 0; i < files.length; i++){
        let file = files[i];
        if (path.basename(file).toLowerCase() === 'releases') continue;
        const fileContent = await fs.readFile(file);
        form.append(`file${i}`, fileContent, path.basename(file));
    }


    let packageJson = await fs.readJSON("package.json");
    let token = await fs.readJSON("token.json");
    form.append("platform", "win32")
    form.append("arch", "x64")

    form.append("version", packageJson.version);
    let settings = token;
    let url = `https://update.sebmahr.de/rest/app/${settings.appId}/channel/${settings.channelId}/upload`;
    try {
        await axios.post(url, form, {
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
                ...form.getHeaders(),
                Authorization: settings.NUCLEUS_TOKEN
            }
        })
        console.log("Upload Done");
    } catch (e) {
        console.log(e);
    }
});


