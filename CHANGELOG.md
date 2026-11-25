# [1.16.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.15.1...v1.16.0) (2026-11-25)


### Bug Fixes

* accept only absolute .pdf paths in loadMarkup and saveMarkup ([3e47946](https://github.com/sebbi08/sheet-music-viewer/commit/3e4794683e8e05a82aaedaecc3b72eca448b4c35))
* allow only one app instance per profile ([9a820de](https://github.com/sebbi08/sheet-music-viewer/commit/9a820de9078ea9cd0efab80aa7738666b826831c))
* bundle Roboto locally so the app works offline ([e3ceb01](https://github.com/sebbi08/sheet-music-viewer/commit/e3ceb019f3c31bfb92412c77a8ba450a84136c8a))
* check the empty sidecar input, limit the test switch, name the folder ([3f94542](https://github.com/sebbi08/sheet-music-viewer/commit/3f94542083a8f921dddb5f29bef18e34d3a2b5d1))
* clamp byte reads and validate xref offsets in PDF helpers ([84856db](https://github.com/sebbi08/sheet-music-viewer/commit/84856db737eaff092170337e96c9498f187021dc))
* count only files in the gate headline and check write access for empty markup files ([5fe05a8](https://github.com/sebbi08/sheet-music-viewer/commit/5fe05a8d8a054dd1fe62498034ce1469ee320491))
* cut half-step overlays before they can be shown ([3e26e2e](https://github.com/sebbi08/sheet-music-viewer/commit/3e26e2e31cce9d410729b943e7dc481072a08146))
* **deps:** replace patched trpc-electron with electron-trpc ([2b41e91](https://github.com/sebbi08/sheet-music-viewer/commit/2b41e91a13fc5d4e54fb61c3c9083ac3a9fc05e7))
* drop malformed entries of the migration skip list ([2a7c854](https://github.com/sebbi08/sheet-music-viewer/commit/2a7c85454528825287f18a00c242e401837c2abd))
* fail check C when a markup object is missing in the other viewer ([ad6934d](https://github.com/sebbi08/sheet-music-viewer/commit/ad6934d62c6115e3c036755e50aeeb59a33c8cc7))
* find legacy markup files with the old app's exact name rule ([e8ecd1b](https://github.com/sebbi08/sheet-music-viewer/commit/e8ecd1b5882b6b3d3adcb0c71e89603a9678e6d2))
* handle vanished sidecars, early cancel and v1 pages beyond the pdf ([603f6e6](https://github.com/sebbi08/sheet-music-viewer/commit/603f6e6563aac28dd958fd19b11b0a9048656dc9))
* harden zooming in edit mode after the final review ([9f7dfbb](https://github.com/sebbi08/sheet-music-viewer/commit/9f7dfbb0caf8174e3b13960b4f439b078f645f3d))
* keep .config.json forward compatible with newer app versions ([107c3a3](https://github.com/sebbi08/sheet-music-viewer/commit/107c3a3a1aecabaf0910d61708fbd5f1887d4d66))
* keep listing symlinked folders and pdfs in the sheet list ([9f2af61](https://github.com/sebbi08/sheet-music-viewer/commit/9f2af616ebe8ba030cbb70216d1b48dd1a123594))
* keep the divider line usable and turn the mode off outside the folder ([bf83187](https://github.com/sebbi08/sheet-music-viewer/commit/bf8318794e2a943f3170178828970e591c9d807a))
* keep the foreign /NM of an orphan that only had our /OC ([e0ccb6f](https://github.com/sebbi08/sheet-music-viewer/commit/e0ccb6fa45dbc450e6d1c447074570bf5eeee5ce))
* keep the migration window when a cancelled run leaves the app open ([746c95d](https://github.com/sebbi08/sheet-music-viewer/commit/746c95d074025161a2b1781294d176715722c157))
* keep the zoomed page below the marks and group children sharp ([d98cf9d](https://github.com/sebbi08/sheet-music-viewer/commit/d98cf9d79ca1855e0e9dc8dec61d135941b8268a))
* keep unsaved markup when leaving the sheet or closing the window ([f09e4ed](https://github.com/sebbi08/sheet-music-viewer/commit/f09e4ed28bea604270f1cb47d49aa8d57640bd95))
* lay the zoomed page out like the saved markup ([d147c4e](https://github.com/sebbi08/sheet-music-viewer/commit/d147c4e49af6ea620e7b953d12d06c2667e0c8b5))
* leave a sidecar that vanished before the backup out of the zip ([296c151](https://github.com/sebbi08/sheet-music-viewer/commit/296c151f9652e43a72780c2b4423b12e9370eeeb))
* let a cancelled check finish its current file so nothing is left behind ([fe8240f](https://github.com/sebbi08/sheet-music-viewer/commit/fe8240fca920a9b5355a36cd18738c5cf320e3be))
* let a pen that arrives as touch events draw in edit mode ([db07c4e](https://github.com/sebbi08/sheet-music-viewer/commit/db07c4e691404a2cee830049fe696e20a9fad81a))
* let main end a close that the renderer does not finish (B2) ([f67068b](https://github.com/sebbi08/sheet-music-viewer/commit/f67068bde93454b7dbd26451ed005c611d3a174f))
* load and save set lists per sheet folder through .config.json ([5852551](https://github.com/sebbi08/sheet-music-viewer/commit/5852551b6ab068e212d352e980ea97e8619a4cca))
* name the real reason when saving markup fails ([84cc24a](https://github.com/sebbi08/sheet-music-viewer/commit/84cc24aa696e48244c291352ef629d0c5c57c2ff))
* never hide sidecar markup behind a partial PDF save (B1) ([5ad9da1](https://github.com/sebbi08/sheet-music-viewer/commit/5ad9da1e5bffb01dd88945b2597b6363e10565ce))
* never leave the app gated without a window ([b5d4c2c](https://github.com/sebbi08/sheet-music-viewer/commit/b5d4c2c63601bc1885fac0df5e86260f77a9298f))
* never let a set-list save overwrite newer set lists ([0c0e447](https://github.com/sebbi08/sheet-music-viewer/commit/0c0e4470f512497bf29a18999169478efcc7389f))
* open the offline test's sheet in a corpus copy, never in Noten/ ([874a0bb](https://github.com/sebbi08/sheet-music-viewer/commit/874a0bbb83bf1b37918bb2dd02ef39366d09f992))
* protect legacy and v1 sidecars in the markup file layer ([433e6a3](https://github.com/sebbi08/sheet-music-viewer/commit/433e6a3797a0a7e78923669b06e1d8820cf62f24))
* read PDFs whose file name holds # or % ([4917f84](https://github.com/sebbi08/sheet-music-viewer/commit/4917f845e180c74dbb57e6a6d3d61bb656280439))
* read the folder config again while the file is locked ([71b079f](https://github.com/sebbi08/sheet-music-viewer/commit/71b079f3317297f59bb5804eab55abd71095404c))
* render the markup PNG at exactly the stamp's point size ([1138a57](https://github.com/sebbi08/sheet-music-viewer/commit/1138a570e10d60defade72ab993ba2c6d75ffbe2))
* report a markup render failure with its message instead of as damaged data ([1358a37](https://github.com/sebbi08/sheet-music-viewer/commit/1358a371144cd70291077a948129c8a5e4fcb12d))
* report a read-only sheet folder once instead of on every start ([2d42e54](https://github.com/sebbi08/sheet-music-viewer/commit/2d42e54e9c219252ee12579cac4876fc3303446d))
* retry locked files in the migration backup and sidecar delete ([87a376f](https://github.com/sebbi08/sheet-music-viewer/commit/87a376f65f1aa0c10ba1de750e6cd9cc84b858b1))
* retry locked PDF writes and verify the saved data per page ([8e87798](https://github.com/sebbi08/sheet-music-viewer/commit/8e877982d6320cdbdbb69859cedf1ff79df665a0))
* retry read-backs while locked, accept a BOM, validate set-list folders ([fb1099d](https://github.com/sebbi08/sheet-music-viewer/commit/fb1099dc7057bc9cabcc94f0c053ba6e4a577917))
* retry removing locked probes and sidecars, explain unreadable PDFs ([39f3011](https://github.com/sebbi08/sheet-music-viewer/commit/39f30114d430c3cc3ed9bd838b9d331bce5f6ebe))
* scale markup per axis by the real canvas size and keep unreadable legacy files ([574b8a1](https://github.com/sebbi08/sheet-music-viewer/commit/574b8a1a2338dfb01fa252b3b7b61dc2870338be))
* scan cloud placeholders that Windows reports as links ([d9bd269](https://github.com/sebbi08/sheet-music-viewer/commit/d9bd26938a983bde41db7a3654bbc99a5f3f3bd1))
* scan without relying on realpath and keep a second sidecar of the same PDF ([c4b56df](https://github.com/sebbi08/sheet-music-viewer/commit/c4b56df5c0878f03d29659602c9a2fe384372da5))
* settle verification and write on source and entry stream errors ([24a6e94](https://github.com/sebbi08/sheet-music-viewer/commit/24a6e94ae93bdb08d673dad49d4a533fe7764caa))
* skip instead of pass the visual baseline when the corpus is missing ([0d4f1a7](https://github.com/sebbi08/sheet-music-viewer/commit/0d4f1a7e8df911ed08f3e3ba1e833396fcd223d1))
* stop all backup work and close handles on cancel or error ([609693c](https://github.com/sebbi08/sheet-music-viewer/commit/609693c9402f683cdb4782639b21ce651a00b530))
* stream the backup zip and report progress throughout ([21ef6cc](https://github.com/sebbi08/sheet-music-viewer/commit/21ef6cc6c0e028cef8a30ae18e9c99e06b21add3))
* **test:** build the old app with its own dependencies ([d0d53a5](https://github.com/sebbi08/sheet-music-viewer/commit/d0d53a550f9b68317c34e4bc356a94ebcb636b19))
* tolerate trailing whitespace after %%EOF and harden replace detection ([37226e2](https://github.com/sebbi08/sheet-music-viewer/commit/37226e247db6d34e2022b13d8d468bca328e7395))
* treat an unreadable legacy markup file as a migration candidate ([9fa0697](https://github.com/sebbi08/sheet-music-viewer/commit/9fa06971937ebaf89ead7fab15c1eb00eb428048))
* treat repaired orphan stamps as foreign annotations ([a5f61e6](https://github.com/sebbi08/sheet-music-viewer/commit/a5f61e68c76960ceeb253c4fae4fe8380ed7258e))
* turn the markup with a page rotated after saving ([e8dfc29](https://github.com/sebbi08/sheet-music-viewer/commit/e8dfc29d88d09d6e16304aca095139e25b21be12))


### Features

* add a mode to move the page divider per page turn ([5cc635e](https://github.com/sebbi08/sheet-music-viewer/commit/5cc635e2924f8b8919e3721849972962b95ec9e4))
* add incremental PDF update writer ([ab9633d](https://github.com/sebbi08/sheet-music-viewer/commit/ab9633d9a14d6f19b8d263ad19195b3f94065d4d))
* add markup coordinate and PNG helpers ([dfafccc](https://github.com/sebbi08/sheet-music-viewer/commit/dfafccc2ba949ce57ea5097841c265aa5ea1a7fe))
* add the gesture tracker for zooming in edit mode ([e85b110](https://github.com/sebbi08/sheet-music-viewer/commit/e85b110f0198e8061e4d2f7a6c6cfb88f8614154))
* add the two-pass migration gate and its texts ([eb5397d](https://github.com/sebbi08/sheet-music-viewer/commit/eb5397d026c746b9bd25dd73e14d43406de7075c))
* add the view math for zooming in edit mode ([41a2cbc](https://github.com/sebbi08/sheet-music-viewer/commit/41a2cbcbd95ab321a2b3f568edf0b20d252a33cf))
* block the app until all legacy markup is migrated ([8ff48f0](https://github.com/sebbi08/sheet-music-viewer/commit/8ff48f0c0f9d3b6c895dddfd1b19a675cb159c81))
* cut the first page-turn step at the stored divider ([9a4ed40](https://github.com/sebbi08/sheet-music-viewer/commit/9a4ed40b254245036be9264ff30cf22d23bc1ae1))
* detect PDFs that cannot take markup and add a trial save ([cb95868](https://github.com/sebbi08/sheet-music-viewer/commit/cb95868400440e20fcfa30604ca01200364e2464))
* find legacy markup files and list only pdfs ([50a6ee6](https://github.com/sebbi08/sheet-music-viewer/commit/50a6ee605b0284418fda649b6bc2f45f7dfaf942))
* keep set lists and the migration mark in .config.json in the sheet folder ([b4186d2](https://github.com/sebbi08/sheet-music-viewer/commit/b4186d2848be0cbb3e5dcbb8eba8fe2a8c59df1c))
* keep the migration mark in the sheet folder's .config.json ([3bd1471](https://github.com/sebbi08/sheet-music-viewer/commit/3bd14718609f404ff1ae28f317e8bf07b68c6669))
* load and save markup through the PDF file ([decff1f](https://github.com/sebbi08/sheet-music-viewer/commit/decff1f53e375fb01c75f7e2245947936d7e0c66))
* load and save page dividers over tRPC ([9e76cf3](https://github.com/sebbi08/sheet-music-viewer/commit/9e76cf3221cb3c0329093068141fcd06ddc17886))
* migrate all legacy markup on start with a progress dialog ([4eb7d90](https://github.com/sebbi08/sheet-music-viewer/commit/4eb7d90bef91d446b624b9904fb2eb607bda7a0c))
* move a legacy markup file into its PDF as one checked step ([452fdd9](https://github.com/sebbi08/sheet-music-viewer/commit/452fdd992b139ba9ca5e40acdb9592ecaaf540f0))
* pinch with two fingers to zoom in edit mode ([329f24e](https://github.com/sebbi08/sheet-music-viewer/commit/329f24e204345c8aa21e8fa1db7055c2dfb11d4c))
* remember sheet folders whose markup is migrated ([d9fc0bb](https://github.com/sebbi08/sheet-music-viewer/commit/d9fc0bb86de8bec7dcded763017bbd62149d2c01))
* replace previous markup update instead of growing the PDF ([efc4d70](https://github.com/sebbi08/sheet-music-viewer/commit/efc4d7012fe44fb06648fd35d83f49f5e90b5e7e))
* report why a markup save failed and discard empty legacy sidecars ([c0627fb](https://github.com/sebbi08/sheet-music-viewer/commit/c0627fb35b53a0b5dec3d670bcf62e923e22b346))
* run the bulk markup migration file by file ([8aec172](https://github.com/sebbi08/sheet-music-viewer/commit/8aec17263f9a5a516b9b7a252ea57271a5389062))
* say on every open why a PDF cannot take markup ([680ab6f](https://github.com/sebbi08/sheet-music-viewer/commit/680ab6f6d0c33ff56c401afcb04b30141fdfb2bf))
* scan for legacy markup like the sheet list, links included ([1fd5d97](https://github.com/sebbi08/sheet-music-viewer/commit/1fd5d97448637bf311396541d25c0c45d0de4380))
* show the current sheet folder when choosing a new one ([26cf802](https://github.com/sebbi08/sheet-music-viewer/commit/26cf802ae86cc9ccc6d105167934c4c70c52d064))
* store page dividers per sheet in .config.json ([a73cecd](https://github.com/sebbi08/sheet-music-viewer/commit/a73cecd444ef7d6ffd8079eb7474e0a25c608581))
* store sheet markup inside the PDF ([1255a1e](https://github.com/sebbi08/sheet-music-viewer/commit/1255a1ec89924a7826ba70e743c17df27ca4cb29))
* write and verify the markup backup zip ([e60b84e](https://github.com/sebbi08/sheet-music-viewer/commit/e60b84ee38082ec79f9242cfd0518f8ba37fd65f))
* write markup stamps into PDFs ([ca6e4a7](https://github.com/sebbi08/sheet-music-viewer/commit/ca6e4a78bdf69c7cfd5126c1cbb0eb239508e082))
* zoom the edit canvas with the wheel and keep the page sharp ([57fc60e](https://github.com/sebbi08/sheet-music-viewer/commit/57fc60e9b3c0d1de9d7a69f5d65f3c2a41568441))


### Performance Improvements

* yield to the event loop between the pages of a save ([e299318](https://github.com/sebbi08/sheet-music-viewer/commit/e29931857c5fb7a46e995afc559a4409f5ae2041))

## [1.15.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.15.0...v1.15.1) (2026-08-27)


### Bug Fixes

* serve pdf.js wasm assets in dev and packaged app ([f41efa5](https://github.com/sebbi08/sheet-music-viewer/commit/f41efa54397c31d5b66b382caa7519da527d23ef))

# [1.15.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.14.1...v1.15.0) (2026-06-30)


### Features

* added wasm folders to bundle ([ee248d2](https://github.com/sebbi08/sheet-music-viewer/commit/ee248d205724c76f61a5ebaa6a2877bfb6784a36))

## [1.14.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.14.0...v1.14.1) (2026-05-10)


### Bug Fixes

* dummy commit ([d79e936](https://github.com/sebbi08/sheet-music-viewer/commit/d79e93674e87190c2f143e3243031ea12e43aeb4))

# [1.14.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.13.7...v1.14.0) (2026-05-10)


### Features

* improve updating from github ([d54b4f4](https://github.com/sebbi08/sheet-music-viewer/commit/d54b4f42ba33b55153ee8cf72fce69065e6f64cc))

## [1.13.7](https://github.com/sebbi08/sheet-music-viewer/compare/v1.13.6...v1.13.7) (2026-05-09)


### Bug Fixes

* notification in app ([9574fe0](https://github.com/sebbi08/sheet-music-viewer/commit/9574fe019954f1a58498819045c3e21f67942406))

## [1.13.6](https://github.com/sebbi08/sheet-music-viewer/compare/v1.13.5...v1.13.6) (2026-05-09)


### Bug Fixes

* test ([8a70ddf](https://github.com/sebbi08/sheet-music-viewer/commit/8a70ddf697ea87688d1db64a2b1c41b0a68f7fdb))

## [1.13.5](https://github.com/sebbi08/sheet-music-viewer/compare/v1.13.4...v1.13.5) (2026-05-09)


### Bug Fixes

* invalid import ([0fcfcc8](https://github.com/sebbi08/sheet-music-viewer/commit/0fcfcc839293af9ad138607287d760a1375b9984))

## [1.13.4](https://github.com/sebbi08/sheet-music-viewer/compare/v1.13.3...v1.13.4) (2026-05-09)


### Bug Fixes

* publish ([5122929](https://github.com/sebbi08/sheet-music-viewer/commit/5122929e1890587d251f2c70c9bd24225910f0ad))

## [1.13.3](https://github.com/sebbi08/sheet-music-viewer/compare/v1.13.2...v1.13.3) (2026-05-09)


### Bug Fixes

* release trigger ([31fda0b](https://github.com/sebbi08/sheet-music-viewer/commit/31fda0b10e0e0f70e83dadf07cfca646ac3f11a6))

## [1.13.2](https://github.com/sebbi08/sheet-music-viewer/compare/v1.13.1...v1.13.2) (2026-05-09)


### Bug Fixes

* release trigger ([c7e0392](https://github.com/sebbi08/sheet-music-viewer/commit/c7e039221d28287071af90b4d214a7d17f91f3b8))

## [1.13.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.13.0...v1.13.1) (2026-05-09)


### Bug Fixes

* seperate build jobs ([3c9048b](https://github.com/sebbi08/sheet-music-viewer/commit/3c9048bc224bd7f21b223deca066d8db29c77341))

# [1.13.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.12.0...v1.13.0) (2026-05-09)


### Features

* change release to github ([c01e230](https://github.com/sebbi08/sheet-music-viewer/commit/c01e230a73768ab78ee8064d06a641b42f723ca2))

# [1.12.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.11.0...v1.12.0) (2026-05-09)


### Features

* updated dependencies and fix image in PDF rendering ([6a5cc04](https://github.com/sebbi08/sheet-music-viewer/commit/6a5cc04a1a28c2e42370a236ecf725901f77f476))

# [1.11.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.10.2...v1.11.0) (2025-06-02)


### Bug Fixes

* cloned item not placed on canvas ([ccc1971](https://github.com/sebbi08/sheet-music-viewer/commit/ccc197101df96cde8249265a442185126e9215e9))
* loading ofd data from search not on top level ([797290c](https://github.com/sebbi08/sheet-music-viewer/commit/797290cddb4b360010d3bb9800b690a3df170038))
* make text edit button blue for better visibility ([bc4dbdc](https://github.com/sebbi08/sheet-music-viewer/commit/bc4dbdc66bc11f46955d56b0c25f8e3d7ea340d8))
* start in interactive mode to prevent initial drawing ([4efb82c](https://github.com/sebbi08/sheet-music-viewer/commit/4efb82c5d29b0df9c50cad40b3513cdfc7fb0332))


### Features

* add option to add sheet to set list from sheet viewer ([127ff03](https://github.com/sebbi08/sheet-music-viewer/commit/127ff03899a151bdfe0c6742af7f8882d5b58c88))
* show file name when sheet is open ([3bc181b](https://github.com/sebbi08/sheet-music-viewer/commit/3bc181bfe9659eeb598e160b7272388416370794))

## [1.10.2](https://github.com/sebbi08/sheet-music-viewer/compare/v1.10.1...v1.10.2) (2025-04-24)


### Bug Fixes

* edit mod not showing buttons ([e4d582b](https://github.com/sebbi08/sheet-music-viewer/commit/e4d582b04286d8b33da661ee7f4dff9805785606))

## [1.10.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.10.0...v1.10.1) (2025-04-24)


### Bug Fixes

* bug that prevent sheets without annotations to load ([5496c3d](https://github.com/sebbi08/sheet-music-viewer/commit/5496c3d5fabed47612ed52d15e3ec3efae96d0f4))
* switch to web hash history mode ([c1e6aa2](https://github.com/sebbi08/sheet-music-viewer/commit/c1e6aa2fa8538a2b53966f37a7c5e4022fc149bd))

# [1.10.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.9.1...v1.10.0) (2025-04-24)


### Features

* improve update mechanism ([f8bdb19](https://github.com/sebbi08/sheet-music-viewer/commit/f8bdb19b20ba133bc2ce5e72fc4370057fb61da5))

## [1.9.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.9.0...v1.9.1) (2025-04-15)


### Bug Fixes

* file names with special characters ([dcf29ad](https://github.com/sebbi08/sheet-music-viewer/commit/dcf29ad696d7168f58d027de4921d81917ba7ced))

# [1.9.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.8.0...v1.9.0) (2025-04-08)


### Bug Fixes

* paths not beeing encoded correctly ([9938c39](https://github.com/sebbi08/sheet-music-viewer/commit/9938c3991526a47586ec2619de21cac498117e71))


### Features

* update to vue3 pdfJs5 and switched to vite ([313e879](https://github.com/sebbi08/sheet-music-viewer/commit/313e879fa895683ee25eb41266f92ab919e43780))

# [1.8.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.7.0...v1.8.0) (2025-04-07)


### Bug Fixes

* disappearing clone button ([f073485](https://github.com/sebbi08/sheet-music-viewer/commit/f0734853e7431d82e73d4d4aa670395adb8502ad))


### Features

* add white marker ([da28730](https://github.com/sebbi08/sheet-music-viewer/commit/da2873072def3540268b9cad92c35962835e1bd8))

# [1.7.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.6.1...v1.7.0) (2023-12-23)


### Features

* reworked edit mode to be faster ([dc37d1b](https://github.com/sebbi08/sheet-music-viewer/commit/dc37d1baf559a9bd2ad642af36fb0669d9c9035a))

## [1.6.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.6.0...v1.6.1) (2023-11-15)


### Bug Fixes

* path handling on linux ([adf554e](https://github.com/sebbi08/sheet-music-viewer/commit/adf554e1108ea251a66e75a22f529145f594f0fa))

# [1.6.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.5.0...v1.6.0) (2022-12-29)


### Bug Fixes

* page turning indicator top position ([5c99e98](https://github.com/sebbi08/sheet-music-viewer/commit/5c99e98a5f08bf7e50971b66b14ce87a4ce466c5))


### Features

* added indicator for page split ([a6b6825](https://github.com/sebbi08/sheet-music-viewer/commit/a6b682539476183b4dc66e95045a4a1036953a83))

# [1.5.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.4.4...v1.5.0) (2022-04-23)


### Features

* added more icons ([ec03e8d](https://github.com/sebbi08/sheet-music-viewer/commit/ec03e8dd5ec58ffe51a638588e034865025bcca6))

## [1.4.4](https://github.com/sebbi08/sheet-music-viewer/compare/v1.4.3...v1.4.4) (2022-04-01)


### Bug Fixes

* overlay data path creation ([5fa9698](https://github.com/sebbi08/sheet-music-viewer/commit/5fa9698463b62f560bdc1310250f1233f8ddbe35))

## [1.4.3](https://github.com/sebbi08/sheet-music-viewer/compare/v1.4.2...v1.4.3) (2022-04-01)


### Bug Fixes

* path sep ([bb0cbd5](https://github.com/sebbi08/sheet-music-viewer/commit/bb0cbd526b5dfb6d6e69d30ed8290cca38bd3b8f))

## [1.4.2](https://github.com/sebbi08/sheet-music-viewer/compare/v1.4.1...v1.4.2) (2022-04-01)


### Bug Fixes

* dpi issue ([193cde8](https://github.com/sebbi08/sheet-music-viewer/commit/193cde8b4b296c7fdb5cdf131f6166a7d3a566e2))

## [1.4.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.4.0...v1.4.1) (2022-04-01)


### Bug Fixes

* added option to move one folder up in set list edit window ([2f93fa5](https://github.com/sebbi08/sheet-music-viewer/commit/2f93fa5dfdac0fc95af2f08c63bcb0155b66090d))
* set list ([9d6eadb](https://github.com/sebbi08/sheet-music-viewer/commit/9d6eadb55b28471ef62ae45984765f78b2281321))

# [1.4.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.3.0...v1.4.0) (2022-04-01)


### Features

* added sorting of set list and set list deletion ([7d82102](https://github.com/sebbi08/sheet-music-viewer/commit/7d821027d0487f74c78856763a68b3f01bd385a8))
* improved edit mode and new set list feature ([0f49a3d](https://github.com/sebbi08/sheet-music-viewer/commit/0f49a3d2dd4ec3c1f4a821b7480841281b1b9edf))

# [1.3.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.2.1...v1.3.0) (2021-10-26)


### Features

* render overlays with fabric to ensure quality ([207411e](https://github.com/sebbi08/sheet-music-viewer/commit/207411ed677cdeec627c8d0ab6a3808093bf7863))

## [1.2.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.2.0...v1.2.1) (2021-10-25)


### Bug Fixes

* use png instead of svg for overlay ([4cebea6](https://github.com/sebbi08/sheet-music-viewer/commit/4cebea634d9b8663c440f6494f9a017d15c1c2da))

# [1.2.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.1.1...v1.2.0) (2021-10-25)


### Bug Fixes

* half page canvas not beeing cleard ([7f4e107](https://github.com/sebbi08/sheet-music-viewer/commit/7f4e107813a7dd38cdd3a6c90ee7c85edb29d9ab))
* some overlay data not loaded in edit mode when image resolution changed ([270947d](https://github.com/sebbi08/sheet-music-viewer/commit/270947d4a729ddfa94596d47dfd34a0d2a2a0227))


### Features

* added backdrop for half pages ([6fe2009](https://github.com/sebbi08/sheet-music-viewer/commit/6fe20090464d55bcb6c7d6073f424142b9ceae48))
* added copy past and delete actions ([7e1ca45](https://github.com/sebbi08/sheet-music-viewer/commit/7e1ca450c96f3f0bf1dd7f0de4ea7bab046b6e2a))
* added music icons ([5b2bead](https://github.com/sebbi08/sheet-music-viewer/commit/5b2bead367765960b3adb4f9a328e4c924c91e03))
* added posibility to insert icons and text ([80012c7](https://github.com/sebbi08/sheet-music-viewer/commit/80012c71bb88a292963fb5be2c743b13c5e6ff71))
* enhanced market thickness nad reduced alpha value ([11fbeb2](https://github.com/sebbi08/sheet-music-viewer/commit/11fbeb2d3f82ab3e6ef330bc15d8cf5c54236ad9))

## [1.1.1](https://github.com/sebbi08/sheet-music-viewer/compare/v1.1.0...v1.1.1) (2021-10-23)


### Bug Fixes

* scaling of half page ([32901a6](https://github.com/sebbi08/sheet-music-viewer/commit/32901a698454bbc2e525758f3aa29aa24e9ee835))

# [1.1.0](https://github.com/sebbi08/sheet-music-viewer/compare/v1.0.0...v1.1.0) (2021-10-23)


### Bug Fixes

* scaling of drawing canvas on resolution change ([4506427](https://github.com/sebbi08/sheet-music-viewer/commit/45064279e495826c81687063537ec93ef22784ae))


### Features

* added brushes and colors ([110410c](https://github.com/sebbi08/sheet-music-viewer/commit/110410ced1ee154ea01cf226151df11aa8e5bb13))
* initial setup for drawing ([6edfb8b](https://github.com/sebbi08/sheet-music-viewer/commit/6edfb8b58df40c78cb803e0ae29a678bb4593048))
* saving of overlay data ([111e629](https://github.com/sebbi08/sheet-music-viewer/commit/111e62987c57177951d656dd9bbd4d1df459bfc9))

# 1.0.0 (2021-10-19)


### Bug Fixes

* main file was missing ([e0b53a4](https://github.com/sebbi08/sheet-music-viewer/commit/e0b53a471f87aace3c8f173ff13d24fb6b1f0d8b))
* windows navigation ([af41385](https://github.com/sebbi08/sheet-music-viewer/commit/af41385fac5ff35956df941641efad35917818c5))


### Features

* added auto update and release script ([2b75fda](https://github.com/sebbi08/sheet-music-viewer/commit/2b75fda8a7bf1f4b17911e3f2a379e1b67126097))
* added folder selection ([15d5ea8](https://github.com/sebbi08/sheet-music-viewer/commit/15d5ea8d6c642ed6b89ec469f6dcf56dd4f4092d))
* added resizing on window resize ([40b6023](https://github.com/sebbi08/sheet-music-viewer/commit/40b602321996d7fe4389bbe1e598d0fa5bc0bc6e))
* added search ([f54c614](https://github.com/sebbi08/sheet-music-viewer/commit/f54c61418337837e805cd42c7e93f74b002c3d06))
* folder navigation ([5e3d915](https://github.com/sebbi08/sheet-music-viewer/commit/5e3d915baae29d552d30ac186a1574c99dbe6a2d))
* implement paging ([dc3ac37](https://github.com/sebbi08/sheet-music-viewer/commit/dc3ac3723ec03cd4ba0812f2655b47376272cae8))
* implemented paging ([deff79b](https://github.com/sebbi08/sheet-music-viewer/commit/deff79bdd1f169b3e0a950a8f5f37d34aa7a1e45))
* navigation to pdf view ([1bcbb66](https://github.com/sebbi08/sheet-music-viewer/commit/1bcbb669a0f6c552233dd62ff8381ddd8d0a1d56))
* persist folder selection ([2fc25c7](https://github.com/sebbi08/sheet-music-viewer/commit/2fc25c78707cafc077c4bd3136ed2c80c6b0e8eb))
* remove vue-pdf-app and add pdf js standalone ([cab03a5](https://github.com/sebbi08/sheet-music-viewer/commit/cab03a510b134c1e1ae296e7a842fc9be02c8450))
* sheets now have horizonal scroll ([7852619](https://github.com/sebbi08/sheet-music-viewer/commit/7852619609b21c08197fc6ea545617fea46a58f2))
