<template>
  <div :class="setListDeletionMode ? 'deletionMode' : ''" class="container">
    <v-card class="addSetListCard" @click="addSetList()">
      <v-icon x-large>mdi-plus</v-icon>
      <h2 class="itemName">Add Set List</h2>
    </v-card>
    <v-card
      v-for="setList in setLists"
      :key="setList.id"
      @click="showSetList(setList)"
    >
      <v-icon x-large>mdi-playlist-music</v-icon>
      <h2 class="itemName">{{ setList.name }}</h2>
      <v-btn
        v-if="setListDeletionMode"
        class="deletionButton"
        color="primary"
        elevation="2"
        icon
        small
        @click="removeSetList(setList)"
      >
        <v-icon color="red"> mdi-close</v-icon>
      </v-btn>
    </v-card>

    <v-dialog v-model="showSetListDialog" max-width="466px">
      <v-card>
        <v-card-title>
          <span>Add Set List</span>
        </v-card-title>
        <div class="addSetListDialogContent">
          <v-text-field
            v-model="newSetListName"
            label="Set List name"
          ></v-text-field>
        </div>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" text @click="saveNewSetList()">Save</v-btn>
          <v-btn color="secondary" text @click="showSetListDialog = false">
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
import { SetList } from "../models/SetList";
import { EventNames, RouteNames } from "../Enums";
import { mapFields } from "vuex-map-fields";

@Component({
  computed: {
    ...mapFields(["setLists", "setListDeletionMode"]),
  },
})
export default class SetListList extends Vue {
  showSetListDialog = false;
  newSetListName = "";
  setListDeletionMode!: boolean;
  setLists!: SetList[];

  mounted(): void {
    this.setListDeletionMode = false;
    let basePath = this.$store.getters.getField("sheetMusicFolder");
    window.ipcRenderer.send(EventNames.LOAD_SET_LISTS, {
      basePath,
    });
  }

  saveNewSetList(): void {
    const newSetList: SetList = {
      id: this.getNextId(),
      name: this.newSetListName,
      sheets: [],
    };
    this.setLists.push(newSetList);
    this.showSetListDialog = false;
  }

  getNextId(): number {
    let id = 1;
    this.setLists.forEach((setList: SetList) => {
      if (setList.id >= id) {
        id = setList.id + 1;
      }
    });
    return id;
  }

  addSetList(): void {
    if (this.setListDeletionMode) {
      return;
    }
    this.newSetListName = "";
    this.showSetListDialog = true;
  }

  removeSetList(setListToRemove: SetList): void {
    if (!this.setListDeletionMode) {
      return;
    }
    this.setLists = this.setLists.filter((setList) => {
      return setList.id !== setListToRemove.id;
    });
    if (this.setLists.length === 0) {
      this.setListDeletionMode = false;
    }
  }

  showSetList(setList: SetList): void {
    if (this.setListDeletionMode) {
      return;
    }
    this.$router.push({
      name: RouteNames.SetList,
      params: { id: setList.id + "" },
    });
  }
}
</script>
<style lang="less" scoped>
.deletionMode {
  .v-card {
    pointer-events: none;
  }

  .addSetListCard {
    opacity: 0.5;
    background-color: rgba(0, 0, 0, 0.5);
  }

  .deletionButton {
    pointer-events: all;
    position: absolute;
    top: -14px;
    right: -14px;
    background-color: white;
  }
}

.addSetListDialogContent {
  padding-left: 24px;
  padding-right: 24px;
}

.container {
  max-height: calc(100vh - 32px - 64px);
  width: auto;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;

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

.itemName {
  word-break: break-word;
  text-align: center;
}

.wrapper {
  height: 100%;
}
</style>
