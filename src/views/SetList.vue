<template>
  <div>
    <div class="container">
      <draggable v-model="setList.sheets" :disabled="!sortSetListEnabled">
        <v-card
          v-for="item in setList.sheets"
          :key="item.name + item.path"
          @click="openSheet(item)"
        >
          <v-icon x-large>mdi-file</v-icon>
          <div>
            <h4 class="itemName">
              {{ fileNameWithoutExtension(item.name) }}
            </h4>
            <h5 class="itemName">
              {{ item.path }}
            </h5>
          </div>
        </v-card>
      </draggable>
    </div>

    <v-dialog
      v-model="showEditSetListDialog"
      class="setListEditDialog"
      max-width="466px"
      scrollable
      transition="dialog-bottom-transition"
    >
      <v-card>
        <v-card-title>
          <span>Edit Set List</span>
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <div class="folderView">
            <v-list-item @click="moveFolderUp()">
              <v-list-item-content>
                <v-list-item-title class="listRow">
                  <div class="text">..</div>
                </v-list-item-title>
              </v-list-item-content>
            </v-list-item>
            <v-list-item
              v-for="item in pdfsAndFolders"
              :key="item.path + item.name"
              @click="selectItem(item)"
            >
              <v-list-item-content>
                <v-list-item-title class="listRow">
                  <v-icon v-if="!item.isFile" x-large>mdi-folder</v-icon>
                  <v-icon
                    v-if="item.isFile"
                    :class="
                      isFileInSetList(item)
                        ? 'fileIndicator fileIndicatorGreen'
                        : 'fileIndicator'
                    "
                    >{{ isFileInSetList(item) ? "mdi-check" : "mdi-close" }}
                  </v-icon>
                  <div class="text">
                    {{ fileNameWithoutExtension(item.name) }}
                  </div>
                </v-list-item-title>
              </v-list-item-content>
            </v-list-item>
          </div>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="secondary" text @click="showEditSetListDialog = false">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import Component from "vue-class-component";
import { Watch } from "vue-property-decorator";
import { EventNames, RouteNames } from "@/Enums";
import { SetList } from "@/models/SetList";
import { mapFields } from "vuex-map-fields";
import { SheetFile } from "@/models/SheetFile";
import draggable from "vuedraggable";

@Component({
  computed: {
    ...mapFields([
      "setLists",
      "showEditSetListDialog",
      "sheetMusicFolder",
      "filesAndFolder",
      "sortSetListEnabled",
    ]),
  },
  components: {
    draggable,
  },
})
export default class SetListVue extends Vue {
  setList: SetList;
  currentPath = "";
  pdfsAndFolders: SheetFile[] = [];
  loadedRelative: string | null = null;
  setLists!: SetList[];
  showEditSetListDialog!: boolean;
  filesAndFolder!: SheetFile[];
  sortSetListEnabled!: boolean;

  constructor(props: any) {
    super(props);
    this.setList = { name: "", sheets: [], id: -1 };
  }

  get folderPath(): string {
    return this.currentPath ? this.currentPath : window.path.sep;
  }

  openSheet(item: SheetFile): void {
    let basePath = this.$store.getters.getField("sheetMusicFolder");
    let path = basePath + item.path + window.path.sep + item.name;
    this.$router.push({
      name: RouteNames.SheetViewer,
      params: { path: path },
    });
  }

  moveFolderUp(): void {
    if (this.currentPath === "" || this.currentPath === "/") {
      return;
    }
    let split = this.currentPath.split(window.path.sep);
    split.pop();
    this.currentPath = split.join(window.path.sep);
  }

  selectItem(item: SheetFile): void {
    if (item.isFile) {
      if (!this.isFileInSetList(item)) {
        this.setList?.sheets.push({
          name: item.name,
          path: this.currentPath,
          isFile: true,
          isSearch: false,
        });
      } else if (this.setList) {
        this.setList.sheets = this.setList.sheets.filter((sheet) => {
          return !(sheet.path === this.currentPath && sheet.name === item.name);
        });
      }
    } else {
      if (this.currentPath) {
        this.currentPath = this.currentPath + window.path.sep + item.name;
      } else {
        this.currentPath = window.path.sep + item.name;
      }
    }
  }

  isFileInSetList(sheet: SheetFile): boolean {
    return (
      this.setList?.sheets.some((sheetInSet) => {
        return (
          sheetInSet.name === sheet.name && sheetInSet.path === this.currentPath
        );
      }) || false
    );
  }

  @Watch("filesAndFolder", { immediate: true, deep: true })
  getFolderAndPDFs(newVal: SheetFile[]): void {
    this.pdfsAndFolders = newVal
      .filter((item) => {
        if (item.isFile) {
          return item.name.toLowerCase().endsWith(".pdf");
        }
        return true;
      })
      .sort((a, b) => {
        if (a.isFile && !b.isFile) {
          return 1;
        }
        if (!a.isFile && b.isFile) {
          return -1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  loadPath(): void {
    let relativePath = this.folderPath;
    let basePath = this.$store.getters.getField("sheetMusicFolder");
    if (this.loadedRelative === relativePath) {
      return;
    }
    this.loadedRelative = relativePath;
    window.ipcRenderer.send(EventNames.FOLDER_SELECTED, {
      basePath,
      relativePath,
    });
  }

  @Watch("showEditSetListDialog", { immediate: true })
  onSetListEditModeChange(): void {
    if (this.showEditSetListDialog) {
      this.currentPath = "";
    } else {
      this.filesAndFolder = [];
    }
  }

  @Watch("currentPath", { deep: true, immediate: true })
  routeChange(): void {
    this.loadPath();
  }

  fileNameWithoutExtension(fileName: string): string {
    let indexOfExtension = fileName.lastIndexOf(".");
    if (indexOfExtension === -1) return fileName;
    return fileName.slice(0, indexOfExtension);
  }

  @Watch("setLists", { immediate: true })
  setListsChanged(setLists: SetList[]): void {
    this.setList = setLists.find(
      (setList: SetList) => setList.id === parseInt(this.$route.params.id, 10)
    ) || { name: "", sheets: [], id: -1 };
  }

  addSheet(): void {
    this.$router.push({ name: RouteNames.SetListList });
  }

  showSetList(): void {
    this.$router.push({ name: RouteNames.SheetSelection });
  }

  mounted(): void {
    this.sortSetListEnabled = false;
    this.loadedRelative = null;
    let basePath = this.$store.getters.getField("sheetMusicFolder");
    window.ipcRenderer.send(EventNames.LOAD_SET_LISTS, {
      basePath,
    });
  }
}
</script>
<style lang="less" scoped>
.setListEditDialog {
  margin-top: 48px;
}

.folderView {
  flex-grow: 2;

  .listRow {
    display: flex;
    flex-direction: row;
    align-items: center;

    .text {
      margin-left: 16px;
    }

    .fileIndicator {
      background: rgba(0, 0, 0, 0.54);
      width: 40px;
      height: 40px;
      border-radius: 40px;
      color: red;
    }

    .fileIndicatorGreen {
      color: lime;
    }
  }
}

.container {
  > div {
    max-height: calc(100vh - 32px - 64px);
    width: auto;
    overflow: auto;
    display: flex;
    flex-wrap: wrap;
  }

  .v-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    margin: 16px;
    width: calc(25% - 32px);
    @media (max-width: 960px) {
      width: calc(33% - 32px);
    }
    @media (max-width: 700px) {
      width: calc(50% - 32px);
    }
    @media (max-width: 400px) {
      width: calc(100% - 32px);
    }
  }
}
</style>
