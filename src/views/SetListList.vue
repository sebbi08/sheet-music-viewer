<template>
  <div :class="store.setListDeletionMode ? 'deletionMode' : ''" class="container">
    <v-card class="addSetListCard" @click="addSetList()">
      <v-icon x-large>mdi-plus</v-icon>
      <h2 class="itemName">Add Set List</h2>
    </v-card>
    <v-card v-for="setList in store.setListsWrapper.setLists" :key="setList.id" @click="showSetList(setList)">
      <v-icon x-large>mdi-playlist-music</v-icon>
      <h2 class="itemName">{{ setList.name }}</h2>
      <v-btn v-if="store.setListDeletionMode" class="deletionButton" color="transparent" elevation="0" icon small
        @click="removeSetList(setList)">
        <v-icon color="red"> mdi-delete</v-icon>
      </v-btn>
    </v-card>

    <v-dialog v-model="showSetListDialog" max-width="466px">
      <v-card>
        <v-card-title>
          <span>Add Set List</span>
        </v-card-title>
        <div class="addSetListDialogContent">
          <v-text-field v-model="newSetListName" label="Set List name"></v-text-field>
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

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouteNames } from '../Enums';
import { SetList } from '../models/types';
import router from '../router';
import useStore from '../store';

const store = useStore();
const showSetListDialog = ref(false)
const newSetListName = ref("")

onMounted(() => {
  store.setListDeletionMode = false;
  store.loadSetLists();
})


function saveNewSetList(): void {
  const newSetList: SetList = {
    id: getNextId(),
    name: newSetListName.value,
    sheets: [],
  };
  store.setListsWrapper.setLists.push(newSetList);
  showSetListDialog.value = false;
}

function getNextId(): number {
  let id = 1;
  store.setListsWrapper.setLists.forEach((setList: SetList) => {
    if (setList.id >= id) {
      id = setList.id + 1;
    }
  });
  return id;
}

function addSetList(): void {
  if (store.setListDeletionMode) {
    return;
  }
  newSetListName.value = "";
  showSetListDialog.value = true;
}

function removeSetList(setListToRemove: SetList): void {
  if (!store.setListDeletionMode) {
    return;
  }
  store.setListsWrapper.setLists = store.setListsWrapper.setLists.filter((setList) => {
    return setList.id !== setListToRemove.id;
  });
  if (store.setListsWrapper.setLists.length === 0) {
    store.setListDeletionMode = false;
  }
}

function showSetList(setList: SetList): void {
  if (store.setListDeletionMode) {
    return;
  }
  router.push({
    name: RouteNames.SetList,
    params: { id: setList.id + "" },
  });
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
