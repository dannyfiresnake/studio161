<script setup>
import { resolveConflict, dismissConflict } from '../cloud.js'
</script>

<template>
  <div id="conflict-overlay">
    <div class="conflict-box">
      <h2>Sync Conflict</h2>
      <p>Settings changed both here and in the cloud. Which do you want to keep?</p>
      <div class="conflict-actions">
        <button class="btn-keep-local" @click="resolveConflict('local')">Keep These</button>
        <button class="btn-keep-cloud" @click="resolveConflict('cloud')">Keep Cloud</button>
      </div>
      <a class="conflict-later" @click="dismissConflict">Decide later</a>
    </div>
  </div>
</template>
